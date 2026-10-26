import { BalanceDto, ExpenseDto } from './bank.dto';

// Contract every bank integration implements so the aggregator, sync and reports stay bank-agnostic.
// Read-only by design: there is deliberately no method that moves money.
export interface BankConnector {
  readonly bank: string;
  readonly country: string;
  isConfigured(): boolean;
  balances(): Promise<BalanceDto[]>;
  /** Every expense across all accounts in [start, end], fully paginated. */
  allExpenses(range: { start?: string; end?: string }): Promise<ExpenseDto[]>;
}

export const BANK_CONNECTORS = Symbol('BANK_CONNECTORS');
