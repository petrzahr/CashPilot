import { describe, it, expect } from 'vitest';
import { Account, AppSettings, RecurringException, RecurringRule, Transaction, BalanceCorrection } from '../types/finance';
import { calculateForecast } from '../services/financialEngine';
import { generatePeriodsSequence, getPeriodForDate, formatPeriodRange } from '../services/periodService';

describe('CashPilot - Testy kritické finanční logiky', () => {
  const defaultSettings: AppSettings = {
    currency: 'CZK',
    budgetStartDay: 15,
    minReserveInHaler: 5000000, // 50 000 Kč
    forecastMonths: 12,
    roundAmounts: false,
  };

  const checkingAccount: Account = {
    id: 'acc_checking',
    name: 'Běžný účet',
    type: 'checking',
    currency: 'CZK',
    initialBalanceInHaler: 10000000, // 100 000 Kč
    initialBalanceDate: '2026-09-01',
    isUsableCash: true,
    isNetWorth: true,
    color: '#0284c7',
    sortOrder: 1,
    status: 'active',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  };

  const savingsAccount: Account = {
    id: 'acc_savings',
    name: 'Spořicí účet',
    type: 'savings',
    currency: 'CZK',
    initialBalanceInHaler: 20000000, // 200 000 Kč
    initialBalanceDate: '2026-09-01',
    isUsableCash: true,
    isNetWorth: true,
    color: '#10b981',
    sortOrder: 2,
    status: 'active',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  };

  // 1. Konečný stav jednoho období se správně přenese jako počáteční stav dalšího období
  it('Scénář 1: Konečný stav jednoho období se správně přenese jako počáteční stav dalšího období', () => {
    const periods = generatePeriodsSequence(2026, 9, 3, 15);
    const txs: Transaction[] = [
      {
        id: 'tx1',
        title: 'Mzda',
        amountInHaler: 5000000, // 50 000 Kč příjem
        date: '2026-09-20',
        sequence: 10,
        type: 'income',
        sourceAccountId: 'acc_checking',
        status: 'executed',
        createdAt: '',
        updatedAt: ''
      },
      {
        id: 'tx2',
        title: 'Nájem',
        amountInHaler: 2000000, // 20 000 Kč výdaj
        date: '2026-09-25',
        sequence: 10,
        type: 'expense',
        sourceAccountId: 'acc_checking',
        status: 'executed',
        createdAt: '',
        updatedAt: ''
      }
    ];

    const result = calculateForecast(periods, [checkingAccount], txs, [], [], [], defaultSettings);
    
    // Perioda 0 (Září 2026): Počáteční 100k, Příjmy 50k, Výdaje 20k -> Konečný 130k
    expect(result.periods[0].openingBalanceInHaler).toBe(10000000);
    expect(result.periods[0].closingBalanceInHaler).toBe(13000000);

    // Perioda 1 (Říjen 2026): Počáteční MUSÍ BÝT přesně 130k (konečný stav Periody 0)
    expect(result.periods[1].openingBalanceInHaler).toBe(result.periods[0].closingBalanceInHaler);
    expect(result.periods[1].openingBalanceInHaler).toBe(13000000);

    // Perioda 2 (Listopad 2026): Počáteční musí být konečný stav Periody 1
    expect(result.periods[2].openingBalanceInHaler).toBe(result.periods[1].closingBalanceInHaler);
  });

  // 2. Přidání výdaje do budoucího měsíce ovlivní tento měsíc i všechny následující měsíce
  it('Scénář 2: Přidání výdaje do budoucího měsíce ovlivní tento měsíc i všechny následující měsíce', () => {
    const periods = generatePeriodsSequence(2026, 9, 4, 15);
    
    const baseResult = calculateForecast(periods, [checkingAccount], [], [], [], [], defaultSettings);
    const baseP1Closing = baseResult.periods[1].closingBalanceInHaler;
    const baseP2Opening = baseResult.periods[2].openingBalanceInHaler;
    const baseP2Closing = baseResult.periods[2].closingBalanceInHaler;
    const baseP3Closing = baseResult.periods[3].closingBalanceInHaler;

    const expenseAmount = 2000000;
    const futureExpense: Transaction = {
      id: 'future_tx',
      title: 'Plánovaný nákup',
      amountInHaler: expenseAmount,
      date: '2026-11-20',
      sequence: 10,
      type: 'expense',
      sourceAccountId: 'acc_checking',
      status: 'planned',
      createdAt: '',
      updatedAt: ''
    };

    const newResult = calculateForecast(periods, [checkingAccount], [futureExpense], [], [], [], defaultSettings);

    expect(newResult.periods[0].closingBalanceInHaler).toBe(baseResult.periods[0].closingBalanceInHaler);
    expect(newResult.periods[1].closingBalanceInHaler).toBe(baseP1Closing);

    expect(newResult.periods[2].closingBalanceInHaler).toBe(baseP2Closing - expenseAmount);

    expect(newResult.periods[3].openingBalanceInHaler).toBe(baseP2Opening - expenseAmount);
    expect(newResult.periods[3].closingBalanceInHaler).toBe(baseP3Closing - expenseAmount);
  });

  // 3. Úprava nebo smazání výdaje přepočítá celý navazující forecast
  it('Scénář 3: Úprava nebo smazání výdaje přepočítá celý navazující forecast', () => {
    const periods = generatePeriodsSequence(2026, 9, 4, 15);
    
    const tx: Transaction = {
      id: 'tx_edit',
      title: 'Oprava auta',
      amountInHaler: 1500000, // 15 000 Kč
      date: '2026-10-20', // V Říjnu (perioda 1)
      sequence: 10,
      type: 'expense',
      sourceAccountId: 'acc_checking',
      status: 'planned',
      createdAt: '',
      updatedAt: ''
    };

    const resultWithTx = calculateForecast(periods, [checkingAccount], [tx], [], [], [], defaultSettings);
    expect(resultWithTx.periods[1].closingBalanceInHaler).toBe(10000000 - 1500000);
    expect(resultWithTx.periods[2].openingBalanceInHaler).toBe(10000000 - 1500000);

    const modifiedTx = { ...tx, amountInHaler: 500000 };
    const resultModified = calculateForecast(periods, [checkingAccount], [modifiedTx], [], [], [], defaultSettings);
    expect(resultModified.periods[1].closingBalanceInHaler).toBe(10000000 - 500000);
    expect(resultModified.periods[2].openingBalanceInHaler).toBe(10000000 - 500000);
    expect(resultModified.periods[3].closingBalanceInHaler).toBe(10000000 - 500000);

    const resultDeleted = calculateForecast(periods, [checkingAccount], [], [], [], [], defaultSettings);
    expect(resultDeleted.periods[1].closingBalanceInHaler).toBe(10000000);
    expect(resultDeleted.periods[2].openingBalanceInHaler).toBe(10000000);
    expect(resultDeleted.periods[3].closingBalanceInHaler).toBe(10000000);
  });

  // 4. Převod mezi vlastními účty nezmění celkový majetek
  it('Scénář 4: Převod mezi vlastními účty nezmění celkový majetek', () => {
    const periods = generatePeriodsSequence(2026, 9, 2, 15);
    const initialNetWorth = checkingAccount.initialBalanceInHaler + savingsAccount.initialBalanceInHaler;

    const transferTx: Transaction = {
      id: 'tx_trf',
      title: 'Převod na spoření',
      amountInHaler: 3000000, // 30 000 Kč
      date: '2026-09-22',
      sequence: 10,
      type: 'transfer',
      sourceAccountId: 'acc_checking',
      targetAccountId: 'acc_savings',
      status: 'executed',
      createdAt: '',
      updatedAt: ''
    };

    const result = calculateForecast(periods, [checkingAccount, savingsAccount], [transferTx], [], [], [], defaultSettings);

    expect(result.periods[0].netWorthOpeningInHaler).toBe(initialNetWorth);
    expect(result.periods[0].netWorthClosingInHaler).toBe(initialNetWorth);
    expect(result.periods[0].incomeInHaler).toBe(0);
    expect(result.periods[0].expenseInHaler).toBe(0);
  });

  // 5. Převod správně sníží zdrojový a zvýší cílový účet
  it('Scénář 5: Převod správně sníží zdrojový a zvýší cílový účet', () => {
    const periods = generatePeriodsSequence(2026, 9, 2, 15);
    const transferTx: Transaction = {
      id: 'tx_trf2',
      title: 'Investiční vklad',
      amountInHaler: 2500000, // 25 000 Kč
      date: '2026-09-25',
      sequence: 10,
      type: 'transfer',
      sourceAccountId: 'acc_checking',
      targetAccountId: 'acc_savings',
      status: 'executed',
      createdAt: '',
      updatedAt: ''
    };

    const result = calculateForecast(periods, [checkingAccount, savingsAccount], [transferTx], [], [], [], defaultSettings);

    const checkingBal = result.periods[0].accountBalances['acc_checking'];
    const savingsBal = result.periods[0].accountBalances['acc_savings'];

    expect(checkingBal.transfersOutInHaler).toBe(2500000);
    expect(checkingBal.closingBalanceInHaler).toBe(checkingAccount.initialBalanceInHaler - 2500000);

    expect(savingsBal.transfersInInHaler).toBe(2500000);
    expect(savingsBal.closingBalanceInHaler).toBe(savingsAccount.initialBalanceInHaler + 2500000);
  });

  // 6. Plánovaná položka převedená na skutečnou se nezapočítá dvakrát
  it('Scénář 6: Plánovaná položka převedená na skutečnou se nezapočítá dvakrát', () => {
    const periods = generatePeriodsSequence(2026, 9, 2, 15);

    const salaryRule: RecurringRule = {
      id: 'rule_salary',
      title: 'Mzda',
      amountInHaler: 4500000,
      type: 'income',
      frequency: 'monthly',
      dayOfMonth: 20,
      startDate: '2026-09-15',
      sourceAccountId: 'acc_checking',
      isActive: true,
      createdAt: '',
      updatedAt: ''
    };

    const resultPlanned = calculateForecast(periods, [checkingAccount], [], [salaryRule], [], [], defaultSettings);
    expect(resultPlanned.periods[0].incomeInHaler).toBe(4500000);

    const executedTx: Transaction = {
      id: 'tx_salary_executed',
      title: 'Mzda',
      amountInHaler: 4500000,
      actualAmountInHaler: 4700000,
      date: '2026-09-19',
      sequence: 10,
      type: 'income',
      sourceAccountId: 'acc_checking',
      status: 'executed',
      recurringRuleId: 'rule_salary',
      createdAt: '',
      updatedAt: ''
    };

    const resultExecuted = calculateForecast(periods, [checkingAccount], [executedTx], [salaryRule], [], [], defaultSettings);
    expect(resultExecuted.periods[0].incomeInHaler).toBe(4700000);
    expect(resultExecuted.periods[0].closingBalanceInHaler).toBe(checkingAccount.initialBalanceInHaler + 4700000);
  });

  // 7. Zrušená položka se do forecastu nezapočítá
  it('Scénář 7: Zrušená položka se do forecastu nezapočítá', () => {
    const periods = generatePeriodsSequence(2026, 9, 2, 15);

    const cancelledTx: Transaction = {
      id: 'tx_cancelled',
      title: 'Zrušená dovolená',
      amountInHaler: 3500000, // 35 000 Kč
      date: '2026-09-30',
      sequence: 10,
      type: 'expense',
      sourceAccountId: 'acc_checking',
      status: 'cancelled',
      createdAt: '',
      updatedAt: ''
    };

    const result = calculateForecast(periods, [checkingAccount], [cancelledTx], [], [], [], defaultSettings);

    expect(result.periods[0].expenseInHaler).toBe(0);
    expect(result.periods[0].closingBalanceInHaler).toBe(checkingAccount.initialBalanceInHaler);
  });

  // 8. Výjimka pravidelné položky ovlivní pouze vybraný výskyt
  it('Scénář 8: Výjimka pravidelné položky ovlivní pouze vybraný výskyt', () => {
    const periods = generatePeriodsSequence(2026, 9, 3, 15);

    const rule: RecurringRule = {
      id: 'rule_internet',
      title: 'Internet',
      amountInHaler: 50000, // 500 Kč
      type: 'expense',
      frequency: 'monthly',
      dayOfMonth: 18,
      startDate: '2026-09-15',
      sourceAccountId: 'acc_checking',
      isActive: true,
      createdAt: '',
      updatedAt: ''
    };

    const exception: RecurringException = {
      id: 'ex1',
      ruleId: 'rule_internet',
      periodKey: '2026-10',
      overrideAmountInHaler: 120000,
      createdAt: ''
    };

    const result = calculateForecast(periods, [checkingAccount], [], [rule], [exception], [], defaultSettings);

    expect(result.periods[0].expenseInHaler).toBe(50000);
    expect(result.periods[1].expenseInHaler).toBe(120000);
    expect(result.periods[2].expenseInHaler).toBe(50000);
  });

  // 9. Archivovaný účet zůstane v historických výsledcích
  it('Scénář 9: Archivovaný účet zůstane v historických výsledcích', () => {
    const periods = generatePeriodsSequence(2026, 9, 2, 15);

    const archivedAccount: Account = {
      ...checkingAccount,
      id: 'acc_old',
      name: 'Starý účet',
      status: 'archived',
      initialBalanceInHaler: 1500000, // 15 000 Kč
    };

    const result = calculateForecast(periods, [archivedAccount], [], [], [], [], defaultSettings);

    expect(result.periods[0].accountBalances['acc_old']).toBeDefined();
    expect(result.periods[0].accountBalances['acc_old'].closingBalanceInHaler).toBe(1500000);
    expect(result.periods[0].openingBalanceInHaler).toBe(1500000);
  });

  // 10. Aktualizace skutečného zůstatku vytvoří dohledatelnou korekci
  it('Scénář 10: Aktualizace skutečného zůstatku vytvoří dohledatelnou korekci', () => {
    const periods = generatePeriodsSequence(2026, 9, 3, 15);

    const correction: BalanceCorrection = {
      id: 'corr1',
      accountId: 'acc_checking',
      checkDate: '2026-09-28',
      calculatedBalanceInHaler: 10000000,
      actualBalanceInHaler: 10250000,
      diffInHaler: 250000, // +2500 Kč
      note: 'Kontrola bankovního výpisu',
      createdAt: ''
    };

    const result = calculateForecast(periods, [checkingAccount], [], [], [], [correction], defaultSettings);

    expect(result.periods[0].correctionsInHaler).toBe(250000);
    expect(result.periods[0].closingBalanceInHaler).toBe(10250000);

    expect(result.periods[1].openingBalanceInHaler).toBe(10250000);
    expect(result.periods[2].openingBalanceInHaler).toBe(10250000);
  });

  // 11. Forecast na přelomu roku pokračuje automaticky do dalšího roku
  it('Scénář 11: Forecast na přelomu roku pokračuje automaticky do dalšího roku', () => {
    const periods = generatePeriodsSequence(2026, 9, 12, 15);

    expect(periods).toHaveLength(12);
    expect(periods[0].name).toBe('Září 2026');
    expect(periods[3].name).toBe('Prosinec 2026');
    expect(periods[4].name).toBe('Leden 2027');
    expect(periods[4].year).toBe(2027);
    expect(periods[4].month).toBe(1);
    expect(periods[11].name).toBe('Srpen 2027');

    const result = calculateForecast(periods, [checkingAccount], [], [], [], [], defaultSettings);
    expect(result.periods).toHaveLength(12);
    expect(result.periods[4].openingBalanceInHaler).toBe(result.periods[3].closingBalanceInHaler);
  });

  // 12. Rozpočtové období s počátkem 15. dne správně přiřadí transakce mezi 15. dnem a 14. dnem dalšího měsíce
  it('Scénář 12: Rozpočtové období s počátkem 15. dne správně přiřadí transakce mezi 15. dnem a 14. dnem dalšího měsíce', () => {
    const p1 = getPeriodForDate('2026-09-15', 15);
    expect(p1.key).toBe('2026-09');
    expect(p1.name).toBe('Září 2026');
    expect(p1.startDate).toBe('2026-09-15');
    expect(p1.endDate).toBe('2026-10-14');

    const p2 = getPeriodForDate('2026-10-14', 15);
    expect(p2.key).toBe('2026-09');
    expect(p2.name).toBe('Září 2026');

    const p3 = getPeriodForDate('2026-10-15', 15);
    expect(p3.key).toBe('2026-10');
    expect(p3.name).toBe('Říjen 2026');
    expect(p3.startDate).toBe('2026-10-15');
    expect(p3.endDate).toBe('2026-11-14');

    const p4 = getPeriodForDate('2027-01-10', 15);
    expect(p4.key).toBe('2026-12');
    expect(p4.name).toBe('Prosinec 2026');
  });

  // 13. Výpočet aktuálního období a formátování rozsahu (např. 12. 9. 2026 -> 15. 8. 2026 – 14. 9. 2026)
  it('Scénář 13: Výpočet aktuálního období a textového rozsahu dle dnešního data a startovního dne', () => {
    // 12. 9. 2026 při startDay 15
    const p1 = getPeriodForDate('2026-09-12', 15);
    expect(p1.startDate).toBe('2026-08-15');
    expect(p1.endDate).toBe('2026-09-14');
    expect(p1.name).toBe('Srpen 2026');
    expect(formatPeriodRange(p1)).toBe('15. 8. 2026 – 14. 9. 2026');

    // 15. 9. 2026 při startDay 15
    const p2 = getPeriodForDate('2026-09-15', 15);
    expect(p2.startDate).toBe('2026-09-15');
    expect(p2.endDate).toBe('2026-10-14');
    expect(p2.name).toBe('Září 2026');
    expect(formatPeriodRange(p2)).toBe('15. 9. 2026 – 14. 10. 2026');

    // 12. 9. 2026 při startDay 1 (kalendářní měsíc)
    const p3 = getPeriodForDate('2026-09-12', 1);
    expect(p3.startDate).toBe('2026-09-01');
    expect(p3.endDate).toBe('2026-09-30');
    expect(formatPeriodRange(p3)).toBe('1. 9. 2026 – 30. 9. 2026');
  });

  // 14. Filtr položek: Aktuální období vs Všechny položky
  it('Scénář 14: Filtr transakcí pro Aktuální období vs Všechny položky', () => {
    const currentPeriod = getPeriodForDate('2026-09-12', 15); // 2026-08-15 až 2026-09-14
    const txs: Transaction[] = [
      { id: 'past', title: 'Minulá', amountInHaler: 1000, date: '2026-08-10', sequence: 10, type: 'expense', sourceAccountId: 'acc_checking', status: 'executed', createdAt: '', updatedAt: '' },
      { id: 'curr1', title: 'Aktuální 1', amountInHaler: 2000, date: '2026-08-20', sequence: 10, type: 'expense', sourceAccountId: 'acc_checking', status: 'executed', createdAt: '', updatedAt: '' },
      { id: 'curr2', title: 'Aktuální 2', amountInHaler: 5000, date: '2026-09-10', sequence: 10, type: 'income', sourceAccountId: 'acc_checking', status: 'planned', createdAt: '', updatedAt: '' },
      { id: 'future', title: 'Budoucí', amountInHaler: 3000, date: '2026-10-01', sequence: 10, type: 'expense', sourceAccountId: 'acc_checking', status: 'planned', createdAt: '', updatedAt: '' },
    ];

    // Aktuální období
    const filteredCurrent = txs.filter(t => t.date >= currentPeriod.startDate && t.date <= currentPeriod.endDate);
    expect(filteredCurrent.map(t => t.id)).toEqual(['curr1', 'curr2']);

    // Všechny položky
    const filteredAll = txs;
    expect(filteredAll.map(t => t.id)).toEqual(['past', 'curr1', 'curr2', 'future']);

    // Kombinace s dalším filtrem (např. typ income v aktuálním období)
    const incomeInCurrent = txs.filter(t => t.date >= currentPeriod.startDate && t.date <= currentPeriod.endDate && t.type === 'income');
    expect(incomeInCurrent.map(t => t.id)).toEqual(['curr2']);
  });
});
