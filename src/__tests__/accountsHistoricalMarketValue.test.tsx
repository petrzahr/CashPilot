import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { FinanceProvider, useFinance } from '../context/FinanceContext';
import { AccountsScreen } from '../components/accounts/AccountsScreen';
import { Account } from '../types/finance';
import { AppData, getInitialData } from '../services/storageService';
import { SyncController } from '../services/syncController';
import { calculateForecast } from '../services/financialEngine';
import { computeAssetAccountBalanceAtDate } from '../services/analyticsEngine';
import { getPeriodForDate } from '../services/periodService';
import { formatCurrency } from '../services/currencyService';

const bridge = vi.hoisted(() => ({ finance: null as ReturnType<typeof useFinance> | null }));
vi.mock('../context/FinanceContext', async importOriginal => {
  const actual = await importOriginal<typeof import('../context/FinanceContext')>();
  return { ...actual, useFinance: () => bridge.finance ?? actual.useFinance() };
});

afterEach(() => { bridge.finance = null; vi.useRealTimers(); });

it.each(['investment', 'pension'] as const)('%s cards retain historical values after later updates', type => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-15T10:00:00Z'));
  const account: Account = {
    id: 'asset', name: 'Asset', type, currency: 'CZK',
    initialBalanceInHaler: 10000000, initialBalanceDate: '2026-08-01',
    currentMarketValueInHaler: 10000000, investedAmountAdjustmentInHaler: 100000,
    isUsableCash: false, isNetWorth: true, color: '', sortOrder: 0, status: 'active',
    createdAt: '2026-09-14T10:00:00Z', updatedAt: '2026-09-14T10:00:00Z',
  };
  const regular: Account = {
    ...account, id: 'regular', name: 'Regular', type: 'checking',
    initialBalanceInHaler: 2300000, currentMarketValueInHaler: undefined,
  };
  let data: AppData = { ...getInitialData(), accounts: [account, regular] };
  const periods = ['2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01']
    .map(date => getPeriodForDate(date, 1));
  const capture = () => {
    bridge.finance = null;
    const session = { data, isReady: true, change: (action: React.SetStateAction<AppData>) => {
      data = typeof action === 'function' ? action(data) : action;
    } } as unknown as SyncController;
    function Capture() { bridge.finance = useFinance(); return null; }
    renderToStaticMarkup(<FinanceProvider syncSession={session}><Capture /></FinanceProvider>);
  };
  const check = (index: number, value: number) => {
    capture();
    const before = JSON.stringify(data);
    bridge.finance = {
      ...bridge.finance!, selectedPeriod: periods[index],
      forecast: calculateForecast(periods, data.accounts, [], [], [], [], undefined, data.marketValueSnapshots),
    };
    const html = renderToStaticMarkup(<AccountsScreen />);
    const balances = [...html.matchAll(/class="text-xl font-extrabold truncate [^"]*">([^<]+)<\/div>/g)]
      .map(match => match[1]);
    expect(balances).toEqual([formatCurrency(value), formatCurrency(index === 0 ? 0 : 2300000)]);
    expect(computeAssetAccountBalanceAtDate(data.accounts[0], periods[index].endDate, [], data.marketValueSnapshots)).toBe(value);
    if (index === 1) {
      expect(html).toContain('Historický vložený kapitál není znám');
    } else if (index > 1) {
      expect(html).toContain(`Vloženo: ${formatCurrency(10100000)}`);
      expect(html).toContain(`${((value - 10100000) / 10100000 * 100).toFixed(1)} %)`);
    }
    expect(JSON.stringify(data)).toBe(before);
  };

  check(0, 0);
  check(1, 10000000);
  check(2, 10000000);
  bridge.finance!.updateMarketValue('asset', 12000000, '2026-09-15');
  check(0, 0);
  check(1, 10000000);
  check(2, 12000000);
  check(1, 10000000);
  const septemberSnapshot = { ...data.marketValueSnapshots[0] };
  vi.setSystemTime(new Date('2026-10-15T10:00:00Z'));
  capture();
  bridge.finance!.updateMarketValue('asset', 15000000, '2026-10-15');
  check(1, 10000000);
  check(2, 12000000);
  check(3, 15000000);
  expect(data.marketValueSnapshots[0]).toEqual(septemberSnapshot);
});
