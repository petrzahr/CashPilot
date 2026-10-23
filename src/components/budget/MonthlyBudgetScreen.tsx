import React, { useState, useMemo } from 'react';
import { useFinance } from '../../context/FinanceContext';
import { formatCurrency } from '../../services/currencyService';
import { formatCzechDate, getTodayInPrague } from '../../services/periodService';
import {
  getDefaultAccountPeriodTotals,
  getOverdraftLimitInHaler,
  getSourceAccountBalanceByTxId,
  groupDaysWithRunningBalance,
} from '../../services/budgetBalances';
import { calculatePeriodInvestmentChange } from '../../services/investmentPerformanceService';
import { calculateDefaultAccountKpis } from '../../services/budgetKpiService';
import { getDefaultAccount, getEffectiveAmountInHaler } from '../../services/accountScope';
import { useItemFilters } from '../../hooks/useItemFilters';
import { getCorrectionDiffInHaler } from '../../services/itemFilter';
import { parseVirtualId } from '../../services/transactionCommands';
import { MovementType, Transaction, TransactionStatus } from '../../types/finance';
import { 
  Plus, 
  Copy, 
  Trash2, 
  Edit3, 
  ArrowRightLeft, 
  Search, 
  AlertTriangle,
  AlertCircle,
  GripVertical,
  List,
  CalendarCheck,
  Calendar,
  ChevronDown,
  Loader2,
  Eye,
  SlidersHorizontal,
  ArrowUp,
  ArrowDown,
  Repeat,
  X,
  type LucideIcon
} from 'lucide-react';
import { getEffectiveTransactionsForPeriod } from '../../services/financialEngine';
import { getAccountPeriodSummary } from '../../services/accountSummaryService';
import { DeleteTransactionModal } from '../transactions/DeleteTransactionModal';
import { ReorderScopeDialog } from '../transactions/ReorderScopeDialog';
import { CorrectionDetailModal } from '../accounts/CorrectionDetailModal';
import { MultiSelectDropdown } from '../shared/MultiSelectDropdown';
import { MobileFiltersToggle } from '../shared/MobileFiltersToggle';
import { MoveButtons } from '../shared/MoveButtons';
import { StatusBadgeMenu } from '../shared/StatusBadgeMenu';
import { MoveDirection, moveIdByStep, moveIdToTarget } from '../../services/reorderService';
import { czechStringCompare } from '../../services/categoryService';
import { calculateBudgetCategoryOverview } from '../../services/categoryBreakdownService';

const TYPE_OPTIONS: { value: MovementType; label: string }[] = [
  { value: 'balance_adjustment' as MovementType, label: 'Korekce zůstatku' },
  { value: 'income' as MovementType, label: 'Příjem' },
  { value: 'transfer' as MovementType, label: 'Převod' },
  { value: 'expense' as MovementType, label: 'Výdaj' },
].sort((a, b) => czechStringCompare(a.label, b.label));

const STATUS_OPTIONS: { value: TransactionStatus; label: string }[] = [
  { value: 'planned' as TransactionStatus, label: 'Plánovaná' },
  { value: 'executed' as TransactionStatus, label: 'Uskutečněná' },
  { value: 'cancelled' as TransactionStatus, label: 'Zrušená' },
].sort((a, b) => czechStringCompare(a.label, b.label));

/** Barva hodnoty dlaždice podle znaménka: zelená přibývá, červená ubývá, nula a „—“ jsou neutrální. */
const signTone = (value: number | null) =>
  value === null ? 'text-slate-500' : value > 0 ? 'text-emerald-600' : value < 0 ? 'text-red-600' : 'text-slate-900';

/** Hodnota toku na dlaždici: částka je inkoustem, barvu podle znaménka nese jen znaménko (DESIGN.md). */
const SignedValue: React.FC<{ text: string; value: number | null }> = ({ text, value }) => {
  const match = /^([+−-])\s?(.*)$/.exec(text);
  if (value === null || !match) return <>{text}</>;
  return (
    <>
      <span className={signTone(value)}>{match[1]}</span> {match[2]}
    </>
  );
};

/** Barva textu dlaždice toku: inkoust, chybějící hodnota „—“ vedlejším inkoustem. */
const flowTone = (value: number | null) => (value === null ? 'text-slate-500' : 'text-slate-900');

interface MonthlyBudgetScreenProps {
  onOpenTransactionModal: (initialDate?: string, initialType?: MovementType) => void;
  onEditTransaction: (tx: Transaction) => void;
  onDuplicateTransaction: (tx: Transaction) => void;
}

export const MonthlyBudgetScreen: React.FC<MonthlyBudgetScreenProps> = ({
  onOpenTransactionModal,
  onEditTransaction,
  onDuplicateTransaction,
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
    setTransactionStatus,
    deleteTransaction,
    deleteCorrection,
    reorderDayTransactions,
    reorderRecurringItem,
    showToast,
  } = useFinance();

  // Režim zobrazení: po dnech s drag & drop vs klasický seznam
  const [viewMode, setViewMode] = useState<'daily' | 'list'>('daily');
  const [draggedTxId, setDraggedTxId] = useState<string | null>(null);
  // Přeuspořádání opakující se položky čeká na volbu rozsahu (jen tento výskyt / budoucí / celá série)
  const [pendingRecurringReorder, setPendingRecurringReorder] = useState<{
    ruleId: string;
    ruleTitle: string;
    date: string;
    orderedIds: string[];
    movedTransactionId: string;
  } | null>(null);

  // Řazení v klasickém seznamu - výchozí vzestupně (stejné jako v sekci Položky)
  const [dateSortOrder, setDateSortOrder] = useState<'asc' | 'desc'>('asc');
  const toggleDateSort = () => {
    setDateSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'));
  };

  // Stav probíhající změny stavu položky a otevřeného menu
  const [updatingStatusTxId, setUpdatingStatusTxId] = useState<string | null>(null);
  const [activeStatusMenuTxId, setActiveStatusMenuTxId] = useState<string | null>(null);

  // Stav mazání položky
  const [deletingTx, setDeletingTx] = useState<Transaction | null>(null);
  const [isDeletingTx, setIsDeletingTx] = useState(false);
  // Běžná položka se smaže hned (oznámení nabídne „Vrátit“), pravidelná potřebuje volbu rozsahu
  const requestDelete = (tx: Transaction) => {
    if (tx.recurringRuleId || tx.id.startsWith('virtual_')) setDeletingTx(tx);
    else void deleteTransaction(tx.id);
  };

  // Stav vybrané korekce pro detail modal
  const [selectedCorrection, setSelectedCorrection] = useState<Transaction | null>(null);
  const openCorrection = (tx: Transaction) => setSelectedCorrection(tx);

  const deletingTxHasExecutedHistorical = useMemo(() => {
    if (!deletingTx) return false;
    const ruleId = deletingTx.recurringRuleId ?? parseVirtualId(deletingTx.id)?.ruleId;
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

  // Štítek stavu je ve všech seznamech stejný sdílený ovladač (viz StatusBadgeMenu)
  const renderStatusBadge = (tx: Transaction, openUp = false) => (
    <StatusBadgeMenu
      tx={tx}
      todayIso={todayIso}
      isUpdating={updatingStatusTxId === tx.id}
      onChange={(status) => handleStatusChange(tx.id, status)}
      openUp={openUp}
    />
  );

  // Souhrn pro vybranou periodu z forecastu
  const currentSummary = useMemo(() => {
    return getAccountPeriodSummary(forecast, selectedPeriod.key) || {
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
      minUsableBalanceInHaler: 0,
      accountBalances: {},
    };
  }, [forecast, selectedPeriod.key]);

  const formatPercent = (value: number | null) => value === null
    ? '—'
    : `${new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 1 }).format(value)} %`;
  // Procento toku nese znaménko jako částky, protože barvu má jen znaménko
  const formatSignedPercent = (value: number | null) =>
    value !== null && value > 0 ? `+ ${formatPercent(value)}` : formatPercent(value);

  // Všechny efektivní položky v tomto období (pro souhrny kategorií a převody)
  const allPeriodTransactions = useMemo(() => {
    return getEffectiveTransactionsForPeriod(
      selectedPeriod,
      transactions,
      recurringRules,
      recurringExceptions,
      settings.budgetStartDay,
      undefined,
      accounts
    );
  }, [selectedPeriod, transactions, recurringRules, recurringExceptions, settings.budgetStartDay, accounts]);

  // Výchozí účet a jeho souhrnné údaje
  const defaultAccount = useMemo(() => {
    return getDefaultAccount(accounts);
  }, [accounts]);

  // KPI dlaždice počítané z výchozího účtu; Změna investic zůstává za všechny investiční účty
  const aggregateSummary = useMemo(() => {
    const kpis = calculateDefaultAccountKpis(
      defaultAccount,
      accounts,
      defaultAccount ? currentSummary.accountBalances[defaultAccount.id] : undefined,
      allPeriodTransactions
    );

    const investmentChange = calculatePeriodInvestmentChange(
      accounts, marketValueSnapshots, selectedPeriod, settings.budgetStartDay, undefined, transactions
    );

    return {
      usableClosingInHaler: currentSummary.usableClosingInHaler,
      netWorthClosingInHaler: currentSummary.netWorthClosingInHaler,
      ...kpis,
      investmentChange,
    };
  }, [defaultAccount, accounts, currentSummary, allPeriodTransactions, marketValueSnapshots, transactions, selectedPeriod, settings.budgetStartDay]);

  // Filtry seznamu položek v rámci období (sdílené se sekcí Všechny položky, viz useItemFilters)
  const itemFilters = useItemFilters(allPeriodTransactions, accounts, categories);
  const {
    search: searchQuery,
    accounts: filterAccounts,
    mainCategories: filterMainCategories,
    subCategories: filterSubCategories,
    types: filterTypes,
    statuses: filterStatuses,
  } = itemFilters.filters;
  const {
    setSearch: setSearchQuery,
    setAccounts: setFilterAccounts,
    setMainCategories: handleMainCategoriesChange,
    setSubCategories: setFilterSubCategories,
    setTypes: setFilterTypes,
    setStatuses: setFilterStatuses,
    clear: clearFilters,
    activeCount: activeFilterCount,
    sumInHaler: periodTransactionsSum,
  } = itemFilters;
  const { accounts: sortedAccounts, mainCategories: availableMainCategories, subCategories: availableSubCategories } = itemFilters.options;

  // Filtrované položky v tomto období (pro tabulku a denní seskupení)
  const periodTransactions = useMemo(
    () => [...itemFilters.filtered].sort((a, b) => a.date.localeCompare(b.date)),
    [itemFilters.filtered]
  );

  // Na mobilu jsou filtry kromě hledání schované; počet ukazuje, kolik jich je za tlačítkem aktivních
  const [filtersOpen, setFiltersOpen] = useState(false);
  const hiddenFilterCount = activeFilterCount - (searchQuery.trim() ? 1 : 0);

  // Prázdný seznam: odliší období bez položek od filtrů, které nic nenašly
  const emptyListMessage = allPeriodTransactions.length === 0
    ? 'V tomto období zatím nejsou žádné položky. Přidejte první tlačítkem Nová položka.'
    : 'Filtrům neodpovídá žádná položka. Upravte filtry, nebo je zrušte tlačítkem Zrušit filtry.';

  // Řazení pro klasický seznam podle data a pořadí (stejné jako v sekci Položky);
  // režim po dnech má vlastní pevné řazení kvůli přetahování, proto samostatné pole
  const sortedListTransactions = useMemo(() => {
    return [...periodTransactions].sort((a, b) => {
      const cmp = a.date.localeCompare(b.date);
      if (cmp !== 0) {
        return dateSortOrder === 'asc' ? cmp : -cmp;
      }
      const seqA = a.sequence !== undefined ? a.sequence : 1;
      const seqB = b.sequence !== undefined ? b.sequence : 1;
      return dateSortOrder === 'asc' ? seqA - seqB : seqB - seqA;
    });
  }, [periodTransactions, dateSortOrder]);

  // Množina účtů zahrnutých do "použitelných peněz" (pro průběžný zůstatek napříč účty)
  const usableAccountIds = useMemo(() => {
    return new Set(accounts.filter(a => a.isUsableCash).map(a => a.id));
  }, [accounts]);

  // Seskupení položek podle jednotlivých dnů s výpočtem denního průběžného zůstatku
  // Dnešní den v pražském čase odděluje uskutečněnou minulost od plánu
  const todayIso = getTodayInPrague();
  const isTodayInPeriod = todayIso >= selectedPeriod.startDate && todayIso <= selectedPeriod.endDate;

  // „Dnes“: posun na den nejbližší dnešku (při shodě vzdálenosti vyhraje budoucí), funguje
  // v obou zobrazeních i při sestupném řazení; čára „Dnes“ nese přímo dnešní datum
  const scrollToToday = () => {
    const today = Date.parse(todayIso);
    let target: HTMLElement | null = null;
    let bestDistance = Infinity;
    document.querySelectorAll<HTMLElement>('[data-budget-date]').forEach(el => {
      // Seznam má karty i tabulku, skrytá podoba nemá kam posunout
      if (el.getClientRects().length === 0) return;
      const date = el.dataset.budgetDate!;
      const distance = Math.abs(Date.parse(date) - today) - (date >= todayIso ? 0.5 : 0);
      if (distance < bestDistance) { bestDistance = distance; target = el; }
    });
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    (target as HTMLElement | null)?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  };

  const dayGroups = useMemo(
    () => groupDaysWithRunningBalance(periodTransactions, currentSummary.usableOpeningInHaler, usableAccountIds),
    [periodTransactions, currentSummary.usableOpeningInHaler, usableAccountIds]
  );

  // Zůstatek zdrojového účtu po každé položce (z nefiltrovaných položek období, aby filtr neovlivnil výsledek);
  // počáteční stavy z historického souhrnu období, bez projekce investic
  const sourceAccountBalanceByTxId = useMemo(() => {
    const balances = (forecast.periods.find(p => p.period.key === selectedPeriod.key) ?? currentSummary).accountBalances;
    return getSourceAccountBalanceByTxId(allPeriodTransactions, balances);
  }, [allPeriodTransactions, forecast.periods, currentSummary, selectedPeriod.key]);

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

    const newOrderedIds = moveIdToTarget(dayGroup.txs.map(t => t.id), draggedTxId, targetTxId);
    if (newOrderedIds) applyDayOrder(date, newOrderedIds, dayGroup.txs.find(t => t.id === draggedTxId));
    setDraggedTxId(null);
  };

  // Posun položky o jedno místo tlačítky (dotyk a klávesnice) v zobrazeném pořadí dne
  const handleMoveDayTransaction = (date: string, dayOrderedIds: string[], tx: Transaction, direction: MoveDirection) => {
    const newOrderedIds = moveIdByStep(dayOrderedIds, dayOrderedIds, tx.id, direction);
    if (newOrderedIds) applyDayOrder(date, newOrderedIds, tx);
  };

  // U opakující se položky se rozsah změny pořadí volí v ReorderScopeDialog
  const applyDayOrder = (date: string, newOrderedIds: string[], movedTx: Transaction | undefined) => {
    if (movedTx?.recurringRuleId) {
      setPendingRecurringReorder({
        ruleId: movedTx.recurringRuleId,
        ruleTitle: movedTx.title,
        date,
        orderedIds: newOrderedIds,
        movedTransactionId: movedTx.id,
      });
    } else {
      reorderDayTransactions(date, newOrderedIds);
    }
  };

  const handleConfirmRecurringReorder = (mode: 'occurrence' | 'future' | 'series') => {
    if (!pendingRecurringReorder) return;
    reorderRecurringItem(
      pendingRecurringReorder.ruleId,
      mode,
      pendingRecurringReorder.date,
      selectedPeriod.key,
      pendingRecurringReorder.orderedIds,
      pendingRecurringReorder.movedTransactionId
    );
    setPendingRecurringReorder(null);
  };

  // Přehled podle kategorií jen z výchozího účtu - stejný výpočet jako v Analýze a trendech
  const categoryOverview = useMemo(() => calculateBudgetCategoryOverview(
    selectedPeriod,
    transactions,
    recurringRules,
    recurringExceptions,
    categories,
    accounts,
    settings.budgetStartDay,
    defaultAccount?.id
  ), [selectedPeriod, transactions, recurringRules, recurringExceptions, categories, accounts, settings.budgetStartDay, defaultAccount]);

  const defaultAccountBalance = useMemo(() => {
    if (!defaultAccount) return null;
    return currentSummary.accountBalances[defaultAccount.id] || null;
  }, [defaultAccount, currentSummary]);

  const {
    openingInHaler: defaultOpeningBalance,
    incomeInHaler: defaultIncomeBalance,
    expenseInHaler: defaultExpenseBalance,
    netTransfersInHaler: defaultNetTransfers,
    netChangeInHaler: defaultNetChange,
    closingInHaler: defaultClosingBalance,
    withOverdraftInHaler: defaultWithOverdraft,
    isOverdraftExceeded,
  } = getDefaultAccountPeriodTotals(defaultAccount, defaultAccountBalance, selectedPeriod, getOverdraftLimitInHaler(settings));

  // Části řádku seznamu sdílí tabulka (od lg) i řádky-karty na mobilu, stejně jako ve Všech položkách
  const getListRowParts = (
    tx: Transaction,
    rowIndex: number,
    openStatusUp = rowIndex >= sortedListTransactions.length - 3 && sortedListTransactions.length > 3
  ) => {
    const sourceAcc = accounts.find(a => a.id === tx.sourceAccountId);
    const targetAcc = tx.targetAccountId ? accounts.find(a => a.id === tx.targetAccountId) : null;
    const cat = categories.find(c => c.id === tx.categoryId);
    const subCat = categories.find(c => c.id === tx.subcategoryId);

    const effectiveAmount = getEffectiveAmountInHaler(tx);
    const isCancelled = tx.status === 'cancelled';
    const isCorrection = tx.type === 'balance_adjustment';

    const diff = getCorrectionDiffInHaler(tx);

    const rowTone = isCancelled ? 'line-through decoration-slate-400 bg-slate-50 text-slate-500' : isCorrection ? 'bg-slate-50' : '';

    const title = (
      <div className="flex items-center gap-1.5 flex-nowrap min-w-0">
        {isCorrection ? (
          <button
            type="button"
            onClick={() => openCorrection(tx)}
            className="hover:text-sky-700 hover:underline text-left font-bold text-slate-900 flex items-center gap-1.5 min-w-0"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden="true" />
            <span className="truncate">{tx.title}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onEditTransaction(tx)}
            className="hover:text-sky-700 hover:underline text-left truncate min-w-0"
          >
            {tx.title}
          </button>
        )}
        {tx.recurringRuleId && (
          <span title="Pravidelná položka" role="img" aria-label="Pravidelná položka" className="shrink-0 inline-flex">
            <Repeat className="w-3.5 h-3.5 text-slate-500" />
          </span>
        )}
        {isCorrection && (
          <span className="chip bg-slate-100 text-slate-600 shrink-0">
            Korekce
          </span>
        )}
      </div>
    );

    const note = tx.note ? <span className="text-xs text-slate-500 block font-normal truncate">{tx.note}</span> : null;

    const category = isCorrection ? (
      <span className="chip bg-slate-100 text-slate-600">
        Korekce zůstatku
      </span>
    ) : cat ? (
      <div className="min-w-0" title={subCat ? `${cat.name} › ${subCat.name}` : cat.name}>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
          <span className="truncate">{cat.name}</span>
        </div>
        {subCat && <span className="block pl-3.5 text-slate-500 truncate">› {subCat.name}</span>}
      </div>
    ) : tx.type === 'transfer' ? (
      <span className="text-slate-500 font-medium">Převod</span>
    ) : (
      <span className="text-slate-500 italic text-xs">Bez kategorie</span>
    );

    // Na mobilu stačí kategorie na jednom řádku; korekci už ohlašuje štítek u názvu
    const categoryInline = isCorrection ? null : cat ? (
      <span className="inline-flex items-center gap-1.5 min-w-0">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
        <span className="truncate">{subCat ? `${cat.name} › ${subCat.name}` : cat.name}</span>
      </span>
    ) : tx.type === 'transfer' ? (
      <span className="font-medium">Převod</span>
    ) : (
      <span className="italic">Bez kategorie</span>
    );

    const account = sourceAcc ? (
      <span className="block min-w-0" title={targetAcc ? `${sourceAcc.name} → ${targetAcc.name}` : sourceAcc.name}>
        <span className="block truncate">{sourceAcc.name}</span>
        {targetAcc && <span className="block text-slate-500 truncate">→ {targetAcc.name}</span>}
      </span>
    ) : '—';

    const accountInline = sourceAcc ? (targetAcc ? `${sourceAcc.name} → ${targetAcc.name}` : sourceAcc.name) : null;

    // Stejný štítek jako v zobrazení po dnech: korekce má vlastní štítek, ostatní stav lze změnit
    const status = isCorrection ? (
      <span className="chip bg-slate-100 text-slate-600">
        Korekce
      </span>
    ) : (
      renderStatusBadge(tx, openStatusUp)
    );

    const amountClass = isCorrection
      ? (diff >= 0 ? 'text-emerald-600' : 'text-red-600')
      : tx.type === 'income'
        ? 'text-emerald-600'
        : tx.type === 'expense'
          ? 'text-red-600'
          : 'text-slate-900';

    const amount = isCorrection
      ? formatCurrency(diff, { showPlus: true })
      : `${tx.type === 'income' ? '+' : tx.type === 'expense' ? '−' : ''}${formatCurrency(effectiveAmount)}`;

    const actions = isCorrection ? (
      <>
        <button
          type="button"
          onClick={() => openCorrection(tx)}
          title="Detail a poznámka korekce"
          aria-label={`Detail a poznámka korekce: ${tx.title}`}
          className="btn-icon"
        >
          <Eye className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => void deleteCorrection(tx.id)}
          title="Smazat korekci"
          aria-label={`Smazat korekci: ${tx.title}`}
          className="btn-icon btn-icon-danger"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </>
    ) : (
      <>
        <button
          onClick={() => onEditTransaction(tx)}
          title="Upravit položku"
          aria-label={`Upravit položku: ${tx.title}`}
          className="btn-icon"
        >
          <Edit3 className="w-4 h-4" />
        </button>
        <button
          onClick={() => onDuplicateTransaction(tx)}
          title="Duplikovat položku"
          aria-label={`Duplikovat položku: ${tx.title}`}
          className="btn-icon"
        >
          <Copy className="w-4 h-4" />
        </button>
        <button
          onClick={() => requestDelete(tx)}
          disabled={isDeletingTx}
          title="Smazat položku"
          aria-label={`Smazat položku: ${tx.title}`}
          className="btn-icon btn-icon-danger"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </>
    );

    return { rowTone, title, note, category, categoryInline, account, accountInline, status, amountClass, amount, actions };
  };

  return (
    <div className="space-y-6">
      {/* Panel ukazatelů: řádky čísel patří k sobě, proto užší rozestup než mezi sekcemi */}
      <div className="space-y-4">
        {/* Zvýrazněný řádek: použitelný zůstatek a celkový majetek přes všechny účty */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white p-4 rounded-2xl border border-slate-200">
            <span className="text-xs text-slate-500 block font-bold uppercase tracking-wider">Použitelný zůstatek</span>
            <span className={`text-xl sm:text-[32px] sm:leading-tight font-extrabold block mt-1 truncate ${aggregateSummary.usableClosingInHaler < 0 ? 'text-red-600' : 'text-slate-900'}`}>
              {formatCurrency(aggregateSummary.usableClosingInHaler)}
            </span>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200">
            <span className="text-xs text-slate-500 block font-bold uppercase tracking-wider">Celkový majetek</span>
            <span className={`text-xl sm:text-[32px] sm:leading-tight font-extrabold block mt-1 truncate ${aggregateSummary.netWorthClosingInHaler < 0 ? 'text-red-600' : 'text-purple-600'}`}>
              {formatCurrency(aggregateSummary.netWorthClosingInHaler)}
            </span>
          </div>
        </div>

        {/* Finanční bilance období (Souhrnný panel výchozího účtu) */}
        {!defaultAccount ? (
          <div className="panel panel-warning flex items-start gap-2.5">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h2 className="text-sm font-bold text-amber-900">Chybí výchozí účet</h2>
              <p className="text-xs text-amber-700 leading-relaxed">
                Souhrn období se počítá z výchozího účtu. V sekci <strong>Účty</strong> upravte hlavní účet a zaškrtněte Výchozí účet.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2 px-0.5">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-100 text-slate-600 border border-slate-200 text-xs font-semibold">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: defaultAccount.color }} aria-hidden="true" />
                Výchozí účet: <strong className="text-slate-900">{defaultAccount.name}</strong>
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
              <div className="flex flex-col bg-white p-3 rounded-xl border border-slate-200">
                <span className="text-xs text-slate-500 block font-medium">Počáteční stav</span>
                <span className="text-base font-bold text-slate-900 block mt-auto pt-0.5 truncate">
                  {formatCurrency(defaultOpeningBalance)}
                </span>
              </div>

              <div className="flex flex-col bg-white p-3 rounded-xl border border-slate-200">
                <span className="text-xs text-slate-500 block font-medium"><span className="text-emerald-600 font-bold">+</span> Příjmy</span>
                <span className="text-base font-bold text-slate-900 block mt-auto pt-0.5 truncate">
                  {formatCurrency(defaultIncomeBalance)}
                </span>
              </div>

              <div className="flex flex-col bg-white p-3 rounded-xl border border-slate-200">
                <span className="text-xs text-slate-500 block font-medium"><span className="text-red-600 font-bold">−</span> Výdaje</span>
                <span className="text-base font-bold text-slate-900 block mt-auto pt-0.5 truncate">
                  {formatCurrency(defaultExpenseBalance)}
                </span>
              </div>

              <div className="flex flex-col bg-white p-3 rounded-xl border border-slate-200">
                <span className="text-xs text-slate-500 block font-medium">Převody</span>
                <span className="text-base font-bold text-slate-900 block mt-auto pt-0.5 truncate">
                  <SignedValue text={formatCurrency(defaultNetTransfers, { showPlus: true })} value={defaultNetTransfers} />
                </span>
              </div>

              <div className="flex flex-col bg-white p-3 rounded-xl border border-slate-200">
                <span className="text-xs text-slate-500 block font-medium">Čistá změna</span>
                <span className="text-base font-bold text-slate-900 block mt-auto pt-0.5 truncate">
                  <SignedValue text={formatCurrency(defaultNetChange, { showPlus: true })} value={defaultNetChange} />
                </span>
              </div>

              <div className="flex flex-col bg-white p-3 rounded-xl border border-slate-200">
                <span className="text-xs text-slate-500 block font-medium">Konečný stav</span>
                <span className="text-base font-bold text-slate-900 block mt-auto pt-0.5 truncate">
                  {formatCurrency(defaultClosingBalance)}
                </span>
              </div>

              <div className={`flex flex-col p-3 rounded-xl border col-span-2 sm:col-span-1 transition-colors ${
                isOverdraftExceeded
                  ? 'bg-red-50/90 border-red-300'
                  : 'bg-white border-slate-200'
              }`}>
                <span className={`text-xs font-medium block ${isOverdraftExceeded ? 'text-red-700 font-bold' : 'text-slate-500'}`}>
                  {isOverdraftExceeded ? (
                    <span className="inline-flex items-center gap-1">
                      Včetně kontokorentu
                      <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0" aria-hidden="true" />
                    </span>
                  ) : 'Včetně kontokorentu'}
                </span>
                <span className="text-base font-bold text-slate-900 block mt-auto pt-0.5 truncate">
                  {formatCurrency(defaultWithOverdraft)}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* KPI dlaždice výchozího účtu (respektují vybrané rozpočtové období) */}
        <div className="space-y-2.5">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
            <div className="flex flex-col bg-white p-3 rounded-xl border border-slate-200">
              <span className="text-xs text-slate-500 block font-medium">Skutečně uspořeno</span>
              <span className="text-base font-bold text-slate-900 block mt-auto pt-0.5 truncate">
                <SignedValue text={formatCurrency(aggregateSummary.actuallySavedInHaler, { showPlus: true })} value={aggregateSummary.actuallySavedInHaler} />
              </span>
            </div>

            <div className="flex flex-col bg-white p-3 rounded-xl border border-slate-200">
              <span className="text-xs text-slate-500 block font-medium">Skutečně uspořeno %</span>
              <span className={`text-base font-bold block mt-auto pt-0.5 truncate ${flowTone(aggregateSummary.actuallySavedPct)}`}>
                <SignedValue text={formatSignedPercent(aggregateSummary.actuallySavedPct)} value={aggregateSummary.actuallySavedPct} />
              </span>
            </div>

            <div className="flex flex-col bg-white p-3 rounded-xl border border-slate-200">
              <span className="text-xs text-slate-500 block font-medium">Uspořeno</span>
              <span className="text-base font-bold text-slate-900 block mt-auto pt-0.5 truncate">
                <SignedValue text={formatCurrency(aggregateSummary.savedInHaler, { showPlus: true })} value={aggregateSummary.savedInHaler} />
              </span>
            </div>

            <div className="flex flex-col bg-white p-3 rounded-xl border border-slate-200">
              <span className="text-xs text-slate-500 block font-medium">Uspořeno %</span>
              <span className={`text-base font-bold block mt-auto pt-0.5 truncate ${flowTone(aggregateSummary.savedPct)}`}>
                <SignedValue text={formatSignedPercent(aggregateSummary.savedPct)} value={aggregateSummary.savedPct} />
              </span>
            </div>

            <div className="flex flex-col bg-white p-3 rounded-xl border border-slate-200">
              <span className="text-xs text-slate-500 block font-medium">Investováno</span>
              <span className="text-base font-bold text-slate-900 block mt-auto pt-0.5 truncate">
                <SignedValue text={formatCurrency(aggregateSummary.investedInHaler, { showPlus: true })} value={aggregateSummary.investedInHaler} />
              </span>
            </div>

            <div className="flex flex-col bg-white p-3 rounded-xl border border-slate-200">
              <span className="text-xs text-slate-500 block font-medium">Investováno %</span>
              <span className={`text-base font-bold block mt-auto pt-0.5 truncate ${flowTone(aggregateSummary.investedPct)}`}>
                <SignedValue text={formatSignedPercent(aggregateSummary.investedPct)} value={aggregateSummary.investedPct} />
              </span>
            </div>

            <div className="flex flex-col bg-white p-3 rounded-xl border border-slate-200 col-span-2 sm:col-span-1">
              <span className="text-xs text-slate-500 block font-medium">Změna investic</span>
              <span className={`text-base font-bold block mt-auto pt-0.5 truncate ${flowTone(aggregateSummary.investmentChange)}`}>
                {aggregateSummary.investmentChange === null
                  ? '—'
                  : <SignedValue text={formatCurrency(aggregateSummary.investmentChange, { showPlus: true })} value={aggregateSummary.investmentChange} />}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Dynamické sekce rozpočtu podle kategorií */}
      <div className="card p-5 space-y-4">
        <h2 className="text-sm font-bold text-slate-900">Přehled rozpočtu podle kategorií</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {categoryOverview.cards.map(({ key, label, color, group, totalInHaler, subcategories }) => (
            <div
              key={key}
              className="p-3 rounded-xl bg-slate-50 space-y-2"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                  <span className="text-xs font-bold text-slate-900 truncate" title={label}>{label}</span>
                </div>
                <span className={`text-xs font-bold shrink-0 ${group === 'income' ? 'text-emerald-600' : 'text-slate-900'}`}>
                  {formatCurrency(totalInHaler)}
                </span>
              </div>

              {subcategories.length > 0 ? (
                <div className="space-y-1 pt-1 border-t border-slate-200">
                  {subcategories.map(({ key: subKey, label: subLabel, totalInHaler: subTotal }) => (
                    <div key={subKey} className="flex justify-between gap-3 text-xs text-slate-500">
                      <span className="truncate min-w-0" title={subLabel}>{subLabel}</span>
                      <span className="font-medium shrink-0">{formatCurrency(subTotal)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500 italic">V tomto období žádné položky</p>
              )}
            </div>
          ))}

          {/* Sekce Spoření a převody */}
          <div className="p-3 rounded-xl bg-slate-50 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <ArrowRightLeft className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden="true" />
                <span className="text-xs font-bold text-slate-900 truncate">Spoření a převody</span>
              </div>
              <span className="text-xs font-bold text-slate-900 shrink-0">
                {formatCurrency(categoryOverview.transferTotalInHaler)}
              </span>
            </div>
            {categoryOverview.transfers.length > 0 ? (
              <div className="space-y-1 pt-1 border-t border-slate-200">
                {categoryOverview.transfers.map(({ transaction: tx, amountInHaler }) => (
                  <div key={tx.id} className="flex justify-between gap-3 text-xs text-slate-500">
                    <span className="truncate min-w-0" title={tx.title}>{tx.title}</span>
                    <span className="font-medium shrink-0">{formatCurrency(amountInHaler)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500 italic">V tomto období žádné převody</p>
            )}
          </div>
        </div>
      </div>

      {/* Filtry položek tohoto období */}
      <div className="card p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm font-bold text-slate-900">Položky období</h2>
                <span className="chip bg-slate-100 text-slate-600">
                  {periodTransactions.length}
                </span>
                <span className="text-xs font-semibold text-slate-500">Součet</span>
                <span className={`text-xs font-bold tabular-nums ${
                  periodTransactionsSum > 0 ? 'text-emerald-600' : periodTransactionsSum < 0 ? 'text-red-600' : 'text-slate-900'
                }`}>
                  {formatCurrency(periodTransactionsSum, { showPlus: true })}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5">
              <div className="segmented flex items-center">
                <button
                  type="button"
                  onClick={() => setViewMode('daily')}
                  aria-pressed={viewMode === 'daily'}
                  className="segment"
                >
                  <Calendar className="w-3.5 h-3.5" />
                  <span>Po dnech</span>
                </button>

                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  aria-pressed={viewMode === 'list'}
                  className="segment"
                >
                  <List className="w-3.5 h-3.5" />
                  <span>Seznam</span>
                </button>
              </div>

              {isTodayInPeriod && periodTransactions.length > 0 && (
                <button
                  type="button"
                  onClick={scrollToToday}
                  className="btn-secondary shrink-0"
                >
                  <CalendarCheck className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Dnes</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => onOpenTransactionModal()}
                className="btn-primary w-full sm:w-auto shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>Nová položka</span>
              </button>
            </div>
          </div>

          {/* Filtry položek (stejné jako v sekci Položky, bez filtru období) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2.5 pt-3 border-t border-slate-100 text-xs">
            <div className="relative sm:col-span-2 lg:col-span-2">
              <input
                type="text"
                placeholder="Hledat v názvu…"
                aria-label="Vyhledat v názvu položky"
                aria-keyshortcuts="/"
                data-search-input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { setSearchQuery(''); e.currentTarget.blur(); }
                }}
                className="max-md:min-h-11 w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
              />
              <Search className="w-4 h-4 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
            </div>

            <MobileFiltersToggle
              isOpen={filtersOpen}
              onToggle={() => setFiltersOpen(prev => !prev)}
              activeCount={hiddenFilterCount}
              controlsId="budget-filters"
            />

            <div id="budget-filters" className={`contents ${filtersOpen ? '' : 'max-md:hidden'}`}>
            <MultiSelectDropdown
              label="Účet" placeholder="Všechny účty"
              selected={filterAccounts}
              onChange={setFilterAccounts}
              options={sortedAccounts.map(a => ({
                value: a.id,
                label: `${a.name}${a.status === 'archived' ? ' (archivovaný)' : ''}`,
              }))}
            />

            <MultiSelectDropdown
              label="Kategorie" placeholder="Všechny kategorie"
              selected={filterMainCategories}
              onChange={handleMainCategoriesChange}
              options={availableMainCategories.map(c => ({
                value: c.id,
                label: `${c.name}${c.status === 'archived' ? ' (archivovaná)' : ''}`,
              }))}
            />

            <MultiSelectDropdown
              label="Podkategorie" placeholder="Všechny podkategorie"
              disabled={filterMainCategories.length === 0 || availableSubCategories.length === 0}
              disabledPlaceholder={filterMainCategories.length === 0 ? 'Nejprve vyberte hlavní kategorii' : 'Žádné podkategorie'}
              selected={filterSubCategories}
              onChange={setFilterSubCategories}
              options={availableSubCategories.map(sub => ({
                value: sub.id,
                label: `${sub.name}${sub.status === 'archived' ? ' (archivovaná)' : ''}`,
              }))}
            />

            <MultiSelectDropdown
              label="Typ" placeholder="Všechny typy"
              selected={filterTypes}
              onChange={setFilterTypes}
              options={TYPE_OPTIONS.map(t => ({ value: t.value, label: t.label }))}
            />

            <MultiSelectDropdown
              label="Stav" placeholder="Všechny stavy"
              selected={filterStatuses}
              onChange={setFilterStatuses}
              options={STATUS_OPTIONS.map(s => ({ value: s.value, label: s.label }))}
            />
            </div>
          </div>

          {activeFilterCount > 0 && (
            <div className="flex justify-end -mt-1">
              <button
                type="button"
                onClick={clearFilters}
                className="btn-text"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
                Zrušit filtry ({activeFilterCount})
              </button>
            </div>
          )}
      </div>

      {/* Seznam všech položek tohoto období */}
      <div className="card overflow-hidden">
        {/* 1. REŽIM: PO DNECH S DRAG-AND-DROP A PRŮBĚŽNÝM ZŮSTATKEM */}
        {viewMode === 'daily' ? (
          <div className="divide-y divide-slate-100">
            {dayGroups.length === 0 ? (
              <div className="empty-state">
                {emptyListMessage}
              </div>
            ) : (
              dayGroups.map(({ date, txs, intraDay }, groupIndex) => {
                const hasNegative = intraDay.hasTemporaryNegative;
                const isToday = date === todayIso;
                // Hranice mezi minulostí a plánem: čára „Dnes“ před prvním dnem na druhé straně dneška
                const prevDate = groupIndex > 0 ? dayGroups[groupIndex - 1].date : null;
                const crossesToday = prevDate !== null && !isToday && prevDate !== todayIso
                  && (prevDate < todayIso) !== (date < todayIso);

                return (
                  <React.Fragment key={date}>
                  {crossesToday && (
                    <div role="separator" data-budget-date={todayIso} aria-label={`Dnes, ${formatCzechDate(todayIso)}`} className="scroll-mt-20 flex items-center gap-3 px-4 sm:px-5 py-2 bg-white text-xs font-bold text-slate-900">
                      <span>Dnes · {formatCzechDate(todayIso)}</span>
                      <span className="h-px flex-1 bg-slate-300" aria-hidden="true" />
                    </div>
                  )}
                  {/* Dnešek nese štítek „Dnes“ a čára; záhlaví dne má šedý pás jako záhlaví tabulek */}
                  <div data-budget-date={date} className="scroll-mt-20 p-4 sm:p-5 space-y-3">
                    {/* Záhlaví dne na mobilu: jeden řádek, začátek dne je konec předchozího */}
                    <div className="lg:hidden -mx-4 sm:-mx-5 -mt-4 sm:-mt-5 px-4 sm:px-5 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3 text-xs">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                        <span className="font-bold text-slate-900 text-sm">
                          {formatCzechDate(date)}
                        </span>
                        {isToday && (
                          <span className="chip bg-sky-50 text-sky-700">
                            Dnes
                          </span>
                        )}
                        <span className="text-slate-500">
                          · {txs.length} {txs.length === 1 ? 'položka' : txs.length < 5 ? 'položky' : 'položek'}
                        </span>
                        {hasNegative && (
                          <span className="chip bg-red-100 text-red-700">
                            <AlertTriangle className="w-3 h-3" />
                            Během dne v mínusu
                          </span>
                        )}
                      </div>
                      <span
                        title="Konec dne"
                        className={`shrink-0 font-bold tabular-nums ${intraDay.endOfDayBalanceInHaler < 0 ? 'text-red-600' : 'text-slate-900'}`}
                      >
                        {formatCurrency(intraDay.endOfDayBalanceInHaler)}
                      </span>
                    </div>

                    {/* Záhlaví dne */}
                    <div className="max-lg:hidden -mx-4 sm:-mx-5 !-mt-5 px-4 sm:px-5 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <span className="font-bold text-slate-900 text-sm">
                          {formatCzechDate(date)}
                        </span>
                        {isToday && (
                          <span className="chip bg-sky-50 text-sky-700">
                            Dnes
                          </span>
                        )}
                        <span className="text-xs text-slate-500">
                          ({txs.length} {txs.length === 1 ? 'položka' : txs.length < 5 ? 'položky' : 'položek'})
                        </span>

                        {hasNegative && (
                          <span className="chip bg-red-100 text-red-700">
                            <AlertTriangle className="w-3 h-3" />
                            Během dne v mínusu
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3 text-xs">
                        <span className="text-slate-500">
                          Začátek dne: <strong>{formatCurrency(intraDay.startOfDayBalanceInHaler)}</strong>
                        </span>
                        <span className="text-slate-300">|</span>
                        <span className="text-slate-500">
                          Konec dne: <strong>{formatCurrency(intraDay.endOfDayBalanceInHaler)}</strong>
                        </span>
                      </div>
                    </div>

                    {hasNegative && (
                      <p className="panel panel-error">
                        Během dne klesne zůstatek pod nulu (nejníž na {formatCurrency(intraDay.minBalanceDuringDayInHaler)}). Přesuňte příjem před výdaj a zůstatek zůstane kladný.
                      </p>
                    )}

                    {/* Položky dne na mobilu: řádky-karty jako v Seznamu, pořadí mění šipky */}
                    <ul className={`lg:hidden -mx-4 sm:-mx-5 -mb-4 sm:-mb-5 divide-y divide-slate-100 text-xs ${hasNegative ? '' : '!mt-0'}`}>
                      {intraDay.steps.map(({ transaction: tx, runningBalanceInHaler }, stepIndex) => {
                        const p = getListRowParts(tx, stepIndex, false);
                        const balanceAfterInHaler = sourceAccountBalanceByTxId.get(tx.id) ?? runningBalanceInHaler;
                        const isNegativeRow = balanceAfterInHaler < 0 && tx.status !== 'cancelled' && tx.type !== 'balance_adjustment';

                        return (
                          <li key={tx.id} className={`px-4 sm:px-5 py-3 space-y-1.5 ${isNegativeRow ? 'bg-red-50/60' : p.rowTone}`}>
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 font-semibold text-slate-900">
                                {p.title}
                                {p.note}
                              </div>
                              <div className="shrink-0 text-right">
                                <div className={`font-bold tabular-nums ${p.amountClass}`}>{p.amount}</div>
                                <div className={`tabular-nums ${balanceAfterInHaler < 0 ? 'text-red-600' : 'text-slate-500'}`}>
                                  zůstatek {formatCurrency(balanceAfterInHaler)}
                                </div>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-slate-500 min-w-0">
                              {p.categoryInline}
                              {p.categoryInline && p.accountInline && <span aria-hidden="true">·</span>}
                              {p.accountInline && <span className="truncate">{p.accountInline}</span>}
                            </div>
                            <div className="flex flex-wrap items-center justify-between gap-x-2">
                              <div>{p.status}</div>
                              <div className="ml-auto flex items-center justify-end -mr-2">
                                <MoveButtons
                                  layout="inline"
                                  itemLabel={tx.title}
                                  canMoveUp={stepIndex > 0}
                                  canMoveDown={stepIndex < intraDay.steps.length - 1}
                                  onMove={(direction) => handleMoveDayTransaction(
                                    date,
                                    intraDay.steps.map(s => s.transaction.id),
                                    tx,
                                    direction
                                  )}
                                />
                                {p.actions}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>

                    {/* Seznam položek v rámci dne (Draggable) */}
                    <div className="max-lg:hidden space-y-1.5">
                      {intraDay.steps.map(({ transaction: tx, runningBalanceInHaler }, stepIndex) => {
                        const sourceAcc = accounts.find(a => a.id === tx.sourceAccountId);
                        const targetAcc = tx.targetAccountId ? accounts.find(a => a.id === tx.targetAccountId) : null;
                        const cat = categories.find(c => c.id === tx.categoryId);
                        const subCat = categories.find(c => c.id === tx.subcategoryId);

                        const effectiveAmount = getEffectiveAmountInHaler(tx);

                        const isCancelled = tx.status === 'cancelled';
                        const isCorrection = tx.type === 'balance_adjustment';

                        const diff = getCorrectionDiffInHaler(tx);

                        const balanceAfterInHaler = sourceAccountBalanceByTxId.get(tx.id) ?? runningBalanceInHaler;

                        return (
                          <div
                            key={tx.id}
                            draggable
                            onDragStart={(e) => handleDragStart(e, tx.id)}
                            onDragOver={handleDragOver}
                            onDrop={() => handleDrop(date, tx.id)}
                            className={`group flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-xl border transition-all select-none md:cursor-move ${
                              draggedTxId === tx.id
                                ? 'opacity-40 bg-sky-50 border-dashed border-sky-400'
                                : isCorrection
                                  ? 'bg-slate-50 border-transparent'
                                  : balanceAfterInHaler < 0 && !isCancelled
                                    ? 'bg-red-50/60 border-transparent hover:bg-red-50'
                                    : `${isCancelled ? 'bg-slate-50' : 'bg-white hover:bg-slate-50'} border-transparent`
                            } ${isCancelled ? 'line-through decoration-slate-400 text-slate-500' : ''}`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              {/* Úchyt pro přetažení a šipky pro posun tvoří jeden úzký ovladač pořadí */}
                              <div className="flex items-center gap-0.5 shrink-0">
                              <div aria-hidden="true" className="max-md:hidden text-slate-500 hover:text-slate-600 cursor-grab p-0.5">
                                <GripVertical className="w-4 h-4" />
                              </div>

                              <MoveButtons
                                layout="stack"
                                className="max-md:-ml-2 shrink-0"
                                itemLabel={tx.title}
                                canMoveUp={stepIndex > 0}
                                canMoveDown={stepIndex < intraDay.steps.length - 1}
                                onMove={(direction) => handleMoveDayTransaction(
                                  date,
                                  intraDay.steps.map(s => s.transaction.id),
                                  tx,
                                  direction
                                )}
                              />
                              </div>

                              <span className="chip bg-slate-100 text-slate-600 shrink-0">
                                #{tx.sequence || 1}
                              </span>

                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                  {isCorrection ? (
                                    <button
                                      type="button"
                                      onClick={() => openCorrection(tx)}
                                      className="min-w-0 max-w-full text-xs font-bold text-slate-900 hover:text-sky-700 hover:underline text-left flex items-center gap-1.5"
                                    >
                                      <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden="true" />
                                      <span className="truncate">{tx.title}</span>
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => onEditTransaction(tx)}
                                      className="min-w-0 max-w-full text-xs font-bold text-slate-900 hover:text-sky-700 hover:underline text-left truncate"
                                    >
                                      {tx.title}
                                    </button>
                                  )}
                                  {tx.recurringRuleId && (
                                    <span title="Pravidelná položka" role="img" aria-label="Pravidelná položka" className="shrink-0 inline-flex">
                                      <Repeat className="w-3.5 h-3.5 text-slate-500" />
                                    </span>
                                  )}
                                  {isCorrection ? (
                                    <span className="chip bg-slate-100 text-slate-600">
                                      Korekce
                                    </span>
                                  ) : (
                                    renderStatusBadge(tx)
                                  )}
                                </div>

                                <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-2 mt-0.5">
                                  {isCorrection ? (
                                    <span className="text-slate-500 font-medium text-xs">Korekce zůstatku</span>
                                  ) : cat ? (
                                    <span>{cat.name} {subCat && `› ${subCat.name}`}</span>
                                  ) : tx.type !== 'transfer' ? (
                                    <span className="italic">Bez kategorie</span>
                                  ) : null}
                                  {sourceAcc && <span>• {sourceAcc.name} {targetAcc && `→ ${targetAcc.name}`}</span>}
                                </div>
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center justify-between sm:justify-end gap-x-4 mt-2 sm:mt-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100 text-xs">
                              <div className="text-right">
                                <span className={`font-bold block whitespace-nowrap ${
                                  isCorrection
                                    ? (diff >= 0 ? 'text-emerald-600' : 'text-red-600')
                                    : tx.type === 'income' 
                                      ? 'text-emerald-600' 
                                      : tx.type === 'expense' 
                                        ? 'text-red-600'
                                        : 'text-slate-900'
                                }`}>
                                  {isCorrection
                                    ? formatCurrency(diff, { showPlus: true })
                                    : `${tx.type === 'income' ? '+' : tx.type === 'expense' ? '−' : ''}${formatCurrency(effectiveAmount)}`}
                                </span>
                              </div>

                              <div className="text-right min-w-[120px]">
                                <span className="text-xs text-slate-500 block leading-tight">
                                  Zůstatek po položce:
                                </span>
                                <span className={`font-bold block ${
                                  balanceAfterInHaler < 0 ? 'text-red-600' : 'text-slate-900'
                                }`}>
                                  {formatCurrency(balanceAfterInHaler)}
                                </span>
                              </div>

                              <div className="flex items-center justify-end gap-1 max-sm:w-full max-sm:-mr-2">
                                {isCorrection ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => openCorrection(tx)}
                                      title="Detail a poznámka korekce"
                                      aria-label={`Detail a poznámka korekce: ${tx.title}`}
                                      className="btn-icon"
                                    >
                                      <Eye className="w-4 h-4" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void deleteCorrection(tx.id)}
                                      title="Smazat korekci"
                                      aria-label={`Smazat korekci: ${tx.title}`}
                                      className="btn-icon btn-icon-danger"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    {/* Stav se mění jen štítkem stavu, řádek nese úpravu, duplikaci a smazání */}
                                    <button
                                      onClick={() => onEditTransaction(tx)}
                                      title="Upravit položku"
                                      aria-label={`Upravit položku: ${tx.title}`}
                                      className="btn-icon"
                                    >
                                      <Edit3 className="w-4 h-4" />
                                    </button>
                                    <button
                                      onClick={() => onDuplicateTransaction(tx)}
                                      title="Duplikovat položku"
                                      aria-label={`Duplikovat položku: ${tx.title}`}
                                      className="btn-icon"
                                    >
                                      <Copy className="w-4 h-4" />
                                    </button>
                                    <button
                                      onClick={() => requestDelete(tx)}
                                      disabled={isDeletingTx}
                                      title="Smazat položku"
                                      aria-label={`Smazat položku: ${tx.title}`}
                                      className="btn-icon btn-icon-danger"
                                    >
                                      <Trash2 className="w-4 h-4" />
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
                  </React.Fragment>
                );
              })
            )}
          </div>
        ) : (
          /* 2. REŽIM: SEZNAM POLOŽEK — do 1024px řádky-karty jako ve Všech položkách, od lg tabulka */
          <>
          <ul className="lg:hidden divide-y divide-slate-100 text-xs">
            {sortedListTransactions.length === 0 ? (
              <li className="empty-state">{emptyListMessage}</li>
            ) : (
              sortedListTransactions.map((tx, rowIndex) => {
                const p = getListRowParts(tx, rowIndex);
                return (
                  <li key={tx.id} data-budget-date={tx.date} className={`scroll-mt-28 p-3 space-y-1.5 ${p.rowTone}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 font-semibold text-slate-900">
                        {p.title}
                        {p.note}
                      </div>
                      <div className={`shrink-0 font-bold tabular-nums ${p.amountClass}`}>{p.amount}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-slate-500 min-w-0">
                      <span className="shrink-0">{formatCzechDate(tx.date)}</span>
                      {p.categoryInline && (
                        <>
                          <span aria-hidden="true">·</span>
                          {p.categoryInline}
                        </>
                      )}
                      {p.accountInline && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="truncate">{p.accountInline}</span>
                        </>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-x-2">
                      <div>{p.status}</div>
                      <div className="ml-auto flex items-center justify-end -mr-2">{p.actions}</div>
                    </div>
                  </li>
                );
              })
            )}
          </ul>

          <div className="max-lg:hidden overflow-x-auto">
            <table className="w-full min-w-[1080px] text-left text-xs whitespace-nowrap table-fixed">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold select-none">
                  <th
                    aria-sort={dateSortOrder === 'asc' ? 'ascending' : 'descending'}
                    className="w-[110px] p-0"
                  >
                    <button
                      type="button"
                      onClick={toggleDateSort}
                      className="w-full py-2.5 px-4 flex items-center gap-1.5 font-semibold hover:text-slate-900 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500/40"
                      title={`Řazení podle data a pořadí (${dateSortOrder === 'asc' ? 'Vzestupně: od nejstarších, v rámci dne 1, 2, 3…' : 'Sestupně: od nejnovějších, v rámci dne …3, 2, 1'})`}
                    >
                      <span>Datum</span>
                      {dateSortOrder === 'asc' ? (
                        <ArrowUp className="w-3.5 h-3.5 text-sky-600" aria-hidden="true" />
                      ) : (
                        <ArrowDown className="w-3.5 h-3.5 text-sky-600" aria-hidden="true" />
                      )}
                    </button>
                  </th>
                  <th className="w-[70px] py-2.5 px-3 text-center" title="Pořadí v rámci dne">Pořadí</th>
                <th className="min-w-[160px] py-2.5 px-4">Název položky</th>
                <th className="w-[160px] py-2.5 px-4">Kategorie</th>
                <th className="w-[150px] py-2.5 px-4">Účet</th>
                <th className="w-[140px] py-2.5 px-4">Stav</th>
                <th className="w-[120px] py-2.5 px-4 text-right">Částka</th>
                <th className="w-[170px] py-2.5 px-4 text-right">Akce</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedListTransactions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="empty-state">
                    {emptyListMessage}
                  </td>
                </tr>
              ) : (
                sortedListTransactions.map((tx, rowIndex) => {
                  const p = getListRowParts(tx, rowIndex);
                  return (
                    <tr
                      key={tx.id}
                      data-budget-date={tx.date}
                      className={`scroll-mt-28 hover:bg-slate-50 transition-colors ${p.rowTone}`}
                    >
                      <td className="py-3 px-4 text-slate-500 overflow-hidden">
                        {formatCzechDate(tx.date)}
                      </td>
                      <td className="py-3 px-3 text-center overflow-hidden">
                        <span className="chip bg-slate-100 text-slate-600">
                          #{tx.sequence || 1}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-900 overflow-hidden">
                        {p.title}
                        {p.note}
                      </td>
                      <td className="py-3 px-4 text-slate-500 overflow-hidden">{p.category}</td>
                      <td className="py-3 px-4 text-slate-500 overflow-hidden">{p.account}</td>
                      <td className="py-3 px-4">{p.status}</td>
                      <td className={`py-3 px-4 text-right font-bold overflow-hidden ${p.amountClass}`}>{p.amount}</td>
                      <td className="py-3 px-4 text-right overflow-hidden">
                        <div className="flex items-center justify-end gap-1">{p.actions}</div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
          </>
      )}
      </div>

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

      <ReorderScopeDialog
        isOpen={Boolean(pendingRecurringReorder)}
        onClose={() => setPendingRecurringReorder(null)}
        transactionTitle={pendingRecurringReorder?.ruleTitle || ''}
        onConfirm={handleConfirmRecurringReorder}
      />

      {/* Detail korekce pro zobrazení a editaci poznámky */}
      <CorrectionDetailModal
        isOpen={Boolean(selectedCorrection)}
        onClose={() => setSelectedCorrection(null)}
        correctionItem={selectedCorrection}      />
    </div>
);
};
