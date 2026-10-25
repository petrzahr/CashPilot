// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FinanceProvider } from '../context/FinanceContext';
import { OverviewScreen } from '../components/overview/OverviewScreen';
import { formatCurrency } from '../services/currencyService';
import { getInitialData } from '../services/storageService';
import { SyncController } from '../services/syncController';
import { Account } from '../types/finance';

const cells = (row: Element | null) => [...row!.querySelectorAll('td')].slice(1).map(td => ({
  text: td.textContent,
  tone: td.className.match(/text-(emerald-600|red-600|slate-500|slate-900)/)?.[1],
}));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-14T12:00:00Z'));
  const data = getInitialData();
  data.settings.budgetStartDay = 15;
  const cash: Account = { id: 'cash', name: 'Regular account', type: 'checking', currency: 'CZK',
    initialBalanceInHaler: 1000000, initialBalanceDate: '2026-01-01', isUsableCash: true, isNetWorth: true,
    color: '', sortOrder: 0, status: 'active', createdAt: '2026-01-01', updatedAt: '2026-01-01' };
  const asset: Account = { ...cash, id: 'asset', name: 'Fund', type: 'investment', isUsableCash: false,
    initialBalanceInHaler: 29000000, currentMarketValueInHaler: 30500000, marketValueUpdatedAt: '2026-08-25' };
  data.accounts = [cash, asset];
  data.transactions = [{ id: 'income', title: 'Income', type: 'income', sourceAccountId: 'cash', date: '2026-08-20',
    amountInHaler: 100000, status: 'executed', sequence: 1, createdAt: '2026-08-20', updatedAt: '2026-08-20' }];
  data.marketValueSnapshots = [
    { id: '1', accountId: 'asset', date: '2026-08-10', marketValueInHaler: 30000000, createdAt: '2026-08-10' },
    { id: '2', accountId: 'asset', date: '2026-08-25', marketValueInHaler: 30500000, createdAt: '2026-08-25' },
  ];
  // Připojení (jsdom) spouští efekty relace: automatické provedení zapisuje, odpojení zastaví sync
  const session = { data, isReady: true, change: () => {}, stop: () => {}, sync: async () => {} } as unknown as SyncController;
  render(<FinanceProvider syncSession={session}><OverviewScreen onNavigateToBudget={vi.fn()} /></FinanceProvider>);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('renders the usable scope row of the current period', () => {
  fireEvent.click(screen.getByRole('button', { name: 'Použitelné peníze' }));
  const row = screen.getByRole('button', { name: 'Přejít do rozpočtu: Srpen 2026' }).closest('tr');
  expect(cells(row)).toEqual([
    { text: formatCurrency(1000000), tone: 'slate-500' },
    { text: `+${formatCurrency(100000)}`, tone: 'emerald-600' },
    { text: '0 Kč', tone: 'red-600' },
    { text: formatCurrency(0, { showPlus: true }), tone: 'slate-500' },
    { text: formatCurrency(100000, { showPlus: true }), tone: 'emerald-600' },
    { text: formatCurrency(1100000), tone: 'slate-900' },
  ]);
});

it('renders the valuation change of an investment account in the expanded period', () => {
  const toggle = screen.getByRole('button', { name: /^Srpen 2026\s*Zůstatek celkem/ });
  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  // Počáteční ocenění 300 000 + růst tržní hodnoty 5 000 = konečné ocenění 305 000
  // Název účtu je i v grafu Rozložení majetku; řádek se hledá v tabulce rozbaleného období
  const table = screen.getByText('Přírůstky').closest('table')!;
  expect(cells(within(table).getByText('Fund').closest('tr'))).toEqual([
    { text: formatCurrency(30000000), tone: 'slate-500' },
    { text: `+${formatCurrency(500000)}`, tone: 'emerald-600' },
    { text: '0 Kč', tone: 'red-600' },
    { text: formatCurrency(0, { showPlus: true }), tone: 'slate-500' },
    { text: formatCurrency(500000, { showPlus: true }), tone: 'emerald-600' },
    { text: formatCurrency(30500000), tone: 'slate-900' },
  ]);
});
