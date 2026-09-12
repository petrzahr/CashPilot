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
  DEMO_ACCOUNTS,
  DEMO_RECURRING_RULES,
  DEMO_TRANSACTIONS
} from './demoData';
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

const STORAGE_KEY = 'cashpilot_data_v1';

export function getInitialData(): AppData {
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
    accounts: [...DEMO_ACCOUNTS],
    categories: [...DEFAULT_CATEGORIES],
    transactions: [...DEMO_TRANSACTIONS],
    recurringRules: [...DEMO_RECURRING_RULES],
    recurringExceptions: [],
    corrections: [],
    marketValueSnapshots: [],
  };
}

const PRE_CLEANUP_BACKUP_KEY = 'cashpilot_data_backup_pre_cleanup';

/**
 * Sanituje a vyčistí osiřelé/neaktivní korekce:
 * - Záznam korekce, který patří účtu bez jakýchkoli reálných transakcí a bez pravidel
 *   (např. testovací stará korekce na účtu Spořicí účet Air Bank před zavedením systémových pohybů),
 *   nesmí existovat jako skrytý blokující záznam.
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
    // Pokud účet nemá žádné transakce ani trvalá pravidla, jedná se o osiřelý interní záznam
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

export function loadStoredData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const initial = getInitialData();
      saveStoredData(initial);
      return initial;
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

    const parsed = JSON.parse(raw) as AppData;
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

    const safeAccounts = parsed.accounts || [...DEMO_ACCOUNTS];
    
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

    const cleanedSnapshots = (parsed.marketValueSnapshots || []).filter(s =>
      sanitizedAccounts.some(a => a.id === s.accountId)
    );

    // Doplnit případná chybějící pole pro kompatibilitu
    const dataToReturn = {
      version: parsed.version || 1,
      settings: parsed.settings || { ...DEFAULT_SETTINGS },
      accounts: sanitizedAccounts,
      categories: parsed.categories || [...DEFAULT_CATEGORIES],
      transactions: finalTxs,
      recurringRules: parsed.recurringRules || [],
      recurringExceptions: parsed.recurringExceptions || [],
      corrections: cleanedCorrections,
      marketValueSnapshots: cleanedSnapshots,
    };
    if (finalTxs !== parsed.transactions || hasStatusChanges || hasCorrectionsRemoved || hasAccountChanges || cleanedSnapshots.length !== (parsed.marketValueSnapshots || []).length) {
      saveStoredData(dataToReturn);
    }
    return dataToReturn;
  } catch (err) {
    console.error('Chyba při načítání dat z localStorage:', err);
    return getInitialData();
  }
}

export function saveStoredData(data: AppData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (err) {
    console.error('Chyba při ukládání dat do localStorage:', err);
  }
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

  return {
    version: parsed.version || 1,
    settings: parsed.settings || { ...DEFAULT_SETTINGS },
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
