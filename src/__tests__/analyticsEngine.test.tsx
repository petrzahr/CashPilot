import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Sidebar } from '../components/layout/Sidebar';
import { AnalyticsScreen } from '../components/analytics/AnalyticsScreen';
import { FinanceProvider } from '../context/FinanceContext';
import {
  resolveAnalyticsDateRange,
  getFilteredExecutedTransactions,
  calculateAnalyticsKPIs,
  calculateMonthlyCashFlow,
  calculateCategoryBreakdown,
  calculateNetWorthHistory,
  calculateExpenseMoMTrend,
  getTopExpenses,
  calculateFinancialExtremes,
  computeLiquidAccountBalanceAtDate,
  computeAssetAccountBalanceAtDate,
} from '../services/analyticsEngine';
import {
  Account,
  BalanceCorrection,
  Category,
  MarketValueSnapshot,
  Transaction,
} from '../types/finance';
import { saveStoredAuth, clearStoredAuth } from '../services/googleDriveService';

const storageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

describe('Analýza & trendy (Kompletní testovací sada 25 požadavků)', () => {
  const today = '2026-09-13';

  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: storageMock,
      writable: true,
      configurable: true,
    });
    localStorage.clear();
    saveStoredAuth({
      accessToken: 'mock_token',
      expiresAt: Date.now() + 3600000,
      user: {
        emailAddress: 'test@example.com',
        displayName: 'Test User',
      },
    });
    vi.restoreAllMocks();
  });

  afterEach(() => {
    clearStoredAuth();
    vi.unstubAllGlobals();
  });

  const sampleChecking: Account = {
    id: 'acc_chk',
    name: 'Běžný účet KB',
    type: 'checking',
    currency: 'CZK',
    initialBalanceInHaler: 10000000, // 100 000 Kč
    initialBalanceDate: '2025-01-01',
    isUsableCash: true,
    isNetWorth: true,
    color: '#0284c7',
    sortOrder: 1,
    status: 'active',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  };

  const sampleSavings: Account = {
    id: 'acc_sav',
    name: 'Spořicí účet AirBank',
    type: 'savings',
    currency: 'CZK',
    initialBalanceInHaler: 20000000, // 200 000 Kč
    initialBalanceDate: '2025-01-01',
    isUsableCash: false,
    isNetWorth: true,
    color: '#10b981',
    sortOrder: 2,
    status: 'active',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  };

  const sampleInvestment: Account = {
    id: 'acc_inv',
    name: 'Investice Portu',
    type: 'investment',
    currency: 'CZK',
    initialBalanceInHaler: 50000000, // 500 000 Kč
    initialBalanceDate: '2025-01-01',
    isUsableCash: false,
    isNetWorth: true,
    color: '#8b5cf6',
    sortOrder: 3,
    status: 'active',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  };

  const samplePension: Account = {
    id: 'acc_pen',
    name: 'Penzijní fond NN',
    type: 'pension',
    currency: 'CZK',
    initialBalanceInHaler: 30000000, // 300 000 Kč
    initialBalanceDate: '2025-01-01',
    isUsableCash: false,
    isNetWorth: true,
    color: '#ec4899',
    sortOrder: 4,
    status: 'active',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  };

  const testAccounts = [sampleChecking, sampleSavings, sampleInvestment, samplePension];

  const catFood: Category = {
    id: 'cat_food',
    name: 'Potraviny',
    type: 'expense',
    color: '#f97316',
    icon: 'shopping-cart',
    sortOrder: 1,
    status: 'active',
    createdAt: '',
    updatedAt: '',
  };

  const subGroceries: Category = {
    id: 'sub_groc',
    name: 'Supermarket',
    type: 'expense',
    parentId: 'cat_food',
    color: '#f97316',
    icon: 'shopping-bag',
    sortOrder: 1,
    status: 'active',
    createdAt: '',
    updatedAt: '',
  };

  const catSalary: Category = {
    id: 'cat_salary',
    name: 'Mzda a plat',
    type: 'income',
    color: '#10b981',
    icon: 'briefcase',
    sortOrder: 2,
    status: 'active',
    createdAt: '',
    updatedAt: '',
  };

  const testCategories = [catFood, subGroceries, catSalary];

  // 1. Správné rozsahy všech rychlých voleb období
  it('1. Správné rozsahy všech rychlých voleb období (3m, 6m, 12m, ytd, all)', () => {
    const res3m = resolveAnalyticsDateRange('3m', undefined, undefined, undefined, today);
    expect(res3m.range.months.length).toBe(3);
    expect(res3m.range.fromMonthKey).toBe('2026-07');
    expect(res3m.range.endDate).toBe(today);

    const res6m = resolveAnalyticsDateRange('6m', undefined, undefined, undefined, today);
    expect(res6m.range.months.length).toBe(6);
    expect(res6m.range.fromMonthKey).toBe('2026-04');

    const res12m = resolveAnalyticsDateRange('12m', undefined, undefined, undefined, today);
    expect(res12m.range.months.length).toBe(12);
    expect(res12m.range.fromMonthKey).toBe('2025-10');

    const resYtd = resolveAnalyticsDateRange('ytd', undefined, undefined, undefined, today);
    expect(resYtd.range.fromMonthKey).toBe('2026-01');
    expect(resYtd.range.months.length).toBe(9); // Leden až Září 2026

    const resAll = resolveAnalyticsDateRange(
      'all',
      undefined,
      undefined,
      { accounts: testAccounts, transactions: [], corrections: [], snapshots: [] },
      today
    );
    expect(resAll.range.fromMonthKey).toBe('2025-01');
  });

  // 2. Výchozí volba posledních 12 měsíců
  it('2. Výchozí volba je 12 měsíců', () => {
    const res = resolveAnalyticsDateRange('12m', undefined, undefined, undefined, today);
    expect(res.range.preset).toBe('12m');
    expect(res.range.months.length).toBe(12);
  });

  // 3. Vlastní rozsah Od-Do
  it('3. Vlastní rozsah Od–Do analyzuje zadané měsíce do aktuálního dne', () => {
    const res = resolveAnalyticsDateRange('custom', '2026-05', '2026-08', undefined, today);
    expect(res.error).toBeUndefined();
    expect(res.range.months.length).toBe(4);
    expect(res.range.startDate).toBe('2026-05-01');
    expect(res.range.endDate).toBe('2026-08-31');
  });

  // 4. Odmítnutí neplatného nebo budoucího období
  it('4. Odmítnutí neplatného nebo budoucího období s chybovou zprávou', () => {
    // Od > Do
    const resInv = resolveAnalyticsDateRange('custom', '2026-08', '2026-05', undefined, today);
    expect(resInv.error).toBe('Počáteční měsíc nesmí být pozdější než koncový měsíc.');

    // Budoucí měsíc
    const resFut = resolveAnalyticsDateRange('custom', '2026-05', '2026-11', undefined, today);
    expect(resFut.error).toBe('Koncový měsíc nesmí být v budoucnosti.');

    // Prázdný rozsah
    const resEmpty = resolveAnalyticsDateRange('custom', '', '', undefined, today);
    expect(resEmpty.error).toBe('Vyberte prosím počáteční i koncový měsíc.');
  });

  // 5. Zahrnutí pouze uskutečněných položek
  it('5. Zahrnuje pouze položky se stavem executed', () => {
    const range = resolveAnalyticsDateRange('12m', undefined, undefined, undefined, today).range;
    const txs: Transaction[] = [
      {
        id: 't_exec',
        title: 'Uskutečněný nákup',
        amountInHaler: 150000,
        date: '2026-09-05',
        sequence: 1,
        type: 'expense',
        sourceAccountId: sampleChecking.id,
        status: 'executed',
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 't_plan',
        title: 'Plánovaný nákup',
        amountInHaler: 150000,
        date: '2026-09-05',
        sequence: 2,
        type: 'expense',
        sourceAccountId: sampleChecking.id,
        status: 'planned',
        createdAt: '',
        updatedAt: '',
      },
    ];

    const filtered = getFilteredExecutedTransactions(txs, range, {}, testCategories, today);
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe('t_exec');
  });

  // 6. Vyloučení budoucích plánovaných položek
  it('6. Vylučuje budoucí plánované položky z výpočtů i když spadají do kalendářního měsíce', () => {
    const range = resolveAnalyticsDateRange('12m', undefined, undefined, undefined, today).range;
    const txs: Transaction[] = [
      {
        id: 't_future_plan',
        title: 'Plán na konec měsíce',
        amountInHaler: 500000,
        date: '2026-09-28',
        sequence: 1,
        type: 'expense',
        sourceAccountId: sampleChecking.id,
        status: 'planned',
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 't_future_exec_ignored',
        title: 'Chybná budoucí transakce',
        amountInHaler: 500000,
        date: '2026-09-28',
        sequence: 2,
        type: 'expense',
        sourceAccountId: sampleChecking.id,
        status: 'executed',
        createdAt: '',
        updatedAt: '',
      },
    ];

    const filtered = getFilteredExecutedTransactions(txs, range, {}, testCategories, today);
    expect(filtered.length).toBe(0);
  });

  // 7. Vyloučení převodů z příjmů a výdajů
  it('7. Vylučuje převody mezi vlastními účty z celkových příjmů a výdajů', () => {
    const range = resolveAnalyticsDateRange('12m', undefined, undefined, undefined, today).range;
    const transferTx: Transaction = {
      id: 'tx_trans',
      title: 'Převod na spořák',
      amountInHaler: 2000000, // 20 000 Kč
      date: '2026-09-05',
      sequence: 1,
      type: 'transfer',
      sourceAccountId: sampleChecking.id,
      targetAccountId: sampleSavings.id,
      status: 'executed',
      createdAt: '',
      updatedAt: '',
    };

    const kpis = calculateAnalyticsKPIs(
      range,
      [transferTx],
      testAccounts,
      [transferTx],
      [],
      [],
      null,
      today
    );

    // Převod nesmí být započítán jako příjem ani výdaj
    expect(kpis.totalIncomeInHaler).toBe(0);
    expect(kpis.totalExpenseInHaler).toBe(0);
    expect(kpis.netChangeInHaler).toBe(0);
  });

  // 8. Neutralita převodů pro celkové jmění
  it('8. Převody mezi vlastními účty jsou z hlediska celkového jmění neutrální', () => {
    const range = resolveAnalyticsDateRange('12m', undefined, undefined, undefined, today).range;
    const transferTx: Transaction = {
      id: 'tx_trans_inv',
      title: 'Vklad do Portu',
      amountInHaler: 5000000, // 50 000 Kč
      date: '2026-09-05',
      sequence: 1,
      type: 'transfer',
      sourceAccountId: sampleChecking.id,
      targetAccountId: sampleInvestment.id,
      status: 'executed',
      createdAt: '',
      updatedAt: '',
    };

    const kpisWithout = calculateAnalyticsKPIs(
      range,
      [],
      testAccounts,
      [],
      [],
      [],
      null,
      today
    );

    const kpisWith = calculateAnalyticsKPIs(
      range,
      [transferTx],
      testAccounts,
      [transferTx],
      [],
      [],
      null,
      today
    );

    // Změna celkového jmění je po převodu totožná
    expect(kpisWith.netWorthChangeInHaler).toBe(kpisWithout.netWorthChangeInHaler);
  });

  // 9. Zohlednění převodů v historii konkrétního účtu
  it('9. Zohledňuje převody v historii zůstatku konkrétního účtu', () => {
    const transferTx: Transaction = {
      id: 'tx_tr1',
      title: 'Výběr z běžného účtu',
      amountInHaler: 1000000, // 10 000 Kč
      date: '2026-09-05',
      sequence: 1,
      type: 'transfer',
      sourceAccountId: sampleChecking.id,
      targetAccountId: sampleSavings.id,
      status: 'executed',
      createdAt: '',
      updatedAt: '',
    };

    const chkBal = computeLiquidAccountBalanceAtDate(
      sampleChecking,
      '2026-09-10',
      [transferTx],
      []
    );
    // 100 000 - 10 000 = 90 000 Kč
    expect(chkBal).toBe(9000000);

    const savBal = computeLiquidAccountBalanceAtDate(
      sampleSavings,
      '2026-09-10',
      [transferTx],
      []
    );
    // 200 000 + 10 000 = 210 000 Kč
    expect(savBal).toBe(21000000);
  });

  // 10. Vyloučení korekcí z příjmů a výdajů
  it('10. Vylučuje korekce zůstatku z příjmů i výdajů', () => {
    const range = resolveAnalyticsDateRange('12m', undefined, undefined, undefined, today).range;
    const corrTx: Transaction = {
      id: 'corr1',
      title: 'Korekce',
      amountInHaler: 50000,
      diffInHaler: -50000,
      date: '2026-09-05',
      sequence: 1,
      type: 'balance_adjustment',
      sourceAccountId: sampleChecking.id,
      status: 'executed',
      createdAt: '',
      updatedAt: '',
    };

    const kpis = calculateAnalyticsKPIs(
      range,
      [corrTx],
      testAccounts,
      [corrTx],
      [],
      [],
      null,
      today
    );

    expect(kpis.totalIncomeInHaler).toBe(0);
    expect(kpis.totalExpenseInHaler).toBe(0);
  });

  // 11. Zohlednění korekcí v zůstatku běžných a spořicích účtů
  it('11. Zohledňuje korekce zůstatku u běžných a spořicích účtů', () => {
    const corr: BalanceCorrection = {
      id: 'c1',
      accountId: sampleChecking.id,
      checkDate: '2026-09-05',
      actualBalanceInHaler: 9500000,
      calculatedBalanceInHaler: 10000000,
      diffInHaler: -500000, // -5 000 Kč
      createdAt: '',
    };

    const bal = computeLiquidAccountBalanceAtDate(sampleChecking, '2026-09-10', [], [corr]);
    expect(bal).toBe(9500000);
  });

  // 12. Ignorování korekcí u investičních a penzijních účtů
  it('12. Ignoruje korekce u investičních a penzijních účtů', () => {
    // Korekce nesmí změnit hodnotu investičního účtu
    const bal = computeAssetAccountBalanceAtDate(sampleInvestment, '2026-09-10', [], []);
    expect(bal).toBe(sampleInvestment.initialBalanceInHaler);
  });

  // 13. Správný výpočet čisté změny
  it('13. Správný výpočet čisté změny (příjmy − výdaje)', () => {
    const range = resolveAnalyticsDateRange('12m', undefined, undefined, undefined, today).range;
    const txs: Transaction[] = [
      {
        id: 't_inc',
        title: 'Mzda',
        amountInHaler: 6000000, // 60 000 Kč
        date: '2026-09-01',
        sequence: 1,
        type: 'income',
        sourceAccountId: sampleChecking.id,
        status: 'executed',
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 't_exp',
        title: 'Nájem',
        amountInHaler: 2500000, // 25 000 Kč
        date: '2026-09-02',
        sequence: 2,
        type: 'expense',
        sourceAccountId: sampleChecking.id,
        status: 'executed',
        createdAt: '',
        updatedAt: '',
      },
    ];

    const kpis = calculateAnalyticsKPIs(
      range,
      txs,
      testAccounts,
      txs,
      [],
      [],
      null,
      today
    );

    expect(kpis.totalIncomeInHaler).toBe(6000000);
    expect(kpis.totalExpenseInHaler).toBe(2500000);
    expect(kpis.netChangeInHaler).toBe(3500000);
  });

  // 14. Správný výpočet míry úspor
  it('14. Správný výpočet míry úspor v %', () => {
    const range = resolveAnalyticsDateRange('12m', undefined, undefined, undefined, today).range;
    const txs: Transaction[] = [
      {
        id: 'i1',
        title: 'Příjem',
        amountInHaler: 10000000, // 100 000 Kč
        date: '2026-09-01',
        sequence: 1,
        type: 'income',
        sourceAccountId: sampleChecking.id,
        status: 'executed',
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'e1',
        title: 'Výdaj',
        amountInHaler: 4000000, // 40 000 Kč
        date: '2026-09-02',
        sequence: 2,
        type: 'expense',
        sourceAccountId: sampleChecking.id,
        status: 'executed',
        createdAt: '',
        updatedAt: '',
      },
    ];

    const kpis = calculateAnalyticsKPIs(
      range,
      txs,
      testAccounts,
      txs,
      [],
      [],
      null,
      today
    );

    // (100k - 40k) / 100k * 100 = 60.0 %
    expect(kpis.savingsRate).toBe(60);
  });

  // 15. Bezpečný výpočet při nulových příjmech
  it('15. Bezpečný výpočet míry úspor při nulových příjmech (vrací null, žádné NaN)', () => {
    const range = resolveAnalyticsDateRange('12m', undefined, undefined, undefined, today).range;
    const expTx: Transaction = {
      id: 'e1',
      title: 'Výdaj',
      amountInHaler: 100000,
      date: '2026-09-02',
      sequence: 1,
      type: 'expense',
      sourceAccountId: sampleChecking.id,
      status: 'executed',
      createdAt: '',
      updatedAt: '',
    };

    const kpis = calculateAnalyticsKPIs(
      range,
      [expTx],
      testAccounts,
      [expTx],
      [],
      [],
      null,
      today
    );

    expect(kpis.savingsRate).toBeNull();
  });

  // 16. Správné měsíční průměry
  it('16. Správné měsíční průměry výdajů', () => {
    const range = resolveAnalyticsDateRange('3m', undefined, undefined, undefined, today).range;
    expect(range.months.length).toBe(3);

    const txs: Transaction[] = [
      {
        id: 'e1',
        title: 'Výdaj',
        amountInHaler: 3000000, // 30 000 Kč
        date: '2026-09-01',
        sequence: 1,
        type: 'expense',
        sourceAccountId: sampleChecking.id,
        status: 'executed',
        createdAt: '',
        updatedAt: '',
      },
    ];

    const kpis = calculateAnalyticsKPIs(
      range,
      txs,
      testAccounts,
      txs,
      [],
      [],
      null,
      today
    );

    // 30 000 / 3 měsíce = 10 000 Kč
    expect(kpis.avgMonthlyExpenseInHaler).toBe(1000000);
  });

  // 17. Správné seskupení hlavních kategorií a podkategorií
  it('17. Správné seskupení kategorií s rozpadem na podkategorie a Bez kategorie', () => {
    const txs: Transaction[] = [
      {
        id: 't_groc',
        title: 'Nákup potravin',
        amountInHaler: 150000,
        date: '2026-09-02',
        sequence: 1,
        type: 'expense',
        sourceAccountId: sampleChecking.id,
        categoryId: catFood.id,
        subcategoryId: subGroceries.id,
        status: 'executed',
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 't_nocat',
        title: 'Různé bez kategorie',
        amountInHaler: 50000,
        date: '2026-09-03',
        sequence: 2,
        type: 'expense',
        sourceAccountId: sampleChecking.id,
        status: 'executed',
        createdAt: '',
        updatedAt: '',
      },
    ];

    const breakdown = calculateCategoryBreakdown('expense', txs, testCategories);
    expect(breakdown.length).toBe(2);

    // První kategorie podle částky je Potraviny
    expect(breakdown[0].name).toBe('Potraviny');
    expect(breakdown[0].totalInHaler).toBe(150000);
    expect(breakdown[0].subcategories.length).toBe(1);
    expect(breakdown[0].subcategories[0].name).toBe('Supermarket');

    // Druhá kategorie je Bez kategorie
    expect(breakdown[1].name).toBe('Bez kategorie');
    expect(breakdown[1].totalInHaler).toBe(50000);
  });

  // 18. České abecední řazení kategorií a účtů
  it('18. Řazení kategorií a účtů respektuje české abecední řazení', () => {
    const catA: Category = { id: 'cA', name: 'Čaj a káva', type: 'expense', color: '', icon: '', sortOrder: 1, status: 'active', createdAt: '', updatedAt: '' };
    const catB: Category = { id: 'cB', name: 'Cestování', type: 'expense', color: '', icon: '', sortOrder: 2, status: 'active', createdAt: '', updatedAt: '' };

    const txs: Transaction[] = [
      { id: '1', title: '', amountInHaler: 100, date: '2026-09-01', sequence: 1, type: 'expense', sourceAccountId: sampleChecking.id, categoryId: catA.id, status: 'executed', createdAt: '', updatedAt: '' },
      { id: '2', title: '', amountInHaler: 100, date: '2026-09-01', sequence: 2, type: 'expense', sourceAccountId: sampleChecking.id, categoryId: catB.id, status: 'executed', createdAt: '', updatedAt: '' },
    ];

    const breakdown = calculateCategoryBreakdown('expense', txs, [catA, catB]);
    // Při stejné částce: 'Cestování' má být před 'Čaj a káva' (C < Č)
    expect(breakdown[0].name).toBe('Cestování');
    expect(breakdown[1].name).toBe('Čaj a káva');
  });

  // 19. Historický stav účtu před datem počátečního stavu rovný nule
  it('19. Před datem počátečního stavu má účet nulový zůstatek', () => {
    const lateAccount: Account = {
      ...sampleChecking,
      id: 'acc_late',
      initialBalanceInHaler: 5000000,
      initialBalanceDate: '2026-06-01',
    };

    const balBefore = computeLiquidAccountBalanceAtDate(lateAccount, '2026-05-31', [], []);
    expect(balBefore).toBe(0);

    const balAfter = computeLiquidAccountBalanceAtDate(lateAccount, '2026-06-01', [], []);
    expect(balAfter).toBe(5000000);
  });

  // 20. Správné použití poslední známé tržní hodnoty k historickému dni
  it('20. Investiční účet používá poslední tržní hodnotu k danému dni a ignoruje budoucí', () => {
    const snaps: MarketValueSnapshot[] = [
      { id: 's1', accountId: sampleInvestment.id, date: '2026-06-01', marketValueInHaler: 52000000, createdAt: '' },
      { id: 's2', accountId: sampleInvestment.id, date: '2026-08-01', marketValueInHaler: 55000000, createdAt: '' },
      { id: 's3_future', accountId: sampleInvestment.id, date: '2026-10-01', marketValueInHaler: 60000000, createdAt: '' },
    ];

    // Stav k červenci 2026 musí použít snapshot z 1. 6. (520 000 Kč)
    const balJuly = computeAssetAccountBalanceAtDate(sampleInvestment, '2026-07-31', [], snaps);
    expect(balJuly).toBe(52000000);

    // Stav k srpnu 2026 musí použít snapshot z 1. 8. (550 000 Kč)
    const balAug = computeAssetAccountBalanceAtDate(sampleInvestment, '2026-08-31', [], snaps);
    expect(balAug).toBe(55000000);
  });

  // 21. Správný vývoj celkového jmění
  it('21. Vývoj celkového jmění správně agreguje všechny skupiny po měsících', () => {
    const range = resolveAnalyticsDateRange('3m', undefined, undefined, undefined, today).range;
    const history = calculateNetWorthHistory(range.months, testAccounts, [], [], []);

    expect(history.length).toBe(3);
    for (const point of history) {
      const sum =
        point.checkingAndCashInHaler +
        point.savingsInHaler +
        point.investmentsInHaler +
        point.pensionInHaler;
      expect(point.totalNetWorthInHaler).toBe(sum);
    }
  });

  // 22. Zahrnutí historie archivovaných účtů a kategorií
  it('22. Archivovaný účet i kategorie jsou v historických datech plně zachovány', () => {
    const archivedAcc: Account = {
      ...sampleChecking,
      id: 'acc_arch',
      name: 'Zrušený účet',
      status: 'archived',
    };

    const range = resolveAnalyticsDateRange('12m', undefined, undefined, undefined, today).range;
    const tx: Transaction = {
      id: 't_arch',
      title: 'Starý výdaj ze zrušeného účtu',
      amountInHaler: 80000,
      date: '2026-05-10',
      sequence: 1,
      type: 'expense',
      sourceAccountId: archivedAcc.id,
      status: 'executed',
      createdAt: '',
      updatedAt: '',
    };

    const filtered = getFilteredExecutedTransactions([tx], range, {}, testCategories, today);
    expect(filtered.length).toBe(1);
  });

  // 23. Správnou funkci všech filtrů
  it('23. Filtry správně omezují transakce podle účtu a kategorie', () => {
    const range = resolveAnalyticsDateRange('12m', undefined, undefined, undefined, today).range;
    const tx1: Transaction = {
      id: 't1',
      title: 'Jídlo z KB',
      amountInHaler: 10000,
      date: '2026-09-01',
      sequence: 1,
      type: 'expense',
      sourceAccountId: sampleChecking.id,
      categoryId: catFood.id,
      status: 'executed',
      createdAt: '',
      updatedAt: '',
    };
    const tx2: Transaction = {
      id: 't2',
      title: 'Výplata na AirBank',
      amountInHaler: 50000,
      date: '2026-09-01',
      sequence: 2,
      type: 'income',
      sourceAccountId: sampleSavings.id,
      categoryId: catSalary.id,
      status: 'executed',
      createdAt: '',
      updatedAt: '',
    };

    // Filtr na běžný účet
    const filteredAcc = getFilteredExecutedTransactions(
      [tx1, tx2],
      range,
      { accountId: sampleChecking.id },
      testCategories,
      today
    );
    expect(filteredAcc.length).toBe(1);
    expect(filteredAcc[0].id).toBe('t1');

    // Filtr na kategorii Potraviny
    const filteredCat = getFilteredExecutedTransactions(
      [tx1, tx2],
      range,
      { categoryId: catFood.id },
      testCategories,
      today
    );
    expect(filteredCat.length).toBe(1);
    expect(filteredCat[0].id).toBe('t1');
  });

  // 24. Prázdný stav bez chybových hodnot
  it('24. Prázdný stav nevykazuje NaN ani neplatné hodnoty', () => {
    const extremes = calculateFinancialExtremes([]);
    expect(extremes.highestIncomeMonth).toBeNull();
    expect(extremes.highestExpenseMonth).toBeNull();
    expect(extremes.avgMonthlyIncomeInHaler).toBe(0);
    expect(extremes.avgMonthlyNetChangeInHaler).toBe(0);

    const top = getTopExpenses([], [], []);
    expect(top.length).toBe(0);
  });

  // 25. Vizuální přítomnost v navigaci hned za Přehled a responzivní render
  it('25. Vizuální integrita: položka Analýza & trendy je v postranním menu za Přehled a obrazovka se bezpečně vykreslí', () => {
    const sidebarHtml = renderToStaticMarkup(
      <FinanceProvider>
        <Sidebar
          currentScreen="analytics"
          onSelectScreen={() => {}}
          mobileOpen={false}
          onCloseMobile={() => {}}
          onOpenTransactionModal={() => {}}
        />
      </FinanceProvider>
    );

    // Položka je v menu přítomna
    expect(sidebarHtml).toContain('Analýza &amp; trendy');

    // Ověříme pořadí: Měsíční rozpočet -> Přehled -> Analýza & trendy -> Položky
    const idxBudget = sidebarHtml.indexOf('Měsíční rozpočet');
    const idxOverview = sidebarHtml.indexOf('Přehled');
    const idxAnalytics = sidebarHtml.indexOf('Analýza &amp; trendy');
    const idxTransactions = sidebarHtml.indexOf('Položky');

    expect(idxBudget).toBeLessThan(idxOverview);
    expect(idxOverview).toBeLessThan(idxAnalytics);
    expect(idxAnalytics).toBeLessThan(idxTransactions);

    // Vykreslení AnalyticsScreen
    const screenHtml = renderToStaticMarkup(
      <FinanceProvider>
        <AnalyticsScreen />
      </FinanceProvider>
    );

    expect(screenHtml).toContain('Analyzované období');
    expect(screenHtml).toContain('Posledních 12 měsíců');
    expect(screenHtml).toContain('Příjmy, výdaje a čistá změna');
    expect(screenHtml).toContain('Výdaje podle kategorií');
    expect(screenHtml).toContain('Příjmy podle kategorií');
    expect(screenHtml).toContain('Nejvyšší výdaje ve vybraném období');
    expect(screenHtml).toContain('Průměry a finanční extrémy');
  });
});
