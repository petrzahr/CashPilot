import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FinanceProvider, NOT_SAVED_MESSAGE, useFinance } from '../context/FinanceContext';
import { AppData, getInitialData } from '../services/storageService';
import { SyncController } from '../services/syncController';
import { Account, Category, Transaction } from '../types/finance';

const account: Account = {
  id: 'chk', name: 'Běžný', type: 'checking', currency: 'CZK', initialBalanceInHaler: 0, initialBalanceDate: '2026-01-01',
  isUsableCash: true, isNetWorth: true, color: '', sortOrder: 1, status: 'active', createdAt: '', updatedAt: '',
};
const category: Category = {
  id: 'cat', name: 'Auto', type: 'expense', parentId: null, color: '', icon: '', sortOrder: 1, status: 'active', createdAt: '', updatedAt: '',
};
const tx: Transaction = {
  id: 'tx', title: 'Nákup', type: 'expense', status: 'executed', date: '2026-09-10', sequence: 1,
  amountInHaler: 1000, sourceAccountId: 'chk', createdAt: '', updatedAt: '',
};

/** Kontext nad relací, která ještě nemá načtená data (před první synchronizací). */
function financeBeforeFirstSync() {
  const data: AppData = { ...getInitialData(), accounts: [account], categories: [category], transactions: [tx] };
  const change = vi.fn();
  const session = { data, isReady: false, change } as unknown as SyncController;
  let finance!: ReturnType<typeof useFinance>;
  function Capture() { finance = useFinance(); return null; }
  renderToStaticMarkup(<FinanceProvider syncSession={session}><Capture /></FinanceProvider>);
  return { finance, change };
}

describe('Zápis před první synchronizací', () => {
  it('nic neuloží a nevrátí falešný úspěch', async () => {
    const { finance, change } = financeBeforeFirstSync();

    const notSaved = { ok: false, reason: 'not-saved', message: NOT_SAVED_MESSAGE };
    expect(finance.updateAccount({ ...account, name: 'Nový název' })).toEqual(notSaved);
    expect(finance.deleteAccount('chk')).toEqual(notSaved);
    expect(finance.deleteCategory('cat')).toEqual(notSaved);
    expect(finance.addCategory({ ...category, name: 'Nová' })).toEqual(notSaved);
    expect(finance.addAccount({ ...account, name: 'Nový' })).toEqual(notSaved);
    // Bez localStorage (node) skončí už pojistná kopie; nic se nesmaže
    expect(finance.clearAllTransactions()).toMatchObject({ ok: false });
    expect(finance.importJSON(JSON.stringify(getInitialData()))).toEqual(notSaved);
    expect(finance.deleteTransaction('tx')).toEqual(notSaved);
    expect(finance.addTransaction({ ...tx, title: 'Další' })).toEqual(notSaved);
    expect(finance.updateCategory({ ...category, name: 'Jiný název' })).toEqual(notSaved);
    expect(finance.updateSettings({ budgetStartDay: 1 })).toEqual(notSaved);
    expect(finance.setTransactionStatus('tx', 'planned')).toEqual(notSaved);

    expect(change).not.toHaveBeenCalled();
  });
});
