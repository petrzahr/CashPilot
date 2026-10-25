// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FinanceProvider, NOT_SAVED_MESSAGE, useFinance } from '../context/FinanceContext';
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

describe('perform: oznámení a výsledek akce', () => {
  it('úspěšná akce uloží data, ukáže oznámení a vrátí hodnotu', async () => {
    const { finance, controller } = await mountReady();

    let result: ReturnType<ReturnType<typeof useFinance>['addAccount']> | undefined;
    act(() => { result = finance().addAccount({ ...account, name: 'Spoření' }); });

    expect(result).toMatchObject({ ok: true, value: { name: 'Spoření' } });
    expect(controller.data.accounts.map(a => a.name)).toContain('Spoření');
    expect(finance().toasts).toMatchObject([{ text: 'Účet „Spoření“ byl vytvořen.', type: 'success' }]);
    expect(finance().toasts[0].action).toBeUndefined();
  });

  it('před první synchronizací nic neuloží, oznámí to a vrátí not-saved', () => {
    const data = { ...getInitialData(), accounts: [account] };
    const change = () => { throw new Error('nesmí se volat'); };
    const session = { data, isReady: false, change, stop: () => {}, sync: async () => {} } as unknown as SyncController;
    let finance!: ReturnType<typeof useFinance>;
    const Capture = () => { finance = useFinance(); return null; };
    render(<FinanceProvider syncSession={session}><Capture /></FinanceProvider>);

    let result: unknown;
    act(() => { result = finance.updateSettings({ budgetStartDay: 1 }); });

    expect(result).toEqual({ ok: false, reason: 'not-saved', message: NOT_SAVED_MESSAGE });
    expect(finance.toasts).toMatchObject([{ text: NOT_SAVED_MESSAGE, type: 'error' }]);
  });

  it('„Vrátit“ v oznámení obnoví data stejnou cestou a ukáže oznámení o vrácení', async () => {
    const { finance, controller } = await mountReady({ transactions: [] });

    act(() => { finance().deleteAccount('chk'); });
    expect(controller.data.accounts).toEqual([]);
    const toast = finance().toasts.find(t => t.action?.label === 'Vrátit');
    expect(toast?.text).toBe('Účet „Běžný“ byl smazán.');

    // Záznam o smazání a obnovení nesmí mít stejný časový otisk
    await new Promise(resolve => setTimeout(resolve, 5));
    act(() => toast!.action!.onClick());
    expect(controller.data.accounts.map(a => a.id)).toEqual(['chk']);
    expect(finance().toasts.map(t => t.text)).toContain('Účet „Běžný“ byl obnoven.');
  });

  it('odmítnutí bez oznámení: data beze změny, důvod jen ve výsledku', async () => {
    const { finance, controller } = await mountReady();

    let result: unknown;
    act(() => { result = finance().deleteAccount('chk'); });

    expect(result).toMatchObject({ ok: false, reason: 'rejected', message: expect.any(String) });
    expect(controller.data.accounts.map(a => a.id)).toEqual(['chk']);
    expect(finance().toasts).toEqual([]);
  });

  it('odmítnutí s oznámením: chyba se ukáže a vrátí se i volajícímu', async () => {
    const { finance, controller } = await mountReady();

    let result: { ok: boolean; message?: string } | undefined;
    act(() => { result = finance().addTransaction({ ...tx, id: undefined, date: '2025-06-01' } as unknown as Transaction); });

    expect(result).toMatchObject({ ok: false, reason: 'rejected' });
    expect(finance().toasts).toMatchObject([{ text: result!.message, type: 'error' }]);
    expect(controller.data.transactions.map(t => t.id)).toEqual(['tx']);
  });
});

describe('selhání zápisu do úložiště', () => {
  it('smazání nic nezmění, vrátí neúspěch a ukáže chybu mazání', async () => {
    const { finance, controller } = await mountReady();
    storage.failWrites(true);

    let deleted: unknown;
    act(() => { deleted = finance().deleteTransaction('tx'); });

    expect(deleted).toEqual({ ok: false, reason: 'not-saved', message: 'QuotaExceededError' });
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
