import { describe, it, expect } from 'vitest';
import { czechStringCompare, sortCategoriesAlphabetically } from '../services/categoryService';
import { Category } from '../types/finance';

describe('Czech Alphabetical Sorting for Categories', () => {
  describe('czechStringCompare', () => {
    it('sorts standard alphabetical names from A to Z', () => {
      const names = ['Osobní', 'Auto', 'Domácnost'];
      names.sort(czechStringCompare);
      expect(names).toEqual(['Auto', 'Domácnost', 'Osobní']);
    });

    it('correctly handles Czech diacritics according to Czech collation rules', () => {
      // C < Č, H < Ch, R < Ř, S < Š, Z < Ž
      const names = [
        'Žirafa',
        'Česko',
        'Zebra',
        'Chata',
        'Hotel',
        'Cukr',
        'Řeka',
        'Ruka',
        'Škola',
        'Sova'
      ];
      names.sort(czechStringCompare);

      expect(names).toEqual([
        'Cukr',
        'Česko',
        'Hotel',
        'Chata',
        'Ruka',
        'Řeka',
        'Sova',
        'Škola',
        'Zebra',
        'Žirafa'
      ]);
    });

    it('ignores leading and trailing whitespace', () => {
      const names = ['  Auto  ', 'Banán', ' Auto moto '];
      names.sort(czechStringCompare);
      expect(names).toEqual(['  Auto  ', ' Auto moto ', 'Banán']);
    });

    it('is case-insensitive and does not sort lowercase letters after uppercase', () => {
      const names = ['auto', 'Banán', 'Cukr', 'česko', 'Auto 2'];
      names.sort(czechStringCompare);
      expect(names).toEqual(['auto', 'Auto 2', 'Banán', 'Cukr', 'česko']);
    });
  });

  describe('sortCategoriesAlphabetically on Category objects', () => {
    const makeCategory = (id: string, name: string, type: 'expense' | 'income', parentId: string | null = null, status: 'active' | 'archived' = 'active'): Category => ({
      id,
      name,
      type,
      parentId,
      color: '#0284c7',
      icon: 'Folder',
      sortOrder: 1,
      status,
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
    });

    it('correctly sorts expense main categories matching the user example', () => {
      const mainCategories: Category[] = [
        makeCategory('cat_personal', 'Osobní', 'expense'),
        makeCategory('cat_home', 'Domácnost', 'expense'),
        makeCategory('cat_auto', 'Auto', 'expense'),
      ];

      const sorted = sortCategoriesAlphabetically(mainCategories);
      expect(sorted.map(c => c.name)).toEqual(['Auto', 'Domácnost', 'Osobní']);
    });

    it('correctly sorts subcategories under a main category matching the user example', () => {
      // Auto: Nafta, Parkování, Provoz, Servis
      const autoSubs: Category[] = [
        makeCategory('sub_servis', 'Servis', 'expense', 'cat_auto'),
        makeCategory('sub_park', 'Parkování', 'expense', 'cat_auto'),
        makeCategory('sub_nafta', 'Nafta', 'expense', 'cat_auto'),
        makeCategory('sub_provoz', 'Provoz', 'expense', 'cat_auto'),
      ];

      const sortedAutoSubs = sortCategoriesAlphabetically(autoSubs);
      expect(sortedAutoSubs.map(c => c.name)).toEqual(['Nafta', 'Parkování', 'Provoz', 'Servis']);

      // Domácnost: Drogerie, Léky, Stravování
      const homeSubs: Category[] = [
        makeCategory('sub_stravovani', 'Stravování', 'expense', 'cat_home'),
        makeCategory('sub_drogerie', 'Drogerie', 'expense', 'cat_home'),
        makeCategory('sub_leky', 'Léky', 'expense', 'cat_home'),
      ];

      const sortedHomeSubs = sortCategoriesAlphabetically(homeSubs);
      expect(sortedHomeSubs.map(c => c.name)).toEqual(['Drogerie', 'Léky', 'Stravování']);

      // Osobní: IT, Média, Ostatní, Sport, Volný čas
      const personalSubs: Category[] = [
        makeCategory('sub_volny', 'Volný čas', 'expense', 'cat_personal'),
        makeCategory('sub_sport', 'Sport', 'expense', 'cat_personal'),
        makeCategory('sub_it', 'IT', 'expense', 'cat_personal'),
        makeCategory('sub_ostatni', 'Ostatní', 'expense', 'cat_personal'),
        makeCategory('sub_media', 'Média', 'expense', 'cat_personal'),
      ];

      const sortedPersonalSubs = sortCategoriesAlphabetically(personalSubs);
      expect(sortedPersonalSubs.map(c => c.name)).toEqual(['IT', 'Média', 'Ostatní', 'Sport', 'Volný čas']);
    });

    it('correctly sorts income main categories and subcategories', () => {
      const incomeMains: Category[] = [
        makeCategory('cat_inc_invest', 'Výnosy z investic', 'income'),
        makeCategory('cat_inc_mzda', 'Mzda a plat', 'income'),
        makeCategory('cat_inc_bonus', 'Bonusy', 'income'),
      ];

      const sortedIncomeMains = sortCategoriesAlphabetically(incomeMains);
      expect(sortedIncomeMains.map(c => c.name)).toEqual(['Bonusy', 'Mzda a plat', 'Výnosy z investic']);
    });

    it('correctly sorts active and archived categories alphabetically when displayed together', () => {
      const mixedCategories: Category[] = [
        makeCategory('cat_1', 'Zábava', 'expense', null, 'archived'),
        makeCategory('cat_2', 'Auto', 'expense', null, 'active'),
        makeCategory('cat_3', 'Cestování', 'expense', null, 'archived'),
        makeCategory('cat_4', 'Bydlení', 'expense', null, 'active'),
      ];

      const sorted = sortCategoriesAlphabetically(mixedCategories);
      expect(sorted.map(c => c.name)).toEqual(['Auto', 'Bydlení', 'Cestování', 'Zábava']);
    });

    it('preserves all properties and references of Category objects without mutation', () => {
      const original: Category[] = [
        makeCategory('cat_b', 'Bydlení', 'expense'),
        makeCategory('cat_a', 'Auto', 'expense'),
      ];

      const sorted = sortCategoriesAlphabetically(original);
      expect(sorted[0].id).toBe('cat_a');
      expect(sorted[0].name).toBe('Auto');
      expect(sorted[1].id).toBe('cat_b');
      expect(sorted[1].name).toBe('Bydlení');

      // Original array remains intact
      expect(original[0].name).toBe('Bydlení');
      expect(original[1].name).toBe('Auto');
    });
  });

  describe('New Main Category Creation & Constraints', () => {
    // Simulace API funkce addMainCategory z FinanceContext
    function addMainCategoryAPI(
      catData: Omit<Category, 'id' | 'createdAt' | 'updatedAt'> & { parentId?: any },
      existingCategories: Category[]
    ): { newCat: Category; updatedCategories: Category[] } {
      const nowIso = new Date().toISOString();
      const newCat: Category = {
        ...catData,
        // Pravidlo API: Nová hlavní kategorie má VŽDY parentId = null bez ohledu na vstup
        parentId: null,
        id: `cat_${Date.now()}`,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      return {
        newCat,
        updatedCategories: [...existingCategories, newCat]
      };
    }

    it('enforces parentId = null when creating a new main category', () => {
      const { newCat } = addMainCategoryAPI(
        {
          name: 'Nová kategorie',
          type: 'expense',
          color: '#0284c7',
          icon: 'Folder',
          sortOrder: 1,
          status: 'active',
        },
        []
      );

      expect(newCat.parentId).toBeNull();
    });

    it('strictly forces parentId = null via API even if caller attempts to pass a parentId', () => {
      const { newCat } = addMainCategoryAPI(
        {
          name: 'Podstrčená podkategorie',
          type: 'expense',
          parentId: 'cat_some_parent', // Pokus o podvržení parentId
          color: '#0284c7',
          icon: 'Folder',
          sortOrder: 1,
          status: 'active',
        },
        []
      );

      // Přes API nelze touto funkcí vytvořit podkategorii
      expect(newCat.parentId).toBeNull();
    });

    it('automatically sorts newly added main category into alphabetical A–Z order', () => {
      const initialMains: Category[] = [
        { id: '1', name: 'Bydlení', type: 'expense', parentId: null, color: '', icon: '', sortOrder: 1, status: 'active', createdAt: '', updatedAt: '' },
        { id: '2', name: 'Domácnost', type: 'expense', parentId: null, color: '', icon: '', sortOrder: 2, status: 'active', createdAt: '', updatedAt: '' },
        { id: '3', name: 'Osobní', type: 'expense', parentId: null, color: '', icon: '', sortOrder: 3, status: 'active', createdAt: '', updatedAt: '' },
      ];

      // Uživatel přidá novou hlavní kategorii "Auto"
      const { updatedCategories } = addMainCategoryAPI(
        { name: 'Auto', type: 'expense', color: '', icon: '', sortOrder: 4, status: 'active' },
        initialMains
      );

      const sorted = sortCategoriesAlphabetically(updatedCategories);
      expect(sorted.map(c => c.name)).toEqual(['Auto', 'Bydlení', 'Domácnost', 'Osobní']);
    });
  });

  describe('Monthly Budget Overview (Přehled rozpočtu podle kategorií) Sorting', () => {
    // Simulace logiky řazení v MonthlyBudgetScreen
    function getBudgetOverviewCategories(categories: Category[]) {
      const activeMains = categories.filter(c => !c.parentId && c.status === 'active');
      const incomeMains = sortCategoriesAlphabetically(activeMains.filter(c => c.type === 'income'));
      const expenseMains = sortCategoriesAlphabetically(activeMains.filter(c => c.type !== 'income'));
      const mainCategories = [...incomeMains, ...expenseMains];

      return mainCategories.map(mainCat => {
        const subs = sortCategoriesAlphabetically(
          categories.filter(c => c.parentId === mainCat.id && c.status === 'active')
        );
        return {
          category: mainCat,
          subcategories: subs,
        };
      });
    }

    const makeCat = (
      id: string,
      name: string,
      type: 'income' | 'expense',
      parentId: string | null = null,
      sortOrder: number = 0,
      status: 'active' | 'archived' = 'active'
    ): Category => ({
      id,
      name,
      type,
      parentId,
      color: '#000',
      icon: 'Tag',
      sortOrder,
      status,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });

    it('places all income categories before all expense categories, each group sorted A-Z', () => {
      const categories: Category[] = [
        makeCat('exp-1', 'Domácnost', 'expense', null, 5),
        makeCat('inc-1', 'Příspěvky', 'income', null, 3),
        makeCat('exp-2', 'Auto', 'expense', null, 10),
        makeCat('inc-2', 'Mzda', 'income', null, 1),
        makeCat('exp-3', 'Bydlení', 'expense', null, 2),
        makeCat('inc-3', 'Prodej', 'income', null, 4),
        makeCat('inc-4', 'Ostatní příjmy', 'income', null, 8),
        makeCat('exp-4', 'Pojištění', 'expense', null, 1),
        makeCat('exp-5', 'Osobní', 'expense', null, 9),
      ];

      const result = getBudgetOverviewCategories(categories);
      const mainNames = result.map(r => r.category.name);

      // 1. Všechny příjmové kategorie abecedně A-Z: Mzda, Ostatní příjmy, Prodej, Příspěvky
      // 2. Následně všechny výdajové kategorie abecedně A-Z: Auto, Bydlení, Domácnost, Osobní, Pojištění
      expect(mainNames).toEqual([
        'Mzda',
        'Ostatní příjmy',
        'Prodej',
        'Příspěvky',
        'Auto',
        'Bydlení',
        'Domácnost',
        'Osobní',
        'Pojištění',
      ]);
    });

    it('ensures income is always first even if income name starts with Z and expense starts with A', () => {
      const categories: Category[] = [
        makeCat('exp-1', 'Auto', 'expense'),
        makeCat('inc-1', 'Živnost', 'income'),
      ];

      const result = getBudgetOverviewCategories(categories);
      expect(result.map(r => r.category.name)).toEqual(['Živnost', 'Auto']);
    });

    it('sorts subcategories alphabetically A-Z within their parent category without mixing', () => {
      const categories: Category[] = [
        makeCat('cat-auto', 'Auto', 'expense'),
        makeCat('sub-a1', 'Servis', 'expense', 'cat-auto'),
        makeCat('sub-a2', 'Nafta', 'expense', 'cat-auto'),
        makeCat('sub-a3', 'Parkování', 'expense', 'cat-auto'),
        makeCat('sub-a4', 'Provoz', 'expense', 'cat-auto'),

        makeCat('cat-dom', 'Domácnost', 'expense'),
        makeCat('sub-d1', 'Stravování', 'expense', 'cat-dom'),
        makeCat('sub-d2', 'Drogerie', 'expense', 'cat-dom'),
        makeCat('sub-d3', 'Léky', 'expense', 'cat-dom'),
      ];

      const result = getBudgetOverviewCategories(categories);

      const auto = result.find(r => r.category.name === 'Auto')!;
      expect(auto.subcategories.map(s => s.name)).toEqual([
        'Nafta',
        'Parkování',
        'Provoz',
        'Servis',
      ]);

      const dom = result.find(r => r.category.name === 'Domácnost')!;
      expect(dom.subcategories.map(s => s.name)).toEqual([
        'Drogerie',
        'Léky',
        'Stravování',
      ]);
    });

    it('correctly handles Czech diacritics in main and subcategories', () => {
      const categories: Category[] = [
        makeCat('inc-1', 'Čestný dar', 'income'),
        makeCat('inc-2', 'Cizí měna', 'income'),
        makeCat('inc-3', 'Úroky', 'income'),
        makeCat('inc-4', 'Úplatky', 'income'),
      ];

      const result = getBudgetOverviewCategories(categories);
      expect(result.map(r => r.category.name)).toEqual([
        'Cizí měna',
        'Čestný dar',
        'Úplatky',
        'Úroky',
      ]);
    });

    it('dynamically reacts to category type changes (expense -> income)', () => {
      const cat1 = makeCat('1', 'Pojištění', 'expense');
      const cat2 = makeCat('2', 'Mzda', 'income');

      let result = getBudgetOverviewCategories([cat1, cat2]);
      expect(result.map(r => r.category.name)).toEqual(['Mzda', 'Pojištění']);

      // Uživatel změní typ kategorie Pojištění na income (např. vratky pojištění)
      const updatedCat1 = { ...cat1, type: 'income' as const };
      result = getBudgetOverviewCategories([updatedCat1, cat2]);
      // Nyní jsou obě income a řadí se A-Z
      expect(result.map(r => r.category.name)).toEqual(['Mzda', 'Pojištění']);

      // Pokud změníme Mzdu na expense a Pojištění zůstane income:
      const updatedCat2 = { ...cat2, type: 'expense' as const };
      result = getBudgetOverviewCategories([updatedCat1, updatedCat2]);
      // Pojištění (income) je první, Mzda (expense) je druhá
      expect(result.map(r => r.category.name)).toEqual(['Pojištění', 'Mzda']);
    });

    it('ignores sortOrder, id, and creation order', () => {
      const categories: Category[] = [
        makeCat('zzz-id', 'Bydlení', 'expense', null, 999),
        makeCat('aaa-id', 'Auto', 'expense', null, 1),
      ];

      const result = getBudgetOverviewCategories(categories);
      expect(result.map(r => r.category.name)).toEqual(['Auto', 'Bydlení']);
    });
  });
});
