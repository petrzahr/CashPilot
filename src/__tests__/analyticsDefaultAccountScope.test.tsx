import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AnalyticsScreen } from '../components/analytics/AnalyticsScreen';
import { summarizePeriods } from '../services/financialEngine';
import { formatCurrency } from '../services/currencyService';
import { generatePeriodsSequence } from '../services/periodService';
import { getInitialData } from '../services/storageService';
import { getPresetRange } from '../services/periodRangePreference';
import { Account, Transaction } from '../types/finance';

const hooks = vi.hoisted(() => ({ finance: {} as any }));
vi.mock('../context/FinanceContext', () => ({ useFinance: () => hooks.finance }));

const account = (id: string, isDefault: boolean): Account => ({
  id, name: id === 'main' ? 'Hlavní účet' : 'Kreditka', type: 'checking', currency: 'CZK', initialBalanceInHaler: 1000000,
  initialBalanceDate: '2026-01-01', isUsableCash: true, isNetWorth: true, isDefault, status: 'active',
  color: '#1d4f91', sortOrder: 0, createdAt: '', updatedAt: '',
});

const tx = (id: string, title: string, sourceAccountId: string, amountInHaler: number): Transaction => ({
  id, title, type: 'expense', amountInHaler, date: '2026-08-05', sequence: 1, sourceAccountId, status: 'executed',
  createdAt: '', updatedAt: '',
});

function render(accounts: Account[]) {
  const data = getInitialData();
  data.settings.budgetStartDay = 1;
  data.accounts = accounts;
  data.transactions = [tx('a', 'Nákup z hlavního', 'main', 300000), tx('b', 'Nákup kreditkou', 'card', 900000)];
  const periods = generatePeriodsSequence(2025, 10, 12, 1);
  const forecast = summarizePeriods(periods, { accounts: data.accounts, transactions: data.transactions }, { currentPeriodKey: '2026-09', today: '2026-09-10' });
  hooks.finance = { ...data, forecast, periodRanges: { analytics: getPresetRange('past:12') }, setPeriodRange: vi.fn() };
  return renderToStaticMarkup(<AnalyticsScreen />);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-10T12:00:00Z'));
});
afterEach(() => { vi.useRealTimers(); });

it('computes every analytics section from the default account only', () => {
  const html = render([account('main', true), account('card', false)]);
  expect(html).toContain('Výchozí účet: <span class="font-semibold text-slate-900">Hlavní účet</span>');
  expect(html).toContain('Nákup z hlavního');
  // Výdaj z jiného účtu se v Nejvyšších výdajích ani v extrémech neobjeví
  expect(html).not.toContain('Nákup kreditkou');
  expect(html).not.toContain(formatCurrency(900000));
  expect(html).not.toContain('Rozložení celkového majetku');
});

it('shows the missing default account warning instead of the sections', () => {
  const html = render([account('main', false), account('card', false)]);
  expect(html).toContain('Chybí výchozí účet');
  expect(html).not.toContain('Nejvyšší výdaje ve vybraném období');
});
