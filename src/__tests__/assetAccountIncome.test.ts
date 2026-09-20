import { describe, it, expect } from 'vitest';
import { calculateForecast, getCurrentAssetValue } from '../services/financialEngine';
import { getInvestedAmountAtValuation } from '../services/investmentPerformanceService';
import { computeAssetAccountBalanceAtDate } from '../services/analyticsEngine';
import { Account, Transaction } from '../types/finance';

const pension = {
  id: 'pension1',
  name: 'Doplňkové penzijní spoření',
  type: 'pension',
  initialBalanceInHaler: 100000,
  initialBalanceDate: '2026-01-01',
} as unknown as Account;

const tx = (over: Partial<Transaction>): Transaction => ({
  id: 't1',
  type: 'income',
  status: 'executed',
  date: '2026-06-10',
  amountInHaler: 50000,
  sourceAccountId: 'pension1',
  ...over,
} as unknown as Transaction);

describe('income and expense on investment/pension accounts', () => {
  it('income increases the current value', () => {
    expect(getCurrentAssetValue(pension, [tx({})], [], '2026-09-20')).toBe(150000);
    expect(computeAssetAccountBalanceAtDate(pension, '2026-09-20', [tx({})], [])).toBe(150000);
  });

  it('expense decreases the current value', () => {
    expect(getCurrentAssetValue(pension, [tx({ type: 'expense' })], [], '2026-09-20')).toBe(50000);
  });

  it('counts income and expense as invested capital, not as gain', () => {
    expect(getInvestedAmountAtValuation(pension, [tx({})], '2026-09-20')).toBe(150000);
    expect(getInvestedAmountAtValuation(pension, [tx({ type: 'expense' })], '2026-09-20')).toBe(50000);
  });

  it('forecast keeps income in invested principal, gain stays zero', () => {
    const period = { key: '2026-06', name: 'x', year: 2026, month: 6, startDate: '2026-05-15', endDate: '2026-06-14' } as any;
    const acc = { ...pension, initialBalanceDate: '2026-05-20', status: 'active', isNetWorth: true } as Account;
    const r = calculateForecast([period], [acc], [tx({})], [], [], [], undefined, [], '2026-06', '2026-06-20');
    const bal = r.periods[0].accountBalances.pension1;
    expect(bal.closingBalanceInHaler).toBe(150000);
    expect(bal.investedPrincipalInHaler).toBe(150000);
    expect(bal.unrealizedGainLossInHaler).toBe(0);
  });

  it('ignores planned income', () => {
    expect(getCurrentAssetValue(pension, [tx({ status: 'planned' })], [], '2026-09-20')).toBe(100000);
  });
});
