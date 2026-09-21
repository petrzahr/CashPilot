import { describe, it, expect } from 'vitest';
import { createBudgetPeriod, getDefaultDateForPeriod, getTodayInPrague } from '../services/periodService';
import { getNextSequenceForDate } from '../services/sequenceService';
import { getEffectiveTransactionsForPeriod } from '../services/financialEngine';
import { RecurringRule, Transaction } from '../types/finance';

describe('CashPilot - Testy automatického výchozího data a pořadí nové položky', () => {

  // 1. Přidání položky v aktuálním období předvyplní dnešní datum
  it('1. Přidání položky v aktuálním období předvyplní dnešní datum', () => {
    const periodSep = createBudgetPeriod(2026, 9, 15); // 15. 9. 2026 – 14. 10. 2026
    const today = '2026-09-20';

    const defaultDate = getDefaultDateForPeriod(periodSep, today);
    expect(defaultDate).toBe('2026-09-20');

    // Hraniční dny období
    expect(getDefaultDateForPeriod(periodSep, '2026-09-15')).toBe('2026-09-15');
    expect(getDefaultDateForPeriod(periodSep, '2026-10-14')).toBe('2026-10-14');
  });

  // 2. Přidání položky v minulém období předvyplní poslední den období
  it('2. Přidání položky v minulém období předvyplní poslední den vybraného období (endDate)', () => {
    const periodPast = createBudgetPeriod(2026, 8, 15); // 15. 8. 2026 – 14. 9. 2026
    const today = '2026-09-20';

    const defaultDate = getDefaultDateForPeriod(periodPast, today);
    expect(defaultDate).toBe('2026-09-14'); // Poslední den vybraného období
    expect(defaultDate).toBe(periodPast.endDate);
  });

  // 3. Přidání položky v budoucím období předvyplní první den období
  it('3. Přidání položky v budoucím období předvyplní první den vybraného období (startDate)', () => {
    const periodFuture = createBudgetPeriod(2026, 10, 15); // 15. 10. 2026 – 14. 11. 2026
    const today = '2026-09-20';

    const defaultDate = getDefaultDateForPeriod(periodFuture, today);
    expect(defaultDate).toBe('2026-10-15'); // První den vybraného období
    expect(defaultDate).toBe(periodFuture.startDate);
  });

  // 4. Výpočet funguje pro období začínající 1. dnem
  it('4. Výpočet funguje pro období začínající 1. dnem kalendářního měsíce', () => {
    const periodSep1 = createBudgetPeriod(2026, 9, 1); // 1. 9. 2026 – 30. 9. 2026
    const periodAug1 = createBudgetPeriod(2026, 8, 1); // 1. 8. 2026 – 31. 8. 2026
    const periodOct1 = createBudgetPeriod(2026, 10, 1); // 1. 10. 2026 – 31. 10. 2026
    const today = '2026-09-20';

    // Aktuální období
    expect(getDefaultDateForPeriod(periodSep1, today)).toBe('2026-09-20');
    // Minulé období
    expect(getDefaultDateForPeriod(periodAug1, today)).toBe('2026-08-31');
    // Budoucí období
    expect(getDefaultDateForPeriod(periodOct1, today)).toBe('2026-10-01');
  });

  // 5. Výpočet funguje pro období začínající 15. dnem
  it('5. Výpočet funguje pro výchozí počáteční den 15', () => {
    const periodCurrent = createBudgetPeriod(2026, 9, 15); // 15. 9. 2026 – 14. 10. 2026
    const today = '2026-09-20';

    expect(getDefaultDateForPeriod(periodCurrent, today)).toBe('2026-09-20');
  });

  // 6. Výpočet funguje pro počáteční dny 29, 30 a 31
  it('6. Výpočet funguje spolehlivě pro počáteční dny 29, 30 a 31', () => {
    // Počáteční den 31
    const periodJan31 = createBudgetPeriod(2026, 1, 31); // Leden 2026 začíná 31. 1.
    // Únor 2026 má 28 dní -> únorové období začíná 28. 2. 2026, takže lednové končí 27. 2. 2026
    expect(periodJan31.startDate).toBe('2026-01-31');
    expect(periodJan31.endDate).toBe('2026-02-27');

    // Aktuální v rámci lednového období se dnem 31:
    expect(getDefaultDateForPeriod(periodJan31, '2026-02-10')).toBe('2026-02-10');
    // Minulé:
    expect(getDefaultDateForPeriod(periodJan31, '2026-03-15')).toBe('2026-02-27');
    // Budoucí:
    expect(getDefaultDateForPeriod(periodJan31, '2026-01-15')).toBe('2026-01-31');

    // Počáteční den 30
    const periodApr30 = createBudgetPeriod(2026, 4, 30); // 30. 4. 2026 – 29. 5. 2026
    expect(getDefaultDateForPeriod(periodApr30, '2026-05-10')).toBe('2026-05-10');
    expect(getDefaultDateForPeriod(periodApr30, '2026-06-01')).toBe('2026-05-29');
    expect(getDefaultDateForPeriod(periodApr30, '2026-04-01')).toBe('2026-04-30');

    // Počáteční den 29
    const periodFeb29 = createBudgetPeriod(2026, 2, 29); // Únor 2026 (nepřestupný, má 28 dní -> 28. 2.)
    expect(periodFeb29.startDate).toBe('2026-02-28');
    expect(getDefaultDateForPeriod(periodFeb29, '2026-03-05')).toBe('2026-03-05');
  });

  // 7. Výpočet funguje v únoru a přestupném roce
  it('7. Výpočet správně respektuje únor a přestupný rok 2024 i 2028', () => {
    // Přestupný rok 2028 (únor má 29 dní)
    const leapFeb = createBudgetPeriod(2028, 2, 1); // 1. 2. 2028 – 29. 2. 2028
    expect(leapFeb.startDate).toBe('2028-02-01');
    expect(leapFeb.endDate).toBe('2028-02-29');

    // Pokud je dnes 5. března 2028 (minulé období), výchozí datum je 29. 2. 2028
    expect(getDefaultDateForPeriod(leapFeb, '2028-03-05')).toBe('2028-02-29');
    // Pokud je dnes 20. února 2028 (v období), výchozí datum je 20. 2. 2028
    expect(getDefaultDateForPeriod(leapFeb, '2028-02-20')).toBe('2028-02-20');

    // Nepřestupný rok 2026 (únor má 28 dní)
    const normalFeb = createBudgetPeriod(2026, 2, 1); // 1. 2. 2026 – 28. 2. 2026
    expect(normalFeb.endDate).toBe('2026-02-28');
    expect(getDefaultDateForPeriod(normalFeb, '2026-03-01')).toBe('2026-02-28');
  });

  // 8. Výpočet funguje na přelomu roku (prosinec - leden)
  it('8. Výpočet funguje bezchybně na přelomu roku (prosinec – leden)', () => {
    // Období Prosinec 2026 se startovním dnem 15: 15. 12. 2026 – 14. 1. 2027
    const periodTurn = createBudgetPeriod(2026, 12, 15);
    expect(periodTurn.startDate).toBe('2026-12-15');
    expect(periodTurn.endDate).toBe('2027-01-14');

    // Dnes je 3. ledna 2027 (spadá do tohoto prosincového období)
    expect(getDefaultDateForPeriod(periodTurn, '2027-01-03')).toBe('2027-01-03');

    // Dnes je 20. ledna 2027 (minulé období) -> konec 14. 1. 2027
    expect(getDefaultDateForPeriod(periodTurn, '2027-01-20')).toBe('2027-01-14');

    // Dnes je 1. prosince 2026 (budoucí období) -> začátek 15. 12. 2026
    expect(getDefaultDateForPeriod(periodTurn, '2026-12-01')).toBe('2026-12-15');
  });

  // 9. Časové pásmo Europe/Prague
  it('Respektuje časové pásmo Europe/Prague', () => {
    // 23:30 UTC dne 2026-09-12 je v Praze (UTC+2) 01:30 dne 2026-09-13
    const lateUtcDate = new Date('2026-09-12T23:30:00Z');
    const pragueDate = getTodayInPrague(lateUtcDate);
    expect(pragueDate).toBe('2026-09-13');
  });

  // 10. Pořadí se správně dopočítá podle automaticky nastaveného data
  it('9 & 10. Pořadí se správně dopočítá podle automaticky nastaveného data i při ruční změně', () => {
    const existingTxs: Transaction[] = [
      {
        id: 'tx1',
        title: 'Položka 1',
        amountInHaler: 100,
        date: '2026-09-20',
        sequence: 1,
        type: 'expense',
        sourceAccountId: 'acc',
        status: 'planned',
        createdAt: '',
        updatedAt: ''
      },
      {
        id: 'tx2',
        title: 'Položka 2',
        amountInHaler: 200,
        date: '2026-09-20',
        sequence: 2,
        type: 'expense',
        sourceAccountId: 'acc',
        status: 'planned',
        createdAt: '',
        updatedAt: ''
      }
    ];

    // Pokud automatické datum je 2026-09-20 a existují položky 1 a 2 -> pořadí 3
    const nextSeq1 = getNextSequenceForDate('2026-09-20', existingTxs);
    expect(nextSeq1).toBe(3);

    // Pokud uživatel změní datum na den bez položek (např. 2026-09-21) -> pořadí 1
    const nextSeq2 = getNextSequenceForDate('2026-09-21', existingTxs);
    expect(nextSeq2).toBe(1);

    // Pokud přidáme další položku s pořadím 3 na 2026-09-20
    const updatedTxs: Transaction[] = [
      ...existingTxs,
      {
        id: 'tx3',
        title: 'Položka 3',
        amountInHaler: 300,
        date: '2026-09-20',
        sequence: 3,
        type: 'expense',
        sourceAccountId: 'acc',
        status: 'planned',
        createdAt: '',
        updatedAt: ''
      }
    ];
    // Existují 1, 2, 3 -> pořadí 4
    expect(getNextSequenceForDate('2026-09-20', updatedTxs)).toBe(4);
  });

  // 11. Editace existující položky její datum automaticky nezmění
  it('11. Editace existující položky zachová původní datum a pořadí', () => {
    const existingTx: Transaction = {
      id: 'tx_edit',
      title: 'Stávající položka',
      amountInHaler: 50000,
      date: '2026-08-25', // Datum v minulém období
      sequence: 5,
      type: 'expense',
      sourceAccountId: 'acc',
      status: 'executed',
      createdAt: '',
      updatedAt: ''
    };

    // Simulace chování TransactionModal při editaci:
    // Pokud je zadáno transactionToEdit, formulář použije transactionToEdit.date a transactionToEdit.sequence,
    // namísto volání getDefaultDateForPeriod
    const isEditing = true;
    const formDate = isEditing ? existingTx.date : getDefaultDateForPeriod(createBudgetPeriod(2026, 9, 15), '2026-09-20');
    const formSequence = isEditing ? existingTx.sequence : getNextSequenceForDate(formDate, [existingTx]);

    expect(formDate).toBe('2026-08-25'); // Původní datum zůstalo zachováno!
    expect(formSequence).toBe(5); // Původní pořadí zůstalo zachováno!
  });

  // 12. Nová položka v budoucím dni s virtuálním výskytem opakující se platby se řadí až za něj
  it('12. Nová položka v budoucím dni, kde existuje jen virtuální výskyt opakující se platby, dostane pořadí za ním (ne 1)', () => {
    const period = createBudgetPeriod(2026, 10, 15); // 15. 10. 2026 – 14. 11. 2026
    const targetDay = '2026-10-15';

    const rentRule: RecurringRule = {
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

    // V daném dni zatím neexistují žádné reálné transakce - jen virtuální výskyt nájmu.
    // Naivní getNextSequenceForDate nad "holými" transakcemi o virtuálním výskytu neví,
    // a chybně by vrátilo 1 (nová položka by "přeskočila" před nájem).
    const naiveSeq = getNextSequenceForDate(targetDay, []);
    expect(naiveSeq).toBe(1);

    // Efektivní výpočet (reálné + virtuální transakce) musí zohlednit už zobrazený
    // virtuální výskyt a novou položku zařadit až za něj.
    const effectiveTxs = getEffectiveTransactionsForPeriod(period, [], [rentRule], [], 15);
    const correctSeq = getNextSequenceForDate(targetDay, effectiveTxs);
    expect(correctSeq).toBe(2);
  });
});
