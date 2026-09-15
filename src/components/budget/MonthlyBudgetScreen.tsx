import React, { useState, useMemo } from 'react';
import { useFinance } from '../../context/FinanceContext';
import { addHaler, formatCurrency, halerToCzk, subHaler } from '../../services/currencyService';
import { formatCzechDate } from '../../services/periodService';
import { calculateIntraDayRunningBalances } from '../../services/sequenceService';
import { calculatePeriodInvestmentChange } from '../../services/investmentPerformanceService';
import { MovementType, Transaction, TransactionStatus } from '../../types/finance';
import { 
  Plus, 
  Check, 
  Copy, 
  Trash2, 
  Ban, 
  Edit3, 
  ArrowRightLeft, 
  Filter, 
  Search, 
  ShieldCheck, 
  AlertTriangle,
  AlertCircle,
  GripVertical,
  List,
  Calendar,
  Hash,
  ChevronDown,
  Clock,
  Loader2,
  Eye,
  SlidersHorizontal
} from 'lucide-react';
import { getEffectiveTransactionsForPeriod } from '../../services/financialEngine';
import { DeleteTransactionModal } from '../transactions/DeleteTransactionModal';
import { CorrectionDetailModal } from '../accounts/CorrectionDetailModal';
import { czechStringCompare, sortCategoriesAlphabetically } from '../../services/categoryService';

interface MonthlyBudgetScreenProps {
  onOpenTransactionModal: (initialDate?: string, initialType?: MovementType) => void;
  onEditTransaction: (tx: Transaction) => void;
}

export const MonthlyBudgetScreen: React.FC<MonthlyBudgetScreenProps> = ({
  onOpenTransactionModal,
  onEditTransaction,
}) => {
  const {
    selectedPeriod,
    forecast,
    settings,
    accounts,
    categories,
    transactions,
    recurringRules,
    recurringExceptions,
    marketValueSnapshots = [],
    duplicateTransaction,
    setTransactionStatus,
    markTransactionExecuted,
    cancelTransaction,
    deleteTransaction,
    reorderDayTransactions,
    showToast,
  } = useFinance();

  // Režim zobrazení: po dnech s drag & drop vs klasický seznam
  const [viewMode, setViewMode] = useState<'daily' | 'list'>('daily');
  const [draggedTxId, setDraggedTxId] = useState<string | null>(null);

  // Stav probíhající změny stavu položky a otevřeného menu
  const [updatingStatusTxId, setUpdatingStatusTxId] = useState<string | null>(null);
  const [activeStatusMenuTxId, setActiveStatusMenuTxId] = useState<string | null>(null);

  // Stav mazání položky
  const [deletingTx, setDeletingTx] = useState<Transaction | null>(null);
  const [isDeletingTx, setIsDeletingTx] = useState(false);

  // Stav vybrané korekce pro detail modal
  const [selectedCorrection, setSelectedCorrection] = useState<Transaction | null>(null);

  const deletingTxHasExecutedHistorical = useMemo(() => {
    if (!deletingTx) return false;
    let ruleId = deletingTx.recurringRuleId;
    if (!ruleId && deletingTx.id.startsWith('virtual_')) {
      const withoutPrefix = deletingTx.id.slice('virtual_'.length);
      const lastUnderscore = withoutPrefix.lastIndexOf('_');
      if (lastUnderscore !== -1) {
        ruleId = withoutPrefix.slice(0, lastUnderscore);
      }
    }
    if (!ruleId) return false;
    return transactions.some(t => t.recurringRuleId === ruleId && t.status === 'executed');
  }, [deletingTx, transactions]);

  const handleStatusChange = async (txId: string, newStatus: TransactionStatus) => {
    if (updatingStatusTxId) return; // Zabraň vícenásobnému kliknutí
    setUpdatingStatusTxId(txId);
    setActiveStatusMenuTxId(null);
    try {
      await new Promise(resolve => setTimeout(resolve, 60));
      setTransactionStatus(txId, newStatus);
    } catch (err) {
      console.error(err);
      showToast('Při změně stavu položky došlo k chybě.', 'error');
    } finally {
      setUpdatingStatusTxId(null);
    }
  };

  const renderStatusBadge = (tx: Transaction) => {
    const isUpdating = updatingStatusTxId === tx.id;
    const isMenuOpen = activeStatusMenuTxId === tx.id;

    let badgeClass = 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100';
    let Icon = Clock;
    let label = 'Plánovaná';

    if (tx.status === 'executed') {
      badgeClass = 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100';
      Icon = Check;
      label = 'Uskutečněná';
    } else if (tx.status === 'cancelled') {
      badgeClass = 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200';
      Icon = Ban;
      label = 'Zrušená';
    }

    return (
      <div className="relative inline-block text-left" onClick={(e) => e.stopPropagation()}>
        {isMenuOpen && (
          <div
            className="fixed inset-0 z-20 cursor-default"
            onClick={(e) => {
              e.stopPropagation();
              setActiveStatusMenuTxId(null);
            }}
          />
        )}
        <button
          type="button"
          disabled={isUpdating}
          onClick={(e) => {
            e.stopPropagation();
            setActiveStatusMenuTxId(isMenuOpen ? null : tx.id);
          }}
          title="Změnit stav položky (Plánovaná, Uskutečněná, Zrušená)"
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-all cursor-pointer select-none ${badgeClass} ${
            isUpdating ? 'opacity-70 cursor-wait' : ''
          }`}
        >
          {isUpdating ? (
            <Loader2 className="w-3 h-3 animate-spin text-sky-600" />
          ) : (
            <Icon className="w-3 h-3 shrink-0" />
          )}
          <span>{label}</span>
          <ChevronDown className={`w-2.5 h-2.5 opacity-60 transition-transform ${isMenuOpen ? 'rotate-180' : ''}`} />
        </button>

        {isMenuOpen && (
          <div
            className="absolute left-0 top-full mt-1 z-30 bg-white rounded-xl shadow-lg border border-slate-200 py-1 min-w-[140px] text-xs font-normal"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              disabled={isUpdating}
              onClick={() => handleStatusChange(tx.id, 'planned')}
              className={`w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-slate-50 transition-colors ${
                tx.status === 'planned' ? 'font-bold text-amber-700 bg-amber-50/60' : 'text-slate-700'
              }`}
            >
              <Clock className="w-3.5 h-3.5 text-amber-600" />
              <span>Plánovaná</span>
              {tx.status === 'planned' && <Check className="w-3 h-3 ml-auto text-amber-600" />}
            </button>
            <button
              type="button"
              disabled={isUpdating}
              onClick={() => handleStatusChange(tx.id, 'executed')}
              className={`w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-slate-50 transition-colors ${
                tx.status === 'executed' ? 'font-bold text-emerald-700 bg-emerald-50/60' : 'text-slate-700'
              }`}
            >
              <Check className="w-3.5 h-3.5 text-emerald-600" />
              <span>Uskutečněná</span>
              {tx.status === 'executed' && <Check className="w-3 h-3 ml-auto text-emerald-600" />}
            </button>
            <button
              type="button"
              disabled={isUpdating}
              onClick={() => handleStatusChange(tx.id, 'cancelled')}
              className={`w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-slate-50 transition-colors ${
                tx.status === 'cancelled' ? 'font-bold text-slate-700 bg-slate-100' : 'text-slate-700'
              }`}
            >
              <Ban className="w-3.5 h-3.5 text-slate-500" />
              <span>Zrušená</span>
              {tx.status === 'cancelled' && <Check className="w-3 h-3 ml-auto text-slate-600" />}
            </button>
          </div>
        )}
      </div>
    );
  };

  // Filtry v rámci období
  const [searchQuery, setSearchQuery] = useState('');
  const [filterAccount, setFilterAccount] = useState<string>('');
  const [filterCategory, setFilterCategory] = useState<string>('');
  const [filterType, setFilterType] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');

  // Souhrn pro vybranou periodu z forecastu
  const currentSummary = useMemo(() => {
    return forecast.periods.find(p => p.period.key === selectedPeriod.key) || {
      period: selectedPeriod,
      openingBalanceInHaler: 0,
      incomeInHaler: 0,
      expenseInHaler: 0,
      transfersInHaler: 0,
      correctionsInHaler: 0,
      netChangeInHaler: 0,
      closingBalanceInHaler: 0,
      usableOpeningInHaler: 0,
      usableClosingInHaler: 0,
      usableNetChangeInHaler: 0,
      netWorthOpeningInHaler: 0,
      netWorthClosingInHaler: 0,
      isNegativeBalance: false,
      isBelowReserve: false,
      minUsableBalanceInHaler: 0,
      accountBalances: {},
    };
  }, [forecast.periods, selectedPeriod.key]);

  // Souhrnné ukazatele za všechny účty, respektující vybrané rozpočtové období
  const aggregateSummary = useMemo(() => {
    const savedInHaler = accounts
      .filter(a => a.type === 'savings' && a.status === 'active')
      .reduce((sum, acc) => {
        const bal = currentSummary.accountBalances[acc.id];
        return bal ? addHaler(sum, subHaler(bal.transfersInInHaler, bal.transfersOutInHaler)) : sum;
      }, 0);

    const investedInHaler = accounts
      .filter(a => (a.type === 'investment' || a.type === 'pension') && a.status === 'active')
      .reduce((sum, acc) => {
        const bal = currentSummary.accountBalances[acc.id];
        return bal ? addHaler(sum, subHaler(bal.transfersInInHaler, bal.transfersOutInHaler)) : sum;
      }, 0);

    const income = currentSummary.incomeInHaler;
    const savedPct = income > 0 ? (savedInHaler / income) * 100 : null;
    const investedPct = income > 0 ? (investedInHaler / income) * 100 : null;

    const investmentChange = calculatePeriodInvestmentChange(
      accounts, marketValueSnapshots, selectedPeriod, settings.budgetStartDay
    );

    return {
      usableClosingInHaler: currentSummary.usableClosingInHaler,
      netWorthClosingInHaler: currentSummary.netWorthClosingInHaler,
      savedInHaler, savedPct, investedInHaler, investedPct, investmentChange,
    };
  }, [accounts, currentSummary, marketValueSnapshots, selectedPeriod, settings.budgetStartDay]);

  const formatPercent = (value: number | null) => value === null
    ? '—'
    : `${new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 1 }).format(value)} %`;

  // Všechny efektivní položky v tomto období (pro souhrny kategorií a převody)
  const allPeriodTransactions = useMemo(() => {
    return getEffectiveTransactionsForPeriod(
      selectedPeriod,
      transactions,
      recurringRules,
      recurringExceptions,
      settings.budgetStartDay
    );
  }, [selectedPeriod, transactions, recurringRules, recurringExceptions, settings.budgetStartDay]);

  // Filtrované položky v tomto období (pro tabulku a denní seskupení)
  const periodTransactions = useMemo(() => {
    return allPeriodTransactions.filter(tx => {
      if (searchQuery.trim() && !tx.title.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }
      if (filterAccount && tx.sourceAccountId !== filterAccount && tx.targetAccountId !== filterAccount) {
        return false;
      }
      if (filterCategory && tx.categoryId !== filterCategory && tx.subcategoryId !== filterCategory) {
        return false;
      }
      if (filterType && tx.type !== filterType) {
        return false;
      }
      if (filterStatus && tx.status !== filterStatus) {
        return false;
      }
      return true;
    }).sort((a, b) => a.date.localeCompare(b.date));
  }, [
    allPeriodTransactions,
    searchQuery,
    filterAccount,
    filterCategory,
    filterType,
    filterStatus
  ]);

  // Seskupení položek podle jednotlivých dnů s výpočtem denního průběžného zůstatku
  const dayGroups = useMemo(() => {
    const dateMap = new Map<string, Transaction[]>();

    periodTransactions.forEach(tx => {
      const existing = dateMap.get(tx.date) || [];
      existing.push(tx);
      dateMap.set(tx.date, existing);
    });

    const sortedDates = Array.from(dateMap.keys()).sort();
    let runningBalance = currentSummary.usableOpeningInHaler;

    return sortedDates.map(date => {
      const dayTxs = dateMap.get(date)!;
      const intraDay = calculateIntraDayRunningBalances(runningBalance, dayTxs);
      runningBalance = intraDay.endOfDayBalanceInHaler;

      return {
        date,
        txs: dayTxs,
        intraDay,
      };
    });
  }, [periodTransactions, currentSummary.usableOpeningInHaler]);

  // Drag-and-drop obsluha
  const handleDragStart = (e: React.DragEvent, txId: string) => {
    e.dataTransfer.setData('text/plain', txId);
    setDraggedTxId(txId);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (date: string, targetTxId: string) => {
    if (!draggedTxId || draggedTxId === targetTxId) {
      setDraggedTxId(null);
      return;
    }

    const dayGroup = dayGroups.find(g => g.date === date);
    if (!dayGroup) return;

    const currentIds = dayGroup.txs.map(t => t.id);
    const draggedIdx = currentIds.indexOf(draggedTxId);
    const targetIdx = currentIds.indexOf(targetTxId);

    if (draggedIdx === -1 || targetIdx === -1) {
      setDraggedTxId(null);
      return;
    }

    const newOrderedIds = [...currentIds];
    const [movedItem] = newOrderedIds.splice(draggedIdx, 1);
    newOrderedIds.splice(targetIdx, 0, movedItem);

    reorderDayTransactions(date, newOrderedIds);
    setDraggedTxId(null);
  };

  // Dynamické seskupení rozpočtu podle hlavních kategorií:
  // 1. všechny příjmové kategorie abecedně od A do Z,
  // 2. následně všechny výdajové kategorie abecedně od A do Z.
  const mainCategories = useMemo(() => {
    const activeMains = categories.filter(c => !c.parentId && c.status === 'active');
    const incomeMains = sortCategoriesAlphabetically(activeMains.filter(c => c.type === 'income'));
    const expenseMains = sortCategoriesAlphabetically(activeMains.filter(c => c.type !== 'income'));
    return [...incomeMains, ...expenseMains];
  }, [categories]);

  const categoryBreakdown = useMemo(() => {
    const result: {
      category: typeof mainCategories[0];
      totalInHaler: number;
      subcategories: { sub: typeof categories[0]; totalInHaler: number }[];
    }[] = [];

    mainCategories.forEach(mainCat => {
      const subs = sortCategoriesAlphabetically(categories.filter(c => c.parentId === mainCat.id));
      let catTotal = 0;
      const subItems = subs.map(sub => {
        // Spočítat částky pro tuto podkategorii v dané periodě
        const matchingTxs = allPeriodTransactions.filter(t => 
          t.status !== 'cancelled' && 
          t.subcategoryId === sub.id
        );
        const subSum = matchingTxs.reduce((sum, t) => {
          const amt = t.status === 'executed' && t.actualAmountInHaler !== undefined ? t.actualAmountInHaler : t.amountInHaler;
          return sum + amt;
        }, 0);
        catTotal += subSum;
        return { sub, totalInHaler: subSum };
      });

      // Přičíst i položky přímo přiřazené hlavní kategorii (bez explicitní podkategorie)
      const directTxs = allPeriodTransactions.filter(t => t.status !== 'cancelled' && t.categoryId === mainCat.id && !t.subcategoryId);
      const directSum = directTxs.reduce((sum, t) => {
        const amt = t.status === 'executed' && t.actualAmountInHaler !== undefined ? t.actualAmountInHaler : t.amountInHaler;
        return sum + amt;
      }, 0);
      catTotal += directSum;

      result.push({
        category: mainCat,
        totalInHaler: catTotal,
        subcategories: subItems
          .filter(s => s.totalInHaler > 0)
          .sort((a, b) => czechStringCompare(a.sub.name, b.sub.name)),
      });
    });

    return result;
  }, [mainCategories, categories, allPeriodTransactions]);

  // Převody v této periodě
  const transferTxs = useMemo(() => {
    return allPeriodTransactions.filter(t => t.type === 'transfer' && t.status !== 'cancelled');
  }, [allPeriodTransactions]);

  const totalTransfersInHaler = useMemo(() => {
    return transferTxs.reduce((sum, t) => sum + t.amountInHaler, 0);
  }, [transferTxs]);

  // Výchozí účet a jeho souhrnné údaje
  const defaultAccount = useMemo(() => {
    return accounts.find(a => a.isDefault && a.status !== 'archived');
  }, [accounts]);

  const defaultAccountBalance = useMemo(() => {
    if (!defaultAccount) return null;
    return currentSummary.accountBalances[defaultAccount.id] || null;
  }, [defaultAccount, currentSummary]);

  const defaultOpeningBalance = defaultAccountBalance?.openingBalanceInHaler ?? 0;
  const defaultIncomeBalance = defaultAccountBalance?.incomeInHaler ?? 0;
  const defaultExpenseBalance = defaultAccountBalance?.expenseInHaler ?? 0;
  const defaultTransfersIn = defaultAccountBalance?.transfersInInHaler ?? 0;
  const defaultTransfersOut = defaultAccountBalance?.transfersOutInHaler ?? 0;
  const defaultNetTransfers = defaultTransfersIn - defaultTransfersOut;
  const defaultCorrections = defaultAccountBalance?.correctionsInHaler ?? 0;
  const defaultInitDate = defaultAccount?.initialBalanceDate || '1970-01-01';
  const defaultBaseInitialToAdd = (defaultInitDate > selectedPeriod.startDate && defaultInitDate <= selectedPeriod.endDate)
    ? (defaultAccount?.initialBalanceInHaler || 0)
    : 0;
  const defaultNetChange = defaultIncomeBalance - defaultExpenseBalance + defaultNetTransfers + defaultCorrections + defaultBaseInitialToAdd;
  const defaultClosingBalance = defaultAccountBalance?.closingBalanceInHaler ?? (defaultOpeningBalance + defaultNetChange);
  const overdraftLimit = settings.overdraftLimitInHaler ?? settings.minReserveInHaler ?? 0;
  const defaultWithOverdraft = defaultClosingBalance + overdraftLimit;
  const isOverdraftExceeded = defaultWithOverdraft < 0;

  return (
    <div className="space-y-6 pb-12">
      {/* Finanční bilance období (Souhrnný panel výchozího účtu) */}
      {!defaultAccount ? (
        <div className="p-4 bg-amber-50 border border-amber-200/80 rounded-2xl flex items-start gap-3 shadow-sm">
          <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h4 className="text-sm font-bold text-amber-900">Není zvolen výchozí účet</h4>
            <p className="text-xs text-amber-700 leading-relaxed">
              Pro zobrazení souhrnných finančních ukazatelů rozpočtu je nutné nejprve nastavit výchozí účet ve správě účtů (sekce <strong>Účty</strong>).
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-2 px-0.5">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-sky-50 text-sky-800 border border-sky-200/70 text-xs font-semibold">
              <span className="w-2 h-2 rounded-full bg-sky-500" />
              Výchozí účet: <strong>{defaultAccount.name}</strong>
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
            <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-sm">
              <span className="text-xs text-slate-400 block font-medium">Počáteční stav</span>
              <span className="text-base font-bold text-slate-800 block mt-0.5 truncate">
                {formatCurrency(defaultOpeningBalance)}
              </span>
            </div>

            <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-sm">
              <span className="text-xs text-emerald-600 block font-semibold">+ Příjmy</span>
              <span className="text-base font-bold text-emerald-600 block mt-0.5 truncate">
                {formatCurrency(defaultIncomeBalance)}
              </span>
            </div>

            <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-sm">
              <span className="text-xs text-red-600 block font-semibold">− Výdaje</span>
              <span className="text-base font-bold text-red-600 block mt-0.5 truncate">
                {formatCurrency(defaultExpenseBalance)}
              </span>
            </div>

            <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-sm">
              <span className="text-xs text-sky-600 block font-semibold">Převody</span>
              <span
                className={`text-base font-bold block mt-0.5 truncate ${
                  defaultNetTransfers > 0 ? 'text-emerald-600' : defaultNetTransfers < 0 ? 'text-red-600' : 'text-slate-800'
                }`}
                title={`Příchozí: ${formatCurrency(defaultTransfersIn)}, Odchozí: ${formatCurrency(defaultTransfersOut)}`}
              >
                {formatCurrency(defaultNetTransfers, { showPlus: true })}
              </span>
            </div>

            <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-sm">
              <span className="text-xs text-slate-500 block font-medium">Čistá změna</span>
              <span className={`text-base font-bold block mt-0.5 truncate ${
                defaultNetChange >= 0 ? 'text-emerald-600' : 'text-red-600'
              }`}>
                {formatCurrency(defaultNetChange, { showPlus: true })}
              </span>
            </div>

            <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-sm">
              <span className="text-xs text-slate-500 block font-medium">Konečný stav</span>
              <span className={`text-base font-bold block mt-0.5 truncate ${
                isOverdraftExceeded
                  ? 'text-red-600'
                  : defaultClosingBalance < 0
                    ? 'text-amber-600'
                    : 'text-slate-900'
              }`}>
                {formatCurrency(defaultClosingBalance)}
              </span>
            </div>

            <div className={`p-3.5 rounded-xl border shadow-sm col-span-2 sm:col-span-1 transition-colors ${
              isOverdraftExceeded
                ? 'bg-red-50/90 border-red-300'
                : 'bg-white border-slate-200/80'
            }`}>
              <div className="flex items-center justify-between">
                <span className={`text-xs block font-medium ${isOverdraftExceeded ? 'text-red-700 font-bold' : 'text-slate-500'}`}>
                  Včetně kontokorentu
                </span>
                {isOverdraftExceeded && (
                  <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
                )}
              </div>
              <span
                className={`text-base font-bold block mt-0.5 truncate ${
                  isOverdraftExceeded ? 'text-red-600' : 'text-emerald-600'
                }`}
                title={isOverdraftExceeded ? 'Kontokorent překročen' : `Limit ${formatCurrency(overdraftLimit)}`}
              >
                {formatCurrency(defaultWithOverdraft)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Souhrnné ukazatele za všechny účty (respektují vybrané rozpočtové období) */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between gap-2 px-0.5">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-purple-50 text-purple-800 border border-purple-200/70 text-xs font-semibold">
            <span className="w-2 h-2 rounded-full bg-purple-500" />
            Souhrnně: <strong>všechny účty</strong>
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
          <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-sm">
            <span className="text-xs text-slate-400 block font-medium">Použitelný zůstatek</span>
            <span className="text-base font-bold text-slate-800 block mt-0.5 truncate">
              {formatCurrency(aggregateSummary.usableClosingInHaler)}
            </span>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-sm">
            <span className="text-xs text-slate-500 block font-medium">Celkový majetek</span>
            <span className="text-base font-bold text-slate-900 block mt-0.5 truncate">
              {formatCurrency(aggregateSummary.netWorthClosingInHaler)}
            </span>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-sm">
            <span className="text-xs text-sky-600 block font-semibold">Uspořeno</span>
            <span className={`text-base font-bold block mt-0.5 truncate ${
              aggregateSummary.savedInHaler >= 0 ? 'text-sky-600' : 'text-red-600'
            }`}>
              {formatCurrency(aggregateSummary.savedInHaler, { showPlus: true })}
            </span>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-sm">
            <span className="text-xs text-sky-600 block font-semibold">Uspořeno %</span>
            <span className="text-base font-bold text-sky-600 block mt-0.5 truncate">
              {formatPercent(aggregateSummary.savedPct)}
            </span>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-sm">
            <span className="text-xs text-purple-600 block font-semibold">Investováno</span>
            <span className={`text-base font-bold block mt-0.5 truncate ${
              aggregateSummary.investedInHaler >= 0 ? 'text-purple-600' : 'text-red-600'
            }`}>
              {formatCurrency(aggregateSummary.investedInHaler, { showPlus: true })}
            </span>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-sm">
            <span className="text-xs text-purple-600 block font-semibold">Investováno %</span>
            <span className="text-base font-bold text-purple-600 block mt-0.5 truncate">
              {formatPercent(aggregateSummary.investedPct)}
            </span>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-sm col-span-2 sm:col-span-1">
            <span className="text-xs text-slate-500 block font-medium">Změna investic</span>
            <span className={`text-base font-bold block mt-0.5 truncate ${
              aggregateSummary.investmentChange === null
                ? 'text-slate-400'
                : aggregateSummary.investmentChange < 0 ? 'text-red-600' : 'text-emerald-600'
            }`}>
              {aggregateSummary.investmentChange === null ? '—' : formatCurrency(aggregateSummary.investmentChange, { showPlus: true })}
            </span>
          </div>
        </div>
      </div>

      {/* Dynamické sekce rozpočtu podle kategorií */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5 space-y-4">
        <h3 className="text-sm font-bold text-slate-900">Přehled rozpočtu podle kategorií</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
          {categoryBreakdown.map(({ category, totalInHaler, subcategories }) => (
            <div
              key={category.id}
              className="p-3.5 rounded-xl border border-slate-200/70 bg-slate-50/40 hover:bg-slate-50 transition-colors space-y-2"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: category.color }} />
                  <span className="text-xs font-bold text-slate-900">{category.name}</span>
                </div>
                <span className={`text-xs font-bold ${category.type === 'income' ? 'text-emerald-600' : 'text-slate-900'}`}>
                  {formatCurrency(totalInHaler)}
                </span>
              </div>

              {subcategories.length > 0 ? (
                <div className="space-y-1 pt-1 border-t border-slate-200/50">
                  {subcategories.map(({ sub, totalInHaler: subTotal }) => (
                    <div key={sub.id} className="flex justify-between text-[11px] text-slate-500">
                      <span>{sub.name}</span>
                      <span className="font-medium text-slate-700">{formatCurrency(subTotal)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[10px] text-slate-400 italic">V tomto měsíci bez položek</p>
              )}
            </div>
          ))}

          {/* Sekce Spoření a převody */}
          <div className="p-3.5 rounded-xl border border-sky-100 bg-sky-50/40 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ArrowRightLeft className="w-3.5 h-3.5 text-sky-600" />
                <span className="text-xs font-bold text-sky-900">Spoření & Převody</span>
              </div>
              <span className="text-xs font-bold text-sky-700">
                {formatCurrency(totalTransfersInHaler)}
              </span>
            </div>
            {transferTxs.length > 0 ? (
              <div className="space-y-1 pt-1 border-t border-sky-200/50">
                {transferTxs.map(tx => (
                  <div key={tx.id} className="flex justify-between text-[11px] text-slate-600">
                    <span className="truncate max-w-[130px]">{tx.title}</span>
                    <span className="font-medium">{formatCurrency(tx.amountInHaler)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[10px] text-slate-400 italic">V tomto měsíci bez převodů</p>
            )}
          </div>
        </div>
      </div>

      {/* Seznam všech položek tohoto období */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-100 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900">Položky období</h3>
                <span className="px-2 py-0.5 text-xs font-semibold bg-slate-100 text-slate-600 rounded-md">
                  {periodTransactions.length}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {viewMode === 'daily' 
                  ? 'Seskupeno po dnech – přetažením položek změníte pořadí a průběžný zůstatek' 
                  : 'Tabulkový přehled všech položek'}
              </p>
            </div>

            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5">
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl text-xs">
                <button
                  type="button"
                  onClick={() => setViewMode('daily')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-all ${
                    viewMode === 'daily' ? 'bg-white text-sky-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Calendar className="w-3.5 h-3.5" />
                  <span>Po dnech</span>
                </button>

                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-all ${
                    viewMode === 'list' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <List className="w-3.5 h-3.5" />
                  <span>Klasický seznam</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => onOpenTransactionModal()}
                className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-4 py-2 text-xs sm:text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-xl shadow-sm shadow-sky-200 transition-colors shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>Přidat položku</span>
              </button>
            </div>
          </div>

          {/* Filtry položek */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2 pt-2 text-xs">
            <div className="relative">
              <input
                type="text"
                placeholder="Hledat podle názvu..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-7 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-2" />
            </div>

            <select
              value={filterAccount}
              onChange={(e) => setFilterAccount(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-sky-500"
            >
              <option value="">Všechny účty</option>
              {accounts.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>

            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-sky-500"
            >
              <option value="">Všechny kategorie</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>

            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-sky-500"
            >
              <option value="">Všechny typy</option>
              <option value="expense">Výdaje</option>
              <option value="income">Příjmy</option>
              <option value="transfer">Převody</option>
              <option value="balance_adjustment">Korekce zůstatku</option>
            </select>

            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-sky-500"
            >
              <option value="">Všechny stavy</option>
              <option value="planned">Plánované</option>
              <option value="executed">Uskutečněné</option>
              <option value="cancelled">Zrušené</option>
            </select>
          </div>
        </div>

        {/* 1. REŽIM: PO DNECH S DRAG-AND-DROP A PRŮBĚŽNÝM ZŮSTATKEM */}
        {viewMode === 'daily' ? (
          <div className="divide-y divide-slate-100">
            {dayGroups.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-sm">
                Pro vybrané filtry nebyly v tomto období nalezeny žádné položky.
              </div>
            ) : (
              dayGroups.map(({ date, txs, intraDay }) => {
                const hasNegative = intraDay.hasTemporaryNegative;

                return (
                  <div key={date} className="p-4 sm:p-5 space-y-3">
                    {/* Záhlaví dne */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <span className="font-bold text-slate-900 text-sm">
                          {formatCzechDate(date)}
                        </span>
                        <span className="text-xs text-slate-400">
                          ({txs.length} {txs.length === 1 ? 'položka' : txs.length < 5 ? 'položky' : 'položek'})
                        </span>

                        {hasNegative && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700 border border-red-200">
                            <AlertTriangle className="w-3 h-3" />
                            Dočasný záporný stav během dne!
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3 text-xs">
                        <span className="text-slate-500">
                          Počátek dne: <strong>{formatCurrency(intraDay.startOfDayBalanceInHaler)}</strong>
                        </span>
                        <span className="text-slate-300">|</span>
                        <span className="text-slate-500">
                          Konec dne: <strong>{formatCurrency(intraDay.endOfDayBalanceInHaler)}</strong>
                        </span>
                      </div>
                    </div>

                    {hasNegative && (
                      <p className="text-xs text-red-600 bg-red-50 p-2.5 rounded-xl border border-red-200">
                        ⚠️ Během tohoto dne klesne zůstatek pod nulu (až na {formatCurrency(intraDay.minBalanceDuringDayInHaler)}). Přetažením příjmu před výdaj tomuto stavu snadno předejdete.
                      </p>
                    )}

                    {/* Seznam položek v rámci dne (Draggable) */}
                    <div className="space-y-1.5">
                      {intraDay.steps.map(({ transaction: tx, runningBalanceInHaler, isTemporaryNegative }) => {
                        const sourceAcc = accounts.find(a => a.id === tx.sourceAccountId);
                        const targetAcc = tx.targetAccountId ? accounts.find(a => a.id === tx.targetAccountId) : null;
                        const cat = categories.find(c => c.id === tx.categoryId);
                        const subCat = categories.find(c => c.id === tx.subcategoryId);

                        const effectiveAmount = tx.status === 'executed' && tx.actualAmountInHaler !== undefined
                          ? tx.actualAmountInHaler
                          : tx.amountInHaler;

                        const isExecuted = tx.status === 'executed';
                        const isCancelled = tx.status === 'cancelled';
                        const isCorrection = tx.type === 'balance_adjustment';

                        const diff = tx.diffInHaler ?? (
                          tx.actualBalanceInHaler !== undefined && tx.calculatedBalanceInHaler !== undefined
                            ? tx.actualBalanceInHaler - tx.calculatedBalanceInHaler
                            : tx.amountInHaler
                        );

                        return (
                          <div
                            key={tx.id}
                            draggable
                            onDragStart={(e) => handleDragStart(e, tx.id)}
                            onDragOver={handleDragOver}
                            onDrop={() => handleDrop(date, tx.id)}
                            className={`flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-xl border transition-all select-none cursor-move ${
                              draggedTxId === tx.id
                                ? 'opacity-40 bg-sky-50 border-dashed border-sky-400'
                                : isCorrection
                                  ? 'bg-amber-50/40 border-amber-200/80 hover:border-amber-300'
                                  : isTemporaryNegative
                                    ? 'bg-red-50/60 border-red-200 hover:border-red-300'
                                    : 'bg-white border-slate-200/80 hover:border-slate-300 hover:shadow-xs'
                            } ${isCancelled ? 'opacity-50 line-through' : ''}`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="text-slate-400 hover:text-slate-600 cursor-grab p-0.5">
                                <GripVertical className="w-4 h-4" />
                              </div>

                              <span className="px-1.5 py-0.5 rounded text-[11px] font-bold bg-slate-100 text-slate-700 shrink-0">
                                #{tx.sequence || 1}
                              </span>

                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  {isCorrection ? (
                                    <button
                                      type="button"
                                      onClick={() => setSelectedCorrection(tx)}
                                      className="text-xs font-bold text-slate-900 hover:text-amber-800 hover:underline truncate text-left flex items-center gap-1.5"
                                    >
                                      <SlidersHorizontal className="w-3.5 h-3.5 text-amber-700" />
                                      {tx.title}
                                    </button>
                                  ) : (
                                    <span className="text-xs font-bold text-slate-900 truncate">
                                      {tx.title}
                                    </span>
                                  )}
                                  {isCorrection ? (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-800 border border-amber-200">
                                      Korekce
                                    </span>
                                  ) : (
                                    renderStatusBadge(tx)
                                  )}
                                </div>

                                <div className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5">
                                  {isCorrection ? (
                                    <span className="text-amber-700 font-medium">Korekce zůstatku</span>
                                  ) : cat ? (
                                    <span>{cat.name} {subCat && `› ${subCat.name}`}</span>
                                  ) : tx.type !== 'transfer' ? (
                                    <span className="italic">Bez kategorie</span>
                                  ) : null}
                                  {sourceAcc && <span>• {sourceAcc.name} {targetAcc && `→ ${targetAcc.name}`}</span>}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center justify-between sm:justify-end gap-4 mt-2 sm:mt-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100 text-xs">
                              <div className="text-right">
                                <span className={`font-bold block ${
                                  isCorrection
                                    ? (diff >= 0 ? 'text-emerald-700' : 'text-amber-700')
                                    : tx.type === 'income' 
                                      ? 'text-emerald-600' 
                                      : tx.type === 'expense' 
                                        ? 'text-red-600' 
                                        : 'text-sky-600'
                                }`}>
                                  {isCorrection
                                    ? formatCurrency(diff, { showPlus: true })
                                    : `${tx.type === 'income' ? '+' : tx.type === 'expense' ? '−' : ''}${formatCurrency(effectiveAmount)}`}
                                </span>
                              </div>

                              <div className="text-right min-w-[120px]">
                                <span className="text-[10px] text-slate-400 block leading-tight">
                                  Zůstatek po položce:
                                </span>
                                <span className={`font-bold block ${
                                  isTemporaryNegative ? 'text-red-600' : 'text-slate-800'
                                }`}>
                                  {formatCurrency(runningBalanceInHaler)}
                                </span>
                              </div>

                              <div className="flex items-center gap-1">
                                {isCorrection ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => setSelectedCorrection(tx)}
                                      title="Detail a poznámka korekce"
                                      className="p-1 rounded text-slate-400 hover:text-slate-600"
                                    >
                                      <Eye className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setSelectedCorrection(tx)}
                                      title="Smazat korekci"
                                      className="p-1 rounded text-red-400 hover:text-red-600"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    {tx.status !== 'executed' ? (
                                      <button
                                        onClick={() => handleStatusChange(tx.id, 'executed')}
                                        disabled={updatingStatusTxId === tx.id}
                                        title="Označit jako uskutečněnou"
                                        className="p-1 rounded text-emerald-600 hover:bg-emerald-50 disabled:opacity-50"
                                      >
                                        <Check className="w-3.5 h-3.5" />
                                      </button>
                                    ) : (
                                      <button
                                        onClick={() => handleStatusChange(tx.id, 'planned')}
                                        disabled={updatingStatusTxId === tx.id}
                                        title="Vrátit do plánovaných"
                                        className="p-1 rounded text-amber-600 hover:bg-amber-50 disabled:opacity-50"
                                      >
                                        <Clock className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                    <button
                                      onClick={() => onEditTransaction(tx)}
                                      title="Upravit"
                                      className="p-1 rounded text-slate-400 hover:text-slate-600"
                                    >
                                      <Edit3 className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      onClick={() => duplicateTransaction(tx)}
                                      title="Duplikovat"
                                      className="p-1 rounded text-slate-400 hover:text-slate-600"
                                    >
                                      <Copy className="w-3.5 h-3.5" />
                                    </button>
                                    {tx.status !== 'cancelled' ? (
                                      <button
                                        onClick={() => handleStatusChange(tx.id, 'cancelled')}
                                        disabled={updatingStatusTxId === tx.id}
                                        title="Zrušit položku"
                                        className="p-1 rounded text-slate-400 hover:text-amber-600 hover:bg-amber-50 disabled:opacity-50"
                                      >
                                        <Ban className="w-3.5 h-3.5" />
                                      </button>
                                    ) : (
                                      <button
                                        onClick={() => handleStatusChange(tx.id, 'planned')}
                                        disabled={updatingStatusTxId === tx.id}
                                        title="Obnovit položku (do plánovaných)"
                                        className="p-1 rounded text-slate-400 hover:text-sky-600 hover:bg-sky-50 disabled:opacity-50"
                                      >
                                        <Clock className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                    <button
                                      onClick={() => setDeletingTx(tx)}
                                      disabled={isDeletingTx}
                                      title="Smazat"
                                      className="p-1 rounded text-red-400 hover:text-red-600 disabled:opacity-50"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : (
          /* 2. REŽIM: KLASICKÁ TABULKA POLOŽEK */
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs whitespace-nowrap">
              <thead>
                <tr className="bg-slate-50/75 border-b border-slate-200 text-slate-500 font-semibold">
                  <th className="py-2.5 px-4">Datum</th>
                  <th className="py-2.5 px-3 text-center">Pořadí</th>
                <th className="py-2.5 px-4">Název</th>
                <th className="py-2.5 px-4">Kategorie</th>
                <th className="py-2.5 px-4">Účet</th>
                <th className="py-2.5 px-4">Stav</th>
                <th className="py-2.5 px-4 text-right">Částka</th>
                <th className="py-2.5 px-4 text-right">Akce</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {periodTransactions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-400">
                    Pro zadané filtry nebyly nalezeny žádné položky.
                  </td>
                </tr>
              ) : (
                periodTransactions.map((tx) => {
                  const sourceAcc = accounts.find(a => a.id === tx.sourceAccountId);
                  const targetAcc = tx.targetAccountId ? accounts.find(a => a.id === tx.targetAccountId) : null;
                  const cat = categories.find(c => c.id === tx.categoryId);
                  const subCat = categories.find(c => c.id === tx.subcategoryId);

                  const effectiveAmount = tx.status === 'executed' && tx.actualAmountInHaler !== undefined
                    ? tx.actualAmountInHaler
                    : tx.amountInHaler;

                  const isCancelled = tx.status === 'cancelled';
                  const isCorrection = tx.type === 'balance_adjustment';

                  const diff = tx.diffInHaler ?? (
                    tx.actualBalanceInHaler !== undefined && tx.calculatedBalanceInHaler !== undefined
                      ? tx.actualBalanceInHaler - tx.calculatedBalanceInHaler
                      : tx.amountInHaler
                  );

                  return (
                    <tr
                      key={tx.id}
                      className={`hover:bg-slate-50/80 transition-colors ${
                        isCancelled ? 'opacity-50 line-through' : isCorrection ? 'bg-amber-50/30' : ''
                      }`}
                    >
                      <td className="py-3 px-4 text-slate-500">
                        {formatCzechDate(tx.date)}
                      </td>
                      <td className="py-3 px-3 text-center font-bold text-slate-700">
                        <span className="px-1.5 py-0.5 rounded text-[11px] bg-slate-100">
                          #{tx.sequence || 1}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-900">
                        <div className="flex items-center gap-1.5">
                          {isCorrection ? (
                            <button
                              type="button"
                              onClick={() => setSelectedCorrection(tx)}
                              className="hover:text-amber-800 hover:underline text-left font-bold text-slate-900 flex items-center gap-1.5"
                            >
                              <SlidersHorizontal className="w-3.5 h-3.5 text-amber-700" />
                              {tx.title}
                            </button>
                          ) : (
                            <span>{tx.title}</span>
                          )}
                          {tx.recurringRuleId && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-100 text-slate-500" title="Pravidelná položka">
                              Opakovaná
                            </span>
                          )}
                          {isCorrection && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 font-semibold">
                              Korekce
                            </span>
                          )}
                        </div>
                        {tx.note && <span className="text-[10px] text-slate-400 block font-normal">{tx.note}</span>}
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        {isCorrection ? (
                          <span className="text-amber-800 font-medium text-[11px] bg-amber-50 px-2 py-0.5 rounded border border-amber-200/60">
                            Korekce zůstatku
                          </span>
                        ) : cat ? (
                          <div className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cat.color }} />
                            <span>{cat.name}</span>
                            {subCat && <span className="text-slate-400">› {subCat.name}</span>}
                          </div>
                        ) : tx.type === 'transfer' ? (
                          <span className="text-sky-600 font-medium">Převod</span>
                        ) : (
                          <span className="text-slate-400 italic text-xs">Bez kategorie</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        {sourceAcc ? (
                          <span className="flex items-center gap-1">
                            {sourceAcc.name}
                            {targetAcc && <span className="text-sky-600">→ {targetAcc.name}</span>}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="py-3 px-4">
                        {isCorrection ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <Check className="w-3 h-3" /> Uskutečněná
                          </span>
                        ) : (
                          renderStatusBadge(tx)
                        )}
                      </td>
                      <td className={`py-3 px-4 text-right font-bold ${
                        isCorrection
                          ? (diff >= 0 ? 'text-emerald-700' : 'text-amber-700')
                          : tx.type === 'income' 
                            ? 'text-emerald-600' 
                            : tx.type === 'expense' 
                              ? 'text-red-600' 
                              : 'text-sky-600'
                      }`}>
                        {isCorrection
                          ? formatCurrency(diff, { showPlus: true })
                          : `${tx.type === 'income' ? '+' : tx.type === 'expense' ? '−' : ''}${formatCurrency(effectiveAmount)}`}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {isCorrection ? (
                            <>
                              <button
                                type="button"
                                onClick={() => setSelectedCorrection(tx)}
                                title="Detail a poznámka korekce"
                                className="p-1 rounded text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setSelectedCorrection(tx)}
                                title="Smazat korekci"
                                className="p-1 rounded text-red-500 hover:bg-red-50"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          ) : (
                            <>
                              {tx.status !== 'executed' ? (
                                <button
                                  onClick={() => handleStatusChange(tx.id, 'executed')}
                                  disabled={updatingStatusTxId === tx.id}
                                  title="Označit jako uskutečněnou"
                                  className="p-1 rounded text-emerald-600 hover:bg-emerald-50 disabled:opacity-50"
                                >
                                  <Check className="w-4 h-4" />
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleStatusChange(tx.id, 'planned')}
                                  disabled={updatingStatusTxId === tx.id}
                                  title="Vrátit do plánovaných"
                                  className="p-1 rounded text-amber-600 hover:bg-amber-50 disabled:opacity-50"
                                >
                                  <Clock className="w-4 h-4" />
                                </button>
                              )}
                              <button
                                onClick={() => onEditTransaction(tx)}
                                title="Upravit položku"
                                className="p-1 rounded text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                              >
                                <Edit3 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => duplicateTransaction(tx)}
                                title="Duplikovat"
                                className="p-1 rounded text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                              >
                                <Copy className="w-4 h-4" />
                              </button>
                              {tx.status !== 'cancelled' ? (
                                <button
                                  onClick={() => handleStatusChange(tx.id, 'cancelled')}
                                  disabled={updatingStatusTxId === tx.id}
                                  title="Zrušit položku"
                                  className="p-1 rounded text-amber-600 hover:bg-amber-50 disabled:opacity-50"
                                >
                                  <Ban className="w-4 h-4" />
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleStatusChange(tx.id, 'planned')}
                                  disabled={updatingStatusTxId === tx.id}
                                  title="Obnovit položku (do plánovaných)"
                                  className="p-1 rounded text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                                >
                                  <Clock className="w-4 h-4" />
                                </button>
                              )}
                              <button
                                onClick={() => setDeletingTx(tx)}
                                disabled={isDeletingTx}
                                title="Smazat"
                                className="p-1 rounded text-red-500 hover:bg-red-50 disabled:opacity-50"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Potvrzovací modální okno pro smazání položky */}
      <DeleteTransactionModal
        isOpen={Boolean(deletingTx)}
        onClose={() => {
          if (!isDeletingTx) setDeletingTx(null);
        }}
        transaction={deletingTx}
        isDeleting={isDeletingTx}
        hasExecutedHistorical={deletingTxHasExecutedHistorical}
        onConfirm={async (tx, mode, deleteHistorical) => {
          setIsDeletingTx(true);
          try {
            const ok = await deleteTransaction(tx.id, mode, deleteHistorical);
            return ok;
          } finally {
            setIsDeletingTx(false);
          }
        }}
      />

      {/* Detail korekce pro zobrazení a editaci poznámky */}
      <CorrectionDetailModal
        isOpen={Boolean(selectedCorrection)}
        onClose={() => setSelectedCorrection(null)}
        correctionItem={selectedCorrection}
      />
    </div>
  </div>
);
};
