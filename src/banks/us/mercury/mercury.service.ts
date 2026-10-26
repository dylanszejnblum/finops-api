import {
  BadGatewayException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TtlCache } from '../../../common/ttl-cache';
import { BankConnector } from '../../bank-connector';
import {
  BalanceDto,
  DateRangeDto,
  ExpenseDto,
  ExpensesQueryDto,
} from '../../bank.dto';

// Subset of https://docs.mercury.com/reference — only the fields we map.
interface MercuryAccount {
  id: string;
  name: string;
  nickname: string | null;
  status: string;
  availableBalance: number;
  currentBalance: number;
}

interface MercuryTransaction {
  id: string;
  accountId?: string;
  amount: number;
  status: string;
  kind: string;
  counterpartyName: string;
  bankDescription: string | null;
  note: string | null;
  mercuryCategory: string | null;
  cardId: string | null;
  createdAt: string;
  postedAt: string | null;
}

const PAGE = 1000; // Mercury's max page size for accounts and transactions

@Injectable()
export class MercuryService implements BankConnector {
  readonly bank = 'mercury';
  readonly country = 'US';
  private readonly logger = new Logger(MercuryService.name);
  private readonly balanceCache: TtlCache<BalanceDto[]>;
  private readonly accountCache: TtlCache<BalanceDto>;

  constructor(private readonly config: ConfigService) {
    const ttlMs = Number(config.get('BALANCE_CACHE_SECONDS', 30)) * 1000;
    this.balanceCache = new TtlCache(ttlMs);
    this.accountCache = new TtlCache(ttlMs);
  }

  isConfigured() {
    return !!this.config.get<string>('MERCURY_API_TOKEN');
  }

  balances(): Promise<BalanceDto[]> {
    return this.balanceCache.get('all', async () => {
      const out: BalanceDto[] = [];
      let start_after: string | undefined;
      do {
        const { accounts, page } = await this.get<{
          accounts: MercuryAccount[];
          page?: { nextPage?: string | null };
        }>('/accounts', { limit: PAGE, start_after });
        out.push(...accounts.map(toBalance));
        start_after =
          accounts.length === PAGE ? (page?.nextPage ?? undefined) : undefined;
      } while (start_after);
      return out;
    });
  }

  balance(accountId: string): Promise<BalanceDto> {
    return this.accountCache.get(accountId, async () =>
      toBalance(await this.get<MercuryAccount>(`/account/${accountId}`)),
    );
  }

  async expenses(
    accountId: string,
    q: ExpensesQueryDto,
  ): Promise<ExpenseDto[]> {
    const { transactions } = await this.get<{
      transactions: MercuryTransaction[];
    }>(`/account/${accountId}/transactions`, {
      start: q.start,
      end: q.end,
      status: q.status,
      limit: q.limit ?? 500,
      offset: q.offset,
    });
    // ponytail: filtered after paging, so a page can hold fewer than `limit` expenses; use allExpenses for full ranges
    return toExpenses(transactions, accountId);
  }

  async allExpenses({ start, end }: DateRangeDto): Promise<ExpenseDto[]> {
    const out: ExpenseDto[] = [];
    // Sequential on purpose: Mercury doesn't document rate limits, so stay gentle.
    for (const { accountId } of await this.balances()) {
      for (let offset = 0; ; offset += PAGE) {
        const { transactions } = await this.get<{
          transactions: MercuryTransaction[];
        }>(`/account/${accountId}/transactions`, {
          start,
          end,
          limit: PAGE,
          offset,
          order: 'asc',
        });
        out.push(...toExpenses(transactions, accountId));
        if (transactions.length < PAGE) break;
      }
    }
    return out;
  }

  // GET only: this integration is read-only by design (balances + expenses, nothing else).
  private async get<T>(
    path: string,
    query: Record<string, string | number | undefined> = {},
  ): Promise<T> {
    const token = this.config.get<string>('MERCURY_API_TOKEN');
    if (!token)
      throw new ServiceUnavailableException('Mercury is not configured');

    const url = new URL(
      this.config.get('MERCURY_BASE_URL', 'https://api.mercury.com/api/v1') +
        path,
    );
    for (const [k, v] of Object.entries(query))
      if (v !== undefined) url.searchParams.set(k, String(v));

    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 404)
        throw new NotFoundException('Mercury resource not found');
      if (!res.ok) {
        this.logger.error(
          `Mercury ${res.status} on GET ${path}: ${await res.text()}`,
        );
        throw new BadGatewayException(`Mercury responded ${res.status}`);
      }
      return (await res.json()) as T;
    } catch (e) {
      if (e instanceof HttpException) throw e;
      this.logger.error(`Mercury request failed on GET ${path}: ${String(e)}`);
      throw new BadGatewayException('Mercury unreachable');
    }
  }
}

const toBalance = (a: MercuryAccount): BalanceDto => ({
  bank: 'mercury',
  country: 'US',
  accountId: a.id,
  name: a.nickname ?? a.name,
  currency: 'USD',
  available: a.availableBalance,
  current: a.currentBalance,
  status: a.status,
});

// Mercury has no direction filter; money out is a negative amount.
const toExpenses = (
  txs: MercuryTransaction[],
  accountId: string,
): ExpenseDto[] =>
  txs
    .filter((t) => t.amount < 0)
    .map((t) => ({
      bank: 'mercury',
      id: t.id,
      accountId: t.accountId ?? accountId,
      amount: -t.amount,
      currency: 'USD',
      counterparty: t.counterpartyName,
      description: t.bankDescription ?? t.note,
      category: t.mercuryCategory,
      cardId: t.cardId,
      status: t.status,
      kind: t.kind,
      createdAt: t.createdAt,
      postedAt: t.postedAt,
    }));
