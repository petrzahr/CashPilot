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
  loadStoredData,
  saveStoredData,
  exportBackupJSON,
  validateAndParseBackup,
  exportTransactionsCSV
} from '../services/storageService';
import {
  DEFAULT_CATEGORIES,
  DEFAULT_SETTINGS,
  DEMO_ACCOUNTS,
  DEMO_RECURRING_RULES,
  DEMO_TRANSACTIONS
} from '../services/demoData';
import { calculateForecast, generateOccurrenceForPeriod, getAccountBalanceAtDate } from '../services/financialEngine';
import {
  createBudgetPeriod,
  generatePeriodsSequence,
  generatePeriodsBetween,
  getNextPeriod,
  getPeriodForDate,
  getPreviousPeriod,
  getPreviousDay,
  getTodayInPrague,
  formatCzechDate
} from '../services/periodService';
import { autoExecuteDueTransactions, getStatusForDate } from '../services/statusService';
import { addHaler, subHaler } from '../services/currencyService';
import {
  DriveFileInfo,
  GoogleUser,
  downloadFromGoogleDrive,
  fetchGoogleUserProfile,
  findAppDataFile,
  getStoredAuth,
  getValidAccessToken,
  isStoredTokenValid,
  loginToGoogle,
  logoutFromGoogle,
  uploadToGoogleDrive,
  mergeCloudAndLocalData,
} from '../services/googleDriveService';


import {
  deleteTransactionAndReorder,
  deleteTransactionsAndReorder,
  getNextSequenceForDate,
  insertOrUpdateWithSequence,
  normalizeDaySequences,
  reorderDayTransactions as reorderDayTxsService,
  sortTransactionsByDateAndSequence
} from '../services/sequenceService';

export type DriveSyncStatus = 'disconnected' | 'idle' | 'syncing' | 'synced' | 'error';

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
  goToNextPeriod: () => void;
  goToPreviousPeriod: () => void;
  goToCurrentPeriod: () => void;
  isCurrentPeriodSelected: boolean;
  forecastSequence: BudgetPeriod[];
  forecast: ForecastResult;

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
    initialStatus?: TransactionStatus
  ) => RecurringRule;
  updateRecurringRule: (
    ruleId: string, 
    mode: 'occurrence' | 'future' | 'series', 
    periodKey: string,
    overrideData: Partial<Transaction>
  ) => void;
  deleteRecurringRule: (id: string) => void;

  // Účty
  addAccount: (account: Omit<Account, 'id' | 'createdAt' | 'updatedAt'>) => Account;
  updateAccount: (account: Account) => { success: boolean; message?: string };
  archiveAccount: (id: string) => { success: boolean; message?: string };
  restoreAccount: (id: string) => void;
  deleteAccount: (id: string) => { success: boolean; message?: string };
  reconcileBalance: (accountId: string, actualBalanceInHaler: number, checkDate: string, note?: string) => void;
  updateMarketValue: (accountId: string, marketValueInHaler: number, date?: string, note?: string) => void;
  updateCorrectionNote: (id: string, note: string) => void;
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

  // Nastavení & Správa dat
  updateSettings: (newSettings: Partial<AppSettings>) => void;
  loadDemoData: () => void;
  clearDemoData: () => void;
  resetAllData: () => void;
  exportJSON: () => void;
  importJSON: (jsonStr: string) => boolean;
  exportCSV: () => void;
  // Google Drive Synchronizace
  driveSyncStatus: DriveSyncStatus;
  isDriveConnected: boolean;
  driveUser: GoogleUser | null;
  lastDriveSyncTime: Date | null;
  driveError: string | null;
  connectGoogleDrive: () => Promise<void>;
  disconnectGoogleDrive: () => Promise<void>;
  syncWithGoogleDrive: (forceDirection?: 'upload' | 'download') => Promise<void>;
}

const FinanceContext = createContext<FinanceContextType | null>(null);

export const FinanceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [data, setData] = useState<AppData>(() => {
    const raw = loadStoredData();
    // Normalizovat všechny položky po dnech na souvislou řadu 1, 2, 3...
    const uniqueDates = Array.from(new Set(raw.transactions.map(t => t.date)));
    const normalizedAll: Transaction[] = [];
    uniqueDates.forEach(date => {
      const dayTxs = raw.transactions.filter(t => t.date === date);
      normalizedAll.push(...normalizeDaySequences(dayTxs));
    });
    return {
      ...raw,
      transactions: sortTransactionsByDateAndSequence(normalizedAll)
    };
  });

  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    saveStoredData(data);
  }, [data]);

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
    const forecastMonths = data.settings.forecastMonths || 12;

    const baseForecastPeriods = generatePeriodsSequence(
      currentPeriod.year,
      currentPeriod.month,
      forecastMonths,
      startDay
    );
    const lastForecastPeriod = baseForecastPeriods[baseForecastPeriods.length - 1];

    let earliestPeriod = currentPeriod;
    let latestPeriod = lastForecastPeriod;

    if (selectedPeriod.startDate < earliestPeriod.startDate) {
      earliestPeriod = selectedPeriod;
    }
    if (selectedPeriod.startDate > latestPeriod.startDate) {
      latestPeriod = selectedPeriod;
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
    data.transactions,
    data.corrections,
    data.marketValueSnapshots,
    data.recurringRules,
    data.accounts,
    data.settings.budgetStartDay,
    data.settings.forecastMonths
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
      data.settings.forecastMonths || 12,
      data.settings.budgetStartDay
    );
  }, [forecast.forecastPeriods, currentPeriod.year, currentPeriod.month, data.settings.forecastMonths, data.settings.budgetStartDay]);

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
      return {
        ...prev,
        transactions: updated,
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

          const updatedTxs = deleteTransactionsAndReorder(idsToDelete, prev.transactions);

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
    initialStatus?: TransactionStatus
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
      let targetSeq = initialSequence && initialSequence > 0
        ? Math.round(initialSequence)
        : getNextSequenceForDate(newRule.startDate, prev.transactions);

      const firstOccurrenceTx: Transaction = {
        id: `tx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        title: newRule.title,
        amountInHaler: newRule.amountInHaler,
        plannedAmountInHaler: newRule.amountInHaler,
        actualAmountInHaler: effectiveStatus === 'executed' ? newRule.amountInHaler : undefined,
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
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      const updatedTxs = insertOrUpdateWithSequence(firstOccurrenceTx, targetSeq, prev.transactions);

      return {
        ...prev,
        recurringRules: [...prev.recurringRules, newRule],
        transactions: updatedTxs,
      };
    });

    showToast(`Pravidelná položka „${newRule.title}“ byla vytvořena.`);
    return newRule;
  }, [showToast]);

  const updateRecurringRule = useCallback((
    ruleId: string,
    mode: 'occurrence' | 'future' | 'series',
    periodKey: string,
    overrideData: Partial<Transaction>
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

      if (mode === 'future') {
        const nowIso = new Date().toISOString();
        const updatedRule: RecurringRule = {
          ...rule,
          endDate: overrideData.date ? overrideData.date : periodKey + '-14',
          updatedAt: nowIso
        };

        const newFutureRule: RecurringRule = {
          ...rule,
          id: `rec_${Date.now()}_split`,
          title: overrideData.title || rule.title,
          amountInHaler: overrideData.amountInHaler !== undefined ? overrideData.amountInHaler : rule.amountInHaler,
          startDate: overrideData.date || periodKey + '-15',
          sourceAccountId: overrideData.sourceAccountId || rule.sourceAccountId,
          targetAccountId: overrideData.targetAccountId || rule.targetAccountId,
          categoryId: overrideData.categoryId || rule.categoryId,
          subcategoryId: overrideData.subcategoryId || rule.subcategoryId,
          updatedAt: nowIso,
          createdAt: nowIso
        };

        return {
          ...prev,
          recurringRules: [...prev.recurringRules.map(r => r.id === ruleId ? updatedRule : r), newFutureRule]
        };
      }

      const updatedSeries: RecurringRule = {
        ...rule,
        title: overrideData.title || rule.title,
        amountInHaler: overrideData.amountInHaler !== undefined ? overrideData.amountInHaler : rule.amountInHaler,
        sourceAccountId: overrideData.sourceAccountId || rule.sourceAccountId,
        targetAccountId: overrideData.targetAccountId || rule.targetAccountId,
        categoryId: overrideData.categoryId || rule.categoryId,
        subcategoryId: overrideData.subcategoryId || rule.subcategoryId,
        note: overrideData.note !== undefined ? overrideData.note : rule.note,
        updatedAt: new Date().toISOString()
      };

      return {
        ...prev,
        recurringRules: prev.recurringRules.map(r => r.id === ruleId ? updatedSeries : r)
      };
    });

    showToast('Pravidelná položka byla úspěšně upravena.');
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
      return {
        ...prev,
        accounts: [...accounts, newAcc]
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
    note?: string
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
      const isLatest = !account.marketValueUpdatedAt || valuationDate >= account.marketValueUpdatedAt;
      return {
        ...prev,
        marketValueSnapshots: [...prev.marketValueSnapshots, snapshot],
        accounts: prev.accounts.map(a => a.id === accountId ? {
          ...a,
          currentMarketValueInHaler: isLatest ? marketValueInHaler : a.currentMarketValueInHaler,
          marketValueUpdatedAt: isLatest ? valuationDate : a.marketValueUpdatedAt,
          updatedAt: nowIso
        } : a)
      };
    });

    const accountTypeLabel = account.type === 'pension' ? 'penzijního' : 'investičního';
    showToast(`Tržní hodnota ${accountTypeLabel} účtu byla aktualizována.`);
  }, [data.accounts, showToast]);

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
    setData(prev => ({
      ...prev,
      categories: prev.categories.map(c => c.id === cat.id ? { ...cat, updatedAt: new Date().toISOString() } : c)
    }));
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

  const loadDemoData = useCallback(() => {
    setData({
      version: 1,
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

  const clearDemoData = useCallback(() => {
    setData(prev => ({
      ...prev,
      transactions: [],
      recurringRules: [],
      recurringExceptions: [],
      corrections: [],
      marketValueSnapshots: []
    }));
    showToast('Ukázková data byla odstraněna.');
  }, [showToast]);

  const resetAllData = useCallback(() => {
    setData({
      version: 1,
      settings: { ...DEFAULT_SETTINGS },
      accounts: [],
      categories: [...DEFAULT_CATEGORIES],
      transactions: [],
      recurringRules: [],
      recurringExceptions: [],
      corrections: [],
      marketValueSnapshots: [],
    });
    showToast('Všechna data byla vymazána.');
  }, [showToast]);

  const exportJSON = useCallback(() => {
    exportBackupJSON(data);
    showToast('Záloha byla úspěšně stažena.');
  }, [data, showToast]);

  const importJSON = useCallback((jsonStr: string): boolean => {
    try {
      const parsed = validateAndParseBackup(jsonStr);
      // Doplnit pořadí (sequence) pro starší zálohy a normalizovat na 1, 2, 3...
      const rawTxs = (parsed.transactions || []).map((t: Transaction, i: number) => ({
        ...t,
        sequence: t.sequence !== undefined ? t.sequence : (i + 1)
      }));
      const txs = normalizeDaySequences(rawTxs);
      setData({
        ...parsed,
        transactions: sortTransactionsByDateAndSequence(txs)
      });
      showToast('Záloha byla úspěšně obnovena.');
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

  // Google Drive synchronizace stav
  const [driveSyncStatus, setDriveSyncStatus] = useState<DriveSyncStatus>(() => {
    return isStoredTokenValid() ? 'idle' : 'disconnected';
  });
  const [isDriveConnected, setIsDriveConnected] = useState<boolean>(() => isStoredTokenValid());
  const [driveUser, setDriveUser] = useState<GoogleUser | null>(() => getStoredAuth()?.user || null);
  const [lastDriveSyncTime, setLastDriveSyncTime] = useState<Date | null>(null);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [driveFileId, setDriveFileId] = useState<string | null>(() => {
    try {
      return localStorage.getItem('cashpilot_drive_file_id') || null;
    } catch {
      return null;
    }
  });
  const driveFileIdRef = useRef<string | null>(driveFileId);
  const isRemoteUpdateRef = useRef<boolean>(false);
  const latestDataRef = useRef<AppData>(data);
  latestDataRef.current = data;

  useEffect(() => {
    driveFileIdRef.current = driveFileId;
    try {
      if (driveFileId) {
        localStorage.setItem('cashpilot_drive_file_id', driveFileId);
      } else {
        localStorage.removeItem('cashpilot_drive_file_id');
      }
    } catch {}
  }, [driveFileId]);

  // Při načtení aplikace tiše synchronizovat s Google Diskem na pozadí (Silent Cloud-First)
  useEffect(() => {
    if (isStoredTokenValid()) {
      const token = getValidAccessToken();
      if (!token) return;

      if (!driveUser) {
        fetchGoogleUserProfile(token).then(u => {
          if (u) setDriveUser(u);
        }).catch(() => {});
      }

      // Tiché stažení a sloučení z Google Disku na pozadí
      (async () => {
        try {
          setDriveSyncStatus('syncing');
          let fileId = driveFileIdRef.current;
          if (!fileId) {
            const found = await findAppDataFile(token);
            fileId = found?.id || null;
            if (fileId) {
              setDriveFileId(fileId);
              driveFileIdRef.current = fileId;
            }
          }

          if (fileId) {
            const remote = await downloadFromGoogleDrive(token, fileId);
            const validatedRemote = validateAndParseBackup(JSON.stringify(remote));
            const { mergedData, hasLocalAdditions } = mergeCloudAndLocalData(validatedRemote, latestDataRef.current);

            isRemoteUpdateRef.current = true;
            setData(mergedData);
            saveStoredData(mergedData);

            if (hasLocalAdditions) {
              await uploadToGoogleDrive(token, mergedData, fileId);
            }

            setDriveSyncStatus('synced');
            setLastDriveSyncTime(new Date());
            setDriveError(null);
          } else {
            // Soubor na Disku ještě nebyl vytvořen, nahrajeme aktuální lokální data
            const uploaded = await uploadToGoogleDrive(token, latestDataRef.current);
            setDriveFileId(uploaded.id);
            driveFileIdRef.current = uploaded.id;
            setDriveSyncStatus('synced');
            setLastDriveSyncTime(new Date());
            setDriveError(null);
          }
        } catch (err: any) {
          console.warn('Chyba při tiché úvodní synchronizaci s Google Diskem:', err);
          setDriveSyncStatus('idle');
        }
      })();
    }
  }, []);

  const connectGoogleDrive = useCallback(async () => {
    try {
      setDriveSyncStatus('syncing');
      setDriveError(null);
      const token = await loginToGoogle();
      setIsDriveConnected(true);

      const user = await fetchGoogleUserProfile(token);
      if (user) {
        setDriveUser(user);
      }

      const file = await findAppDataFile(token);
      if (file) {
        setDriveFileId(file.id);
        driveFileIdRef.current = file.id;
        const remote = await downloadFromGoogleDrive(token, file.id);
        const validatedRemote = validateAndParseBackup(JSON.stringify(remote));
        const { mergedData, hasLocalAdditions } = mergeCloudAndLocalData(validatedRemote, latestDataRef.current);

        isRemoteUpdateRef.current = true;
        setData(mergedData);
        saveStoredData(mergedData);

        if (hasLocalAdditions) {
          await uploadToGoogleDrive(token, mergedData, file.id);
        }

        setDriveSyncStatus('synced');
        setLastDriveSyncTime(new Date());
        showToast('Google Disk byl úspěšně připojen a synchronizován.', 'success');
      } else {
        const uploaded = await uploadToGoogleDrive(token, latestDataRef.current);
        setDriveFileId(uploaded.id);
        driveFileIdRef.current = uploaded.id;
        setDriveSyncStatus('synced');
        setLastDriveSyncTime(new Date());
        showToast('Google Disk byl úspěšně připojen a data uložena.', 'success');
      }
    } catch (err: any) {
      console.error('Chyba při připojování Google Disku:', err);
      setDriveSyncStatus('error');
      setDriveError(err?.message || 'Chyba při připojení ke Google Disku');
      showToast(err?.message || 'Nepodařilo se připojit Google Disk', 'error');
    }
  }, [showToast]);

  const disconnectGoogleDrive = useCallback(async () => {
    try {
      await logoutFromGoogle();
    } catch (e) {
      console.warn('Chyba při odhlašování:', e);
    }
    // Bezpečné vyčištění stavu aplikace a lokální mezipaměti
    try {
      localStorage.removeItem('cashpilot_data_v1');
      localStorage.removeItem('cashpilot_drive_file_id');
    } catch {}
    setData(getInitialData());
    setIsDriveConnected(false);
    setDriveSyncStatus('disconnected');
    setDriveUser(null);
    setDriveFileId(null);
    driveFileIdRef.current = null;
    setDriveError(null);
    showToast('Byli jste úspěšně odhlášeni.', 'info');
  }, [showToast]);

  const syncWithGoogleDrive = useCallback(async (forceDirection?: 'upload' | 'download') => {
    const token = getValidAccessToken();
    if (!token) {
      showToast('Nejste přihlášeni ke Google Disku.', 'warning');
      setIsDriveConnected(false);
      setDriveSyncStatus('disconnected');
      return;
    }

    try {
      setDriveSyncStatus('syncing');
      setDriveError(null);

      let fileId = driveFileIdRef.current;
      if (!fileId) {
        const found = await findAppDataFile(token);
        fileId = found?.id || null;
        if (fileId) {
          setDriveFileId(fileId);
          driveFileIdRef.current = fileId;
        }
      }

      if (forceDirection === 'download' && fileId) {
        const remote = await downloadFromGoogleDrive(token, fileId);
        const validatedRemote = validateAndParseBackup(JSON.stringify(remote));
        isRemoteUpdateRef.current = true;
        setData(validatedRemote);
        saveStoredData(validatedRemote);
        setDriveSyncStatus('synced');
        setLastDriveSyncTime(new Date());
        showToast('Data byla úspěšně stažena z Google Disku.', 'success');
        return;
      }

      if (forceDirection === 'upload') {
        const uploaded = await uploadToGoogleDrive(token, latestDataRef.current, fileId || undefined);
        setDriveFileId(uploaded.id);
        driveFileIdRef.current = uploaded.id;
        setDriveSyncStatus('synced');
        setLastDriveSyncTime(new Date());
        showToast('Data byla úspěšně nahrána na Google Disk.', 'success');
        return;
      }

      // Tichá synchronizace (Cloud-First s lokálním sloučením)
      if (fileId) {
        const remote = await downloadFromGoogleDrive(token, fileId);
        const validatedRemote = validateAndParseBackup(JSON.stringify(remote));
        const { mergedData, hasLocalAdditions } = mergeCloudAndLocalData(validatedRemote, latestDataRef.current);

        isRemoteUpdateRef.current = true;
        setData(mergedData);
        saveStoredData(mergedData);

        if (hasLocalAdditions) {
          await uploadToGoogleDrive(token, mergedData, fileId);
        }
      } else {
        const uploaded = await uploadToGoogleDrive(token, latestDataRef.current);
        setDriveFileId(uploaded.id);
        driveFileIdRef.current = uploaded.id;
      }

      setDriveSyncStatus('synced');
      setLastDriveSyncTime(new Date());
      showToast('Synchronizace s Google Diskem proběhla úspěšně.', 'success');
    } catch (err: any) {
      console.error('Chyba při synchronizaci:', err);
      setDriveSyncStatus('error');
      setDriveError(err?.message || 'Chyba při synchronizaci');
      showToast(err?.message || 'Chyba při synchronizaci', 'error');
    }
  }, [showToast]);

  // Automatická debouncovaná synchronizace na pozadí při změně dat
  const isFirstRender = useRef(true);
  const uploadDebounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    if (isRemoteUpdateRef.current) {
      isRemoteUpdateRef.current = false;
      return;
    }

    if (!isDriveConnected) return;

    const token = getValidAccessToken();
    if (!token) return;

    if (uploadDebounceTimer.current) {
      clearTimeout(uploadDebounceTimer.current);
    }

    setDriveSyncStatus('syncing');

    uploadDebounceTimer.current = setTimeout(async () => {
      try {
        const validToken = getValidAccessToken();
        if (!validToken) {
          setDriveSyncStatus('disconnected');
          setIsDriveConnected(false);
          return;
        }
        let fileId = driveFileIdRef.current;
        if (!fileId) {
          const found = await findAppDataFile(validToken);
          fileId = found?.id || null;
          if (fileId) {
            setDriveFileId(fileId);
            driveFileIdRef.current = fileId;
          }
        }
        const uploaded = await uploadToGoogleDrive(validToken, latestDataRef.current, fileId || undefined);
        setDriveFileId(uploaded.id);
        driveFileIdRef.current = uploaded.id;
        setDriveSyncStatus('synced');
        setLastDriveSyncTime(new Date());
        setDriveError(null);
      } catch (err: any) {
        console.error('Chyba při automatickém ukládání na Google Disk:', err);
        setDriveSyncStatus('error');
        setDriveError(err?.message || 'Chyba při synchronizaci');
      }
    }, 1500);

    return () => {
      if (uploadDebounceTimer.current) {
        clearTimeout(uploadDebounceTimer.current);
      }
    };
  }, [data, isDriveConnected]);



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

  const value = {
    data,
    settings: data.settings,
    accounts: data.accounts,
    categories: data.categories,
    transactions: data.transactions,
    recurringRules: data.recurringRules,
    recurringExceptions: data.recurringExceptions,
    corrections: data.corrections,
    marketValueSnapshots: data.marketValueSnapshots,

    currentPeriod,
    selectedPeriod,
    setSelectedPeriod,
    goToNextPeriod,
    goToPreviousPeriod,
    goToCurrentPeriod,
    isCurrentPeriodSelected,
    forecastSequence,
    forecast,

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

    addAccount,
    updateAccount,
    archiveAccount,
    restoreAccount,
    deleteAccount,
    reconcileBalance,
    updateMarketValue,
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

    updateSettings,
    loadDemoData,
    clearDemoData,
    resetAllData,
    exportJSON,
    importJSON,
    exportCSV,

    // Google Drive
    driveSyncStatus,
    isDriveConnected,
    driveUser,
    lastDriveSyncTime,
    driveError,
    connectGoogleDrive,
    disconnectGoogleDrive,
    syncWithGoogleDrive,
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
