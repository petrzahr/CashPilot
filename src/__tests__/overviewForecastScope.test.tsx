import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OverviewScreen } from '../components/overview/OverviewScreen';
import { summarizePeriods } from '../services/financialEngine';
import { formatCurrency } from '../services/currencyService';
import { generatePeriodsSequence } from '../services/periodService';
import { getInitialData } from '../services/storageService';
import { getPresetRange } from '../services/periodRangePreference';
import { Account, Transaction } from '../types/finance';

const hooks = vi.hoisted(() => ({ values: [] as any[], index: 0, finance: {} as any }));
vi.mock('../context/FinanceContext', () => ({ useFinance: () => hooks.finance }));
vi.mock('react', async original => {
  const actual = await original<typeof import('react')>();
  return { ...actual,
    useMemo: (fn: () => unknown) => fn(),
    useEffect: () => {},
    useState: (initial: unknown) => {
      const index = hooks.index++;
      if (!(index in hooks.values)) hooks.values[index] = initial;
      return [hooks.values[index], (value: any) => {
        hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value;
      }];
    },
  };
});

/** HTML první tabulky (předpověď po obdobích) */
function forecastTable() {
  hooks.index = 0;
  const html = renderToStaticMarkup(OverviewScreen({ onNavigateToBudget: vi.fn() }) as React.ReactElement);
  return html.slice(0, html.indexOf('</table>'));
}

const account = (id: string, isUsableCash: boolean): Account => ({
  id, name: id, type: isUsableCash ? 'checking' : 'savings', currency: 'CZK', initialBalanceInHaler: 1000000,
  initialBalanceDate: '2026-01-01', isUsableCash, isNetWorth: true, status: 'active',
  color: '', sortOrder: 0, createdAt: '', updatedAt: '',
});

beforeEach(() => {
  hooks.values = [];
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-10T12:00:00Z'));
  const data = getInitialData();
  data.settings.budgetStartDay = 1;
  data.accounts = [account('cash', true), account('savings', false)];
  const tx = (id: string, type: Transaction['type'], amountInHaler: number, extra: Partial<Transaction> = {}): Transaction => ({
    id, title: id, type, amountInHaler, date: '2026-09-20', sequence: 1, sourceAccountId: 'cash', status: 'planned',
    createdAt: '', updatedAt: '', ...extra,
  });
  data.transactions = [
    tx('salary', 'income', 5000000),
    tx('rent', 'expense', 2000000),
    tx('saving', 'transfer', 1000000, { targetAccountId: 'savings' }),
    tx('savingsFee', 'expense', 10000, { sourceAccountId: 'savings' }),
  ];
  const periods = generatePeriodsSequence(2026, 9, 12, 1);
  const forecast = summarizePeriods(periods, { accounts: data.accounts, transactions: data.transactions }, { currentPeriodKey: '2026-09', today: '2026-09-10' });
  hooks.finance = { ...data, forecast, setSelectedPeriod: vi.fn(), periodRanges: { overview: getPresetRange('future:12') }, setPeriodRange: vi.fn() };
});
afterEach(() => { vi.useRealTimers(); });

it('sums income, expense and signed net transfers only from accounts in the usable scope', () => {
  // Stav pohledu je první useState v komponentě; výchozí je Celkový majetek
  hooks.values[0] = 'usable';
  const html = forecastTable();
  expect(html).toContain(`+${formatCurrency(5000000)}`);
  // Výdaj ze spořicího účtu do použitelných peněz nepatří
  expect(html).toContain(`−${formatCurrency(2000000)}`);
  expect(html).not.toContain(`−${formatCurrency(2010000)}`);
  // Převod na spoření použitelné peníze snižuje, proto se znaménkem minus
  expect(html).toContain(formatCurrency(-1000000, { showPlus: true }));
  // Řádek sedí: +50 000 − 20 000 − 10 000 = +20 000
  expect(html).toContain(formatCurrency(2000000, { showPlus: true }));
});

it('nets internal transfers to zero across all accounts by default', () => {
  // Výdaj i ze spořicího účtu dokazuje, že výchozí pohled je Celkový majetek
  const html = forecastTable();
  expect(html).toContain(`−${formatCurrency(2010000)}`);
  expect(html).toContain(formatCurrency(0, { showPlus: true }));
});
