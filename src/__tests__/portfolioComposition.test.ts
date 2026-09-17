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

  it('1. Součet pct všech segmentů je vždy přesně 100 %, protože celkový majetek daného měsíce je vždy brán jako 100 %', () => {
    const periods = buildPeriods();
    const accounts = [checking, savings, pension, investment];

    const result = calculatePortfolioComposition(periods, accounts, [], [], []);
    expect(result.length).toBe(1);

    const sumPct = result[0].segments.reduce((s, seg) => s + (seg.pct ?? 0), 0);
    expect(sumPct).toBeCloseTo(100, 6);
  });

  it('2. Záporný zůstatek (checking v mínusu) se projeví jako záporná hodnota vůči základně = součtu kladných zůstatků (100 %)', () => {
    const periods = buildPeriods();
    const overdraftChecking: Account = {
      ...checking,
      initialBalanceInHaler: -5000000, // -50 000 Kč
    };
    const accounts = [overdraftChecking, savings, pension, investment];

    const result = calculatePortfolioComposition(periods, accounts, [], [], []);
    const point = result[0];

    const checkingSegment = point.segments.find((s) => s.key === checking.id)!;
    expect(checkingSegment.balanceInHaler).toBeLessThan(0);
    expect(checkingSegment.pct).not.toBeNull();
    expect(checkingSegment.pct!).toBeLessThan(0);

    // Součet POUZE kladných segmentů (savings + pension + investment) musí být přesně
    // 100 % - to je základna. Záporný checking do ní nepočítá, jen z ní "ukusuje" pod nulou,
    // takže celkový součet všech segmentů (kladných i záporného) je proto pod 100 %.
    const positiveSumPct = point.segments
      .filter((s) => s.key !== checking.id)
      .reduce((s, seg) => s + (seg.pct ?? 0), 0);
    expect(positiveSumPct).toBeCloseTo(100, 6);

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

  it('6. Úplně všechny způsobilé účty se zobrazí jako samostatné segmenty (žádné slučování), pořadí konzistentní napříč obdobími', () => {
    const p1 = createBudgetPeriod(2026, 6, 15);
    const p2 = createBudgetPeriod(2026, 7, 15);
    const periods = [createBudgetPeriodInfo(p1, today), createBudgetPeriodInfo(p2, today)];

    const result = calculatePortfolioComposition(periods, allAccounts, [], [], []);
    const keysA = result[0].segments.map((s) => s.key);
    const keysB = result[1].segments.map((s) => s.key);
    expect(keysA).toEqual(keysB);
    // Každý účet (i běžný) je vlastní segment, žádné sloučení do "cash-and-checking"
    expect(keysA).toEqual([checking.id, savings.id, pension.id, investment.id]);
  });

  it('7. Pořadí segmentů respektuje skutečné sortOrder účtů z Účty, ne pevné pořadí podle typu', () => {
    const periods = buildPeriods();
    // Penzijní účet má nižší sortOrder než spořicí a běžný, takže se musí zobrazit
    // PŘED nimi, přestože "pevné" pořadí podle typu by bylo jiné.
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
    expect(keys).toEqual([pension.id, savings.id, investment.id, checking.id]);
  });

  it('8. Každý běžný/hotovostní účet má vlastní segment se svou vlastní barvou (žádné slučování do jednoho řádku)', () => {
    const periods = buildPeriods();
    const firstChecking: Account = { ...checking, id: 'acc_chk_1', sortOrder: 1, color: '#123456' };
    const secondCash: Account = { ...checking, id: 'acc_cash_2', type: 'cash', name: 'Hotovost', sortOrder: 2, color: '#abcdef' };

    const result = calculatePortfolioComposition(
      periods,
      [firstChecking, secondCash],
      [],
      [],
      []
    );

    const keys = result[0].segments.map((s) => s.key);
    expect(keys).toEqual([firstChecking.id, secondCash.id]);

    const seg1 = result[0].segments.find((s) => s.key === firstChecking.id)!;
    const seg2 = result[0].segments.find((s) => s.key === secondCash.id)!;
    expect(seg1.color).toBe('#123456');
    expect(seg2.color).toBe('#abcdef');
  });

  it('9. Barvy všech segmentů (běžný, spořicí, penzijní, investiční) odpovídají barvám daných účtů', () => {
    const periods = buildPeriods();
    const result = calculatePortfolioComposition(periods, allAccounts, [], [], []);

    const chkSeg = result[0].segments.find((s) => s.key === checking.id)!;
    const savSeg = result[0].segments.find((s) => s.key === savings.id)!;
    const penSeg = result[0].segments.find((s) => s.key === pension.id)!;
    const invSeg = result[0].segments.find((s) => s.key === investment.id)!;

    expect(chkSeg.color).toBe(checking.color);
    expect(savSeg.color).toBe(savings.color);
    expect(penSeg.color).toBe(pension.color);
    expect(invSeg.color).toBe(investment.color);
  });

  it('10. Segment běžného účtu se jmenuje podle skutečného názvu účtu', () => {
    const periods = buildPeriods();
    const result = calculatePortfolioComposition(periods, allAccounts, [], [], []);
    const chkSeg = result[0].segments.find((s) => s.key === checking.id)!;
    expect(chkSeg.label).toBe(checking.name);
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
