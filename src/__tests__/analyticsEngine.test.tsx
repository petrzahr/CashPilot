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
  createBudgetPeriodInfo,
  generateBudgetPeriodSequence,
} from '../services/analyticsEngine';
import {
  getPeriodForDate,
  createBudgetPeriod,
  getPreviousPeriod,
  getNextPeriod,
  isDateInPeriod,
  formatCzechDate,
  formatPeriodRange,
} from '../services/periodService';
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

  // 1. Správné rozsahy všech rychlých voleb období podle rozpočtového dne (15)
  it('1. Správné rozsahy všech rychlých voleb období (3m, 6m, 12m, ytd, all) při startDay 15', () => {
    // Dne 13. 9. 2026 při startovním dni 15 je aktuální periodou Srpen 2026 (15. 8. - 14. 9. 2026)
    const res3m = resolveAnalyticsDateRange('3m', undefined, undefined, undefined, today, 15);
    expect(res3m.range.periods.length).toBe(3);
    expect(res3m.range.fromPeriodKey).toBe('2026-06'); // Červen, Červenec, Srpen 2026
    expect(res3m.range.endDate).toBe(today); // Analyzováno do 13. 9. 2026
    expect(res3m.range.periods[2].isCurrentPeriod).toBe(true);
    expect(res3m.range.periods[2].label).toBe('Srpen 2026');

    const res6m = resolveAnalyticsDateRange('6m', undefined, undefined, undefined, today, 15);
    expect(res6m.range.periods.length).toBe(6);
    expect(res6m.range.fromPeriodKey).toBe('2026-03'); // Březen až Srpen 2026

    const res12m = resolveAnalyticsDateRange('12m', undefined, undefined, undefined, today, 15);
    expect(res12m.range.periods.length).toBe(12);
    expect(res12m.range.fromPeriodKey).toBe('2025-09'); // Září 2025 až Srpen 2026

    const resYtd = resolveAnalyticsDateRange('ytd', undefined, undefined, undefined, today, 15);
    expect(resYtd.range.fromPeriodKey).toBe('2026-01'); // Leden 2026 až Srpen 2026
    expect(resYtd.range.periods.length).toBe(8); // 8 rozpočtových period (Leden až Srpen)

    const resAll = resolveAnalyticsDateRange(
      'all',
      undefined,
      undefined,
      { accounts: testAccounts, transactions: [], corrections: [], snapshots: [] },
      today,
      15
    );
    // Počáteční zůstatek je k 2025-01-01, což při startovním dni 15 spadá do Prosinec 2024 (15. 12. 2024 – 14. 1. 2025)
    expect(resAll.range.fromPeriodKey).toBe('2024-12');
  });

  // 2. Výchozí volba posledních 12 rozpočtových období
  it('2. Výchozí volba je 12 rozpočtových období', () => {
    const res = resolveAnalyticsDateRange('12m', undefined, undefined, undefined, today, 15);
    expect(res.range.preset).toBe('12m');
    expect(res.range.periods.length).toBe(12);
  });

  // 3. Vlastní rozsah Od-Do rozpočtových period
  it('3. Vlastní rozsah Od–Do analyzuje zadaná rozpočtová období', () => {
    const res = resolveAnalyticsDateRange('custom', '2026-05', '2026-08', undefined, today, 15);
    expect(res.error).toBeUndefined();
    expect(res.range.periods.length).toBe(4);
    expect(res.range.startDate).toBe('2026-05-15');
    expect(res.range.endDate).toBe(today); // Srpen 2026 ještě probíhá k 13. 9. 2026
    expect(res.range.periods[0].label).toBe('Květen 2026');
    expect(res.range.periods[3].label).toBe('Srpen 2026');
  });

  // 4. Odmítnutí neplatného nebo budoucího rozpočtového období
  it('4. Odmítnutí neplatného nebo budoucího období s chybovou zprávou', () => {
    // Od > Do
    const resInv = resolveAnalyticsDateRange('custom', '2026-08', '2026-05', undefined, today, 15);
    expect(resInv.error).toBe('Počáteční měsíc nesmí být pozdější než koncový měsíc.');

    // Budoucí rozpočtové období (k 13. 9. 2026 je Září 2026 v budoucnosti, protože začíná 15. 9. 2026)
    const resFut = resolveAnalyticsDateRange('custom', '2026-05', '2026-09', undefined, today, 15);
    expect(resFut.error).toBe('Koncové rozpočtové období nesmí být v budoucnosti.');

    // Prázdný rozsah
    const resEmpty = resolveAnalyticsDateRange('custom', '', '', undefined, today, 15);
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
    const range = resolveAnalyticsDateRange('3m', undefined, undefined, undefined, today, 15).range;
    expect(range.periods.length).toBe(3);

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
    const range = resolveAnalyticsDateRange('3m', undefined, undefined, undefined, today, 15).range;
    const history = calculateNetWorthHistory(range.periods, testAccounts, [], [], []);

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

describe('Rozpočtová období v sekci Analýza & trendy dle Počátečního dne rozpočtového měsíce (20 požadavků)', () => {
  const sampleChecking: Account = {
    id: 'acc_chk_b',
    name: 'Běžný účet',
    type: 'checking',
    currency: 'CZK',
    initialBalanceInHaler: 10000000,
    initialBalanceDate: '2025-01-01',
    isUsableCash: true,
    isNetWorth: true,
    color: '#0284c7',
    sortOrder: 1,
    status: 'active',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  };

  const sampleAccounts = [sampleChecking];

  // 1. Pole Od a Do používají pouze výběr měsíce a roku
  it('1. Pole Od a Do používají pouze výběr měsíce a roku (input type="month")', () => {
    const html = renderToStaticMarkup(
      <FinanceProvider>
        <AnalyticsScreen />
      </FinanceProvider>
    );
    expect(html).toContain('type="month"');
    // Obsahuje popisky Od: a Do:
    expect(html).toContain('Od:');
    expect(html).toContain('Do:');
  });

  // 2. V polích se nezobrazují celé rozsahy období
  it('2. V polích Od a Do se nezobrazují celé rozsahy období ani dlouhé dropdowny', () => {
    const html = renderToStaticMarkup(
      <FinanceProvider>
        <AnalyticsScreen />
      </FinanceProvider>
    );
    // V HTML formuláře nesmí být dropdown <select> s možnostmi typu "(15. 8. 2026 – 14. 9. 2026)"
    expect(html).not.toMatch(/<select[^>]*>.*\(15\.\s*8\.\s*2026/s);
  });

  // 3. Při počátečním dni 15 a datu 13. 9. 2026 je aktuálním obdobím srpen 2026
  it('3. Při počátečním dni 15 a datu 13. 9. 2026 je aktuálním obdobím srpen 2026', () => {
    const period = getPeriodForDate('2026-09-13', 15);
    expect(period.key).toBe('2026-08');
    const info = createBudgetPeriodInfo(period, '2026-09-13');
    expect(info.isCurrentPeriod).toBe(true);
    expect(info.label).toBe('Srpen 2026');
  });

  // 4. Srpen 2026 odpovídá rozsahu 15. 8.–14. 9. 2026
  it('4. Srpen 2026 odpovídá rozsahu 15. 8.–14. 9. 2026', () => {
    const period = createBudgetPeriod(2026, 8, 15);
    expect(period.startDate).toBe('2026-08-15');
    expect(period.endDate).toBe('2026-09-14');
    expect(formatPeriodRange(period)).toBe('15. 8. 2026 – 14. 9. 2026');
  });

  // 5. Položka z 14. 9. 2026 patří do srpna
  it('5. Položka z 14. 9. 2026 patří do srpna 2026', () => {
    const period = getPeriodForDate('2026-09-14', 15);
    expect(period.key).toBe('2026-08');
    expect(isDateInPeriod('2026-09-14', period)).toBe(true);

    const tx: Transaction = {
      id: 't_b5',
      title: 'Nákup',
      amountInHaler: 100000,
      date: '2026-09-14',
      sequence: 1,
      type: 'expense',
      sourceAccountId: sampleChecking.id,
      status: 'executed',
      createdAt: '',
      updatedAt: '',
    };
    const periodInfo = createBudgetPeriodInfo(period, '2026-09-14');
    const cf = calculateMonthlyCashFlow([periodInfo], [tx], 15);
    expect(cf[0].expenseInHaler).toBe(100000);
  });

  // 6. Položka z 15. 9. 2026 patří do září
  it('6. Položka z 15. 9. 2026 patří do září 2026', () => {
    const period = getPeriodForDate('2026-09-15', 15);
    expect(period.key).toBe('2026-09');
    expect(isDateInPeriod('2026-09-15', period)).toBe(true);

    const tx: Transaction = {
      id: 't_b6',
      title: 'Nákup v září',
      amountInHaler: 200000,
      date: '2026-09-15',
      sequence: 1,
      type: 'expense',
      sourceAccountId: sampleChecking.id,
      status: 'executed',
      createdAt: '',
      updatedAt: '',
    };
    const periodInfo = createBudgetPeriodInfo(period, '2026-09-15');
    const cf = calculateMonthlyCashFlow([periodInfo], [tx], 15);
    expect(cf[0].expenseInHaler).toBe(200000);
  });

  // 7. Dne 15. 9. 2026 se aktuální období změní na září
  it('7. Dne 15. 9. 2026 se aktuální období změní na září 2026', () => {
    const period = getPeriodForDate('2026-09-15', 15);
    expect(period.key).toBe('2026-09');
    const info = createBudgetPeriodInfo(period, '2026-09-15');
    expect(info.isCurrentPeriod).toBe(true);
    expect(info.label).toBe('Září 2026');
    expect(info.startDate).toBe('2026-09-15');
    expect(info.endDate).toBe('2026-10-14');
  });

  // 8. Vlastní rozsah používá skutečné hranice rozpočtových období
  it('8. Vlastní rozsah Od: 2025-09 Do: 2026-08 používá skutečné hranice rozpočtových období (15. 9. 2025–13. 9. 2026 k 13. 9.)', () => {
    const res = resolveAnalyticsDateRange('custom', '2025-09', '2026-08', undefined, '2026-09-13', 15);
    expect(res.error).toBeUndefined();
    expect(res.range.startDate).toBe('2025-09-15');
    expect(res.range.endDate).toBe('2026-09-13');
  });

  // 9. Probíhající období končí aktuálním datem
  it('9. Probíhající období končí aktuálním datem (13. 9. 2026 místo 14. 9. 2026)', () => {
    const period = getPeriodForDate('2026-09-13', 15);
    const info = createBudgetPeriodInfo(period, '2026-09-13');
    expect(info.endDate).toBe('2026-09-14');
    expect(info.analysisEndDate).toBe('2026-09-13');
  });

  // 10. Budoucí část probíhajícího období není zahrnuta
  it('10. Budoucí část probíhajícího období a položky po aktuálním datu nejsou zahrnuty', () => {
    const range = resolveAnalyticsDateRange('3m', undefined, undefined, undefined, '2026-09-13', 15).range;
    const txPast: Transaction = {
      id: 'tx_past',
      title: 'Minulý nákup',
      amountInHaler: 100000,
      date: '2026-09-12',
      sequence: 1,
      type: 'expense',
      sourceAccountId: sampleChecking.id,
      status: 'executed',
      createdAt: '',
      updatedAt: '',
    };
    const txFuture: Transaction = {
      id: 'tx_fut',
      title: 'Budoucí položka',
      amountInHaler: 100000,
      date: '2026-09-14', // Za dnešním datem 13. 9.
      sequence: 2,
      type: 'expense',
      sourceAccountId: sampleChecking.id,
      status: 'executed',
      createdAt: '',
      updatedAt: '',
    };

    const filtered = getFilteredExecutedTransactions([txPast, txFuture], range, {}, [], '2026-09-13');
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe('tx_past');
  });

  // 11. Budoucí rozpočtové období nelze vybrat
  it('11. Budoucí rozpočtové období nelze vybrat (koncové období v budoucnosti vrátí chybu)', () => {
    const resFut = resolveAnalyticsDateRange('custom', '2026-05', '2026-09', undefined, '2026-09-13', 15);
    expect(resFut.error).toBe('Koncové rozpočtové období nesmí být v budoucnosti.');
  });

  // 12. Rychlé volby pracují s rozpočtovými obdobími
  it('12. Rychlé volby (3m, 6m, 12m, all) pracují s rozpočtovými obdobími', () => {
    const res3m = resolveAnalyticsDateRange('3m', undefined, undefined, undefined, '2026-09-13', 15);
    expect(res3m.range.periods.length).toBe(3);
    expect(res3m.range.fromPeriodKey).toBe('2026-06');
    expect(res3m.range.toPeriodKey).toBe('2026-08');

    const res6m = resolveAnalyticsDateRange('6m', undefined, undefined, undefined, '2026-09-13', 15);
    expect(res6m.range.periods.length).toBe(6);
    expect(res6m.range.fromPeriodKey).toBe('2026-03');
    expect(res6m.range.toPeriodKey).toBe('2026-08');

    const res12m = resolveAnalyticsDateRange('12m', undefined, undefined, undefined, '2026-09-13', 15);
    expect(res12m.range.periods.length).toBe(12);
    expect(res12m.range.fromPeriodKey).toBe('2025-09');
    expect(res12m.range.toPeriodKey).toBe('2026-08');
  });

  // 13. YTD začíná lednovým rozpočtovým obdobím
  it('13. YTD začíná lednovým rozpočtovým obdobím a končí probíhajícím obdobím', () => {
    const resYtd = resolveAnalyticsDateRange('ytd', undefined, undefined, undefined, '2026-09-13', 15);
    expect(resYtd.range.fromPeriodKey).toBe('2026-01');
    expect(resYtd.range.toPeriodKey).toBe('2026-08');
    expect(resYtd.range.startDate).toBe('2026-01-15');
    expect(resYtd.range.endDate).toBe('2026-09-13');
  });

  // 14. Grafy používají správné názvy a hranice období
  it('14. Grafy používají správné názvy a hranice období (např. srp 2026, 15. 8. 2026 – 13. 9. 2026)', () => {
    const range = resolveAnalyticsDateRange('3m', undefined, undefined, undefined, '2026-09-13', 15).range;
    const cf = calculateMonthlyCashFlow(range.periods, [], 15);
    expect(cf[2].shortLabel).toBe('Srp 2026');
    expect(cf[2].dateRangeStr).toBe('15. 8. 2026 – 13. 9. 2026');
  });

  // 15. Tooltip ukazuje skutečný rozsah období
  it('15. Tooltip ukazuje skutečný analyzovaný rozsah období a stav (Probíhající vs Uzavřené)', () => {
    const range = resolveAnalyticsDateRange('3m', undefined, undefined, undefined, '2026-09-13', 15).range;
    const cf = calculateMonthlyCashFlow(range.periods, [], 15);

    // Probíhající srpen
    expect(cf[2].label).toBe('Srpen 2026');
    expect(cf[2].dateRangeStr).toBe('15. 8. 2026 – 13. 9. 2026');
    expect(cf[2].isCurrentMonth).toBe(true);

    // Uzavřený červenec
    expect(cf[1].label).toBe('Červenec 2026');
    expect(cf[1].dateRangeStr).toBe('15. 7. 2026 – 14. 8. 2026');
    expect(cf[1].isCurrentMonth).toBe(false);
  });

  // 16. Meziměsíční srovnání používá stejné části rozpočtových období
  it('16. Meziměsíční srovnání porovnává prvních N dní aktuálního období s prvními N dny předchozího', () => {
    const range = resolveAnalyticsDateRange('3m', undefined, undefined, undefined, '2026-09-13', 15).range;
    const txs: Transaction[] = [
      // Předchozí období Červenec 2026 (15. 7. – 14. 8.): výdaj v prvních 30 dnech
      { id: 'tx_prev_in', title: '', amountInHaler: 100000, date: '2026-07-20', sequence: 1, type: 'expense', sourceAccountId: sampleChecking.id, status: 'executed', createdAt: '', updatedAt: '' },
      // Předchozí období Červenec 2026: výdaj v 31. dni (14. 8.), který se nesmí zahrnout do 30denního srovnání
      { id: 'tx_prev_out', title: '', amountInHaler: 900000, date: '2026-08-14', sequence: 2, type: 'expense', sourceAccountId: sampleChecking.id, status: 'executed', createdAt: '', updatedAt: '' },
      // Probíhající období Srpen 2026 (15. 8. – 13. 9.)
      { id: 'tx_cur', title: '', amountInHaler: 120000, date: '2026-08-25', sequence: 3, type: 'expense', sourceAccountId: sampleChecking.id, status: 'executed', createdAt: '', updatedAt: '' },
    ];

    const trends = calculateExpenseMoMTrend(range.periods, txs, {}, [], '2026-09-13', 15);
    const aug = trends.find((t) => t.monthKey === '2026-08')!;
    expect(aug.isSameDayComparison).toBe(true);
    expect(aug.expenseInHaler).toBe(120000);
    expect(aug.prevMonthExpenseInHaler).toBe(100000); // Pouze tx_prev_in
  });

  // 17. Počáteční den 1 odpovídá kalendářním měsícům
  it('17. Počáteční den 1 odpovídá přesně kalendářním měsícům', () => {
    const res = resolveAnalyticsDateRange('12m', undefined, undefined, undefined, '2026-09-13', 1);
    expect(res.range.periods[11].startDate).toBe('2026-09-01');
    expect(res.range.periods[11].endDate).toBe('2026-09-30');
    expect(res.range.periods[11].analysisEndDate).toBe('2026-09-13');
    expect(res.range.periods[11].label).toBe('Září 2026');
  });

  // 18. Kratší měsíce, únor a přestupný rok jsou vypočítány správně
  it('18. Kratší měsíce, únor a přestupný rok jsou vypočítány správně', () => {
    // Přestupný rok 2024: Únor má 29 dní
    const pFeb2024 = createBudgetPeriod(2024, 2, 15);
    expect(pFeb2024.startDate).toBe('2024-02-15');
    expect(pFeb2024.endDate).toBe('2024-03-14');

    // Nepřestupný rok 2025: Únor má 28 dní
    const pFeb2025 = createBudgetPeriod(2025, 2, 15);
    expect(pFeb2025.startDate).toBe('2025-02-15');
    expect(pFeb2025.endDate).toBe('2025-03-14');

    // Leden s 31 dny: 15. 1. – 14. 2.
    const pJan = createBudgetPeriod(2026, 1, 15);
    expect(pJan.startDate).toBe('2026-01-15');
    expect(pJan.endDate).toBe('2026-02-14');

    // Duben s 30 dny: 15. 4. – 14. 5.
    const pApr = createBudgetPeriod(2026, 4, 15);
    expect(pApr.startDate).toBe('2026-04-15');
    expect(pApr.endDate).toBe('2026-05-14');
  });

  // 19. Změna počátečního dne okamžitě přepočítá celou sekci
  it('19. Změna počátečního dne okamžitě přepočítá rozpočtová období', () => {
    const res15 = resolveAnalyticsDateRange('3m', undefined, undefined, undefined, '2026-09-13', 15);
    expect(res15.range.periods[2].label).toBe('Srpen 2026');

    const res1 = resolveAnalyticsDateRange('3m', undefined, undefined, undefined, '2026-09-13', 1);
    expect(res1.range.periods[2].label).toBe('Září 2026');

    const res20 = resolveAnalyticsDateRange('3m', undefined, undefined, undefined, '2026-09-13', 20);
    expect(res20.range.periods[2].label).toBe('Srpen 2026');
    expect(res20.range.periods[2].startDate).toBe('2026-08-20');
  });

  // 20. Při přepočtu nedojde ke změně ani ztrátě finančních dat
  it('20. Při přepočtu nedojde ke změně ani ztrátě finančních dat', () => {
    const tx: Transaction = {
      id: 't_preserve',
      title: 'Důležitá transakce',
      amountInHaler: 99900,
      date: '2026-09-14',
      sequence: 1,
      type: 'expense',
      sourceAccountId: sampleChecking.id,
      status: 'executed',
      createdAt: '2026-09-14T12:00:00Z',
      updatedAt: '2026-09-14T12:00:00Z',
    };

    // Původní hodnoty
    const origAmount = tx.amountInHaler;
    const origDate = tx.date;
    const origStatus = tx.status;

    // Přepočet se startDay 15 i 1
    const p15 = getPeriodForDate(tx.date, 15);
    const p1 = getPeriodForDate(tx.date, 1);

    expect(p15.key).toBe('2026-08');
    expect(p1.key).toBe('2026-09');

    // Transakce zůstává nezměněna
    expect(tx.amountInHaler).toBe(origAmount);
    expect(tx.date).toBe(origDate);
    expect(tx.status).toBe(origStatus);
  });
});
