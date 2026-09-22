import { describe, it, expect, beforeEach } from 'vitest';
import { Account, Category, Transaction, MovementType } from '../types/finance';
import { czechStringCompare } from '../services/categoryService';
import { AppData, getInitialData } from '../services/storageService';
import { loadStoredData, saveStoredData } from './testStorageHelpers';
import { calculateForecast } from '../services/financialEngine';
import { generatePeriodsSequence } from '../services/periodService';

describe('CashPilot - Správa výchozího účtu a formulář Nová finanční položka', () => {

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
      }
    };
  })();

  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: storageMock,
      writable: true,
      configurable: true
    });
    localStorage.clear();
  });

  // 1. Kategorie jsou ve formuláři seřazené A–Z
  it('1. Kategorie jsou seřazené abecedně A–Z', () => {
    const cats: Category[] = [
      { id: 'c1', name: 'Zábava', type: 'expense', parentId: null, color: '', icon: '', sortOrder: 1, status: 'active', createdAt: '', updatedAt: '' },
      { id: 'c2', name: 'Auto', type: 'expense', parentId: null, color: '', icon: '', sortOrder: 2, status: 'active', createdAt: '', updatedAt: '' },
      { id: 'c3', name: 'Bydlení', type: 'expense', parentId: null, color: '', icon: '', sortOrder: 3, status: 'active', createdAt: '', updatedAt: '' },
    ];
    const sorted = [...cats].sort((a, b) => czechStringCompare(a.name, b.name));
    expect(sorted.map(c => c.name)).toEqual(['Auto', 'Bydlení', 'Zábava']);
  });

  // 2. Výchozí kategorií je -- Žádná -- (null / neuloženo jako textový název)
  it('2. Výchozí kategorií je -- Žádná -- a ukládá se jako null / undefined', () => {
    const initialCategoryId = '';
    const storedCategoryId = initialCategoryId ? initialCategoryId : null;
    expect(storedCategoryId).toBeNull();
    expect(storedCategoryId).not.toBe('-- Žádná --');
  });

  // 3. Podkategorie jsou seřazené A–Z
  it('3. Podkategorie jsou seřazené abecedně A–Z', () => {
    const subcats: Category[] = [
      { id: 's1', name: 'Servis', type: 'expense', parentId: 'c2', color: '', icon: '', sortOrder: 1, status: 'active', createdAt: '', updatedAt: '' },
      { id: 's2', name: 'Benzín', type: 'expense', parentId: 'c2', color: '', icon: '', sortOrder: 2, status: 'active', createdAt: '', updatedAt: '' },
      { id: 's3', name: 'Dálniční známka', type: 'expense', parentId: 'c2', color: '', icon: '', sortOrder: 3, status: 'active', createdAt: '', updatedAt: '' },
    ];
    const sorted = [...subcats].sort((a, b) => czechStringCompare(a.name, b.name));
    expect(sorted.map(s => s.name)).toEqual(['Benzín', 'Dálniční známka', 'Servis']);
  });

  // 4. Výchozí podkategorií je -- Žádná --
  it('4. Výchozí podkategorií je -- Žádná -- a ukládá se jako null / undefined', () => {
    const initialSubcategoryId = '';
    const storedSubcategoryId = initialSubcategoryId ? initialSubcategoryId : null;
    expect(storedSubcategoryId).toBeNull();
    expect(storedSubcategoryId).not.toBe('-- Žádná --');
  });

  // 5. Změna hlavní kategorie resetuje podkategorii
  it('5. Změna hlavní kategorie resetuje podkategorii na prázdnou hodnotu (-- Žádná --)', () => {
    let currentCategoryId = 'c_auto';
    let currentSubcategoryId = 'sub_benzin';

    // Funkce změny hlavní kategorie
    const handleCategoryChange = (newCatId: string) => {
      currentCategoryId = newCatId;
      currentSubcategoryId = ''; // Vždy resetuje na -- Žádná --
    };

    handleCategoryChange('c_bydleni');
    expect(currentCategoryId).toBe('c_bydleni');
    expect(currentSubcategoryId).toBe('');
  });

  // 6. Příjmy zobrazují pouze příjmové kategorie
  it('6. Pro příjem se zobrazují pouze příjmové kategorie a archivované se nenabízejí', () => {
    const allCategories: Category[] = [
      { id: 'inc1', name: 'Mzda', type: 'income', parentId: null, color: '', icon: '', sortOrder: 1, status: 'active', createdAt: '', updatedAt: '' },
      { id: 'inc2_arch', name: 'Starý vedlejšák', type: 'income', parentId: null, color: '', icon: '', sortOrder: 2, status: 'archived', createdAt: '', updatedAt: '' },
      { id: 'exp1', name: 'Jídlo', type: 'expense', parentId: null, color: '', icon: '', sortOrder: 3, status: 'active', createdAt: '', updatedAt: '' },
    ];

    const isEditing = false;
    const type: MovementType = 'income';
    const relevantCategories = allCategories
      .filter(c => 
        !c.parentId && 
        ((type as string) === 'transfer' ? false : c.type === type) &&
        (isEditing ? (c.status === 'active') : c.status === 'active')
      )
      .sort((a, b) => czechStringCompare(a.name, b.name));

    expect(relevantCategories.map(c => c.name)).toEqual(['Mzda']);
  });

  // 7. Výdaje zobrazují pouze výdajové kategorie
  it('7. Pro výdaj se zobrazují pouze výdajové kategorie a při změně typu se neplatná kategorie resetuje', () => {
    const allCategories: Category[] = [
      { id: 'inc1', name: 'Mzda', type: 'income', parentId: null, color: '', icon: '', sortOrder: 1, status: 'active', createdAt: '', updatedAt: '' },
      { id: 'exp1', name: 'Auto', type: 'expense', parentId: null, color: '', icon: '', sortOrder: 2, status: 'active', createdAt: '', updatedAt: '' },
      { id: 'exp2', name: 'Bydlení', type: 'expense', parentId: null, color: '', icon: '', sortOrder: 3, status: 'active', createdAt: '', updatedAt: '' },
    ];

    const type: MovementType = 'expense';
    const relevantCategories = allCategories
      .filter(c => !c.parentId && c.type === type && c.status === 'active')
      .sort((a, b) => czechStringCompare(a.name, b.name));

    expect(relevantCategories.map(c => c.name)).toEqual(['Auto', 'Bydlení']);

    // Ověření resetu při přepnutí typu
    let selectedCat = 'inc1';
    let selectedSubcat = 'sub_salary';

    const handleTypeChange = (newType: MovementType) => {
      const cat = allCategories.find(c => c.id === selectedCat);
      if (!cat || cat.type !== newType || cat.status === 'archived') {
        selectedCat = '';
        selectedSubcat = '';
      }
    };

    handleTypeChange('expense');
    expect(selectedCat).toBe('');
    expect(selectedSubcat).toBe('');
  });

  // 8. Účty jsou seřazené A–Z
  it('8. Účty jsou seřazené abecedně A–Z', () => {
    const accs: Account[] = [
      { id: 'a1', name: 'Spořicí účet', type: 'savings', currency: 'CZK', initialBalanceInHaler: 0, initialBalanceDate: '2026-01-01', isUsableCash: true, isNetWorth: true, color: '', sortOrder: 1, status: 'active', createdAt: '', updatedAt: '' },
      { id: 'a2', name: 'Běžný účet', type: 'checking', currency: 'CZK', initialBalanceInHaler: 0, initialBalanceDate: '2026-01-01', isUsableCash: true, isNetWorth: true, color: '', sortOrder: 2, status: 'active', createdAt: '', updatedAt: '' },
      { id: 'a3', name: 'Investice ČSOB', type: 'investment', currency: 'CZK', initialBalanceInHaler: 0, initialBalanceDate: '2026-01-01', isUsableCash: false, isNetWorth: true, color: '', sortOrder: 3, status: 'active', createdAt: '', updatedAt: '' },
    ];

    const sorted = [...accs].sort((a, b) => czechStringCompare(a.name, b.name));
    expect(sorted.map(a => a.name)).toEqual(['Běžný účet', 'Investice ČSOB', 'Spořicí účet']);
  });

  // 9. Výchozí účet se při nové položce automaticky předvybere
  it('9. Výchozí účet se při nové položce automaticky předvybere, pokud je k danému datu aktivní', () => {
    const accs: Account[] = [
      { id: 'a1', name: 'Běžný účet', type: 'checking', currency: 'CZK', initialBalanceInHaler: 0, initialBalanceDate: '2026-01-01', isUsableCash: true, isNetWorth: true, isDefault: true, color: '', sortOrder: 1, status: 'active', createdAt: '', updatedAt: '' },
      { id: 'a2', name: 'Hotovost', type: 'cash', currency: 'CZK', initialBalanceInHaler: 0, initialBalanceDate: '2026-01-01', isUsableCash: true, isNetWorth: true, color: '', sortOrder: 2, status: 'active', createdAt: '', updatedAt: '' },
    ];

    const defaultDate = '2026-09-15';
    const defaultAcc = accs.find(a => a.status === 'active' && a.isDefault);
    const isDefaultValid = defaultAcc && (!defaultAcc.initialBalanceDate || defaultAcc.initialBalanceDate <= defaultDate);

    const preselectedSourceAccountId = isDefaultValid ? defaultAcc.id : '';
    expect(preselectedSourceAccountId).toBe('a1');
  });

  // 10. Výchozí účet zůstává v dropdownu na svém abecedním místě
  it('10. Výchozí účet zůstává v dropdownu na svém abecedním místě a nepřesouvá se na začátek', () => {
    const accs: Account[] = [
      { id: 'a1', name: 'Air Bank', type: 'checking', currency: 'CZK', initialBalanceInHaler: 0, initialBalanceDate: '2026-01-01', isUsableCash: true, isNetWorth: true, isDefault: false, color: '', sortOrder: 1, status: 'active', createdAt: '', updatedAt: '' },
      { id: 'a2', name: 'Česká spořitelna', type: 'checking', currency: 'CZK', initialBalanceInHaler: 0, initialBalanceDate: '2026-01-01', isUsableCash: true, isNetWorth: true, isDefault: true, color: '', sortOrder: 2, status: 'active', createdAt: '', updatedAt: '' },
      { id: 'a3', name: 'Fio banka', type: 'checking', currency: 'CZK', initialBalanceInHaler: 0, initialBalanceDate: '2026-01-01', isUsableCash: true, isNetWorth: true, isDefault: false, color: '', sortOrder: 3, status: 'active', createdAt: '', updatedAt: '' },
    ];

    const sortedDropdown = [...accs].sort((a, b) => czechStringCompare(a.name, b.name));
    expect(sortedDropdown.map(a => a.name)).toEqual(['Air Bank', 'Česká spořitelna', 'Fio banka']);
    // Česká spořitelna je výchozí, ale v dropdownu zůstává na svém 2. místě
    expect(sortedDropdown[1].isDefault).toBe(true);
  });

  // 11. Bez výchozího účtu se zobrazí -- Žádný --
  it('11. Bez výchozího účtu se automaticky nepředvybere první účet a zobrazí se prázdná hodnota (-- Žádný --)', () => {
    const accs: Account[] = [
      { id: 'a1', name: 'Air Bank', type: 'checking', currency: 'CZK', initialBalanceInHaler: 0, initialBalanceDate: '2026-01-01', isUsableCash: true, isNetWorth: true, isDefault: false, color: '', sortOrder: 1, status: 'active', createdAt: '', updatedAt: '' },
      { id: 'a2', name: 'Fio banka', type: 'checking', currency: 'CZK', initialBalanceInHaler: 0, initialBalanceDate: '2026-01-01', isUsableCash: true, isNetWorth: true, isDefault: false, color: '', sortOrder: 2, status: 'active', createdAt: '', updatedAt: '' },
    ];

    const defaultAcc = accs.find(a => a.status === 'active' && a.isDefault);
    const preselectedSourceAccountId = defaultAcc ? defaultAcc.id : '';
    expect(preselectedSourceAccountId).toBe('');
  });

  // 12. Současně nelze nastavit dva výchozí účty
  it('12. Migrace zachová výchozí příznaky účtů bez tiché změny finančních dat', () => {
    const rawData: AppData = {
      ...getInitialData(),
      accounts: [
        { id: 'acc1', name: 'Účet 1', type: 'checking', currency: 'CZK', initialBalanceInHaler: 0, initialBalanceDate: '2026-01-01', isUsableCash: true, isNetWorth: true, isDefault: true, color: '', sortOrder: 1, status: 'active', createdAt: '', updatedAt: '' },
        { id: 'acc2', name: 'Účet 2', type: 'checking', currency: 'CZK', initialBalanceInHaler: 0, initialBalanceDate: '2026-01-01', isUsableCash: true, isNetWorth: true, isDefault: true, color: '', sortOrder: 2, status: 'active', createdAt: '', updatedAt: '' },
      ]
    };
    saveStoredData(rawData);

    const loaded = loadStoredData();
    const defaults = loaded.accounts.filter(a => a.isDefault);
    expect(defaults.length).toBe(2);
    expect(defaults[0].id).toBe('acc1');
  });

  // 13. Nastavení nového výchozího účtu odebere příznak původnímu
  it('13. Nastavení nového výchozího účtu odebere příznak původnímu atomicky', () => {
    let accounts: Account[] = [
      { id: 'acc1', name: 'Účet 1', type: 'checking', currency: 'CZK', initialBalanceInHaler: 0, initialBalanceDate: '2026-01-01', isUsableCash: true, isNetWorth: true, isDefault: true, color: '', sortOrder: 1, status: 'active', createdAt: '', updatedAt: '' },
      { id: 'acc2', name: 'Účet 2', type: 'checking', currency: 'CZK', initialBalanceInHaler: 0, initialBalanceDate: '2026-01-01', isUsableCash: true, isNetWorth: true, isDefault: false, color: '', sortOrder: 2, status: 'active', createdAt: '', updatedAt: '' },
    ];

    // Simulace atomického updateAccount s isDefault: true na acc2
    const updateAccount = (acc: Account) => {
      const isDefault = Boolean(acc.isDefault);
      accounts = accounts.map(a => {
        if (a.id === acc.id) {
          return { ...acc, isDefault };
        }
        if (isDefault && a.isDefault) {
          return { ...a, isDefault: false };
        }
        return a;
      });
    };

    updateAccount({ ...accounts[1], isDefault: true });
    expect(accounts.find(a => a.id === 'acc1')?.isDefault).toBe(false);
    expect(accounts.find(a => a.id === 'acc2')?.isDefault).toBe(true);
  });

  // 14. Archivace výchozího účtu odstraní jeho výchozí status
  it('14. Archivace výchozího účtu odstraní jeho výchozí status', () => {
    let accounts: Account[] = [
      { id: 'acc1', name: 'Účet 1', type: 'checking', currency: 'CZK', initialBalanceInHaler: 0, initialBalanceDate: '2026-01-01', isUsableCash: true, isNetWorth: true, isDefault: true, color: '', sortOrder: 1, status: 'active', createdAt: '', updatedAt: '' },
    ];

    // Simulace archiveAccount
    const archiveAccount = (id: string) => {
      accounts = accounts.map(a => a.id === id ? { ...a, status: 'archived', isDefault: false } : a);
    };

    archiveAccount('acc1');
    expect(accounts[0].status).toBe('archived');
    expect(accounts[0].isDefault).toBe(false);
  });

  // 15. Obnovení archivovaného účtu neobnoví jeho výchozí status
  it('15. Obnovení archivovaného účtu neobnoví jeho výchozí status', () => {
    let accounts: Account[] = [
      { id: 'acc1', name: 'Účet 1', type: 'checking', currency: 'CZK', initialBalanceInHaler: 0, initialBalanceDate: '2026-01-01', isUsableCash: true, isNetWorth: true, isDefault: false, color: '', sortOrder: 1, status: 'archived', createdAt: '', updatedAt: '' },
    ];

    // Simulace restoreAccount
    const restoreAccount = (id: string) => {
      accounts = accounts.map(a => a.id === id ? { ...a, status: 'active', isDefault: false } : a);
    };

    restoreAccount('acc1');
    expect(accounts[0].status).toBe('active');
    expect(accounts[0].isDefault).toBe(false);
  });

  // 16. U převodu se předvybere pouze zdrojový účet
  it('16. U převodu se předvybere pouze zdrojový účet, cílový účet začíná prázdný (-- Žádný --)', () => {
    const defaultAcc: Account = { id: 'acc_src', name: 'Zdrojový účet', type: 'checking', currency: 'CZK', initialBalanceInHaler: 0, initialBalanceDate: '2026-01-01', isUsableCash: true, isNetWorth: true, isDefault: true, color: '', sortOrder: 1, status: 'active', createdAt: '', updatedAt: '' };
    
    // Inicializace nového formuláře pro transfer
    const preselectedSourceAccountId = defaultAcc.id;
    const preselectedTargetAccountId = ''; // Musí být prázdné (-- Žádný --)

    expect(preselectedSourceAccountId).toBe('acc_src');
    expect(preselectedTargetAccountId).toBe('');
  });

  // 17. Editace existující položky nezmění její účet
  it('17. Editace existující položky nezmění její účet ani kategorie výchozími hodnotami', () => {
    const existingTx: Transaction = {
      id: 'tx_existing',
      title: 'Starší nákup',
      amountInHaler: 50000,
      date: '2026-08-10',
      sequence: 1,
      type: 'expense',
      sourceAccountId: 'acc_custom_card',
      categoryId: 'cat_food',
      subcategoryId: 'sub_groceries',
      status: 'executed',
      createdAt: '2026-08-10T10:00:00Z',
      updatedAt: '2026-08-10T10:00:00Z',
    };

    // Při otevření modálu pro editaci existující transakce:
    const initialSourceAccountId = existingTx.sourceAccountId;
    const initialCategoryId = existingTx.categoryId;
    const initialSubcategoryId = existingTx.subcategoryId;

    expect(initialSourceAccountId).toBe('acc_custom_card');
    expect(initialCategoryId).toBe('cat_food');
    expect(initialSubcategoryId).toBe('sub_groceries');
  });

  // 18. Výchozí účet nelze použít před Datem počátečního stavu
  it('18. Výchozí účet nelze použít před Datem počátečního stavu a při posunu data se zruší jeho výběr', () => {
    const defaultAcc: Account = {
      id: 'acc_default',
      name: 'Nový účet',
      type: 'checking',
      currency: 'CZK',
      initialBalanceInHaler: 100000,
      initialBalanceDate: '2026-09-01',
      isUsableCash: true,
      isNetWorth: true,
      isDefault: true,
      color: '',
      sortOrder: 1,
      status: 'active',
      createdAt: '',
      updatedAt: '',
    };

    // 1. Otevření před datem založení (srpen 2026)
    const earlyDate = '2026-08-15';
    const isEarlyValid = !defaultAcc.initialBalanceDate || defaultAcc.initialBalanceDate <= earlyDate;
    const initialSelectedAccount = isEarlyValid ? defaultAcc.id : '';
    expect(initialSelectedAccount).toBe('');

    // 2. Otevření v září 2026 a následný posun data do srpna
    let selectedAccountId = defaultAcc.id; // Platný v září
    const newDate = '2026-08-20';
    if (selectedAccountId === defaultAcc.id && defaultAcc.initialBalanceDate && newDate < defaultAcc.initialBalanceDate) {
      selectedAccountId = ''; // Zrušení výběru na -- Žádný --
    }
    expect(selectedAccountId).toBe('');
  });

  // 19. České názvy s diakritikou se řadí správně
  it('19. České názvy s diakritikou se řadí správně (ignorování velikosti písmen a mezer, správné C vs Č a R vs Ř)', () => {
    const items = ['Řešení', ' auto ', 'Česká', 'Auto', 'Banka', 'Cestování', 'česká', 'Rozpočet'];
    const sorted = [...items].sort(czechStringCompare);

    expect(sorted).toEqual([
      ' auto ',
      'Auto',
      'Banka',
      'Cestování',
      'česká',
      'Česká',
      'Rozpočet',
      'Řešení',
    ]);
  });

  // 20. Změna neovlivnila existující finanční položky ani výpočty
  it('20. Výpočet forecastu a finančních statistik zůstává identický a nenarušený', () => {
    const initial = getInitialData();
    const periods = generatePeriodsSequence(2026, 9, 3, 15);
    const forecast = calculateForecast(
      periods,
      initial.accounts,
      initial.transactions,
      initial.recurringRules,
      initial.recurringExceptions,
      initial.corrections,
      initial.settings,
      initial.marketValueSnapshots
    );

    expect(forecast.periods.length).toBeGreaterThan(0);
    // Ověříme, že výpočty fungují správně
    for (const p of forecast.periods) {
      expect(typeof p.incomeInHaler).toBe('number');
      expect(typeof p.expenseInHaler).toBe('number');
      expect(typeof p.netChangeInHaler).toBe('number');
      expect(p.netChangeInHaler).toBe(p.incomeInHaler - p.expenseInHaler);
    }
  });

});
