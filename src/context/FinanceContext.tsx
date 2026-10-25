import { SyncController, type SyncStatus } from '../services/syncController';
import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Account,
  AppSettings,
  BalanceCorrection,
  BudgetPeriod,
  Category,
  ForecastResult,
  InvestmentFee,
  MarketValueSnapshot,
  PeriodRangeScreen,
  RecurringException,
  RecurringRule,
  Transaction,
  TransactionStatus
} from '../types/finance';
import {
  AppData,
  getInitialData,
  exportBackupJSON,
  validateAndParseBackup,
  exportTransactionsCSV,
  isDemoModeEnabled,
  createOperationRecoveryBackup,
} from '../services/storageService';
import {
  calculateQuickFinancialOverview,
  QuickFinancialOverview,
} from '../services/financialEngine';
import { getTodayInPrague, formatCzechDate } from '../services/periodService';
import type { DualPeriodRange } from '../services/periodRange';
import { sortAccountsByOrder } from '../services/accountService';
import type { MarketValueEdit } from '../services/marketValueHistoryService';
import { formatCurrency } from '../services/currencyService';
import type { GoogleUser } from '../services/googleDriveService';


import {
  CommandResult,
  DayPlacement,
  RecurringMode,
  StatusUpdates,
  createCommandContext,
  addRecurringRule as addRecurringRuleCommand,
  addTransaction as addTransactionCommand,
  autoExecute as autoExecuteCommand,
  deleteRecurringRule as deleteRecurringRuleCommand,
  deleteTransaction as deleteTransactionCommand,
  reorderDayTransactions as reorderDayTransactionsCommand,
  reorderRecurringItem as reorderRecurringItemCommand,
  restoreDeletedTransaction as restoreDeletedTransactionCommand,
  setTransactionStatus as setTransactionStatusCommand,
  updateRecurringRule as updateRecurringRuleCommand,
  updateTransaction as updateTransactionCommand,
} from '../services/transactionCommands';
import {
  addAccount as addAccountCommand,
  addMarketValue as addMarketValueCommand,
  archiveAccount as archiveAccountCommand,
  deleteAccount as deleteAccountCommand,
  deleteInvestmentFee as deleteInvestmentFeeCommand,
  deleteMarketValue as deleteMarketValueCommand,
  deleteStandaloneCorrection as deleteStandaloneCorrectionCommand,
  editMarketValue as editMarketValueCommand,
  reconcileBalance as reconcileBalanceCommand,
  reorderAccounts as reorderAccountsCommand,
  restoreAccount as restoreAccountCommand,
  restoreCorrection as restoreCorrectionCommand,
  restoreDeletedAccount as restoreDeletedAccountCommand,
  restoreInvestmentFees as restoreInvestmentFeesCommand,
  restoreMarketValue as restoreMarketValueCommand,
  saveInvestmentFee as saveInvestmentFeeCommand,
  undoArchiveAccount as undoArchiveAccountCommand,
  updateAccount as updateAccountCommand,
  updateCorrectionNote as updateCorrectionNoteCommand,
} from '../services/accountCommands';
import {
  addCategory as addCategoryCommand,
  addMainCategory as addMainCategoryCommand,
  archiveCategory as archiveCategoryCommand,
  deleteCategory as deleteCategoryCommand,
  moveSubcategory as moveSubcategoryCommand,
  restoreCategory as restoreCategoryCommand,
  restoreDeletedCategories as restoreDeletedCategoriesCommand,
  undoArchiveCategory as undoArchiveCategoryCommand,
  updateCategory as updateCategoryCommand,
} from '../services/categoryCommands';
import {
  clearAllAccounts as clearAllAccountsCommand,
  clearAllCategories as clearAllCategoriesCommand,
  clearAllTransactions as clearAllTransactionsCommand,
  importBackup as importBackupCommand,
  repairRecurringRules as repairRecurringRulesCommand,
  replaceWithDemoData as replaceWithDemoDataCommand,
  resetAllData as resetAllDataCommand,
  updateSettings as updateSettingsCommand,
} from '../services/dataCommands';
import { useDriveSession } from '../hooks/useDriveSession';
import { usePeriodForecast } from '../hooks/usePeriodForecast';

export type DriveSyncStatus = SyncStatus;

export interface ToastMessage {
  id: string;
  type: 'success' | 'info' | 'warning' | 'error';
  text: string;
  /** Volitelná akce přímo v oznámení, např. „Zkusit znovu“ */
  action?: { label: string; onClick: () => void };
  /** Za kolik ms oznámení samo zmizí (odpočet běží v ToastContainer a při najetí či fokusu se zastaví); bez hodnoty zůstává */
  durationMs?: number;
}

interface FinanceContextType {
  data: AppData;
  settings: AppSettings;
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  recurringRules: RecurringRule[];
  recurringExceptions: RecurringException[];
  corrections: BalanceCorrection[];
  marketValueSnapshots: MarketValueSnapshot[];
  investmentFees: InvestmentFee[];

  // Periody a výpočty
  /** Dnešek (Praha), se kterým počítá předpověď. */
  today: string;
  currentPeriod: BudgetPeriod;
  selectedPeriod: BudgetPeriod;
  setSelectedPeriod: (p: BudgetPeriod) => void;
  /** Rozsah období obrazovek Majetek a Analýza; pamatuje se v rámci relace a předpověď ho vždy pokrývá. */
  periodRanges: Record<PeriodRangeScreen, DualPeriodRange>;
  setPeriodRange: (screen: PeriodRangeScreen, range: DualPeriodRange) => void;
  goToNextPeriod: () => void;
  goToPreviousPeriod: () => void;
  goToCurrentPeriod: () => void;
  isCurrentPeriodSelected: boolean;
  forecastSequence: BudgetPeriod[];
  forecast: ForecastResult;
  quickOverview: QuickFinancialOverview;

  // Notifikace
  toasts: ToastMessage[];
  showToast: (text: string, type?: 'success' | 'info' | 'warning' | 'error', action?: ToastMessage['action']) => void;
  removeToast: (id: string) => void;

  // Transakce a pořadí
  addTransaction: (tx: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) => Transaction;
  updateTransaction: (tx: Transaction) => void;
  deleteTransaction: (
    id: string,
    recurringMode?: 'occurrence' | 'future' | 'series',
    deleteHistoricalExecuted?: boolean
  ) => Promise<boolean>;
  /** Vrácení smazané běžné položky (akce „Vrátit“ v oznámení po smazání) */
  restoreDeletedTransaction: (tx: Transaction, correction?: BalanceCorrection) => void;
  setTransactionStatus: (
    id: string,
    newStatus: TransactionStatus,
    updates?: { actualAmountInHaler?: number; date?: string; sourceAccountId?: string; categoryId?: string }
  ) => void;
  markTransactionExecuted: (id: string, updates?: { actualAmountInHaler?: number; date?: string; sourceAccountId?: string; categoryId?: string }) => void;
  cancelTransaction: (id: string) => void;
  reorderDayTransactions: (date: string, orderedIds: string[]) => void;
  checkDueTransactions: () => void;

  addRecurringRule: (
    rule: Omit<RecurringRule, 'id' | 'createdAt' | 'updatedAt'>,
    initialSequence?: number,
    initialStatus?: TransactionStatus,
    existingTransactionId?: string
  ) => RecurringRule;
  updateRecurringRule: (
    ruleId: string,
    mode: 'occurrence' | 'future' | 'series',
    periodKey: string,
    overrideData: Partial<Transaction>,
    originalTransactionId?: string,
    placement?: DayPlacement
  ) => void;
  deleteRecurringRule: (id: string) => void;
  reorderRecurringItem: (
    ruleId: string,
    mode: 'occurrence' | 'future' | 'series',
    date: string,
    periodKey: string,
    orderedIds: string[],
    movedTransactionId: string
  ) => void;

  // Účty
  addAccount: (account: Omit<Account, 'id' | 'createdAt' | 'updatedAt'>) => Account | undefined;
  updateAccount: (account: Account) => { success: boolean; message?: string };
  archiveAccount: (id: string) => { success: boolean; message?: string };
  restoreAccount: (id: string) => void;
  deleteAccount: (id: string) => { success: boolean; message?: string };
  reorderAccounts: (orderedIds: string[]) => void;
  reconcileBalance: (accountId: string, actualBalanceInHaler: number, checkDate: string, note?: string) => void;
  updateMarketValue: (accountId: string, marketValueInHaler: number, date?: string, note?: string) => void;
  updateCorrectionNote: (id: string, note: string) => void;
  editMarketValue: (id: string, edit: MarketValueEdit) => void;
  deleteMarketValue: (id: string) => void;
  saveInvestmentFee: (accountId: string, periodKey: string, amountInHaler: number, note?: string) => void;
  deleteInvestmentFee: (id: string) => void;
  deleteCorrection: (id: string) => Promise<boolean>;
  dataConflicts: { transaction: Transaction; account: Account; reason: string }[];

  // Kategorie
  addCategory: (cat: Omit<Category, 'id' | 'createdAt' | 'updatedAt'>) => Category | undefined;
  addMainCategory: (cat: Omit<Category, 'id' | 'createdAt' | 'updatedAt'>) => Category | undefined;
  updateCategory: (cat: Category) => void;
  moveSubcategory: (subcategoryId: string, newParentId: string, updateHistorical: boolean) => void;
  archiveCategory: (id: string) => void;
  restoreCategory: (id: string) => void;
  deleteCategory: (id: string) => { success: boolean; message?: string };

  // Stav načtení a obnova dat
  loadState: AppLoadState;
  loadErrorDetails: { message: string; recoveryKey?: string; corruptedRaw?: string } | null;
  restoreFromBackupFile: (jsonStr: string) => void;
  reloadFromDrive: () => void;
  retryLoadData: () => void;

  // Nastavení & Správa dat
  clearAllTransactions: () => boolean;
  clearAllAccounts: () => boolean;
  clearAllCategories: () => boolean;
  resetAllData: () => boolean;
  updateSettings: (newSettings: Partial<AppSettings>) => void;
  loadDemoData: () => void;
  exportJSON: () => void;
  importJSON: (jsonStr: string) => boolean;
  exportCSV: () => void;
  // Google Drive Synchronizace
  driveSyncStatus: DriveSyncStatus;
  isCloudReady: boolean;
  isDriveConnected: boolean;
  driveUser: GoogleUser | null;
  lastDriveSyncTime: Date | null;
  driveError: string | null;
  connectGoogleDrive: () => Promise<void>;
  disconnectGoogleDrive: () => Promise<void>;
  syncWithGoogleDrive: (forceDirection?: 'upload' | 'download') => Promise<void>;
  // Automatické JSON zálohy do viditelné složky na Google Disku
  driveBackupEnabled: boolean;
  setDriveBackupEnabled: (enabled: boolean) => void;
  lastDriveBackupTime: Date | null;
  runDriveBackupNow: () => Promise<void>;
}

export type AppLoadState = 'loading' | 'ready' | 'loadError';

export const NOT_SAVED_MESSAGE = 'Data se ještě načítají, změna nebyla uložena. Zkuste to prosím za chvíli znovu.';

/**
 * Synchronizace data po nahrání znovu parsuje, takže obsahově stejné části mají nové reference
 * a zbytečně by přepočítaly předpověď. Nezměněné části proto převezme z předchozích dat.
 */
export function reuseUnchangedSlices(prev: AppData, next: AppData): AppData {
  if (prev === next) return prev;
  const shared = { ...next } as Record<string, unknown>;
  const prevSlices = prev as unknown as Record<string, unknown>;
  let identical = Object.keys(prevSlices).length === Object.keys(shared).length;
  for (const key of Object.keys(shared)) {
    const before = prevSlices[key];
    const after = shared[key];
    const comparable = before !== after && before !== null && after !== null && typeof before === 'object' && typeof after === 'object'
      && (!Array.isArray(before) || (Array.isArray(after) && before.length === after.length));
    if (comparable && JSON.stringify(before) === JSON.stringify(after)) shared[key] = before;
    if (shared[key] !== before) identical = false;  }
  return identical ? prev : (shared as unknown as AppData);
}

const FinanceContext = createContext<FinanceContextType | null>(null);

export const FinanceProvider: React.FC<{ children: React.ReactNode; syncSession?: SyncController }> = ({ children, syncSession }) => {
  const [loadState, setLoadState] = useState<AppLoadState>('loading');
  const [loadErrorDetails, setLoadErrorDetails] = useState<{ message: string; recoveryKey?: string; corruptedRaw?: string } | null>(null);

  const [data, publishData] = useState<AppData>(() => syncSession?.data || getInitialData());
  const latestDataRef = useRef<AppData>(data);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Chyby a varování zůstávají, dokud je uživatel nezavře; potvrzení úspěchu zmizí samo
  const showToast = useCallback((
    text: string,
    type: 'success' | 'info' | 'warning' | 'error' = 'success',
    action?: ToastMessage['action']
  ) => {
    const id = `${Date.now()}_${Math.random()}`;
    // Oznámení s akcí (např. „Vrátit“) zůstane déle, aby se na tlačítko dalo dosáhnout
    const durationMs = type === 'error' || type === 'warning' ? undefined : action ? 8000 : 4000;
    setToasts(prev => [...prev, { id, text, type, action, durationMs }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // Relace s Google Diskem (SyncController); doména do ní zapisuje jen přes session.change
  const session = useDriveSession({
    initialSession: syncSession,
    onData: (next) => {
      const shared = reuseUnchangedSlices(latestDataRef.current, next);
      latestDataRef.current = shared;
      publishData(shared);
      setLoadState('ready');
      setLoadErrorDetails(null);
    },
    onNoSession: () => setLoadState('ready'),
    onLoadError: (details) => {
      setLoadState('loadError');
      setLoadErrorDetails(details);
    },
    onDisconnected: () => {
      const fresh = getInitialData();
      latestDataRef.current = fresh;
      publishData(fresh);
    },
    getData: () => latestDataRef.current,
    showToast,
  });
  const sessionChange = session.change;

  // Zápis, o který požádal uživatel: když se neuloží (data se ještě načítají), řekne to.
  const notifyNotSaved = useCallback(() => {
    showToast(NOT_SAVED_MESSAGE, 'error');
  }, [showToast]);

  // Spustí čistý příkaz nad aktuálními daty a vrátí jeho výsledek. SyncController volá
  // updater synchronně. Když se změna neuloží, vrací undefined a (mimo tichý režim) to oznámí.
  const runCommand = useCallback(<O,>(
    command: (prev: AppData) => CommandResult<O>,
    options: { silent?: boolean; reset?: boolean } = {}
  ): O | undefined => {
    let outcome: O | undefined;
    const saved = sessionChange(prev => {
      const result = command(prev);
      outcome = result.outcome;
      return result.data;
    }, options.reset);
    if (!saved) {
      if (!options.silent) notifyNotSaved();
      return undefined;
    }
    return outcome;
  }, [sessionChange, notifyNotSaved]);

  // Dnešek, období, rozsahy obrazovek a předpověď
  const periodForecast = usePeriodForecast(data);
  const { today: todayStr, setToday: setTodayStr, forecast } = periodForecast;

  const runAutoExecute = useCallback((customToday?: string) => {
    const currentToday = customToday || getTodayInPrague();
    setTodayStr(currentToday);
    runCommand(prev => autoExecuteCommand(prev, createCommandContext(currentToday)), { silent: true });
  }, [runCommand]);

  // 1. Spuštění při startu
  useEffect(() => {
    runAutoExecute();
  }, [runAutoExecute]);

  // Jednorázová oprava starších dat poškozených dřívějším bugem v rozštěpení
  // pravidla (endDate staré části == startDate nové části, viz repairRecurringRuleSplitOverlaps).
  // Nezávisí jen na loadState - u přihlášení přes Google Drive se `loadState`
  // nastaví na 'ready' hned na startu (ještě s prázdnými daty) a podruhé už se
  // nezmění, když až poté dorazí reálná data. Reference na `recurringRules` se
  // ale při doručení reálných dat vždy vymění, takže na ni bezpečně navazujeme.
  useEffect(() => {
    if (loadState !== 'ready') return;
    const outcome = runCommand(repairRecurringRulesCommand, { silent: true });
    if (outcome && outcome.fixedCount > 0) {
      console.info(`[CashPilot] Opraveno ${outcome.fixedCount} pravidel s překryvem endDate/startDate po rozštěpení série.`);
    }
  }, [loadState, data.recurringRules]);

  // 2. Návrat aplikace z neaktivního stavu (visibilitychange, focus)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        runAutoExecute();
      }
    };
    const handleFocus = () => {
      runAutoExecute();
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
    };
  }, [runAutoExecute]);

  // 3. Pravidelná kontrola změny dne v časovém pásmu Europe/Prague
  useEffect(() => {
    const interval = setInterval(() => {
      const currentPragueDate = getTodayInPrague();
      runAutoExecute(currentPragueDate);
    }, 15000);

    return () => clearInterval(interval);
  }, [runAutoExecute]);

  const quickOverview = useMemo(() => {
    return calculateQuickFinancialOverview(
      data.accounts,
      data.transactions,
      data.corrections,
      data.marketValueSnapshots,
      todayStr
    );
  }, [data.accounts, data.transactions, data.corrections, data.marketValueSnapshots, todayStr]);

  // ------------------- TRANSAKCE & POŘADÍ -------------------

  const addTransaction = useCallback((txData: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) => {
    const outcome = runCommand(prev => addTransactionCommand(prev, txData, createCommandContext(todayStr)));
    if (!outcome) throw new Error(NOT_SAVED_MESSAGE);
    if ('error' in outcome) {
      showToast(outcome.error, 'error');
      throw new Error(outcome.error);
    }
    showToast(`Položka „${outcome.transaction.title}“ byla přidána jako ${outcome.sequence}. v pořadí dne.`);
    return outcome.transaction;
  }, [runCommand, todayStr, showToast]);

  const updateTransaction = useCallback((updatedTx: Transaction) => {
    const outcome = runCommand(prev => updateTransactionCommand(prev, updatedTx, createCommandContext(todayStr)));
    if (!outcome) return;
    if ('error' in outcome) {
      showToast(outcome.error, 'error');
      throw new Error(outcome.error);
    }
    showToast(`Položka „${outcome.title}“ byla upravena.`);
  }, [runCommand, todayStr, showToast]);

  const reorderDayTransactions = useCallback((date: string, orderedIds: string[]) => {
    const outcome = runCommand(prev => reorderDayTransactionsCommand(prev, { date, orderedIds }, createCommandContext(todayStr)));
    if (outcome === undefined) return;
    showToast('Pořadí položek bylo uloženo.');
  }, [runCommand, todayStr, showToast]);

  // „Vrátit“ po smazání běžné položky: vrátí ji na původní místo v dni.
  const restoreDeletedTransaction = useCallback((tx: Transaction, correction?: BalanceCorrection) => {
    if (runCommand(prev => restoreDeletedTransactionCommand(prev, { transaction: tx, correction }, createCommandContext(todayStr))) === undefined) return;
    showToast(correction ? 'Korekce zůstatku byla obnovena.' : 'Položka byla obnovena.');
  }, [runCommand, todayStr, showToast]);

  const deleteTransaction = useCallback(async (
    id: string,
    recurringMode: RecurringMode = 'occurrence',
    deleteHistoricalExecuted: boolean = false
  ): Promise<boolean> => {
    try {
      // Ověření dostupnosti úložiště (pokud selže, vyvolá chybu)
      try {
        localStorage.setItem('__cp_test__', '1');
        localStorage.removeItem('__cp_test__');
      } catch (e) {
        throw new Error('Úložiště není dostupné.');
      }

      const outcome = runCommand(prev => deleteTransactionCommand(
        prev,
        { id, mode: recurringMode, deleteHistoricalExecuted },
        createCommandContext(todayStr)
      ));
      if (!outcome || outcome.kind === 'none') return false;

      if (outcome.kind === 'plain') {
        const { transaction, correction } = outcome;
        const text = correction
          ? 'Korekce zůstatku byla smazána.'
          : `Položka „${transaction.title}“ byla smazána.`;
        showToast(text, 'success', {
          label: 'Vrátit',
          onClick: () => restoreDeletedTransaction(transaction, correction),
        });
      } else {
        const name = outcome.ruleTitle ? ` „${outcome.ruleTitle}“` : '';
        showToast(
          recurringMode === 'series' ? `Pravidelná položka${name} byla smazána.`
            : recurringMode === 'future' ? `Budoucí výskyty pravidelné položky${name} byly smazány.`
            : `Výskyt pravidelné položky${name} byl smazán.`
        );
      }
      return true;
    } catch (err) {
      console.error('Chyba při mazání položky:', err);
      showToast('Položku se nepodařilo smazat. Zkuste to prosím znovu.', 'error');
      return false;
    }
  }, [runCommand, todayStr, showToast, restoreDeletedTransaction]);

  const setTransactionStatus = useCallback((
    id: string,
    newStatus: TransactionStatus,
    updates?: StatusUpdates
  ) => {
    const outcome = runCommand(prev => setTransactionStatusCommand(
      prev,
      { id, status: newStatus, updates },
      createCommandContext(todayStr)
    ));
    if (!outcome) return;

    const itemTitle = outcome.title;
    if (newStatus === 'executed') {
      showToast(itemTitle ? `Položka „${itemTitle}“ byla označena jako uskutečněná.` : 'Položka byla označena jako uskutečněná.', 'success');
    } else if (newStatus === 'cancelled') {
      showToast(itemTitle ? `Položka „${itemTitle}“ byla označena jako zrušená.` : 'Položka byla označena jako zrušená.', 'info');
    } else {
      showToast(itemTitle ? `Položka „${itemTitle}“ byla nastavena jako plánovaná.` : 'Položka byla nastavena jako plánovaná.', 'info');
    }
  }, [runCommand, todayStr, showToast]);

  const markTransactionExecuted = useCallback((
    id: string,
    updates?: StatusUpdates
  ) => {
    setTransactionStatus(id, 'executed', updates);
  }, [setTransactionStatus]);

  const cancelTransaction = useCallback((id: string) => {
    setTransactionStatus(id, 'cancelled');
  }, [setTransactionStatus]);

  // ------------------- PRAVIDELNÉ POLOŽKY -------------------

  const addRecurringRule = useCallback((
    ruleData: Omit<RecurringRule, 'id' | 'createdAt' | 'updatedAt'>,
    initialSequence?: number,
    initialStatus?: TransactionStatus,
    existingTransactionId?: string
  ) => {
    const outcome = runCommand(prev => addRecurringRuleCommand(
      prev,
      { ruleData, initialSequence, initialStatus, existingTransactionId },
      createCommandContext(getTodayInPrague())
    ));
    if (!outcome) throw new Error(NOT_SAVED_MESSAGE);
    if ('error' in outcome) {
      if (outcome.kind === 'inactiveAccount') showToast(outcome.error, 'error');
      throw new Error(outcome.error);
    }

    showToast(`Pravidelná položka „${outcome.rule.title}“ byla vytvořena.`);
    return outcome.rule;
  }, [runCommand, showToast]);

  const updateRecurringRule = useCallback((
    ruleId: string,
    mode: RecurringMode,
    periodKey: string,
    overrideData: Partial<Transaction>,
    originalTransactionId?: string,
    placement?: DayPlacement
  ) => {
    const outcome = runCommand(prev => updateRecurringRuleCommand(
      prev,
      { ruleId, mode, periodKey, overrideData, originalTransactionId, placement },
      createCommandContext(todayStr)
    ));
    if (!outcome) return;

    const ruleTitle = outcome.ruleTitle;
    showToast(ruleTitle ? `Pravidelná položka „${ruleTitle}“ byla upravena.` : 'Pravidelná položka byla upravena.');
  }, [runCommand, todayStr, showToast]);

  const reorderRecurringItem = useCallback((
    ruleId: string,
    mode: RecurringMode,
    date: string,
    periodKey: string,
    orderedIds: string[],
    movedTransactionId: string
  ) => {
    const outcome = runCommand(prev => reorderRecurringItemCommand(
      prev,
      { ruleId, mode, date, periodKey, orderedIds, movedTransactionId },
      createCommandContext(todayStr)
    ));
    if (!outcome) return;
    showToast('Pořadí pravidelné položky bylo uloženo.');
  }, [runCommand, todayStr, showToast]);

  const deleteRecurringRule = useCallback((id: string) => {
    const outcome = runCommand(prev => deleteRecurringRuleCommand(prev, id));
    if (!outcome) return;
    const ruleTitle = outcome.ruleTitle;
    showToast(ruleTitle ? `Pravidelná položka „${ruleTitle}“ byla smazána.` : 'Pravidelná položka byla smazána.');
  }, [runCommand, showToast]);

  // ------------------- SPRÁVA ÚČTŮ -------------------

  const addAccount = useCallback((accData: Omit<Account, 'id' | 'createdAt' | 'updatedAt'>) => {
    const outcome = runCommand(prev => addAccountCommand(prev, accData, createCommandContext(todayStr)));
    if (!outcome) return undefined;
    showToast(`Účet „${outcome.account.name}“ byl vytvořen.`);
    return outcome.account;
  }, [runCommand, todayStr, showToast]);

  const updateAccount = useCallback((acc: Account) => {
    const outcome = runCommand(prev => updateAccountCommand(prev, acc, createCommandContext(todayStr)));
    if (!outcome) return { success: false, message: NOT_SAVED_MESSAGE };
    if ('error' in outcome) {
      showToast(outcome.error, 'error');
      return { success: false, message: outcome.error };
    }
    showToast(`Účet „${acc.name}“ byl upraven.`);
    return { success: true };
  }, [runCommand, todayStr, showToast]);

  const archiveAccount = useCallback((id: string) => {
    const outcome = runCommand(prev => archiveAccountCommand(prev, id, createCommandContext(todayStr)));
    if (!outcome) return { success: false, message: NOT_SAVED_MESSAGE };
    if ('error' in outcome) return { success: false, message: outcome.error };

    // „Vrátit“ vrátí účet do původního stavu včetně příznaku výchozího účtu
    const before = outcome.before;
    showToast(before ? `Účet „${before.name}“ byl archivován.` : 'Účet byl archivován.', 'success', before ? {
      label: 'Vrátit',
      onClick: () => {
        if (runCommand(prev => undoArchiveAccountCommand(prev, before, createCommandContext(getTodayInPrague()))) === undefined) return;
        showToast(`Archivace účtu „${before.name}“ byla vrácena.`);
      },
    } : undefined);
    return { success: true };
  }, [runCommand, todayStr, showToast]);

  const restoreAccount = useCallback((id: string) => {
    const outcome = runCommand(prev => restoreAccountCommand(prev, id, createCommandContext(todayStr)));
    if (!outcome) return;
    const { name } = outcome;
    showToast(name ? `Účet „${name}“ byl obnoven z archivu.` : 'Účet byl obnoven z archivu.');
  }, [runCommand, todayStr, showToast]);

  const deleteAccount = useCallback((id: string) => {
    const outcome = runCommand(prev => deleteAccountCommand(prev, id));
    if (!outcome) return { success: false, message: NOT_SAVED_MESSAGE };
    if ('error' in outcome) return { success: false, message: outcome.error };

    const removed = outcome.removed;
    if (!removed) return { success: true };
    showToast(`Účet „${removed.account.name}“ byl smazán.`, 'success', {
      label: 'Vrátit',
      onClick: () => {
        if (runCommand(prev => restoreDeletedAccountCommand(prev, removed, createCommandContext(getTodayInPrague()))) === undefined) return;
        showToast(`Účet „${removed.account.name}“ byl obnoven.`);
      },
    });
    return { success: true };
  }, [runCommand, showToast]);

  const reorderAccounts = useCallback((orderedIds: string[]) => {
    runCommand(prev => reorderAccountsCommand(prev, orderedIds));
  }, [runCommand]);

  const reconcileBalance = useCallback((
    accountId: string,
    actualBalanceInHaler: number,
    checkDate: string,
    note?: string
  ) => {
    const outcome = runCommand(prev => reconcileBalanceCommand(
      prev,
      { accountId, actualBalanceInHaler, checkDate, note },
      createCommandContext(todayStr)
    ));
    if (!outcome || outcome.kind === 'none') return;
    if (outcome.kind === 'warning') {
      showToast(outcome.message, 'warning');
    } else if (outcome.kind === 'unchanged') {
      showToast('Zůstatek sedí s bankou, korekce nebyla potřeba.', 'info');
    } else {
      const { diffInHaler } = outcome;
      showToast(`Zůstatek srovnán s bankou. Uložena korekce ${diffInHaler >= 0 ? '+' : ''}${(diffInHaler / 100).toLocaleString('cs-CZ')} Kč.`);
    }
  }, [runCommand, todayStr, showToast]);

  const updateMarketValue = useCallback((
    accountId: string,
    marketValueInHaler: number,
    date?: string,
    note?: string
  ) => {
    const outcome = runCommand(prev => addMarketValueCommand(
      prev,
      { accountId, marketValueInHaler, date, note },
      createCommandContext(getTodayInPrague())
    ));
    if (!outcome || outcome.kind === 'none') return;
    if (outcome.kind === 'warning') {
      showToast(outcome.message, 'warning');
      return;
    }
    const accountTypeLabel = outcome.accountType === 'pension' ? 'penzijního' : 'investičního';
    showToast(`Tržní hodnota ${accountTypeLabel} účtu byla aktualizována.`);
  }, [runCommand, showToast]);

  const editMarketValue = useCallback((id: string, edit: MarketValueEdit) => {
    if (runCommand(prev => editMarketValueCommand(prev, { id, edit })) === undefined) return;
    showToast(`Tržní hodnota z ${formatCzechDate(edit.date)} byla upravena.`);
  }, [runCommand, showToast]);

  const deleteMarketValue = useCallback((id: string) => {
    const outcome = runCommand(prev => deleteMarketValueCommand(prev, id));
    if (!outcome) return;
    const { deleted } = outcome;
    if (!deleted) {
      showToast('Tržní hodnota byla smazána.');
      return;
    }
    // „Vrátit“ vloží záznam zpět s původním createdAt, takže se zachová i pořadí záznamů ze stejného dne
    showToast(`Tržní hodnota z ${formatCzechDate(deleted.date)} byla smazána.`, 'success', {
      label: 'Vrátit',
      onClick: () => {
        if (runCommand(prev => restoreMarketValueCommand(prev, deleted, createCommandContext(getTodayInPrague()))) === undefined) return;
        showToast('Tržní hodnota byla obnovena.');
      },
    });
  }, [runCommand, showToast]);

  const saveInvestmentFee = useCallback((accountId: string, periodKey: string, amountInHaler: number, note?: string) => {
    const outcome = runCommand(prev => saveInvestmentFeeCommand(
      prev,
      { accountId, periodKey, amountInHaler, note },
      createCommandContext(todayStr)
    ));
    if (!outcome) return;
    if ('error' in outcome) {
      showToast(outcome.error, 'warning');
      return;
    }
    showToast('Poplatek byl uložen.');
  }, [runCommand, todayStr, showToast]);

  const deleteInvestmentFee = useCallback((id: string) => {
    const outcome = runCommand(prev => deleteInvestmentFeeCommand(prev, id));
    if (!outcome) return;
    const { target, deleted } = outcome;
    if (!target) {
      showToast('Poplatek byl smazán.');
      return;
    }
    // „Vrátit“ jen pokud mezitím pro stejné období nevznikl nový poplatek (nejvýše jeden za období)
    showToast(`Poplatek ${formatCurrency(target.amountInHaler)} byl smazán.`, 'success', {
      label: 'Vrátit',
      onClick: () => {
        if (runCommand(prev => restoreInvestmentFeesCommand(prev, deleted, createCommandContext(getTodayInPrague()))) === undefined) return;
        showToast('Poplatek byl obnoven.');
      },
    });
  }, [runCommand, showToast]);

  const updateCorrectionNote = useCallback((id: string, note: string) => {
    if (runCommand(prev => updateCorrectionNoteCommand(prev, { id, note }, createCommandContext(todayStr))) === undefined) return;
    showToast('Poznámka ke korekci byla uložena.');
  }, [runCommand, todayStr, showToast]);

  const deleteCorrection = useCallback(async (id: string) => {
    // Korekce uložená i jako položka seznamu se maže jako položka (s „Vrátit“ pro obojí)
    if (latestDataRef.current.transactions.some(t => t.id === id)) {
      return deleteTransaction(id);
    }
    const outcome = runCommand(prev => deleteStandaloneCorrectionCommand(prev, id));
    if (!outcome) return false;
    const { deleted } = outcome;
    // Samostatná korekce (bez položky v seznamu) se vrací jen do korekcí
    showToast('Korekce zůstatku byla smazána.', 'success', deleted ? {
      label: 'Vrátit',
      onClick: () => {
        if (runCommand(prev => restoreCorrectionCommand(prev, deleted, createCommandContext(getTodayInPrague()))) === undefined) return;
        showToast('Korekce zůstatku byla obnovena.');
      },
    } : undefined);
    return true;
  }, [runCommand, deleteTransaction, showToast]);

  // ------------------- SPRÁVA KATEGORIÍ -------------------

  const addCategory = useCallback((catData: Omit<Category, 'id' | 'createdAt' | 'updatedAt'>) => {
    const outcome = runCommand(prev => addCategoryCommand(prev, catData, createCommandContext(todayStr)));
    if (!outcome) return undefined;
    showToast(`Kategorie „${outcome.category.name}“ byla vytvořena.`);
    return outcome.category;
  }, [runCommand, todayStr, showToast]);

  const addMainCategory = useCallback((catData: Omit<Category, 'id' | 'createdAt' | 'updatedAt'>) => {
    const outcome = runCommand(prev => addMainCategoryCommand(prev, catData, createCommandContext(todayStr)));
    if (!outcome) return undefined;
    showToast(`Kategorie „${outcome.category.name}“ byla vytvořena.`);
    return outcome.category;
  }, [runCommand, todayStr, showToast]);

  const updateCategory = useCallback((cat: Category) => {
    if (runCommand(prev => updateCategoryCommand(prev, cat, createCommandContext(todayStr))) === undefined) return;
    showToast(`Kategorie „${cat.name}“ byla upravena.`);
  }, [runCommand, todayStr, showToast]);

  const moveSubcategory = useCallback((subcategoryId: string, newParentId: string, updateHistorical: boolean) => {
    const outcome = runCommand(prev => moveSubcategoryCommand(
      prev,
      { subcategoryId, newParentId, updateHistorical },
      createCommandContext(todayStr)
    ));
    if (!outcome) return;
    showToast(outcome.subName && outcome.parentName
      ? `Podkategorie „${outcome.subName}“ byla přesunuta do kategorie „${outcome.parentName}“.`
      : 'Podkategorie byla přesunuta do jiné kategorie.');
  }, [runCommand, todayStr, showToast]);

  const archiveCategory = useCallback((id: string) => {
    const outcome = runCommand(prev => archiveCategoryCommand(prev, id, createCommandContext(todayStr)));
    if (!outcome) return;
    const { name, affectedIds } = outcome;
    // Archivovaná kategorie ze seznamu zmizí, proto oznámení nabídne vrácení
    showToast(name ? `Kategorie „${name}“ byla archivována.` : 'Kategorie byla archivována.', 'success', {
      label: 'Vrátit',
      onClick: () => {
        if (runCommand(prev => undoArchiveCategoryCommand(prev, affectedIds, createCommandContext(getTodayInPrague()))) === undefined) return;
        showToast(name ? `Archivace kategorie „${name}“ byla vrácena.` : 'Archivace kategorie byla vrácena.');
      },
    });
  }, [runCommand, todayStr, showToast]);

  const restoreCategory = useCallback((id: string) => {
    const outcome = runCommand(prev => restoreCategoryCommand(prev, id, createCommandContext(todayStr)));
    if (!outcome) return;
    const { name } = outcome;
    showToast(name ? `Kategorie „${name}“ byla obnovena z archivu.` : 'Kategorie byla obnovena z archivu.');
  }, [runCommand, todayStr, showToast]);

  const deleteCategory = useCallback((id: string) => {
    const outcome = runCommand(prev => deleteCategoryCommand(prev, id));
    if (!outcome) return { success: false, message: NOT_SAVED_MESSAGE };
    if ('error' in outcome) return { success: false, message: outcome.error };

    const { name, removed } = outcome;
    // „Vrátit“ obnoví kategorii i její podkategorie
    showToast(name ? `Kategorie „${name}“ byla smazána.` : 'Kategorie byla smazána.', 'success', removed.length ? {
      label: 'Vrátit',
      onClick: () => {
        if (runCommand(prev => restoreDeletedCategoriesCommand(prev, removed, createCommandContext(getTodayInPrague()))) === undefined) return;
        showToast(name ? `Kategorie „${name}“ byla obnovena.` : 'Kategorie byla obnovena.');
      },
    } : undefined);
    return { success: true };
  }, [runCommand, showToast]);

  // ------------------- NASTAVENÍ A DATA -------------------

  const updateSettings = useCallback((newSettings: Partial<AppSettings>) => {
    if (runCommand(prev => updateSettingsCommand(prev, newSettings)) === undefined) return;
    showToast('Nastavení bylo uloženo.');
  }, [runCommand, showToast]);

  const loadDemoData = useCallback(async () => {
    if (!isDemoModeEnabled()) {
      showToast('Ukázková data jdou načíst jen v demo režimu.', 'warning');
      return;
    }
    const { DEMO_ACCOUNTS, DEMO_RECURRING_RULES, DEMO_TRANSACTIONS } = await import('../fixtures/demoData');
    const demo = { accounts: DEMO_ACCOUNTS, recurringRules: DEMO_RECURRING_RULES, transactions: DEMO_TRANSACTIONS };
    if (runCommand(prev => replaceWithDemoDataCommand(prev, demo)) === undefined) return;
    showToast('Ukázková data byla načtena.');
  }, [runCommand, showToast]);

  const clearAllTransactions = useCallback((): boolean => {
    // 1. Vytvořit interní recovery zálohu
    const backupCreated = createOperationRecoveryBackup(latestDataRef.current, 'clear_transactions');
    if (!backupCreated) {
      showToast('Nepodařilo se uložit pojistnou kopii dat, proto se nic nesmazalo. Zkuste to prosím znovu.', 'error');
      return false;
    }

    // 2. Odstranit všechny finanční položky, pravidla opakovaných plateb, výjimky a korekce
    if (runCommand(clearAllTransactionsCommand) === undefined) return false;

    showToast('Všechny položky, pravidelné položky a korekce byly smazány.');
    return true;
  }, [runCommand, showToast]);

  const clearAllAccounts = useCallback((): boolean => {
    // 1. Vytvořit interní recovery zálohu
    const backupCreated = createOperationRecoveryBackup(latestDataRef.current, 'clear_accounts');
    if (!backupCreated) {
      showToast('Nepodařilo se uložit pojistnou kopii dat, proto se nic nesmazalo. Zkuste to prosím znovu.', 'error');
      return false;
    }

    // 2. Odstranit všechny účty a všechna závislá finanční data
    if (runCommand(clearAllAccountsCommand) === undefined) return false;

    showToast('Všechny účty a data k nim byly smazány.');
    return true;
  }, [runCommand, showToast]);

  const clearAllCategories = useCallback((): boolean => {
    // 1. Vytvořit interní recovery zálohu
    const backupCreated = createOperationRecoveryBackup(latestDataRef.current, 'clear_categories');
    if (!backupCreated) {
      showToast('Nepodařilo se uložit pojistnou kopii dat, proto se nic nesmazalo. Zkuste to prosím znovu.', 'error');
      return false;
    }

    // 2. Odstranit všechny kategorie a u všech zachovaných položek a pravidel odpojit kategorie (nastavit na null)
    if (runCommand(clearAllCategoriesCommand) === undefined) return false;

    showToast('Všechny kategorie byly smazány. Položky zůstaly bez kategorie.');
    return true;
  }, [runCommand, showToast]);

  const resetAllData = useCallback((): boolean => {
    // 1. Vytvořit interní recovery zálohu
    const backupCreated = createOperationRecoveryBackup(latestDataRef.current, 'clear_all');
    if (!backupCreated) {
      showToast('Nepodařilo se uložit pojistnou kopii dat, proto se nic nesmazalo. Zkuste to prosím znovu.', 'error');
      return false;
    }

    // 2. Kompletní čistý reset: 0 účtů, 0 transakcí, 0 pravidel, 0 korekcí, 0 tržních hodnot, 0 kategorií
    if (runCommand(resetAllDataCommand, { reset: true }) === undefined) return false;

    showToast('Všechna data byla smazána. Aplikace začíná od nuly.');
    return true;
  }, [runCommand, showToast]);

  // Obnova z obrazovky chyby načtení: poškozená je jen lokální obálka, data na Google Disku
  // se nikdy neresetují. Relace se načte z Disku a výsledek přijde přes onData.
  const discardCorruptedCache = session.discardCorruptedCache;
  const reloadFromDrive = useCallback(() => {
    void discardCorruptedCache();
  }, [discardCorruptedCache]);

  // Neplatný soubor vyhodí chybu synchronně, ještě než se cokoli smaže
  const restoreFromBackupFile = useCallback((jsonStr: string) => {
    const parsed = validateAndParseBackup(jsonStr);
    void discardCorruptedCache().then(result => {
      if (result === 'refused') return;
      let merged = false;
      if (result === 'ready') {
        try {
          merged = runCommand(prev => importBackupCommand(prev, parsed), { silent: true }) !== undefined;
        } catch {
          // Chybu zápisu už hlásí stav synchronizace; záloha se jen nesloučila
        }
      }
      if (merged) {
        showToast('Data z Google Disku byla načtena a záloha s nimi sloučena.');
      } else {
        showToast('Zálohu se zatím nepodařilo sloučit. Až se data z Google Disku načtou, sloučte ji v Nastavení.', 'error');
      }
    });
  }, [discardCorruptedCache, runCommand, showToast]);

  // Znovu založí relaci: obálku účtu načte SyncController, výsledek přijde přes onData nebo onLoadError
  const retrySession = session.syncWithGoogleDrive;
  const retryLoadData = useCallback(() => {
    void retrySession();
  }, [retrySession]);

  const exportJSON = useCallback(() => {
    exportBackupJSON(data);
    showToast('Záloha byla stažena.');
  }, [data, showToast]);

  const importJSON = useCallback((jsonStr: string): boolean => {
    try {
      const parsed = validateAndParseBackup(jsonStr);
      // Slučuje se s aktuálními daty v controlleru, nikdy se starší kopií z tohoto renderu
      if (runCommand(prev => importBackupCommand(prev, parsed)) === undefined) return false;
      showToast('Záloha byla sloučena s aktuálními daty.');
      return true;
    } catch (err: any) {
      showToast(`Zálohu se nepodařilo obnovit: ${err.message}`, 'error');
      return false;
    }
  }, [runCommand, showToast]);

  const exportCSV = useCallback(() => {
    exportTransactionsCSV(data.transactions, data.accounts, data.categories);
    showToast('Položky byly staženy jako CSV.');
  }, [data.transactions, data.accounts, data.categories, showToast]);


  const dataConflicts = useMemo(() => {
    const conflicts: { transaction: Transaction; account: Account; reason: string }[] = [];
    const accountMap = new Map(data.accounts.map(a => [a.id, a]));

    for (const tx of data.transactions) {
      if (tx.sourceAccountId) {
        const acc = accountMap.get(tx.sourceAccountId);
        if (acc && acc.initialBalanceDate && tx.date < acc.initialBalanceDate) {
          conflicts.push({
            transaction: tx,
            account: acc,
            reason: `Položka ze dne ${formatCzechDate(tx.date)} předchází aktivaci účtu ${acc.name} (${formatCzechDate(acc.initialBalanceDate)}).`
          });
          continue;
        }
      }
      if (tx.targetAccountId) {
        const acc = accountMap.get(tx.targetAccountId);
        if (acc && acc.initialBalanceDate && tx.date < acc.initialBalanceDate) {
          conflicts.push({
            transaction: tx,
            account: acc,
            reason: `Převod ze dne ${formatCzechDate(tx.date)} předchází aktivaci cílového účtu ${acc.name} (${formatCzechDate(acc.initialBalanceDate)}).`
          });
        }
      }
    }
    return conflicts;
  }, [data.transactions, data.accounts]);

  // Účty se napříč aplikací zobrazují v uživatelem definovaném pořadí (sortOrder).
  const orderedAccounts = useMemo(() => sortAccountsByOrder(data.accounts), [data.accounts]);

  const value = {
    data,
    settings: data.settings,
    accounts: orderedAccounts,
    categories: data.categories,
    transactions: data.transactions,
    recurringRules: data.recurringRules,
    recurringExceptions: data.recurringExceptions,
    corrections: data.corrections,
    marketValueSnapshots: data.marketValueSnapshots,
    investmentFees: data.investmentFees || [],

    today: todayStr,
    currentPeriod: periodForecast.currentPeriod,
    selectedPeriod: periodForecast.selectedPeriod,
    setSelectedPeriod: periodForecast.setSelectedPeriod,
    periodRanges: periodForecast.periodRanges,
    setPeriodRange: periodForecast.setPeriodRange,
    goToNextPeriod: periodForecast.goToNextPeriod,
    goToPreviousPeriod: periodForecast.goToPreviousPeriod,
    goToCurrentPeriod: periodForecast.goToCurrentPeriod,
    isCurrentPeriodSelected: periodForecast.isCurrentPeriodSelected,
    forecastSequence: periodForecast.forecastSequence,
    forecast,
    quickOverview,

    toasts,
    showToast,
    removeToast,

    addTransaction,
    updateTransaction,
    deleteTransaction,
    restoreDeletedTransaction,
    setTransactionStatus,
    markTransactionExecuted,
    cancelTransaction,
    reorderDayTransactions,
    checkDueTransactions: runAutoExecute,

    addRecurringRule,
    updateRecurringRule,
    deleteRecurringRule,
    reorderRecurringItem,

    addAccount,
    updateAccount,
    archiveAccount,
    restoreAccount,
    deleteAccount,
    reorderAccounts,
    reconcileBalance,
    updateMarketValue,
    editMarketValue,
    deleteMarketValue,
    saveInvestmentFee,
    deleteInvestmentFee,
    updateCorrectionNote,
    deleteCorrection,
    dataConflicts,

    addCategory,
    addMainCategory,
    updateCategory,
    moveSubcategory,
    archiveCategory,
    restoreCategory,
    deleteCategory,

    // Stav načtení a obnova dat
    loadState,
    loadErrorDetails,
    restoreFromBackupFile,
    reloadFromDrive,
    retryLoadData,
    clearAllTransactions,
    clearAllAccounts,
    clearAllCategories,
    resetAllData,
    updateSettings,
    loadDemoData,
    exportJSON,
    importJSON,
    exportCSV,

    // Google Drive
    driveSyncStatus: session.driveSyncStatus,
    isCloudReady: session.isCloudReady,
    isDriveConnected: session.isDriveConnected,
    driveUser: session.driveUser,
    lastDriveSyncTime: session.lastDriveSyncTime,
    driveError: session.driveError,
    connectGoogleDrive: session.connectGoogleDrive,
    disconnectGoogleDrive: session.disconnectGoogleDrive,
    syncWithGoogleDrive: session.syncWithGoogleDrive,
    driveBackupEnabled: session.driveBackupEnabled,
    setDriveBackupEnabled: session.setDriveBackupEnabled,
    lastDriveBackupTime: session.lastDriveBackupTime,
    runDriveBackupNow: session.runDriveBackupNow,
  };

  return <FinanceContext.Provider value={value}>{children}</FinanceContext.Provider>;
};

export function useFinance(): FinanceContextType {
  const ctx = useContext(FinanceContext);
  if (!ctx) {
    throw new Error('useFinance must be used within FinanceProvider');
  }
  return ctx;
}
