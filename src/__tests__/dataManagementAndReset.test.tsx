import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FinanceProvider, useFinance } from '../context/FinanceContext';
import { SettingsScreen } from '../components/settings/SettingsScreen';
import { TransactionsScreen } from '../components/transactions/TransactionsScreen';
import { DataActionConfirmationModal } from '../components/settings/DataActionConfirmationModal';
import {
  OPERATION_RECOVERY_KEY,
  getOperationRecoveryBackup,
  getActiveStorageKey,
  loadStoredDataResult,
  saveStoredData,
  AppData
} from '../services/storageService';
import { DEFAULT_CATEGORIES, DEFAULT_SETTINGS } from '../constants/defaultData';
import { Account, Transaction, RecurringRule, BalanceCorrection, MarketValueSnapshot } from '../types/finance';
import { saveStoredAuth } from '../services/googleDriveService';

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

// Vzorová testovací data
const sampleAccounts: Account[] = [
  {
    id: 'acc_checking_1',
    name: 'Hlavní běžný účet',
    type: 'checking',
    currency: 'CZK',
    initialBalanceInHaler: 5000000,
    initialBalanceDate: '2026-01-01',
    isUsableCash: true,
    isNetWorth: true,
    isDefault: true,
    color: '#0284c7',
    sortOrder: 1,
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'acc_archived_1',
    name: 'Starý archivovaný účet',
    type: 'savings',
    currency: 'CZK',
    initialBalanceInHaler: 1000000,
    initialBalanceDate: '2025-01-01',
    isUsableCash: false,
    isNetWorth: true,
    isDefault: false,
    color: '#10b981',
    sortOrder: 2,
    status: 'archived',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'acc_invest_1',
    name: 'Investiční účet',
    type: 'investment',
    currency: 'CZK',
    initialBalanceInHaler: 10000000,
    initialBalanceDate: '2026-01-01',
    isUsableCash: false,
    isNetWorth: true,
    isDefault: false,
    color: '#8b5cf6',
    sortOrder: 3,
    status: 'active',
    currentMarketValueInHaler: 12000000,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }
];

const sampleTransactions: Transaction[] = [
  {
    id: 'tx_salary',
    title: 'Výplata ze zaměstnání',
    amountInHaler: 4500000,
    date: '2026-09-10',
    sequence: 1,
    type: 'income',
    sourceAccountId: 'acc_checking_1',
    categoryId: 'cat_income',
    subcategoryId: 'sub_income_salary',
    status: 'executed',
    actualAmountInHaler: 4500000,
    createdAt: '2026-09-10T00:00:00Z',
    updatedAt: '2026-09-10T00:00:00Z',
  },
  {
    id: 'tx_rent',
    title: 'Nájemné',
    amountInHaler: 1800000,
    date: '2026-09-12',
    sequence: 1,
    type: 'expense',
    sourceAccountId: 'acc_checking_1',
    categoryId: 'cat_housing',
    subcategoryId: 'sub_housing_mortgage',
    status: 'executed',
    actualAmountInHaler: 1800000,
    createdAt: '2026-09-12T00:00:00Z',
    updatedAt: '2026-09-12T00:00:00Z',
  },
  {
    id: 'tx_transfer',
    title: 'Převod na spoření',
    amountInHaler: 500000,
    date: '2026-09-14',
    sequence: 1,
    type: 'transfer',
    sourceAccountId: 'acc_checking_1',
    targetAccountId: 'acc_archived_1',
    status: 'planned',
    createdAt: '2026-09-14T00:00:00Z',
    updatedAt: '2026-09-14T00:00:00Z',
  }
];

const sampleRules: RecurringRule[] = [
  {
    id: 'rule_salary',
    title: 'Pravidelná mzda',
    amountInHaler: 4500000,
    type: 'income',
    frequency: 'monthly',
    dayOfMonth: 10,
    startDate: '2026-10-01',
    sourceAccountId: 'acc_checking_1',
    categoryId: 'cat_income',
    subcategoryId: 'sub_income_salary',
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }
];

const sampleCorrections: BalanceCorrection[] = [
  {
    id: 'corr_1',
    accountId: 'acc_checking_1',
    checkDate: '2026-09-01',
    actualBalanceInHaler: 4900000,
    calculatedBalanceInHaler: 5000000,
    diffInHaler: -100000,
    createdAt: '2026-09-01T00:00:00Z',
  }
];

const sampleMarketValues: MarketValueSnapshot[] = [
  {
    id: 'mv_1',
    accountId: 'acc_invest_1',
    date: '2026-09-01',
    marketValueInHaler: 12000000,
    createdAt: '2026-09-01T00:00:00Z',
  }
];

function populateTestStorage(customData?: Partial<AppData>): AppData {
  const fullData: AppData = {
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
    accounts: [...sampleAccounts],
    categories: [...DEFAULT_CATEGORIES],
    transactions: [...sampleTransactions],
    recurringRules: [...sampleRules],
    recurringExceptions: [],
    corrections: [...sampleCorrections],
    marketValueSnapshots: [...sampleMarketValues],
    ...customData,
  };
  saveStoredData(fullData, getActiveStorageKey());
  return fullData;
}

function getContextHandle() {
  let ctx: any;
  const Consumer = () => {
    ctx = useFinance();
    return null;
  };
  renderToStaticMarkup(
    <FinanceProvider>
      <Consumer />
    </FinanceProvider>
  );
  return ctx;
}

describe('CashPilot - Správa dat a reset (21 požadavků)', () => {
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // 1. Funkce „Zkontrolovat a vyčistit ukázková data“ byla odstraněna
  it('1. Funkce „Zkontrolovat a vyčistit ukázková data“ byla kompletně odstraněna z UI i kontextu', () => {
    populateTestStorage();
    const html = renderToStaticMarkup(
      <FinanceProvider>
        <SettingsScreen />
      </FinanceProvider>
    );

    expect(html).not.toContain('Zkontrolovat a vyčistit ukázková data');
    expect(html).not.toContain('ukázkových účtů');
    expect(html).toContain('Správa jednotlivých dat');
    expect(html).toContain('Nebezpečná zóna');
  });

  // 2. Vymazání transakcí odstraní všechny finanční položky
  it('2. Vymazání transakcí odstraní všechny finanční položky (uskutečněné, plánované, převody)', () => {
    populateTestStorage();
    const ctx = getContextHandle();

    expect(ctx.transactions.length).toBe(3);
    const result = ctx.clearAllTransactions();
    expect(result).toBe(true);

    const reloaded = loadStoredDataResult();
    expect(reloaded.data.transactions.length).toBe(0);
  });

  // 3. Vymazání transakcí odstraní pravidla a výjimky opakovaných plateb
  it('3. Vymazání transakcí odstraní pravidla i výjimky opakovaných plateb', () => {
    populateTestStorage({
      recurringExceptions: [
        { id: 'exc_1', ruleId: 'rule_salary', periodKey: '2026-10', isCancelled: true, createdAt: '' }
      ]
    });
    const ctx = getContextHandle();

    expect(ctx.recurringRules.length).toBe(1);
    expect(ctx.recurringExceptions.length).toBe(1);

    ctx.clearAllTransactions();

    const reloaded = loadStoredDataResult();
    expect(reloaded.data.recurringRules.length).toBe(0);
    expect(reloaded.data.recurringExceptions.length).toBe(0);
  });

  // 4. Vymazání transakcí odstraní korekce
  it('4. Vymazání transakcí odstraní všechny korekce zůstatků', () => {
    populateTestStorage();
    const ctx = getContextHandle();

    expect(ctx.corrections.length).toBe(1);
    ctx.clearAllTransactions();

    const reloaded = loadStoredDataResult();
    expect(reloaded.data.corrections.length).toBe(0);
  });

  // 5. Vymazání transakcí zachová účty, kategorie a nastavení
  it('5. Vymazání transakcí zachová účty, kategorie a nastavení', () => {
    populateTestStorage();
    const ctx = getContextHandle();

    ctx.clearAllTransactions();

    const reloaded = loadStoredDataResult();
    expect(reloaded.data.accounts.length).toBe(3);
    expect(reloaded.data.accounts[0].id).toBe('acc_checking_1');
    expect(reloaded.data.accounts[0].initialBalanceInHaler).toBe(5000000);
    expect(reloaded.data.accounts[0].isDefault).toBe(true);
    expect(reloaded.data.categories.length).toBe(DEFAULT_CATEGORIES.length);
    expect(reloaded.data.settings.currency).toBe('CZK');
    expect(reloaded.data.settings.budgetStartDay).toBe(15);
  });

  // 6. Vymazání transakcí zachová tržní hodnoty
  it('6. Vymazání transakcí zachová tržní hodnoty investičních a penzijních účtů', () => {
    populateTestStorage();
    const ctx = getContextHandle();

    ctx.clearAllTransactions();

    const reloaded = loadStoredDataResult();
    expect(reloaded.data.marketValueSnapshots.length).toBe(1);
    expect(reloaded.data.marketValueSnapshots[0].marketValueInHaler).toBe(12000000);
  });

  // 7. Vymazání účtů odstraní aktivní i archivované účty
  it('7. Vymazání účtů odstraní všechny aktivní i archivované účty', () => {
    populateTestStorage();
    const ctx = getContextHandle();

    expect(ctx.accounts.length).toBe(3);
    const result = ctx.clearAllAccounts();
    expect(result).toBe(true);

    const reloaded = loadStoredDataResult();
    expect(reloaded.data.accounts.length).toBe(0);
  });

  // 8. Vymazání účtů odstraní všechny závislé finanční záznamy
  it('8. Vymazání účtů odstraní všechny transakce, převody, pravidla, korekce i tržní hodnoty', () => {
    populateTestStorage();
    const ctx = getContextHandle();

    ctx.clearAllAccounts();

    const reloaded = loadStoredDataResult();
    expect(reloaded.data.accounts.length).toBe(0);
    expect(reloaded.data.transactions.length).toBe(0);
    expect(reloaded.data.recurringRules.length).toBe(0);
    expect(reloaded.data.recurringExceptions.length).toBe(0);
    expect(reloaded.data.corrections.length).toBe(0);
    expect(reloaded.data.marketValueSnapshots.length).toBe(0);
  });

  // 9. Vymazání účtů zachová kategorie a nastavení
  it('9. Vymazání účtů zachová kategorie a nastavení aplikace', () => {
    populateTestStorage();
    const ctx = getContextHandle();

    ctx.clearAllAccounts();

    const reloaded = loadStoredDataResult();
    expect(reloaded.data.categories.length).toBe(DEFAULT_CATEGORIES.length);
    expect(reloaded.data.settings.budgetStartDay).toBe(15);
  });

  // 10. Vymazání kategorií odstraní hlavní kategorie i podkategorie
  it('10. Vymazání kategorií odstraní všechny hlavní kategorie i podkategorie', () => {
    populateTestStorage();
    const ctx = getContextHandle();

    expect(ctx.categories.length).toBeGreaterThan(0);
    const result = ctx.clearAllCategories();
    expect(result).toBe(true);

    const reloaded = loadStoredDataResult();
    expect(reloaded.data.categories.length).toBe(0);
  });

  // 11. Vymazání kategorií zachová transakce a účty
  it('11. Vymazání kategorií zachová transakce a účty', () => {
    populateTestStorage();
    const ctx = getContextHandle();

    ctx.clearAllCategories();

    const reloaded = loadStoredDataResult();
    expect(reloaded.data.accounts.length).toBe(3);
    expect(reloaded.data.transactions.length).toBe(3);
    expect(reloaded.data.recurringRules.length).toBe(1);
    expect(reloaded.data.corrections.length).toBe(1);
    expect(reloaded.data.marketValueSnapshots.length).toBe(1);
  });

  // 12. Zachované transakce jsou po odstranění kategorií označeny „Bez kategorie“
  it('12. Zachované transakce mají po odstranění kategorií categoryId null a v UI se zobrazují jako „Bez kategorie“', () => {
    populateTestStorage();
    const ctx = getContextHandle();

    ctx.clearAllCategories();

    const reloaded = loadStoredDataResult();
    // Všechny transakce mají categoryId i subcategoryId null
    expect(reloaded.data.transactions.every((t: Transaction) => t.categoryId === null && t.subcategoryId === null)).toBe(true);
    // Všechna pravidla mají categoryId i subcategoryId null
    expect(reloaded.data.recurringRules.every((r: RecurringRule) => r.categoryId === null && r.subcategoryId === null)).toBe(true);

    // V UI TransactionsScreen se vykreslí "Bez kategorie"
    const html = renderToStaticMarkup(
      <FinanceProvider>
        <TransactionsScreen
          onOpenTransactionModal={() => {}}
          onEditTransaction={() => {}}
        />
      </FinanceProvider>
    );
    expect(html).toContain('Bez kategorie');
  });

  // 13. Kategorie se po restartu automaticky znovu nevytvoří
  it('13. Kategorie se po reloadu / načtení z úložiště znovu automaticky nevytvoří', () => {
    populateTestStorage();
    const ctx = getContextHandle();

    ctx.clearAllCategories();

    // 1. reload
    const reloaded1 = loadStoredDataResult();
    expect(reloaded1.data.categories.length).toBe(0);

    // 2. reload (opakovaný start)
    const reloaded2 = loadStoredDataResult();
    expect(reloaded2.data.categories.length).toBe(0);
  });

  // 14. Kompletní vymazání odstraní všechny typy uživatelských dat
  it('14. Kompletní vymazání odstraní všechny typy uživatelských dat (0 účtů, 0 tx, 0 pravidel, 0 korekcí, 0 tržních hodnot, 0 kategorií)', () => {
    populateTestStorage();
    const ctx = getContextHandle();

    const result = ctx.resetAllData();
    expect(result).toBe(true);

    const reloaded = loadStoredDataResult();
    expect(reloaded.data.accounts.length).toBe(0);
    expect(reloaded.data.transactions.length).toBe(0);
    expect(reloaded.data.recurringRules.length).toBe(0);
    expect(reloaded.data.recurringExceptions.length).toBe(0);
    expect(reloaded.data.corrections.length).toBe(0);
    expect(reloaded.data.marketValueSnapshots.length).toBe(0);
    expect(reloaded.data.categories.length).toBe(0);
  });

  // 15. Kompletní vymazání vyžaduje text „VYMAZAT VŠE“
  it('15. Modální dialog pro kompletní vymazání vyžaduje přesný potvrzovací text „VYMAZAT VŠE“', () => {
    const html = renderToStaticMarkup(
      <DataActionConfirmationModal
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
        title="Kompletně vymazat všechna data"
        description="Budou odstraněny všechny účty, transakce, kategorie, opakované platby, korekce, tržní hodnoty a nastavení aplikace."
        warningMessage="Trvale odstraní všechna uživatelská data a vrátí aplikaci do čistého počátečního stavu."
        affectedRecords={[
          { label: 'Účty', count: 3 },
          { label: 'Finanční položky', count: 5 },
        ]}
        confirmButtonText="Trvale vymazat vše"
        onDownloadBackup={() => {}}
        requiresConfirmationPhrase={true}
        confirmationPhrase="VYMAZAT VŠE"
      />
    );

    expect(html).toContain('VYMAZAT VŠE');
    expect(html).toContain('Budou odstraněny všechny účty, transakce, kategorie, opakované platby, korekce, tržní hodnoty a nastavení aplikace.');
    expect(html).toContain('Dotčené záznamy k odstranění');
    expect(html).toContain('Stáhnout zálohu');
    expect(html).toContain('disabled');
  });

  // 16. Po kompletním vymazání se nevytvoří demonstrační data
  it('16. Po kompletním vymazání a reloadu se nevytvoří žádná demonstrační ani testovací data', () => {
    populateTestStorage();
    const ctx = getContextHandle();

    ctx.resetAllData();

    const loaded = loadStoredDataResult();
    expect(loaded.data.accounts).toEqual([]);
    expect(loaded.data.transactions).toEqual([]);
    expect(loaded.data.recurringRules).toEqual([]);
    expect(loaded.data.categories).toEqual([]);
    expect(loaded.data.corrections).toEqual([]);
    expect(loaded.data.marketValueSnapshots).toEqual([]);
  });

  // 17. Před každou operací vznikne platná recovery záloha
  it('17. Před každou operací vznikne platná recovery záloha pod recovery klíčem s typem a časem', () => {
    populateTestStorage();
    const ctx = getContextHandle();

    // Test 1: clearAllTransactions
    ctx.clearAllTransactions();
    let backup = getOperationRecoveryBackup();
    expect(backup).not.toBeNull();
    expect(backup?.operationType).toBe('clear_transactions');
    expect(backup?.timestamp).toBeDefined();
    expect(backup?.data.transactions.length).toBe(3);

    // Obnovit testovací data
    populateTestStorage();

    // Test 2: clearAllAccounts
    ctx.clearAllAccounts();
    backup = getOperationRecoveryBackup();
    expect(backup?.operationType).toBe('clear_accounts');
    expect(backup?.data.accounts.length).toBe(3);

    // Obnovit testovací data
    populateTestStorage();

    // Test 3: clearAllCategories
    ctx.clearAllCategories();
    backup = getOperationRecoveryBackup();
    expect(backup?.operationType).toBe('clear_categories');
    expect(backup?.data.categories.length).toBe(DEFAULT_CATEGORIES.length);

    // Obnovit testovací data
    populateTestStorage();

    // Test 4: resetAllData
    ctx.resetAllData();
    backup = getOperationRecoveryBackup();
    expect(backup?.operationType).toBe('clear_all');
  });

  // 18. Při selhání zálohy se mazání neprovede
  it('18. Pokud uložení recovery zálohy selže, operace mazání se neprovede a data zůstanou nedotčena', () => {
    populateTestStorage();
    const ctx = getContextHandle();

    // Simulace selhání localStorage.setItem (např. QuotaExceededError)
    const originalSetItem = localStorage.setItem;
    vi.spyOn(localStorage, 'setItem').mockImplementation((key: string, value: string) => {
      if (key === OPERATION_RECOVERY_KEY) {
        throw new Error('QuotaExceededError');
      }
      return originalSetItem.call(localStorage, key, value);
    });

    const result = ctx.clearAllTransactions();
    expect(result).toBe(false);

    // Data v úložišti nebyla smazána!
    const reloaded = loadStoredDataResult();
    expect(reloaded.data.transactions.length).toBe(3);

    vi.restoreAllMocks();
  });

  // 19. Po operaci nezůstanou žádné neplatné reference
  it('19. Po provedení operací nezůstanou žádné neplatné nebo osiřelé reference', () => {
    populateTestStorage();
    const ctx = getContextHandle();

    // Po vymazání kategorií žádná položka neodkazuje na neexistující kategorii
    ctx.clearAllCategories();
    const dataAfterCatClear = loadStoredDataResult().data;
    expect(dataAfterCatClear.transactions.every((t: Transaction) => !t.categoryId)).toBe(true);
    expect(dataAfterCatClear.recurringRules.every((r: RecurringRule) => !r.categoryId)).toBe(true);

    // Po vymazání účtů žádná položka ani korekce ani tržní hodnota neodkazuje na účet
    ctx.clearAllAccounts();
    const dataAfterAccClear = loadStoredDataResult().data;
    expect(dataAfterAccClear.accounts.length).toBe(0);
    expect(dataAfterAccClear.transactions.length).toBe(0);
    expect(dataAfterAccClear.recurringRules.length).toBe(0);
    expect(dataAfterAccClear.corrections.length).toBe(0);
    expect(dataAfterAccClear.marketValueSnapshots.length).toBe(0);
    expect(dataAfterAccClear.accounts.filter((a: Account) => a.isDefault).length).toBe(0);
  });

  // 20. Po obnovení stránky zůstane vyčištěný stav zachován
  it('20. Po uložení a restartu (reload) zůstane vyčištěný stav trvale uložen v localStorage', () => {
    populateTestStorage();
    const ctx = getContextHandle();

    ctx.clearAllTransactions();

    const loaded = loadStoredDataResult();
    expect(loaded.data.transactions.length).toBe(0);
    expect(loaded.data.recurringRules.length).toBe(0);
    expect(loaded.data.corrections.length).toBe(0);
    expect(loaded.data.accounts.length).toBe(3);
  });

  // 21. Ostatní funkce aplikace zůstanou funkční
  it('21. Ostatní funkce aplikace (přidání účtu, běžné nastavení, atd.) zůstávají plně funkční', () => {
    populateTestStorage();
    const ctx = getContextHandle();

    ctx.clearAllAccounts();

    const newAcc = ctx.addAccount({
      name: 'Nový běžný účet',
      type: 'checking',
      currency: 'CZK',
      initialBalanceInHaler: 1500000,
      initialBalanceDate: '2026-09-01',
      isUsableCash: true,
      isNetWorth: true,
      isDefault: true,
      color: '#0284c7',
      sortOrder: 1,
      status: 'active',
    });

    expect(newAcc.id).toBeDefined();
    expect(newAcc.name).toBe('Nový běžný účet');
    expect(newAcc.isDefault).toBe(true);
    expect(newAcc.initialBalanceInHaler).toBe(1500000);

    // Exportní a importní funkce zůstávají dostupné
    expect(typeof ctx.exportJSON).toBe('function');
    expect(typeof ctx.exportCSV).toBe('function');
    expect(typeof ctx.importJSON).toBe('function');
  });
});
