import {
  ConflictException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { round2, sumMoney } from '../common/money';
import { DateRangeDto, ExpenseDto } from '../banks/bank.dto';
import { BanksService } from '../banks/banks.service';
import { ExpenseEntity } from './expense.entity';

const DAY = 86_400_000;
/** Statuses that represent money actually spent (or committed). */
export const SPENT = ['sent', 'pending'];
export const GROUP_BY = [
  'category',
  'counterparty',
  'bank',
  'kind',
  'accountId',
] as const;
export type GroupBy = (typeof GROUP_BY)[number];

// A bare YYYY-MM-DD end date means "through the end of that day".
export function resolveRange({ start, end }: DateRangeDto, now = new Date()) {
  return {
    from: start ? new Date(start) : new Date(now.getTime() - 30 * DAY),
    to: end ? new Date(end.length === 10 ? `${end}T23:59:59.999Z` : end) : now,
  };
}

const monthKey = (d: Date) => d.toISOString().slice(0, 7);
const monthStart = (now: Date, monthsBack: number) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1));

export const toEntity = (e: ExpenseDto): ExpenseEntity => ({
  id: `${e.bank}:${e.id}`,
  bank: e.bank,
  externalId: e.id,
  accountId: e.accountId,
  amount: e.amount,
  currency: e.currency,
  counterparty: e.counterparty.slice(0, 255),
  description: e.description?.slice(0, 1024) ?? null,
  category: e.category?.slice(0, 128) ?? null,
  cardId: e.cardId,
  status: e.status,
  kind: e.kind,
  createdAt: new Date(e.createdAt),
  postedAt: e.postedAt ? new Date(e.postedAt) : null,
  syncedAt: new Date(),
});

@Injectable()
export class LedgerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(LedgerService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @InjectRepository(ExpenseEntity)
    private readonly repo: Repository<ExpenseEntity>,
    private readonly banks: BanksService,
    private readonly config: ConfigService,
  ) {}

  // ponytail: in-process interval; with several replicas each one syncs (harmless, upserts are idempotent).
  // Move to a single scheduled job if bank API quotas get tight.
  onApplicationBootstrap() {
    const minutes = Number(this.config.get('SYNC_INTERVAL_MINUTES', 30));
    if (minutes <= 0) return;
    const run = () =>
      this.sync().catch((e: unknown) =>
        this.logger.warn(`Background sync skipped: ${String(e)}`),
      );
    void run();
    this.timer = setInterval(() => void run(), minutes * 60_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async sync(range: DateRangeDto = {}) {
    if (this.running) throw new ConflictException('A sync is already running');
    this.running = true;
    try {
      // First run on an empty table backfills further so reports have history.
      const isEmpty = !(await this.repo.count());
      const days = !isEmpty
        ? Number(this.config.get('SYNC_LOOKBACK_DAYS', 30))
        : Number(this.config.get('SYNC_BACKFILL_DAYS', 365));
      const start =
        range.start ?? new Date(Date.now() - days * DAY).toISOString();
      const end = range.end ?? new Date().toISOString();

      const { items, errors } = await this.banks.fanOut((c) =>
        c.allExpenses({ start, end }),
      );
      const rows = items.map(toEntity);
      // Checked before the upsert, otherwise every counterparty is already "known".
      const fresh = isEmpty ? [] : await this.newCounterparties(rows);
      for (let i = 0; i < rows.length; i += 500)
        await this.repo.upsert(rows.slice(i, i + 500), ['id']);
      if (fresh.length) await this.alert(fresh);

      this.logger.log(
        `Synced ${rows.length} expenses ${start} → ${end}, ${errors.length} bank errors`,
      );
      return {
        synced: rows.length,
        newCounterparties: fresh.length,
        start,
        end,
        errors,
      };
    } finally {
      this.running = false;
    }
  }

  // Money out to someone never paid before: our read-only stand-in for ACH debit blocking,
  // which Mercury's API doesn't expose (that lives in the Mercury dashboard).
  // A counterparty with no stored row also means every row for it is new.
  // ponytail: exact string match; Postgres is case-sensitive, MySQL usually isn't. Normalize names if that causes noise.
  private async newCounterparties(rows: ExpenseEntity[]) {
    const names = [...new Set(rows.map((r) => r.counterparty))];
    const known = new Set<string>();
    for (let i = 0; i < names.length; i += 500) {
      const seen = await this.repo.find({
        where: { counterparty: In(names.slice(i, i + 500)) },
        select: { counterparty: true },
      });
      for (const s of seen) known.add(s.counterparty);
    }
    return rows.filter((r) => !known.has(r.counterparty));
  }

  private async alert(rows: ExpenseEntity[]) {
    const text = [
      `⚠️ ${rows.length} expense(s) to new counterparties:`,
      ...rows.map(
        (r) =>
          `• ${r.amount} ${r.currency} → ${r.counterparty} (${r.bank}, ${r.kind}, ${r.status}, ${r.createdAt.toISOString()})`,
      ),
    ].join('\n');
    this.logger.warn(text);
    const url = this.config.get<string>('ALERT_WEBHOOK_URL');
    if (!url) return;
    // Telegram's sendMessage takes the same `text` plus a chat_id; its limit is 4096 chars.
    const chatId = this.config.get<string>('ALERT_TELEGRAM_CHAT_ID');
    // Alerting must never fail the sync: the rows are already stored.
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          chatId ? { chat_id: chatId, text: text.slice(0, 4000) } : { text },
        ),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) this.logger.error(`Alert webhook responded ${res.status}`);
    } catch (e) {
      this.logger.error(`Alert webhook failed: ${String(e)}`);
    }
  }

  private spent(from: Date, to: Date) {
    return this.repo.find({
      where: { createdAt: Between(from, to), status: In(SPENT) },
      select: {
        amount: true,
        currency: true,
        createdAt: true,
        category: true,
        counterparty: true,
        bank: true,
        kind: true,
        accountId: true,
      },
    });
  }

  // ponytail: aggregates in memory to stay DB-agnostic; fine to ~100k rows, push GROUP BY to SQL past that.
  async burn(months: number, now = new Date()) {
    const rows = await this.spent(monthStart(now, months - 1), now);
    const keys = Array.from({ length: months }, (_, i) =>
      monthKey(monthStart(now, months - 1 - i)),
    );
    const currencies = [...new Set(rows.map((r) => r.currency))];
    return currencies.flatMap((currency) =>
      keys.map((month) => ({
        month,
        currency,
        amount: sumMoney(
          rows
            .filter(
              (r) => r.currency === currency && monthKey(r.createdAt) === month,
            )
            .map((r) => r.amount),
        ),
      })),
    );
  }

  /** Runway = live available balance / average gross burn of the last 3 complete months. */
  async runway(now = new Date()) {
    const [balances, rows] = await Promise.all([
      this.banks.balances(),
      this.spent(
        monthStart(now, 3),
        new Date(monthStart(now, 0).getTime() - 1),
      ),
    ]);
    const currencies = new Set([
      ...balances.totals.map((t) => t.currency),
      ...rows.map((r) => r.currency),
    ]);
    const items = [...currencies].map((currency) => {
      const available =
        balances.totals.find((t) => t.currency === currency)?.available ?? 0;
      const avgMonthlyBurn = round2(
        sumMoney(
          rows.filter((r) => r.currency === currency).map((r) => r.amount),
        ) / 3,
      );
      return {
        currency,
        available,
        avgMonthlyBurn,
        runwayMonths:
          avgMonthlyBurn > 0
            ? Math.round((available / avgMonthlyBurn) * 10) / 10
            : null,
      };
    });
    return {
      basis: 'gross burn, last 3 complete months',
      items,
      errors: balances.errors,
    };
  }

  async spend(groupBy: GroupBy, range: DateRangeDto) {
    const { from, to } = resolveRange(range);
    const rows = await this.spent(from, to);
    const groups = Map.groupBy(
      rows,
      (r) => `${r[groupBy] ?? '(none)'}\u0000${r.currency}`,
    );
    return [...groups]
      .map(([k, g]) => {
        const [key, currency] = k.split('\u0000');
        return {
          key,
          currency,
          amount: sumMoney(g.map((r) => r.amount)),
          count: g.length,
        };
      })
      .sort((a, b) => b.amount - a.amount);
  }

  async export(range: DateRangeDto) {
    const { from, to } = resolveRange(range);
    return this.repo.find({
      where: { createdAt: Between(from, to) },
      order: { createdAt: 'ASC' },
    });
  }
}
