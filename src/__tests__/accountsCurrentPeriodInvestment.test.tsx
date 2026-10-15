import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { FinanceProvider } from '../context/FinanceContext';
import { AccountsScreen } from '../components/accounts/AccountsScreen';
import { Account, Transaction } from '../types/finance';
import { AppData, getInitialData } from '../services/storageService';
import { SyncController } from '../services/syncController';
import { formatCurrency } from '../services/currencyService';

afterEach(() => vi.useRealTimers());

it('shows the current period investment card at period end, like the expected balance', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-15T10:00:00Z'));
  const account: Account = {
    id: 'asset', name: 'Asset', type: 'investment', currency: 'CZK',
    initialBalanceInHaler: 10000000, initialBalanceDate: '2026-08-01',
    isUsableCash: false, isNetWorth: true, color: '', sortOrder: 0, status: 'active',
    createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
  };
  // Vklad 5 000 Kč naplánovaný na konec aktuálního období (15. 10. – 14. 11.).
  const planned: Transaction = {
    id: 'deposit', title: 'Vklad', date: '2026-10-30', sequence: 1, type: 'transfer', sourceAccountId: 'cash',
    targetAccountId: account.id, amountInHaler: 500000, status: 'planned', createdAt: '', updatedAt: '',
  };
  const data: AppData = {
    ...getInitialData(), accounts: [account], transactions: [planned],
    marketValueSnapshots: [{ id: 'mv', accountId: account.id, date: '2026-10-01', marketValueInHaler: 11000000, createdAt: '2026-10-01' }],
    investmentFees: [{ id: 'fee', accountId: account.id, periodKey: '2026-10', amountInHaler: 20000, createdAt: '2026-10-15' }],
  };
  const session = { data, isReady: true, change: () => {} } as unknown as SyncController;
  const html = renderToStaticMarkup(<FinanceProvider syncSession={session}><AccountsScreen /></FinanceProvider>);

  expect(html).toContain(formatCurrency(11500000)); // Očekávaný stav i tržní hodnota ke konci období
  expect(html).toContain(`Vloženo: ${formatCurrency(10500000)}`);
  expect(html).toContain(`Investováno: ${formatCurrency(10480000)}`);
  // Výnos = 115 000 − (105 000 − 200) = 10 200 Kč; plánovaný vklad ho nemění.
  expect(html).toContain(`+${formatCurrency(1020000)} (+9.7 %)`);
});
