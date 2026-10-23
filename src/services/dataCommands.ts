import { Transaction } from '../types/finance';
import type { AppData } from './storageService';
import type { CommandResult } from './transactionCommands';
import { mergeBackupData } from './syncModel';
import { getNextSequenceForDate, sortTransactionsByDateAndSequence } from './sequenceService';

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
