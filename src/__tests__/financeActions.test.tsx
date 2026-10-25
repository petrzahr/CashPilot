// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FinanceProvider, useFinance } from '../context/FinanceContext';
import { SyncController } from '../services/syncController';
import { AppData, getActiveStorageKey, getInitialData, loadStoredDataResult } from '../services/storageService';
import { saveStoredData } from './testStorageHelpers';
import { Account, Transaction } from '../types/finance';

/** Úložiště, jehož zápis jde v testu shodit (plné úložiště, zakázaný zápis). */
const storage = (() => {
  let store: Record<string, string> = {};
  let failWrites = false;
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      if (failWrites) throw new Error('QuotaExceededError');
      store[key] = String(value);
    },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; failWrites = false; },
    failWrites: (fail: boolean) => { failWrites = fail; },
  };
})();

const account: Account = {
  id: 'chk', name: 'Běžný', type: 'checking', currency: 'CZK', initialBalanceInHaler: 0, initialBalanceDate: '2026-01-01',
  isUsableCash: true, isNetWorth: true, color: '', sortOrder: 1, status: 'active', createdAt: '', updatedAt: '',
};
const tx: Transaction = {
  id: 'tx', title: 'Nákup', type: 'expense', status: 'planned', date: '2026-11-20', sequence: 1,
  amountInHaler: 1000, sourceAccountId: 'chk', createdAt: '', updatedAt: '',
};

async function mountReady(extra: Partial<AppData> = {}) {
  saveStoredData({ ...getInitialData(), accounts: [account], transactions: [tx], ...extra }, getActiveStorageKey());
  let cloud = loadStoredDataResult().data;
  const controller = new SyncController('test', () => 'token', next => saveStoredData(next), {
    find: async () => ({ id: 'file', name: 'cashpilot_data.json' }),
    read: async () => ({ data: cloud, etag: 'etag' }),
    backup: async () => {},
    upload: async (_token, next) => { cloud = next; return { id: 'file', name: 'cashpilot_data.json' }; },
  });
  await controller.sync();
  let finance!: ReturnType<typeof useFinance>;
  const Capture = () => { finance = useFinance(); return null; };
  render(<FinanceProvider syncSession={controller}><Capture /></FinanceProvider>);
  return { finance: () => finance, controller };
}

const toastTexts = (finance: () => ReturnType<typeof useFinance>) => finance().toasts.map(t => t.text);

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: storage, writable: true, configurable: true });
  storage.clear();
});
afterEach(() => cleanup());

describe('selhání zápisu do úložiště', () => {
  it('smazání nic nezmění, vrátí neúspěch a ukáže chybu mazání', async () => {
    const { finance, controller } = await mountReady();
    storage.failWrites(true);

    let deleted: unknown;
    await act(async () => { deleted = await finance().deleteTransaction('tx'); });

    expect(deleted).toBe(false);
    expect(controller.data.transactions.map(t => t.id)).toEqual(['tx']);
    expect(toastTexts(finance)).toContain('Položku se nepodařilo smazat. Zkuste to prosím znovu.');
  });

  it('jiná akce nevyhodí výjimku a data zůstanou beze změny', async () => {
    const { finance, controller } = await mountReady();
    storage.failWrites(true);

    expect(() => act(() => { finance().updateSettings({ budgetStartDay: 1 }); })).not.toThrow();
    expect(controller.data.settings.budgetStartDay).not.toBe(1);
    expect(toastTexts(finance)).not.toContain('Nastavení bylo uloženo.');
  });
});
