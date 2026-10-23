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

    expect(finance.updateAccount({ ...account, name: 'Nový název' })).toEqual({ success: false, message: NOT_SAVED_MESSAGE });
    expect(finance.deleteAccount('chk')).toEqual({ success: false, message: NOT_SAVED_MESSAGE });
    expect(finance.deleteCategory('cat')).toEqual({ success: false, message: NOT_SAVED_MESSAGE });
    expect(finance.addCategory({ ...category, name: 'Nová' })).toBeUndefined();
    expect(finance.addAccount({ ...account, name: 'Nový' })).toBeUndefined();
    expect(finance.clearAllTransactions()).toBe(false);
    expect(finance.importJSON(JSON.stringify(getInitialData()))).toBe(false);
    await expect(finance.deleteTransaction('tx')).resolves.toBe(false);
    expect(() => finance.addTransaction({ ...tx, title: 'Další' })).toThrow(NOT_SAVED_MESSAGE);

    // Zápisy bez návratové hodnoty jen nesmí nic změnit
    finance.updateCategory({ ...category, name: 'Jiný název' });
    finance.updateSettings({ budgetStartDay: 1 });
    finance.setTransactionStatus('tx', 'planned');

    expect(change).not.toHaveBeenCalled();
  });
});
