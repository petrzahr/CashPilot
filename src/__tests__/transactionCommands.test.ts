import { describe, it, expect } from 'vitest';
import { createEmptyAppData } from '../constants/defaultData';
import { AppData } from '../services/storageService';
import {
  addRecurringRule,
  createCommandContext,
  deleteRecurringRule,
  deleteTransaction,
  parseVirtualId,
  restoreDeletedTransaction,
  setTransactionStatus,
  updateRecurringRule,
} from '../services/transactionCommands';
import { Account, BalanceCorrection, RecurringRule, Transaction } from '../types/finance';

const ctx = createCommandContext('2026-09-13', new Date('2026-09-13T10:00:00Z'));

const account: Account = {
  id: 'chk', name: 'Běžný', type: 'checking', currency: 'CZK', initialBalanceInHaler: 0, initialBalanceDate: '2026-01-01',
  isUsableCash: true, isNetWorth: true, color: '#000000', sortOrder: 1, status: 'active', createdAt: '', updatedAt: '',
};

const rule: RecurringRule = {
  id: 'rule_rent', title: 'Nájem', amountInHaler: 1500000, type: 'expense', frequency: 'monthly', dayOfMonth: 20,
  startDate: '2026-01-20', sourceAccountId: 'chk', isActive: true, createdAt: '', updatedAt: '',
};

const tx = (partial: Partial<Transaction>): Transaction => ({
  id: 'tx', title: 'Položka', type: 'expense', status: 'planned', date: '2026-09-20', sequence: 1,
  amountInHaler: 1000, sourceAccountId: 'chk', createdAt: '', updatedAt: '', ...partial,
} as Transaction);

const occurrence = (date: string, partial: Partial<Transaction> = {}) =>
  tx({ id: `occ_${date}`, title: rule.title, date, amountInHaler: rule.amountInHaler, recurringRuleId: rule.id, ...partial });

const dataWith = (partial: Partial<AppData>): AppData => {
  const base = createEmptyAppData();
  return { ...base, settings: { ...base.settings, budgetStartDay: 15 }, accounts: [account], ...partial };
};

describe('parseVirtualId', () => {
  it('rozloží ID pravidla s podtržítky a klíč období', () => {
    expect(parseVirtualId('virtual_rule_rent_2026-09')).toEqual({ ruleId: 'rule_rent', periodKey: '2026-09' });
    expect(parseVirtualId('tx_1')).toBeNull();
  });
});

describe('deleteTransaction', () => {
  it('běžná položka zmizí, den se přečísluje a výsledek nese položku i korekci pro „Vrátit“', () => {
    const correction: BalanceCorrection = {
      id: 'a', accountId: 'chk', checkDate: '2026-09-20', actualBalanceInHaler: 0, calculatedBalanceInHaler: 0, diffInHaler: 0, createdAt: '',
    };
    const data = dataWith({ transactions: [tx({ id: 'a', sequence: 1 }), tx({ id: 'b', sequence: 2 })], corrections: [correction] });
    const { data: after, outcome } = deleteTransaction(data, { id: 'a', mode: 'occurrence', deleteHistoricalExecuted: false }, ctx);

    expect(after.transactions.map(t => [t.id, t.sequence])).toEqual([['b', 1]]);
    expect(after.corrections).toEqual([]);
    expect(outcome).toEqual({ kind: 'plain', transaction: data.transactions[0], correction });
  });

  it('neexistující položka nic nemění', () => {
    const data = dataWith({});
    const result = deleteTransaction(data, { id: 'missing', mode: 'occurrence', deleteHistoricalExecuted: false }, ctx);
    expect(result.data).toBe(data);
    expect(result.outcome).toEqual({ kind: 'none' });
  });

  it('výskyt: zrušená výjimka pro období, ostatní výskyty zůstávají', () => {
    const data = dataWith({ recurringRules: [rule] });
    const { data: after, outcome } = deleteTransaction(data, { id: 'virtual_rule_rent_2026-09', mode: 'occurrence', deleteHistoricalExecuted: false }, ctx);

    expect(after.recurringRules).toEqual([rule]);
    expect(after.recurringExceptions).toEqual([expect.objectContaining({ ruleId: rule.id, periodKey: '2026-09', isCancelled: true })]);
    expect(outcome).toEqual({ kind: 'recurring', mode: 'occurrence', ruleTitle: 'Nájem' });
  });

  it('budoucí: pravidlo skončí den před výskytem, neprovedené budoucí položky zmizí', () => {
    const data = dataWith({
      recurringRules: [rule],
      transactions: [
        occurrence('2026-07-20', { status: 'executed' }),
        occurrence('2026-08-20', { status: 'executed' }),
        occurrence('2026-09-20'),
        occurrence('2026-10-20'),
      ],
    });
    const { data: after } = deleteTransaction(data, { id: 'occ_2026-09-20', mode: 'future', deleteHistoricalExecuted: false }, ctx);

    expect(after.recurringRules[0]).toMatchObject({ id: rule.id, endDate: '2026-09-19', isActive: true });
    expect(after.transactions.map(t => t.id)).toEqual(['occ_2026-07-20', 'occ_2026-08-20']);
  });

  it('budoucí: zbude-li v sérii nejvýše jedna položka, stane se běžnou a pravidlo zmizí', () => {
    const data = dataWith({
      recurringRules: [rule],
      recurringExceptions: [{ id: 'ex', ruleId: rule.id, periodKey: '2026-07', isCancelled: true, createdAt: '' }],
      transactions: [occurrence('2026-08-20', { status: 'executed' }), occurrence('2026-09-20')],
    });
    const { data: after } = deleteTransaction(data, { id: 'occ_2026-09-20', mode: 'future', deleteHistoricalExecuted: false }, ctx);

    expect(after.recurringRules).toEqual([]);
    expect(after.recurringExceptions).toEqual([]);
    expect(after.transactions).toEqual([expect.objectContaining({ id: 'occ_2026-08-20', recurringRuleId: undefined, isException: false })]);
  });

  it('série: pravidlo a výjimky zmizí, provedené položky zůstanou, s deleteHistoricalExecuted zmizí i ty', () => {
    const data = dataWith({
      recurringRules: [rule],
      recurringExceptions: [{ id: 'ex', ruleId: rule.id, periodKey: '2026-07', isCancelled: true, createdAt: '' }],
      transactions: [occurrence('2026-08-20', { status: 'executed' }), occurrence('2026-09-20')],
    });
    const keep = deleteTransaction(data, { id: 'virtual_rule_rent_2026-10', mode: 'series', deleteHistoricalExecuted: false }, ctx).data;
    expect(keep.recurringRules).toEqual([]);
    expect(keep.recurringExceptions).toEqual([]);
    expect(keep.transactions.map(t => t.id)).toEqual(['occ_2026-08-20']);

    const all = deleteTransaction(data, { id: 'virtual_rule_rent_2026-10', mode: 'series', deleteHistoricalExecuted: true }, ctx).data;
    expect(all.transactions).toEqual([]);
  });
});

describe('restoreDeletedTransaction', () => {
  it('vrátí položku na původní pořadí a opakované vrácení nic nezdvojí', () => {
    const deleted = tx({ id: 'a', sequence: 1 });
    const data = dataWith({ transactions: [tx({ id: 'b', sequence: 1 })] });
    const first = restoreDeletedTransaction(data, { transaction: deleted }, ctx);
    expect(first.data.transactions.map(t => [t.id, t.sequence])).toEqual([['a', 1], ['b', 2]]);
    expect(first.data.transactions[0].updatedAt).toBe(ctx.nowIso);

    const second = restoreDeletedTransaction(first.data, { transaction: deleted }, ctx);
    expect(second.data).toBe(first.data);
    expect(second.outcome).toEqual({ restored: false });
  });
});

describe('setTransactionStatus', () => {
  it('virtuální výskyt se zhmotní na konec dne a výjimka jeho období zmizí', () => {
    const data = dataWith({
      recurringRules: [rule],
      recurringExceptions: [{ id: 'ex', ruleId: rule.id, periodKey: '2026-09', overrideAmountInHaler: 1600000, createdAt: '' }],
      transactions: [tx({ id: 'manual', date: '2026-09-20', sequence: 1 })],
    });
    const { data: after, outcome } = setTransactionStatus(data, { id: 'virtual_rule_rent_2026-09', status: 'executed' }, ctx);

    const created = after.transactions.find(t => t.recurringRuleId === rule.id)!;
    expect(created).toMatchObject({ date: '2026-09-20', sequence: 2, status: 'executed', amountInHaler: 1600000, actualAmountInHaler: 1600000 });
    expect(after.recurringExceptions).toEqual([]);
    expect(outcome).toEqual({ title: 'Nájem' });
  });

  it('provedená položka nese skutečnou částku, plánovaná ji ztrácí', () => {
    const data = dataWith({ transactions: [tx({ id: 'a', amountInHaler: 1000 })] });
    const executed = setTransactionStatus(data, { id: 'a', status: 'executed', updates: { actualAmountInHaler: 1200 } }, ctx).data;
    expect(executed.transactions[0]).toMatchObject({ status: 'executed', actualAmountInHaler: 1200 });

    const planned = setTransactionStatus(executed, { id: 'a', status: 'planned' }, ctx).data;
    expect(planned.transactions[0].status).toBe('planned');
    expect(planned.transactions[0].actualAmountInHaler).toBeUndefined();
  });

  it('neznámá položka vrací null a data beze změny', () => {
    const data = dataWith({});
    expect(setTransactionStatus(data, { id: 'missing', status: 'executed' }, ctx)).toEqual({ data, outcome: null });
  });
});

describe('addRecurringRule', () => {
  const ruleData = { ...rule, id: undefined, createdAt: undefined, updatedAt: undefined } as unknown as Omit<RecurringRule, 'id' | 'createdAt' | 'updatedAt'>;

  it('vytvoří pravidlo a první výskyt se stavem podle dne', () => {
    const { data: after, outcome } = addRecurringRule(dataWith({}), { ruleData: { ...ruleData, startDate: '2026-09-10' } }, ctx);
    if (!('rule' in outcome)) throw new Error('expected rule');
    expect(after.recurringRules).toEqual([outcome.rule]);
    expect(after.transactions).toEqual([expect.objectContaining({ recurringRuleId: outcome.rule.id, date: '2026-09-10', status: 'executed', sequence: 1 })]);
  });

  it('odmítne datum před aktivací účtu', () => {
    const data = dataWith({ accounts: [{ ...account, initialBalanceDate: '2026-10-01' }] });
    const { data: after, outcome } = addRecurringRule(data, { ruleData: { ...ruleData, startDate: '2026-09-20' } }, ctx);
    expect(after).toBe(data);
    expect(outcome).toMatchObject({ kind: 'inactiveAccount' });
  });

  it('převezme existující běžnou položku, ale ne položku ze série', () => {
    const data = dataWith({ transactions: [tx({ id: 'plain', date: '2026-09-20' }), occurrence('2026-08-20')] });
    const { data: after } = addRecurringRule(data, { ruleData, existingTransactionId: 'plain' }, ctx);
    const adopted = after.transactions.find(t => t.id === 'plain')!;
    expect(adopted.recurringRuleId).toBe(after.recurringRules[0].id);

    expect(addRecurringRule(data, { ruleData, existingTransactionId: 'occ_2026-08-20' }, ctx).outcome).toMatchObject({ kind: 'invalidSource' });
  });
});

describe('updateRecurringRule', () => {
  const data = dataWith({
    recurringRules: [rule],
    transactions: [occurrence('2026-08-20', { status: 'executed' }), occurrence('2026-10-20')],
  });

  it('výskyt: výjimka jen pro období', () => {
    const { data: after } = updateRecurringRule(data, { ruleId: rule.id, mode: 'occurrence', periodKey: '2026-09', overrideData: { amountInHaler: 2000000 } }, ctx);
    expect(after.recurringRules).toEqual([rule]);
    expect(after.recurringExceptions).toEqual([expect.objectContaining({ periodKey: '2026-09', overrideAmountInHaler: 2000000 })]);
  });

  it('budoucí: rozštěpí pravidlo a přepojí zhmotněné budoucí výskyty na novou větev', () => {
    const { data: after } = updateRecurringRule(data, {
      ruleId: rule.id, mode: 'future', periodKey: '2026-09', overrideData: { date: '2026-09-20', amountInHaler: 2000000 }, futureRuleId: 'rule_new',
    }, ctx);
    expect(after.recurringRules.find(r => r.id === rule.id)!.endDate).toBe('2026-09-19');
    expect(after.recurringRules.find(r => r.id === 'rule_new')).toMatchObject({ startDate: '2026-09-20', amountInHaler: 2000000 });
    expect(after.transactions.find(t => t.id === 'occ_2026-10-20')).toMatchObject({ recurringRuleId: 'rule_new', amountInHaler: 2000000 });
    expect(after.transactions.find(t => t.id === 'occ_2026-08-20')!.recurringRuleId).toBe(rule.id);
  });

  it('série: změna se propíše do všech zhmotněných výskytů včetně skutečné částky provedených', () => {
    const { data: after, outcome } = updateRecurringRule(data, { ruleId: rule.id, mode: 'series', periodKey: '2026-09', overrideData: { title: 'Bydlení', amountInHaler: 2000000 } }, ctx);
    expect(after.recurringRules[0]).toMatchObject({ title: 'Bydlení', amountInHaler: 2000000 });
    expect(after.transactions.find(t => t.id === 'occ_2026-08-20')).toMatchObject({ title: 'Bydlení', actualAmountInHaler: 2000000 });
    expect(outcome).toEqual({ ruleTitle: 'Bydlení' });
  });
});

describe('deleteRecurringRule', () => {
  it('smaže pravidlo, výjimky a neprovedené výskyty, provedené ponechá', () => {
    const data = dataWith({
      recurringRules: [rule],
      recurringExceptions: [{ id: 'ex', ruleId: rule.id, periodKey: '2026-07', isCancelled: true, createdAt: '' }],
      transactions: [occurrence('2026-08-20', { status: 'executed' }), occurrence('2026-09-20')],
    });
    const { data: after, outcome } = deleteRecurringRule(data, rule.id);
    expect(after.recurringRules).toEqual([]);
    expect(after.recurringExceptions).toEqual([]);
    expect(after.transactions.map(t => t.id)).toEqual(['occ_2026-08-20']);
    expect(outcome).toEqual({ ruleTitle: 'Nájem' });
  });
});
