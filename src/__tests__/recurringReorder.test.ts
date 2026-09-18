import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, beforeEach } from 'vitest';
import { FinanceProvider, useFinance } from '../context/FinanceContext';
import { SyncController } from '../services/syncController';
import {
  getActiveStorageKey,
  getInitialData,
  loadStoredDataResult,
  saveStoredData,
  AppData,
} from '../services/storageService';
import { getEffectiveTransactionsForPeriod } from '../services/financialEngine';
import { getPeriodForDate } from '../services/periodService';
import { Account, RecurringRule, Transaction } from '../types/finance';

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
  id: 'acc_main',
  name: 'Běžný účet',
  type: 'checking',
  currency: 'CZK',
  initialBalanceInHaler: 10000000,
  initialBalanceDate: '2026-01-01',
  isUsableCash: true,
  isNetWorth: true,
  color: '#3B82F6',
  sortOrder: 1,
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const gymRule: RecurringRule = {
  id: 'rule_gym',
  title: 'Posilovna',
  amountInHaler: 80000,
  type: 'expense',
  frequency: 'monthly',
  dayOfMonth: 15,
  startDate: '2026-09-15',
  sourceAccountId: 'acc_main',
  isActive: true,
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-01T10:00:00.000Z',
};

function populateTestStorage(customData?: Partial<AppData>): AppData {
  const base = getInitialData();
  const fullData: AppData = {
    ...base,
    accounts: [account],
    transactions: [],
    recurringRules: [],
    recurringExceptions: [],
    ...customData,
  };
  saveStoredData(fullData, getActiveStorageKey());
  return fullData;
}

async function getContextHandle() {
  let cloud = loadStoredDataResult().data;
  const controller = new SyncController('test', () => 'token', next => saveStoredData(next), {
    find: async () => ({ id: 'file', name: 'cashpilot_data.json' }),
    read: async () => ({ data: cloud, etag: 'etag' }),
    backup: async () => {},
    upload: async (_token, data) => { cloud = data; return { id: 'file', name: 'cashpilot_data.json' }; },
  });
  await controller.sync();
  let ctx: any;
  const Consumer = () => {
    ctx = useFinance();
    return null;
  };
  renderToStaticMarkup(
    React.createElement(FinanceProvider, { syncSession: controller }, React.createElement(Consumer))
  );
  return ctx;
}

describe('reorderRecurringItem - přeuspořádání opakující se položky s volbou rozsahu', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: storageMock, writable: true, configurable: true,
    });
    localStorage.clear();
  });

  it('occurrence: nastaví jen overrideSequence na výjimce, pravidlo zůstane nedotčené a jiná perioda je neovlivněna', async () => {
    const octManual: Transaction = {
      id: 'tx_oct', title: 'Nákup', amountInHaler: 1000, date: '2026-10-15', sequence: 1,
      type: 'expense', sourceAccountId: 'acc_main', status: 'planned', createdAt: '', updatedAt: '',
    };
    populateTestStorage({ recurringRules: [gymRule], transactions: [octManual] });
    const ctx = await getContextHandle();

    const period = getPeriodForDate('2026-10-15', 15);
    const before = getEffectiveTransactionsForPeriod(period, [octManual], [gymRule], [], 15);
    const virtual = before.find(t => t.recurringRuleId === gymRule.id)!;
    expect(virtual.sequence).toBe(2); // výchozí chování: virtuál až za manuální položkou

    ctx.reorderRecurringItem(gymRule.id, 'occurrence', '2026-10-15', period.key, [virtual.id, octManual.id], virtual.id);

    const stored = loadStoredDataResult().data;
    expect(stored.recurringRules).toEqual([gymRule]); // pravidlo nedotčené
    const ex = stored.recurringExceptions.find(e => e.ruleId === gymRule.id && e.periodKey === period.key);
    expect(ex?.overrideSequence).toBe(1);

    const after = getEffectiveTransactionsForPeriod(period, [octManual], stored.recurringRules, stored.recurringExceptions, 15);
    const dayAfter = after.filter(t => t.date === '2026-10-15');
    expect(dayAfter.map(t => t.recurringRuleId || t.id)).toEqual([gymRule.id, octManual.id]);

    // Jiná perioda (listopad) nemá výjimku - výchozí chování zůstává (virtuál za manuální položkou)
    const novPeriod = getPeriodForDate('2026-11-15', 15);
    const novManual: Transaction = {
      id: 'tx_nov', title: 'Nákup', amountInHaler: 2000, date: '2026-11-15', sequence: 1,
      type: 'expense', sourceAccountId: 'acc_main', status: 'planned', createdAt: '', updatedAt: '',
    };
    const nov = getEffectiveTransactionsForPeriod(novPeriod, [novManual], stored.recurringRules, stored.recurringExceptions, 15);
    const dayNov = nov.filter(t => t.date === '2026-11-15');
    expect(dayNov.map(t => t.recurringRuleId || t.id)).toEqual([novManual.id, gymRule.id]);
  });

  it('future: rozštěpí pravidlo, orderHint je jen na novém pravidle, minulé výskyty zůstávají nedotčené', async () => {
    const octManual: Transaction = {
      id: 'tx_oct', title: 'Nákup', amountInHaler: 1000, date: '2026-10-15', sequence: 1,
      type: 'expense', sourceAccountId: 'acc_main', status: 'planned', createdAt: '', updatedAt: '',
    };
    populateTestStorage({ recurringRules: [gymRule], transactions: [octManual] });
    const ctx = await getContextHandle();

    const period = getPeriodForDate('2026-10-15', 15);
    const before = getEffectiveTransactionsForPeriod(period, [octManual], [gymRule], [], 15);
    const virtual = before.find(t => t.recurringRuleId === gymRule.id)!;

    ctx.reorderRecurringItem(gymRule.id, 'future', '2026-10-15', period.key, [virtual.id, octManual.id], virtual.id);

    const stored = loadStoredDataResult().data;
    expect(stored.recurringRules).toHaveLength(2);
    const oldRule = stored.recurringRules.find(r => r.id === gymRule.id)!;
    const newRule = stored.recurringRules.find(r => r.id !== gymRule.id)!;

    expect(oldRule.endDate).toBe('2026-10-14');
    expect(oldRule.orderHint).toBeUndefined();
    expect(newRule.startDate).toBe('2026-10-15');
    expect(newRule.orderHint).toBe(1);

    // Minulý výskyt starého (useknutého) pravidla zůstává beze změny pořadí
    const septPeriod = getPeriodForDate('2026-09-15', 15);
    const septEffective = getEffectiveTransactionsForPeriod(septPeriod, [], [oldRule], [], 15);
    expect(septEffective.find(t => t.recurringRuleId === gymRule.id)?.sequence).toBe(1);

    // Budoucí perioda používá nové pravidlo s hintem - virtuál je první i před manuální položkou
    const novPeriod = getPeriodForDate('2026-11-15', 15);
    const novManual: Transaction = {
      id: 'tx_nov', title: 'Nákup', amountInHaler: 2000, date: '2026-11-15', sequence: 1,
      type: 'expense', sourceAccountId: 'acc_main', status: 'planned', createdAt: '', updatedAt: '',
    };
    const novEffective = getEffectiveTransactionsForPeriod(novPeriod, [novManual], [oldRule, newRule], [], 15);
    const dayNov = novEffective.filter(t => t.date === '2026-11-15');
    expect(dayNov.map(t => t.recurringRuleId || t.id)).toEqual([newRule.id, novManual.id]);
  });

  it('series: nastaví orderHint na existujícím pravidle in-place, sequence u již materializované minulé transakce zůstává beze změny', async () => {
    const octManual: Transaction = {
      id: 'tx_oct', title: 'Nákup', amountInHaler: 1000, date: '2026-10-15', sequence: 1,
      type: 'expense', sourceAccountId: 'acc_main', status: 'planned', createdAt: '', updatedAt: '',
    };
    const pastMaterialized: Transaction = {
      id: 'tx_past_gym', title: 'Posilovna', amountInHaler: 80000, date: '2026-09-15', sequence: 5,
      type: 'expense', sourceAccountId: 'acc_main', status: 'executed', actualAmountInHaler: 80000,
      recurringRuleId: gymRule.id, createdAt: '2026-09-15T00:00:00.000Z', updatedAt: '2026-09-15T00:00:00.000Z',
    };
    populateTestStorage({ recurringRules: [gymRule], transactions: [octManual, pastMaterialized] });
    const ctx = await getContextHandle();

    const period = getPeriodForDate('2026-10-15', 15);
    const before = getEffectiveTransactionsForPeriod(period, [octManual, pastMaterialized], [gymRule], [], 15);
    const virtual = before.find(t => t.recurringRuleId === gymRule.id && t.id.startsWith('virtual_'))!;

    ctx.reorderRecurringItem(gymRule.id, 'series', '2026-10-15', period.key, [virtual.id, octManual.id], virtual.id);

    const stored = loadStoredDataResult().data;
    expect(stored.recurringRules).toHaveLength(1);
    expect(stored.recurringRules[0].orderHint).toBe(1);

    // Minulá materializovaná transakce zůstává úplně beze změny - sequence se u ní nepřepočítává
    const pastTx = stored.transactions.find(t => t.id === 'tx_past_gym')!;
    expect(pastTx.sequence).toBe(5);
    expect(pastTx).toEqual(pastMaterialized);
  });

  it('reálná (dnešní) transakce se navíc fyzicky přeuspořádá pomocí reorderDayTransactions', async () => {
    // Manuální transakce je zároveň již materializovaným výskytem pravidla pro dnešní den
    const realOccurrence: Transaction = {
      id: 'tx_real_gym', title: 'Posilovna', amountInHaler: 80000, date: '2026-10-15', sequence: 2,
      type: 'expense', sourceAccountId: 'acc_main', status: 'planned',
      recurringRuleId: gymRule.id, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
    };
    const otherManual: Transaction = {
      id: 'tx_other', title: 'Jiný nákup', amountInHaler: 500, date: '2026-10-15', sequence: 1,
      type: 'expense', sourceAccountId: 'acc_main', status: 'planned', createdAt: '', updatedAt: '',
    };
    populateTestStorage({ recurringRules: [gymRule], transactions: [otherManual, realOccurrence] });
    const ctx = await getContextHandle();

    const period = getPeriodForDate('2026-10-15', 15);
    // Přetáhnout reálnou položku (id 'tx_real_gym') před 'tx_other'
    ctx.reorderRecurringItem(gymRule.id, 'series', '2026-10-15', period.key, ['tx_real_gym', 'tx_other'], 'tx_real_gym');

    const stored = loadStoredDataResult().data;
    const dayTxs = stored.transactions.filter(t => t.date === '2026-10-15').sort((a, b) => (a.sequence ?? 1) - (b.sequence ?? 1));
    expect(dayTxs.map(t => t.id)).toEqual(['tx_real_gym', 'tx_other']);
    expect(stored.recurringRules[0].orderHint).toBe(1);
  });
});
