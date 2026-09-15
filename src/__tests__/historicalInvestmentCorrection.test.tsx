import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { FinanceProvider, useFinance } from '../context/FinanceContext';
import { Account, Transaction } from '../types/finance';
import { AppData, getInitialData } from '../services/storageService';
import { SyncController } from '../services/syncController';
import { calculateForecast } from '../services/financialEngine';
import { calculatePeriodInvestmentChange, getHistoricalInvestedAmount, getHistoricalInvestmentCorrection } from '../services/investmentPerformanceService';
import { createBudgetPeriod } from '../services/periodService';

const account: Account = {
  id: 'asset', name: 'Investment', type: 'investment', currency: 'CZK',
  initialBalanceInHaler: 31000000, initialBalanceDate: '2026-08-01',
  isUsableCash: false, isNetWorth: true, color: '', sortOrder: 1, status: 'active',
  createdAt: '2026-08-01', updatedAt: '2026-08-01',
};

function workflow(initial: Partial<AppData> = {}) {
  let data: AppData = { ...getInitialData(), accounts: [account], ...initial };
  return {
    get data() { return data; },
    update(date: string, value: number, correction?: number) {
      let finance!: ReturnType<typeof useFinance>;
      const session = { data, isReady: true, change: (action: React.SetStateAction<AppData>) => {
        data = typeof action === 'function' ? action(data) : action;
      } } as unknown as SyncController;
      function Capture() { finance = useFinance(); return null; }
      renderToStaticMarkup(<FinanceProvider syncSession={session}><Capture /></FinanceProvider>);
      finance.updateMarketValue(account.id, value, date, undefined, correction);
    },
  };
}

afterEach(() => vi.useRealTimers());

it('records temporal corrections, carries them forward, and preserves earlier states on backdated writes', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-15T12:00:00Z'));
  const flow = workflow();
  flow.update('2026-09-14', 31000000);
  const original = { ...flow.data.marketValueSnapshots[0] };
  flow.update('2026-09-15', 35192700, -329200);
  flow.update('2026-10-15', 35192700);
  flow.update('2026-11-15', 35192700, -400000);
  expect(flow.data.marketValueSnapshots.map(s => s.investedAmountAdjustmentInHaler)).toEqual([0, -329200, -329200, -400000]);
  expect(flow.data.marketValueSnapshots[0]).toEqual(original);
  expect(flow.data.marketValueSnapshots[1].effectiveInvestedAmountInHaler).toBe(30670800);
  expect(getHistoricalInvestedAmount(flow.data.accounts[0], flow.data.marketValueSnapshots, [], '2026-08-31', 31000000)).toBe(31000000);
  const period = createBudgetPeriod(2026, 9, 15);
  expect(calculatePeriodInvestmentChange(flow.data.accounts, flow.data.marketValueSnapshots, period, 15, '2026-11-15')).toBe(4521900);
  expect(calculatePeriodInvestmentChange(flow.data.accounts, flow.data.marketValueSnapshots, createBudgetPeriod(2026, 10, 15), 15, '2026-11-15')).toBe(0);

  // An earlier explicit change must not replace the later account state.
  flow.update('2026-09-20', 35192700, -100000);
  expect(flow.data.accounts[0].investedAmountAdjustmentInHaler).toBe(-400000);
  flow.update('2026-09-21', 35192700);
  expect(flow.data.marketValueSnapshots[flow.data.marketValueSnapshots.length - 1].investedAmountAdjustmentInHaler).toBe(-100000);
  expect(getHistoricalInvestmentCorrection(flow.data.accounts[0], flow.data.marketValueSnapshots, '2026-10-20')).toBe(-329200);

  // Two legitimate submissions at the same clock time each write one ordered snapshot.
  const count = flow.data.marketValueSnapshots.length;
  flow.update('2026-11-15', 36000000, 0);
  flow.update('2026-11-15', 37000000, -200000);
  expect(flow.data.marketValueSnapshots).toHaveLength(count + 2);
  const result = calculateForecast([createBudgetPeriod(2026, 11, 15)], flow.data.accounts, [], [], [], [], undefined, flow.data.marketValueSnapshots, undefined, '2026-11-15');
  const balance = result.periods[0].accountBalances[account.id];
  expect(balance.marketValueInHaler).toBe(37000000);
  expect(balance.investedPrincipalInHaler).toBe(30800000);
  expect(balance.unrealizedGainLossInHaler).toBe(6200000);
});

it('preserves unknown legacy history without backfilling the current correction', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-15T12:00:00Z'));
  const legacy = { id: 'legacy', accountId: account.id, date: '2026-08-14', marketValueInHaler: 31000000, createdAt: '2026-08-14' };
  const flow = workflow({ accounts: [{ ...account, investedAmountAdjustmentInHaler: -329200 }], marketValueSnapshots: [legacy] });
  flow.update('2026-09-15', 35192700);
  expect(flow.data.marketValueSnapshots[0]).toEqual(legacy);
  expect(getHistoricalInvestedAmount(flow.data.accounts[0], flow.data.marketValueSnapshots, [], '2026-08-31', 31000000)).toBeUndefined();
  expect(calculatePeriodInvestmentChange(flow.data.accounts, flow.data.marketValueSnapshots, createBudgetPeriod(2026, 9, 15), 15, '2026-09-15')).toBeNull();
  flow.update('2026-08-20', 31000000);
  expect(flow.data.marketValueSnapshots[flow.data.marketValueSnapshots.length - 1].effectiveInvestedAmountInHaler).toBeUndefined();
  expect(flow.data.accounts[0].investedAmountAdjustmentInHaler).toBe(-329200);
});

it('keeps contributions and withdrawals out of performance when a forecast starts after the initial state', () => {
  const incoming: Transaction = { id: 'in', title: '', type: 'transfer', status: 'executed', sourceAccountId: 'cash', targetAccountId: account.id,
    date: '2026-09-20', sequence: 1, amountInHaler: 2000000, createdAt: '', updatedAt: '' };
  const outgoing: Transaction = { ...incoming, id: 'out', sourceAccountId: account.id, targetAccountId: 'cash', date: '2026-10-01', amountInHaler: 500000 };
  const snapshots = [{ id: 'value', accountId: account.id, date: '2026-09-14', createdAt: '2026-09-14', marketValueInHaler: 35192700,
    baseInvestedAmountInHaler: 31000000, investedAmountAdjustmentInHaler: -329200, effectiveInvestedAmountInHaler: 30670800 }];
  const transactions = [incoming, outgoing];
  const periods = [createBudgetPeriod(2026, 9, 15), createBudgetPeriod(2026, 10, 15)];
  const result = calculateForecast(periods, [account], transactions, [], [], [], undefined, snapshots, undefined, '2026-11-15');
  for (const period of result.periods) {
    expect(period.accountBalances[account.id].investedPrincipalInHaler).toBe(32170800);
    expect(period.accountBalances[account.id].unrealizedGainLossInHaler).toBe(4521900);
  }
  expect(calculatePeriodInvestmentChange([account], snapshots, periods[1], 15, '2026-11-15')).toBe(0);
});
