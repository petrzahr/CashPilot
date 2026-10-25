import { Account, AppSettings, RecurringRule, Transaction } from '../types/finance';
import { repairRecurringRuleSplitOverlaps, type AppData } from './storageService';
import type { CommandResult } from './transactionCommands';
import { mergeBackupData } from './syncModel';
import { getNextSequenceForDate, sortTransactionsByDateAndSequence } from './sequenceService';
import { CURRENT_DATA_VERSION, DEFAULT_CATEGORIES, DEFAULT_SETTINGS, createResetAppData } from '../constants/defaultData';

/**
 * Sloučí zvalidovanou zálohu s aktuálními daty (mergeBackupData). Pořadí (sequence) v záloze
 * je jen lokální v rámci importovaného souboru: existující položky dne se nepřeřazují a nově
 * přidané se připojí až za ně, ve stejném vzájemném pořadí, v jakém byly v souboru.
 */
export function importBackup(data: AppData, backup: AppData): CommandResult<null> {
  const merged = mergeBackupData(data, backup);
  const existingIds = new Set(data.transactions.map(t => t.id));

  const addedByDate = new Map<string, Transaction[]>();
  for (const t of merged.transactions) {
    if (existingIds.has(t.id)) continue;
    const list = addedByDate.get(t.date) || [];
    list.push(t);
    addedByDate.set(t.date, list);
  }

  const transactions = merged.transactions.filter(t => existingIds.has(t.id));
  for (const added of addedByDate.values()) {
    const ordered = [...added].sort((a, b) =>
      (a.sequence ?? 1) - (b.sequence ?? 1) ||
      (a.createdAt || '').localeCompare(b.createdAt || '') ||
      (a.id || '').localeCompare(b.id || ''));
    for (const t of ordered) {
      transactions.push({ ...t, sequence: getNextSequenceForDate(t.date, transactions) });
    }
  }

  return {
    data: { ...merged, transactions: sortTransactionsByDateAndSequence(transactions) },
    outcome: null,
  };
}

/** Smaže všechny položky, pravidelné položky, jejich výjimky a korekce; účty, kategorie a nastavení zůstanou. */
export function clearAllTransactions(data: AppData): CommandResult<null> {
  return {
    data: { ...data, transactions: [], recurringRules: [], recurringExceptions: [], corrections: [] },
    outcome: null,
  };
}

/** Smaže všechny účty a všechna data, která na ně navazují; kategorie a nastavení zůstanou. */
export function clearAllAccounts(data: AppData): CommandResult<null> {
  return {
    data: {
      ...data,
      accounts: [],
      transactions: [],
      recurringRules: [],
      recurringExceptions: [],
      corrections: [],
      marketValueSnapshots: [],
      investmentFees: [],
      settings: { ...data.settings },
    },
    outcome: null,
  };
}

/** Smaže všechny kategorie; položky, pravidla i výjimky zůstanou, jen bez kategorie. */
export function clearAllCategories(data: AppData): CommandResult<null> {
  return {
    data: {
      ...data,
      categories: [],
      transactions: data.transactions.map(t => ({ ...t, categoryId: null, subcategoryId: null })),
      recurringRules: data.recurringRules.map(r => ({ ...r, categoryId: null, subcategoryId: null })),
      recurringExceptions: data.recurringExceptions.map(e => ({ ...e, overrideCategoryId: null, overrideSubcategoryId: null })),
    },
    outcome: null,
  };
}

/** Kompletní čistý reset: žádné účty, položky, pravidla, korekce, tržní hodnoty ani kategorie. Zapisuje se s příznakem reset. */
export function resetAllData(_data: AppData): CommandResult<null> {
  return { data: createResetAppData(), outcome: null };
}

export interface DemoFixtures {
  accounts: Account[];
  recurringRules: RecurringRule[];
  transactions: Transaction[];
}

/** Nahradí data ukázkovými daty (jen v demo režimu, to hlídá volající). */
export function replaceWithDemoData(_data: AppData, demo: DemoFixtures): CommandResult<null> {
  return {
    data: {
      version: CURRENT_DATA_VERSION,
      deletions: [],
      sync: { revision: 0, updatedAt: '', updatedByDeviceId: '' },
      settings: { ...DEFAULT_SETTINGS },
      accounts: [...demo.accounts],
      categories: [...DEFAULT_CATEGORIES],
      transactions: [...demo.transactions],
      recurringRules: [...demo.recurringRules],
      recurringExceptions: [],
      corrections: [],
      marketValueSnapshots: [],
      investmentFees: [],
    },
    outcome: null,
  };
}

/** Uloží změněná nastavení. */
export function updateSettings(data: AppData, newSettings: Partial<AppSettings>): CommandResult<null> {
  return { data: { ...data, settings: { ...data.settings, ...newSettings } }, outcome: null };
}

/**
 * Oprava starších dat poškozených dřívějším bugem v rozštěpení pravidla
 * (endDate staré části == startDate nové části, viz repairRecurringRuleSplitOverlaps).
 * Bez nálezu vrací původní data.
 */
export function repairRecurringRules(data: AppData): CommandResult<{ fixedCount: number }> {
  const { rules, fixedCount } = repairRecurringRuleSplitOverlaps(data.recurringRules);
  if (fixedCount === 0) return { data, outcome: { fixedCount } };
  return { data: { ...data, recurringRules: rules }, outcome: { fixedCount } };
}
