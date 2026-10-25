import type { Account, BalanceCorrection, Category, InvestmentFee, MarketValueSnapshot, Transaction, TransactionStatus } from '../types/finance';
import type { AppData } from './storageService';
import {
  restoreDeletedTransaction,
  type AddRecurringRuleOutcome,
  type CommandContext,
  type CommandResult,
  type DeleteTransactionOutcome,
  type RecurringMode,
} from './transactionCommands';
import {
  restoreCorrection,
  restoreDeletedAccount,
  restoreInvestmentFees,
  restoreMarketValue,
  undoArchiveAccount,
  type AddMarketValueOutcome,
  type ReconcileOutcome,
  type RemovedAccount,
} from './accountCommands';
import { restoreDeletedCategories, undoArchiveCategory } from './categoryCommands';
import type { MarketValueEdit } from './marketValueHistoryService';
import { formatCzechDate } from './periodService';
import { formatCurrency } from './currencyService';

/**
 * Command feedback: co se uživateli po akci řekne. Čisté funkce (outcome, vstup) → oznámení,
 * volitelné „Vrátit“ (příkaz a oznámení po vrácení) a případné odmítnutí. Všechny české texty
 * oznámení akcí jsou tady; FinanceContext je jen zobrazuje (viz perform).
 */

export type ToastType = 'success' | 'info' | 'warning' | 'error';

export interface FeedbackToast {
  text: string;
  type: ToastType;
}

/** Příkaz „Vrátit“; ctx dostane dnešek z kontextu v okamžiku kliknutí. */
export type UndoCommand = (data: AppData, ctx: CommandContext) => CommandResult<unknown>;

export interface CommandFeedback {
  /** Oznámení po akci; bez něj akce proběhne potichu. */
  toast?: FeedbackToast;
  /** Akce „Vrátit“ v oznámení: příkaz a oznámení po úspěšném vrácení. */
  undo?: { command: UndoCommand; toast: FeedbackToast };
  /** Příkaz akci odmítl (data se nezměnila); zpráva pro volajícího. */
  rejected?: string;
}

/**
 * Action result: výsledek každé akce FinanceContextu. Akce nikdy nevyhazuje výjimku.
 * 'not-saved' = změna se neuložila (data se ještě načítají nebo selhal zápis do úložiště),
 * 'rejected' = příkaz změnu odmítl (např. neplatný vstup nebo účet v použití).
 */
export type ActionResult<V = undefined> =
  | { ok: true; value: V }
  | { ok: false; reason: 'not-saved' | 'rejected'; message: string };

const success = (text: string): FeedbackToast => ({ text, type: 'success' });
const info = (text: string): FeedbackToast => ({ text, type: 'info' });
const warning = (text: string): FeedbackToast => ({ text, type: 'warning' });
const error = (text: string): FeedbackToast => ({ text, type: 'error' });

/** Odmítnutí s chybovým oznámením (text oznámení je zároveň zprávou pro volajícího). */
const rejectWith = (toast: FeedbackToast): CommandFeedback => ({ toast, rejected: toast.text });

/** Zpráva pro volajícího, když položka neexistuje; jako oznámení se nezobrazuje. */
export const ITEM_NOT_FOUND_MESSAGE = 'Položka nebyla nalezena.';

// ------------------- Položky -------------------

export function addTransactionFeedback(outcome: { transaction: Transaction; sequence: number } | { error: string }): CommandFeedback {
  if ('error' in outcome) return rejectWith(error(outcome.error));
  return { toast: success(`Položka „${outcome.transaction.title}“ byla přidána jako ${outcome.sequence}. v pořadí dne.`) };
}

export function updateTransactionFeedback(outcome: { title: string } | { error: string }): CommandFeedback {
  if ('error' in outcome) return rejectWith(error(outcome.error));
  return { toast: success(`Položka „${outcome.title}“ byla upravena.`) };
}

export function reorderDayTransactionsFeedback(): CommandFeedback {
  return { toast: success('Pořadí položek bylo uloženo.') };
}

export function deleteTransactionFeedback(outcome: DeleteTransactionOutcome, input: { mode: RecurringMode }): CommandFeedback {
  if (outcome.kind === 'none') return { rejected: ITEM_NOT_FOUND_MESSAGE };
  if (outcome.kind === 'plain') {
    const { transaction, correction } = outcome;
    return {
      toast: success(correction ? 'Korekce zůstatku byla smazána.' : `Položka „${transaction.title}“ byla smazána.`),
      // „Vrátit“ vrátí položku na původní místo v dni
      undo: {
        command: (data, ctx) => restoreDeletedTransaction(data, { transaction, correction }, ctx),
        toast: success(correction ? 'Korekce zůstatku byla obnovena.' : 'Položka byla obnovena.'),
      },
    };
  }
  const name = outcome.ruleTitle ? ` „${outcome.ruleTitle}“` : '';
  return {
    toast: success(
      input.mode === 'series' ? `Pravidelná položka${name} byla smazána.`
        : input.mode === 'future' ? `Budoucí výskyty pravidelné položky${name} byly smazány.`
        : `Výskyt pravidelné položky${name} byl smazán.`
    ),
  };
}

/** Oznámení, když se smazání nepodařilo zapsat do úložiště. */
export const DELETE_TRANSACTION_FAILED: FeedbackToast = error('Položku se nepodařilo smazat. Zkuste to prosím znovu.');

export function setTransactionStatusFeedback(outcome: { title: string } | null, input: { status: TransactionStatus }): CommandFeedback {
  if (!outcome) return { rejected: ITEM_NOT_FOUND_MESSAGE };
  const itemTitle = outcome.title;
  if (input.status === 'executed') {
    return { toast: success(itemTitle ? `Položka „${itemTitle}“ byla označena jako uskutečněná.` : 'Položka byla označena jako uskutečněná.') };
  }
  if (input.status === 'cancelled') {
    return { toast: info(itemTitle ? `Položka „${itemTitle}“ byla označena jako zrušená.` : 'Položka byla označena jako zrušená.') };
  }
  return { toast: info(itemTitle ? `Položka „${itemTitle}“ byla nastavena jako plánovaná.` : 'Položka byla nastavena jako plánovaná.') };
}

// ------------------- Pravidelné položky -------------------

export function addRecurringRuleFeedback(outcome: AddRecurringRuleOutcome): CommandFeedback {
  if ('error' in outcome) {
    // Neplatný zdroj hlásí jen formulář, neaktivní účet i oznámení
    return outcome.kind === 'inactiveAccount' ? rejectWith(error(outcome.error)) : { rejected: outcome.error };
  }
  return { toast: success(`Pravidelná položka „${outcome.rule.title}“ byla vytvořena.`) };
}

export function updateRecurringRuleFeedback(outcome: { ruleTitle?: string }): CommandFeedback {
  const { ruleTitle } = outcome;
  return { toast: success(ruleTitle ? `Pravidelná položka „${ruleTitle}“ byla upravena.` : 'Pravidelná položka byla upravena.') };
}

export function reorderRecurringItemFeedback(): CommandFeedback {
  return { toast: success('Pořadí pravidelné položky bylo uloženo.') };
}

export function deleteRecurringRuleFeedback(outcome: { ruleTitle?: string }): CommandFeedback {
  const { ruleTitle } = outcome;
  return { toast: success(ruleTitle ? `Pravidelná položka „${ruleTitle}“ byla smazána.` : 'Pravidelná položka byla smazána.') };
}

// ------------------- Účty -------------------

export function addAccountFeedback(outcome: { account: Account }): CommandFeedback {
  return { toast: success(`Účet „${outcome.account.name}“ byl vytvořen.`) };
}

export function updateAccountFeedback(outcome: { error: string } | { account: Account }, input: { account: Account }): CommandFeedback {
  if ('error' in outcome) return rejectWith(error(outcome.error));
  return { toast: success(`Účet „${input.account.name}“ byl upraven.`) };
}

export function archiveAccountFeedback(outcome: { error: string } | { before?: Account }): CommandFeedback {
  // Důvod odmítnutí ukáže obrazovka účtů
  if ('error' in outcome) return { rejected: outcome.error };
  const { before } = outcome;
  if (!before) return { toast: success('Účet byl archivován.') };
  return {
    toast: success(`Účet „${before.name}“ byl archivován.`),
    // „Vrátit“ vrátí účet do původního stavu včetně příznaku výchozího účtu
    undo: {
      command: (data, ctx) => undoArchiveAccount(data, before, ctx),
      toast: success(`Archivace účtu „${before.name}“ byla vrácena.`),
    },
  };
}

export function restoreAccountFeedback(outcome: { name?: string }): CommandFeedback {
  const { name } = outcome;
  return { toast: success(name ? `Účet „${name}“ byl obnoven z archivu.` : 'Účet byl obnoven z archivu.') };
}

export function deleteAccountFeedback(outcome: { error: string } | { removed: RemovedAccount | null }): CommandFeedback {
  if ('error' in outcome) return { rejected: outcome.error };
  const { removed } = outcome;
  if (!removed) return {};
  return {
    toast: success(`Účet „${removed.account.name}“ byl smazán.`),
    undo: {
      command: (data, ctx) => restoreDeletedAccount(data, removed, ctx),
      toast: success(`Účet „${removed.account.name}“ byl obnoven.`),
    },
  };
}

export function reconcileBalanceFeedback(outcome: ReconcileOutcome): CommandFeedback {
  if (outcome.kind === 'none') return {};
  if (outcome.kind === 'warning') return rejectWith(warning(outcome.message));
  if (outcome.kind === 'unchanged') return { toast: info('Zůstatek sedí s bankou, korekce nebyla potřeba.') };
  const { diffInHaler } = outcome;
  return { toast: success(`Zůstatek srovnán s bankou. Uložena korekce ${diffInHaler >= 0 ? '+' : ''}${(diffInHaler / 100).toLocaleString('cs-CZ')} Kč.`) };
}

export function updateMarketValueFeedback(outcome: AddMarketValueOutcome): CommandFeedback {
  if (outcome.kind === 'none') return {};
  if (outcome.kind === 'warning') return rejectWith(warning(outcome.message));
  const accountTypeLabel = outcome.accountType === 'pension' ? 'penzijního' : 'investičního';
  return { toast: success(`Tržní hodnota ${accountTypeLabel} účtu byla aktualizována.`) };
}

export function editMarketValueFeedback(_outcome: null, input: { edit: MarketValueEdit }): CommandFeedback {
  return { toast: success(`Tržní hodnota z ${formatCzechDate(input.edit.date)} byla upravena.`) };
}

export function deleteMarketValueFeedback(outcome: { deleted?: MarketValueSnapshot }): CommandFeedback {
  const { deleted } = outcome;
  if (!deleted) return { toast: success('Tržní hodnota byla smazána.') };
  return {
    toast: success(`Tržní hodnota z ${formatCzechDate(deleted.date)} byla smazána.`),
    // „Vrátit“ vloží záznam zpět s původním createdAt, takže se zachová i pořadí záznamů ze stejného dne
    undo: {
      command: (data, ctx) => restoreMarketValue(data, deleted, ctx),
      toast: success('Tržní hodnota byla obnovena.'),
    },
  };
}

export function saveInvestmentFeeFeedback(outcome: { error: string } | { fee: InvestmentFee }): CommandFeedback {
  if ('error' in outcome) return rejectWith(warning(outcome.error));
  return { toast: success('Poplatek byl uložen.') };
}

export function deleteInvestmentFeeFeedback(outcome: { target?: InvestmentFee; deleted: InvestmentFee[] }): CommandFeedback {
  const { target, deleted } = outcome;
  if (!target) return { toast: success('Poplatek byl smazán.') };
  return {
    toast: success(`Poplatek ${formatCurrency(target.amountInHaler)} byl smazán.`),
    // „Vrátit“ jen pokud mezitím pro stejné období nevznikl nový poplatek (nejvýše jeden za období)
    undo: {
      command: (data, ctx) => restoreInvestmentFees(data, deleted, ctx),
      toast: success('Poplatek byl obnoven.'),
    },
  };
}

export function updateCorrectionNoteFeedback(): CommandFeedback {
  return { toast: success('Poznámka ke korekci byla uložena.') };
}

export function deleteCorrectionFeedback(outcome: { deleted?: BalanceCorrection }): CommandFeedback {
  const { deleted } = outcome;
  // Samostatná korekce (bez položky v seznamu) se vrací jen do korekcí
  return {
    toast: success('Korekce zůstatku byla smazána.'),
    undo: deleted ? {
      command: (data, ctx) => restoreCorrection(data, deleted, ctx),
      toast: success('Korekce zůstatku byla obnovena.'),
    } : undefined,
  };
}

// ------------------- Kategorie -------------------

export function addCategoryFeedback(outcome: { category: Category }): CommandFeedback {
  return { toast: success(`Kategorie „${outcome.category.name}“ byla vytvořena.`) };
}

export function updateCategoryFeedback(_outcome: null, input: { category: Category }): CommandFeedback {
  return { toast: success(`Kategorie „${input.category.name}“ byla upravena.`) };
}

export function moveSubcategoryFeedback(outcome: { subName?: string; parentName?: string }): CommandFeedback {
  return {
    toast: success(outcome.subName && outcome.parentName
      ? `Podkategorie „${outcome.subName}“ byla přesunuta do kategorie „${outcome.parentName}“.`
      : 'Podkategorie byla přesunuta do jiné kategorie.'),
  };
}

export function archiveCategoryFeedback(outcome: { name?: string; affectedIds: string[] }): CommandFeedback {
  const { name, affectedIds } = outcome;
  // Archivovaná kategorie ze seznamu zmizí, proto oznámení nabídne vrácení
  return {
    toast: success(name ? `Kategorie „${name}“ byla archivována.` : 'Kategorie byla archivována.'),
    undo: {
      command: (data, ctx) => undoArchiveCategory(data, affectedIds, ctx),
      toast: success(name ? `Archivace kategorie „${name}“ byla vrácena.` : 'Archivace kategorie byla vrácena.'),
    },
  };
}

export function restoreCategoryFeedback(outcome: { name?: string }): CommandFeedback {
  const { name } = outcome;
  return { toast: success(name ? `Kategorie „${name}“ byla obnovena z archivu.` : 'Kategorie byla obnovena z archivu.') };
}

export function deleteCategoryFeedback(outcome: { error: string } | { name?: string; removed: Category[] }): CommandFeedback {
  // Důvod odmítnutí ukáže obrazovka kategorií
  if ('error' in outcome) return { rejected: outcome.error };
  const { name, removed } = outcome;
  return {
    toast: success(name ? `Kategorie „${name}“ byla smazána.` : 'Kategorie byla smazána.'),
    // „Vrátit“ obnoví kategorii i její podkategorie
    undo: removed.length ? {
      command: (data, ctx) => restoreDeletedCategories(data, removed, ctx),
      toast: success(name ? `Kategorie „${name}“ byla obnovena.` : 'Kategorie byla obnovena.'),
    } : undefined,
  };
}

// ------------------- Nastavení a data -------------------

export function updateSettingsFeedback(): CommandFeedback {
  return { toast: success('Nastavení bylo uloženo.') };
}

export function loadDemoDataFeedback(): CommandFeedback {
  return { toast: success('Ukázková data byla načtena.') };
}

/** Ukázková data jdou načíst jen v demo režimu. */
export const DEMO_MODE_ONLY: FeedbackToast = warning('Ukázková data jdou načíst jen v demo režimu.');

/** Pojistnou kopii před hromadným smazáním se nepodařilo uložit, proto se nic nesmazalo. */
export const RECOVERY_BACKUP_FAILED: FeedbackToast = error('Nepodařilo se uložit pojistnou kopii dat, proto se nic nesmazalo. Zkuste to prosím znovu.');

export function clearAllTransactionsFeedback(): CommandFeedback {
  return { toast: success('Všechny položky, pravidelné položky a korekce byly smazány.') };
}

export function clearAllAccountsFeedback(): CommandFeedback {
  return { toast: success('Všechny účty a data k nim byly smazány.') };
}

export function clearAllCategoriesFeedback(): CommandFeedback {
  return { toast: success('Všechny kategorie byly smazány. Položky zůstaly bez kategorie.') };
}

export function resetAllDataFeedback(): CommandFeedback {
  return { toast: success('Všechna data byla smazána. Aplikace začíná od nuly.') };
}

export function importBackupFeedback(): CommandFeedback {
  return { toast: success('Záloha byla sloučena s aktuálními daty.') };
}

/** Soubor zálohy je neplatný; nic se nesloučilo. */
export const importBackupFailed = (message: string): FeedbackToast => error(`Zálohu se nepodařilo obnovit: ${message}`);

/** Výsledek obnovy zálohy z obrazovky chyby načtení. */
export const restoreFromBackupToast = (merged: boolean): FeedbackToast => merged
  ? success('Data z Google Disku byla načtena a záloha s nimi sloučena.')
  : error('Zálohu se zatím nepodařilo sloučit. Až se data z Google Disku načtou, sloučte ji v Nastavení.');

export const EXPORT_JSON_DONE: FeedbackToast = success('Záloha byla stažena.');
export const EXPORT_CSV_DONE: FeedbackToast = success('Položky byly staženy jako CSV.');
