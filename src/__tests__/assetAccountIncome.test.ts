import { describe, it, expect } from 'vitest';
import { getCurrentAssetValue } from '../services/financialEngine';
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

  it('ignores planned income', () => {
    expect(getCurrentAssetValue(pension, [tx({ status: 'planned' })], [], '2026-09-20')).toBe(100000);
  });
});
