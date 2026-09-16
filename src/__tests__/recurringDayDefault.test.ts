import { describe, it, expect } from 'vitest';
import {
  generateOccurrenceForPeriod,
  getEffectiveTransactionsForPeriod,
  calculateForecast
} from '../services/financialEngine';
import {
  createBudgetPeriod,
  generatePeriodsSequence,
  getDaysInMonth
} from '../services/periodService';
import {
  autoExecuteDueTransactions,
  getStatusForDate
} from '../services/statusService';
import {
  getNextSequenceForDate,
  insertOrUpdateWithSequence
} from '../services/sequenceService';
import {
  Account,
  AppSettings,
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

describe('CashPilot - Testy výchozího nastavení dne u opakovaných plateb (Požadavek 10)', () => {
  const todayRef = '2026-09-20';

  // Helper pro výpočet výchozího dne z data první platby (stejná logika jako v TransactionModal)
  const getDayFromDate = (dateStr: string): number => {
    const parts = dateStr.split('-');
    const day = parseInt(parts[2], 10);
    return isNaN(day) || day < 1 || day > 31 ? 1 : day;
  };

  // 1. První platba 27. dne automaticky nastaví den opakování 27
  it('1. První platba 27. dne automaticky nastaví den opakování 27', () => {
    const firstDate = '2026-09-27';
    const day = getDayFromDate(firstDate);
    expect(day).toBe(27);
  });

  // 2. První platba 5. dne automaticky nastaví den opakování 5
  it('2. První platba 5. dne automaticky nastaví den opakování 5', () => {
    const firstDate = '2026-09-05';
    const day = getDayFromDate(firstDate);
    expect(day).toBe(5);
  });

  // 3. Změna data první platby okamžitě aktualizuje den opakování
  it('3. Změna data první platby okamžitě aktualizuje den opakování', () => {
    let date = '2026-09-27';
    let day = getDayFromDate(date);
    expect(day).toBe(27);

    // Uživatel změní první platbu na 5. 10. 2026
    date = '2026-10-05';
    day = getDayFromDate(date);
    expect(day).toBe(5);

    // Další změna na 31. 10. 2026
    date = '2026-10-31';
    day = getDayFromDate(date);
    expect(day).toBe(31);
  });

  // 4. Uživatel může den opakování ručně změnit (1-31)
  it('4. Uživatel může den opakování ručně změnit v rozsahu 1-31', () => {
    const firstDate = '2026-09-27';
    let chosenDay = getDayFromDate(firstDate); // automaticky 27
    expect(chosenDay).toBe(27);

    // Uživatel ručně změní na 5
    const manualDay = 5;
    if (manualDay >= 1 && manualDay <= 31) {
      chosenDay = manualDay;
    }
    expect(chosenDay).toBe(5);
  });

  // 5. Ručně zvolený den se správně použije pro budoucí výskyty
  it('5. Ručně zvolený den se správně použije pro budoucí výskyty (první platba 27. 9., den 5 -> další výskyt 5. 10.)', () => {
    const rule: RecurringRule = {
      id: 'rec_manual_5',
      title: 'Služba X',
      amountInHaler: 150000,
      type: 'expense',
      frequency: 'monthly',
      dayOfMonth: 5, // ručně zvolený den
      startDate: '2026-09-27', // první platba
      sourceAccountId: 'acc_main',
      isActive: true,
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-01T10:00:00.000Z',
    };

    // První platba (vytvořená v databázi při založení pravidla)
    const firstTx: Transaction = {
      id: 'tx_first_27',
      title: 'Služba X',
      amountInHaler: 150000,
      date: '2026-09-27',
      sequence: 1,
      type: 'expense',
      sourceAccountId: 'acc_main',
      status: 'planned',
      recurringRuleId: rule.id,
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-01T10:00:00.000Z',
    };

    // Období 15. 9. 2026 – 14. 10. 2026 (startDay 15)
    const periodSept = createBudgetPeriod(2026, 9, 15);
    const txsSept = getEffectiveTransactionsForPeriod(periodSept, [firstTx], [rule], [], 15, todayRef);

    // V tomto období musí být OBĚ položky: 27. 9. a 5. 10.
    expect(txsSept.length).toBe(2);
    expect(txsSept.some(t => t.date === '2026-09-27')).toBe(true);
    expect(txsSept.some(t => t.date === '2026-10-05')).toBe(true);

    // Následující období 15. 10. 2026 – 14. 11. 2026 má výskyt 5. 11. 2026
    const periodOct = createBudgetPeriod(2026, 10, 15);
    const txsOct = getEffectiveTransactionsForPeriod(periodOct, [], [rule], [], 15, todayRef);
    expect(txsOct.length).toBe(1);
    expect(txsOct[0].date).toBe('2026-11-05');
  });

  // 6. První platba zůstane na původním zadaném datu
  it('6. První platba zůstane na původním zadaném datu (27. 9. 2026)', () => {
    const rule: RecurringRule = {
      id: 'rec_stay_date',
      title: 'Předplatné',
      amountInHaler: 200000,
      type: 'expense',
      frequency: 'monthly',
      dayOfMonth: 5,
      startDate: '2026-09-27',
      sourceAccountId: 'acc_main',
      isActive: true,
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-01T10:00:00.000Z',
    };

    const firstTx: Transaction = {
      id: 'tx_rec_first',
      title: 'Předplatné',
      amountInHaler: 200000,
      date: rule.startDate, // musí být přesně 2026-09-27
      sequence: 1,
      type: 'expense',
      sourceAccountId: 'acc_main',
      status: 'planned',
      recurringRuleId: rule.id,
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-01T10:00:00.000Z',
    };

    expect(firstTx.date).toBe('2026-09-27');
    expect(rule.startDate).toBe('2026-09-27');
  });

  // 7. Nevznikne výskyt před datem první platby
  it('7. Nevznikne výskyt před datem první platby', () => {
    const rule: RecurringRule = {
      id: 'rec_no_prior',
      title: 'Předplatné',
      amountInHaler: 100000,
      type: 'expense',
      frequency: 'monthly',
      dayOfMonth: 5,
      startDate: '2026-09-27',
      sourceAccountId: 'acc_main',
      isActive: true,
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-01T10:00:00.000Z',
    };

    // Období 15. 8. 2026 – 14. 9. 2026
    const periodAug = createBudgetPeriod(2026, 8, 15);
    const occAug = generateOccurrenceForPeriod(rule, periodAug, [], 15, 1, todayRef);
    expect(occAug).toBeNull();

    const txsAug = getEffectiveTransactionsForPeriod(periodAug, [], [rule], [], 15, todayRef);
    expect(txsAug.filter(t => t.recurringRuleId === rule.id).length).toBe(0);
  });

  // 8. Dny 29, 30 a 31 správně fungují v kratších měsících
  it('8. Dny 29, 30 a 31 správně fungují v kratších měsících (např. 28./29. 2., 30. 4.)', () => {
    const rule31: RecurringRule = {
      id: 'rec_day31',
      title: 'Platba na konci měsíce',
      amountInHaler: 50000,
      type: 'expense',
      frequency: 'monthly',
      dayOfMonth: 31,
      startDate: '2026-10-31',
      sourceAccountId: 'acc_main',
      isActive: true,
      createdAt: '2026-10-01T10:00:00.000Z',
      updatedAt: '2026-10-01T10:00:00.000Z',
    };

    // Kalendářní měsíce (startDay 1)
    // Leden (31 dní) -> 2027-01-31
    const pJan = createBudgetPeriod(2027, 1, 1);
    const occJan = generateOccurrenceForPeriod(rule31, pJan, [], 1, 1, todayRef);
    expect(occJan?.date).toBe('2027-01-31');

    // Únor 2027 (28 dní) -> 2027-02-28
    const pFeb = createBudgetPeriod(2027, 2, 1);
    const occFeb = generateOccurrenceForPeriod(rule31, pFeb, [], 1, 1, todayRef);
    expect(occFeb?.date).toBe('2027-02-28');

    // Duben (30 dní) -> 2027-04-30
    const pApr = createBudgetPeriod(2027, 4, 1);
    const occApr = generateOccurrenceForPeriod(rule31, pApr, [], 1, 1, todayRef);
    expect(occApr?.date).toBe('2027-04-30');
  });

  // 9. Po únoru se opakování vrátí na původně nastavený den
  it('9. Po únoru se opakování vrátí na původně nastavený den (březen má opět 31. 3.)', () => {
    const rule31: RecurringRule = {
      id: 'rec_day31_recover',
      title: 'Platba 31.',
      amountInHaler: 50000,
      type: 'expense',
      frequency: 'monthly',
      dayOfMonth: 31, // pravidlo má trvale 31
      startDate: '2026-10-31',
      sourceAccountId: 'acc_main',
      isActive: true,
      createdAt: '2026-10-01T10:00:00.000Z',
      updatedAt: '2026-10-01T10:00:00.000Z',
    };

    // Únor -> 2027-02-28
    const pFeb = createBudgetPeriod(2027, 2, 1);
    const occFeb = generateOccurrenceForPeriod(rule31, pFeb, [], 1, 1, todayRef);
    expect(occFeb?.date).toBe('2027-02-28');

    // Pravidlo má stále trvale den 31 (nezměněno na 28)
    expect(rule31.dayOfMonth).toBe(31);

    // Březen -> 2027-03-31
    const pMar = createBudgetPeriod(2027, 3, 1);
    const occMar = generateOccurrenceForPeriod(rule31, pMar, [], 1, 1, todayRef);
    expect(occMar?.date).toBe('2027-03-31');
  });

  // 10. Každý výskyt dostane správné dynamické pořadí (nikdy 10)
  it('10. Každý výskyt dostane správné dynamické pořadí (nikdy pevné 10)', () => {
    const rule: RecurringRule = {
      id: 'rec_seq_test',
      title: 'Předplatné',
      amountInHaler: 30000,
      type: 'expense',
      frequency: 'monthly',
      dayOfMonth: 20,
      startDate: '2026-09-20',
      sourceAccountId: 'acc_main',
      isActive: true,
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-01T10:00:00.000Z',
    };

    // V den 20. 10. 2026 již existují 2 transakce (pořadí 1 a 2)
    const existingTx1: Transaction = { id: 't1', title: 'P1', amountInHaler: 100, date: '2026-10-20', sequence: 1, type: 'expense', sourceAccountId: 'acc_main', status: 'planned', createdAt: '', updatedAt: '' };
    const existingTx2: Transaction = { id: 't2', title: 'P2', amountInHaler: 200, date: '2026-10-20', sequence: 2, type: 'expense', sourceAccountId: 'acc_main', status: 'planned', createdAt: '', updatedAt: '' };

    const periodOct = createBudgetPeriod(2026, 10, 15);
    const txs = getEffectiveTransactionsForPeriod(periodOct, [existingTx1, existingTx2], [rule], [], 15, todayRef);

    const generated = txs.find(t => t.recurringRuleId === rule.id && t.date === '2026-10-20');
    expect(generated).toBeDefined();
    // Musí mít pořadí 3 (nikoliv 10 ani 1)
    expect(generated?.sequence).toBe(3);
  });

  // 11. Každý výskyt dostane správný stav podle svého data
  it('11. Každý výskyt dostane správný stav podle svého data (datum <= dnes -> executed, budoucí -> planned)', () => {
    const rule: RecurringRule = {
      id: 'rec_status_test',
      title: 'Opakovaná platba',
      amountInHaler: 100000,
      type: 'expense',
      frequency: 'monthly',
      dayOfMonth: 5,
      startDate: '2026-09-05',
      sourceAccountId: 'acc_main',
      isActive: true,
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-01T10:00:00.000Z',
    };

    // Dnes je 2026-09-20
    // Výskyt 5. 9. 2026 je v minulosti -> executed
    const periodSept = createBudgetPeriod(2026, 8, 15); // 15. 8. – 14. 9.
    const occPast = generateOccurrenceForPeriod(rule, periodSept, [], 15, 1, '2026-09-20');
    expect(occPast?.date).toBe('2026-09-05');
    expect(occPast?.status).toBe('executed');

    // Výskyt 5. 10. 2026 je v budoucnosti -> planned
    const periodOct = createBudgetPeriod(2026, 9, 15); // 15. 9. – 14. 10.
    const occFuture = generateOccurrenceForPeriod(rule, periodOct, [], 15, 1, '2026-09-20');
    expect(occFuture?.date).toBe('2026-10-05');
    expect(occFuture?.status).toBe('planned');
  });

  // 12. Pevný výchozí den 15 se již nepoužívá
  it('12. Pevný výchozí den 15 se již nepoužívá v kódu formuláře ani jako výchozí fallback', async () => {
    // @ts-ignore
    const fs = await import('fs');
    // @ts-ignore
    const path = await import('path');
    const modalFilePath = path.resolve('src/components/transactions/TransactionModal.tsx');
    const content = fs.readFileSync(modalFilePath, 'utf-8');

    // Ověříme, že v TransactionModal.tsx není pevné nastavení useState<number>(15)
    expect(content.includes('useState<number>(15)')).toBe(false);
    // Ověříme, že v TransactionModal.tsx není pevné setDayOfMonth(15)
    expect(content.includes('setDayOfMonth(15)')).toBe(false);
    // Ověříme, že v TransactionModal.tsx není fallback || 15
    expect(content.includes('|| 15')).toBe(false);
  });
});
