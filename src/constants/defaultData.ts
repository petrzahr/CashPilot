import { AppSettings, Category } from '../types/finance';
import { AppData } from '../services/storageService';

export const CURRENT_DATA_VERSION = 2;

export const DEFAULT_SETTINGS: AppSettings = {
  currency: 'CZK',
  budgetStartDay: 15,
  overdraftLimitInHaler: 2000000, // Výše kontokorentu: 20 000 Kč
  minReserveInHaler: 2000000, // Pro zpětnou kompatibilitu
  roundAmounts: false,
};

export const DEFAULT_CATEGORIES: Category[] = [
  // Příjmy
  {
    id: 'cat_income',
    name: 'Příjmy',
    type: 'income',
    parentId: null,
    color: '#16a34a',
    icon: 'TrendingUp',
    sortOrder: 1,
    status: 'active',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  },
  {
    id: 'sub_income_salary',
    name: 'Mzda',
    type: 'income',
    parentId: 'cat_income',
    color: '#16a34a',
    icon: 'Briefcase',
    sortOrder: 1,
    status: 'active',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  },
  {
    id: 'sub_income_other',
    name: 'Ostatní příjmy',
    type: 'income',
    parentId: 'cat_income',
    color: '#22c55e',
    icon: 'Coins',
    sortOrder: 2,
    status: 'active',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  },

  // Bydlení
  {
    id: 'cat_housing',
    name: 'Bydlení',
    type: 'expense',
    parentId: null,
    color: '#0284c7',
    icon: 'Home',
    sortOrder: 2,
    status: 'active',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  },
  { id: 'sub_housing_mortgage', name: 'Hypotéka', type: 'expense', parentId: 'cat_housing', color: '#0284c7', icon: 'Key', sortOrder: 1, status: 'active', createdAt: '', updatedAt: '' },
  { id: 'sub_housing_services', name: 'Služby', type: 'expense', parentId: 'cat_housing', color: '#0284c7', icon: 'FileText', sortOrder: 2, status: 'active', createdAt: '', updatedAt: '' },
  { id: 'sub_housing_electricity', name: 'Elektřina', type: 'expense', parentId: 'cat_housing', color: '#0284c7', icon: 'Zap', sortOrder: 3, status: 'active', createdAt: '', updatedAt: '' },
  { id: 'sub_housing_gas', name: 'Plyn', type: 'expense', parentId: 'cat_housing', color: '#0284c7', icon: 'Flame', sortOrder: 4, status: 'active', createdAt: '', updatedAt: '' },
  { id: 'sub_housing_internet', name: 'Telefon a internet', type: 'expense', parentId: 'cat_housing', color: '#0284c7', icon: 'Wifi', sortOrder: 5, status: 'active', createdAt: '', updatedAt: '' },
  { id: 'sub_housing_fees', name: 'Poplatky', type: 'expense', parentId: 'cat_housing', color: '#0284c7', icon: 'Receipt', sortOrder: 6, status: 'active', createdAt: '', updatedAt: '' },

  // Domácnost
  {
    id: 'cat_household',
    name: 'Domácnost',
    type: 'expense',
    parentId: null,
    color: '#0d9488',
    icon: 'ShoppingCart',
    sortOrder: 3,
    status: 'active',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  },
  { id: 'sub_hh_food', name: 'Stravování', type: 'expense', parentId: 'cat_household', color: '#0d9488', icon: 'Utensils', sortOrder: 1, status: 'active', createdAt: '', updatedAt: '' },
  { id: 'sub_hh_drugstore', name: 'Drogerie', type: 'expense', parentId: 'cat_household', color: '#0d9488', icon: 'Sparkles', sortOrder: 2, status: 'active', createdAt: '', updatedAt: '' },
  { id: 'sub_hh_medicine', name: 'Léky', type: 'expense', parentId: 'cat_household', color: '#0d9488', icon: 'Pill', sortOrder: 3, status: 'active', createdAt: '', updatedAt: '' },
  { id: 'sub_hh_maintenance', name: 'Provoz domácnosti', type: 'expense', parentId: 'cat_household', color: '#0d9488', icon: 'Wrench', sortOrder: 4, status: 'active', createdAt: '', updatedAt: '' },

  // Osobní
  {
    id: 'cat_personal',
    name: 'Osobní',
    type: 'expense',
    parentId: null,
    color: '#6366f1',
    icon: 'Smile',
    sortOrder: 4,
    status: 'active',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  },
  { id: 'sub_pers_leisure', name: 'Volný čas', type: 'expense', parentId: 'cat_personal', color: '#6366f1', icon: 'Coffee', sortOrder: 1, status: 'active', createdAt: '', updatedAt: '' },
  { id: 'sub_pers_sport', name: 'Sport', type: 'expense', parentId: 'cat_personal', color: '#6366f1', icon: 'Activity', sortOrder: 2, status: 'active', createdAt: '', updatedAt: '' },
  { id: 'sub_pers_it', name: 'IT', type: 'expense', parentId: 'cat_personal', color: '#6366f1', icon: 'Laptop', sortOrder: 3, status: 'active', createdAt: '', updatedAt: '' },
  { id: 'sub_pers_media', name: 'Média a předplatná', type: 'expense', parentId: 'cat_personal', color: '#6366f1', icon: 'Tv', sortOrder: 4, status: 'active', createdAt: '', updatedAt: '' },
  { id: 'sub_pers_other', name: 'Ostatní', type: 'expense', parentId: 'cat_personal', color: '#6366f1', icon: 'MoreHorizontal', sortOrder: 5, status: 'active', createdAt: '', updatedAt: '' },

  // Auto
  {
    id: 'cat_auto',
    name: 'Auto',
    type: 'expense',
    parentId: null,
    color: '#ea580c',
    icon: 'Car',
    sortOrder: 5,
    status: 'active',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  },
  { id: 'sub_auto_leasing', name: 'Leasing', type: 'expense', parentId: 'cat_auto', color: '#ea580c', icon: 'CreditCard', sortOrder: 1, status: 'active', createdAt: '', updatedAt: '' },
  { id: 'sub_auto_fuel', name: 'Palivo', type: 'expense', parentId: 'cat_auto', color: '#ea580c', icon: 'Fuel', sortOrder: 2, status: 'active', createdAt: '', updatedAt: '' },
  { id: 'sub_auto_parking', name: 'Parkování', type: 'expense', parentId: 'cat_auto', color: '#ea580c', icon: 'SquareParking', sortOrder: 3, status: 'active', createdAt: '', updatedAt: '' },
  { id: 'sub_auto_ops', name: 'Provoz', type: 'expense', parentId: 'cat_auto', color: '#ea580c', icon: 'Settings2', sortOrder: 4, status: 'active', createdAt: '', updatedAt: '' },
  { id: 'sub_auto_service', name: 'Servis', type: 'expense', parentId: 'cat_auto', color: '#ea580c', icon: 'Wrench', sortOrder: 5, status: 'active', createdAt: '', updatedAt: '' },

  // Pojištění
  {
    id: 'cat_insurance',
    name: 'Pojištění',
    type: 'expense',
    parentId: null,
    color: '#dc2626',
    icon: 'Shield',
    sortOrder: 6,
    status: 'active',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  },
  { id: 'sub_ins_household', name: 'Domácnost', type: 'expense', parentId: 'cat_insurance', color: '#dc2626', icon: 'ShieldAlert', sortOrder: 1, status: 'active', createdAt: '', updatedAt: '' },
  { id: 'sub_ins_sport', name: 'Sportovní vybavení', type: 'expense', parentId: 'cat_insurance', color: '#dc2626', icon: 'ShieldCheck', sortOrder: 2, status: 'active', createdAt: '', updatedAt: '' },
  { id: 'sub_ins_vehicle', name: 'Vozidlo', type: 'expense', parentId: 'cat_insurance', color: '#dc2626', icon: 'ShieldCheck', sortOrder: 3, status: 'active', createdAt: '', updatedAt: '' },
  { id: 'sub_ins_life', name: 'Životní pojištění', type: 'expense', parentId: 'cat_insurance', color: '#dc2626', icon: 'HeartPulse', sortOrder: 4, status: 'active', createdAt: '', updatedAt: '' },
];

/**
 * Vytvoří čistou produkční datovou strukturu aplikace.
 * Neobsahuje žádné demonstrační účty, transakce, pravidla, korekce ani tržní hodnoty.
 */
export function createEmptyAppData(): AppData {
  return {
    version: CURRENT_DATA_VERSION,
    deletions: [],
    sync: { revision: 0, updatedAt: '', updatedByDeviceId: '' },
    settings: { ...DEFAULT_SETTINGS },
    accounts: [],
    categories: [...DEFAULT_CATEGORIES],
    transactions: [],
    recurringRules: [],
    recurringExceptions: [],
    corrections: [],
    marketValueSnapshots: [],
  };
}

/**
 * Vytvoří kompletně vymazanou datovou strukturu aplikace (po resetu).
 * Obsahuje 0 účtů, 0 transakcí, 0 pravidel, 0 korekcí, 0 tržních hodnot i 0 kategorií.
 */
export function createResetAppData(): AppData {
  return {
    version: CURRENT_DATA_VERSION,
    deletions: [],
    sync: { revision: 0, updatedAt: '', updatedByDeviceId: '' },
    settings: { ...DEFAULT_SETTINGS },
    accounts: [],
    categories: [],
    transactions: [],
    recurringRules: [],
    recurringExceptions: [],
    corrections: [],
    marketValueSnapshots: [],
  };
}

const KNOWN_DEMO_EXACT_IDS = new Set([
  'demo_acc_checking',
  'demo_acc_cash',
  'demo_acc_savings1',
  'demo_acc_savings2',
  'demo_acc_pension',
  'demo_acc_invest1',
  'demo_acc_invest2',
  'rec_salary',
  'rec_mortgage',
  'rec_services',
  'rec_electricity',
  'rec_gas',
  'rec_internet',
  'rec_phone',
  'rec_media',
  'rec_insurance',
  'rec_save_transfer',
  'rec_invest_transfer',
  'demo_tx_1',
  'demo_tx_2',
  'demo_tx_3',
  'demo_tx_4',
  'demo_tx_5',
]);

export function isKnownDemoRecordId(id: string): boolean {
  if (!id || typeof id !== 'string') return false;
  return (
    id.startsWith('demo_acc_') ||
    id.startsWith('demo_tx_') ||
    KNOWN_DEMO_EXACT_IDS.has(id)
  );
}
