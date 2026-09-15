import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { useFinance } from '../context/FinanceContext';
import { OverviewScreen } from '../components/overview/OverviewScreen';
import { calculateForecast } from '../services/financialEngine';
import { formatCurrency } from '../services/currencyService';
import { DEFAULT_SETTINGS } from '../services/demoData';
import { Account, BudgetPeriod, Transaction } from '../types/finance';

vi.mock('../context/FinanceContext', () => ({ useFinance: vi.fn() }));

const september: BudgetPeriod = {
  key: '2026-09', name: 'Září 2026', year: 2026, month: 9,
  startDate: '2026-09-15', endDate: '2026-10-14',
};
const october: BudgetPeriod = {
  key: '2026-10', name: 'Říjen 2026', year: 2026, month: 10,
  startDate: '2026-10-15', endDate: '2026-11-14',
};
const cash: Account = {
  id: 'cash', name: 'Cash', type: 'checking', currency: 'CZK',
  initialBalanceInHaler: 20970000, initialBalanceDate: '2026-09-01',
  isUsableCash: true, isNetWorth: true, color: '', sortOrder: 0, status: 'active',
  createdAt: '2026-09-01', updatedAt: '2026-09-01',
};

describe('Overview expected total wealth', () => {
  it.each([
    { expense: 0, excluded: false },
    { expense: 10000, excluded: false },
    { expense: 10000, excluded: true },
  ])('uses the lower forecast closing wealth: %j', ({ expense, excluded }) => {
    const assets: Account[] = [351927, 185401, 132609, 73913].map((value, index) => ({
      ...cash, id: `asset-${index}`, name: `Asset ${index}`,
      type: index < 2 ? 'investment' : 'pension', isUsableCash: false,
      isNetWorth: !(excluded && index === 0),
      // Both gains and losses must contribute market value, not principal.
      initialBalanceInHaler: 20000000, currentMarketValueInHaler: value * 100,
      marketValueUpdatedAt: '2026-09-20',
    }));
    const transactions: Transaction[] = [
      { id: 'income', type: 'income', amountInHaler: 5000000 },
      { id: 'expense', type: 'expense', amountInHaler: expense * 100 },
    ].map(tx => ({ ...tx, type: tx.type as Transaction['type'], title: tx.id,
      sourceAccountId: cash.id, date: '2026-09-25', sequence: 1,
      status: 'planned', createdAt: '2026-09-20', updatedAt: '2026-09-20' }));
    const accounts = [cash, ...assets];
    const forecast = calculateForecast([september, october], accounts, transactions,
      [], [], [], DEFAULT_SETTINGS, [], september.key, '2026-09-21');
    const expected = (1003550 - expense - (excluded ? 351927 : 0)) * 100;
    expect(forecast.usableCashNowInHaler).toBe(20970000);
    expect(forecast.expectedClosingCurrentPeriodInHaler).toBe((259700 - expense) * 100);
    expect(forecast.forecastPeriods![0].netWorthClosingInHaler).toBe(expected);
    for (const period of forecast.forecastPeriods!) {
      for (const asset of assets) {
        expect(period.accountBalances[asset.id].closingBalanceInHaler).toBe(asset.currentMarketValueInHaler);
      }
    }
    vi.mocked(useFinance).mockReturnValue({ forecast, accounts, settings: DEFAULT_SETTINGS,
      setSelectedPeriod: vi.fn() } as unknown as ReturnType<typeof useFinance>);
    const html = renderToStaticMarkup(<OverviewScreen onNavigateToBudget={vi.fn()} />);
    const card = html.split('Celkový majetek</span>')[1].split('Včetně investic')[0];
    expect(card).toContain(formatCurrency(expected));
    expect(card).not.toContain(formatCurrency(forecast.netWorthNowInHaler));
  });
});
