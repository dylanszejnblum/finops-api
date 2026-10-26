import { BankConnector } from './bank-connector';
import { BalanceDto } from './bank.dto';
import { BanksService } from './banks.service';

const bal = (bank: string, available: number, currency = 'USD') =>
  ({ bank, currency, available, current: available }) as BalanceDto;

const connector = (
  bank: string,
  over: Partial<BankConnector>,
): BankConnector => ({
  bank,
  country: 'US',
  isConfigured: () => true,
  balances: () => Promise.resolve([]),
  allExpenses: () => Promise.resolve([]),
  ...over,
});

describe('BanksService', () => {
  it('merges configured banks, totals per currency and reports failures without hiding the rest', async () => {
    const svc = new BanksService([
      connector('a', {
        balances: () => Promise.resolve([bal('a', 10.1), bal('a', 0.2)]),
      }),
      connector('b', { balances: () => Promise.reject(new Error('down')) }),
      connector('c', { balances: () => Promise.resolve([bal('c', 5, 'ARS')]) }),
      connector('off', {
        isConfigured: () => false,
        balances: () => Promise.reject(new Error('never called')),
      }),
    ]);
    const out = await svc.balances();
    expect(out.items).toHaveLength(3);
    expect(out.totals).toEqual([
      { currency: 'USD', available: 10.3, current: 10.3 },
      { currency: 'ARS', available: 5, current: 5 },
    ]);
    expect(out.errors).toEqual([{ bank: 'b', message: 'down' }]);
  });
});
