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
  generateOccurrenceForPeriod,
  getAccountBalanceAtDate,
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
  getDaysInMonth,
  getPreviousPeriod,
  getPreviousDay,
  getTodayInPrague,
  formatCzechDate
} from '../services/periodService';
import { applyAccountOrder, sortAccountsByOrder } from '../services/accountService';
import { getInvestedAmountAtValuation, getHistoricalInvestmentCorrection } from '../services/investmentPerformanceService';
import { mutateMarketValueHistory, reconcileMarketValueHistory, MarketValueEdit } from '../services/marketValueHistoryService';
import { autoExecuteDueTransactions, getStatusForDate } from '../services/statusService';
import { addHaler, subHaler } from '../services/currencyService';
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
  deleteTransactionAndReorder,
  deleteTransactionsAndReorder,
  getNextSequenceForDate,
  insertOrUpdateWithSequence,
  reorderDayTransactions as reorderDayTxsService,
  applyRuleRankOrder,
  sortTransactionsByDateAndSequence
} from '../services/sequenceService';

/** ID pravidla z ID virtuálního výskytu (virtual_<ruleId>_<periodKey>); periodKey neobsahuje podtržítko. */
function ruleIdFromVirtualId(id: string): string | null {
  if (!id.startsWith('virtual_')) return null;
  const rest = id.slice('virtual_'.length);
  const cut = rest.lastIndexOf('_');
  return cut > 0 ? rest.slice(0, cut) : null;
}

/**
 * Zruší pevné pozice (overrideSequence) jednotlivých period u daných pravidel, aby pořadí
 * série platilo všude. Výjimky, které po tom nenesou žádnou jinou změnu, se odstraní.
 */
function clearSequenceOverrides(exceptions: RecurringException[], ruleIds: Set<string>): RecurringException[] {
  return exceptions.flatMap(e => {
    if (!ruleIds.has(e.ruleId) || e.overrideSequence === undefined) return [e];
    const { overrideSequence: _removed, ...rest } = e;
    const carriesOtherChange = rest.isCancelled || rest.overrideDate !== undefined ||
      rest.overrideAmountInHaler !== undefined || rest.overrideSourceAccountId !== undefined ||
      rest.overrideTargetAccountId !== undefined || rest.overrideCategoryId !== undefined ||
      rest.overrideSubcategoryId !== undefined;
    return carriesOtherChange ? [{ ...rest, updatedAt: new Date().toISOString() }] : [];
  });
}

/**
 * Pro každou opakující se položku dne: absolutní pozice ve dni (positions, pro jednu periodu)
 * a pořadí mezi opakovanými platbami (ranks, platné napříč obdobími). Klíčem je ID pravidla.
 */
function ruleOrderFromOrderedIds(
  orderedIds: string[],
  transactions: Transaction[],
  rules: RecurringRule[]
): { positions: Map<string, number>; ranks: Map<string, number> } {
  const positions = new Map<string, number>();
  const ranks = new Map<string, number>();
  orderedIds.forEach((id, idx) => {
    const ruleId = ruleIdFromVirtualId(id) ?? transactions.find(t => t.id === id)?.recurringRuleId;
    if (ruleId && !positions.has(ruleId) && rules.some(r => r.id === ruleId)) {
      positions.set(ruleId, idx + 1);
      ranks.set(ruleId, ranks.size + 1);
    }
  });
  return { positions, ranks };
}

/** Zapíše požadovanou pozici do výjimek dané periody (vytvoří je, pokud chybí). */
function withSequenceExceptions(
  exceptions: RecurringException[],
  positions: Map<string, number>,
  periodKey: string,
  nowIso: string
): RecurringException[] {
  let result = exceptions;
  positions.forEach((seq, ruleId) => {
    const idx = result.findIndex(e => e.ruleId === ruleId && e.periodKey === periodKey);
    result = idx >= 0
      ? result.map((e, i) => i === idx ? { ...e, overrideSequence: seq, updatedAt: nowIso } : e)
      : [...result, { id: `ex_${Date.now()}_${ruleId}`, ruleId, periodKey, overrideSequence: seq, createdAt: nowIso, updatedAt: nowIso }];
  });
  return result;
}

/**
 * Rozštěpí opakující se pravidlo na "starou" větev (končící den před effectiveDate)
 * a novou větev od effectiveDate dál, a přepojí na ni už materializované budoucí
 * transakce a výjimky. Sdíleno mezi editací obsahu (updateRecurringRule, mode 'future')
 * a přeuspořádáním pořadí (reorderRecurringItem, mode 'future').
 */
function splitRecurringRuleForFuture(
  rule: RecurringRule,
  effectiveDate: string,
  overrideData: Partial<Transaction>,
  originalTransactionId: string | undefined,
  prevTransactions: Transaction[],
  prevExceptions: RecurringException[],
  budgetStartDay: number,
  nowIso: string,
  idSuffix: string = ''
): {
  updatedOldRule: RecurringRule;
  newFutureRule: RecurringRule;
  updatedTransactions: Transaction[];
  updatedExceptions: RecurringException[];
} {
  const cutOffDate = getPreviousDay(effectiveDate);
  const willBeActive = cutOffDate >= rule.startDate;

  const updatedOldRule: RecurringRule = {
    ...rule,
    endDate: cutOffDate,
    isActive: willBeActive ? rule.isActive : false,
    updatedAt: nowIso
  };

  const newDayOfMonth = parseInt(effectiveDate.split('-')[2], 10) || rule.dayOfMonth;
  const newFutureRule: RecurringRule = {
    ...rule,
    id: `rec_${Date.now()}${idSuffix}_split`,
    title: overrideData.title || rule.title,
    amountInHaler: overrideData.amountInHaler !== undefined ? overrideData.amountInHaler : rule.amountInHaler,
    dayOfMonth: newDayOfMonth,
    startDate: effectiveDate,
    sourceAccountId: overrideData.sourceAccountId || rule.sourceAccountId,
    targetAccountId: overrideData.targetAccountId || rule.targetAccountId,
    categoryId: overrideData.categoryId || rule.categoryId,
    subcategoryId: overrideData.subcategoryId || rule.subcategoryId,
    note: overrideData.note !== undefined ? overrideData.note : rule.note,
    updatedAt: nowIso,
    createdAt: nowIso
  };

  // Přepsat již materializované reálné transakce od editovaného výskytu dále,
  // ať se změna projeví okamžitě i u položek, které už nejsou pouze virtuální.
  const updatedTransactions = prevTransactions.map(t => {
    if (t.recurringRuleId !== rule.id || t.date < effectiveDate) return t;
    const isEditedOccurrence = originalTransactionId
      ? t.id === originalTransactionId
      : t.date === effectiveDate;
    return {
      ...t,
      recurringRuleId: newFutureRule.id,
      title: newFutureRule.title,
      amountInHaler: newFutureRule.amountInHaler,
      actualAmountInHaler: t.status === 'executed' ? newFutureRule.amountInHaler : t.actualAmountInHaler,
      sourceAccountId: newFutureRule.sourceAccountId,
      targetAccountId: newFutureRule.targetAccountId,
      categoryId: newFutureRule.categoryId,
      subcategoryId: newFutureRule.subcategoryId,
      note: newFutureRule.note,
      date: isEditedOccurrence ? effectiveDate : t.date,
      updatedAt: nowIso,
    };
  });

  // Výjimky pro periody od rozštěpení dál patří nově pod nové pravidlo -
  // jinak by se hledaly pod starým (už useknutým) ruleId a nikdy by se nenašly.
  const cutoffPeriodKey = getPeriodForDate(effectiveDate, budgetStartDay).key;
  const updatedExceptions = prevExceptions.map(e =>
    e.ruleId === rule.id && e.periodKey >= cutoffPeriodKey
      ? { ...e, ruleId: newFutureRule.id }
      : e
  );

  return { updatedOldRule, newFutureRule, updatedTransactions, updatedExceptions };
}

export type DriveSyncStatus = SyncStatus;

export interface ToastMessage {
  id: string;
  type: 'success' | 'info' | 'warning' | 'error';
  text: string;
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
  showToast: (text: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
  removeToast: (id: string) => void;

  // Transakce a pořadí
  addTransaction: (tx: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) => Transaction;
  updateTransaction: (tx: Transaction) => void;
  deleteTransaction: (
    id: string,
    recurringMode?: 'occurrence' | 'future' | 'series',
    deleteHistoricalExecuted?: boolean
  ) => Promise<boolean>;
  duplicateTransaction: (tx: Transaction) => void;
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
  addAccount: (account: Omit<Account, 'id' | 'createdAt' | 'updatedAt'>) => Account;
  updateAccount: (account: Account) => { success: boolean; message?: string };
  archiveAccount: (id: string) => { success: boolean; message?: string };
  restoreAccount: (id: string) => void;
  deleteAccount: (id: string) => { success: boolean; message?: string };
  reorderAccounts: (orderedIds: string[]) => void;
  reconcileBalance: (accountId: string, actualBalanceInHaler: number, checkDate: string, note?: string) => void;
  updateMarketValue: (accountId: string, marketValueInHaler: number, date?: string, note?: string, investedAmountAdjustmentInHaler?: number) => void;
  updateCorrectionNote: (id: string, note: string) => void;
  editMarketValue: (id: string, edit: MarketValueEdit) => void;
  deleteMarketValue: (id: string) => void;
  deleteCorrection: (id: string) => Promise<boolean>;
  dataConflicts: { transaction: Transaction; account: Account; reason: string }[];

  // Kategorie
  addCategory: (cat: Omit<Category, 'id' | 'createdAt' | 'updatedAt'>) => Category;
  addMainCategory: (cat: Omit<Category, 'id' | 'createdAt' | 'updatedAt'>) => Category;
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

  const showToast = useCallback((text: string, type: 'success' | 'info' | 'warning' | 'error' = 'success') => {
    const id = `${Date.now()}_${Math.random()}`;
    setToasts(prev => [...prev, { id, text, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
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

  const allPeriodsSequence = useMemo(() => {
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

    if (selectedPeriod.startDate < earliestPeriod.startDate) {
      earliestPeriod = selectedPeriod;
    }
    if (selectedPeriod.startDate > latestPeriod.startDate) {
      latestPeriod = selectedPeriod;
    }

    for (const period of overviewPeriodBounds || []) {
      if (period.key < earliestPeriod.key) earliestPeriod = period;
      if (period.key > latestPeriod.key) latestPeriod = period;
    }

    for (const tx of data.transactions) {
      if (tx.date) {
        const p = getPeriodForDate(tx.date, startDay);
        if (p.startDate < earliestPeriod.startDate) {
          earliestPeriod = p;
        }
        if (p.startDate > latestPeriod.startDate) {
          latestPeriod = p;
        }
      }
    }

    for (const c of data.corrections) {
      if (c.checkDate) {
        const p = getPeriodForDate(c.checkDate, startDay);
        if (p.startDate < earliestPeriod.startDate) {
          earliestPeriod = p;
        }
        if (p.startDate > latestPeriod.startDate) {
          latestPeriod = p;
        }
      }
    }

    for (const s of data.marketValueSnapshots) {
      if (s.date) {
        const p = getPeriodForDate(s.date, startDay);
        if (p.startDate < earliestPeriod.startDate) {
          earliestPeriod = p;
        }
        if (p.startDate > latestPeriod.startDate) {
          latestPeriod = p;
        }
      }
    }

    for (const r of data.recurringRules) {
      if (r.startDate) {
        const p = getPeriodForDate(r.startDate, startDay);
        if (p.startDate < earliestPeriod.startDate) {
          earliestPeriod = p;
        }
      }
    }

    for (const a of data.accounts) {
      if (a.initialBalanceDate) {
        const p = getPeriodForDate(a.initialBalanceDate, startDay);
        if (p.startDate < earliestPeriod.startDate) {
          earliestPeriod = p;
        }
      }
    }

    return generatePeriodsBetween(earliestPeriod, latestPeriod, startDay);
  }, [
    currentPeriod,
    selectedPeriod,
    overviewPeriodBounds,
    data.transactions,
    data.corrections,
    data.marketValueSnapshots,
    data.recurringRules,
    data.accounts,
    data.settings.budgetStartDay
  ]);

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
      todayStr
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

    showToast(`Položka „${newTx.title}“ byla úspěšně přidána (pořadí #${assignedSeq}).`);
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
        const ruleId = ruleIdFromVirtualId(id);
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
    showToast('Pořadí položek bylo aktualizováno.');
  }, [showToast]);

  const deleteTransaction = useCallback(async (
    id: string,
    recurringMode: 'occurrence' | 'future' | 'series' = 'occurrence',
    deleteHistoricalExecuted: boolean = false
  ): Promise<boolean> => {
    let success = false;
    try {
      // Ověření dostupnosti úložiště (pokud selže, vyvolá chybu)
      try {
        localStorage.setItem('__cp_test__', '1');
        localStorage.removeItem('__cp_test__');
      } catch (e) {
        throw new Error('Úložiště není dostupné.');
      }

      setData(prev => {
        const isVirtual = id.startsWith('virtual_');
        let ruleId: string | undefined;
        let periodKey: string | undefined;
        let txDate: string | undefined;

        if (isVirtual) {
          const withoutPrefix = id.slice('virtual_'.length);
          const lastUnderscore = withoutPrefix.lastIndexOf('_');
          if (lastUnderscore !== -1) {
            ruleId = withoutPrefix.slice(0, lastUnderscore);
            periodKey = withoutPrefix.slice(lastUnderscore + 1);
          }
        } else {
          const realTx = prev.transactions.find(t => t.id === id);
          if (realTx) {
            txDate = realTx.date;
            ruleId = realTx.recurringRuleId;
            periodKey = getPeriodForDate(realTx.date, prev.settings.budgetStartDay).key;
          } else {
            // ID nenalezeno v transakcích a není virtuální
            return prev;
          }
        }

        const rule = ruleId ? prev.recurringRules.find(r => r.id === ruleId) : undefined;
        const isRecurring = Boolean(rule);

        // 1. BĚŽNÁ POLOŽKA (příjem, výdaj, převod) nebo položka bez aktivního pravidla
        if (!isRecurring) {
          if (isVirtual) {
            return prev;
          }
          const updatedTxs = deleteTransactionAndReorder(id, prev.transactions);
          success = true;
          return {
            ...prev,
            transactions: updatedTxs,
            corrections: prev.corrections.filter(c => c.id !== id),
          };
        }

        // 2. PRAVIDELNÁ POLOŽKA
        // 2A: POUZE TATO POLOŽKA (výjimka v sérii)
        if (recurringMode === 'occurrence') {
          let updatedTxs = prev.transactions;
          if (!isVirtual) {
            updatedTxs = deleteTransactionAndReorder(id, prev.transactions);
          }

          const targetPeriodKey = periodKey || selectedPeriod.key;
          const existingExIndex = prev.recurringExceptions.findIndex(
            e => e.ruleId === ruleId && e.periodKey === targetPeriodKey
          );

          const cancelledEx: RecurringException = {
            id: existingExIndex >= 0 ? prev.recurringExceptions[existingExIndex].id : `ex_${Date.now()}`,
            ruleId: ruleId!,
            periodKey: targetPeriodKey,
            isCancelled: true,
            createdAt: new Date().toISOString()
          };

          const newExceptions = existingExIndex >= 0
            ? prev.recurringExceptions.map((item, idx) => idx === existingExIndex ? cancelledEx : item)
            : [...prev.recurringExceptions, cancelledEx];

          success = true;
          return {
            ...prev,
            recurringExceptions: newExceptions,
            transactions: updatedTxs,
          };
        }

        // 2B: TATO A VŠECHNY BUDOUCÍ POLOŽKY (ukončení pravidla)
        if (recurringMode === 'future') {
          let occDate = txDate;
          if (!occDate && isVirtual && periodKey && rule) {
            const [yStr, mStr] = periodKey.split('-');
            const period = createBudgetPeriod(parseInt(yStr, 10), parseInt(mStr, 10), prev.settings.budgetStartDay);
            const occ = generateOccurrenceForPeriod(rule, period, prev.recurringExceptions, prev.settings.budgetStartDay);
            occDate = occ?.date || period.startDate;
          }
          if (!occDate) {
            occDate = new Date().toISOString().slice(0, 10);
          }

          const cutOffDate = getPreviousDay(occDate);
          const nowIso = new Date().toISOString();

          // Nastavit endDate na den před výskytem
          const updatedRules = prev.recurringRules.map(r => {
            if (r.id !== ruleId) return r;
            const willBeActive = cutOffDate >= r.startDate;
            return {
              ...r,
              endDate: cutOffDate,
              isActive: willBeActive ? r.isActive : false,
              updatedAt: nowIso
            };
          });

          // Z reálných transakcí smazat položky tohoto pravidla od data occDate
          const idsToDelete = new Set<string>();
          for (const t of prev.transactions) {
            if (t.recurringRuleId === ruleId && t.date >= occDate) {
              if (deleteHistoricalExecuted || t.status !== 'executed') {
                idsToDelete.add(t.id);
              }
            }
          }
          if (!isVirtual) {
            idsToDelete.add(id);
          }

          let updatedTxs = deleteTransactionsAndReorder(idsToDelete, prev.transactions);

          // Pokud po smazání budoucích výskytů zůstává v sérii nejvýše jedna položka,
          // pravidlo už nemá smysl udržovat jako opakující se - převést zbylou položku
          // na běžnou (nepravidelnou) a pravidlo odstranit.
          const remainingInRule = updatedTxs.filter(t => t.recurringRuleId === ruleId);
          if (remainingInRule.length <= 1) {
            updatedTxs = updatedTxs.map(t =>
              t.recurringRuleId === ruleId
                ? { ...t, recurringRuleId: undefined, isException: false, updatedAt: nowIso }
                : t
            );
            success = true;
            return {
              ...prev,
              recurringRules: prev.recurringRules.filter(r => r.id !== ruleId),
              recurringExceptions: prev.recurringExceptions.filter(e => e.ruleId !== ruleId),
              transactions: updatedTxs,
            };
          }

          success = true;
          return {
            ...prev,
            recurringRules: updatedRules,
            transactions: updatedTxs,
          };
        }

        // 2C: CELÁ SÉRIE (smazání pravidla a všech neuskutečněných výskytů)
        if (recurringMode === 'series') {
          const updatedRules = prev.recurringRules.filter(r => r.id !== ruleId);
          const updatedExceptions = prev.recurringExceptions.filter(e => e.ruleId !== ruleId);

          const idsToDelete = new Set<string>();
          for (const t of prev.transactions) {
            if (t.recurringRuleId === ruleId) {
              if (deleteHistoricalExecuted || t.status !== 'executed') {
                idsToDelete.add(t.id);
              }
            }
          }
          if (!isVirtual) {
            idsToDelete.add(id);
          }

          const updatedTxs = deleteTransactionsAndReorder(idsToDelete, prev.transactions);

          success = true;
          return {
            ...prev,
            recurringRules: updatedRules,
            recurringExceptions: updatedExceptions,
            transactions: updatedTxs,
          };
        }

        return prev;
      });

      if (success) {
        showToast('Položka byla smazána.');
        return true;
      } else {
        return false;
      }
    } catch (err) {
      console.error('Chyba při mazání položky:', err);
      showToast('Při mazání položky došlo k chybě.', 'error');
      return false;
    }
  }, [selectedPeriod.key, showToast]);

  const duplicateTransaction = useCallback((tx: Transaction) => {
    const nowIso = new Date().toISOString();
    const nextSeq = getNextSequenceForDate(tx.date, data.transactions);
    const autoStatus = getStatusForDate(tx.date);
    const copy: Transaction = {
      ...tx,
      id: `tx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      title: `${tx.title} (kopie)`,
      sequence: nextSeq,
      status: autoStatus,
      actualAmountInHaler: autoStatus === 'executed' ? (tx.actualAmountInHaler ?? tx.amountInHaler) : undefined,
      recurringRuleId: undefined,
      isException: false,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    setData(prev => ({
      ...prev,
      transactions: insertOrUpdateWithSequence(copy, nextSeq, prev.transactions)
    }));
    showToast(`Položka byla duplikována: „${copy.title}“`);
  }, [data.transactions, showToast]);

  const setTransactionStatus = useCallback((
    id: string,
    newStatus: TransactionStatus,
    updates?: { actualAmountInHaler?: number; date?: string; sourceAccountId?: string; categoryId?: string }
  ) => {
    let success = false;
    let itemTitle = '';

    setData(prev => {
      const nowIso = new Date().toISOString();

      if (id.startsWith('virtual_')) {
        const withoutPrefix = id.slice('virtual_'.length);
        const lastUnderscore = withoutPrefix.lastIndexOf('_');
        if (lastUnderscore === -1) return prev;
        const ruleId = withoutPrefix.slice(0, lastUnderscore);
        const periodKey = withoutPrefix.slice(lastUnderscore + 1);

        const rule = prev.recurringRules.find(r => r.id === ruleId);
        if (!rule) return prev;

        const [yStr, mStr] = periodKey.split('-');
        const period = createBudgetPeriod(parseInt(yStr, 10), parseInt(mStr, 10), prev.settings.budgetStartDay);
        const occurrence = generateOccurrenceForPeriod(rule, period, prev.recurringExceptions, prev.settings.budgetStartDay);

        const effectiveDate = updates?.date || occurrence?.date || todayStr;
        const baseAmount = occurrence?.amountInHaler ?? rule.amountInHaler;
        const effectiveActualAmount = newStatus === 'executed'
          ? (updates?.actualAmountInHaler !== undefined ? updates.actualAmountInHaler : (occurrence?.actualAmountInHaler || baseAmount))
          : undefined;

        const assignedSeq = getNextSequenceForDate(effectiveDate, prev.transactions);

        const realTx: Transaction = {
          id: `tx_real_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          title: rule.title,
          amountInHaler: baseAmount,
          plannedAmountInHaler: baseAmount,
          actualAmountInHaler: effectiveActualAmount,
          date: effectiveDate,
          sequence: assignedSeq,
          type: rule.type,
          sourceAccountId: updates?.sourceAccountId || occurrence?.sourceAccountId || rule.sourceAccountId,
          targetAccountId: occurrence?.targetAccountId || rule.targetAccountId,
          categoryId: updates?.categoryId || occurrence?.categoryId || rule.categoryId,
          subcategoryId: occurrence?.subcategoryId || rule.subcategoryId,
          status: newStatus,
          recurringRuleId: rule.id,
          note: rule.note,
          createdAt: nowIso,
          updatedAt: nowIso,
        };

        success = true;
        itemTitle = rule.title;

        const cleanExceptions = prev.recurringExceptions.filter(
          e => !(e.ruleId === ruleId && e.periodKey === periodKey)
        );

        return {
          ...prev,
          recurringExceptions: cleanExceptions,
          transactions: insertOrUpdateWithSequence(realTx, assignedSeq, prev.transactions)
        };
      }

      const tx = prev.transactions.find(t => t.id === id);
      if (!tx) return prev;

      let effectiveActualAmount = tx.actualAmountInHaler;
      if (newStatus === 'executed') {
        effectiveActualAmount = updates?.actualAmountInHaler !== undefined
          ? updates.actualAmountInHaler
          : (tx.actualAmountInHaler || tx.amountInHaler);
      } else if (newStatus === 'planned') {
        effectiveActualAmount = undefined;
      }

      const updated: Transaction = {
        ...tx,
        status: newStatus,
        actualAmountInHaler: effectiveActualAmount,
        date: updates?.date || tx.date,
        sourceAccountId: updates?.sourceAccountId || tx.sourceAccountId,
        categoryId: updates?.categoryId || tx.categoryId,
        updatedAt: nowIso
      };

      success = true;
      itemTitle = tx.title;

      return {
        ...prev,
        transactions: prev.transactions.map(t => t.id === id ? updated : t)
      };
    });

    if (success) {
      if (newStatus === 'executed') {
        showToast(itemTitle ? `Položka „${itemTitle}“ byla označena jako uskutečněná.` : 'Položka byla označena jako uskutečněná.', 'success');
      } else if (newStatus === 'cancelled') {
        showToast(itemTitle ? `Položka „${itemTitle}“ byla označena jako zrušená.` : 'Položka byla označena jako zrušená.', 'info');
      } else {
        showToast(itemTitle ? `Položka „${itemTitle}“ byla nastavena jako plánovaná.` : 'Položka byla nastavena jako plánovaná.', 'info');
      }
    }
  }, [todayStr, showToast]);

  const markTransactionExecuted = useCallback((
    id: string,
    updates?: { actualAmountInHaler?: number; date?: string; sourceAccountId?: string; categoryId?: string }
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
    const srcAcc = data.accounts.find(a => a.id === ruleData.sourceAccountId);
    if (srcAcc?.initialBalanceDate && ruleData.startDate < srcAcc.initialBalanceDate) {
      const msg = `Tento účet je aktivní až od ${formatCzechDate(srcAcc.initialBalanceDate)}. Zvolte stejné nebo pozdější datum.`;
      showToast(msg, 'error');
      throw new Error(msg);
    }
    if (ruleData.type === 'transfer' && ruleData.targetAccountId) {
      const tgtAcc = data.accounts.find(a => a.id === ruleData.targetAccountId);
      if (tgtAcc?.initialBalanceDate && ruleData.startDate < tgtAcc.initialBalanceDate) {
        const msg = `Tento účet je aktivní až od ${formatCzechDate(tgtAcc.initialBalanceDate)}. Zvolte stejné nebo pozdější datum.`;
        showToast(msg, 'error');
        throw new Error(msg);
      }
    }

    const nowIso = new Date().toISOString();
    const newRule: RecurringRule = {
      ...ruleData,
      id: `rec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const effectiveStatus: TransactionStatus = initialStatus || getStatusForDate(newRule.startDate);

    setData(prev => {
      const existingTx = existingTransactionId
        ? prev.transactions.find(t => t.id === existingTransactionId)
        : undefined;
      if (existingTransactionId && (!existingTx || existingTx.recurringRuleId)) {
        throw new Error('Položka již patří do pravidelné série nebo neexistuje.');
      }

      let targetSeq = initialSequence && initialSequence > 0
        ? Math.round(initialSequence)
        : getNextSequenceForDate(newRule.startDate, prev.transactions);

      const firstOccurrenceTx: Transaction = {
        ...existingTx,
        id: existingTx?.id || `tx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        title: newRule.title,
        amountInHaler: newRule.amountInHaler,
        plannedAmountInHaler: existingTx ? existingTx.plannedAmountInHaler : newRule.amountInHaler,
        actualAmountInHaler: effectiveStatus === 'executed' ? newRule.amountInHaler : (effectiveStatus === 'planned' ? undefined : existingTx?.actualAmountInHaler),
        date: newRule.startDate,
        sequence: targetSeq,
        type: newRule.type,
        sourceAccountId: newRule.sourceAccountId,
        targetAccountId: newRule.targetAccountId,
        categoryId: newRule.categoryId,
        subcategoryId: newRule.subcategoryId,
        status: effectiveStatus,
        recurringRuleId: newRule.id,
        note: newRule.note,
        createdAt: existingTx?.createdAt || nowIso,
        updatedAt: nowIso,
      };

      const updatedTxs = insertOrUpdateWithSequence(firstOccurrenceTx, targetSeq, prev.transactions, existingTx?.date);

      return {
        ...prev,
        recurringRules: [...prev.recurringRules, newRule],
        transactions: updatedTxs,
      };
    });

    showToast(`Pravidelná položka „${newRule.title}“ byla vytvořena.`);
    return newRule;
  }, [data.accounts, showToast]);

  const updateRecurringRule = useCallback((
    ruleId: string,
    mode: 'occurrence' | 'future' | 'series',
    periodKey: string,
    overrideData: Partial<Transaction>,
    originalTransactionId?: string
  ) => {
    setData(prev => {
      const rule = prev.recurringRules.find(r => r.id === ruleId);
      if (!rule) return prev;

      if (mode === 'occurrence') {
        const existingExIndex = prev.recurringExceptions.findIndex(e => e.ruleId === ruleId && e.periodKey === periodKey);
        const ex: RecurringException = {
          id: existingExIndex >= 0 ? prev.recurringExceptions[existingExIndex].id : `ex_${Date.now()}`,
          ruleId,
          periodKey,
          overrideAmountInHaler: overrideData.amountInHaler,
          overrideDate: overrideData.date,
          overrideSourceAccountId: overrideData.sourceAccountId,
          overrideTargetAccountId: overrideData.targetAccountId,
          overrideCategoryId: overrideData.categoryId,
          overrideSubcategoryId: overrideData.subcategoryId,
          createdAt: new Date().toISOString()
        };

        const newExceptions = existingExIndex >= 0
          ? prev.recurringExceptions.map((item, idx) => idx === existingExIndex ? ex : item)
          : [...prev.recurringExceptions, ex];

        return { ...prev, recurringExceptions: newExceptions };
      }

      const nowIso = new Date().toISOString();

      if (mode === 'future') {
        const originalTx = originalTransactionId
          ? prev.transactions.find(t => t.id === originalTransactionId)
          : undefined;
        const effectiveDate = overrideData.date || originalTx?.date || periodKey + '-15';
        const { updatedOldRule, newFutureRule, updatedTransactions, updatedExceptions } = splitRecurringRuleForFuture(
          rule,
          effectiveDate,
          overrideData,
          originalTransactionId,
          prev.transactions,
          prev.recurringExceptions,
          prev.settings.budgetStartDay,
          nowIso
        );

        return {
          ...prev,
          recurringRules: [...prev.recurringRules.map(r => r.id === ruleId ? updatedOldRule : r), newFutureRule],
          recurringExceptions: updatedExceptions,
          transactions: updatedTransactions,
        };
      }

      // Změna data u celé série = nový den v měsíci pro všechny výskyty. Začátek pravidla
      // se posune na nový den ve stejném měsíci, aby první výskyt nevypadl (occDate < startDate).
      const newDay = overrideData.date ? parseInt(overrideData.date.split('-')[2], 10) : NaN;
      const dayChanged = !isNaN(newDay) && newDay >= 1 && newDay <= 31;
      const withDay = (dateStr: string): string => {
        const [y, m] = dateStr.split('-').map(Number);
        const day = Math.min(newDay, getDaysInMonth(y, m));
        return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      };

      const updatedSeries: RecurringRule = {
        ...rule,
        dayOfMonth: dayChanged ? newDay : rule.dayOfMonth,
        startDate: dayChanged ? withDay(rule.startDate) : rule.startDate,
        title: overrideData.title || rule.title,
        amountInHaler: overrideData.amountInHaler !== undefined ? overrideData.amountInHaler : rule.amountInHaler,
        sourceAccountId: overrideData.sourceAccountId || rule.sourceAccountId,
        targetAccountId: overrideData.targetAccountId || rule.targetAccountId,
        categoryId: overrideData.categoryId || rule.categoryId,
        subcategoryId: overrideData.subcategoryId || rule.subcategoryId,
        note: overrideData.note !== undefined ? overrideData.note : rule.note,
        updatedAt: nowIso
      };

      // "Včetně minulých" - promítnout změnu i do už materializovaných transakcí série.
      const updatedTxs = prev.transactions.map(t => {
        if (t.recurringRuleId !== ruleId) return t;
        return {
          ...t,
          title: updatedSeries.title,
          amountInHaler: updatedSeries.amountInHaler,
          actualAmountInHaler: t.status === 'executed' ? updatedSeries.amountInHaler : t.actualAmountInHaler,
          sourceAccountId: updatedSeries.sourceAccountId,
          targetAccountId: updatedSeries.targetAccountId,
          categoryId: updatedSeries.categoryId,
          subcategoryId: updatedSeries.subcategoryId,
          note: updatedSeries.note,
          date: !dayChanged ? t.date : (t.id === originalTransactionId ? overrideData.date! : withDay(t.date)),
          updatedAt: nowIso,
        };
      });

      return {
        ...prev,
        recurringRules: prev.recurringRules.map(r => r.id === ruleId ? updatedSeries : r),
        transactions: updatedTxs,
      };
    });

    showToast('Pravidelná položka byla úspěšně upravena.');
  }, [showToast]);

  const reorderRecurringItem = useCallback((
    ruleId: string,
    mode: 'occurrence' | 'future' | 'series',
    date: string,
    periodKey: string,
    orderedIds: string[],
    movedTransactionId: string
  ) => {
    setData(prev => {
      const rule = prev.recurringRules.find(r => r.id === ruleId);
      if (!rule) return prev;

      const nowIso = new Date().toISOString();

      // Pozice VŠECH opakujících se položek toho dne (ne jen přetažené). Kdyby měla pozici jen
      // přetažená, při posunu dolů pod jinou opakovanou platbu by se její index zkrátil na
      // začátek dne a původní pořadí by se vrátilo.
      const { positions, ranks } = ruleOrderFromOrderedIds(orderedIds, prev.transactions, prev.recurringRules);
      if (!ranks.has(ruleId)) {
        positions.set(ruleId, Math.max(1, orderedIds.indexOf(movedTransactionId) + 1));
        ranks.set(ruleId, ranks.size + 1);
      }
      const involvedRuleIds = Array.from(ranks.keys());

      // Zhmotněné (reálné) transakce toho dne se přeuspořádají i fyzicky - hinty ovlivňují
      // jen generování virtuálních výskytů.
      const reorderRealToday = (txs: Transaction[]) => reorderDayTxsService(date, orderedIds, txs);

      if (mode === 'occurrence') {
        return {
          ...prev,
          recurringExceptions: withSequenceExceptions(prev.recurringExceptions, positions, periodKey, nowIso),
          transactions: reorderRealToday(prev.transactions),
        };
      }

      if (mode === 'future') {
        let rules = prev.recurringRules;
        let txs = prev.transactions;
        let exceptions = prev.recurringExceptions;
        const newRanks = new Map<string, number>();
        involvedRuleIds.forEach((rid, i) => {
          const current = rules.find(r => r.id === rid);
          if (!current) return;
          const split = splitRecurringRuleForFuture(
            current, date, {}, undefined, txs, exceptions, prev.settings.budgetStartDay, nowIso, `_${i}`
          );
          const hinted: RecurringRule = {
            ...split.newFutureRule,
            orderRank: ranks.get(rid),
            orderRankUpdatedAt: nowIso,
          };
          rules = [...rules.map(r => r.id === rid ? split.updatedOldRule : r), hinted];
          txs = split.updatedTransactions;
          exceptions = split.updatedExceptions;
          newRanks.set(hinted.id, ranks.get(rid) as number);
        });

        // Už zhmotněné výskyty od tohoto dne dál (provedené i plánované) dostanou nové pořadí hned.
        return {
          ...prev,
          recurringRules: rules,
          recurringExceptions: clearSequenceOverrides(exceptions, new Set(newRanks.keys())),
          transactions: applyRuleRankOrder(reorderRealToday(txs), newRanks, date),
        };
      }

      // mode === 'series' - pořadí se uloží do pravidel a propíše i do všech už zhmotněných výskytů.
      return {
        ...prev,
        recurringRules: prev.recurringRules.map(r => ranks.has(r.id)
          ? { ...r, orderRank: ranks.get(r.id), orderRankUpdatedAt: nowIso, updatedAt: nowIso }
          : r),
        recurringExceptions: clearSequenceOverrides(prev.recurringExceptions, new Set(ranks.keys())),
        transactions: applyRuleRankOrder(reorderRealToday(prev.transactions), ranks),
      };
    });

    showToast('Pořadí opakující se položky bylo aktualizováno.');
  }, [showToast]);

  const deleteRecurringRule = useCallback((id: string) => {
    setData(prev => {
      const idsToDelete = new Set<string>();
      for (const t of prev.transactions) {
        if (t.recurringRuleId === id && t.status !== 'executed') {
          idsToDelete.add(t.id);
        }
      }
      const updatedTxs = idsToDelete.size > 0
        ? deleteTransactionsAndReorder(idsToDelete, prev.transactions)
        : prev.transactions;

      return {
        ...prev,
        recurringRules: prev.recurringRules.filter(r => r.id !== id),
        recurringExceptions: prev.recurringExceptions.filter(e => e.ruleId !== id),
        transactions: updatedTxs,
      };
    });
    showToast('Pravidelná položka byla odstraněna.');
  }, [showToast]);

  // ------------------- SPRÁVA ÚČTŮ -------------------

  const addAccount = useCallback((accData: Omit<Account, 'id' | 'createdAt' | 'updatedAt'>) => {
    const nowIso = new Date().toISOString();
    const isDefault = Boolean(accData.isDefault);
    const newAcc: Account = {
      ...accData,
      isDefault,
      id: `acc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      createdAt: nowIso,
      updatedAt: nowIso
    };
    setData(prev => {
      let accounts = prev.accounts;
      if (isDefault) {
        accounts = accounts.map(a => a.isDefault ? { ...a, isDefault: false, updatedAt: nowIso } : a);
      }
      // Nový účet se vždy zařadí na konec uživatelského pořadí.
      const maxSortOrder = accounts.reduce((max, a) => Math.max(max, a.sortOrder ?? 0), 0);
      return {
        ...prev,
        accounts: [...accounts, { ...newAcc, sortOrder: maxSortOrder + 1 }]
      };
    });
    showToast(`Účet „${newAcc.name}“ byl vytvořen.`);
    return newAcc;
  }, [showToast]);

  const updateAccount = useCallback((acc: Account) => {
    const accountId = acc.id;
    const newInitDate = acc.initialBalanceDate;
    if (newInitDate) {
      let earliestMovementDate: string | null = null;

      for (const t of data.transactions) {
        if (t.status === 'cancelled') continue;
        if (t.sourceAccountId === accountId || t.targetAccountId === accountId) {
          if (!earliestMovementDate || t.date < earliestMovementDate) {
            earliestMovementDate = t.date;
          }
        }
      }

      for (const c of data.corrections) {
        if (c.accountId === accountId) {
          if (!earliestMovementDate || c.checkDate < earliestMovementDate) {
            earliestMovementDate = c.checkDate;
          }
        }
      }

      for (const s of data.marketValueSnapshots || []) {
        if (s.accountId === accountId) {
          if (!earliestMovementDate || s.date < earliestMovementDate) {
            earliestMovementDate = s.date;
          }
        }
      }

      for (const r of data.recurringRules || []) {
        if (r.isActive && (r.sourceAccountId === accountId || r.targetAccountId === accountId)) {
          if (!earliestMovementDate || r.startDate < earliestMovementDate) {
            earliestMovementDate = r.startDate;
          }
        }
      }

      if (earliestMovementDate && newInitDate > earliestMovementDate) {
        const msg = `Datum počátečního stavu nelze posunout za existující pohyb ze dne ${formatCzechDate(earliestMovementDate)}. Nejdříve upravte nebo odstraňte starší položky.`;
        showToast(msg, 'error');
        return { success: false, message: msg };
      }
    }

    const nowIso = new Date().toISOString();
    const isDefault = Boolean(acc.isDefault);

    setData(prev => {
      const accounts = prev.accounts.map(a => {
        if (a.id === acc.id) {
          return { ...acc, isDefault, updatedAt: nowIso };
        }
        if (isDefault && a.isDefault) {
          return { ...a, isDefault: false, updatedAt: nowIso };
        }
        return a;
      });
      return {
        ...prev,
        accounts
      };
    });
    showToast(`Účet „${acc.name}“ byl upraven.`);
    return { success: true };
  }, [data.accounts, data.transactions, data.corrections, data.marketValueSnapshots, data.recurringRules, showToast]);

  const archiveAccount = useCallback((id: string) => {
    const activeRules = data.recurringRules.filter(r => r.isActive && (r.sourceAccountId === id || r.targetAccountId === id));
    if (activeRules.length > 0) {
      return {
        success: false,
        message: `Účet nelze archivovat, protože je navázán na ${activeRules.length} aktivní pravidelné položky (např. ${activeRules[0].title}). Před archivací prosím tyto položky převeďte nebo ukončete.`
      };
    }

    const nowIso = new Date().toISOString();
    setData(prev => ({
      ...prev,
      accounts: prev.accounts.map(a => a.id === id ? { ...a, status: 'archived', isDefault: false, updatedAt: nowIso } : a)
    }));
    showToast('Účet byl archivován.');
    return { success: true };
  }, [data.recurringRules, showToast]);

  const restoreAccount = useCallback((id: string) => {
    const nowIso = new Date().toISOString();
    setData(prev => ({
      ...prev,
      accounts: prev.accounts.map(a => a.id === id ? { ...a, status: 'active', isDefault: false, updatedAt: nowIso } : a)
    }));
    showToast('Účet byl obnoven z archivu.');
  }, [showToast]);

  const deleteAccount = useCallback((id: string) => {
    const hasTransactions = data.transactions.some(t => t.sourceAccountId === id || t.targetAccountId === id);
    const hasRules = data.recurringRules.some(r => r.sourceAccountId === id || r.targetAccountId === id);
    // Platná korekce je ta, která má odpovídající transakci typu balance_adjustment nebo účet má reálné transakce.
    // Osiřelý / neplatný záznam bez transakce na prázdném účtu nesmí bránit smazání.
    const hasActiveCorrections = data.corrections.some(c => 
      c.accountId === id && (
        hasTransactions || 
        data.transactions.some(t => t.id === c.id || (t.type === 'balance_adjustment' && t.sourceAccountId === id))
      )
    );

    if (hasTransactions || hasRules || hasActiveCorrections) {
      return {
        success: false,
        message: 'Účet s existující historií (transakce, trvalé příkazy nebo korekce) nelze fyzicky smazat. Můžete jej bezpečně archivovat.'
      };
    }

    setData(prev => {
      const newOverrides = { ...(prev.settings?.accountUsableOverrides || {}) };
      delete newOverrides[id];

      return {
        ...prev,
        accounts: prev.accounts.filter(a => a.id !== id),
        corrections: prev.corrections.filter(c => c.accountId !== id),
        marketValueSnapshots: (prev.marketValueSnapshots || []).filter(s => s.accountId !== id),
        recurringExceptions: (prev.recurringExceptions || []).filter(
          e => e.overrideSourceAccountId !== id && e.overrideTargetAccountId !== id
        ),
        settings: {
          ...prev.settings,
          accountUsableOverrides: newOverrides
        }
      };
    });
    showToast('Účet byl trvale smazán.');
    return { success: true };
  }, [data.transactions, data.corrections, data.recurringRules, showToast]);

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
    const account = data.accounts.find(a => a.id === accountId);
    if (!account) return;

    if (account.initialBalanceDate && checkDate < account.initialBalanceDate) {
      showToast(`Tento účet je aktivní až od ${formatCzechDate(account.initialBalanceDate)}. Zvolte stejné nebo pozdější datum.`, 'warning');
      return;
    }

    if (account.type === 'investment' || account.type === 'pension') {
      showToast('Korekce zůstatku není povolena pro investiční a penzijní účty.', 'warning');
      return;
    }

    const nextSeq = getNextSequenceForDate(checkDate, data.transactions);
    const currentAccBal = getAccountBalanceAtDate(
      accountId,
      checkDate,
      nextSeq,
      data.transactions,
      data.corrections,
      data.accounts
    );

    const diffInHaler = subHaler(actualBalanceInHaler, currentAccBal);

    if (diffInHaler === 0) {
      showToast('Skutečný stav odpovídá vypočtenému zůstatku. Korekce nebyla nutná.', 'info');
      return;
    }

    const nowIso = new Date().toISOString();
    const corrId = `corr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const newCorrection: BalanceCorrection = {
      id: corrId,
      accountId,
      checkDate,
      sequence: nextSeq,
      type: 'balance_adjustment',
      calculatedBalanceInHaler: currentAccBal,
      actualBalanceInHaler,
      diffInHaler,
      note: note && note.trim() ? note.trim() : 'Aktualizace skutečného stavu',
      createdAt: nowIso,
      updatedAt: nowIso
    };

    const corrTx: Transaction = {
      id: corrId,
      title: 'Korekce zůstatku',
      amountInHaler: Math.abs(diffInHaler),
      date: checkDate,
      sequence: nextSeq,
      type: 'balance_adjustment',
      sourceAccountId: accountId,
      status: 'executed',
      actualAmountInHaler: Math.abs(diffInHaler),
      calculatedBalanceInHaler: currentAccBal,
      actualBalanceInHaler,
      diffInHaler,
      note: note && note.trim() ? note.trim() : 'Aktualizace skutečného stavu',
      createdAt: nowIso,
      updatedAt: nowIso
    };

    setData(prev => {
      const updatedTxs = insertOrUpdateWithSequence(corrTx, nextSeq, prev.transactions);
      return {
        ...prev,
        corrections: [...prev.corrections, newCorrection],
        transactions: updatedTxs
      };
    });

    showToast(`Skutečný zůstatek byl aktualizován. Vytvořena korekce: ${diffInHaler >= 0 ? '+' : ''}${(diffInHaler / 100).toLocaleString('cs-CZ')} Kč.`);
  }, [data.accounts, data.transactions, data.corrections, showToast]);

  const updateMarketValue = useCallback((
    accountId: string,
    marketValueInHaler: number,
    date?: string,
    note?: string,
    investedAmountAdjustmentInHaler?: number
  ) => {
    const account = data.accounts.find(a => a.id === accountId);
    if (!account) return;

    if (account.type !== 'investment' && account.type !== 'pension') {
      showToast('Aktualizace tržní hodnoty je určena pouze pro investiční a penzijní účty.', 'warning');
      return;
    }

    const valuationDate = date && date.trim() ? date.trim() : getTodayInPrague();

    if (account.initialBalanceDate && valuationDate < account.initialBalanceDate) {
      showToast(`Tento účet je aktivní až od ${formatCzechDate(account.initialBalanceDate)}. Zvolte stejné nebo pozdější datum.`, 'warning');
      return;
    }

    const nowIso = new Date().toISOString();

    const snapshot: MarketValueSnapshot = {
      id: `mvs_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      accountId,
      date: valuationDate,
      marketValueInHaler,
      note: note && note.trim() ? note.trim() : undefined,
      createdAt: nowIso,
      updatedAt: nowIso
    };

    setData(prev => {
      const currentAccount = prev.accounts.find(a => a.id === accountId)!;
      const isLatest = !currentAccount.marketValueUpdatedAt || valuationDate >= currentAccount.marketValueUpdatedAt;
      const correction = investedAmountAdjustmentInHaler ??
        getHistoricalInvestmentCorrection(currentAccount, prev.marketValueSnapshots, valuationDate) ??
        (isLatest && valuationDate >= getTodayInPrague() ? currentAccount.investedAmountAdjustmentInHaler ?? 0 : undefined);
      const base = getInvestedAmountAtValuation({ ...currentAccount, investedAmountAdjustmentInHaler: 0 }, prev.transactions, valuationDate);
      return reconcileMarketValueHistory({
        ...prev,
        marketValueSnapshots: [...prev.marketValueSnapshots, {
          ...snapshot,
          createdAt: new Date(prev.marketValueSnapshots.filter(s => s.accountId === accountId)
            .reduce((time, s) => Math.max(time, (Date.parse(s.createdAt) || 0) + 1), Date.parse(nowIso))).toISOString(),
          baseInvestedAmountInHaler: base,
          investedAmountAdjustmentInHaler: correction,
          correctionChanged: correction !== getHistoricalInvestmentCorrection(currentAccount, prev.marketValueSnapshots, valuationDate),
          effectiveInvestedAmountInHaler: correction === undefined ? undefined : addHaler(base, correction),
          correctionPreviouslyZero: currentAccount.investedAmountAdjustmentInHaler === undefined &&
            !prev.marketValueSnapshots.some(s => s.accountId === accountId) || undefined,
        }],
        accounts: prev.accounts.map(a => a.id === accountId ? {
          ...a,
          currentMarketValueInHaler: isLatest ? marketValueInHaler : a.currentMarketValueInHaler,
          ...(isLatest && correction !== undefined && (correction !== 0 || a.investedAmountAdjustmentInHaler !== undefined)
            ? { investedAmountAdjustmentInHaler: correction } : {}),
          marketValueUpdatedAt: isLatest ? valuationDate : a.marketValueUpdatedAt,
          updatedAt: nowIso
        } : a)
      });
    });

    const accountTypeLabel = account.type === 'pension' ? 'penzijního' : 'investičního';
    showToast(`Tržní hodnota ${accountTypeLabel} účtu byla aktualizována.`);
  }, [data.accounts, showToast]);

  const editMarketValue = useCallback((id: string, edit: MarketValueEdit) => {
    setData(prev => mutateMarketValueHistory(prev, id, edit));
    showToast('Tržní ocenění bylo upraveno.');
  }, [setData, showToast]);

  const deleteMarketValue = useCallback((id: string) => {
    setData(prev => mutateMarketValueHistory(prev, id));
    showToast('Tržní ocenění bylo smazáno.');
  }, [setData, showToast]);

  const updateCorrectionNote = useCallback((id: string, note: string) => {
    const nowIso = new Date().toISOString();
    setData(prev => ({
      ...prev,
      transactions: prev.transactions.map(t => t.id === id ? { ...t, note, updatedAt: nowIso } : t),
      corrections: prev.corrections.map(c => c.id === id ? { ...c, note, updatedAt: nowIso } : c)
    }));
    showToast('Poznámka ke korekci byla uložena.');
  }, [showToast]);

  const deleteCorrection = useCallback(async (id: string) => {
    const inTxs = data.transactions.some(t => t.id === id);
    if (inTxs) {
      return deleteTransaction(id);
    }
    setData(prev => ({
      ...prev,
      corrections: prev.corrections.filter(c => c.id !== id)
    }));
    showToast('Korekce zůstatku byla smazána.');
    return true;
  }, [data.transactions, deleteTransaction, showToast]);

  // ------------------- SPRÁVA KATEGORIÍ -------------------

  const addCategory = useCallback((catData: Omit<Category, 'id' | 'createdAt' | 'updatedAt'>) => {
    const nowIso = new Date().toISOString();
    const newCat: Category = {
      ...catData,
      id: `cat_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      createdAt: nowIso,
      updatedAt: nowIso
    };
    setData(prev => ({
      ...prev,
      categories: [...prev.categories, newCat]
    }));
    showToast(`Kategorie „${newCat.name}“ byla vytvořena.`);
    return newCat;
  }, [showToast]);

  const addMainCategory = useCallback((catData: Omit<Category, 'id' | 'createdAt' | 'updatedAt'>) => {
    // Striktní pravidlo: Nová hlavní kategorie má VŽDY parentId = null.
    // Ani ručně upravený požadavek nesmí přes tuto funkci vytvořit podkategorii.
    return addCategory({
      ...catData,
      parentId: null
    });
  }, [addCategory]);

  const updateCategory = useCallback((cat: Category) => {
    setData(prev => {
      const nowIso = new Date().toISOString();
      const original = prev.categories.find(c => c.id === cat.id);
      const isMainCategory = !cat.parentId;
      const colorChanged = !!original && original.color !== cat.color;
      const shouldPropagateColor = isMainCategory && colorChanged;

      return {
        ...prev,
        categories: prev.categories.map(c => {
          if (c.id === cat.id) return { ...cat, updatedAt: nowIso };
          if (shouldPropagateColor && c.parentId === cat.id) {
            return { ...c, color: cat.color, updatedAt: nowIso };
          }
          return c;
        })
      };
    });
    showToast(`Kategorie „${cat.name}“ byla upravena.`);
  }, [showToast]);

  const moveSubcategory = useCallback((subcategoryId: string, newParentId: string, updateHistorical: boolean) => {
    setData(prev => {
      const updatedCategories = prev.categories.map(c => c.id === subcategoryId ? { ...c, parentId: newParentId, updatedAt: new Date().toISOString() } : c);
      let updatedTxs = prev.transactions;
      if (updateHistorical) {
        updatedTxs = prev.transactions.map(t => t.subcategoryId === subcategoryId ? { ...t, categoryId: newParentId, updatedAt: new Date().toISOString() } : t);
      }
      return {
        ...prev,
        categories: updatedCategories,
        transactions: updatedTxs
      };
    });
    showToast('Podkategorie byla přesunuta do nové hlavní kategorie.');
  }, [showToast]);

  const archiveCategory = useCallback((id: string) => {
    setData(prev => ({
      ...prev,
      categories: prev.categories.map(c => (c.id === id || c.parentId === id) ? { ...c, status: 'archived', updatedAt: new Date().toISOString() } : c)
    }));
    showToast('Kategorie byla archivována.');
  }, [showToast]);

  const restoreCategory = useCallback((id: string) => {
    setData(prev => ({
      ...prev,
      categories: prev.categories.map(c => (c.id === id || c.parentId === id) ? { ...c, status: 'active', updatedAt: new Date().toISOString() } : c)
    }));
    showToast('Kategorie byla obnovena.');
  }, [showToast]);

  const deleteCategory = useCallback((id: string) => {
    const isUsedInTxs = data.transactions.some(t => t.categoryId === id || t.subcategoryId === id);
    const isUsedInRules = data.recurringRules.some(r => r.categoryId === id || r.subcategoryId === id);

    if (isUsedInTxs || isUsedInRules) {
      return {
        success: false,
        message: 'Kategorii použitou v historii nebo v trvalých příkazech nelze fyzicky smazat. Můžete ji bezpečně archivovat.'
      };
    }

    setData(prev => ({
      ...prev,
      categories: prev.categories.filter(c => c.id !== id && c.parentId !== id)
    }));
    showToast('Kategorie byla smazána.');
    return { success: true };
  }, [data.transactions, data.recurringRules, showToast]);

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
      showToast('Ukázková data nejsou v produkčním režimu povolena.', 'warning');
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
    });
    showToast('Ukázková data byla úspěšně načtena.');
  }, [showToast]);

  const clearAllTransactions = useCallback((): boolean => {
    // 1. Vytvořit interní recovery zálohu
    const backupCreated = createOperationRecoveryBackup(latestDataRef.current, 'clear_transactions');
    if (!backupCreated) {
      showToast('Chyba: Nepodařilo se vytvořit bezpečnostní recovery zálohu. Mazání transakcí bylo zrušeno.', 'error');
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

    showToast('Všechny finanční položky, pravidla opakovaných plateb a korekce byly vymazány.');
    return true;
  }, [showToast]);

  const clearAllAccounts = useCallback((): boolean => {
    // 1. Vytvořit interní recovery zálohu
    const backupCreated = createOperationRecoveryBackup(latestDataRef.current, 'clear_accounts');
    if (!backupCreated) {
      showToast('Chyba: Nepodařilo se vytvořit bezpečnostní recovery zálohu. Mazání účtů bylo zrušeno.', 'error');
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
      settings: {
        ...latestDataRef.current.settings,
      },
    };

    setData(updated);

    showToast('Všechny účty a navázaná finanční data byly úspěšně vymazány.');
    return true;
  }, [showToast]);

  const clearAllCategories = useCallback((): boolean => {
    // 1. Vytvořit interní recovery zálohu
    const backupCreated = createOperationRecoveryBackup(latestDataRef.current, 'clear_categories');
    if (!backupCreated) {
      showToast('Chyba: Nepodařilo se vytvořit bezpečnostní recovery zálohu. Mazání kategorií bylo zrušeno.', 'error');
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

    showToast('Všechny kategorie byly vymazány. U existujících položek byla nastavena kategorie „Bez kategorie“.');
    return true;
  }, [showToast]);

  const resetAllData = useCallback((): boolean => {
    // 1. Vytvořit interní recovery zálohu
    const backupCreated = createOperationRecoveryBackup(latestDataRef.current, 'clear_all');
    if (!backupCreated) {
      showToast('Chyba: Nepodařilo se vytvořit bezpečnostní recovery zálohu. Kompletní reset byl zrušen.', 'error');
      return false;
    }

    // 2. Kompletní čistý reset: 0 účtů, 0 transakcí, 0 pravidel, 0 korekcí, 0 tržních hodnot, 0 kategorií
    const fresh = createResetAppData();
    controllerRef.current?.change(fresh, true);

    showToast('Všechna data byla kompletně vymazána a aplikace byla uvedena do čistého výchozího stavu.');
    return true;
  }, [showToast]);

  const restoreFromBackupFile = useCallback((jsonStr: string) => {
    const parsed = validateAndParseBackup(jsonStr);
    setData(parsed);

    setLoadState('ready');
    setLoadErrorDetails(null);
    showToast('Záloha byla úspěšně obnovena.');
  }, [showToast]);

  const resetToFreshData = useCallback(() => {
    const fresh = createEmptyAppData();
    controllerRef.current?.change(fresh, true);

    setLoadState('ready');
    setLoadErrorDetails(null);
    showToast('Byla založena čistá instalace.');
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
    showToast('Záloha byla úspěšně stažena.');
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
      showToast('Záloha byla úspěšně sloučena se stávajícími daty.');
      return true;
    } catch (err: any) {
      showToast(`Chyba při obnově: ${err.message}`, 'error');
      return false;
    }
  }, [showToast]);

  const exportCSV = useCallback(() => {
    exportTransactionsCSV(data.transactions, data.accounts, data.categories);
    showToast('Položky byly vyexportovány do CSV.');
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
        latestDataRef.current = next;
        publishData(next);
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

  const setDriveBackupEnabled = useCallback((enabled: boolean) => {
    persistDriveBackupEnabled(enabled);
    setDriveBackupEnabledState(enabled);
  }, []);

  const runDriveBackupNow = useCallback(async () => {
    const token = getValidAccessToken();
    if (!token || !driveUser?.permissionId) {
      showToast('Nejprve se přihlaste ke Google Disku.', 'error');
      return;
    }
    const result = await tryRunDriveBackup(token, driveUser.permissionId, latestDataRef.current, { force: true });
    if (result.ran) {
      setLastDriveBackupTime(new Date());
      showToast('Záloha byla úspěšně nahrána na Google Disk.');
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
    duplicateTransaction,
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
