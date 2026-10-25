import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FinanceProvider, useFinance } from '../context/FinanceContext';
import { OverviewScreen } from '../components/overview/OverviewScreen';
import { AccountsScreen } from '../components/accounts/AccountsScreen';
import { summarizePeriods } from '../services/financialEngine';
import { createBudgetPeriod } from '../services/periodService';
import { formatCurrency } from '../services/currencyService';
import { getInitialData } from '../services/storageService';
import { SyncController } from '../services/syncController';
import { Account, Transaction } from '../types/finance';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-16T12:00:00Z'));
});
afterEach(() => vi.useRealTimers());

it('uses the same asset totals for budget and forecast summaries as the account breakdown', () => {
  const period = createBudgetPeriod(2026, 9, 15);
  const cash: Account = { id: 'cash', name: 'Cash', type: 'checking', currency: 'CZK',
    initialBalanceInHaler: 48334800, initialBalanceDate: '2026-01-01', isUsableCash: true,
    isNetWorth: true, color: '', sortOrder: 0, status: 'active', createdAt: '', updatedAt: '' };
  const asset: Account = { ...cash, id: 'asset', type: 'investment', isUsableCash: false,
    initialBalanceInHaler: 82600000 };
  const accounts = [cash, asset];
  const transfer: Transaction = { id: 'transfer', title: 'Investment', type: 'transfer',
    sourceAccountId: cash.id, targetAccountId: asset.id, date: '2026-09-25', sequence: 1,
    amountInHaler: 650000, status: 'planned', createdAt: '', updatedAt: '' };
  const forecast = summarizePeriods(
    [period],
    { accounts, transactions: [transfer] },
    { currentPeriodKey: period.key, today: '2026-09-16' }
  );
  const summary = forecast.getPeriod(period.key)!.projected;
  expect(summary).toBe(forecast.forecastPeriods![0]);
  expect(summary.netWorthClosingInHaler).toBe(130934800);
  expect(summary.accountBalances.asset.closingBalanceInHaler).toBe(83250000);
  expect(summary.accountBalances.cash.closingBalanceInHaler).toBe(47684800);
  expect(Object.values(summary.accountBalances).reduce((sum, a) => sum + a.closingBalanceInHaler, 0))
    .toBe(summary.closingBalanceInHaler);

  // Obě obrazovky přes skutečný provider ukazují stejné součty jako souhrn období
  const data = getInitialData();
  data.settings.budgetStartDay = 15;
  data.accounts = accounts;
  data.transactions = [transfer];
  let finance!: ReturnType<typeof useFinance>;
  function Screens() {
    finance = useFinance();
    return <><AccountsScreen /><OverviewScreen onNavigateToBudget={vi.fn()} /></>;
  }
  const session = { data, isReady: true } as SyncController;
  const html = renderToStaticMarkup(<FinanceProvider syncSession={session}><Screens /></FinanceProvider>);
  expect(finance.currentPeriod.key).toBe(period.key);
  expect(html).toContain(formatCurrency(83250000));
  expect(html).toContain(formatCurrency(47684800));
  expect(html).toContain(`Zůstatek celkem: ${formatCurrency(130934800)}`);

  for (const excluded of [{ ...transfer, status: 'cancelled' as const }, { ...transfer, date: '2026-10-15' }]) {
    const next = summarizePeriods([period], { accounts, transactions: [excluded] }, { currentPeriodKey: period.key, today: '2026-09-16' });
    expect(next.getPeriod(period.key)?.projected.accountBalances.asset.closingBalanceInHaler).toBe(82600000);
  }
});
