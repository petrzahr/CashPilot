import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import {
  calculatePortfolioComposition,
  createBudgetPeriodInfo,
  generateBudgetPeriodSequence,
} from '../services/analyticsEngine';
import { createBudgetPeriod } from '../services/periodService';
import { Account, BalanceCorrection, MarketValueSnapshot, Transaction } from '../types/finance';
import { AnalyticsScreen } from '../components/analytics/AnalyticsScreen';
import { FinanceProvider } from '../context/FinanceContext';
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

Object.defineProperty(globalThis, 'localStorage', {
  value: storageMock,
  writable: true,
  configurable: true,
});

describe('Rozložení celkového majetku (calculatePortfolioComposition)', () => {
  const today = '2026-09-13';

  const checking: Account = {
    id: 'acc_chk',
    name: 'Běžný účet',
    type: 'checking',
    currency: 'CZK',
    initialBalanceInHaler: 10000000, // 100 000 Kč
    initialBalanceDate: '2025-01-01',
    isUsableCash: true,
    isNetWorth: true,
    color: '#0284c7',
    sortOrder: 1,
    status: 'active',
    createdAt: '',
    updatedAt: '',
  };

  const savings: Account = {
    id: 'acc_sav',
    name: 'Spořicí účet',
    type: 'savings',
    currency: 'CZK',
    initialBalanceInHaler: 20000000, // 200 000 Kč
    initialBalanceDate: '2025-01-01',
    isUsableCash: false,
    isNetWorth: true,
    color: '#10b981',
    sortOrder: 2,
    status: 'active',
    createdAt: '',
    updatedAt: '',
  };

  const pension: Account = {
    id: 'acc_pen',
    name: 'Penzijní fond',
    type: 'pension',
    currency: 'CZK',
    initialBalanceInHaler: 30000000, // 300 000 Kč
    initialBalanceDate: '2025-01-01',
    isUsableCash: false,
    isNetWorth: true,
    color: '#ec4899',
    sortOrder: 3,
    status: 'active',
    createdAt: '',
    updatedAt: '',
  };

  const investment: Account = {
    id: 'acc_inv',
    name: 'Investice',
    type: 'investment',
    currency: 'CZK',
    initialBalanceInHaler: 50000000, // 500 000 Kč
    initialBalanceDate: '2025-01-01',
    isUsableCash: false,
    isNetWorth: true,
    color: '#8b5cf6',
    sortOrder: 4,
    status: 'active',
    createdAt: '',
    updatedAt: '',
  };

  const excludedByFlag: Account = {
    ...checking,
    id: 'acc_excluded_flag',
    name: 'Vyloučený účet (isNetWorth false)',
    isNetWorth: false,
  };

  const archivedAccount: Account = {
    ...savings,
    id: 'acc_archived',
    name: 'Archivovaný účet',
    status: 'archived',
  };

  const allAccounts = [checking, savings, pension, investment, excludedByFlag, archivedAccount];

  const buildPeriods = () => {
    const p = createBudgetPeriod(2026, 8, 15); // Srpen 2026, obsahuje dnešek 13.9. jako probíhající při 15
    const seq = generateBudgetPeriodSequence(p, p, 15, today);
    return seq;
  };

  it('1. Součet pct všech segmentů odpovídá přibližně 100 % při kladných zůstatcích s malou hotovostní rezervou', () => {
    const periods = buildPeriods();
    // % základna je součet BEZ segmentu Zůstatek (savings 20M + pension 30M + investment 50M = 100M),
    // proto malý kladný zůstatek (1M, tj. 1 % základny) posune součet těsně NAD 100 %, ne přesně na 100 %
    // (stejné chování jako ve vzorovém Excel grafu, kde měsíce s kladným zůstatkem mírně přesahují 100 %).
    const smallCashChecking: Account = { ...checking, initialBalanceInHaler: 1000000 };
    const accounts = [smallCashChecking, savings, pension, investment];

    const result = calculatePortfolioComposition(periods, accounts, [], [], []);
    expect(result.length).toBe(1);

    const sumPct = result[0].segments.reduce((s, seg) => s + (seg.pct ?? 0), 0);
    expect(sumPct).toBeGreaterThan(99);
    expect(sumPct).toBeLessThan(102);
  });

  it('2. Záporný zůstatek (checking v mínusu) sníží celkový součet pct pod 100 % a projeví se jako záporná hodnota', () => {
    const periods = buildPeriods();
    const overdraftChecking: Account = {
      ...checking,
      initialBalanceInHaler: -5000000, // -50 000 Kč
    };
    const accounts = [overdraftChecking, savings, pension, investment];

    const result = calculatePortfolioComposition(periods, accounts, [], [], []);
    const point = result[0];

    const cashSegment = point.segments.find((s) => s.key === 'cash-and-checking')!;
    expect(cashSegment.balanceInHaler).toBeLessThan(0);
    expect(cashSegment.pct).not.toBeNull();
    expect(cashSegment.pct!).toBeLessThan(0);

    const sumPct = point.segments.reduce((s, seg) => s + (seg.pct ?? 0), 0);
    expect(sumPct).toBeLessThan(100);
  });

  it('3. pct je null u všech segmentů, když totalNetWorthInHaler === 0', () => {
    const periods = buildPeriods();
    const zeroChecking: Account = { ...checking, initialBalanceInHaler: 0 };
    const zeroSavings: Account = { ...savings, initialBalanceInHaler: 0 };
    const zeroPension: Account = { ...pension, initialBalanceInHaler: 0 };
    const zeroInvestment: Account = { ...investment, initialBalanceInHaler: 0 };

    const result = calculatePortfolioComposition(
      periods,
      [zeroChecking, zeroSavings, zeroPension, zeroInvestment],
      [],
      [],
      []
    );

    expect(result[0].totalNetWorthInHaler).toBe(0);
    for (const seg of result[0].segments) {
      expect(seg.pct).toBeNull();
    }
  });

  it('4. Investiční a penzijní účty s historií ocenění používají computeAssetAccountBalanceAtDate, ne prostý součet transakcí', () => {
    const periods = buildPeriods();
    const snaps: MarketValueSnapshot[] = [
      { id: 's1', accountId: investment.id, date: '2026-08-01', marketValueInHaler: 70000000, createdAt: '' },
    ];

    const result = calculatePortfolioComposition(periods, [investment], [], [], snaps);
    const seg = result[0].segments.find((s) => s.key === investment.id)!;
    // Bez ocenění by zůstal initialBalanceInHaler (500 000 Kč), s ním musí odpovídat snapshotu (700 000 Kč)
    expect(seg.balanceInHaler).toBe(70000000);
  });

  it('5. Účty s isNetWorth: false nebo status: archived se do výpočtu vůbec nezahrnou', () => {
    const periods = buildPeriods();
    const result = calculatePortfolioComposition(periods, allAccounts, [], [], []);

    const keys = result[0].segments.map((s) => s.key);
    expect(keys).not.toContain(excludedByFlag.id);
    expect(keys).not.toContain(archivedAccount.id);
  });

  it('6. Pořadí segmentů je napříč obdobími konzistentní a odpovídá řazení účtů v Účty (sortOrder)', () => {
    const p1 = createBudgetPeriod(2026, 6, 15);
    const p2 = createBudgetPeriod(2026, 7, 15);
    const periods = [createBudgetPeriodInfo(p1, today), createBudgetPeriodInfo(p2, today)];

    const result = calculatePortfolioComposition(periods, allAccounts, [], [], []);
    const keysA = result[0].segments.map((s) => s.key);
    const keysB = result[1].segments.map((s) => s.key);
    expect(keysA).toEqual(keysB);
    // V testovacích datech mají checking/savings/pension/investment postupně rostoucí sortOrder (1-4)
    expect(keysA[0]).toBe('cash-and-checking');
    expect(keysA[1]).toBe(savings.id);
    expect(keysA[2]).toBe(pension.id);
    expect(keysA[3]).toBe(investment.id);
  });

  it('7. Pořadí segmentů respektuje skutečné sortOrder účtů, ne pevné pořadí podle typu', () => {
    const periods = buildPeriods();
    // Penzijní účet má nižší sortOrder než spořicí, takže se musí zobrazit PŘED ním,
    // přestože "pevné" pořadí podle typu (savings -> pension -> investment) by bylo opačné.
    const reorderedPension: Account = { ...pension, sortOrder: 1 };
    const reorderedSavings: Account = { ...savings, sortOrder: 2 };
    const reorderedInvestment: Account = { ...investment, sortOrder: 3 };
    const reorderedChecking: Account = { ...checking, sortOrder: 4 };

    const result = calculatePortfolioComposition(
      periods,
      [reorderedChecking, reorderedSavings, reorderedPension, reorderedInvestment],
      [],
      [],
      []
    );

    const keys = result[0].segments.map((s) => s.key);
    expect(keys).toEqual([pension.id, savings.id, investment.id, 'cash-and-checking']);
  });

  it('8. Barva segmentu "Konečný stav" odpovídá barvě prvního zahrnutého běžného/hotovostního účtu', () => {
    const periods = buildPeriods();
    const firstChecking: Account = { ...checking, id: 'acc_chk_1', sortOrder: 1, color: '#123456' };
    const secondCash: Account = { ...checking, id: 'acc_cash_2', type: 'cash', sortOrder: 2, color: '#abcdef' };

    const result = calculatePortfolioComposition(
      periods,
      [firstChecking, secondCash],
      [],
      [],
      []
    );

    const cashSegment = result[0].segments.find((s) => s.key === 'cash-and-checking')!;
    expect(cashSegment.color).toBe('#123456');
  });

  it('9. Barvy segmentů spořicích/penzijních/investičních účtů odpovídají barvám daných účtů', () => {
    const periods = buildPeriods();
    const result = calculatePortfolioComposition(periods, allAccounts, [], [], []);

    const savSeg = result[0].segments.find((s) => s.key === savings.id)!;
    const penSeg = result[0].segments.find((s) => s.key === pension.id)!;
    const invSeg = result[0].segments.find((s) => s.key === investment.id)!;

    expect(savSeg.color).toBe(savings.color);
    expect(penSeg.color).toBe(pension.color);
    expect(invSeg.color).toBe(investment.color);
  });

  it('10. Segment "Konečný stav" se jmenuje "Konečný stav" (ne "Zůstatek")', () => {
    const periods = buildPeriods();
    const result = calculatePortfolioComposition(periods, allAccounts, [], [], []);
    const cashSegment = result[0].segments.find((s) => s.key === 'cash-and-checking')!;
    expect(cashSegment.label).toBe('Konečný stav');
  });

  it('11. Graf se v AnalyticsScreen renderuje bezprostředně pod panelem filtru období a nad Trend výdajů/extrémy', () => {
    saveStoredAuth({
      accessToken: 'mock_token',
      expiresAt: Date.now() + 3600000,
      user: { emailAddress: 'test@example.com', displayName: 'Test User' },
    });

    const html = renderToStaticMarkup(
      React.createElement(
        FinanceProvider,
        null,
        React.createElement(AnalyticsScreen)
      )
    );

    const idxFilter = html.indexOf('Analyzované období');
    const idxPortfolio = html.indexOf('Rozložení celkového majetku');
    const idxTrend = html.indexOf('Trend výdajů mezi obdobími');

    expect(idxFilter).toBeGreaterThan(-1);
    expect(idxPortfolio).toBeGreaterThan(-1);
    expect(idxTrend).toBeGreaterThan(-1);
    expect(idxFilter).toBeLessThan(idxPortfolio);
    expect(idxPortfolio).toBeLessThan(idxTrend);

    // Popisek karty už neobsahuje odstraněný pomocný text
    expect(html).not.toContain('Procentuální podíl jednotlivých účtů na celkovém majetku za vybrané období');

    clearStoredAuth();
  });
});
