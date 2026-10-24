import { describe, expect, it } from 'vitest';
import { Account, InvestmentFee, MarketValueSnapshot, Transaction } from '../types/finance';
import {
  calculatePeriodInvestmentChange, getAccountFees, getFeesUpToDate, getFeesUpToPeriod,
  getInvestedAmountAtValuation as capital,
} from '../services/investmentPerformanceService';
import { summarizePeriods } from '../services/financialEngine';
import { createBudgetPeriod } from '../services/periodService';

const account: Account = {
  id: 'investment', name: 'Investment', type: 'investment', currency: 'CZK',
  initialBalanceInHaler: 30000000, initialBalanceDate: '2026-07-01',
  isUsableCash: false, isNetWorth: true, color: '', sortOrder: 1, status: 'active',
  createdAt: '', updatedAt: '',
};
const snapshot = (date: string, market: number, accountId = account.id): MarketValueSnapshot => ({
  id: date + accountId, date, accountId, marketValueInHaler: market * 100, createdAt: date,
});
const deposit = (date: string, amount: number, accountId = account.id): Transaction => ({
  id: 'tx' + date + accountId, title: '', date, sequence: 1, type: 'transfer', sourceAccountId: 'cash',
  targetAccountId: accountId, amountInHaler: amount * 100, status: 'executed', createdAt: '', updatedAt: '',
});
const fee = (periodKey: string, amount: number, extra: Partial<InvestmentFee> = {}): InvestmentFee => ({
  id: 'fee' + periodKey + (extra.updatedAt ?? ''), accountId: account.id, periodKey, amountInHaler: amount * 100,
  createdAt: '2026-01-01', ...extra,
});
// Vloženo: 300 000 → 320 000 (20. 9.) → 340 000 (20. 10.)
const txs = [deposit('2026-09-20', 20000), deposit('2026-10-20', 20000)];
const history = [snapshot('2026-08-20', 302000), snapshot('2026-09-20', 323000), snapshot('2026-10-20', 339000)];
const period = createBudgetPeriod(2026, 9, 15);
const today = '2026-12-01';
const compare = (accounts: Account[], records: MarketValueSnapshot[], p = period, startDay = 15, now = today,
  transactions = txs) => calculatePeriodInvestmentChange(accounts, records, p, startDay, now, transactions);

describe('investment change across financial periods', () => {
  it('excludes added capital for positive and negative changes', () => {
    expect(compare([account], history)).toBe(100000);
    expect(compare([account], history, createBudgetPeriod(2026, 10, 15))).toBe(-400000);
  });
  it('uses the latest date and then creation time, preserving intermediate records', () => {
    const records = [...history, { ...snapshot('2026-09-20', 324000), id: 'later', createdAt: '2026-09-20T12:00:00Z' }, snapshot('2026-09-16', 399000)];
    expect(compare([account], records)).toBe(200000);
    expect(records).toHaveLength(5);
  });
  it('follows configured boundaries, including clamped start days and year rollover', () => {
    const records = [snapshot('2026-09-14', 302000), snapshot('2026-09-15', 303000)];
    expect(compare([account], records, period, 15, today, [])).toBe(100000);
    expect(compare([account], records, createBudgetPeriod(2026, 9, 1), 1, today, [])).toBeNull();
    expect(compare([account], [snapshot('2026-12-31', 302000), snapshot('2027-02-27', 303000)],
      createBudgetPeriod(2027, 1, 31), 31, '2027-03-01', [])).toBe(100000);
  });
  it('sums each included investment/pension account once despite different valuation dates', () => {
    const pension = { ...account, id: 'pension', type: 'pension' as const };
    const records = [...history, snapshot('2026-09-10', 10000, pension.id), snapshot('2026-10-10', 9500, pension.id)];
    const excluded = [{ ...account, id: 'excluded', isNetWorth: false }, { ...account, id: 'archived', status: 'archived' as const }];
    expect(compare([account, pension, ...excluded], records)).toBe(50000);
    expect(compare([account, pension], history)).toBe(100000);
  });
  it('carries the valuation and capital through one or several periods without updates', () => {
    expect(compare([account], [history[0]])).toBe(0);
    expect(compare([account], [history[0]], createBudgetPeriod(2026, 11, 15))).toBe(0);
    expect(compare([account], [history[0], history[2]], createBudgetPeriod(2026, 10, 15))).toBe(-300000);
  });
  it('never leaks later valuations across the period boundary or beyond today', () => {
    const records = [snapshot('2026-08-10', 302000), snapshot('2026-10-05', 323000)];
    expect(compare([account], records, createBudgetPeriod(2026, 9, 1), 1)).toBe(0);
    expect(compare([account], records, period, 15, '2026-09-30')).toBe(0);
    expect(compare([account], records)).toBe(100000);
  });
  it('requires a valuation at both period ends', () => {
    expect(compare([account], [history[1]])).toBeNull();
    expect(compare([], [])).toBeNull();
    expect(compare([account], history, period, 15, '2026-09-14')).toBeNull();
  });
  it('is measured after fees: market value change minus contributions, reconciling with net worth', () => {
    // Poplatky nevstupují; obchodník je už strhl z tržní hodnoty.
    expect(calculatePeriodInvestmentChange([account], history, period, 15, today, txs)).toBe(100000);
  });
  it('captures only executed net transfers through valuation date', () => {
    const tx: Transaction = { id: 'tx', title: '', date: '2026-09-10', sequence: 1,
      type: 'transfer', sourceAccountId: 'cash', targetAccountId: account.id,
      amountInHaler: 1000000, actualAmountInHaler: 2000000, status: 'executed', createdAt: '', updatedAt: '' };
    const records = [tx, { ...tx, status: 'planned' as const }, { ...tx, status: 'cancelled' as const },
      { ...tx, date: '2026-10-01' }, { ...tx, date: '2026-06-30' },
      { ...tx, sourceAccountId: account.id, targetAccountId: 'cash', actualAmountInHaler: 500000 }];
    expect(capital(account, records, '2026-09-20')).toBe(31500000);
  });
});

describe('monthly broker fees', () => {
  it('keeps one fee per period, preferring the most recently updated record', () => {
    const fees = [fee('2026-09', 100, { updatedAt: '2026-09-20' }), fee('2026-09', 300, { updatedAt: '2026-09-25' }),
      fee('2026-08', 200), { ...fee('2026-08', 999), accountId: 'other' }];
    expect(getAccountFees(fees, account.id).map(f => f.amountInHaler)).toEqual([20000, 30000]);
    expect(getFeesUpToPeriod(fees, account.id, '2026-08')).toBe(20000);
    expect(getFeesUpToPeriod(fees, account.id, '2026-12')).toBe(50000);
  });
  it('maps a date to its budget period using the configured start day', () => {
    const fees = [fee('2026-09', 100)];
    expect(getFeesUpToDate(fees, account.id, '2026-09-14', 15)).toBe(0);
    expect(getFeesUpToDate(fees, account.id, '2026-09-15', 15)).toBe(10000);
    expect(getFeesUpToDate(fees, account.id, '2026-10-14', 15)).toBe(10000);
  });
  it('reports contributions, cumulative fees and return in the forecast', () => {
    const periods = [createBudgetPeriod(2026, 9, 15), createBudgetPeriod(2026, 10, 15)];
    const result = summarizePeriods(
      periods,
      { accounts: [account], marketValueSnapshots: [snapshot('2026-09-20', 305000)], investmentFees: [fee('2026-09', 500), fee('2026-10', 700)] },
      { today: '2026-11-20' }
    );
    expect(result.periods.map(p => p.accountBalances[account.id])).toEqual([
      expect.objectContaining({ contributedPrincipalInHaler: 30000000, feesInHaler: 50000, investedPrincipalInHaler: 29950000, unrealizedGainLossInHaler: 550000 }),
      expect.objectContaining({ contributedPrincipalInHaler: 30000000, feesInHaler: 120000, investedPrincipalInHaler: 29880000, unrealizedGainLossInHaler: 620000 }),
    ]);
  });
});
