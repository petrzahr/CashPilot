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
import type { GoogleUser } from '../services/googleDriveService';


import {
  CommandContext,
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
  saveInvestmentFee as saveInvestmentFeeCommand,
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
import {
  ActionResult,
  CommandFeedback,
  DELETE_TRANSACTION_FAILED,
  DEMO_MODE_ONLY,
  EXPORT_CSV_DONE,
  EXPORT_JSON_DONE,
  FeedbackToast,
  RECOVERY_BACKUP_FAILED,
  addAccountFeedback,
  addCategoryFeedback,
  addRecurringRuleFeedback,
  addTransactionFeedback,
  archiveAccountFeedback,
  archiveCategoryFeedback,
  clearAllAccountsFeedback,
  clearAllCategoriesFeedback,
  clearAllTransactionsFeedback,
  deleteAccountFeedback,
  deleteCategoryFeedback,
  deleteCorrectionFeedback,
  deleteInvestmentFeeFeedback,
  deleteMarketValueFeedback,
  deleteRecurringRuleFeedback,
  deleteTransactionFeedback,
  editMarketValueFeedback,
  importBackupFailed,
  importBackupFeedback,
  loadDemoDataFeedback,
  moveSubcategoryFeedback,
  reconcileBalanceFeedback,
  reorderDayTransactionsFeedback,
  reorderRecurringItemFeedback,
  resetAllDataFeedback,
  restoreAccountFeedback,
  restoreCategoryFeedback,
  restoreFromBackupToast,
  saveInvestmentFeeFeedback,
  setTransactionStatusFeedback,
  updateAccountFeedback,
  updateCategoryFeedback,
  updateCorrectionNoteFeedback,
  updateMarketValueFeedback,
  updateRecurringRuleFeedback,
  updateSettingsFeedback,
  updateTransactionFeedback,
} from '../services/commandFeedback';
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

  // Transakce a pořadí (každá akce vrací ActionResult a nikdy nevyhazuje)
  addTransaction: (tx: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) => ActionResult<Transaction>;
  updateTransaction: (tx: Transaction) => ActionResult;
  deleteTransaction: (
    id: string,
    recurringMode?: 'occurrence' | 'future' | 'series',
    deleteHistoricalExecuted?: boolean
  ) => ActionResult;
  setTransactionStatus: (
    id: string,
    newStatus: TransactionStatus,
    updates?: { actualAmountInHaler?: number; date?: string; sourceAccountId?: string; categoryId?: string }
  ) => ActionResult;
  markTransactionExecuted: (id: string, updates?: { actualAmountInHaler?: number; date?: string; sourceAccountId?: string; categoryId?: string }) => ActionResult;
  cancelTransaction: (id: string) => ActionResult;
  reorderDayTransactions: (date: string, orderedIds: string[]) => ActionResult;
  checkDueTransactions: () => void;

  addRecurringRule: (
    rule: Omit<RecurringRule, 'id' | 'createdAt' | 'updatedAt'>,
    initialSequence?: number,
    initialStatus?: TransactionStatus,
    existingTransactionId?: string
  ) => ActionResult<RecurringRule>;
  updateRecurringRule: (
    ruleId: string,
    mode: 'occurrence' | 'future' | 'series',
    periodKey: string,
    overrideData: Partial<Transaction>,
    originalTransactionId?: string,
    placement?: DayPlacement
  ) => ActionResult;
  deleteRecurringRule: (id: string) => ActionResult;
  reorderRecurringItem: (
    ruleId: string,
    mode: 'occurrence' | 'future' | 'series',
    date: string,
    periodKey: string,
    orderedIds: string[],
    movedTransactionId: string
  ) => ActionResult;

  // Účty
  addAccount: (account: Omit<Account, 'id' | 'createdAt' | 'updatedAt'>) => ActionResult<Account>;
  updateAccount: (account: Account) => ActionResult;
  archiveAccount: (id: string) => ActionResult;
  restoreAccount: (id: string) => ActionResult;
  deleteAccount: (id: string) => ActionResult;
  reorderAccounts: (orderedIds: string[]) => ActionResult;
  reconcileBalance: (accountId: string, actualBalanceInHaler: number, checkDate: string, note?: string) => ActionResult;
  updateMarketValue: (accountId: string, marketValueInHaler: number, date?: string, note?: string) => ActionResult;
  updateCorrectionNote: (id: string, note: string) => ActionResult;
  editMarketValue: (id: string, edit: MarketValueEdit) => ActionResult;
  deleteMarketValue: (id: string) => ActionResult;
  saveInvestmentFee: (accountId: string, periodKey: string, amountInHaler: number, note?: string) => ActionResult;
  deleteInvestmentFee: (id: string) => ActionResult;
  deleteCorrection: (id: string) => ActionResult;
  dataConflicts: { transaction: Transaction; account: Account; reason: string }[];

  // Kategorie
  addCategory: (cat: Omit<Category, 'id' | 'createdAt' | 'updatedAt'>) => ActionResult<Category>;
  addMainCategory: (cat: Omit<Category, 'id' | 'createdAt' | 'updatedAt'>) => ActionResult<Category>;
  updateCategory: (cat: Category) => ActionResult;
  moveSubcategory: (subcategoryId: string, newParentId: string, updateHistorical: boolean) => ActionResult;
  archiveCategory: (id: string) => ActionResult;
  restoreCategory: (id: string) => ActionResult;
  deleteCategory: (id: string) => ActionResult;

  // Stav načtení a obnova dat
  loadState: AppLoadState;
  loadErrorDetails: { message: string; recoveryKey?: string; corruptedRaw?: string } | null;
  /** Neplatný soubor vrací 'rejected' hned, ještě než se cokoli smaže. */
  restoreFromBackupFile: (jsonStr: string) => Promise<ActionResult>;
  reloadFromDrive: () => void;
  retryLoadData: () => void;

  // Nastavení & Správa dat
  clearAllTransactions: () => ActionResult;
  clearAllAccounts: () => ActionResult;
  clearAllCategories: () => ActionResult;
  resetAllData: () => ActionResult;
  updateSettings: (newSettings: Partial<AppSettings>) => ActionResult;
  loadDemoData: () => Promise<ActionResult>;
  exportJSON: () => void;
  importJSON: (jsonStr: string) => ActionResult;
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

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Outcome příkazu, který akci neodmítl (bez větve { error }). */
type Accepted<O> = Exclude<O, { error: string }>;

interface PerformOptions<O, V> {
  /** Tichý zápis (automatické provedení, oprava dat): neuložená změna se neoznamuje. */
  silent?: boolean;
  /** Úplný reset dat (resetAllData); viz SyncController.change. */
  reset?: boolean;
  /** Dnešek pro příkaz; jinak dnešek z kontextu. */
  today?: string;
  /** Oznámení, když selže zápis do úložiště (jinak ho hlásí jen stav synchronizace). */
  failed?: FeedbackToast | ((message: string) => FeedbackToast);
  /** Hodnota úspěšné akce z outcome příkazu. */
  value?: (outcome: Accepted<O>) => V;
}

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

  // Dnešek, období, rozsahy obrazovek a předpověď
  const periodForecast = usePeriodForecast(data);
  const { today: todayStr, setToday: setTodayStr, forecast } = periodForecast;
  // Dnešek v okamžiku spuštění příkazu (i u „Vrátit“ kliknutého později)
  const todayRef = useRef(todayStr);
  todayRef.current = todayStr;

  /**
   * Spustí čistý příkaz nad aktuálními daty (SyncController volá updater synchronně), zapíše
   * výsledek přes session.change a ukáže oznámení z command feedbacku, případně s „Vrátit“,
   * které běží stejnou cestou. Nikdy nevyhazuje: neuložená změna vrací 'not-saved' (mimo tichý
   * režim s oznámením NOT_SAVED_MESSAGE), odmítnutí příkazem vrací 'rejected'.
   */
  const perform = useCallback(function perform<O, V = undefined>(
    command: (prev: AppData, ctx: CommandContext) => CommandResult<O>,
    feedback?: (outcome: O) => CommandFeedback,
    options: PerformOptions<O, V> = {}
  ): ActionResult<V> {
    const ctx = createCommandContext(options.today ?? todayRef.current);
    let outcome!: O;
    let ran = false;
    let saved: boolean;
    try {
      saved = sessionChange(prev => {
        const result = command(prev, ctx);
        outcome = result.outcome;
        ran = true;
        return result.data;
      }, options.reset);
    } catch (err) {
      // Zápis do úložiště selhal ještě před zveřejněním změny; chybu už hlásí stav synchronizace
      const message = err instanceof Error && err.message ? err.message : NOT_SAVED_MESSAGE;
      const failed = typeof options.failed === 'function' ? options.failed(message) : options.failed;
      if (failed) showToast(failed.text, failed.type);
      return { ok: false, reason: 'not-saved', message };
    }
    if (!saved || !ran) {
      if (!options.silent) showToast(NOT_SAVED_MESSAGE, 'error');
      return { ok: false, reason: 'not-saved', message: NOT_SAVED_MESSAGE };
    }

    const result = feedback ? feedback(outcome) : {};
    const { toast, undo } = result;
    if (toast) {
      showToast(toast.text, toast.type, undo ? {
        label: 'Vrátit',
        onClick: () => { perform(undo.command, () => ({ toast: undo.toast })); },
      } : undefined);
    }
    if (result.rejected !== undefined) return { ok: false, reason: 'rejected', message: result.rejected };
    return { ok: true, value: options.value ? options.value(outcome as Accepted<O>) : (undefined as V) };
  }, [sessionChange, showToast]);

  const runAutoExecute = useCallback((customToday?: string) => {
    const currentToday = customToday || getTodayInPrague();
    setTodayStr(currentToday);
    return perform(autoExecuteCommand, undefined, { silent: true, today: currentToday });
  }, [perform]);

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
    const result = perform(repairRecurringRulesCommand, undefined, { silent: true, value: o => o.fixedCount });
    if (result.ok && result.value > 0) {
      console.info(`[CashPilot] Opraveno ${result.value} pravidel s překryvem endDate/startDate po rozštěpení série.`);
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
    return perform((prev, ctx) => addTransactionCommand(prev, txData, ctx), addTransactionFeedback, { value: o => o.transaction });
  }, [perform]);

  const updateTransaction = useCallback((updatedTx: Transaction) => {
    return perform((prev, ctx) => updateTransactionCommand(prev, updatedTx, ctx), updateTransactionFeedback);
  }, [perform]);

  const reorderDayTransactions = useCallback((date: string, orderedIds: string[]) => {
    return perform((prev, ctx) => reorderDayTransactionsCommand(prev, { date, orderedIds }, ctx), reorderDayTransactionsFeedback);
  }, [perform]);

  const deleteTransaction = useCallback((
    id: string,
    recurringMode: RecurringMode = 'occurrence',
    deleteHistoricalExecuted: boolean = false
  ) => {
    return perform(
      (prev, ctx) => deleteTransactionCommand(prev, { id, mode: recurringMode, deleteHistoricalExecuted }, ctx),
      outcome => deleteTransactionFeedback(outcome, { mode: recurringMode }),
      { failed: DELETE_TRANSACTION_FAILED }
    );
  }, [perform]);

  const setTransactionStatus = useCallback((
    id: string,
    newStatus: TransactionStatus,
    updates?: StatusUpdates
  ) => {
    return perform(
      (prev, ctx) => setTransactionStatusCommand(prev, { id, status: newStatus, updates }, ctx),
      outcome => setTransactionStatusFeedback(outcome, { status: newStatus })
    );
  }, [perform]);

  const markTransactionExecuted = useCallback((
    id: string,
    updates?: StatusUpdates
  ) => {
    return setTransactionStatus(id, 'executed', updates);
  }, [setTransactionStatus]);

  const cancelTransaction = useCallback((id: string) => {
    return setTransactionStatus(id, 'cancelled');
  }, [setTransactionStatus]);

  // ------------------- PRAVIDELNÉ POLOŽKY -------------------

  const addRecurringRule = useCallback((
    ruleData: Omit<RecurringRule, 'id' | 'createdAt' | 'updatedAt'>,
    initialSequence?: number,
    initialStatus?: TransactionStatus,
    existingTransactionId?: string
  ) => {
    return perform(
      (prev, ctx) => addRecurringRuleCommand(prev, { ruleData, initialSequence, initialStatus, existingTransactionId }, ctx),
      addRecurringRuleFeedback,
      { today: getTodayInPrague(), value: o => o.rule }
    );
  }, [perform]);

  const updateRecurringRule = useCallback((
    ruleId: string,
    mode: RecurringMode,
    periodKey: string,
    overrideData: Partial<Transaction>,
    originalTransactionId?: string,
    placement?: DayPlacement
  ) => {
    return perform(
      (prev, ctx) => updateRecurringRuleCommand(prev, { ruleId, mode, periodKey, overrideData, originalTransactionId, placement }, ctx),
      updateRecurringRuleFeedback
    );
  }, [perform]);

  const reorderRecurringItem = useCallback((
    ruleId: string,
    mode: RecurringMode,
    date: string,
    periodKey: string,
    orderedIds: string[],
    movedTransactionId: string
  ) => {
    return perform(
      (prev, ctx) => reorderRecurringItemCommand(prev, { ruleId, mode, date, periodKey, orderedIds, movedTransactionId }, ctx),
      reorderRecurringItemFeedback
    );
  }, [perform]);

  const deleteRecurringRule = useCallback((id: string) => {
    return perform(prev => deleteRecurringRuleCommand(prev, id), deleteRecurringRuleFeedback);
  }, [perform]);

  // ------------------- SPRÁVA ÚČTŮ -------------------

  const addAccount = useCallback((accData: Omit<Account, 'id' | 'createdAt' | 'updatedAt'>) => {
    return perform((prev, ctx) => addAccountCommand(prev, accData, ctx), addAccountFeedback, { value: o => o.account });
  }, [perform]);

  const updateAccount = useCallback((acc: Account) => {
    return perform((prev, ctx) => updateAccountCommand(prev, acc, ctx), outcome => updateAccountFeedback(outcome, { account: acc }));
  }, [perform]);

  const archiveAccount = useCallback((id: string) => {
    return perform((prev, ctx) => archiveAccountCommand(prev, id, ctx), archiveAccountFeedback);
  }, [perform]);

  const restoreAccount = useCallback((id: string) => {
    return perform((prev, ctx) => restoreAccountCommand(prev, id, ctx), restoreAccountFeedback);
  }, [perform]);

  const deleteAccount = useCallback((id: string) => {
    return perform(prev => deleteAccountCommand(prev, id), deleteAccountFeedback);
  }, [perform]);

  const reorderAccounts = useCallback((orderedIds: string[]) => {
    return perform(prev => reorderAccountsCommand(prev, orderedIds));
  }, [perform]);

  const reconcileBalance = useCallback((
    accountId: string,
    actualBalanceInHaler: number,
    checkDate: string,
    note?: string
  ) => {
    return perform(
      (prev, ctx) => reconcileBalanceCommand(prev, { accountId, actualBalanceInHaler, checkDate, note }, ctx),
      reconcileBalanceFeedback
    );
  }, [perform]);

  const updateMarketValue = useCallback((
    accountId: string,
    marketValueInHaler: number,
    date?: string,
    note?: string
  ) => {
    return perform(
      (prev, ctx) => addMarketValueCommand(prev, { accountId, marketValueInHaler, date, note }, ctx),
      updateMarketValueFeedback,
      { today: getTodayInPrague() }
    );
  }, [perform]);

  const editMarketValue = useCallback((id: string, edit: MarketValueEdit) => {
    return perform(prev => editMarketValueCommand(prev, { id, edit }), outcome => editMarketValueFeedback(outcome, { edit }));
  }, [perform]);

  const deleteMarketValue = useCallback((id: string) => {
    return perform(prev => deleteMarketValueCommand(prev, id), deleteMarketValueFeedback);
  }, [perform]);

  const saveInvestmentFee = useCallback((accountId: string, periodKey: string, amountInHaler: number, note?: string) => {
    return perform(
      (prev, ctx) => saveInvestmentFeeCommand(prev, { accountId, periodKey, amountInHaler, note }, ctx),
      saveInvestmentFeeFeedback
    );
  }, [perform]);

  const deleteInvestmentFee = useCallback((id: string) => {
    return perform(prev => deleteInvestmentFeeCommand(prev, id), deleteInvestmentFeeFeedback);
  }, [perform]);

  const updateCorrectionNote = useCallback((id: string, note: string) => {
    return perform((prev, ctx) => updateCorrectionNoteCommand(prev, { id, note }, ctx), updateCorrectionNoteFeedback);
  }, [perform]);

  const deleteCorrection = useCallback((id: string) => {
    // Korekce uložená i jako položka seznamu se maže jako položka (s „Vrátit“ pro obojí)
    if (latestDataRef.current.transactions.some(t => t.id === id)) {
      return deleteTransaction(id);
    }
    return perform(prev => deleteStandaloneCorrectionCommand(prev, id), deleteCorrectionFeedback);
  }, [perform, deleteTransaction]);

  // ------------------- SPRÁVA KATEGORIÍ -------------------

  const addCategory = useCallback((catData: Omit<Category, 'id' | 'createdAt' | 'updatedAt'>) => {
    return perform((prev, ctx) => addCategoryCommand(prev, catData, ctx), addCategoryFeedback, { value: o => o.category });
  }, [perform]);

  const addMainCategory = useCallback((catData: Omit<Category, 'id' | 'createdAt' | 'updatedAt'>) => {
    return perform((prev, ctx) => addMainCategoryCommand(prev, catData, ctx), addCategoryFeedback, { value: o => o.category });
  }, [perform]);

  const updateCategory = useCallback((cat: Category) => {
    return perform((prev, ctx) => updateCategoryCommand(prev, cat, ctx), outcome => updateCategoryFeedback(outcome, { category: cat }));
  }, [perform]);

  const moveSubcategory = useCallback((subcategoryId: string, newParentId: string, updateHistorical: boolean) => {
    return perform(
      (prev, ctx) => moveSubcategoryCommand(prev, { subcategoryId, newParentId, updateHistorical }, ctx),
      moveSubcategoryFeedback
    );
  }, [perform]);

  const archiveCategory = useCallback((id: string) => {
    return perform((prev, ctx) => archiveCategoryCommand(prev, id, ctx), archiveCategoryFeedback);
  }, [perform]);

  const restoreCategory = useCallback((id: string) => {
    return perform((prev, ctx) => restoreCategoryCommand(prev, id, ctx), restoreCategoryFeedback);
  }, [perform]);

  const deleteCategory = useCallback((id: string) => {
    return perform(prev => deleteCategoryCommand(prev, id), deleteCategoryFeedback);
  }, [perform]);

  // ------------------- NASTAVENÍ A DATA -------------------

  const updateSettings = useCallback((newSettings: Partial<AppSettings>) => {
    return perform(prev => updateSettingsCommand(prev, newSettings), updateSettingsFeedback);
  }, [perform]);

  const loadDemoData = useCallback(async (): Promise<ActionResult> => {
    if (!isDemoModeEnabled()) {
      showToast(DEMO_MODE_ONLY.text, DEMO_MODE_ONLY.type);
      return { ok: false, reason: 'rejected', message: DEMO_MODE_ONLY.text };
    }
    const { DEMO_ACCOUNTS, DEMO_RECURRING_RULES, DEMO_TRANSACTIONS } = await import('../fixtures/demoData');
    const demo = { accounts: DEMO_ACCOUNTS, recurringRules: DEMO_RECURRING_RULES, transactions: DEMO_TRANSACTIONS };
    return perform(prev => replaceWithDemoDataCommand(prev, demo), loadDemoDataFeedback);
  }, [perform, showToast]);

  // Hromadné smazání: nejdřív interní pojistná kopie; když se neuloží, nic se nesmaže
  const performWithRecoveryBackup = useCallback((
    operation: Parameters<typeof createOperationRecoveryBackup>[1],
    command: (prev: AppData) => CommandResult<null>,
    feedback: () => CommandFeedback,
    options: { reset?: boolean } = {}
  ): ActionResult => {
    if (!createOperationRecoveryBackup(latestDataRef.current, operation)) {
      showToast(RECOVERY_BACKUP_FAILED.text, RECOVERY_BACKUP_FAILED.type);
      return { ok: false, reason: 'rejected', message: RECOVERY_BACKUP_FAILED.text };
    }
    return perform(command, feedback, options);
  }, [perform, showToast]);

  const clearAllTransactions = useCallback((): ActionResult => {
    return performWithRecoveryBackup('clear_transactions', clearAllTransactionsCommand, clearAllTransactionsFeedback);
  }, [performWithRecoveryBackup]);

  const clearAllAccounts = useCallback((): ActionResult => {
    return performWithRecoveryBackup('clear_accounts', clearAllAccountsCommand, clearAllAccountsFeedback);
  }, [performWithRecoveryBackup]);

  const clearAllCategories = useCallback((): ActionResult => {
    return performWithRecoveryBackup('clear_categories', clearAllCategoriesCommand, clearAllCategoriesFeedback);
  }, [performWithRecoveryBackup]);

  const resetAllData = useCallback((): ActionResult => {
    return performWithRecoveryBackup('clear_all', resetAllDataCommand, resetAllDataFeedback, { reset: true });
  }, [performWithRecoveryBackup]);

  // Obnova z obrazovky chyby načtení: poškozená je jen lokální obálka, data na Google Disku
  // se nikdy neresetují. Relace se načte z Disku a výsledek přijde přes onData.
  const discardCorruptedCache = session.discardCorruptedCache;
  const reloadFromDrive = useCallback(() => {
    void discardCorruptedCache();
  }, [discardCorruptedCache]);

  // Neplatný soubor se odmítne dřív, než se cokoli smaže
  const restoreFromBackupFile = useCallback(async (jsonStr: string): Promise<ActionResult> => {
    let parsed: AppData;
    try {
      parsed = validateAndParseBackup(jsonStr);
    } catch (err) {
      return { ok: false, reason: 'rejected', message: errorMessage(err) };
    }
    const notMerged = restoreFromBackupToast(false);
    const result = await discardCorruptedCache();
    // Důvod odmítnutí už oznámila relace
    if (result === 'refused') return { ok: false, reason: 'not-saved', message: notMerged.text };
    // Chybu zápisu už hlásí stav synchronizace; záloha se jen nesloučí
    const merged = result === 'ready' && perform(prev => importBackupCommand(prev, parsed), undefined, { silent: true }).ok;
    const toast = restoreFromBackupToast(merged);
    showToast(toast.text, toast.type);
    return merged ? { ok: true, value: undefined } : { ok: false, reason: 'not-saved', message: notMerged.text };
  }, [discardCorruptedCache, perform, showToast]);

  // Znovu založí relaci: obálku účtu načte SyncController, výsledek přijde přes onData nebo onLoadError
  const retrySession = session.syncWithGoogleDrive;
  const retryLoadData = useCallback(() => {
    void retrySession();
  }, [retrySession]);

  const exportJSON = useCallback(() => {
    exportBackupJSON(data);
    showToast(EXPORT_JSON_DONE.text, EXPORT_JSON_DONE.type);
  }, [data, showToast]);

  const importJSON = useCallback((jsonStr: string): ActionResult => {
    let parsed: AppData;
    try {
      parsed = validateAndParseBackup(jsonStr);
    } catch (err) {
      const toast = importBackupFailed(errorMessage(err));
      showToast(toast.text, toast.type);
      return { ok: false, reason: 'rejected', message: toast.text };
    }
    // Slučuje se s aktuálními daty v controlleru, nikdy se starší kopií z tohoto renderu
    return perform(prev => importBackupCommand(prev, parsed), importBackupFeedback, { failed: importBackupFailed });
  }, [perform, showToast]);

  const exportCSV = useCallback(() => {
    exportTransactionsCSV(data.transactions, data.accounts, data.categories);
    showToast(EXPORT_CSV_DONE.text, EXPORT_CSV_DONE.type);
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
