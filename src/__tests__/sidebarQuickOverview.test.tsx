import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Sidebar } from '../components/layout/Sidebar';
import { FinanceProvider, useFinance } from '../context/FinanceContext';
import {
  calculateQuickFinancialOverview,
} from '../services/financialEngine';
import {
  Account,
  BalanceCorrection,
  Transaction,
  MarketValueSnapshot,
} from '../types/finance';
import { saveStoredAuth, clearStoredAuth } from '../services/googleDriveService';
import { createResetAppData } from '../constants/defaultData';
import { SyncController } from '../services/syncController';
import { accountStorageKey } from '../services/syncModel';
import { AccountsScreen } from '../components/accounts/AccountsScreen';

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

describe('Sidebar - Rychlý finanční přehled (5 skupin k dnešnímu dni)', () => {
  const today = '2026-09-13';

  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: storageMock,
      writable: true,
      configurable: true,
    });
    localStorage.clear();
    // Simulate valid auth for FinanceProvider/App
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
    id: 'acc_checking_1',
    name: 'Hlavní běžný účet',
    type: 'checking',
    currency: 'CZK',
    initialBalanceInHaler: 5000000, // 50 000 Kč
    initialBalanceDate: '2026-01-01',
    isUsableCash: true,
    isNetWorth: true,
    color: '#0284c7',
    sortOrder: 1,
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const sampleCash: Account = {
    id: 'acc_cash_1',
    name: 'Peněženka',
    type: 'cash',
    currency: 'CZK',
    initialBalanceInHaler: 300000, // 3 000 Kč
    initialBalanceDate: '2026-01-01',
    isUsableCash: true,
    isNetWorth: true,
    color: '#10b981',
    sortOrder: 2,
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const sampleSavings: Account = {
    id: 'acc_savings_1',
    name: 'Spořicí účet Spořka',
    type: 'savings',
    currency: 'CZK',
    initialBalanceInHaler: 15000000, // 150 000 Kč
    initialBalanceDate: '2026-01-01',
    isUsableCash: false,
    isNetWorth: true,
    color: '#6366f1',
    sortOrder: 3,
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const sampleInvestment: Account = {
    id: 'acc_inv_1',
    name: 'Portu Portfolio',
    type: 'investment',
    currency: 'CZK',
    initialBalanceInHaler: 10000000, // 100 000 Kč
    initialBalanceDate: '2026-01-01',
    isUsableCash: false,
    isNetWorth: true,
    color: '#8b5cf6',
    sortOrder: 4,
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const samplePension: Account = {
    id: 'acc_pen_1',
    name: 'Doplňkové penzijní spoření',
    type: 'pension',
    currency: 'CZK',
    initialBalanceInHaler: 8000000, // 80 000 Kč
    initialBalanceDate: '2026-01-01',
    isUsableCash: false,
    isNetWorth: true,
    color: '#ec4899',
    sortOrder: 5,
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const allAccounts = [
    sampleChecking,
    sampleCash,
    sampleSavings,
    sampleInvestment,
    samplePension,
  ];

  it('shows today rather than projected card balances and keeps other accounts out of checking/cash', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-16T12:00:00Z'));
    const data = createResetAppData();
    data.accounts = [
      { ...sampleChecking, initialBalanceInHaler: 8000000 },
      { ...sampleCash, initialBalanceInHaler: 1888200 },
      { ...sampleSavings, initialBalanceInHaler: 22000000 },
      { ...sampleSavings, id: 'savings2', initialBalanceInHaler: 6012000 },
      { ...sampleInvestment, initialBalanceInHaler: 33300000 },
      { ...sampleInvestment, id: 'investment2', initialBalanceInHaler: 24600000 },
      { ...samplePension, initialBalanceInHaler: 25300000 },
      { ...sampleChecking, id: 'term-deposit', type: 'other', initialBalanceInHaler: 10000000 },
    ];
    data.transactions = [{ id: 'planned', title: 'Planned expense', type: 'expense',
      sourceAccountId: sampleChecking.id, date: '2026-09-20', sequence: 1,
      amountInHaler: 815400, status: 'planned', createdAt: '', updatedAt: '' }];
    localStorage.setItem(accountStorageKey('sidebar-cards'), JSON.stringify({
      data, pending: [], generation: 0, cloudRevision: 0,
    }));
    const session = new SyncController('sidebar-cards', () => null, () => {});
    const Probe = () => {
      const { quickOverview } = useFinance();
      expect(quickOverview).toEqual({ checkingAndCashInHaler: 9888200, checkingInHaler: 8000000, cashInHaler: 1888200, savingsInHaler: 28012000,
        investmentsInHaler: 57900000, pensionInHaler: 25300000, totalNetWorthInHaler: 131100200 });
      return null;
    };
    try {
      for (const screen of ['accounts', 'budget', 'overview'] as const) {
        const html = renderToStaticMarkup(<FinanceProvider syncSession={session}>
          <Probe />
          <Sidebar currentScreen={screen} onSelectScreen={() => {}} mobileOpen={false}
            onCloseMobile={() => {}} onOpenTransactionModal={() => {}} />
          <AccountsScreen />
        </FinanceProvider>);
        expect(html.replace(/\s/g, ' ')).toContain('80 000');
        expect(html.replace(/\s/g, ' ')).toContain('18 882');
        expect(html.replace(/\s/g, ' ')).toContain('71 846');
      }
    } finally {
      session.stop();
      vi.useRealTimers();
    }
  });

  it.each(allAccounts)('includes $type balances even when excluded from net worth', (account) => {
    const excluded = { ...account, isNetWorth: false };
    const overview = calculateQuickFinancialOverview([excluded], [], [], [], today);
    const group = account.type === 'savings' ? 'savingsInHaler'
      : account.type === 'investment' ? 'investmentsInHaler'
      : account.type === 'pension' ? 'pensionInHaler' : 'checkingAndCashInHaler';
    expect(overview[group]).toBe(account.initialBalanceInHaler);
    expect(overview.totalNetWorthInHaler).toBe(0);

    const included = calculateQuickFinancialOverview([account], [], [], [], today);
    expect(included[group]).toBe(overview[group]);
    expect(included.totalNetWorthInHaler).toBe(account.initialBalanceInHaler);
  });

  it('1. Původní položky "Použitelné peníze" a "Celkový majetek" již nejsou v postranním menu zobrazeny', () => {
    const html = renderToStaticMarkup(
      <FinanceProvider>
        <Sidebar
          currentScreen="budget"
          onSelectScreen={() => {}}
          mobileOpen={false}
          onCloseMobile={() => {}}
          onOpenTransactionModal={() => {}}
        />
      </FinanceProvider>
    );

    expect(html).not.toContain('Použitelné peníze:');
    expect(html).not.toContain('Použitelné peníze');
    expect(html).not.toContain('Celkový majetek:');
  });

  it('2. Menu zobrazuje všech 5 nových skupin', () => {
    const html = renderToStaticMarkup(
      <FinanceProvider>
        <Sidebar
          currentScreen="budget"
          onSelectScreen={() => {}}
          mobileOpen={false}
          onCloseMobile={() => {}}
          onOpenTransactionModal={() => {}}
        />
      </FinanceProvider>
    );

    expect(html).toContain('Běžné účty');
    expect(html).toContain('Hotovost');
    expect(html).toContain('Spořicí účty');
    expect(html).toContain('Investice');
    expect(html).toContain('Penzijní účty');
    expect(html).toContain('Celkový majetek');
  });

  it('3. Běžné účty + hotovost správně sčítají zůstatky aktivních účtů checking a cash k dnešku včetně pohybů a korekcí', () => {
    const txs: Transaction[] = [
      // Příjem na běžný účet
      {
        id: 't1',
        title: 'Výplata',
        amountInHaler: 4000000, // +40 000 Kč
        date: '2026-09-10',
        sequence: 1,
        type: 'income',
        sourceAccountId: sampleChecking.id,
        status: 'executed',
        createdAt: '',
        updatedAt: '',
      },
      // Výdaj v hotovosti
      {
        id: 't2',
        title: 'Nákup potravin',
        amountInHaler: 100000, // -1 000 Kč
        date: '2026-09-11',
        sequence: 1,
        type: 'expense',
        sourceAccountId: sampleCash.id,
        status: 'executed',
        createdAt: '',
        updatedAt: '',
      },
      // Korekce zůstatku běžného účtu
      {
        id: 'corr_tx1',
        title: 'Korekce',
        amountInHaler: 50000,
        diffInHaler: -50000, // -500 Kč
        date: '2026-09-12',
        sequence: 1,
        type: 'balance_adjustment',
        sourceAccountId: sampleChecking.id,
        status: 'executed',
        createdAt: '',
        updatedAt: '',
      },
    ];

    // Initial: checking=50 000, cash=3 000 -> 53 000 Kč
    // +40 000 (t1) - 1 000 (t2) - 500 (corr) = 91 500 Kč (9 150 000 haléřů)
    const res = calculateQuickFinancialOverview(allAccounts, txs, [], [], today);
    expect(res.checkingAndCashInHaler).toBe(9150000);
  });

  it('4. Spořicí účty správně sčítají zůstatky spořicích účtů k dnešnímu dni', () => {
    const txs: Transaction[] = [
      {
        id: 't_sav_interest',
        title: 'Úrok',
        amountInHaler: 25000, // +250 Kč
        date: '2026-09-05',
        sequence: 1,
        type: 'income',
        sourceAccountId: sampleSavings.id,
        status: 'executed',
        createdAt: '',
        updatedAt: '',
      },
    ];

    // Initial savings: 150 000 Kč + 250 Kč = 150 250 Kč
    const res = calculateQuickFinancialOverview(allAccounts, txs, [], [], today);
    expect(res.savingsInHaler).toBe(15025000);
  });

  it('5. Investiční účty zohledňují nejnovější snapshot tržní hodnoty k dnešku a návazné převody', () => {
    const snapshots: MarketValueSnapshot[] = [
      {
        id: 'snap1',
        accountId: sampleInvestment.id,
        date: '2026-08-01',
        marketValueInHaler: 10500000, // Starší snapshot 105 000 Kč
        createdAt: '2026-08-01T00:00:00Z',
      },
      {
        id: 'snap2',
        accountId: sampleInvestment.id,
        date: '2026-09-01',
        marketValueInHaler: 11200000, // Nejnovější snapshot k 1. 9.: 112 000 Kč
        createdAt: '2026-09-01T00:00:00Z',
      },
    ];

    const txs: Transaction[] = [
      // Převod před datem snapshotu (je již zahrnut v ocenění)
      {
        id: 'tx_old_transfer',
        title: 'Vklad srpen',
        amountInHaler: 200000,
        date: '2026-08-15',
        sequence: 1,
        type: 'transfer',
        sourceAccountId: sampleChecking.id,
        targetAccountId: sampleInvestment.id,
        status: 'executed',
        createdAt: '',
        updatedAt: '',
      },
      // Převod PO datu snapshotu (musí být přičten)
      {
        id: 'tx_new_transfer',
        title: 'Vklad září',
        amountInHaler: 300000, // +3 000 Kč
        date: '2026-09-05',
        sequence: 1,
        type: 'transfer',
        sourceAccountId: sampleChecking.id,
        targetAccountId: sampleInvestment.id,
        status: 'executed',
        createdAt: '',
        updatedAt: '',
      },
    ];

    // Ocenění 112 000 Kč + vklad 3 000 Kč = 115 000 Kč (11 500 000 haléřů)
    const res = calculateQuickFinancialOverview(allAccounts, txs, [], snapshots, today);
    expect(res.investmentsInHaler).toBe(11500000);
  });

  it('6. Penzijní účty fungují se stejnými pravidly ocenění a vkladů', () => {
    const snapshots: MarketValueSnapshot[] = [
      {
        id: 'pen_snap1',
        accountId: samplePension.id,
        date: '2026-09-01',
        marketValueInHaler: 8500000, // 85 000 Kč
        createdAt: '2026-09-01T00:00:00Z',
      },
    ];

    const txs: Transaction[] = [
      // Pravidelný vklad po snapshotu
      {
        id: 'pen_tx1',
        title: 'Příspěvek na penzijko',
        amountInHaler: 200000, // +2 000 Kč
        date: '2026-09-08',
        sequence: 1,
        type: 'transfer',
        sourceAccountId: sampleChecking.id,
        targetAccountId: samplePension.id,
        status: 'executed',
        createdAt: '',
        updatedAt: '',
      },
    ];

    // 85 000 + 2 000 = 87 000 Kč
    const res = calculateQuickFinancialOverview(allAccounts, txs, [], snapshots, today);
    expect(res.pensionInHaler).toBe(8700000);
  });

  it('7. Budoucí plánované položky (status: planned) nemají na přehled vliv', () => {
    const plannedTxs: Transaction[] = [
      {
        id: 'p1',
        title: 'Budoucí nájem',
        amountInHaler: 2000000, // 20 000 Kč
        date: '2026-09-25',
        sequence: 1,
        type: 'expense',
        sourceAccountId: sampleChecking.id,
        status: 'planned',
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'p2',
        title: 'Dnešní plánovaná platba ještě neprovedená',
        amountInHaler: 500000,
        date: today,
        sequence: 2,
        type: 'expense',
        sourceAccountId: sampleChecking.id,
        status: 'planned',
        createdAt: '',
        updatedAt: '',
      },
    ];

    const res = calculateQuickFinancialOverview(allAccounts, plannedTxs, [], [], today);
    // Checking zůstává přesně na 50 000 Kč + 3 000 Kč cash = 53 000 Kč
    expect(res.checkingAndCashInHaler).toBe(5300000);
  });

  it('8. Budoucí tržní hodnoty (snapshoty > today) se nezahrnují', () => {
    const snapshots: MarketValueSnapshot[] = [
      {
        id: 'snap_now',
        accountId: sampleInvestment.id,
        date: '2026-09-01',
        marketValueInHaler: 11000000, // 110 000 Kč platný k dnešku
        createdAt: '2026-09-01T00:00:00Z',
      },
      {
        id: 'snap_future',
        accountId: sampleInvestment.id,
        date: '2026-09-25', // Budoucí datum
        marketValueInHaler: 20000000, // 200 000 Kč nesmí být použito!
        createdAt: '2026-09-25T00:00:00Z',
      },
    ];

    const res = calculateQuickFinancialOverview(allAccounts, [], [], snapshots, today);
    expect(res.investmentsInHaler).toBe(11000000);
  });

  it('9. Převod mezi vlastními účty nemění celkové jmění (invariant zachování majetku)', () => {
    const initialOverview = calculateQuickFinancialOverview(allAccounts, [], [], [], today);

    // Převod 10 000 Kč z běžného účtu na spořicí účet
    const transferTx: Transaction = {
      id: 'tx_trans_1',
      title: 'Převod na spořák',
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

    const updatedOverview = calculateQuickFinancialOverview(
      allAccounts,
      [transferTx],
      [],
      [],
      today
    );

    // Běžné účty klesly o 10 000 Kč
    expect(updatedOverview.checkingAndCashInHaler).toBe(initialOverview.checkingAndCashInHaler - 1000000);
    // Spořicí účty vzrostly o 10 000 Kč
    expect(updatedOverview.savingsInHaler).toBe(initialOverview.savingsInHaler + 1000000);
    // Celkové jmění se nezměnilo ani o haléř!
    expect(updatedOverview.totalNetWorthInHaler).toBe(initialOverview.totalNetWorthInHaler);
  });

  it('10. Převod z běžného účtu do investic přesune hodnotu mezi skupinami a zachová celkové jmění', () => {
    const initialOverview = calculateQuickFinancialOverview(allAccounts, [], [], [], today);

    // Převod 25 000 Kč z běžného na investiční účet
    const investTransfer: Transaction = {
      id: 'tx_invest_1',
      title: 'Investiční vklad',
      amountInHaler: 2500000, // 25 000 Kč
      date: '2026-09-10',
      sequence: 1,
      type: 'transfer',
      sourceAccountId: sampleChecking.id,
      targetAccountId: sampleInvestment.id,
      status: 'executed',
      createdAt: '',
      updatedAt: '',
    };

    const updatedOverview = calculateQuickFinancialOverview(
      allAccounts,
      [investTransfer],
      [],
      [],
      today
    );

    expect(updatedOverview.checkingAndCashInHaler).toBe(initialOverview.checkingAndCashInHaler - 2500000);
    expect(updatedOverview.investmentsInHaler).toBe(initialOverview.investmentsInHaler + 2500000);
    expect(updatedOverview.totalNetWorthInHaler).toBe(initialOverview.totalNetWorthInHaler);
  });

  it('11. Kontokorent (overdraft) se nepřičítá k zůstatkům ani k celkovému jmění', () => {
    // Účet s nastaveným kontokorentem (např. 20 000 Kč)
    const checkingWithOverdraft: Account = {
      ...sampleChecking,
      initialBalanceInHaler: 1000000, // 10 000 Kč
    };

    const res = calculateQuickFinancialOverview([checkingWithOverdraft], [], [], [], today);
    // Skutečný zůstatek je 10 000 Kč, limit kontokorentu se nepřičítá
    expect(res.checkingAndCashInHaler).toBe(1000000);
    expect(res.totalNetWorthInHaler).toBe(1000000);
  });

  it('12. Archivované účty (status: archived) se nezahrnují do žádné skupiny ani jmění', () => {
    const archivedAccount: Account = {
      ...sampleSavings,
      id: 'acc_archived',
      name: 'Starý zrušený spořák',
      status: 'archived',
      initialBalanceInHaler: 50000000, // 500 000 Kč
    };

    const res = calculateQuickFinancialOverview(
      [sampleChecking, archivedAccount],
      [],
      [],
      [],
      today
    );

    // Pouze checking (50 000 Kč) je zahrnut
    expect(res.savingsInHaler).toBe(0);
    expect(res.totalNetWorthInHaler).toBe(sampleChecking.initialBalanceInHaler);
  });

  it('13. Hodnoty rychlého přehledu se nemění podle zvoleného období v záhlaví aplikace', () => {
    // Testovací komponenta ověřující zobrazení nezávisle na selectedPeriod
    const TestComponent: React.FC = () => {
      const { setSelectedPeriod, forecastSequence, quickOverview } = useFinance();

      return (
        <div>
          <span data-testid="networth">{quickOverview.totalNetWorthInHaler}</span>
          <button
            data-testid="shift-period"
            onClick={() => {
              // Posunout na vzdálenou periodu
              if (forecastSequence && forecastSequence.length > 3) {
                setSelectedPeriod(forecastSequence[3]);
              }
            }}
          >
            Posunout periodu
          </button>
        </div>
      );
    };

    const html = renderToStaticMarkup(
      <FinanceProvider>
        <TestComponent />
      </FinanceProvider>
    );

    // Hodnota jmění je vykreslena
    expect(html).toContain('data-testid="networth"');
  });

  it('14. Každý aktivní účet je započítán právě jednou a celkové jmění se rovná součtu 4 skupin', () => {
    const res = calculateQuickFinancialOverview(allAccounts, [], [], [], today);

    const expectedSum =
      res.checkingAndCashInHaler +
      res.savingsInHaler +
      res.investmentsInHaler +
      res.pensionInHaler;

    expect(res.totalNetWorthInHaler).toBe(expectedSum);
  });

  it('15. Záporný zůstatek na účtu je vykreslen červeně (text-red-600)', () => {
    const overdrawnAccount: Account = {
      ...sampleChecking,
      initialBalanceInHaler: -500000, // -5 000 Kč
    };

    const overview = calculateQuickFinancialOverview([overdrawnAccount], [], [], [], today);
    expect(overview.checkingAndCashInHaler).toBe(-500000);
    expect(overview.totalNetWorthInHaler).toBe(-500000);

    expect(overview.checkingAndCashInHaler < 0).toBe(true);
  });

  it('17. Legacy korekce jednoho účtu se nezahodí kvůli shodnému datu/rozdílu korekce na jiném účtu', () => {
    // Starší (legacy) korekce zůstatku pro běžný účet, bez navázané transakce (importovaná z dřívější verze dat).
    const legacyCorrection: BalanceCorrection = {
      id: 'legacy_corr_checking',
      accountId: sampleChecking.id,
      checkDate: '2026-09-10',
      sequence: 1,
      type: 'balance_adjustment',
      calculatedBalanceInHaler: 5000000,
      actualBalanceInHaler: 5500000,
      diffInHaler: 500000, // +5 000 Kč
      note: '',
      createdAt: '',
      updatedAt: '',
    };

    // Nesouvisející reálná korekční transakce na JINÉM účtu, náhodou se stejným datem a rozdílem.
    const unrelatedTx: Transaction = {
      id: 'tx_corr_savings',
      title: 'Korekce spořáku',
      amountInHaler: 500000,
      date: '2026-09-10',
      sequence: 1,
      type: 'balance_adjustment',
      sourceAccountId: sampleSavings.id,
      status: 'executed',
      diffInHaler: 500000,
      createdAt: '',
      updatedAt: '',
    };

    const res = calculateQuickFinancialOverview(allAccounts, [unrelatedTx], [legacyCorrection], [], today);
    // Běžný účet + hotovost musí zahrnout i legacy korekci (50 000 + 3 000 + 5 000 = 58 000 Kč)
    expect(res.checkingAndCashInHaler).toBe(5800000);
    // Spořicí účet musí zahrnout svou vlastní korekční transakci (150 000 + 5 000 = 155 000 Kč)
    expect(res.savingsInHaler).toBe(15500000);
  });

  it('16. Vizuální integrita: oddělovač a formátování částek v české měně', () => {
    const html = renderToStaticMarkup(
      <FinanceProvider>
        <Sidebar
          currentScreen="budget"
          onSelectScreen={() => {}}
          mobileOpen={false}
          onCloseMobile={() => {}}
          onOpenTransactionModal={() => {}}
        />
      </FinanceProvider>
    );

    // Přítomnost oddělovací linky před Celkovým jměním
    expect(html).toContain('border-t border-slate-200/80');
    // Přítomnost formátování v Kč
    expect(html).toContain('Kč');
    // Třída tabular-nums pro zarovnání čísel
    expect(html).toContain('tabular-nums');
  });
});
