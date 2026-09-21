import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { useFinance } from '../context/FinanceContext';
import { OverviewScreen } from '../components/overview/OverviewScreen';
import { AccountsScreen } from '../components/accounts/AccountsScreen';
import { calculateForecast } from '../services/financialEngine';
import { getAccountPeriodSummary } from '../services/accountSummaryService';
import { createBudgetPeriod } from '../services/periodService';
import { formatCurrency } from '../services/currencyService';
import { DEFAULT_SETTINGS } from '../services/demoData';
import { Account, Transaction } from '../types/finance';

vi.mock('../context/FinanceContext', () => ({ useFinance: vi.fn() }));

// OverviewScreen no longer auto-expands any period's account breakdown by
// default (it used to auto-expand the current period). This test needs that
// breakdown table rendered to check per-account computed values, and the
// project has no jsdom/testing-library set up to click the accordion open,
// so when explicitly enabled we force the 6th useState call
// (expandedPeriodKey, in source order) to the desired key instead of its
// normal `null` default. Disabled by default so it never touches any other
// component's hooks (e.g. AccountsScreen, rendered elsewhere in this file).
const expandOverride = vi.hoisted(() => ({ enabled: false, key: null as string | null }));
let useStateCallIndex = 0;
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      if (!expandOverride.enabled) return actual.useState(initial);
      useStateCallIndex += 1;
      return actual.useState(useStateCallIndex === 6 ? expandOverride.key : initial);
    },
  };
});

function renderOverviewWithExpandedPeriod(periodKey: string, props: React.ComponentProps<typeof OverviewScreen>) {
  expandOverride.enabled = true;
  expandOverride.key = periodKey;
  useStateCallIndex = 0;
  try {
    return renderToStaticMarkup(<OverviewScreen {...props} />);
  } finally {
    expandOverride.enabled = false;
  }
}

const cases = [
  { name: 'valuation during period', values: [['2026-08-10', 300000], ['2026-08-25', 305000]], opening: 300000, closing: 305000 },
  { name: 'multiple valuations and a future update', values: [['2026-08-10', 300000], ['2026-08-25', 305000], ['2026-09-10', 310000], ['2026-09-15', 320000]], opening: 300000, closing: 310000 },
  { name: 'no update during period', values: [['2026-08-10', 300000]], opening: 300000, closing: 300000 },
  { name: 'inclusive end and exclusive opening boundary', values: [['2026-08-14', 300000], ['2026-08-15', 305000], ['2026-09-14', 310000], ['2026-09-15', 320000]], opening: 300000, closing: 310000 },
  { name: 'future valuation with no earlier snapshot', values: [['2026-09-15', 320000]], opening: 290000, closing: 290000 },
] as const;

describe.each(['investment', 'pension'] as const)('Overview %s forecast', type => {
  it.each(cases)('$name', ({ values, closing }) => {
    const period = createBudgetPeriod(2026, 8, 15);
    const last = values[values.length - 1];
    const asset: Account = {
      id: 'asset', name: 'Historical asset', type, currency: 'CZK',
      initialBalanceInHaler: 29000000, initialBalanceDate: '2026-01-01',
      currentMarketValueInHaler: last[1] * 100, marketValueUpdatedAt: last[0],
      isUsableCash: false, isNetWorth: true, color: '', sortOrder: 0, status: 'active',
      createdAt: '2026-01-01', updatedAt: last[0],
    };
    const cash: Account = { ...asset, id: 'cash', name: 'Regular account', type: 'checking',
      initialBalanceInHaler: 1000000, currentMarketValueInHaler: undefined, isUsableCash: true };
    const transactions: Transaction[] = [{ id: 'income', title: 'Income', type: 'income',
      sourceAccountId: 'cash', date: '2026-08-20', amountInHaler: 100000, status: 'executed',
      sequence: 1, createdAt: '2026-08-20', updatedAt: '2026-08-20' }];
    const marketValueSnapshots = values.map(([date, value], index) => ({
      id: String(index), accountId: asset.id, date, marketValueInHaler: value * 100, createdAt: date,
    }));
    const accounts = [asset, cash];
    const settings = { ...DEFAULT_SETTINGS, budgetStartDay: 15 };
    const forecast = calculateForecast([period, createBudgetPeriod(2026, 9, 15)], accounts, transactions, [], [], [], settings,
      marketValueSnapshots, period.key, '2026-09-14');
    const before = JSON.stringify({ forecast, accounts, transactions, marketValueSnapshots });
    vi.mocked(useFinance).mockReturnValue({ forecast, accounts, transactions, settings,
      selectedPeriod: period, marketValueSnapshots, setSelectedPeriod: vi.fn(),
    } as unknown as ReturnType<typeof useFinance>);
    const html = renderOverviewWithExpandedPeriod(period.key, { onNavigateToBudget: vi.fn() });
    const cells = (name: string) => {
      const row = html.split(`<span>${name}</span>`)[1].split('</tr>')[0];
      return [...row.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map(match => match[1]);
    };
    // With no remaining transfers, the forecast stays at the current valuation.
    const valuationChange = 0;
    expect(cells(asset.name)).toEqual([
      formatCurrency(closing * 100),
      valuationChange > 0 ? `+${formatCurrency(valuationChange * 100)}` : '0 Kč',
      valuationChange < 0 ? `−${formatCurrency(Math.abs(valuationChange) * 100)}` : '0 Kč',
      '0 Kč',
      '0 Kč',
      formatCurrency(closing * 100),
    ]);
    expect(cells(cash.name)).toEqual([formatCurrency(1000000), `+${formatCurrency(100000)}`, '0 Kč', '0 Kč', formatCurrency(100000, { showPlus: true }), formatCurrency(1100000)]);
    expect(html).toContain(`Zůstatek celkem: ${formatCurrency(closing * 100 + 1100000)}`);
    expect(JSON.stringify({ forecast, accounts, transactions, marketValueSnapshots })).toBe(before);
  });
});

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
  const forecast = calculateForecast([period], accounts, [transfer], [], [], [],
    DEFAULT_SETTINGS, [], period.key, '2026-09-16');
  const original = JSON.stringify(forecast);
  const summary = getAccountPeriodSummary(forecast, period.key)!;
  expect(summary).toBe(forecast.forecastPeriods![0]);
  expect(summary.netWorthClosingInHaler).toBe(130934800);
  expect(summary.accountBalances.asset.closingBalanceInHaler).toBe(83250000);
  expect(summary.accountBalances.cash.closingBalanceInHaler).toBe(47684800);
  expect(Object.values(summary.accountBalances).reduce((sum, a) => sum + a.closingBalanceInHaler, 0))
    .toBe(summary.closingBalanceInHaler);
  vi.mocked(useFinance).mockReturnValue({ forecast, accounts, transactions: [transfer],
    corrections: [], marketValueSnapshots: [], settings: DEFAULT_SETTINGS,
    selectedPeriod: period, currentPeriod: period, setSelectedPeriod: vi.fn(),
  } as unknown as ReturnType<typeof useFinance>);
  const html = renderToStaticMarkup(<AccountsScreen />);
  expect(html).toContain(formatCurrency(83250000));
  expect(html).toContain(formatCurrency(47684800));
  expect(renderToStaticMarkup(<OverviewScreen onNavigateToBudget={vi.fn()} />))
    .toContain(`Zůstatek celkem: ${formatCurrency(130934800)}`);

  for (const excluded of [{ ...transfer, status: 'cancelled' as const }, { ...transfer, date: '2026-10-15' }]) {
    const next = calculateForecast([period], accounts, [excluded], [], [], [], DEFAULT_SETTINGS, [], period.key, '2026-09-16');
    expect(getAccountPeriodSummary(next, period.key)?.accountBalances.asset.closingBalanceInHaler).toBe(82600000);
  }
  expect(JSON.stringify(forecast)).toBe(original);
});
