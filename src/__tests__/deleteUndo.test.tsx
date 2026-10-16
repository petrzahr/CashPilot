import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, beforeEach } from 'vitest';
import { FinanceProvider, useFinance } from '../context/FinanceContext';
import { SyncController } from '../services/syncController';
import { getActiveStorageKey, getInitialData, loadStoredDataResult, AppData } from '../services/storageService';
import { saveStoredData } from './testStorageHelpers';
import { Account, Transaction } from '../types/finance';

const storageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value.toString(); },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

const account: Account = {
  id: 'acc_main', name: 'Běžný účet', type: 'checking', currency: 'CZK',
  initialBalanceInHaler: 10000000, initialBalanceDate: '2026-01-01', isUsableCash: true, isNetWorth: true,
  color: '#3B82F6', sortOrder: 1, status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};

const makeTx = (id: string, title: string, sequence: number): Transaction => ({
  id, title, amountInHaler: 1000 * sequence, date: '2026-11-20', sequence,
  type: 'expense', sourceAccountId: 'acc_main', status: 'planned',
  createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
});

async function setup(transactions: Transaction[]) {
  const data: AppData = { ...getInitialData(), accounts: [account], transactions };
  saveStoredData(data, getActiveStorageKey());
  let cloud = loadStoredDataResult().data;
  const controller = new SyncController('test', () => 'token', next => saveStoredData(next), {
    find: async () => ({ id: 'file', name: 'cashpilot_data.json' }),
    read: async () => ({ data: cloud, etag: 'etag' }),
    backup: async () => {},
    upload: async (_token, next) => { cloud = next; return { id: 'file', name: 'cashpilot_data.json' }; },
  });
  await controller.sync();
  let ctx: any;
  const Consumer = () => { ctx = useFinance(); return null; };
  renderToStaticMarkup(<FinanceProvider syncSession={controller}><Consumer /></FinanceProvider>);
  return { ctx, controller, getCloud: () => cloud };
}

const dayOrder = () => loadStoredDataResult().data.transactions
  .filter(t => t.date === '2026-11-20')
  .sort((a, b) => (a.sequence ?? 1) - (b.sequence ?? 1))
  .map(t => `${t.sequence}:${t.id}`);

describe('Smazání běžné položky a „Vrátit“', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: storageMock, writable: true, configurable: true });
    localStorage.clear();
  });

  it('vrátí položku na původní místo v dni a obnovení přežije synchronizaci', async () => {
    const rent = makeTx('tx_b', 'Nájem', 2);
    const { ctx, controller, getCloud } = await setup([makeTx('tx_a', 'Káva', 1), rent, makeTx('tx_c', 'Oběd', 3)]);

    expect(await ctx.deleteTransaction('tx_b')).toBe(true);
    expect(dayOrder()).toEqual(['1:tx_a', '2:tx_c']);

    // Záznam o smazání a obnovení nesmí mít stejný časový otisk
    await new Promise(resolve => setTimeout(resolve, 5));
    ctx.restoreDeletedTransaction(rent);
    expect(dayOrder()).toEqual(['1:tx_a', '2:tx_b', '3:tx_c']);

    await controller.sync();
    expect(getCloud().transactions.map((t: Transaction) => t.id).sort()).toEqual(['tx_a', 'tx_b', 'tx_c']);
    expect(dayOrder()).toEqual(['1:tx_a', '2:tx_b', '3:tx_c']);
  });

  it('opakované vrácení stejné položky nic nezdvojí', async () => {
    const rent = makeTx('tx_b', 'Nájem', 1);
    const { ctx } = await setup([rent]);
    await ctx.deleteTransaction('tx_b');
    await new Promise(resolve => setTimeout(resolve, 5));
    ctx.restoreDeletedTransaction(rent);
    ctx.restoreDeletedTransaction(rent);
    expect(dayOrder()).toEqual(['1:tx_b']);
  });
});
