import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { useFinance } from '../context/FinanceContext';
import { OverviewScreen } from '../components/overview/OverviewScreen';
import { calculateForecast } from '../services/financialEngine';
import { createBudgetPeriod } from '../services/periodService';
import { formatCurrency } from '../services/currencyService';
import { DEFAULT_SETTINGS } from '../services/demoData';
import { Account, Transaction } from '../types/finance';

vi.mock('../context/FinanceContext', () => ({ useFinance: vi.fn() }));

const cases = [
  { name: 'valuation during period', values: [['2026-08-10', 300000], ['2026-08-25', 305000]], opening: 300000, closing: 305000 },
  { name: 'multiple valuations and a future update', values: [['2026-08-10', 300000], ['2026-08-25', 305000], ['2026-09-10', 310000], ['2026-09-15', 320000]], opening: 300000, closing: 310000 },
  { name: 'no update during period', values: [['2026-08-10', 300000]], opening: 300000, closing: 300000 },
  { name: 'inclusive end and exclusive opening boundary', values: [['2026-08-14', 300000], ['2026-08-15', 305000], ['2026-09-14', 310000], ['2026-09-15', 320000]], opening: 300000, closing: 310000 },
  { name: 'future valuation with no earlier snapshot', values: [['2026-09-15', 320000]], opening: 290000, closing: 290000 },
] as const;

describe.each(['investment', 'pension'] as const)('Overview %s account history', type => {
  it.each(cases)('$name', ({ values, opening, closing }) => {
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
    const html = renderToStaticMarkup(<OverviewScreen onNavigateToBudget={vi.fn()} />);
    const cells = (name: string) => {
      const row = html.split(`<span>${name}</span>`)[1].split('</tr>')[0];
      return [...row.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map(match => match[1]);
    };
    // Valuation change (gain/loss) must show up as a movement, otherwise opening + in - out != closing.
    const valuationChange = closing - opening;
    expect(cells(asset.name)).toEqual([
      formatCurrency(opening * 100),
      valuationChange > 0 ? `+${formatCurrency(valuationChange * 100)}` : '0 Kč',
      valuationChange < 0 ? `−${formatCurrency(Math.abs(valuationChange) * 100)}` : '0 Kč',
      formatCurrency(closing * 100),
    ]);
    expect(cells(cash.name)).toEqual([formatCurrency(1000000), `+${formatCurrency(100000)}`, '0 Kč', formatCurrency(1100000)]);
    expect(html).toContain(`Zůstatek celkem: ${formatCurrency(closing * 100 + 1100000)}`);
    expect(JSON.stringify({ forecast, accounts, transactions, marketValueSnapshots })).toBe(before);
  });
});
