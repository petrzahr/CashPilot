import { accountStorageKey, mergeBackupData } from '../services/syncModel';
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
  RecurringException,
  RecurringRule,
  Transaction,
  TransactionStatus
} from '../types/finance';
import {
  AppData,
  getInitialData,
  loadStoredDataResult,
  exportBackupJSON,
  validateAndParseBackup,
  exportTransactionsCSV,
  setActiveStorageKey,
  STORAGE_KEY_PRODUCTION,
  isDemoModeEnabled,
  createOperationRecoveryBackup,
  repairRecurringRuleSplitOverlaps,
} from '../services/storageService';
import {
  DEFAULT_CATEGORIES,
  DEFAULT_SETTINGS,
  createEmptyAppData,
  createResetAppData,
} from '../constants/defaultData';
import {
  calculateForecast,
  calculateQuickFinancialOverview,
  QuickFinancialOverview,
} from '../services/financialEngine';
import {
  createBudgetPeriod,
  generatePeriodsSequence,
  generatePeriodsBetween,
  getOverviewPeriods,
  getNextPeriod,
  getPeriodForDate,
  getPreviousPeriod,
  getTodayInPrague,
  formatCzechDate
} from '../services/periodService';
import { applyAccountOrder, sortAccountsByOrder } from '../services/accountService';
import { mutateMarketValueHistory, MarketValueEdit } from '../services/marketValueHistoryService';
import { autoExecuteDueTransactions, getStatusForDate } from '../services/statusService';
import { formatCurrency } from '../services/currencyService';
import { describeSyncError } from '../services/syncErrorText';
import {
  GoogleUser,
  fetchGoogleUserProfile,
  getValidAccessToken,
  isStoredTokenValid,
  loginToGoogle,
  logoutFromGoogle,
} from '../services/googleDriveService';
import {
  getLastDriveBackupAt,
  isDriveBackupEnabled,
  setDriveBackupEnabled as persistDriveBackupEnabled,
  tryRunDriveBackup,
} from '../services/driveBackupService';


import {
  getNextSequenceForDate,
  insertOrUpdateWithSequence,
  reorderDayTransactions as reorderDayTxsService,
  applyRuleRankOrder,
  sortTransactionsByDateAndSequence
} from '../services/sequenceService';
import {
  CommandResult,
  RecurringMode,
  StatusUpdates,
  createCommandContext,
  parseVirtualId,
  withSequenceExceptions,
  addRecurringRule as addRecurringRuleCommand,
  deleteRecurringRule as deleteRecurringRuleCommand,
  deleteTransaction as deleteTransactionCommand,
  reorderRecurringItem as reorderRecurringItemCommand,
  restoreDeletedTransaction as restoreDeletedTransactionCommand,
  setTransactionStatus as setTransactionStatusCommand,
  updateRecurringRule as updateRecurringRuleCommand,
} from '../services/transactionCommands';
import {
  addAccount as addAccountCommand,
  addMarketValue as addMarketValueCommand,
  archiveAccount as archiveAccountCommand,
  deleteAccount as deleteAccountCommand,
  deleteInvestmentFee as deleteInvestmentFeeCommand,
  deleteMarketValue as deleteMarketValueCommand,
  deleteStandaloneCorrection as deleteStandaloneCorrectionCommand,
  reconcileBalance as reconcileBalanceCommand,
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
  currentPeriod: BudgetPeriod;
  selectedPeriod: BudgetPeriod;
  setSelectedPeriod: (p: BudgetPeriod) => void;
  setOverviewPeriodBounds: (bounds: BudgetPeriod[] | null) => void;
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
    originalTransactionId?: string
  ) => string | undefined; // mode 'future': ID nové (odštěpené) větve pravidla
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
  resetToFreshData: () => void;
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
  const controllerRef = useRef<SyncController | null>(syncSession || null);
  const authGeneration = useRef(0);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const setData = useCallback((action: React.SetStateAction<AppData>) => {
    controllerRef.current?.change(action);
  }, []);

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

  const [todayStr, setTodayStr] = useState<string>(() => getTodayInPrague());

  const runAutoExecute = useCallback((customToday?: string) => {
    const currentToday = customToday || getTodayInPrague();
    setTodayStr(currentToday);
    setData(prev => {
      const { transactions, hasChanges } = autoExecuteDueTransactions(
        prev.transactions,
        prev.recurringRules,
        prev.recurringExceptions,
        prev.settings.budgetStartDay,
        currentToday
      );
      if (!hasChanges) return prev;
      return {
        ...prev,
        transactions,
      };
    });
  }, []);

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
    setData(prev => {
      const { rules, fixedCount } = repairRecurringRuleSplitOverlaps(prev.recurringRules);
      if (fixedCount === 0) return prev;
      console.info(`[CashPilot] Opraveno ${fixedCount} pravidel s překryvem endDate/startDate po rozštěpení série.`);
      return { ...prev, recurringRules: rules };
    });
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

  const currentPeriod = useMemo(() => {
    return getPeriodForDate(todayStr, data.settings.budgetStartDay);
  }, [todayStr, data.settings.budgetStartDay]);

  const [overviewPeriodBounds, setOverviewPeriodBounds] = useState<BudgetPeriod[] | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<BudgetPeriod>(() => currentPeriod);

  useEffect(() => {
    setSelectedPeriod(prev => createBudgetPeriod(prev.year, prev.month, data.settings.budgetStartDay));
  }, [data.settings.budgetStartDay]);

  const goToNextPeriod = useCallback(() => {
    setSelectedPeriod(prev => getNextPeriod(prev, data.settings.budgetStartDay));
  }, [data.settings.budgetStartDay]);

  const goToPreviousPeriod = useCallback(() => {
    setSelectedPeriod(prev => getPreviousPeriod(prev, data.settings.budgetStartDay));
  }, [data.settings.budgetStartDay]);

  const goToCurrentPeriod = useCallback(() => {
    const liveToday = getTodayInPrague();
    setTodayStr(liveToday);
    const liveCurrentPeriod = getPeriodForDate(liveToday, data.settings.budgetStartDay);
    setSelectedPeriod(liveCurrentPeriod);
  }, [data.settings.budgetStartDay]);

  const isCurrentPeriodSelected = useMemo(() => {
    return selectedPeriod.startDate === currentPeriod.startDate && selectedPeriod.endDate === currentPeriod.endDate;
  }, [selectedPeriod.startDate, selectedPeriod.endDate, currentPeriod.startDate, currentPeriod.endDate]);

  // Rozsah období podle dat - nezávisí na vybraném období, aby přepnutí měsíce nepřepočítávalo celou předpověď
  const dataPeriodBounds = useMemo(() => {
    const startDay = data.settings.budgetStartDay || 15;
    const forecastMonths = 12;

    const baseForecastPeriods = generatePeriodsSequence(
      currentPeriod.year,
      currentPeriod.month,
      forecastMonths,
      startDay
    );
    const lastForecastPeriod = baseForecastPeriods[baseForecastPeriods.length - 1];

    // Include every historical preset even when there are no recorded movements.
    let earliestPeriod = getOverviewPeriods(currentPeriod, { direction: 'past', months: 12 }, startDay)[0];
    let latestPeriod = lastForecastPeriod;

    for (const period of overviewPeriodBounds || []) {
      if (period.key < earliestPeriod.key) earliestPeriod = period;
      if (period.key > latestPeriod.key) latestPeriod = period;
    }

    // Období na sebe navazují, takže pozdější datum nikdy nepatří do dřívějšího období. Stačí proto
    // najít nejmenší a největší datum a období spočítat jen pro ně (ne pro každou položku zvlášť).
    const dates: { min: string | null; max: string | null } = { min: null, max: null };
    const consider = (date: string | undefined, extendsEnd: boolean) => {
      if (!date) return;
      if (dates.min === null || date < dates.min) dates.min = date;
      if (extendsEnd && (dates.max === null || date > dates.max)) dates.max = date;
    };
    for (const tx of data.transactions) consider(tx.date, true);
    for (const c of data.corrections) consider(c.checkDate, true);
    for (const s of data.marketValueSnapshots) consider(s.date, true);
    for (const r of data.recurringRules) consider(r.startDate, false);
    for (const a of data.accounts) consider(a.initialBalanceDate, false);

    if (dates.min !== null) {
      const p = getPeriodForDate(dates.min, startDay);
      if (p.startDate < earliestPeriod.startDate) earliestPeriod = p;
    }
    if (dates.max !== null) {
      const p = getPeriodForDate(dates.max, startDay);
      if (p.startDate > latestPeriod.startDate) latestPeriod = p;
    }

    return { earliestPeriod, latestPeriod };
  }, [
    currentPeriod,
    overviewPeriodBounds,
    data.transactions,
    data.corrections,
    data.marketValueSnapshots,
    data.recurringRules,
    data.accounts,
    data.settings.budgetStartDay
  ]);

  // Vybrané období rozšiřuje rozsah jen tehdy, když leží mimo něj; sekvence se mění jen se změnou hranic
  const rangeStart = selectedPeriod.startDate < dataPeriodBounds.earliestPeriod.startDate ? selectedPeriod : dataPeriodBounds.earliestPeriod;
  const rangeEnd = selectedPeriod.startDate > dataPeriodBounds.latestPeriod.startDate ? selectedPeriod : dataPeriodBounds.latestPeriod;
  const allPeriodsSequence = useMemo(
    () => generatePeriodsBetween(rangeStart, rangeEnd, data.settings.budgetStartDay || 15),
    // Období je plně určeno svými hranicemi, proto stačí závislost na datech hranic
    [rangeStart.startDate, rangeStart.endDate, rangeEnd.startDate, rangeEnd.endDate, data.settings.budgetStartDay]
  );

  const forecast = useMemo(() => {
    return calculateForecast(
      allPeriodsSequence,
      data.accounts,
      data.transactions,
      data.recurringRules,
      data.recurringExceptions,
      data.corrections,
      data.settings,
      data.marketValueSnapshots,
      currentPeriod.key,
      todayStr,
      data.investmentFees
    );
  }, [
    allPeriodsSequence,
    data.accounts,
    data.transactions,
    data.recurringRules,
    data.recurringExceptions,
    data.corrections,
    data.settings,
    data.marketValueSnapshots,
    data.investmentFees,
    currentPeriod.key,
    todayStr
  ]);

  const forecastSequence = useMemo(() => {
    return forecast.forecastPeriods?.map(p => p.period) || generatePeriodsSequence(
      currentPeriod.year,
      currentPeriod.month,
      12,
      data.settings.budgetStartDay
    );
  }, [forecast.forecastPeriods, currentPeriod.year, currentPeriod.month, data.settings.budgetStartDay]);

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
    const srcAcc = data.accounts.find(a => a.id === txData.sourceAccountId);
    if (srcAcc?.initialBalanceDate && txData.date < srcAcc.initialBalanceDate) {
      const msg = `Tento účet je aktivní až od ${formatCzechDate(srcAcc.initialBalanceDate)}. Zvolte stejné nebo pozdější datum.`;
      showToast(msg, 'error');
      throw new Error(msg);
    }
    if (txData.type === 'transfer' && txData.targetAccountId) {
      const tgtAcc = data.accounts.find(a => a.id === txData.targetAccountId);
      if (tgtAcc?.initialBalanceDate && txData.date < tgtAcc.initialBalanceDate) {
        const msg = `Tento účet je aktivní až od ${formatCzechDate(tgtAcc.initialBalanceDate)}. Zvolte stejné nebo pozdější datum.`;
        showToast(msg, 'error');
        throw new Error(msg);
      }
    }

    const nowIso = new Date().toISOString();
    let assignedSeq = txData.sequence;
    if (!assignedSeq || assignedSeq <= 0) {
      assignedSeq = getNextSequenceForDate(txData.date, data.transactions);
    }

    const autoStatus = txData.status || getStatusForDate(txData.date);
    const actualAmountInHaler = autoStatus === 'executed'
      ? (txData.actualAmountInHaler !== undefined ? txData.actualAmountInHaler : (txData.plannedAmountInHaler ?? txData.amountInHaler))
      : undefined;

    const newTx: Transaction = {
      ...txData,
      sequence: assignedSeq,
      status: autoStatus,
      actualAmountInHaler,
      id: `tx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    setData(prev => {
      const updatedTxs = insertOrUpdateWithSequence(newTx, assignedSeq, prev.transactions);
      return {
        ...prev,
        transactions: updatedTxs,
      };
    });

    showToast(`Položka „${newTx.title}“ byla přidána jako ${assignedSeq}. v pořadí dne.`);
    return newTx;
  }, [data.transactions, data.accounts, showToast]);

  const updateTransaction = useCallback((updatedTx: Transaction) => {
    const srcAcc = data.accounts.find(a => a.id === updatedTx.sourceAccountId);
    if (srcAcc?.initialBalanceDate && updatedTx.date < srcAcc.initialBalanceDate) {
      const msg = `Tento účet je aktivní až od ${formatCzechDate(srcAcc.initialBalanceDate)}. Zvolte stejné nebo pozdější datum.`;
      showToast(msg, 'error');
      throw new Error(msg);
    }
    if (updatedTx.type === 'transfer' && updatedTx.targetAccountId) {
      const tgtAcc = data.accounts.find(a => a.id === updatedTx.targetAccountId);
      if (tgtAcc?.initialBalanceDate && updatedTx.date < tgtAcc.initialBalanceDate) {
        const msg = `Tento účet je aktivní až od ${formatCzechDate(tgtAcc.initialBalanceDate)}. Zvolte stejné nebo pozdější datum.`;
        showToast(msg, 'error');
        throw new Error(msg);
      }
    }

    setData(prev => {
      if (updatedTx.id.startsWith('virtual_')) {
        const withoutPrefix = updatedTx.id.slice('virtual_'.length);
        const lastUnderscore = withoutPrefix.lastIndexOf('_');
        const ruleId = lastUnderscore !== -1 ? withoutPrefix.slice(0, lastUnderscore) : updatedTx.recurringRuleId;
        const periodKey = lastUnderscore !== -1 ? withoutPrefix.slice(lastUnderscore + 1) : '';
        const assignedSeq = updatedTx.sequence || getNextSequenceForDate(updatedTx.date, prev.transactions);
        const nowIso = new Date().toISOString();
        const realTx: Transaction = {
          ...updatedTx,
          id: `tx_real_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          recurringRuleId: ruleId || updatedTx.recurringRuleId,
          sequence: assignedSeq,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        const cleanExceptions = prev.recurringExceptions.filter(
          e => !(e.ruleId === ruleId && e.periodKey === periodKey)
        );
        return {
          ...prev,
          recurringExceptions: cleanExceptions,
          transactions: insertOrUpdateWithSequence(realTx, assignedSeq, prev.transactions)
        };
      }

      const oldTx = prev.transactions.find(t => t.id === updatedTx.id);
      const oldDate = oldTx?.date;
      let targetSeq = updatedTx.sequence;

      // Pokud se změnilo datum položky a uživatel explicitně nezadal jiné pořadí
      if (oldTx && oldTx.date !== updatedTx.date && (!updatedTx.sequence || updatedTx.sequence === oldTx.sequence)) {
        targetSeq = getNextSequenceForDate(updatedTx.date, prev.transactions.filter(t => t.id !== updatedTx.id));
      }

      const txWithUpdatedTime = {
        ...updatedTx,
        sequence: targetSeq,
        updatedAt: new Date().toISOString()
      };

      const newTxs = insertOrUpdateWithSequence(txWithUpdatedTime, targetSeq, prev.transactions, oldDate);
      return {
        ...prev,
        transactions: newTxs
      };
    });
    showToast(`Položka „${updatedTx.title}“ byla upravena.`);
  }, [data.accounts, showToast]);

  const reorderDayTransactions = useCallback((date: string, orderedIds: string[]) => {
    setData(prev => {
      const updated = reorderDayTxsService(date, orderedIds, prev.transactions);
      // Virtuální (ještě nezhmotněné) opakované výskyty v pořadí si pamatují pozici přes
      // výjimku periody, jinak by se při dalším výpočtu vždy vrátily na konec dne.
      const virtualPositions = new Map<string, number>();
      orderedIds.forEach((id, idx) => {
        const ruleId = parseVirtualId(id)?.ruleId;
        if (ruleId && prev.recurringRules.some(r => r.id === ruleId)) virtualPositions.set(ruleId, idx + 1);
      });
      const recurringExceptions = virtualPositions.size > 0
        ? withSequenceExceptions(
            prev.recurringExceptions,
            virtualPositions,
            getPeriodForDate(date, prev.settings.budgetStartDay).key,
            new Date().toISOString()
          )
        : prev.recurringExceptions;
      return {
        ...prev,
        transactions: updated,
        recurringExceptions,
      };
    });
    showToast('Pořadí položek bylo uloženo.');
  }, [showToast]);

  // Spustí čistý příkaz nad aktuálními daty a vrátí jeho výsledek. SyncController volá
  // updater synchronně; bez načtených dat (před první synchronizací) vrací undefined.
  const runCommand = useCallback(<O,>(command: (prev: AppData) => CommandResult<O>): O | undefined => {
    let outcome: O | undefined;
    setData(prev => {
      const result = command(prev);
      outcome = result.outcome;
      return result.data;
    });
    return outcome;
  }, [setData]);

  // „Vrátit“ po smazání běžné položky: vrátí ji na původní místo v dni.
  const restoreDeletedTransaction = useCallback((tx: Transaction, correction?: BalanceCorrection) => {
    runCommand(prev => restoreDeletedTransactionCommand(prev, { transaction: tx, correction }, createCommandContext(todayStr)));
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
    if (!outcome) throw new Error('Data ještě nejsou načtená. Zkuste to prosím za chvíli znovu.');
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
    originalTransactionId?: string
  ): string | undefined => {
    const ctx = createCommandContext(todayStr);
    // ID nové větve se určí předem, aby ho volající znal - např. pro následné nastavení pořadí.
    const futureRuleId = mode === 'future' ? ctx.newId('rec', '_split') : undefined;
    const outcome = runCommand(prev => updateRecurringRuleCommand(
      prev,
      { ruleId, mode, periodKey, overrideData, originalTransactionId, futureRuleId },
      ctx
    ));

    const ruleTitle = outcome?.ruleTitle;
    showToast(ruleTitle ? `Pravidelná položka „${ruleTitle}“ byla upravena.` : 'Pravidelná položka byla upravena.');
    return futureRuleId;
  }, [runCommand, todayStr, showToast]);

  const reorderRecurringItem = useCallback((
    ruleId: string,
    mode: RecurringMode,
    date: string,
    periodKey: string,
    orderedIds: string[],
    movedTransactionId: string
  ) => {
    runCommand(prev => reorderRecurringItemCommand(
      prev,
      { ruleId, mode, date, periodKey, orderedIds, movedTransactionId },
      createCommandContext(todayStr)
    ));
    showToast('Pořadí pravidelné položky bylo uloženo.');
  }, [runCommand, todayStr, showToast]);

  const deleteRecurringRule = useCallback((id: string) => {
    const outcome = runCommand(prev => deleteRecurringRuleCommand(prev, id));
    const ruleTitle = outcome?.ruleTitle;
    showToast(ruleTitle ? `Pravidelná položka „${ruleTitle}“ byla smazána.` : 'Pravidelná položka byla smazána.');
  }, [runCommand, showToast]);

  // ------------------- SPRÁVA ÚČTŮ -------------------

  const addAccount = useCallback((accData: Omit<Account, 'id' | 'createdAt' | 'updatedAt'>) => {
    const outcome = runCommand(prev => addAccountCommand(prev, accData, createCommandContext(todayStr)));
    if (!outcome) {
      showToast('Data ještě nejsou načtená, účet nebyl vytvořen. Zkuste to prosím za chvíli znovu.', 'error');
      return undefined;
    }
    showToast(`Účet „${outcome.account.name}“ byl vytvořen.`);
    return outcome.account;
  }, [runCommand, todayStr, showToast]);

  const updateAccount = useCallback((acc: Account) => {
    const outcome = runCommand(prev => updateAccountCommand(prev, acc, createCommandContext(todayStr)));
    if (outcome && 'error' in outcome) {
      showToast(outcome.error, 'error');
      return { success: false, message: outcome.error };
    }
    showToast(`Účet „${acc.name}“ byl upraven.`);
    return { success: true };
  }, [runCommand, todayStr, showToast]);

  const archiveAccount = useCallback((id: string) => {
    const outcome = runCommand(prev => archiveAccountCommand(prev, id, createCommandContext(todayStr)));
    if (outcome && 'error' in outcome) return { success: false, message: outcome.error };

    // „Vrátit“ vrátí účet do původního stavu včetně příznaku výchozího účtu
    const before = outcome?.before;
    showToast(before ? `Účet „${before.name}“ byl archivován.` : 'Účet byl archivován.', 'success', before ? {
      label: 'Vrátit',
      onClick: () => {
        runCommand(prev => undoArchiveAccountCommand(prev, before, createCommandContext(getTodayInPrague())));
        showToast(`Archivace účtu „${before.name}“ byla vrácena.`);
      },
    } : undefined);
    return { success: true };
  }, [runCommand, todayStr, showToast]);

  const restoreAccount = useCallback((id: string) => {
    const name = runCommand(prev => restoreAccountCommand(prev, id, createCommandContext(todayStr)))?.name;
    showToast(name ? `Účet „${name}“ byl obnoven z archivu.` : 'Účet byl obnoven z archivu.');
  }, [runCommand, todayStr, showToast]);

  const deleteAccount = useCallback((id: string) => {
    const outcome = runCommand(prev => deleteAccountCommand(prev, id));
    if (outcome && 'error' in outcome) return { success: false, message: outcome.error };

    const removed = outcome?.removed;
    if (!removed) return { success: true };
    showToast(`Účet „${removed.account.name}“ byl smazán.`, 'success', {
      label: 'Vrátit',
      onClick: () => {
        runCommand(prev => restoreDeletedAccountCommand(prev, removed, createCommandContext(getTodayInPrague())));
        showToast(`Účet „${removed.account.name}“ byl obnoven.`);
      },
    });
    return { success: true };
  }, [runCommand, showToast]);

  const reorderAccounts = useCallback((orderedIds: string[]) => {
    setData(prev => ({
      ...prev,
      accounts: applyAccountOrder(orderedIds, prev.accounts)
    }));
  }, []);

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
    setData(prev => mutateMarketValueHistory(prev, id, edit));
    showToast(`Tržní hodnota z ${formatCzechDate(edit.date)} byla upravena.`);
  }, [setData, showToast]);

  const deleteMarketValue = useCallback((id: string) => {
    const deleted = runCommand(prev => deleteMarketValueCommand(prev, id))?.deleted;
    if (!deleted) {
      showToast('Tržní hodnota byla smazána.');
      return;
    }
    // „Vrátit“ vloží záznam zpět s původním createdAt, takže se zachová i pořadí záznamů ze stejného dne
    showToast(`Tržní hodnota z ${formatCzechDate(deleted.date)} byla smazána.`, 'success', {
      label: 'Vrátit',
      onClick: () => {
        runCommand(prev => restoreMarketValueCommand(prev, deleted, createCommandContext(getTodayInPrague())));
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
    if (outcome && 'error' in outcome) {
      showToast(outcome.error, 'warning');
      return;
    }
    showToast('Poplatek byl uložen.');
  }, [runCommand, todayStr, showToast]);

  const deleteInvestmentFee = useCallback((id: string) => {
    const outcome = runCommand(prev => deleteInvestmentFeeCommand(prev, id));
    const target = outcome?.target;
    if (!outcome || !target) {
      showToast('Poplatek byl smazán.');
      return;
    }
    const { deleted } = outcome;
    // „Vrátit“ jen pokud mezitím pro stejné období nevznikl nový poplatek (nejvýše jeden za období)
    showToast(`Poplatek ${formatCurrency(target.amountInHaler)} byl smazán.`, 'success', {
      label: 'Vrátit',
      onClick: () => {
        runCommand(prev => restoreInvestmentFeesCommand(prev, deleted, createCommandContext(getTodayInPrague())));
        showToast('Poplatek byl obnoven.');
      },
    });
  }, [runCommand, showToast]);

  const updateCorrectionNote = useCallback((id: string, note: string) => {
    runCommand(prev => updateCorrectionNoteCommand(prev, { id, note }, createCommandContext(todayStr)));
    showToast('Poznámka ke korekci byla uložena.');
  }, [runCommand, todayStr, showToast]);

  const deleteCorrection = useCallback(async (id: string) => {
    // Korekce uložená i jako položka seznamu se maže jako položka (s „Vrátit“ pro obojí)
    if (latestDataRef.current.transactions.some(t => t.id === id)) {
      return deleteTransaction(id);
    }
    const deleted = runCommand(prev => deleteStandaloneCorrectionCommand(prev, id))?.deleted;
    // Samostatná korekce (bez položky v seznamu) se vrací jen do korekcí
    showToast('Korekce zůstatku byla smazána.', 'success', deleted ? {
      label: 'Vrátit',
      onClick: () => {
        runCommand(prev => restoreCorrectionCommand(prev, deleted, createCommandContext(getTodayInPrague())));
        showToast('Korekce zůstatku byla obnovena.');
      },
    } : undefined);
    return true;
  }, [runCommand, deleteTransaction, showToast]);

  // ------------------- SPRÁVA KATEGORIÍ -------------------

  const addCategory = useCallback((catData: Omit<Category, 'id' | 'createdAt' | 'updatedAt'>) => {
    const outcome = runCommand(prev => addCategoryCommand(prev, catData, createCommandContext(todayStr)));
    if (!outcome) {
      showToast('Data ještě nejsou načtená, kategorie nebyla vytvořena. Zkuste to prosím za chvíli znovu.', 'error');
      return undefined;
    }
    showToast(`Kategorie „${outcome.category.name}“ byla vytvořena.`);
    return outcome.category;
  }, [runCommand, todayStr, showToast]);

  const addMainCategory = useCallback((catData: Omit<Category, 'id' | 'createdAt' | 'updatedAt'>) => {
    const outcome = runCommand(prev => addMainCategoryCommand(prev, catData, createCommandContext(todayStr)));
    if (!outcome) {
      showToast('Data ještě nejsou načtená, kategorie nebyla vytvořena. Zkuste to prosím za chvíli znovu.', 'error');
      return undefined;
    }
    showToast(`Kategorie „${outcome.category.name}“ byla vytvořena.`);
    return outcome.category;
  }, [runCommand, todayStr, showToast]);

  const updateCategory = useCallback((cat: Category) => {
    runCommand(prev => updateCategoryCommand(prev, cat, createCommandContext(todayStr)));
    showToast(`Kategorie „${cat.name}“ byla upravena.`);
  }, [runCommand, todayStr, showToast]);

  const moveSubcategory = useCallback((subcategoryId: string, newParentId: string, updateHistorical: boolean) => {
    const outcome = runCommand(prev => moveSubcategoryCommand(
      prev,
      { subcategoryId, newParentId, updateHistorical },
      createCommandContext(todayStr)
    ));
    showToast(outcome?.subName && outcome.parentName
      ? `Podkategorie „${outcome.subName}“ byla přesunuta do kategorie „${outcome.parentName}“.`
      : 'Podkategorie byla přesunuta do jiné kategorie.');
  }, [runCommand, todayStr, showToast]);

  const archiveCategory = useCallback((id: string) => {
    const outcome = runCommand(prev => archiveCategoryCommand(prev, id, createCommandContext(todayStr)));
    const name = outcome?.name;
    const affectedIds = outcome?.affectedIds ?? [];
    // Archivovaná kategorie ze seznamu zmizí, proto oznámení nabídne vrácení
    showToast(name ? `Kategorie „${name}“ byla archivována.` : 'Kategorie byla archivována.', 'success', {
      label: 'Vrátit',
      onClick: () => {
        runCommand(prev => undoArchiveCategoryCommand(prev, affectedIds, createCommandContext(getTodayInPrague())));
        showToast(name ? `Archivace kategorie „${name}“ byla vrácena.` : 'Archivace kategorie byla vrácena.');
      },
    });
  }, [runCommand, todayStr, showToast]);

  const restoreCategory = useCallback((id: string) => {
    const name = runCommand(prev => restoreCategoryCommand(prev, id, createCommandContext(todayStr)))?.name;
    showToast(name ? `Kategorie „${name}“ byla obnovena z archivu.` : 'Kategorie byla obnovena z archivu.');
  }, [runCommand, todayStr, showToast]);

  const deleteCategory = useCallback((id: string) => {
    const outcome = runCommand(prev => deleteCategoryCommand(prev, id));
    if (outcome && 'error' in outcome) return { success: false, message: outcome.error };

    const name = outcome?.name;
    const removed = outcome?.removed ?? [];
    // „Vrátit“ obnoví kategorii i její podkategorie
    showToast(name ? `Kategorie „${name}“ byla smazána.` : 'Kategorie byla smazána.', 'success', removed.length ? {
      label: 'Vrátit',
      onClick: () => {
        runCommand(prev => restoreDeletedCategoriesCommand(prev, removed, createCommandContext(getTodayInPrague())));
        showToast(name ? `Kategorie „${name}“ byla obnovena.` : 'Kategorie byla obnovena.');
      },
    } : undefined);
    return { success: true };
  }, [runCommand, showToast]);

  // ------------------- NASTAVENÍ A DATA -------------------

  const updateSettings = useCallback((newSettings: Partial<AppSettings>) => {
    setData(prev => ({
      ...prev,
      settings: { ...prev.settings, ...newSettings }
    }));
    showToast('Nastavení bylo uloženo.');
  }, [showToast]);

  const loadDemoData = useCallback(async () => {
    if (!isDemoModeEnabled()) {
      showToast('Ukázková data jdou načíst jen v demo režimu.', 'warning');
      return;
    }
    const { DEMO_ACCOUNTS, DEMO_RECURRING_RULES, DEMO_TRANSACTIONS } = await import('../fixtures/demoData');
    setData({
      version: 2,
      deletions: [],
      sync: { revision: 0, updatedAt: '', updatedByDeviceId: '' },
      settings: { ...DEFAULT_SETTINGS },
      accounts: [...DEMO_ACCOUNTS],
      categories: [...DEFAULT_CATEGORIES],
      transactions: [...DEMO_TRANSACTIONS],
      recurringRules: [...DEMO_RECURRING_RULES],
      recurringExceptions: [],
      corrections: [],
      marketValueSnapshots: [],
      investmentFees: [],
    });
    showToast('Ukázková data byla načtena.');
  }, [showToast]);

  const clearAllTransactions = useCallback((): boolean => {
    // 1. Vytvořit interní recovery zálohu
    const backupCreated = createOperationRecoveryBackup(latestDataRef.current, 'clear_transactions');
    if (!backupCreated) {
      showToast('Nepodařilo se uložit pojistnou kopii dat, proto se nic nesmazalo. Zkuste to prosím znovu.', 'error');
      return false;
    }

    // 2. Odstranit všechny finanční položky, pravidla opakovaných plateb, výjimky a korekce
    const updated: AppData = {
      ...latestDataRef.current,
      transactions: [],
      recurringRules: [],
      recurringExceptions: [],
      corrections: [],
    };

    setData(updated);

    showToast('Všechny položky, pravidelné položky a korekce byly smazány.');
    return true;
  }, [showToast]);

  const clearAllAccounts = useCallback((): boolean => {
    // 1. Vytvořit interní recovery zálohu
    const backupCreated = createOperationRecoveryBackup(latestDataRef.current, 'clear_accounts');
    if (!backupCreated) {
      showToast('Nepodařilo se uložit pojistnou kopii dat, proto se nic nesmazalo. Zkuste to prosím znovu.', 'error');
      return false;
    }

    // 2. Odstranit všechny účty a všechna závislá finanční data
    const updated: AppData = {
      ...latestDataRef.current,
      accounts: [],
      transactions: [],
      recurringRules: [],
      recurringExceptions: [],
      corrections: [],
      marketValueSnapshots: [],
      investmentFees: [],
      settings: {
        ...latestDataRef.current.settings,
      },
    };

    setData(updated);

    showToast('Všechny účty a data k nim byly smazány.');
    return true;
  }, [showToast]);

  const clearAllCategories = useCallback((): boolean => {
    // 1. Vytvořit interní recovery zálohu
    const backupCreated = createOperationRecoveryBackup(latestDataRef.current, 'clear_categories');
    if (!backupCreated) {
      showToast('Nepodařilo se uložit pojistnou kopii dat, proto se nic nesmazalo. Zkuste to prosím znovu.', 'error');
      return false;
    }

    // 2. Odstranit všechny kategorie a u všech zachovaných položek a pravidel odpojit kategorie (nastavit na null)
    const updatedTxs = latestDataRef.current.transactions.map(t => ({
      ...t,
      categoryId: null,
      subcategoryId: null,
    }));

    const updatedRules = latestDataRef.current.recurringRules.map(r => ({
      ...r,
      categoryId: null,
      subcategoryId: null,
    }));

    const updatedExceptions = latestDataRef.current.recurringExceptions.map(e => ({
      ...e,
      overrideCategoryId: null,
      overrideSubcategoryId: null,
    }));

    const updated: AppData = {
      ...latestDataRef.current,
      categories: [],
      transactions: updatedTxs,
      recurringRules: updatedRules,
      recurringExceptions: updatedExceptions,
    };

    setData(updated);

    showToast('Všechny kategorie byly smazány. Položky zůstaly bez kategorie.');
    return true;
  }, [showToast]);

  const resetAllData = useCallback((): boolean => {
    // 1. Vytvořit interní recovery zálohu
    const backupCreated = createOperationRecoveryBackup(latestDataRef.current, 'clear_all');
    if (!backupCreated) {
      showToast('Nepodařilo se uložit pojistnou kopii dat, proto se nic nesmazalo. Zkuste to prosím znovu.', 'error');
      return false;
    }

    // 2. Kompletní čistý reset: 0 účtů, 0 transakcí, 0 pravidel, 0 korekcí, 0 tržních hodnot, 0 kategorií
    const fresh = createResetAppData();
    controllerRef.current?.change(fresh, true);

    showToast('Všechna data byla smazána. Aplikace začíná od nuly.');
    return true;
  }, [showToast]);

  const restoreFromBackupFile = useCallback((jsonStr: string) => {
    const parsed = validateAndParseBackup(jsonStr);
    setData(parsed);

    setLoadState('ready');
    setLoadErrorDetails(null);
    showToast('Data byla obnovena ze zálohy.');
  }, [showToast]);

  const resetToFreshData = useCallback(() => {
    const fresh = createEmptyAppData();
    controllerRef.current?.change(fresh, true);

    setLoadState('ready');
    setLoadErrorDetails(null);
    showToast('Aplikace začíná s prázdnými daty.');
  }, [showToast]);

  const retryLoadData = useCallback(() => {
    const res = loadStoredDataResult();
    if (res.status === 'loadError') {
      setLoadState('loadError');
      setLoadErrorDetails({
        message: res.error || 'Chyba při načítání dat.',
        recoveryKey: res.recoveryKey,
        corruptedRaw: res.corruptedRaw
      });
    } else {
      setData(res.data);
      setLoadState('ready');
      setLoadErrorDetails(null);
    }
  }, []);

  const exportJSON = useCallback(() => {
    exportBackupJSON(data);
    showToast('Záloha byla stažena.');
  }, [data, showToast]);

  const importJSON = useCallback((jsonStr: string): boolean => {
    try {
      const parsed = validateAndParseBackup(jsonStr);
      // Merges against the live controller state (via the functional setData form), never a
      // possibly-stale `data` snapshot from this closure's render.
      setData(prev => {
        const merged = mergeBackupData(prev, parsed);
        const prevIds = new Set(prev.transactions.map(t => t.id));
        // Pořadí (sequence) v zálože je jen lokální v rámci importovaného souboru. Existující
        // transakce daného dne se nesmí přeřazovat - nově přidané se do řady připojí až za ně,
        // ve stejném vzájemném pořadí, v jakém byly v souboru.
        const addedByDate = new Map<string, Transaction[]>();
        for (const t of merged.transactions) {
          if (prevIds.has(t.id)) continue;
          const list = addedByDate.get(t.date) || [];
          list.push(t);
          addedByDate.set(t.date, list);
        }
        const transactions = merged.transactions.filter(t => prevIds.has(t.id));
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
          ...merged,
          transactions: sortTransactionsByDateAndSequence(transactions)
        };
      });
      showToast('Záloha byla sloučena s aktuálními daty.');
      return true;
    } catch (err: any) {
      showToast(`Zálohu se nepodařilo obnovit: ${err.message}`, 'error');
      return false;
    }
  }, [showToast]);

  const exportCSV = useCallback(() => {
    exportTransactionsCSV(data.transactions, data.accounts, data.categories);
    showToast('Položky byly staženy jako CSV.');
  }, [data.transactions, data.accounts, data.categories, showToast]);

  const [driveSyncStatus, setDriveSyncStatus] = useState<DriveSyncStatus>(() => isStoredTokenValid() ? 'loading' : 'disconnected');
  const [isDriveConnected, setIsDriveConnected] = useState(() => isStoredTokenValid());
  const [isCloudReady, setIsCloudReady] = useState(syncSession?.isReady || false);
  const [driveUser, setDriveUser] = useState<GoogleUser | null>(null);
  const [lastDriveSyncTime, setLastDriveSyncTime] = useState<Date | null>(null);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [driveBackupEnabled, setDriveBackupEnabledState] = useState(() => isDriveBackupEnabled());
  const [lastDriveBackupTime, setLastDriveBackupTime] = useState<Date | null>(null);

  const startCloudSession = useCallback(async (token: string, generation: number) => {
    setDriveSyncStatus('loading');
    setIsCloudReady(false);
    setDriveError(null);
    try {
      const user = await fetchGoogleUserProfile(token);
      if (generation !== authGeneration.current) return;
      if (!user?.permissionId) throw new Error('Nelze ověřit identitu Google účtu. Data nebyla sloučena.');
      // Keep the unscoped legacy cache verbatim for explicit recovery; ownership is unknown.
      const legacy = localStorage.getItem(STORAGE_KEY_PRODUCTION);
      if (legacy && !localStorage.getItem('cashpilot_legacy_cache_before_sync_v2')) {
        localStorage.setItem('cashpilot_legacy_cache_before_sync_v2', legacy);
      }
      setActiveStorageKey(accountStorageKey(user.permissionId));
      setDriveUser(user);
      setIsDriveConnected(true);
      setLastDriveBackupTime(getLastDriveBackupAt(user.permissionId));
      const controller = new SyncController(user.permissionId, () => getValidAccessToken() === token ? token : null, (next, status, ready, error) => {
        if (generation !== authGeneration.current) return;
        const shared = reuseUnchangedSlices(latestDataRef.current, next);
        latestDataRef.current = shared;
        publishData(shared);
        setDriveSyncStatus(status);
        setIsCloudReady(ready);
        setDriveError(error || null);
        setLoadState('ready');
        if (status === 'synced') setLastDriveSyncTime(new Date());
      });
      controllerRef.current = controller;
      await controller.sync();
      if (generation !== authGeneration.current) return;
      // Zálohy jsou nezávislé na sync frontě a nesmí ji svým selháním ovlivnit; spouští se jednou za relaci (start appky).
      void tryRunDriveBackup(token, user.permissionId, controller.data).then((result) => {
        if (generation === authGeneration.current && result.ran) setLastDriveBackupTime(new Date());
      });
    } catch (error) {
      if (generation !== authGeneration.current) return;
      setDriveSyncStatus('error');
      setDriveError((error as Error).message);
    }
  }, []);

  useEffect(() => {
    const generation = ++authGeneration.current;
    const token = getValidAccessToken();
    if (token) void startCloudSession(token, generation);
    else setLoadState('ready');
    const resume = () => { void controllerRef.current?.sync(); };
    const visible = () => { if (document.visibilityState === 'visible') resume(); };
    window.addEventListener('online', resume);
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', visible);
    return () => {
      ++authGeneration.current;
      controllerRef.current?.stop();
      controllerRef.current = null;
      window.removeEventListener('online', resume);
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [startCloudSession]);

  const connectGoogleDrive = useCallback(async () => {
    const generation = ++authGeneration.current;
    controllerRef.current?.stop();
    controllerRef.current = null;
    setIsCloudReady(false);
    setDriveSyncStatus('loading');
    try {
      const token = await loginToGoogle();
      if (generation === authGeneration.current) await startCloudSession(token, generation);
    } catch (error) {
      if (generation !== authGeneration.current) return;
      setDriveSyncStatus('error');
      setDriveError((error as Error).message);
    }
  }, [startCloudSession]);

  const disconnectGoogleDrive = useCallback(async () => {
    ++authGeneration.current;
    controllerRef.current?.stop();
    controllerRef.current = null;
    setIsCloudReady(false);
    setIsDriveConnected(false);
    setDriveSyncStatus('disconnected');
    setActiveStorageKey(null);
    setDriveUser(null);
    setLastDriveSyncTime(null);
    setDriveError(null);
    const fresh = getInitialData();
    latestDataRef.current = fresh;
    publishData(fresh);
    await logoutFromGoogle();
  }, []);

  const syncWithGoogleDrive = useCallback(async (_forceDirection?: 'upload' | 'download') => {
    // All entry points reconcile the durable journal; manual directions cannot discard it.
    if (controllerRef.current) await controllerRef.current.sync();
    else {
      const token = getValidAccessToken();
      if (token) await startCloudSession(token, ++authGeneration.current);
      else await connectGoogleDrive();
    }
  }, [startCloudSession, connectGoogleDrive]);

  // Selhání synchronizace se nesmí ztratit v barevné tečce: při přechodu do chyby nebo konfliktu
  // zůstane oznámení s možností zkusit to znovu, po obnovení přijde krátké potvrzení.
  const lastSyncProblemRef = useRef(false);
  useEffect(() => {
    const isProblem = driveSyncStatus === 'error' || driveSyncStatus === 'conflict';
    if (!isCloudReady) return;
    if (isProblem && !lastSyncProblemRef.current) {
      lastSyncProblemRef.current = true;
      const text = driveSyncStatus === 'conflict'
        ? 'Změny z jiného zařízení se nepodařilo sloučit. Zkuste synchronizaci znovu, vaše data zůstávají v tomto zařízení.'
        : describeSyncError(driveError);
      showToast(text, 'error', { label: 'Zkusit znovu', onClick: () => { void syncWithGoogleDrive(); } });
    } else if (driveSyncStatus === 'synced' && lastSyncProblemRef.current) {
      lastSyncProblemRef.current = false;
      showToast('Změny jsou znovu uložené na Google Disku.');
    }
  }, [driveSyncStatus, driveError, isCloudReady, showToast, syncWithGoogleDrive]);

  const setDriveBackupEnabled = useCallback((enabled: boolean) => {
    persistDriveBackupEnabled(enabled);
    setDriveBackupEnabledState(enabled);
  }, []);

  const runDriveBackupNow = useCallback(async () => {
    const token = getValidAccessToken();
    if (!token || !driveUser?.permissionId) {
      showToast('Nejdřív připojte Google Disk.', 'error');
      return;
    }
    const result = await tryRunDriveBackup(token, driveUser.permissionId, latestDataRef.current, { force: true });
    if (result.ran) {
      setLastDriveBackupTime(new Date());
      showToast('Záloha byla uložena na Google Disk.');
    } else {
      showToast(`Zálohu se nepodařilo vytvořit: ${result.reason || 'neznámá chyba'}`, 'error');
    }
  }, [driveUser, showToast]);

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

    currentPeriod,
    selectedPeriod,
    setSelectedPeriod,
    setOverviewPeriodBounds,
    goToNextPeriod,
    goToPreviousPeriod,
    goToCurrentPeriod,
    isCurrentPeriodSelected,
    forecastSequence,
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
    resetToFreshData,
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
    driveSyncStatus,
    isCloudReady,
    isDriveConnected,
    driveUser,
    lastDriveSyncTime,
    driveError,
    connectGoogleDrive,
    disconnectGoogleDrive,
    syncWithGoogleDrive,
    driveBackupEnabled,
    setDriveBackupEnabled,
    lastDriveBackupTime,
    runDriveBackupNow,
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
