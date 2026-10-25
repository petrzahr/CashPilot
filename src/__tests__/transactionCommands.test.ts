import { describe, it, expect } from 'vitest';
import { createEmptyAppData } from '../constants/defaultData';
import { AppData } from '../services/storageService';
import {
  addRecurringRule,
  addTransaction,
  autoExecute,
  buildVirtualId,
  createCommandContext,
  deleteRecurringRule,
  deleteTransaction,
  parseVirtualId,
  reorderDayTransactions,
  reorderRecurringItem,
  restoreDeletedTransaction,
  setTransactionStatus,
  updateRecurringRule,
  updateTransaction,
} from '../services/transactionCommands';
import { getEffectiveTransactionsForPeriod } from '../services/financialEngine';
import { getPeriodForDate } from '../services/periodService';
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

  it('buildVirtualId je jeho opak', () => {
    expect(buildVirtualId('rule_rent', '2026-09')).toBe('virtual_rule_rent_2026-09');
    expect(parseVirtualId(buildVirtualId('rule_rent', '2026-09'))).toEqual({ ruleId: 'rule_rent', periodKey: '2026-09' });
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

  describe('s pozicí v dni (placement)', () => {
    const manual = (id: string, date: string) => tx({ id, title: 'Nákup', date, sequence: 1 });
    const dayOrder = (after: AppData, date: string) => {
      const period = getPeriodForDate(date, 15);
      return getEffectiveTransactionsForPeriod(period, after.transactions, after.recurringRules, after.recurringExceptions)
        .filter(t => t.date === date)
        .map(t => t.recurringRuleId || t.id);
    };

    it('budoucí: v jednom příkazu rozštěpí pravidlo a nové větvi dá pozici, bez dalšího štěpení', () => {
      const data = dataWith({ recurringRules: [rule], transactions: [manual('m', '2026-10-20')] });
      const { data: after } = updateRecurringRule(data, {
        ruleId: rule.id, mode: 'future', periodKey: '2026-10',
        overrideData: { date: '2026-10-20', amountInHaler: 2000000 },
        originalTransactionId: buildVirtualId(rule.id, '2026-10'),
        futureRuleId: 'rule_new',
        placement: { date: '2026-10-20', position: 1 },
      }, ctx);

      expect(after.recurringRules).toHaveLength(2);
      expect(after.recurringRules.find(r => r.id === rule.id)!.endDate).toBe('2026-10-19');
      expect(after.recurringRules.find(r => r.id === 'rule_new')).toMatchObject({ amountInHaler: 2000000, orderRank: 1 });
      expect(dayOrder(after, '2026-10-20')).toEqual(['rule_new', 'm']);
    });

    it('série: zhmotněný výskyt jde na danou pozici a pořadí platí i v dalších obdobích', () => {
      const data = dataWith({
        recurringRules: [rule],
        transactions: [manual('m', '2026-10-20'), occurrence('2026-10-20', { sequence: 2 }), manual('n', '2026-11-20')],
      });
      const { data: after } = updateRecurringRule(data, {
        ruleId: rule.id, mode: 'series', periodKey: '2026-10',
        overrideData: { title: 'Bydlení' },
        originalTransactionId: 'occ_2026-10-20',
        placement: { date: '2026-10-20', position: 1 },
      }, ctx);

      expect(after.recurringRules).toEqual([expect.objectContaining({ id: rule.id, title: 'Bydlení', orderRank: 1 })]);
      expect(after.transactions.find(t => t.id === 'occ_2026-10-20')).toMatchObject({ title: 'Bydlení', sequence: 1 });
      expect(after.transactions.find(t => t.id === 'm')!.sequence).toBe(2);
      expect(dayOrder(after, '2026-11-20')).toEqual([rule.id, 'n']);
    });

    it('bez pozice zůstává pořadí série beze změny', () => {
      const { data: after } = updateRecurringRule(data, { ruleId: rule.id, mode: 'series', periodKey: '2026-09', overrideData: { title: 'Bydlení' } }, ctx);
      expect(after.recurringRules[0].orderRank).toBeUndefined();
      expect(after.recurringExceptions).toEqual([]);
    });
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

const lateAccount: Account = { ...account, id: 'late', name: 'Pozdní', initialBalanceDate: '2026-10-01' };

describe('addTransaction', () => {
  const input = (partial: Partial<Transaction> = {}) => {
    const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = tx({ title: 'Nákup', status: undefined, sequence: undefined, ...partial });
    return rest;
  };

  it('bez pořadí jde na konec dne, budoucí položka je plánovaná bez skutečné částky', () => {
    const data = dataWith({ transactions: [tx({ id: 'a', sequence: 1 })] });
    const { data: after, outcome } = addTransaction(data, input({ actualAmountInHaler: 1000 }), ctx);

    expect(outcome).toMatchObject({ sequence: 2, transaction: { status: 'planned', actualAmountInHaler: undefined, createdAt: ctx.nowIso } });
    const added = 'transaction' in outcome ? outcome.transaction : undefined;
    expect(added?.id).toMatch(/^tx_/);
    expect(after.transactions.map(t => [t.id, t.sequence])).toEqual([['a', 1], [added!.id, 2]]);
  });

  it('položka k dnešku je provedená a nese plánovanou částku jako skutečnou', () => {
    const { outcome } = addTransaction(dataWith({}), input({ date: '2026-09-13', plannedAmountInHaler: 700 }), ctx);
    expect(outcome).toMatchObject({ transaction: { status: 'executed', actualAmountInHaler: 700 } });
  });

  it('zadané pořadí vloží položku na dané místo a posune ostatní', () => {
    const data = dataWith({ transactions: [tx({ id: 'a', sequence: 1 })] });
    const { data: after } = addTransaction(data, input({ sequence: 1 }), ctx);
    expect(after.transactions.find(t => t.id === 'a')!.sequence).toBe(2);
  });

  it('účet aktivní až později: chyba a data beze změny (zdroj i cíl převodu)', () => {
    const data = dataWith({ accounts: [account, lateAccount] });
    const error = 'Tento účet je aktivní až od 1. 10. 2026. Zvolte stejné nebo pozdější datum.';

    const fromSource = addTransaction(data, input({ sourceAccountId: 'late' }), ctx);
    expect(fromSource.data).toBe(data);
    expect(fromSource.outcome).toEqual({ error });

    const toTarget = addTransaction(data, input({ type: 'transfer', targetAccountId: 'late' }), ctx);
    expect(toTarget.outcome).toEqual({ error });
  });
});

describe('updateTransaction', () => {
  it('změna data bez jiného pořadí: položka jde na konec nového dne, původní den se přečísluje', () => {
    const data = dataWith({
      transactions: [
        tx({ id: 'a', date: '2026-09-20', sequence: 1 }),
        tx({ id: 'b', date: '2026-09-20', sequence: 2 }),
        tx({ id: 'c', date: '2026-09-21', sequence: 1 }),
      ],
    });
    const { data: after, outcome } = updateTransaction(data, { ...data.transactions[0], date: '2026-09-21', title: 'Nová' }, ctx);

    const byId = (id: string) => after.transactions.find(t => t.id === id)!;
    expect(byId('a')).toMatchObject({ date: '2026-09-21', sequence: 2, title: 'Nová', updatedAt: ctx.nowIso });
    expect(byId('b').sequence).toBe(1);
    expect(outcome).toEqual({ title: 'Nová' });
  });

  it('virtuální výskyt se zhmotní a výjimka jeho období zmizí', () => {
    const data = dataWith({
      recurringRules: [rule],
      recurringExceptions: [{ id: 'ex', ruleId: rule.id, periodKey: '2026-09', overrideAmountInHaler: 1, createdAt: '' }],
    });
    const virtual = occurrence('2026-09-20', { id: 'virtual_rule_rent_2026-09', sequence: 0, amountInHaler: 1600000 });
    const { data: after, outcome } = updateTransaction(data, virtual, ctx);

    expect(after.recurringExceptions).toEqual([]);
    expect(after.transactions).toEqual([expect.objectContaining({ recurringRuleId: rule.id, amountInHaler: 1600000, sequence: 1, createdAt: ctx.nowIso })]);
    expect(after.transactions[0].id).toMatch(/^tx_real_/);
    expect(outcome).toEqual({ title: 'Nájem' });
  });

  it('aktivitu účtu kontroluje proti aktuálním datům', () => {
    const data = dataWith({ accounts: [account, lateAccount], transactions: [tx({ id: 'a' })] });
    const result = updateTransaction(data, { ...data.transactions[0], sourceAccountId: 'late' }, ctx);
    expect(result.data).toBe(data);
    expect(result.outcome).toEqual({ error: 'Tento účet je aktivní až od 1. 10. 2026. Zvolte stejné nebo pozdější datum.' });
  });
});

describe('reorderDayTransactions', () => {
  it('přečísluje reálné položky dne a pozici virtuálního výskytu uloží do výjimky období', () => {
    const data = dataWith({
      recurringRules: [rule],
      transactions: [tx({ id: 'a', sequence: 1 }), tx({ id: 'b', sequence: 2 })],
    });
    const { data: after } = reorderDayTransactions(data, { date: '2026-09-20', orderedIds: ['b', 'virtual_rule_rent_2026-09', 'a'] }, ctx);

    expect(after.transactions.find(t => t.id === 'b')!.sequence).toBe(1);
    expect(after.transactions.find(t => t.id === 'a')!.sequence).toBeGreaterThan(1);
    expect(after.recurringExceptions).toEqual([
      expect.objectContaining({ ruleId: rule.id, periodKey: '2026-09', overrideSequence: 2, updatedAt: ctx.nowIso }),
    ]);
  });

  it('bez virtuálních výskytů nechá výjimky beze změny', () => {
    const data = dataWith({ transactions: [tx({ id: 'a', sequence: 1 }), tx({ id: 'b', sequence: 2 })] });
    const { data: after } = reorderDayTransactions(data, { date: '2026-09-20', orderedIds: ['b', 'a'] }, ctx);
    expect(after.recurringExceptions).toBe(data.recurringExceptions);
  });
});

describe('reorderRecurringItem', () => {
  it('výjimky dostanou čas i ID z kontextu příkazu, ne z hodin prohlížeče', () => {
    const fixedCtx = { ...ctx, nowIso: '2030-01-01T00:00:00.000Z', newId: (prefix: string, suffix = '') => `${prefix}_fixed${suffix}` };
    const data = dataWith({
      recurringRules: [rule],
      recurringExceptions: [{ id: 'ex_aug', ruleId: rule.id, periodKey: '2026-08', overrideSequence: 3, overrideAmountInHaler: 5, createdAt: '' }],
      transactions: [tx({ id: 'a', sequence: 1 })],
    });
    const moved = 'virtual_rule_rent_2026-09';
    const { data: after } = reorderRecurringItem(data, {
      ruleId: rule.id, mode: 'series', date: '2026-09-20', periodKey: '2026-09', orderedIds: [moved, 'a'], movedTransactionId: moved,
    }, fixedCtx);

    const aug = after.recurringExceptions.find(e => e.periodKey === '2026-08')!;
    expect(aug.overrideSequence).toBeUndefined();
    expect(aug.updatedAt).toBe(fixedCtx.nowIso);
    expect(after.recurringExceptions.find(e => e.periodKey === '2026-09')).toMatchObject({
      id: 'ex_fixed_rule_rent', overrideSequence: 1, createdAt: fixedCtx.nowIso,
    });
  });
});

describe('autoExecute', () => {
  it('splatnou plánovanou položku k ctx.todayStr provede', () => {
    const data = dataWith({ transactions: [tx({ id: 'due', date: '2026-09-13' }), tx({ id: 'later', date: '2026-09-14' })] });
    const { data: after, outcome } = autoExecute(data, ctx);
    expect(after.transactions.map(t => [t.id, t.status])).toEqual([['due', 'executed'], ['later', 'planned']]);
    expect(outcome.executedCount).toBe(1);
  });

  it('bez splatných položek vrací původní data', () => {
    const data = dataWith({ transactions: [tx({ id: 'later', date: '2026-09-14' })] });
    expect(autoExecute(data, ctx).data).toBe(data);
  });
});
