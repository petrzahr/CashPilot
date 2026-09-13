import {
  Account,
  AppSettings,
  BalanceCorrection,
  Category,
  MarketValueSnapshot,
  RecurringException,
  RecurringRule,
  Transaction
} from '../types/finance';
import {
  DEFAULT_CATEGORIES,
  DEFAULT_SETTINGS,
  createEmptyAppData
} from '../constants/defaultData';
import { halerToCzk } from './currencyService';
import { formatCzechDate } from './periodService';
import { sanitizeAndRepairSequences } from './sequenceService';
import { autoExecuteDueTransactions } from './statusService';

export interface AppData {
  version: number;
  settings: AppSettings;
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  recurringRules: RecurringRule[];
  recurringExceptions: RecurringException[];
  corrections: BalanceCorrection[];
  marketValueSnapshots: MarketValueSnapshot[];
}

export const STORAGE_KEY_PRODUCTION = 'cashpilot_data_v1';
export const STORAGE_KEY_TEST = 'cashpilot_test_data_v1';
export const STORAGE_KEY_DEMO = 'cashpilot_demo_data_v1';
export const RECOVERY_KEY_PREFIX = 'cashpilot_data_recovery_';
const PRE_CLEANUP_BACKUP_KEY = 'cashpilot_data_backup_pre_cleanup';

export function isTestEnvironment(): boolean {
  const g = globalThis as any;
  return Boolean(
    g.process?.env?.VITEST ||
    g.process?.env?.NODE_ENV === 'test' ||
    (typeof import.meta !== 'undefined' && (import.meta as any).env?.MODE === 'test')
  );
}

export function isDemoModeEnabled(): boolean {
  return typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_ENABLE_DEMO_DATA === 'true';
}

let activeStorageKeyOverride: string | null = null;

export function getActiveStorageKey(): string {
  if (activeStorageKeyOverride) return activeStorageKeyOverride;
  if (isTestEnvironment()) return STORAGE_KEY_TEST;
  if (isDemoModeEnabled()) return STORAGE_KEY_DEMO;
  return STORAGE_KEY_PRODUCTION;
}

export function setActiveStorageKey(key: string | null): void {
  activeStorageKeyOverride = key;
}

/**
 * Vrací čistou produkční datovou strukturu.
 * Nikdy neobsahuje demonstrační účty, transakce ani pravidla.
 */
export function getInitialData(): AppData {
  return createEmptyAppData();
}

/**
 * Sanituje a vyčistí osiřelé/neaktivní korekce:
 * - Záznam korekce, který patří účtu bez jakýchkoli reálných transakcí a bez pravidel
 *   (např. testovací stará korekce na prázdném účtu), nesmí existovat jako skrytý blokující záznam.
 * - Zachovává všechny platné korekce a korekce na účtech s existující finanční historií.
 */
export function sanitizeCorrections(
  corrections: BalanceCorrection[] = [],
  transactions: Transaction[] = [],
  recurringRules: RecurringRule[] = []
): { cleanedCorrections: BalanceCorrection[]; hasCorrectionsRemoved: boolean } {
  const initialCount = corrections.length;
  const cleanedCorrections = corrections.filter(c => {
    const hasTxs = transactions.some(
      t => t.sourceAccountId === c.accountId || t.targetAccountId === c.accountId
    );
    const hasRules = recurringRules.some(
      r => r.sourceAccountId === c.accountId || r.targetAccountId === c.accountId
    );
    if (!hasTxs && !hasRules) {
      console.info(`[Sanitace dat] Odstraněn osiřelý záznam korekce ${c.id} pro prázdný účet ${c.accountId}.`);
      return false;
    }
    return true;
  });

  return {
    cleanedCorrections,
    hasCorrectionsRemoved: cleanedCorrections.length !== initialCount
  };
}

export interface LoadDataResult {
  status: 'ready' | 'loadError';
  data: AppData;
  isNewInstall: boolean;
  error?: string;
  recoveryKey?: string;
  corruptedRaw?: string;
}

/**
 * Bezpečně načte a zvaliduje data z localStorage bez rizika přepsání poškozených dat.
 */
export function loadStoredDataResult(targetKey?: string): LoadDataResult {
  const key = targetKey || getActiveStorageKey();
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return {
        status: 'ready',
        data: getInitialData(),
        isNewInstall: true,
      };
    }

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch (parseErr) {
      console.error('[CashPilot] Chyba parsování JSON v úložišti:', parseErr);
      const recoveryKey = `${RECOVERY_KEY_PREFIX}${Date.now()}`;
      try {
        localStorage.setItem(recoveryKey, raw);
        console.info(`[CashPilot Záloha] Původní poškozená data byla uložena pod klíčem: ${recoveryKey}`);
      } catch (backupErr) {
        console.warn('Nepodařilo se uložit recovery zálohu poškozených dat:', backupErr);
      }
      return {
        status: 'loadError',
        data: getInitialData(),
        isNewInstall: false,
        error: 'Data aplikace se nepodařilo bezpečně načíst (neplatný formát JSON). Původní data nebyla přepsána. Obnovte data ze zálohy nebo použijte nástroj pro jejich kontrolu.',
        recoveryKey,
        corruptedRaw: raw,
      };
    }

    // Validace základní struktury objektu
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      (parsed.accounts && !Array.isArray(parsed.accounts)) ||
      (parsed.transactions && !Array.isArray(parsed.transactions)) ||
      (parsed.categories && !Array.isArray(parsed.categories))
    ) {
      console.error('[CashPilot] Neplatná datová struktura v úložišti');
      const recoveryKey = `${RECOVERY_KEY_PREFIX}${Date.now()}`;
      try {
        localStorage.setItem(recoveryKey, raw);
      } catch {}
      return {
        status: 'loadError',
        data: getInitialData(),
        isNewInstall: false,
        error: 'Data aplikace se nepodařilo bezpečně načíst (poškozená struktura). Původní data nebyla přepsána. Obnovte data ze zálohy nebo použijte nástroj pro jejich kontrolu.',
        recoveryKey,
        corruptedRaw: raw,
      };
    }

    // Bezpečná záloha před sanitací dat
    if (!localStorage.getItem(PRE_CLEANUP_BACKUP_KEY)) {
      try {
        localStorage.setItem(PRE_CLEANUP_BACKUP_KEY, raw);
        console.info('[Záloha dat] Byla vytvořena bezpečnostní záloha dat před vyčištěním osiřelých záznamů.');
      } catch (backupErr) {
        console.warn('Nepodařilo se vytvořit automatickou zálohu do localStorage:', backupErr);
      }
    }

    const sanitizedTxs = sanitizeAndRepairSequences(parsed.transactions || []);
    const { transactions: autoExecutedTxs, hasChanges: hasStatusChanges } = autoExecuteDueTransactions(
      sanitizedTxs,
      parsed.recurringRules || [],
      parsed.recurringExceptions || [],
      parsed.settings?.budgetStartDay || 15
    );
    const finalTxs = hasStatusChanges ? sanitizeAndRepairSequences(autoExecutedTxs) : sanitizedTxs;

    // Sanitace osiřelých / neaktivních korekcí pro prázdné účty bez transakcí
    const { cleanedCorrections, hasCorrectionsRemoved } = sanitizeCorrections(
      parsed.corrections || [],
      finalTxs,
      parsed.recurringRules || []
    );

    // DŮLEŽITÉ: Nikdy neseedovat DEMO_ACCOUNTS! Použít čisté pole []
    const safeAccounts: Account[] = parsed.accounts || [];

    // Invariant: nejvýše jeden aktivní výchozí účet, archivovaný účet nesmí být výchozí
    let defaultFound = false;
    let hasAccountChanges = false;
    const sanitizedAccounts = safeAccounts.map(a => {
      if (a.status === 'archived' && a.isDefault) {
        hasAccountChanges = true;
        return { ...a, isDefault: false };
      }
      if (a.isDefault) {
        if (!defaultFound) {
          defaultFound = true;
          return a;
        }
        hasAccountChanges = true;
        return { ...a, isDefault: false };
      }
      return a;
    });

    const cleanedSnapshots = (parsed.marketValueSnapshots || []).filter((s: MarketValueSnapshot) =>
      sanitizedAccounts.some(a => a.id === s.accountId)
    );

    // Migrace a sanitace nastavení (kontokorent se zpětnou kompatibilitou)
    const rawSettings = (parsed.settings || {}) as unknown as Record<string, unknown>;
    let overdraftLimitInHaler = rawSettings.overdraftLimitInHaler;
    if (typeof overdraftLimitInHaler !== 'number') {
      overdraftLimitInHaler = typeof rawSettings.minReserveInHaler === 'number'
        ? rawSettings.minReserveInHaler
        : DEFAULT_SETTINGS.overdraftLimitInHaler;
    }
    const hasSettingsChanges =
      rawSettings.overdraftLimitInHaler !== overdraftLimitInHaler ||
      rawSettings.minReserveInHaler !== overdraftLimitInHaler;

    const sanitizedSettings: AppSettings = {
      ...DEFAULT_SETTINGS,
      ...rawSettings,
      overdraftLimitInHaler: overdraftLimitInHaler as number,
      minReserveInHaler: overdraftLimitInHaler as number,
    };

    const dataToReturn: AppData = {
      version: parsed.version || 1,
      settings: sanitizedSettings,
      accounts: sanitizedAccounts,
      categories: parsed.categories || [...DEFAULT_CATEGORIES],
      transactions: finalTxs,
      recurringRules: parsed.recurringRules || [],
      recurringExceptions: parsed.recurringExceptions || [],
      corrections: cleanedCorrections,
      marketValueSnapshots: cleanedSnapshots,
    };

    if (
      finalTxs !== parsed.transactions ||
      hasStatusChanges ||
      hasCorrectionsRemoved ||
      hasAccountChanges ||
      hasSettingsChanges ||
      cleanedSnapshots.length !== (parsed.marketValueSnapshots || []).length
    ) {
      saveStoredData(dataToReturn, key);
    }

    return {
      status: 'ready',
      data: dataToReturn,
      isNewInstall: false,
    };
  } catch (err: any) {
    console.error('Chyba při načítání dat z localStorage:', err);
    return {
      status: 'loadError',
      data: getInitialData(),
      isNewInstall: false,
      error: `Chyba při načítání dat z úložiště: ${err.message || err}`,
    };
  }
}

/**
 * Standardní načtení dat pro běžné synchronní scénáře.
 */
export function loadStoredData(targetKey?: string): AppData {
  const result = loadStoredDataResult(targetKey);
  return result.data;
}

export function saveStoredData(data: AppData, targetKey?: string): void {
  const key = targetKey || getActiveStorageKey();
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (err) {
    console.error('Chyba při ukládání dat do localStorage:', err);
  }
}

/**
 * Export poškozeného raw obsahu úložiště do textového/JSON souboru pro kontrolu uživatelem
 */
export function exportCorruptedRawData(rawContent: string): void {
  const blob = new Blob([rawContent], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const now = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `cashpilot_poskozena_data_${now}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Export celého stavu do JSON souboru
 */
export function exportBackupJSON(data: AppData): void {
  const jsonStr = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const now = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `cashpilot_zaloha_${now}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Validace a načtení JSON zálohy
 */
export function validateAndParseBackup(jsonStr: string): AppData {
  const parsed = JSON.parse(jsonStr);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Neplatný formát souboru se zálohou.');
  }
  if (!Array.isArray(parsed.accounts) || !Array.isArray(parsed.categories)) {
    throw new Error('Záloha neobsahuje povinné entity (účty nebo kategorie).');
  }
  const rawCorrections = parsed.corrections || [];
  const rawTxs = parsed.transactions || [];
  const rawRules = parsed.recurringRules || [];
  const { cleanedCorrections } = sanitizeCorrections(rawCorrections, rawTxs, rawRules);

  const cleanedSnapshots = (parsed.marketValueSnapshots || []).filter((s: MarketValueSnapshot) =>
    (parsed.accounts as Account[]).some((a: Account) => a.id === s.accountId)
  );

  const rawSettings = (parsed.settings || {}) as unknown as Record<string, unknown>;
  let overdraftLimitInHaler = rawSettings.overdraftLimitInHaler;
  if (typeof overdraftLimitInHaler !== 'number') {
    overdraftLimitInHaler = typeof rawSettings.minReserveInHaler === 'number'
      ? rawSettings.minReserveInHaler
      : DEFAULT_SETTINGS.overdraftLimitInHaler;
  }
  const sanitizedSettings: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...rawSettings,
    overdraftLimitInHaler: overdraftLimitInHaler as number,
    minReserveInHaler: overdraftLimitInHaler as number,
  };

  return {
    version: parsed.version || 1,
    settings: sanitizedSettings,
    accounts: parsed.accounts,
    categories: parsed.categories,
    transactions: rawTxs,
    recurringRules: rawRules,
    recurringExceptions: parsed.recurringExceptions || [],
    corrections: cleanedCorrections,
    marketValueSnapshots: cleanedSnapshots,
  };
}

/**
 * Export transakcí do CSV (včetně UTF-8 BOM pro správné otevření v Excelu)
 */
export function exportTransactionsCSV(
  transactions: Transaction[], 
  accounts: Account[], 
  categories: Category[]
): void {
  const accMap = new Map(accounts.map(a => [a.id, a.name]));
  const catMap = new Map(categories.map(c => [c.id, c.name]));

  const headers = ['Datum', 'Název', 'Typ', 'Částka (Kč)', 'Účet', 'Cílový účet', 'Kategorie', 'Podkategorie', 'Stav', 'Poznámka'];
  const rows = transactions.map(t => {
    const typeLabel = t.type === 'income' ? 'Příjem' : t.type === 'expense' ? 'Výdaj' : 'Převod';
    const statusLabel = t.status === 'executed' ? 'Uskutečněná' : t.status === 'planned' ? 'Plánovaná' : 'Zrušená';
    const czk = halerToCzk(t.status === 'executed' && t.actualAmountInHaler !== undefined ? t.actualAmountInHaler : t.amountInHaler);
    const sourceName = accMap.get(t.sourceAccountId) || '';
    const targetName = t.targetAccountId ? (accMap.get(t.targetAccountId) || '') : '';
    const catName = t.categoryId ? (catMap.get(t.categoryId) || '') : '';
    const subName = t.subcategoryId ? (catMap.get(t.subcategoryId) || '') : '';

    return [
      `"${formatCzechDate(t.date)}"`,
      `"${t.title.replace(/"/g, '""')}"`,
      `"${typeLabel}"`,
      czk.toFixed(2).replace('.', ','),
      `"${sourceName}"`,
      `"${targetName}"`,
      `"${catName}"`,
      `"${subName}"`,
      `"${statusLabel}"`,
      `"${(t.note || '').replace(/"/g, '""')}"`
    ].join(';');
  });

  const csvContent = '\uFEFF' + [headers.join(';'), ...rows].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `cashpilot_polozky_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
