import { describe, it, expect } from 'vitest';
import { Account, AppSettings, Transaction, BalanceCorrection, MarketValueSnapshot } from '../types/finance';
import { calculateForecast } from '../services/financialEngine';
import {
  createBudgetPeriod,
  getPeriodForDate,
  generatePeriodsBetween,
  generatePeriodsSequence,
} from '../services/periodService';

describe('CashPilot - Testy přepočtu minulých období a zachování finanční integrity (17 scénářů)', () => {
  const defaultSettings: AppSettings = {
    currency: 'CZK',
    budgetStartDay: 1, // standardní kalendářní měsíc pro většinu testů
    minReserveInHaler: 2000000, // 20 000 Kč
    roundAmounts: false,
  };

  const checkingAccount: Account = {
    id: 'acc_checking',
    name: 'Běžný účet',
    type: 'checking',
    currency: 'CZK',
    initialBalanceInHaler: 10000000, // 100 000 Kč k 2025-01-01
    initialBalanceDate: '2024-01-01',
    isUsableCash: true,
    isNetWorth: true,
    color: '#0284c7',
    sortOrder: 1,
    status: 'active',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  };

  const savingsAccount: Account = {
    id: 'acc_savings',
    name: 'Spořicí účet',
    type: 'savings',
    currency: 'CZK',
    initialBalanceInHaler: 5000000, // 50 000 Kč k 2025-01-01
    initialBalanceDate: '2025-01-01',
    isUsableCash: true,
    isNetWorth: true,
    color: '#10b981',
    sortOrder: 2,
    status: 'active',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  };

  const investmentAccount: Account = {
    id: 'acc_invest',
    name: 'Investiční účet',
    type: 'investment',
    currency: 'CZK',
    initialBalanceInHaler: 20000000, // 200 000 Kč
    initialBalanceDate: '2025-01-01',
    isUsableCash: false,
    isNetWorth: true,
    color: '#8b5cf6',
    sortOrder: 3,
    status: 'active',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  };

  const allAccounts = [checkingAccount, savingsAccount, investmentAccount];

  // Pomocná funkce pro vygenerování souvislé sekvence period
  const getPeriods = (startYear: number, startMonth: number, count: number, startDay: number = 1) =>
    generatePeriodsSequence(startYear, startMonth, count, startDay);

  // 1. Přidání příjmu do předchozího období
  it('Scénář 1: Přidání příjmu do předchozího období přepočítá dotčené i všechna navazující období', () => {
    // Období: 2026-07, 2026-08, 2026-09 (aktuální), 2026-10
    const periods = getPeriods(2026, 7, 4, 1);
    const txBefore: Transaction[] = [];

    const resBefore = calculateForecast(periods, [checkingAccount], txBefore, [], [], [], defaultSettings, [], '2026-09', '2026-09-12');
    const pJulBefore = resBefore.periods.find(p => p.period.key === '2026-07')!;
    const pAugBefore = resBefore.periods.find(p => p.period.key === '2026-08')!;
    const pSepBefore = resBefore.periods.find(p => p.period.key === '2026-09')!;

    expect(pJulBefore.incomeInHaler).toBe(0);
    expect(pJulBefore.closingBalanceInHaler).toBe(10000000);
    expect(pAugBefore.openingBalanceInHaler).toBe(10000000);
    expect(pSepBefore.openingBalanceInHaler).toBe(10000000);

    // Přidáme příjem 30 000 Kč do července (minulost)
    const newTx: Transaction = {
      id: 'tx_income_jul',
      title: 'Bonus z minula',
      amountInHaler: 3000000,
      date: '2026-07-15',
      sequence: 1,
      type: 'income',
      sourceAccountId: 'acc_checking',
      status: 'executed',
      createdAt: '',
      updatedAt: '',
    };

    const resAfter = calculateForecast(periods, [checkingAccount], [newTx], [], [], [], defaultSettings, [], '2026-09', '2026-09-12');
    const pJulAfter = resAfter.periods.find(p => p.period.key === '2026-07')!;
    const pAugAfter = resAfter.periods.find(p => p.period.key === '2026-08')!;
    const pSepAfter = resAfter.periods.find(p => p.period.key === '2026-09')!;

    expect(pJulAfter.incomeInHaler).toBe(3000000);
    expect(pJulAfter.netChangeInHaler).toBe(3000000);
    expect(pJulAfter.closingBalanceInHaler).toBe(13000000);
    // Následující srpen
    expect(pAugAfter.openingBalanceInHaler).toBe(13000000);
    expect(pAugAfter.closingBalanceInHaler).toBe(13000000);
    // Aktuální září
    expect(pSepAfter.openingBalanceInHaler).toBe(13000000);
    expect(pSepAfter.closingBalanceInHaler).toBe(13000000);
  });

  // 2. Přidání výdaje do předchozího období
  it('Scénář 2: Přidání výdaje do předchozího období sníží konečný stav a promítne se do budoucna', () => {
    const periods = getPeriods(2026, 7, 4, 1);
    const expenseTx: Transaction = {
      id: 'tx_exp_jul',
      title: 'Dovolená',
      amountInHaler: 2500000, // 25 000 Kč
      date: '2026-07-20',
      sequence: 1,
      type: 'expense',
      sourceAccountId: 'acc_checking',
      status: 'executed',
      createdAt: '',
      updatedAt: '',
    };

    const res = calculateForecast(periods, [checkingAccount], [expenseTx], [], [], [], defaultSettings, [], '2026-09', '2026-09-12');
    const pJul = res.periods.find(p => p.period.key === '2026-07')!;
    const pAug = res.periods.find(p => p.period.key === '2026-08')!;
    const pSep = res.periods.find(p => p.period.key === '2026-09')!;

    expect(pJul.expenseInHaler).toBe(2500000);
    expect(pJul.netChangeInHaler).toBe(-2500000);
    expect(pJul.closingBalanceInHaler).toBe(7500000);
    expect(pAug.openingBalanceInHaler).toBe(7500000);
    expect(pSep.openingBalanceInHaler).toBe(7500000);
  });

  // 3. Přidání položky několik let do minulosti
  it('Scénář 3: Přidání položky několik let do minulosti (např. 2024) zachová bezchybnou návaznost', () => {
    // Položka v lednu 2024
    const oldTx: Transaction = {
      id: 'tx_old_2024',
      title: 'Historický příjem 2024',
      amountInHaler: 5000000, // 50 000 Kč
      date: '2024-01-15',
      sequence: 1,
      type: 'income',
      sourceAccountId: 'acc_checking',
      status: 'executed',
      createdAt: '',
      updatedAt: '',
    };

    // Vytvoříme sekvenci od 2024-01 do 2026-12 (36 měsíců)
    const periods = getPeriods(2024, 1, 36, 1);
    const res = calculateForecast(periods, [checkingAccount], [oldTx], [], [], [], defaultSettings, [], '2026-09', '2026-09-12');

    expect(res.periods.length).toBe(36);
    // Ověření prvního období 2024-01
    const pJan2024 = res.periods[0];
    expect(pJan2024.period.key).toBe('2024-01');
    expect(pJan2024.incomeInHaler).toBe(5000000);
    expect(pJan2024.closingBalanceInHaler).toBe(15000000);

    // Striktní kontrola pravidla počáteční = předchozí konečný pro všech 35 návazností!
    for (let i = 1; i < res.periods.length; i++) {
      const prev = res.periods[i - 1];
      const cur = res.periods[i];
      expect(cur.openingBalanceInHaler).toBe(prev.closingBalanceInHaler);
    }

    // Aktuální období v září 2026 má správný zvýšený počáteční zůstatek
    const pSep2026 = res.periods.find(p => p.period.key === '2026-09')!;
    expect(pSep2026.openingBalanceInHaler).toBe(15000000);
  });

  // 4. Úprava částky starší položky
  it('Scénář 4: Úprava částky starší položky spolehlivě přepočítá celou časovou osu', () => {
    const periods = getPeriods(2026, 6, 5, 1);
    const txV1: Transaction = {
      id: 'tx_edit_me',
      title: 'Nákup nábytku',
      amountInHaler: 1000000, // 10 000 Kč
      date: '2026-06-10',
      sequence: 1,
      type: 'expense',
      sourceAccountId: 'acc_checking',
      status: 'executed',
      createdAt: '',
      updatedAt: '',
    };

    const resV1 = calculateForecast(periods, [checkingAccount], [txV1], [], [], [], defaultSettings, [], '2026-09', '2026-09-12');
    const pSepV1 = resV1.periods.find(p => p.period.key === '2026-09')!;
    expect(pSepV1.openingBalanceInHaler).toBe(9000000);

    // Uživatel upraví částku na 15 000 Kč
    const txV2: Transaction = {
      ...txV1,
      amountInHaler: 1500000,
      actualAmountInHaler: 1500000,
    };

    const resV2 = calculateForecast(periods, [checkingAccount], [txV2], [], [], [], defaultSettings, [], '2026-09', '2026-09-12');
    const pJunV2 = resV2.periods.find(p => p.period.key === '2026-06')!;
    const pSepV2 = resV2.periods.find(p => p.period.key === '2026-09')!;

    expect(pJunV2.expenseInHaler).toBe(1500000);
    expect(pJunV2.closingBalanceInHaler).toBe(8500000);
    expect(pSepV2.openingBalanceInHaler).toBe(8500000);
  });

  // 5. Změna staršího příjmu na výdaj
  it('Scénář 5: Změna staršího příjmu na výdaj obrátí směr cashflow o celou dvojnásobnou hodnotu', () => {
    const periods = getPeriods(2026, 6, 5, 1);
    const incomeTx: Transaction = {
      id: 'tx_flip',
      title: 'Položka',
      amountInHaler: 2000000, // 20 000 Kč příjem
      date: '2026-06-15',
      sequence: 1,
      type: 'income',
      sourceAccountId: 'acc_checking',
      status: 'executed',
      createdAt: '',
      updatedAt: '',
    };

    const resIncome = calculateForecast(periods, [checkingAccount], [incomeTx], [], [], [], defaultSettings, [], '2026-09', '2026-09-12');
    expect(resIncome.periods.find(p => p.period.key === '2026-09')!.openingBalanceInHaler).toBe(12000000);

    // Změna typu na výdaj
    const expenseTx: Transaction = {
      ...incomeTx,
      type: 'expense',
    };

    const resExpense = calculateForecast(periods, [checkingAccount], [expenseTx], [], [], [], defaultSettings, [], '2026-09', '2026-09-12');
    const pJun = resExpense.periods.find(p => p.period.key === '2026-06')!;
    const pSep = resExpense.periods.find(p => p.period.key === '2026-09')!;

    expect(pJun.incomeInHaler).toBe(0);
    expect(pJun.expenseInHaler).toBe(2000000);
    expect(pJun.closingBalanceInHaler).toBe(8000000);
    expect(pSep.openingBalanceInHaler).toBe(8000000);
  });

  // 6. Přesunutí položky mezi dvěma obdobími změnou data
  it('Scénář 6: Přesunutí položky mezi obdobími změnou data aktualizuje obě dotčená období', () => {
    const periods = getPeriods(2026, 6, 5, 1);
    const txInJune: Transaction = {
      id: 'tx_move',
      title: 'Přesouvaná platba',
      amountInHaler: 1000000, // 10 000 Kč
      date: '2026-06-25',
      sequence: 1,
      type: 'expense',
      sourceAccountId: 'acc_checking',
      status: 'executed',
      createdAt: '',
      updatedAt: '',
    };

    const res1 = calculateForecast(periods, [checkingAccount], [txInJune], [], [], [], defaultSettings, [], '2026-09', '2026-09-12');
    expect(res1.periods.find(p => p.period.key === '2026-06')!.expenseInHaler).toBe(1000000);
    expect(res1.periods.find(p => p.period.key === '2026-07')!.expenseInHaler).toBe(0);
    expect(res1.periods.find(p => p.period.key === '2026-07')!.openingBalanceInHaler).toBe(9000000);

    // Přesun do července
    const txInJuly: Transaction = {
      ...txInJune,
      date: '2026-07-05',
    };

    const res2 = calculateForecast(periods, [checkingAccount], [txInJuly], [], [], [], defaultSettings, [], '2026-09', '2026-09-12');
    const pJun2 = res2.periods.find(p => p.period.key === '2026-06')!;
    const pJul2 = res2.periods.find(p => p.period.key === '2026-07')!;

    expect(pJun2.expenseInHaler).toBe(0);
    expect(pJun2.closingBalanceInHaler).toBe(10000000);
    expect(pJul2.openingBalanceInHaler).toBe(10000000);
    expect(pJul2.expenseInHaler).toBe(1000000);
    expect(pJul2.closingBalanceInHaler).toBe(9000000);
  });

  // 7. Smazání starší položky
  it('Scénář 7: Smazání starší položky odstraní její finanční vliv a přepočítá navazující období', () => {
    const periods = getPeriods(2026, 6, 5, 1);
    const tx1: Transaction = {
      id: 'tx_stay',
      title: 'Mzda',
      amountInHaler: 4000000,
      date: '2026-06-05',
      sequence: 1,
      type: 'income',
      sourceAccountId: 'acc_checking',
      status: 'executed',
      createdAt: '',
      updatedAt: '',
    };
    const tx2: Transaction = {
      id: 'tx_delete_me',
      title: 'Předplatné ke smazání',
      amountInHaler: 500000,
      date: '2026-06-15',
      sequence: 2,
      type: 'expense',
      sourceAccountId: 'acc_checking',
      status: 'executed',
      createdAt: '',
      updatedAt: '',
    };

    const resWithBoth = calculateForecast(periods, [checkingAccount], [tx1, tx2], [], [], [], defaultSettings, [], '2026-09', '2026-09-12');
    expect(resWithBoth.periods.find(p => p.period.key === '2026-06')!.closingBalanceInHaler).toBe(13500000);

    // Smazání tx2
    const resAfterDelete = calculateForecast(periods, [checkingAccount], [tx1], [], [], [], defaultSettings, [], '2026-09', '2026-09-12');
    const pJun = resAfterDelete.periods.find(p => p.period.key === '2026-06')!;
    const pSep = resAfterDelete.periods.find(p => p.period.key === '2026-09')!;

    expect(pJun.expenseInHaler).toBe(0);
    expect(pJun.closingBalanceInHaler).toBe(14000000);
    expect(pSep.openingBalanceInHaler).toBe(14000000);
  });

  // 8. Zrušení a obnovení starší položky
  it('Scénář 8: Zrušení (status: cancelled) a obnovení (status: executed) starší položky', () => {
    const periods = getPeriods(2026, 6, 5, 1);
    const tx: Transaction = {
      id: 'tx_cancel_restore',
      title: 'Služba',
      amountInHaler: 1500000,
      date: '2026-06-20',
      sequence: 1,
      type: 'expense',
      sourceAccountId: 'acc_checking',
      status: 'cancelled',
      createdAt: '',
      updatedAt: '',
    };

    // Stav se zrušenou položkou -> nezapočítává se
    const resCancelled = calculateForecast(periods, [checkingAccount], [tx], [], [], [], defaultSettings, [], '2026-09', '2026-09-12');
    expect(resCancelled.periods.find(p => p.period.key === '2026-06')!.expenseInHaler).toBe(0);
    expect(resCancelled.periods.find(p => p.period.key === '2026-06')!.closingBalanceInHaler).toBe(10000000);

    // Obnovení položky
    const txRestored: Transaction = {
      ...tx,
      status: 'executed',
    };

    const resRestored = calculateForecast(periods, [checkingAccount], [txRestored], [], [], [], defaultSettings, [], '2026-09', '2026-09-12');
    expect(resRestored.periods.find(p => p.period.key === '2026-06')!.expenseInHaler).toBe(1500000);
    expect(resRestored.periods.find(p => p.period.key === '2026-06')!.closingBalanceInHaler).toBe(8500000);
  });

  // 9. Aktualizace součtů kategorií
  it('Scénář 9: Položka v minulém období má správné přiřazení ke kategorii a nezdvojuje se', () => {
    const txs: Transaction[] = [
      {
        id: 'tx_cat1',
        title: 'Nákup v supermarketu',
        amountInHaler: 120000, // 1 200 Kč
        date: '2026-06-10',
        sequence: 1,
        type: 'expense',
        categoryId: 'cat_food',
        subcategoryId: 'sub_groceries',
        sourceAccountId: 'acc_checking',
        status: 'executed',
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'tx_cat2',
        title: 'Restaurace',
        amountInHaler: 80000, // 800 Kč
        date: '2026-06-22',
        sequence: 2,
        type: 'expense',
        categoryId: 'cat_food',
        subcategoryId: 'sub_restaurant',
        sourceAccountId: 'acc_checking',
        status: 'executed',
        createdAt: '',
        updatedAt: '',
      }
    ];

    const periods = getPeriods(2026, 6, 4, 1);
    const res = calculateForecast(periods, [checkingAccount], txs, [], [], [], defaultSettings, [], '2026-09', '2026-09-12');
    const pJun = res.periods.find(p => p.period.key === '2026-06')!;
    expect(pJun.expenseInHaler).toBe(200000); // 2 000 Kč celkem
  });

  // 10. Aktualizace konečného stavu dotčeného období
  it('Scénář 10: Aktualizace konečného stavu dotčeného období přesně odpovídá součtu pohybů', () => {
    const periods = getPeriods(2026, 7, 4, 1);
    const txs: Transaction[] = [
      {
        id: 'tx_in',
        title: 'Příjem',
        amountInHaler: 1000000, // +10 000 Kč
        date: '2026-07-02',
        sequence: 1,
        type: 'income',
        sourceAccountId: 'acc_checking',
        status: 'executed',
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'tx_out',
        title: 'Výdaj',
        amountInHaler: 400000, // -4 000 Kč
        date: '2026-07-18',
        sequence: 2,
        type: 'expense',
        sourceAccountId: 'acc_checking',
        status: 'executed',
        createdAt: '',
        updatedAt: '',
      }
    ];

    const res = calculateForecast(periods, [checkingAccount], txs, [], [], [], defaultSettings, [], '2026-09', '2026-09-12');
    const pJul = res.periods.find(p => p.period.key === '2026-07')!;

    expect(pJul.openingBalanceInHaler).toBe(10000000);
    expect(pJul.incomeInHaler).toBe(1000000);
    expect(pJul.expenseInHaler).toBe(400000);
    expect(pJul.netChangeInHaler).toBe(600000);
    expect(pJul.closingBalanceInHaler).toBe(10600000);
  });

  // 11. Zachování správného počátečního stavu dotčeného období
  it('Scénář 11: Vložení položky dovnitř minulého období nezmění jeho vlastní počáteční stav', () => {
    const periods = getPeriods(2026, 7, 4, 1);
    // Červenec má počáteční stav 100 000 Kč z předchozího stavu
    const resWithout = calculateForecast(periods, [checkingAccount], [], [], [], [], defaultSettings, [], '2026-09', '2026-09-12');
    const initialOpening = resWithout.periods.find(p => p.period.key === '2026-07')!.openingBalanceInHaler;

    const tx: Transaction = {
      id: 'tx_mid_month',
      title: 'Nákup v půlce měsíce',
      amountInHaler: 1500000,
      date: '2026-07-15',
      sequence: 1,
      type: 'expense',
      sourceAccountId: 'acc_checking',
      status: 'executed',
      createdAt: '',
      updatedAt: '',
    };

    const resWith = calculateForecast(periods, [checkingAccount], [tx], [], [], [], defaultSettings, [], '2026-09', '2026-09-12');
    const pJulWith = resWith.periods.find(p => p.period.key === '2026-07')!;

    // Počáteční stav července zůstává beze změny!
    expect(pJulWith.openingBalanceInHaler).toBe(initialOpening);
    // Ale konečný stav se změnil:
    expect(pJulWith.closingBalanceInHaler).toBe(initialOpening - 1500000);
  });

  // 12. Aktualizace počátečních a konečných stavů všech následujících období
  it('Scénář 12: Řetězová návaznost počátečních a konečných stavů všech následujících období', () => {
    const periods = getPeriods(2026, 5, 8, 1);
    const pastTx: Transaction = {
      id: 'tx_chain',
      title: 'Příjem v květnu',
      amountInHaler: 5000000, // +50 000 Kč
      date: '2026-05-10',
      sequence: 1,
      type: 'income',
      sourceAccountId: 'acc_checking',
      status: 'executed',
      createdAt: '',
      updatedAt: '',
    };

    const res = calculateForecast(periods, [checkingAccount], [pastTx], [], [], [], defaultSettings, [], '2026-09', '2026-09-12');

    // Každé období musí začínat přesně tím, čím skončilo předchozí
    for (let i = 1; i < res.periods.length; i++) {
      const prev = res.periods[i - 1];
      const cur = res.periods[i];
      expect(cur.openingBalanceInHaler).toBe(prev.closingBalanceInHaler);
    }

    // A od května 2026 (index 0) jsou všechny stavy o 50 000 Kč vyšší
    expect(res.periods[0].closingBalanceInHaler).toBe(15000000);
    for (let i = 1; i < res.periods.length; i++) {
      expect(res.periods[i].openingBalanceInHaler).toBe(15000000);
      expect(res.periods[i].closingBalanceInHaler).toBe(15000000);
    }
  });

  // 13. Aktualizace aktuálního období a forecastu
  it('Scénář 13: Aktualizace položky v minulosti okamžitě aktualizuje usableCashNowInHaler a expectedClosingCurrentPeriodInHaler', () => {
    const periods = getPeriods(2026, 7, 6, 1);
    const txBefore: Transaction[] = [];
    const res1 = calculateForecast(periods, [checkingAccount], txBefore, [], [], [], defaultSettings, [], '2026-09', '2026-09-12');

    expect(res1.usableCashNowInHaler).toBe(10000000);
    expect(res1.expectedClosingCurrentPeriodInHaler).toBe(10000000);

    // Přidáme minulý příjem 20 000 Kč do července
    const pastIncome: Transaction = {
      id: 'tx_past_inc',
      title: 'Příjem červenec',
      amountInHaler: 2000000,
      date: '2026-07-10',
      sequence: 1,
      type: 'income',
      sourceAccountId: 'acc_checking',
      status: 'executed',
      createdAt: '',
      updatedAt: '',
    };

    const res2 = calculateForecast(periods, [checkingAccount], [pastIncome], [], [], [], defaultSettings, [], '2026-09', '2026-09-12');
    expect(res2.usableCashNowInHaler).toBe(12000000);
    expect(res2.expectedClosingCurrentPeriodInHaler).toBe(12000000);
    expect(res2.periods.find(p => p.period.key === '2026-09')!.closingBalanceInHaler).toBe(12000000);
  });

  // 14. Zachování výsledků po obnovení stránky / deterministický výpočet
  it('Scénář 14: Opakovaný běh výpočtu nad identickými daty poskytuje 100% deterministický výsledek', () => {
    const periods = getPeriods(2026, 5, 8, 1);
    const txs: Transaction[] = [
      {
        id: 'tx1',
        title: 'Příjem',
        amountInHaler: 3000000,
        date: '2026-05-15',
        sequence: 1,
        type: 'income',
        sourceAccountId: 'acc_checking',
        status: 'executed',
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'tx2',
        title: 'Výdaj',
        amountInHaler: 1200000,
        date: '2026-07-20',
        sequence: 1,
        type: 'expense',
        sourceAccountId: 'acc_checking',
        status: 'executed',
        createdAt: '',
        updatedAt: '',
      }
    ];

    const run1 = calculateForecast(periods, [checkingAccount], txs, [], [], [], defaultSettings, [], '2026-09', '2026-09-12');
    const run2 = calculateForecast(periods, [checkingAccount], txs, [], [], [], defaultSettings, [], '2026-09', '2026-09-12');

    expect(run1.periods).toEqual(run2.periods);
    expect(run1.usableCashNowInHaler).toBe(run2.usableCashNowInHaler);
    expect(run1.netWorthNowInHaler).toBe(run2.netWorthNowInHaler);
  });

  // 15. Správné zařazení podle vlastního počátečního dne období (např. 15. den v měsíci)
  it('Scénář 15: Vlastní počáteční den (15): datum 10. 10. patří do období 15. 9. – 14. 10.', () => {
    const settingsDay15: AppSettings = {
      ...defaultSettings,
      budgetStartDay: 15,
    };

    // Ověření periodService: getPeriodForDate
    const pOct10 = getPeriodForDate('2026-10-10', 15);
    expect(pOct10.year).toBe(2026);
    expect(pOct10.month).toBe(9); // Spadá do záříjové periody (15. 9. - 14. 10.)
    expect(pOct10.startDate).toBe('2026-09-15');
    expect(pOct10.endDate).toBe('2026-10-14');

    const pOct15 = getPeriodForDate('2026-10-15', 15);
    expect(pOct15.year).toBe(2026);
    expect(pOct15.month).toBe(10); // Spadá do říjnové periody (15. 10. - 14. 11.)
    expect(pOct15.startDate).toBe('2026-10-15');
    expect(pOct15.endDate).toBe('2026-11-14');

    // Nyní otestujeme v calculateForecast
    const periodsDay15 = generatePeriodsSequence(2026, 9, 3, 15);
    const txOnOct10: Transaction = {
      id: 'tx_oct10',
      title: 'Výdaj 10. října',
      amountInHaler: 1500000,
      date: '2026-10-10',
      sequence: 1,
      type: 'expense',
      sourceAccountId: 'acc_checking',
      status: 'executed',
      createdAt: '',
      updatedAt: '',
    };

    const res = calculateForecast(periodsDay15, [checkingAccount], [txOnOct10], [], [], [], settingsDay15, [], '2026-09', '2026-09-20');
    const pSep = res.periods.find(p => p.period.key === '2026-09')!;
    const pOct = res.periods.find(p => p.period.key === '2026-10')!;

    // Výdaj z 10. 10. se musí započítat do období 2026-09!
    expect(pSep.expenseInHaler).toBe(1500000);
    expect(pOct.expenseInHaler).toBe(0);
    expect(pOct.openingBalanceInHaler).toBe(pSep.closingBalanceInHaler);
  });

  // 16. Nezapočítání převodů, korekcí a tržních hodnot mezi příjmy a výdaje
  it('Scénář 16: Převody, korekce a tržní hodnoty se nezapočítávají do celkových příjmů ani výdajů', () => {
    const periods = getPeriods(2026, 7, 4, 1);
    const transferTx: Transaction = {
      id: 'tx_transfer',
      title: 'Převod na spořicí',
      amountInHaler: 2000000, // 20 000 Kč
      date: '2026-07-10',
      sequence: 1,
      type: 'transfer',
      sourceAccountId: 'acc_checking',
      targetAccountId: 'acc_savings',
      status: 'executed',
      createdAt: '',
      updatedAt: '',
    };

    const correction: BalanceCorrection = {
      id: 'corr_1',
      accountId: 'acc_checking',
      checkDate: '2026-07-12',
      actualBalanceInHaler: 8500000,
      diffInHaler: 500000, // +5 000 Kč
      calculatedBalanceInHaler: 8000000,
      type: 'balance_adjustment',
      createdAt: '',
      updatedAt: '',
    };

    const marketSnapshot: MarketValueSnapshot = {
      id: 'snap_1',
      accountId: 'acc_invest',
      date: '2026-07-20',
      marketValueInHaler: 25000000, // 250 000 Kč
      createdAt: '',
      updatedAt: '',
    };

    const res = calculateForecast(
      periods,
      allAccounts,
      [transferTx],
      [],
      [],
      [correction],
      defaultSettings,
      [marketSnapshot],
      '2026-09',
      '2026-09-12'
    );

    const pJul = res.periods.find(p => p.period.key === '2026-07')!;

    // Přísná kontrola: příjmy a výdaje musí být 0!
    expect(pJul.incomeInHaler).toBe(0);
    expect(pJul.expenseInHaler).toBe(0);

    // Převody a korekce jsou v samostatných agregátech:
    expect(pJul.transfersInHaler).toBe(2000000);
    expect(pJul.correctionsInHaler).toBe(500000);

    // Běžný účet: 100 000 Kč počáteční - 20 000 Kč převod + 5 000 Kč korekce = 85 000 Kč
    expect(pJul.accountBalances['acc_checking'].closingBalanceInHaler).toBe(8500000);
    // Spořicí účet: 50 000 Kč + 20 000 Kč = 70 000 Kč
    expect(pJul.accountBalances['acc_savings'].closingBalanceInHaler).toBe(7000000);
    // Investiční účet: přeceněn na 250 000 Kč
    expect(pJul.accountBalances['acc_invest'].closingBalanceInHaler).toBe(25000000);

    // Celkový konečný stav: 85k + 70k + 250k = 405k Kč
    expect(pJul.closingBalanceInHaler).toBe(40500000);
  });

  // 17. Správné fungování samostatně pro každý účet
  it('Scénář 17: Transakce na jednom účtu ovlivní pouze daný účet a ostatní účty zůstanou beze změny', () => {
    const periods = getPeriods(2026, 7, 4, 1);
    const txChecking: Transaction = {
      id: 'tx_chk',
      title: 'Platba z běžného účtu',
      amountInHaler: 1500000,
      date: '2026-07-05',
      sequence: 1,
      type: 'expense',
      sourceAccountId: 'acc_checking',
      status: 'executed',
      createdAt: '',
      updatedAt: '',
    };

    const res = calculateForecast(
      periods,
      [checkingAccount, savingsAccount],
      [txChecking],
      [],
      [],
      [],
      defaultSettings,
      [],
      '2026-09',
      '2026-09-12'
    );

    const pJul = res.periods.find(p => p.period.key === '2026-07')!;
    const pAug = res.periods.find(p => p.period.key === '2026-08')!;

    // Běžný účet klesl
    expect(pJul.accountBalances['acc_checking'].closingBalanceInHaler).toBe(8500000);
    expect(pAug.accountBalances['acc_checking'].openingBalanceInHaler).toBe(8500000);

    // Spořicí účet zůstal netknutý
    expect(pJul.accountBalances['acc_savings'].closingBalanceInHaler).toBe(5000000);
    expect(pAug.accountBalances['acc_savings'].openingBalanceInHaler).toBe(5000000);
  });

  // Doplňkový test: generatePeriodsBetween
  it('generatePeriodsBetween zajistí souvislou posloupnost period mezi minulým a budoucím obdobím', () => {
    const pStart = createBudgetPeriod(2024, 6, 15);
    const pEnd = createBudgetPeriod(2025, 2, 15);

    const sequence = generatePeriodsBetween(pStart, pEnd, 15);
    expect(sequence.length).toBe(9);
    expect(sequence[0].key).toBe('2024-06');
    expect(sequence[sequence.length - 1].key).toBe('2025-02');

    // Žádné mezery mezi daty
    for (let i = 1; i < sequence.length; i++) {
      const prev = sequence[i - 1];
      const cur = sequence[i];
      expect(cur.startDate > prev.startDate).toBe(true);
    }
  });
});
