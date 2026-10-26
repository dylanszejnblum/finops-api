import { Inject, Injectable } from '@nestjs/common';
import { totalsByCurrency } from '../common/money';
import { BANK_CONNECTORS, BankConnector } from './bank-connector';
import {
  AggregateBalancesDto,
  AggregateExpensesDto,
  BalanceTotalDto,
  BankErrorDto,
  DateRangeDto,
  ExpenseTotalDto,
} from './bank.dto';

// Fans out to every configured bank. One bank failing never hides the others: it lands in `errors`.
// Totals are per currency; cross-currency conversion comes with the first non-USD bank.
@Injectable()
export class BanksService {
  constructor(
    @Inject(BANK_CONNECTORS) private readonly connectors: BankConnector[],
  ) {}

  configured() {
    return this.connectors.filter((c) => c.isConfigured());
  }

  async balances(): Promise<AggregateBalancesDto> {
    const { items, errors } = await this.fanOut((c) => c.balances());
    const totals = totalsByCurrency(items, [
      'available',
      'current',
    ]) as unknown as BalanceTotalDto[];
    return { items, totals, errors };
  }

  async expenses(range: DateRangeDto): Promise<AggregateExpensesDto> {
    const { items, errors } = await this.fanOut((c) => c.allExpenses(range));
    const totals = totalsByCurrency(items, [
      'amount',
    ]) as unknown as ExpenseTotalDto[];
    return { items, totals, errors };
  }

  async fanOut<T>(call: (c: BankConnector) => Promise<T[]>) {
    const banks = this.configured();
    const results = await Promise.allSettled(banks.map(call));
    const items: T[] = [];
    const errors: BankErrorDto[] = [];
    results.forEach((r, i) =>
      r.status === 'fulfilled'
        ? items.push(...r.value)
        : errors.push({
            bank: banks[i].bank,
            message:
              r.reason instanceof Error ? r.reason.message : String(r.reason),
          }),
    );
    return { items, errors };
  }
}
