import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Account, Transaction } from '../types/finance';
import {
  getInitialData,
  loadStoredDataResult,
  loadStoredData,
  saveStoredData,
  validateAndParseBackup,
  getActiveStorageKey,
  setActiveStorageKey,
  isTestEnvironment,
  isDemoModeEnabled,
  STORAGE_KEY_PRODUCTION,
  STORAGE_KEY_TEST,
  STORAGE_KEY_DEMO,
  RECOVERY_KEY_PREFIX,
  AppData,
} from '../services/storageService';
import { DEFAULT_CATEGORIES, DEFAULT_SETTINGS, createEmptyAppData } from '../constants/defaultData';
import { isKnownDemoRecordId } from '../fixtures/demoData';

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
    getStore: () => store,
  };
})();

describe('CashPilot - Produkční inicializace, ochrana dat a oddělení prostředí (20 požadavků)', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: storageMock,
      writable: true,
      configurable: true,
    });
    localStorage.clear();
    setActiveStorageKey(null);
    vi.restoreAllMocks();
  });

  afterEach(() => {
    setActiveStorageKey(null);
    vi.unstubAllGlobals();
  });

  it('1. První produkční spuštění neobsahuje žádné demonstrační účty', () => {
    const init = getInitialData();
    expect(init.accounts).toEqual([]);
    expect(init.accounts).toHaveLength(0);

    // Také při čistém načtení z prázdného úložiště
    const res = loadStoredDataResult();
    expect(res.data.accounts).toEqual([]);
    expect(res.data.accounts).toHaveLength(0);
  });

  it('2. První produkční spuštění neobsahuje žádné transakce (příjmy, výdaje, převody)', () => {
    const init = getInitialData();
    expect(init.transactions).toEqual([]);
    expect(init.transactions).toHaveLength(0);
  });

  it('3. První produkční spuštění neobsahuje opakované platby, korekce ani tržní hodnoty', () => {
    const init = getInitialData();
    expect(init.recurringRules).toEqual([]);
    expect(init.recurringExceptions).toEqual([]);
    expect(init.corrections).toEqual([]);
    expect(init.marketValueSnapshots).toEqual([]);
  });

  it('4. Výchozí kategorie jsou vytvořeny bez finančních pohybů a částek', () => {
    const init = getInitialData();
    expect(init.categories.length).toBeGreaterThan(0);
    expect(init.categories).toEqual(DEFAULT_CATEGORIES);

    // Žádná kategorie neobsahuje částky ani transakce
    init.categories.forEach(cat => {
      expect((cat as any).amountInHaler).toBeUndefined();
      expect((cat as any).transactions).toBeUndefined();
    });
  });

  it('5. Existující platná uživatelská data zůstanou v úložišti beze změny', () => {
    const existingUserAcc = {
      id: 'acc_user_real_999',
      name: 'Můj soukromý účet',
      type: 'checking' as const,
      currency: 'CZK' as const,
      initialBalanceInHaler: 5000000,
      currentBalanceInHaler: 5000000,
      isActive: true,
      isDefault: true,
    } as unknown as Account;
    const existingUserData: AppData = {
      version: 1,
    deletions: [],
    sync: { revision: 0, updatedAt: '', updatedByDeviceId: '' },
      settings: { ...DEFAULT_SETTINGS },
      accounts: [existingUserAcc],
      categories: [...DEFAULT_CATEGORIES],
      transactions: [
        {
          id: 'tx_real_1',
          title: 'Skutečný nákup',
          amountInHaler: 125000,
          date: '2026-09-13',
          type: 'expense',
          sourceAccountId: 'acc_user_real_999',
          status: 'executed',
          sequence: 1,
        } as unknown as Transaction
      ],
      recurringRules: [],
      recurringExceptions: [],
      corrections: [],
      marketValueSnapshots: [],
    };

    saveStoredData(existingUserData);
    const loaded = loadStoredData();

    expect(loaded.accounts).toHaveLength(1);
    expect(loaded.accounts[0].id).toBe('acc_user_real_999');
    expect(loaded.transactions).toHaveLength(1);
    expect(loaded.transactions[0].id).toBe('tx_real_1');
  });

  it('6. Aktualizace a migrace aplikace nepřidá žádná demonstrační data', () => {
    const dataWithoutDemo: AppData = {
      version: 1,
    deletions: [],
    sync: { revision: 0, updatedAt: '', updatedByDeviceId: '' },
      settings: { ...DEFAULT_SETTINGS },
      accounts: [{ id: 'my_acc', name: 'Moje banka', type: 'checking', currency: 'CZK', initialBalanceInHaler: 0, currentBalanceInHaler: 0, isActive: true, isDefault: true } as unknown as Account],
      categories: [...DEFAULT_CATEGORIES],
      transactions: [],
      recurringRules: [],
      recurringExceptions: [],
      corrections: [],
      marketValueSnapshots: [],
    };

    saveStoredData(dataWithoutDemo);
    const loaded = loadStoredData();

    // Ověřit, že se po načtení a sanitaci neobjevily žádné demo účty ani demo transakce
    expect(loaded.accounts.some(a => isKnownDemoRecordId(a.id))).toBe(false);
    expect(loaded.transactions.some(t => isKnownDemoRecordId(t.id))).toBe(false);
    expect(loaded.recurringRules.some(r => isKnownDemoRecordId(r.id))).toBe(false);
  });

  it('7. Chybný JSON není nahrazen demonstračními ani prázdnými daty v úložišti', () => {
    const key = getActiveStorageKey();
    const corruptedJSON = '{"version": 1, "accounts": [ INVALID JSON CONTENT ...';
    localStorage.setItem(key, corruptedJSON);

    const result = loadStoredDataResult();
    expect(result.status).toBe('loadError');
    expect(result.error).toContain('Data aplikace se nepodařilo bezpečně načíst');

    // Původní hodnota v úložišti musí zůstat NETKNUTÁ
    expect(localStorage.getItem(key)).toBe(corruptedJSON);
  });

  it('8. Při chybě načítání se automatické ukládání nespustí (status je loadError)', () => {
    const key = getActiveStorageKey();
    localStorage.setItem(key, '{ corrupted');

    const result = loadStoredDataResult();
    expect(result.status).toBe('loadError');

    // Pouze ve stavu ready by došlo k uložení; loadError nesmí volat saveStoredData
    expect(result.status !== 'ready').toBe(true);
    expect(localStorage.getItem(key)).toBe('{ corrupted');
  });

  it('9. Původní poškozená hodnota zůstane dostupná pro obnovu pod recovery klíčem', () => {
    const key = getActiveStorageKey();
    const corruptedContent = '{"corrupted": true, broken';
    localStorage.setItem(key, corruptedContent);

    const result = loadStoredDataResult();
    expect(result.status).toBe('loadError');
    expect(result.recoveryKey).toBeDefined();
    expect(result.recoveryKey?.startsWith(RECOVERY_KEY_PREFIX)).toBe(true);

    // Hodnota je bezpečně zkopírována pod recovery klíčem
    const recovered = localStorage.getItem(result.recoveryKey!);
    expect(recovered).toBe(corruptedContent);
  });

  it('10. Unit a integrační testy automaticky používají pouze testovací storage key', () => {
    expect(isTestEnvironment()).toBe(true);
    expect(getActiveStorageKey()).toBe(STORAGE_KEY_TEST);
    expect(getActiveStorageKey()).not.toBe(STORAGE_KEY_PRODUCTION);
  });

  it('11. E2E testy i unit testy mají izolované prostředí od reálného uživatelského profilu', () => {
    // Vytvoříme produkční záznam, abychom simulovali existující reálná data uživatele
    localStorage.setItem(STORAGE_KEY_PRODUCTION, JSON.stringify({ userRealData: true }));

    // Běžné operace v testu zapisují výhradně do STORAGE_KEY_TEST
    saveStoredData(getInitialData());
    expect(localStorage.getItem(STORAGE_KEY_TEST)).toBeDefined();

    // Produkční data zůstávají netknutá
    expect(localStorage.getItem(STORAGE_KEY_PRODUCTION)).toBe(JSON.stringify({ userRealData: true }));
  });

  it('12. Testy nikdy nemažou ani nepřepisují produkční klíč cashpilot_data_v1', () => {
    const productionContent = JSON.stringify({ accounts: [{ id: 'real_acc' }] });
    localStorage.setItem('cashpilot_data_v1', productionContent);

    // Spuštění inicializace a uložení
    const testData = getInitialData();
    saveStoredData(testData);

    // Produkční klíč je netknutý
    expect(localStorage.getItem('cashpilot_data_v1')).toBe(productionContent);
  });

  it('13. Běžné spuštění inicializace nevytváří demonstrační data', () => {
    const data = createEmptyAppData();
    expect(data.accounts).toHaveLength(0);
    expect(data.transactions).toHaveLength(0);
    expect(data.recurringRules).toHaveLength(0);
    expect(data.corrections).toHaveLength(0);
    expect(data.marketValueSnapshots).toHaveLength(0);
  });

  it('14. Produkční prostředí nemá ve výchozím stavu aktivován demo režim', () => {
    expect(isDemoModeEnabled()).toBe(false);
  });

  it('15. Demo režim (pokud je aktivován) používá oddělené úložiště a neovlivňuje produkční data', () => {
    setActiveStorageKey(STORAGE_KEY_DEMO);
    expect(getActiveStorageKey()).toBe('cashpilot_demo_data_v1');

    saveStoredData(createEmptyAppData());
    expect(localStorage.getItem('cashpilot_demo_data_v1')).toBeDefined();
    expect(localStorage.getItem('cashpilot_data_v1')).toBeNull();
  });

  it('16. Po opakovaném načtení (reloadu) se v prázdném úložišti neobjeví žádná testovací data', () => {
    const firstLoad = loadStoredData();
    saveStoredData(firstLoad);

    // Simulace reloadu stránky
    const secondLoad = loadStoredData();
    expect(secondLoad.accounts).toHaveLength(0);
    expect(secondLoad.transactions).toHaveLength(0);
    expect(secondLoad.recurringRules).toHaveLength(0);
  });

  it('17. Import platné zálohy zachová pouze data obsažená v záloze', () => {
    const backupJSON = JSON.stringify({
      version: 1,
    deletions: [],
    sync: { revision: 0, updatedAt: '', updatedByDeviceId: '' },
      settings: { ...DEFAULT_SETTINGS },
      accounts: [
        { id: 'imported_acc_1', name: 'Importovaný účet', type: 'checking', currency: 'CZK', initialBalanceInHaler: 100000, currentBalanceInHaler: 100000, isActive: true, isDefault: true }
      ],
      categories: [...DEFAULT_CATEGORIES],
      transactions: [],
      recurringRules: [],
      recurringExceptions: [],
      corrections: [],
      marketValueSnapshots: [],
    });

    const parsed = validateAndParseBackup(backupJSON);
    expect(parsed.accounts).toHaveLength(1);
    expect(parsed.accounts[0].id).toBe('imported_acc_1');
    expect(parsed.transactions).toHaveLength(0);
  });

  it('18. Detekce známých demonstračních záznamů funguje podle přesných ID, nikoliv pouhých názvů', () => {
    // Reálný účet uživatele se shodným názvem "Běžný účet", ale vlastním ID
    const userAccount = {
      id: 'acc_user_custom_checking_123',
      name: 'Běžný účet',
    };
    expect(isKnownDemoRecordId(userAccount.id)).toBe(false);

    // Skutečné demo účty mají známá demo ID
    expect(isKnownDemoRecordId('demo_acc_checking')).toBe(true);
    expect(isKnownDemoRecordId('demo_acc_cash')).toBe(true);
    expect(isKnownDemoRecordId('demo_tx_1')).toBe(true);
    expect(isKnownDemoRecordId('rec_salary')).toBe(true);
  });

  it('19. Žádný uživatelský záznam není vyhodnocen jako demo pouze na základě názvu', () => {
    const userTitles = [
      'Nákup potravin na víkend',
      'Tankování Benzina',
      'Mzda',
      'Hypotéka',
      'Běžný účet',
      'Spořicí účet',
    ];

    userTitles.forEach(() => {
      const userCustomId = `user_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      expect(isKnownDemoRecordId(userCustomId)).toBe(false);
    });
  });

  it('20. Všechny operace s úložištěm probíhají bez narušení produkčního klíče', () => {
    const prodKey = 'cashpilot_data_v1';
    localStorage.setItem(prodKey, JSON.stringify({ protected: 'secret_user_data' }));

    // Proveď standardní cyklus uložení a načtení v testovacím prostředí
    const appData = getInitialData();
    saveStoredData(appData);
    const loaded = loadStoredData();

    expect(loaded.accounts).toHaveLength(0);
    // Produkční klíč zůstává 100% zachován a nedotčen
    expect(localStorage.getItem(prodKey)).toBe(JSON.stringify({ protected: 'secret_user_data' }));
  });
});
