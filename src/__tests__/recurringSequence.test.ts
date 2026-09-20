import { describe, it, expect } from 'vitest';
import {
  calculateForecast,
  generateOccurrenceForPeriod,
  getEffectiveTransactionsForPeriod
} from '../services/financialEngine';
import {
  getNextSequenceForDate,
  insertOrUpdateWithSequence,
  normalizeDaySequences,
  sanitizeAndRepairSequences
} from '../services/sequenceService';
import { createBudgetPeriod, generatePeriodsSequence } from '../services/periodService';
import { autoExecuteDueTransactions } from '../services/statusService';
import {
  Account,
  AppSettings,
  RecurringException,
  RecurringRule,
  Transaction
} from '../types/finance';

const defaultSettings: AppSettings = {
  currency: 'CZK',
  budgetStartDay: 15,
  minReserveInHaler: 0,
  roundAmounts: false,
};

const checkingAccount: Account = {
  id: 'acc_main',
  name: 'Běžný účet',
  type: 'checking',
  currency: 'CZK',
  initialBalanceInHaler: 10000000, // 100 000 Kč
  initialBalanceDate: '2026-01-01',
  isUsableCash: true,
  isNetWorth: true,
  color: '#3B82F6',
  sortOrder: 1,
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('CashPilot - Testy pořadí výskytů opakovaných plateb (Požadavek 10)', () => {

  // Test 1: První výskyt respektuje pořadí předvyplněné ve formuláři
  it('1. První výskyt respektuje pořadí předvyplněné ve formuláři (nikoliv 10)', () => {
    const day = '2026-09-15';
    const tx1: Transaction = { id: 'tx1', title: 'Nákup 1', amountInHaler: 10000, date: day, sequence: 1, type: 'expense', sourceAccountId: 'acc_main', status: 'planned', createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '' };
    const tx2: Transaction = { id: 'tx2', title: 'Nákup 2', amountInHaler: 20000, date: day, sequence: 2, type: 'expense', sourceAccountId: 'acc_main', status: 'planned', createdAt: '2026-09-01T11:00:00.000Z', updatedAt: '' };
    const existing = [tx1, tx2];

    const suggestedSeq = getNextSequenceForDate(day, existing);
    expect(suggestedSeq).toBe(3);

    const firstOccurrenceTx: Transaction = {
      id: 'tx_rec_first',
      title: 'Pravidelné předplatné',
      amountInHaler: 30000,
      date: day,
      sequence: suggestedSeq,
      type: 'expense',
      sourceAccountId: 'acc_main',
      status: 'planned',
      recurringRuleId: 'rule_1',
      createdAt: '2026-09-01T12:00:00.000Z',
      updatedAt: ''
    };

    const updatedTxs = insertOrUpdateWithSequence(firstOccurrenceTx, suggestedSeq, existing);
    const dayTxs = updatedTxs.filter(t => t.date === day);

    expect(dayTxs.length).toBe(3);
    const firstOcc = dayTxs.find(t => t.id === 'tx_rec_first');
    expect(firstOcc?.sequence).toBe(3);
    expect(firstOcc?.sequence).not.toBe(10);
  });

  // Test 2: První výskyt respektuje ručně změněné pořadí a posune ostatní položky
  it('2. První výskyt respektuje ručně změněné pořadí a posune ostatní položky', () => {
    const day = '2026-09-15';
    const tx1: Transaction = { id: 'tx1', title: 'Nákup 1', amountInHaler: 10000, date: day, sequence: 1, type: 'expense', sourceAccountId: 'acc_main', status: 'planned', createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '' };
    const tx2: Transaction = { id: 'tx2', title: 'Nákup 2', amountInHaler: 20000, date: day, sequence: 2, type: 'expense', sourceAccountId: 'acc_main', status: 'planned', createdAt: '2026-09-01T11:00:00.000Z', updatedAt: '' };
    const existing = [tx1, tx2];

    // Uživatel ve formuláři ručně zvolil pořadí 1
    const manualSeq = 1;

    const firstOccurrenceTx: Transaction = {
      id: 'tx_rec_first',
      title: 'Přednostní platba',
      amountInHaler: 50000,
      date: day,
      sequence: manualSeq,
      type: 'expense',
      sourceAccountId: 'acc_main',
      status: 'planned',
      recurringRuleId: 'rule_priority',
      createdAt: '2026-09-01T12:00:00.000Z',
      updatedAt: ''
    };

    const updatedTxs = insertOrUpdateWithSequence(firstOccurrenceTx, manualSeq, existing);
    const dayTxs = updatedTxs.filter(t => t.date === day);

    expect(dayTxs.map(t => ({ id: t.id, seq: t.sequence }))).toEqual([
      { id: 'tx_rec_first', seq: 1 },
      { id: 'tx1', seq: 2 },
      { id: 'tx2', seq: 3 }
    ]);
  });

  // Test 3: Budoucí výskyt v prázdném dni dostane pořadí 1
  it('3. Budoucí výskyt v prázdném dni dostane pořadí 1 (nikoliv 10)', () => {
    const period = createBudgetPeriod(2026, 11, 15); // 15. 11. 2026 – 14. 12. 2026
    const rule: RecurringRule = {
      id: 'rule_rent',
      title: 'Nájem',
      amountInHaler: 1500000,
      type: 'expense',
      frequency: 'monthly',
      dayOfMonth: 15,
      startDate: '2026-09-15',
      sourceAccountId: 'acc_main',
      isActive: true,
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-01T10:00:00.000Z',
    };

    // V daném období nejsou žádné jiné položky
    const effectiveTxs = getEffectiveTransactionsForPeriod(period, [], [rule], [], 15);
    expect(effectiveTxs.length).toBe(1);
    expect(effectiveTxs[0].sequence).toBe(1);
    expect(effectiveTxs[0].sequence).not.toBe(10);
  });

  // Test 4: Budoucí výskyt po položkách 1 a 2 dostane pořadí 3
  it('4. Budoucí výskyt po položkách 1 a 2 dostane pořadí 3', () => {
    const period = createBudgetPeriod(2026, 10, 15); // 15. 10. 2026 – 14. 11. 2026
    const targetDay = '2026-10-15';
    const tx1: Transaction = { id: 'tx1', title: 'Běžná 1', amountInHaler: 1000, date: targetDay, sequence: 1, type: 'expense', sourceAccountId: 'acc_main', status: 'planned', createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '' };
    const tx2: Transaction = { id: 'tx2', title: 'Běžná 2', amountInHaler: 2000, date: targetDay, sequence: 2, type: 'expense', sourceAccountId: 'acc_main', status: 'planned', createdAt: '2026-10-01T11:00:00.000Z', updatedAt: '' };

    const rule: RecurringRule = {
      id: 'rule_internet',
      title: 'Internet',
      amountInHaler: 50000,
      type: 'expense',
      frequency: 'monthly',
      dayOfMonth: 15,
      startDate: '2026-09-15',
      sourceAccountId: 'acc_main',
      isActive: true,
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-01T10:00:00.000Z',
    };

    const effectiveTxs = getEffectiveTransactionsForPeriod(period, [tx1, tx2], [rule], [], 15);
    const dayTxs = effectiveTxs.filter(t => t.date === targetDay);

    expect(dayTxs.length).toBe(3);
    const virtualOcc = dayTxs.find(t => t.recurringRuleId === 'rule_internet');
    expect(virtualOcc?.sequence).toBe(3);
  });

  // Test 5: Více opakovaných plateb ve stejném dni dostane souvislé pořadí deterministicky
  it('5. Více opakovaných plateb ve stejném dni dostane souvislé pořadí (např. 3, 4, 5)', () => {
    const period = createBudgetPeriod(2026, 10, 15);
    const targetDay = '2026-10-15';
    const tx1: Transaction = { id: 'tx1', title: 'Existující 1', amountInHaler: 100, date: targetDay, sequence: 1, type: 'expense', sourceAccountId: 'acc_main', status: 'planned', createdAt: '', updatedAt: '' };
    const tx2: Transaction = { id: 'tx2', title: 'Existující 2', amountInHaler: 200, date: targetDay, sequence: 2, type: 'expense', sourceAccountId: 'acc_main', status: 'planned', createdAt: '', updatedAt: '' };

    const ruleA: RecurringRule = {
      id: 'rule_a',
      title: 'Platba A',
      amountInHaler: 300,
      type: 'expense',
      frequency: 'monthly',
      dayOfMonth: 15,
      startDate: '2026-09-15',
      sourceAccountId: 'acc_main',
      isActive: true,
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-01T10:00:00.000Z',
    };

    const ruleB: RecurringRule = {
      id: 'rule_b',
      title: 'Platba B',
      amountInHaler: 400,
      type: 'expense',
      frequency: 'monthly',
      dayOfMonth: 15,
      startDate: '2026-09-15',
      sourceAccountId: 'acc_main',
      isActive: true,
      createdAt: '2026-09-01T11:00:00.000Z',
      updatedAt: '2026-09-01T11:00:00.000Z',
    };

    const ruleC: RecurringRule = {
      id: 'rule_c',
      title: 'Platba C',
      amountInHaler: 500,
      type: 'expense',
      frequency: 'monthly',
      dayOfMonth: 15,
      startDate: '2026-09-15',
      sourceAccountId: 'acc_main',
      isActive: true,
      createdAt: '2026-09-01T12:00:00.000Z',
      updatedAt: '2026-09-01T12:00:00.000Z',
    };

    // Pravidla předána v náhodném pořadí (B, C, A)
    const effectiveTxs = getEffectiveTransactionsForPeriod(period, [tx1, tx2], [ruleB, ruleC, ruleA], [], 15);
    const dayTxs = effectiveTxs.filter(t => t.date === targetDay);

    expect(dayTxs.map(t => ({ id: t.recurringRuleId || t.id, seq: t.sequence }))).toEqual([
      { id: 'tx1', seq: 1 },
      { id: 'tx2', seq: 2 },
      { id: 'rule_a', seq: 3 },
      { id: 'rule_b', seq: 4 },
      { id: 'rule_c', seq: 5 }
    ]);
  });

  // Test 6: Žádný výskyt automaticky nedostane pevnou hodnotu 10
  it('6. Žádný výskyt automaticky nedostane pevnou hodnotu 10', () => {
    const period = createBudgetPeriod(2026, 11, 15);
    const rule: RecurringRule = {
      id: 'rule_gym',
      title: 'Posilovna',
      amountInHaler: 80000,
      type: 'expense',
      frequency: 'monthly',
      dayOfMonth: 20,
      startDate: '2026-09-20',
      sourceAccountId: 'acc_main',
      isActive: true,
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-01T10:00:00.000Z',
    };

    const singleOcc = generateOccurrenceForPeriod(rule, period, [], 15, 1);
    expect(singleOcc?.sequence).toBe(1);
    expect(singleOcc?.sequence).not.toBe(10);

    const effTxs = getEffectiveTransactionsForPeriod(period, [], [rule], [], 15);
    expect(effTxs[0].sequence).toBe(1);
    expect(effTxs[0].sequence).not.toBe(10);
  });

  // Test 7: Pořadí se po obnovení stránky samovolně nezmění
  it('7. Pořadí se po opakovaném výpočtu (obnovení stránky) samovolně nezmění', () => {
    const period = createBudgetPeriod(2026, 10, 15);
    const rule1: RecurringRule = { id: 'r1', title: 'R1', amountInHaler: 100, type: 'expense', frequency: 'monthly', dayOfMonth: 18, startDate: '2026-09-18', sourceAccountId: 'acc_main', isActive: true, createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '' };
    const rule2: RecurringRule = { id: 'r2', title: 'R2', amountInHaler: 200, type: 'expense', frequency: 'monthly', dayOfMonth: 18, startDate: '2026-09-18', sourceAccountId: 'acc_main', isActive: true, createdAt: '2026-09-01T11:00:00.000Z', updatedAt: '' };

    const run1 = getEffectiveTransactionsForPeriod(period, [], [rule1, rule2], [], 15);
    const run2 = getEffectiveTransactionsForPeriod(period, [], [rule2, rule1], [], 15);

    expect(run1.map(t => ({ id: t.id, seq: t.sequence }))).toEqual(run2.map(t => ({ id: t.id, seq: t.sequence })));
  });

  // Test 8: Změna data budoucího výskytu správně přepočítá jeho pořadí a nepřenáší staré pořadí
  it('8. Změna data budoucího výskytu správně přepočítá jeho pořadí a nepřenáší staré pořadí', () => {
    const period = createBudgetPeriod(2026, 10, 15);
    // Na 20.10. již máme 3 položky (seq 1, 2, 3)
    const txA: Transaction = { id: 'a', title: 'A', amountInHaler: 10, date: '2026-10-20', sequence: 1, type: 'expense', sourceAccountId: 'acc_main', status: 'planned', createdAt: '', updatedAt: '' };
    const txB: Transaction = { id: 'b', title: 'B', amountInHaler: 20, date: '2026-10-20', sequence: 2, type: 'expense', sourceAccountId: 'acc_main', status: 'planned', createdAt: '', updatedAt: '' };
    const txC: Transaction = { id: 'c', title: 'C', amountInHaler: 30, date: '2026-10-20', sequence: 3, type: 'expense', sourceAccountId: 'acc_main', status: 'planned', createdAt: '', updatedAt: '' };

    // Pravidlo má výchozí den 15.10. (kde by mělo pořadí 1)
    const rule: RecurringRule = {
      id: 'rule_move',
      title: 'Přesouvaná položka',
      amountInHaler: 999,
      type: 'expense',
      frequency: 'monthly',
      dayOfMonth: 15,
      startDate: '2026-09-15',
      sourceAccountId: 'acc_main',
      isActive: true,
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: ''
    };

    // Výjimka přesouvá výskyt v této periodě z 15. na 20.10.
    const exception: RecurringException = {
      id: 'ex_move',
      ruleId: 'rule_move',
      periodKey: period.key,
      overrideDate: '2026-10-20',
      createdAt: '2026-10-01T10:00:00.000Z'
    };

    const effTxs = getEffectiveTransactionsForPeriod(period, [txA, txB, txC], [rule], [exception], 15);
    const day20Txs = effTxs.filter(t => t.date === '2026-10-20');

    expect(day20Txs.length).toBe(4);
    const movedOcc = day20Txs.find(t => t.recurringRuleId === 'rule_move');
    // V novém dni musí dostat max + 1 = 4, nepřenáší se 1 z 15.10.
    expect(movedOcc?.sequence).toBe(4);
  });

  // Test 9: Již existující chybné budoucí výskyty (seq 10) jsou bezpečně opraveny, historické uskutečněné platby zůstávají
  it('9. Již existující chybné budoucí výskyty (seq 10) jsou bezpečně opraveny bez poškození historie', () => {
    const today = '2026-09-12';
    const buggyTxs: Transaction[] = [
      // Historická uskutečněná transakce před dneškem - musí zůstat zachována
      { id: 'hist_1', title: 'Historická', amountInHaler: 1000, date: '2026-08-10', sequence: 1, type: 'expense', sourceAccountId: 'acc_main', status: 'executed', createdAt: '', updatedAt: '' },
      // Budoucí den s chybnou položkou se sekvencí 10 a mezerou
      { id: 'fut_1', title: 'Budoucí běžná', amountInHaler: 2000, date: '2026-10-15', sequence: 1, type: 'expense', sourceAccountId: 'acc_main', status: 'planned', createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '' },
      { id: 'fut_err10', title: 'Budoucí s chybou 10', amountInHaler: 5000, date: '2026-10-15', sequence: 10, type: 'expense', sourceAccountId: 'acc_main', status: 'planned', createdAt: '2026-09-01T11:00:00.000Z', updatedAt: '' },
    ];

    const sanitized = sanitizeAndRepairSequences(buggyTxs, today);
    const day1015 = sanitized.filter(t => t.date === '2026-10-15');

    expect(day1015.length).toBe(2);
    expect(day1015[0].sequence).toBe(1);
    expect(day1015[1].sequence).toBe(2); // opraveno z 10 na 2!

    const hist = sanitized.find(t => t.id === 'hist_1');
    expect(hist?.sequence).toBe(1);
  });

  // Test 10: Nevznikají duplicity ani mezery (vždy souvislá řada 1, 2, 3...)
  it('10. V rámci dne nevznikají duplicity, mezery, 0 ani záporná či desetinná pořadí', () => {
    const day = '2026-11-20';
    const chaoticTxs: Transaction[] = [
      { id: 't1', title: 'T1', amountInHaler: 10, date: day, sequence: 0, type: 'expense', sourceAccountId: 'acc_main', status: 'planned', createdAt: '2026-11-01T01:00:00.000Z', updatedAt: '' },
      { id: 't2', title: 'T2', amountInHaler: 20, date: day, sequence: 10, type: 'expense', sourceAccountId: 'acc_main', status: 'planned', createdAt: '2026-11-01T02:00:00.000Z', updatedAt: '' },
      { id: 't3', title: 'T3', amountInHaler: 30, date: day, sequence: 10, type: 'expense', sourceAccountId: 'acc_main', status: 'planned', createdAt: '2026-11-01T03:00:00.000Z', updatedAt: '' },
      { id: 't4', title: 'T4', amountInHaler: 40, date: day, sequence: -5, type: 'expense', sourceAccountId: 'acc_main', status: 'planned', createdAt: '2026-11-01T04:00:00.000Z', updatedAt: '' },
    ];

    const normalized = normalizeDaySequences(chaoticTxs);
    expect(normalized.map(t => t.sequence)).toEqual([1, 2, 3, 4]);

    for (const tx of normalized) {
      expect(tx.sequence).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(tx.sequence)).toBe(true);
    }
  });

  // Test 11: Pravidelnost, částky, účty, kategorie a finanční forecast zůstanou plně funkční
  it('11. Finanční forecast a bilance fungují přesně s dynamickými pořadími pravidel', () => {
    const periods = generatePeriodsSequence(2026, 9, 3, 15);
    const salaryRule: RecurringRule = {
      id: 'rule_sal',
      title: 'Pravidelný příjem',
      amountInHaler: 3000000,
      type: 'income',
      frequency: 'monthly',
      dayOfMonth: 20,
      startDate: '2026-09-15',
      sourceAccountId: 'acc_main',
      isActive: true,
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-01T10:00:00.000Z',
    };

    const rentRule: RecurringRule = {
      id: 'rule_rent',
      title: 'Pravidelný výdaj',
      amountInHaler: 1000000,
      type: 'expense',
      frequency: 'monthly',
      dayOfMonth: 25,
      startDate: '2026-09-15',
      sourceAccountId: 'acc_main',
      isActive: true,
      createdAt: '2026-09-01T11:00:00.000Z',
      updatedAt: '2026-09-01T11:00:00.000Z',
    };

    const forecast = calculateForecast(
      periods,
      [checkingAccount],
      [],
      [salaryRule, rentRule],
      [],
      [],
      defaultSettings
    );

    expect(forecast.periods.length).toBe(3);

    expect(forecast.periods[0].openingBalanceInHaler).toBe(10000000);
    expect(forecast.periods[0].incomeInHaler).toBe(3000000);
    expect(forecast.periods[0].expenseInHaler).toBe(1000000);
    expect(forecast.periods[0].closingBalanceInHaler).toBe(12000000);

    expect(forecast.periods[1].openingBalanceInHaler).toBe(12000000);
    expect(forecast.periods[1].closingBalanceInHaler).toBe(14000000);

    const period0Txs = getEffectiveTransactionsForPeriod(periods[0], [], [salaryRule, rentRule], [], 15);
    expect(period0Txs.every(t => t.sequence !== 10)).toBe(true);
    expect(period0Txs.find(t => t.recurringRuleId === 'rule_sal')?.sequence).toBe(1);
    expect(period0Txs.find(t => t.recurringRuleId === 'rule_rent')?.sequence).toBe(1);
  });

  // Test 12: Pravidlo s orderHint vloží virtuál na požadovanou pozici, pravidlo bez hintu se řadí za
  it('12. Pravidlo s orderHint (pořadí série) se řadí před sourozenecké pravidlo bez hintu, obě za manuální položky', () => {
    const period = createBudgetPeriod(2026, 10, 15);
    const targetDay = '2026-10-15';
    const tx1: Transaction = { id: 'tx1', title: 'Manuální 1', amountInHaler: 100, date: targetDay, sequence: 1, type: 'expense', sourceAccountId: 'acc_main', status: 'planned', createdAt: '', updatedAt: '' };
    const tx2: Transaction = { id: 'tx2', title: 'Manuální 2', amountInHaler: 200, date: targetDay, sequence: 2, type: 'expense', sourceAccountId: 'acc_main', status: 'planned', createdAt: '', updatedAt: '' };

    const hintedRule: RecurringRule = {
      id: 'rule_hinted', title: 'Hintovaná', amountInHaler: 300, type: 'expense', frequency: 'monthly',
      dayOfMonth: 15, startDate: '2026-09-15', sourceAccountId: 'acc_main', isActive: true,
      orderHint: 1, orderHintUpdatedAt: '2026-10-01T10:00:00.000Z',
      createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z',
    };
    const plainRule: RecurringRule = {
      id: 'rule_plain', title: 'Nehintovaná', amountInHaler: 400, type: 'expense', frequency: 'monthly',
      dayOfMonth: 15, startDate: '2026-09-15', sourceAccountId: 'acc_main', isActive: true,
      createdAt: '2026-09-01T11:00:00.000Z', updatedAt: '2026-09-01T11:00:00.000Z',
    };

    const effectiveTxs = getEffectiveTransactionsForPeriod(period, [tx1, tx2], [plainRule, hintedRule], [], 15);
    const dayTxs = effectiveTxs.filter(t => t.date === targetDay);

    expect(dayTxs.map(t => ({ id: t.recurringRuleId || t.id, seq: t.sequence }))).toEqual([
      { id: 'tx1', seq: 1 },
      { id: 'tx2', seq: 2 },
      { id: 'rule_hinted', seq: 3 },
      { id: 'rule_plain', seq: 4 },
    ]);
  });

  // Test 13: RecurringException.overrideSequence ovlivní pozici jen v dané periodě
  it('13. overrideSequence z výjimky ovlivní pozici jen v jedné periodě, jinde platí výchozí chování', () => {
    const period = createBudgetPeriod(2026, 10, 15);
    const otherPeriod = createBudgetPeriod(2026, 11, 15);
    const targetDay = '2026-10-15';
    const tx1: Transaction = { id: 'tx1', title: 'Manuální 1', amountInHaler: 100, date: targetDay, sequence: 1, type: 'expense', sourceAccountId: 'acc_main', status: 'planned', createdAt: '', updatedAt: '' };

    const rule: RecurringRule = {
      id: 'rule_ex', title: 'Předplatné', amountInHaler: 300, type: 'expense', frequency: 'monthly',
      dayOfMonth: 15, startDate: '2026-09-15', sourceAccountId: 'acc_main', isActive: true,
      createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z',
    };
    const exception: RecurringException = {
      id: 'ex_seq', ruleId: 'rule_ex', periodKey: period.key, overrideSequence: 1,
      createdAt: '2026-10-01T10:00:00.000Z',
    };

    const effectiveTxs = getEffectiveTransactionsForPeriod(period, [tx1], [rule], [exception], 15);
    const dayTxs = effectiveTxs.filter(t => t.date === targetDay);
    expect(dayTxs.map(t => ({ id: t.recurringRuleId || t.id, seq: t.sequence }))).toEqual([
      { id: 'rule_ex', seq: 1 },
      { id: 'tx1', seq: 2 },
    ]);

    // Jiná perioda nemá výjimku - virtuál se řadí až za manuální položky (výchozí chování)
    const otherDay = '2026-11-15';
    const otherTx: Transaction = { id: 'other1', title: 'Manuální', amountInHaler: 50, date: otherDay, sequence: 1, type: 'expense', sourceAccountId: 'acc_main', status: 'planned', createdAt: '', updatedAt: '' };
    const otherEffectiveTxs = getEffectiveTransactionsForPeriod(otherPeriod, [otherTx], [rule], [exception], 15);
    const otherDayTxs = otherEffectiveTxs.filter(t => t.date === otherDay);
    expect(otherDayTxs.map(t => ({ id: t.recurringRuleId || t.id, seq: t.sequence }))).toEqual([
      { id: 'other1', seq: 1 },
      { id: 'rule_ex', seq: 2 },
    ]);
  });

  // Test 15: Zhmotnění splatného výskytu zachová pořadí nastavené přes orderHint
  it('15. Automatické zhmotnění splatného výskytu respektuje orderHint a výjimku overrideSequence', () => {
    const manual: Transaction = { id: 'tx_m', title: 'Ručně', amountInHaler: 100, date: '2026-10-15', sequence: 1, type: 'expense', sourceAccountId: 'acc_main', status: 'planned', createdAt: '', updatedAt: '' };
    const hinted: RecurringRule = {
      id: 'rule_h', title: 'Hint', amountInHaler: 300, type: 'expense', frequency: 'monthly', dayOfMonth: 15,
      startDate: '2026-10-15', sourceAccountId: 'acc_main', isActive: true, orderHint: 1,
      orderHintUpdatedAt: '2026-10-01T00:00:00.000Z', createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '',
    };
    const plain: RecurringRule = { ...hinted, id: 'rule_p', title: 'Bez hintu', orderHint: undefined, orderHintUpdatedAt: undefined };

    const res = autoExecuteDueTransactions([manual], [plain, hinted], [], 15, '2026-10-16');
    const day = res.transactions.filter(t => t.date === '2026-10-15').sort((a, b) => a.sequence - b.sequence);
    expect(day.map(t => t.recurringRuleId || t.id)).toEqual(['tx_m', 'rule_h', 'rule_p']);
    expect(day.map(t => t.sequence)).toEqual([1, 2, 3]);

    // Dvě pravidla s pořadím série se po zhmotnění seřadí podle ranku, ne podle pořadí v poli
    const first: RecurringRule = { ...hinted, id: 'rule_first', orderHint: 1 };
    const second: RecurringRule = { ...hinted, id: 'rule_second', orderHint: 2 };
    const res2 = autoExecuteDueTransactions([], [second, first], [], 15, '2026-10-16');
    const day2 = res2.transactions.filter(t => t.date === '2026-10-15').sort((a, b) => a.sequence - b.sequence);
    expect(day2.map(t => t.recurringRuleId)).toEqual(['rule_first', 'rule_second']);
  });

  // Test 14: Determinismus zůstává zachován i s hinty (nezávisle na pořadí vstupního pole pravidel)
  it('14. Výsledek s hinty je deterministický nezávisle na pořadí vstupních pravidel', () => {
    const period = createBudgetPeriod(2026, 10, 15);
    const rule1: RecurringRule = {
      id: 'r1', title: 'R1', amountInHaler: 100, type: 'expense', frequency: 'monthly', dayOfMonth: 18,
      startDate: '2026-09-18', sourceAccountId: 'acc_main', isActive: true,
      orderHint: 2, orderHintUpdatedAt: '2026-10-01T10:00:00.000Z',
      createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '',
    };
    const rule2: RecurringRule = {
      id: 'r2', title: 'R2', amountInHaler: 200, type: 'expense', frequency: 'monthly', dayOfMonth: 18,
      startDate: '2026-09-18', sourceAccountId: 'acc_main', isActive: true,
      orderHint: 1, orderHintUpdatedAt: '2026-10-01T09:00:00.000Z',
      createdAt: '2026-09-01T11:00:00.000Z', updatedAt: '',
    };

    const run1 = getEffectiveTransactionsForPeriod(period, [], [rule1, rule2], [], 15);
    const run2 = getEffectiveTransactionsForPeriod(period, [], [rule2, rule1], [], 15);

    expect(run1.map(t => ({ id: t.id, seq: t.sequence }))).toEqual(run2.map(t => ({ id: t.id, seq: t.sequence })));
    expect(run1.find(t => t.recurringRuleId === 'r2')?.sequence).toBe(1);
    expect(run1.find(t => t.recurringRuleId === 'r1')?.sequence).toBe(2);
  });
});
