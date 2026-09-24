import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, beforeEach } from 'vitest';
import { FinanceProvider, useFinance } from '../context/FinanceContext';
import { SyncController } from '../services/syncController';
import {
  getActiveStorageKey,
  getInitialData,
  loadStoredDataResult,
  AppData,
} from '../services/storageService';
import { saveStoredData } from './testStorageHelpers';
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
    <FinanceProvider syncSession={controller}>
      <Consumer />
    </FinanceProvider>
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

  it('future: rozštěpí pravidlo, orderRank je jen na novém pravidle, minulé výskyty zůstávají nedotčené', async () => {
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
    expect(oldRule.orderRank).toBeUndefined();
    expect(newRule.startDate).toBe('2026-10-15');
    expect(newRule.orderRank).toBe(1);

    // Minulý výskyt starého (useknutého) pravidla zůstává beze změny pořadí
    const septPeriod = getPeriodForDate('2026-09-15', 15);
    const septEffective = getEffectiveTransactionsForPeriod(septPeriod, [], [oldRule], [], 15);
    expect(septEffective.find(t => t.recurringRuleId === gymRule.id)?.sequence).toBe(1);

    // Budoucí perioda používá nové pravidlo (s pořadím série) - virtuál je za ruční položkou dne
    const novPeriod = getPeriodForDate('2026-11-15', 15);
    const novManual: Transaction = {
      id: 'tx_nov', title: 'Nákup', amountInHaler: 2000, date: '2026-11-15', sequence: 1,
      type: 'expense', sourceAccountId: 'acc_main', status: 'planned', createdAt: '', updatedAt: '',
    };
    const novEffective = getEffectiveTransactionsForPeriod(novPeriod, [novManual], [oldRule, newRule], [], 15);
    const dayNov = novEffective.filter(t => t.date === '2026-11-15');
    expect(dayNov.map(t => t.recurringRuleId || t.id)).toEqual([novManual.id, newRule.id]);
  });

  it('series: nastaví orderRank na existujícím pravidle in-place, sequence u již materializované minulé transakce zůstává beze změny', async () => {
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
    expect(stored.recurringRules[0].orderRank).toBe(1);

    // Minulá materializovaná transakce zůstává úplně beze změny - sequence se u ní nepřepočítává
    const pastTx = stored.transactions.find(t => t.id === 'tx_past_gym')!;
    expect(pastTx.sequence).toBe(5);
    expect(pastTx).toEqual(pastMaterialized);
  });

  it('series: přesun opakované platby DOLŮ pod jinou opakovanou platbu se propíše do dalších období', async () => {
    const rentRule: RecurringRule = { ...gymRule, id: 'rule_rent', title: 'Nájem', createdAt: '2026-09-01T09:00:00.000Z' };
    // Výchozí pořadí (dle createdAt): Nájem, Posilovna. Uživatel přetáhne Nájem pod Posilovnu.
    populateTestStorage({ recurringRules: [rentRule, gymRule] });
    const ctx = await getContextHandle();

    const period = getPeriodForDate('2026-10-15', 15);
    const before = getEffectiveTransactionsForPeriod(period, [], [rentRule, gymRule], [], 15)
      .filter(t => t.date === '2026-10-15');
    expect(before.map(t => t.recurringRuleId)).toEqual(['rule_rent', 'rule_gym']);
    const rentV = before[0].id;
    const gymV = before[1].id;

    ctx.reorderRecurringItem('rule_rent', 'series', '2026-10-15', period.key, [gymV, rentV], rentV);

    const stored = loadStoredDataResult().data;
    const novPeriod = getPeriodForDate('2026-11-15', 15);
    const nov = getEffectiveTransactionsForPeriod(novPeriod, [], stored.recurringRules, stored.recurringExceptions, 15)
      .filter(t => t.date === '2026-11-15');
    expect(nov.map(t => t.recurringRuleId)).toEqual(['rule_gym', 'rule_rent']);
  });

  describe.each([['series' as const], ['future' as const]])('přesun 3. položky na 2. mezi provedenými opakovanými platbami (%s)', mode => {
    const mkRule = (id: string, created: string): RecurringRule => ({ ...gymRule, id, title: id, startDate: '2026-07-15', createdAt: created });
    const mkTx = (rule: string, month: string, seq: number): Transaction => ({
      id: `tx_${rule}_${month}`, title: rule, amountInHaler: 1000, date: `2026-${month}-15`, sequence: seq,
      type: 'expense', sourceAccountId: 'acc_main', status: 'executed', actualAmountInHaler: 1000,
      recurringRuleId: rule, createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z',
    });

    it('propíše se do už zhmotněných výskytů i do budoucích virtuálních', async () => {
      const rules = [mkRule('rule_a', '2026-07-01T01:00:00.000Z'), mkRule('rule_b', '2026-07-01T02:00:00.000Z'), mkRule('rule_c', '2026-07-01T03:00:00.000Z')];
      const txs = ['08', '09'].flatMap(m => [mkTx('rule_a', m, 1), mkTx('rule_b', m, 2), mkTx('rule_c', m, 3)]);
      populateTestStorage({ recurringRules: rules, transactions: txs });
      const ctx = await getContextHandle();

      // Uživatel v září přetáhne 3. (C) na 2. místo: A, C, B
      const period = getPeriodForDate('2026-09-15', 15);
      ctx.reorderRecurringItem('rule_c', mode, '2026-09-15', period.key,
        ['tx_rule_a_09', 'tx_rule_c_09', 'tx_rule_b_09'], 'tx_rule_c_09');

      const stored = loadStoredDataResult().data;
      const dayOrder = (month: string) => stored.transactions
        .filter(t => t.date === `2026-${month}-15`)
        .sort((a, b) => a.sequence - b.sequence)
        .map(t => t.title);

      expect(dayOrder('09')).toEqual(['rule_a', 'rule_c', 'rule_b']);
      // Srpen (minulost před zvoleným dnem): „celá série" ho přeuspořádá, „tento a další" ne
      expect(dayOrder('08')).toEqual(mode === 'series' ? ['rule_a', 'rule_c', 'rule_b'] : ['rule_a', 'rule_b', 'rule_c']);

      // Budoucí (virtuální) říjen - pořadí A, C, B
      const oct = getEffectiveTransactionsForPeriod(getPeriodForDate('2026-10-15', 15), stored.transactions, stored.recurringRules, stored.recurringExceptions, 15)
        .filter(t => t.date === '2026-10-15');
      expect(oct.map(t => t.title)).toEqual(['rule_a', 'rule_c', 'rule_b']);
    });
  });

  describe.each([['series' as const], ['future' as const]])('starší pevné pozice pro jednu periodu (%s)', mode => {
    it('řazení série je přepíše, takže plánované výskyty v dalším měsíci následují nové pořadí', async () => {
      const mk = (id: string, created: string): RecurringRule => ({ ...gymRule, id, title: id, startDate: '2026-07-15', createdAt: created });
      const rules = [mk('rule_a', '2026-07-01T01:00:00.000Z'), mk('rule_b', '2026-07-01T02:00:00.000Z'), mk('rule_m', '2026-07-01T03:00:00.000Z')];
      const sep = (rule: string, seq: number): Transaction => ({
        id: `tx_${rule}_09`, title: rule, amountInHaler: 1000, date: '2026-09-15', sequence: seq,
        type: 'expense', sourceAccountId: 'acc_main', status: 'executed', actualAmountInHaler: 1000,
        recurringRuleId: rule, createdAt: '2026-09-15T00:00:00.000Z', updatedAt: '2026-09-15T00:00:00.000Z',
      });
      // Dřívější pokus „jen tento výskyt" v říjnu nechal pevné pozice: a=1, b=2, m=3
      const octKey = getPeriodForDate('2026-10-15', 15).key;
      const staleExceptions = [['rule_a', 1], ['rule_b', 2], ['rule_m', 3]].map(([ruleId, seq]) => ({
        id: `ex_${ruleId}`, ruleId: ruleId as string, periodKey: octKey, overrideSequence: seq as number, createdAt: '2026-09-18T00:00:00.000Z',
      }));
      populateTestStorage({
        recurringRules: rules,
        transactions: [sep('rule_a', 1), sep('rule_b', 2), sep('rule_m', 3)],
        recurringExceptions: staleExceptions,
      });
      const ctx = await getContextHandle();

      // Uživatel v září chce pořadí m, a, b
      ctx.reorderRecurringItem('rule_m', mode, '2026-09-15', getPeriodForDate('2026-09-15', 15).key,
        ['tx_rule_m_09', 'tx_rule_a_09', 'tx_rule_b_09'], 'tx_rule_m_09');

      const stored = loadStoredDataResult().data;
      const oct = getEffectiveTransactionsForPeriod(getPeriodForDate('2026-10-15', 15), stored.transactions, stored.recurringRules, stored.recurringExceptions, 15)
        .filter(t => t.date === '2026-10-15');
      expect(oct.map(t => t.title)).toEqual(['rule_m', 'rule_a', 'rule_b']);
    });
  });

  it('obyčejné přetažení ručně zadané položky ve dni s virtuálním výskytem zachová zvolené pořadí', async () => {
    const manual: Transaction = {
      id: 'tx_m', title: 'Ručně', amountInHaler: 100, date: '2026-10-15', sequence: 1,
      type: 'expense', sourceAccountId: 'acc_main', status: 'planned', createdAt: '', updatedAt: '',
    };
    populateTestStorage({ recurringRules: [gymRule], transactions: [manual] });
    const ctx = await getContextHandle();

    const period = getPeriodForDate('2026-10-15', 15);
    const virtual = getEffectiveTransactionsForPeriod(period, [manual], [gymRule], [], 15)
      .find(t => t.recurringRuleId === 'rule_gym')!;
    // Ruční položka byla první, virtuál druhý; přetáhneme ruční pod virtuál.
    ctx.reorderDayTransactions('2026-10-15', [virtual.id, 'tx_m']);

    const stored = loadStoredDataResult().data;
    const day = getEffectiveTransactionsForPeriod(period, stored.transactions, stored.recurringRules, stored.recurringExceptions, 15)
      .filter(t => t.date === '2026-10-15');
    expect(day.map(t => t.recurringRuleId || t.id)).toEqual(['rule_gym', 'tx_m']);
  });

  it('series: přetažený virtuální výskyt před ruční položku v daném dni drží (nevrátí se zpět)', async () => {
    const octManual: Transaction = {
      id: 'tx_oct', title: 'Nákup', amountInHaler: 1000, date: '2026-10-15', sequence: 1,
      type: 'expense', sourceAccountId: 'acc_main', status: 'planned', createdAt: '', updatedAt: '',
    };
    populateTestStorage({ recurringRules: [gymRule], transactions: [octManual] });
    const ctx = await getContextHandle();

    const period = getPeriodForDate('2026-10-15', 15);
    const virtual = getEffectiveTransactionsForPeriod(period, [octManual], [gymRule], [], 15)
      .find(t => t.recurringRuleId === gymRule.id)!;
    ctx.reorderRecurringItem(gymRule.id, 'series', '2026-10-15', period.key, [virtual.id, octManual.id], virtual.id);

    const stored = loadStoredDataResult().data;
    const day = getEffectiveTransactionsForPeriod(period, stored.transactions, stored.recurringRules, stored.recurringExceptions, 15)
      .filter(t => t.date === '2026-10-15');
    expect(day.map(t => t.recurringRuleId || t.id)).toEqual([gymRule.id, octManual.id]);
  });

  it('series: změna data přečísluje pořadí přesunutých zhmotněných výskytů', async () => {
    const rule: RecurringRule = { ...gymRule, dayOfMonth: 20, startDate: '2026-07-20' };
    const mk = (month: string, seq: number): Transaction => ({
      id: `tx_gym_${month}`, title: 'Posilovna', amountInHaler: 80000, date: `2026-${month}-20`, sequence: seq,
      type: 'expense', sourceAccountId: 'acc_main', status: 'executed', actualAmountInHaler: 80000,
      recurringRuleId: rule.id, createdAt: '2026-07-20T00:00:00.000Z', updatedAt: '2026-07-20T00:00:00.000Z',
    });
    const other: Transaction = {
      id: 'tx_other', title: 'Jiné', amountInHaler: 500, date: '2026-08-20', sequence: 1,
      type: 'expense', sourceAccountId: 'acc_main', status: 'executed', createdAt: '', updatedAt: '',
    };
    const aug = { ...mk('08', 2) };
    populateTestStorage({ recurringRules: [rule], transactions: [mk('07', 13), other, aug] });
    const ctx = await getContextHandle();

    ctx.updateRecurringRule(rule.id, 'series', getPeriodForDate('2026-08-20', 15).key, { date: '2026-08-25' }, aug.id);

    const stored = loadStoredDataResult().data;
    const byId = (id: string) => stored.transactions.find(t => t.id === id)!;
    expect(stored.recurringRules[0].dayOfMonth).toBe(25);
    expect(byId('tx_gym_07')).toMatchObject({ date: '2026-07-25', sequence: 1 });
    expect(byId('tx_gym_08')).toMatchObject({ date: '2026-08-25', sequence: 1 });
    expect(byId('tx_other').sequence).toBe(1);
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
    expect(stored.recurringRules[0].orderRank).toBe(1);
  });
});
