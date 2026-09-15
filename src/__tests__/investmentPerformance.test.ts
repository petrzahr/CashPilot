import { describe, expect, it } from 'vitest';
import { Account, MarketValueSnapshot, Transaction } from '../types/finance';
import { calculatePeriodInvestmentChange as compare, getInvestedAmountAtValuation as capital } from '../services/investmentPerformanceService';
import { createBudgetPeriod } from '../services/periodService';

const account: Account = {
  id: 'investment', name: 'Investment', type: 'investment', currency: 'CZK',
  initialBalanceInHaler: 30000000, initialBalanceDate: '2026-07-01',
  isUsableCash: false, isNetWorth: true, color: '', sortOrder: 1, status: 'active',
  createdAt: '', updatedAt: '',
};
const snapshot = (date: string, market: number, invested: number, accountId = account.id): MarketValueSnapshot => ({
  id: date + accountId, date, accountId, marketValueInHaler: market * 100,
  effectiveInvestedAmountInHaler: invested * 100, createdAt: date,
});
const history = [snapshot('2026-08-20', 302000, 300000), snapshot('2026-09-20', 323000, 320000), snapshot('2026-10-20', 339000, 340000)];
const period = createBudgetPeriod(2026, 9, 15);
const today = '2026-12-01';

describe('investment change across financial periods', () => {
  it('excludes added capital for positive and negative changes', () => {
    expect(compare([account], history, period, 15, today)).toBe(100000);
    expect(compare([account], history, createBudgetPeriod(2026, 10, 15), 15, today)).toBe(-400000);
  });
  it('uses the latest date and then creation time, preserving intermediate records', () => {
    const records = [...history, { ...snapshot('2026-09-20', 324000, 320000), createdAt: '2026-09-20T12:00:00Z' }, snapshot('2026-09-16', 399000, 320000)];
    expect(compare([account], records, period, 15, today)).toBe(200000);
    expect(records).toHaveLength(5);
  });
  it('follows configured boundaries, including clamped start days and year rollover', () => {
    const records = [snapshot('2026-09-14', 302000, 300000), snapshot('2026-09-15', 303000, 300000)];
    expect(compare([account], records, period, 15, today)).toBe(100000);
    expect(compare([account], records, createBudgetPeriod(2026, 9, 1), 1, today)).toBeNull();
    expect(compare([account], [snapshot('2026-12-31', 302000, 300000), snapshot('2027-02-27', 303000, 300000)], createBudgetPeriod(2027, 1, 31), 31, '2027-03-01')).toBe(100000);
  });
  it('sums each included investment/pension account once despite different valuation dates', () => {
    const pension = { ...account, id: 'pension', type: 'pension' as const };
    const records = [...history, snapshot('2026-09-10', 10000, 10000, pension.id), snapshot('2026-10-10', 9500, 10000, pension.id)];
    const excluded = [{ ...account, id: 'excluded', isNetWorth: false }, { ...account, id: 'archived', status: 'archived' as const }];
    expect(compare([account, pension, ...excluded], records, period, 15, today)).toBe(50000);
    expect(compare([account, pension], history, period, 15, today)).toBeNull();
  });
  it('uses captured corrections, never the current account correction retroactively', () => {
    const records = [history[0], snapshot('2026-09-20', 323000, 321000)];
    expect(compare([{ ...account, investedAmountAdjustmentInHaler: 999999 }], records, period, 15, today)).toBe(0);
    expect(compare([account], [history[0], { ...records[1], effectiveInvestedAmountInHaler: undefined }], period, 15, today)).toBeNull();
  });
  it('does not carry missing valuations forward or fall back from incomplete latest valuations', () => {
    expect(compare([account], [history[0]], period, 15, today)).toBeNull();
    expect(compare([account], [history[1]], period, 15, today)).toBeNull();
    expect(compare([account], [...history, { ...snapshot('2026-09-21', 324000, 320000), effectiveInvestedAmountInHaler: undefined }], period, 15, today)).toBeNull();
    expect(compare([], [], period, 15, today)).toBeNull();
    expect(compare([account], history, period, 15, '2026-09-14')).toBeNull();
  });
  it('captures only executed net transfers through valuation date with the submitted correction', () => {
    const tx: Transaction = { id: 'tx', title: '', date: '2026-09-10', sequence: 1,
      type: 'transfer', sourceAccountId: 'cash', targetAccountId: account.id,
      amountInHaler: 1000000, actualAmountInHaler: 2000000, status: 'executed', createdAt: '', updatedAt: '' };
    const records = [tx, { ...tx, status: 'planned' as const }, { ...tx, status: 'cancelled' as const },
      { ...tx, date: '2026-10-01' }, { ...tx, date: '2026-06-30' },
      { ...tx, sourceAccountId: account.id, targetAccountId: 'cash', actualAmountInHaler: 500000 }];
    expect(capital({ ...account, investedAmountAdjustmentInHaler: -100000 }, records, '2026-09-20')).toBe(31400000);
  });
});
