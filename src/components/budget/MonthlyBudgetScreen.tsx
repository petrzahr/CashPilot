import React, { useState, useMemo, useEffect } from 'react';
import { useFinance } from '../../context/FinanceContext';
import { addHaler, formatCurrency, subHaler } from '../../services/currencyService';
import { formatCzechDate, getTodayInPrague } from '../../services/periodService';
import { calculateIntraDayRunningBalances } from '../../services/sequenceService';
import { calculatePeriodInvestmentChange } from '../../services/investmentPerformanceService';
import { MovementType, Transaction, TransactionStatus } from '../../types/finance';
import { 
  Plus, 
  Check, 
  Copy, 
  Trash2, 
  Ban,
  RotateCcw, 
  Edit3, 
  ArrowRightLeft, 
  Search, 
  AlertTriangle,
  AlertCircle,
  GripVertical,
  List,
  Calendar,
  ChevronDown,
  Clock,
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
import { StatusBadgeMenu, PAST_PLANNED_HINT } from '../shared/StatusBadgeMenu';
import { MoveDirection, moveIdByStep, moveIdToTarget } from '../../services/reorderService';
import { czechStringCompare, sortCategoriesAlphabetically } from '../../services/categoryService';

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
    deleteTransaction,
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

  // Stav vybrané korekce pro detail modal
  const [selectedCorrection, setSelectedCorrection] = useState<Transaction | null>(null);
  // „Smazat korekci“ otevře detail rovnou s potvrzením smazání, oko jen detail
  const [correctionDeleteFirst, setCorrectionDeleteFirst] = useState(false);
  const openCorrection = (tx: Transaction, deleteFirst = false) => {
    setCorrectionDeleteFirst(deleteFirst);
    setSelectedCorrection(tx);
  };

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

  // Filtry v rámci období (multi-select - prázdný výběr = bez omezení)
  const [searchQuery, setSearchQuery] = useState('');
  const [filterAccounts, setFilterAccounts] = useState<string[]>([]);
  const [filterMainCategories, setFilterMainCategories] = useState<string[]>([]);
  const [filterSubCategories, setFilterSubCategories] = useState<string[]>([]);
  const [filterTypes, setFilterTypes] = useState<string[]>([]);
  const [filterStatuses, setFilterStatuses] = useState<string[]>([]);

  const handleMainCategoriesChange = (newMainIds: string[]) => {
    setFilterMainCategories(newMainIds);
    setFilterSubCategories([]);
  };

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

  // Souhrnné ukazatele za všechny účty, respektující vybrané rozpočtové období
  const aggregateSummary = useMemo(() => {
    // Toky za celé období bereme z neprojektovaného souhrnu - projekce aktiv od dneška
    // obsahuje jen zbývající (neprovedené) převody a uskutečněné by vynechala.
    const flowBalances = (forecast.periods.find(p => p.period.key === selectedPeriod.key) ?? currentSummary).accountBalances;

    const savedInHaler = accounts
      .filter(a => a.type === 'savings' && a.status === 'active')
      .reduce((sum, acc) => {
        const bal = flowBalances[acc.id];
        return bal ? addHaler(sum, subHaler(bal.transfersInInHaler, bal.transfersOutInHaler)) : sum;
      }, 0);

    const investedInHaler = accounts
      .filter(a => (a.type === 'investment' || a.type === 'pension') && a.status === 'active')
      .reduce((sum, acc) => {
        const bal = flowBalances[acc.id];
        return bal ? addHaler(sum, subHaler(bal.transfersInInHaler, bal.transfersOutInHaler)) : sum;
      }, 0);

    const income = currentSummary.incomeInHaler;
    const savedPct = income > 0 ? (savedInHaler / income) * 100 : null;
    const investedPct = income > 0 ? (investedInHaler / income) * 100 : null;

    const actuallySavedInHaler = accounts
      .filter(a => (a.type === 'checking' || a.type === 'cash') && a.status === 'active')
      .reduce((sum, acc) => {
        const bal = currentSummary.accountBalances[acc.id];
        return bal ? addHaler(sum, addHaler(subHaler(bal.incomeInHaler, bal.expenseInHaler), bal.correctionsInHaler)) : sum;
      }, 0);
    const actuallySavedPct = income > 0 ? (actuallySavedInHaler / income) * 100 : null;

    const investmentChange = calculatePeriodInvestmentChange(
      accounts, marketValueSnapshots, selectedPeriod, settings.budgetStartDay, undefined, transactions
    );

    return {
      usableClosingInHaler: currentSummary.usableClosingInHaler,
      netWorthClosingInHaler: currentSummary.netWorthClosingInHaler,
      savedInHaler, savedPct, investedInHaler, investedPct, investmentChange,
      actuallySavedInHaler, actuallySavedPct,
    };
  }, [accounts, forecast.periods, currentSummary, marketValueSnapshots, transactions, selectedPeriod, settings.budgetStartDay]);

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
      settings.budgetStartDay,
      undefined,
      accounts
    );
  }, [selectedPeriod, transactions, recurringRules, recurringExceptions, settings.budgetStartDay, accounts]);

  // Seznam účtů seřazený abecedně A–Z (včetně archivovaných, pokud mají záznam v tomto období)
  const sortedAccounts = useMemo(() => {
    return [...accounts]
      .filter(a => a.status === 'active' || allPeriodTransactions.some(t => t.sourceAccountId === a.id || t.targetAccountId === a.id))
      .sort((a, b) => czechStringCompare(a.name, b.name));
  }, [accounts, allPeriodTransactions]);

  // Množina ID kategorií použitých v tomto období
  const usedCategoryIdsInPeriod = useMemo(() => {
    const ids = new Set<string>();
    for (const tx of allPeriodTransactions) {
      if (tx.categoryId) ids.add(tx.categoryId);
      if (tx.subcategoryId) ids.add(tx.subcategoryId);
    }
    return ids;
  }, [allPeriodTransactions]);

  // Hlavní kategorie (příjmové i výdajové dohromady), seřazené abecedně A–Z
  const availableMainCategories = useMemo(() => {
    return categories
      .filter(c => {
        if (c.parentId) return false;
        if (c.status === 'active') return true;
        if (usedCategoryIdsInPeriod.has(c.id)) return true;
        return categories.some(sub => sub.parentId === c.id && usedCategoryIdsInPeriod.has(sub.id));
      })
      .sort((a, b) => czechStringCompare(a.name, b.name));
  }, [categories, usedCategoryIdsInPeriod]);

  // Podkategorie pro vybrané hlavní kategorie, seřazené abecedně A–Z
  const availableSubCategories = useMemo(() => {
    if (filterMainCategories.length === 0) return [];
    return categories
      .filter(c => {
        if (!c.parentId || !filterMainCategories.includes(c.parentId)) return false;
        if (c.status === 'active') return true;
        return usedCategoryIdsInPeriod.has(c.id);
      })
      .sort((a, b) => czechStringCompare(a.name, b.name));
  }, [categories, filterMainCategories, usedCategoryIdsInPeriod]);

  // ID všech podkategorií patřících pod aktuálně vybrané hlavní kategorie
  const childSubCategoryIds = useMemo(() => {
    if (filterMainCategories.length === 0) return new Set<string>();
    return new Set(categories.filter(c => c.parentId && filterMainCategories.includes(c.parentId)).map(c => c.id));
  }, [categories, filterMainCategories]);

  // Bezpečný reset filtrů, pokud se vybraná hodnota stane neplatnou
  useEffect(() => {
    const valid = filterAccounts.filter(id => sortedAccounts.some(a => a.id === id));
    if (valid.length !== filterAccounts.length) {
      setFilterAccounts(valid);
    }
  }, [sortedAccounts, filterAccounts]);

  useEffect(() => {
    const valid = filterMainCategories.filter(id => availableMainCategories.some(c => c.id === id));
    if (valid.length !== filterMainCategories.length) {
      setFilterMainCategories(valid);
      setFilterSubCategories([]);
    }
  }, [availableMainCategories, filterMainCategories]);

  useEffect(() => {
    const valid = filterSubCategories.filter(id => availableSubCategories.some(c => c.id === id));
    if (valid.length !== filterSubCategories.length) {
      setFilterSubCategories(valid);
    }
  }, [availableSubCategories, filterSubCategories]);

  // Filtrované položky v tomto období (pro tabulku a denní seskupení)
  const periodTransactions = useMemo(() => {
    return allPeriodTransactions.filter(tx => {
      if (searchQuery.trim()) {
        const s = searchQuery.toLowerCase();
        const matchTitle = tx.title.toLowerCase().includes(s);
        const matchNote = tx.note?.toLowerCase().includes(s);
        if (!matchTitle && !matchNote) return false;
      }
      if (filterAccounts.length > 0) {
        const matchesAccount = filterAccounts.includes(tx.sourceAccountId) ||
                                (!!tx.targetAccountId && filterAccounts.includes(tx.targetAccountId));
        if (!matchesAccount) return false;
      }
      if (filterMainCategories.length > 0) {
        if (filterSubCategories.length > 0) {
          const matchesSub = (!!tx.subcategoryId && filterSubCategories.includes(tx.subcategoryId)) ||
                              (!!tx.categoryId && filterSubCategories.includes(tx.categoryId));
          if (!matchesSub) return false;
        } else {
          const matchesMain = !!tx.categoryId && filterMainCategories.includes(tx.categoryId);
          const matchesChildSub = (tx.subcategoryId && childSubCategoryIds.has(tx.subcategoryId)) ||
                                  (tx.categoryId && childSubCategoryIds.has(tx.categoryId));
          if (!matchesMain && !matchesChildSub) return false;
        }
      }
      if (filterTypes.length > 0 && !filterTypes.includes(tx.type)) {
        return false;
      }
      if (filterStatuses.length > 0 && !filterStatuses.includes(tx.status)) {
        return false;
      }
      return true;
    }).sort((a, b) => a.date.localeCompare(b.date));
  }, [
    allPeriodTransactions,
    searchQuery,
    filterAccounts,
    filterMainCategories,
    filterSubCategories,
    childSubCategoryIds,
    filterTypes,
    filterStatuses
  ]);

  // Počet aktivních filtrů pro tlačítko „Zrušit filtry“
  const activeFilterCount = [
    searchQuery.trim(), filterAccounts, filterMainCategories, filterSubCategories, filterTypes, filterStatuses,
  ].filter(f => f.length > 0).length;
  // Na mobilu jsou filtry kromě hledání schované; počet ukazuje, kolik jich je za tlačítkem aktivních
  const [filtersOpen, setFiltersOpen] = useState(false);
  const hiddenFilterCount = activeFilterCount - (searchQuery.trim() ? 1 : 0);
  const clearFilters = () => {
    setSearchQuery('');
    setFilterAccounts([]);
    setFilterMainCategories([]);
    setFilterSubCategories([]);
    setFilterTypes([]);
    setFilterStatuses([]);
  };

  // Prázdný seznam: odliší období bez položek od filtrů, které nic nenašly
  const emptyListMessage = allPeriodTransactions.length === 0
    ? 'V tomto období zatím nejsou žádné položky. Přidejte první tlačítkem Přidat položku.'
    : 'Filtrům neodpovídá žádná položka. Upravte filtry, nebo je zrušte tlačítkem Zrušit filtry.';

  // Suma vyfiltrovaných položek (příjem +, výdaj −, převod a korekce dle znaménka jako ve výpisu)
  const periodTransactionsSum = useMemo(() => {
    return periodTransactions.reduce((sum, tx) => {
      const effectiveAmount = tx.status === 'executed' && tx.actualAmountInHaler !== undefined
        ? tx.actualAmountInHaler
        : tx.amountInHaler;
      if (tx.type === 'balance_adjustment') {
        const diff = tx.diffInHaler ?? (
          tx.actualBalanceInHaler !== undefined && tx.calculatedBalanceInHaler !== undefined
            ? tx.actualBalanceInHaler - tx.calculatedBalanceInHaler
            : tx.amountInHaler
        );
        return addHaler(sum, diff);
      }
      if (tx.type === 'expense') return subHaler(sum, effectiveAmount);
      return addHaler(sum, effectiveAmount);
    }, 0);
  }, [periodTransactions]);

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
      const intraDay = calculateIntraDayRunningBalances(runningBalance, dayTxs, undefined, usableAccountIds);
      runningBalance = intraDay.endOfDayBalanceInHaler;

      return {
        date,
        txs: dayTxs,
        intraDay,
      };
    });
  }, [periodTransactions, currentSummary.usableOpeningInHaler, usableAccountIds]);

  // Zůstatek zdrojového účtu po každé položce (z nefiltrovaných položek období, aby filtr neovlivnil výsledek)
  const sourceAccountBalanceByTxId = useMemo(() => {
    const balances = (forecast.periods.find(p => p.period.key === selectedPeriod.key) ?? currentSummary).accountBalances;
    const txsByAccount = new Map<string, Transaction[]>();
    allPeriodTransactions.forEach(tx => {
      [tx.sourceAccountId, tx.targetAccountId].forEach(id => {
        if (!id) return;
        const list = txsByAccount.get(id) || [];
        if (!list.includes(tx)) list.push(tx);
        txsByAccount.set(id, list);
      });
    });

    const result = new Map<string, number>();
    txsByAccount.forEach((accTxs, accountId) => {
      let running = balances[accountId]?.openingBalanceInHaler ?? 0;
      const dates = Array.from(new Set(accTxs.map(t => t.date))).sort();
      for (const date of dates) {
        const intraDay = calculateIntraDayRunningBalances(running, accTxs.filter(t => t.date === date), accountId);
        intraDay.steps.forEach(step => {
          if (step.transaction.sourceAccountId === accountId) {
            result.set(step.transaction.id, step.runningBalanceInHaler);
          }
        });
        running = intraDay.endOfDayBalanceInHaler;
      }
    });
    return result;
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
    return transferTxs.reduce((sum, t) => addHaler(sum, t.status === 'executed' && t.actualAmountInHaler !== undefined ? t.actualAmountInHaler : t.amountInHaler), 0);
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
    <div className="space-y-6">
      {/* Panel ukazatelů: řádky čísel patří k sobě, proto užší rozestup než mezi sekcemi */}
      <div className="space-y-4">
        {/* Zvýrazněný řádek: použitelný zůstatek a celkový majetek přes všechny účty */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
            <span className="text-xs text-slate-500 block font-semibold uppercase tracking-wide">Použitelný zůstatek</span>
            <span className={`text-xl sm:text-2xl font-extrabold block mt-1 truncate ${aggregateSummary.usableClosingInHaler < 0 ? 'text-red-600' : 'text-slate-900'}`}>
              {formatCurrency(aggregateSummary.usableClosingInHaler)}
            </span>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
            <span className="text-xs text-slate-500 block font-semibold uppercase tracking-wide">Celkový majetek</span>
            <span className={`text-xl sm:text-2xl font-extrabold block mt-1 truncate ${aggregateSummary.netWorthClosingInHaler < 0 ? 'text-red-600' : 'text-purple-600'}`}>
              {formatCurrency(aggregateSummary.netWorthClosingInHaler)}
            </span>
          </div>
        </div>

        {/* Finanční bilance období (Souhrnný panel výchozího účtu) */}
        {!defaultAccount ? (
          <div className="p-4 bg-amber-50 border border-amber-200/80 rounded-2xl flex items-start gap-3 shadow-sm">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="text-sm font-bold text-amber-900">Chybí výchozí účet</h4>
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
              <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
                <span className="text-xs text-slate-500 block font-medium">Počáteční stav</span>
                <span className="text-base font-bold text-slate-900 block mt-0.5 truncate">
                  {formatCurrency(defaultOpeningBalance)}
                </span>
              </div>

              <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
                <span className="text-xs text-slate-500 block font-medium">+ Příjmy</span>
                <span className="text-base font-bold text-emerald-600 block mt-0.5 truncate">
                  {formatCurrency(defaultIncomeBalance)}
                </span>
              </div>

              <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
                <span className="text-xs text-slate-500 block font-medium">− Výdaje</span>
                <span className="text-base font-bold text-red-600 block mt-0.5 truncate">
                  {formatCurrency(defaultExpenseBalance)}
                </span>
              </div>

              <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
                <span className="text-xs text-slate-500 block font-medium">Převody</span>
                <span
                  className={`text-base font-bold block mt-0.5 truncate ${
                    defaultNetTransfers > 0 ? 'text-emerald-600' : defaultNetTransfers < 0 ? 'text-red-600' : 'text-slate-900'
                  }`}
                  title={`Příchozí: ${formatCurrency(defaultTransfersIn)}, Odchozí: ${formatCurrency(defaultTransfersOut)}`}
                >
                  {formatCurrency(defaultNetTransfers, { showPlus: true })}
                </span>
              </div>

              <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
                <span className="text-xs text-slate-500 block font-medium">Čistá změna</span>
                <span className={`text-base font-bold block mt-0.5 truncate ${
                  signTone(defaultNetChange)
                }`}>
                  {formatCurrency(defaultNetChange, { showPlus: true })}
                </span>
              </div>

              <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
                <span className="text-xs text-slate-500 block font-medium">Konečný stav</span>
                <span className={`text-base font-bold block mt-0.5 truncate ${
                  defaultClosingBalance < 0 ? 'text-red-600' : 'text-slate-900'
                }`}>
                  {formatCurrency(defaultClosingBalance)}
                </span>
              </div>

              <div className={`p-3 rounded-xl border shadow-sm col-span-2 sm:col-span-1 transition-colors ${
                isOverdraftExceeded
                  ? 'bg-red-50/90 border-red-300'
                  : 'bg-white border-slate-200'
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
                    isOverdraftExceeded ? 'text-red-600' : 'text-slate-900'
                  }`}
                  title={isOverdraftExceeded ? 'Kontokorent překročen' : `Limit: ${formatCurrency(overdraftLimit)}`}
                >
                  {formatCurrency(defaultWithOverdraft)}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Souhrnné ukazatele za všechny účty (respektují vybrané rozpočtové období) */}
        <div className="space-y-2.5">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
            <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm" title="Příjmy − výdaje + korekce na běžných účtech a hotovosti, bez převodů">
              <span className="text-xs text-slate-500 block font-medium">Skutečně uspořeno</span>
              <span className={`text-base font-bold block mt-0.5 truncate ${
                signTone(aggregateSummary.actuallySavedInHaler)
              }`}>
                {formatCurrency(aggregateSummary.actuallySavedInHaler, { showPlus: true })}
              </span>
            </div>

            <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
              <span className="text-xs text-slate-500 block font-medium">Skutečně uspořeno %</span>
              <span className={`text-base font-bold block mt-0.5 truncate ${signTone(aggregateSummary.actuallySavedPct)}`}>
                {formatPercent(aggregateSummary.actuallySavedPct)}
              </span>
            </div>

            <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
              <span className="text-xs text-slate-500 block font-medium">Uspořeno</span>
              <span className={`text-base font-bold block mt-0.5 truncate ${
                signTone(aggregateSummary.savedInHaler)
              }`}>
                {formatCurrency(aggregateSummary.savedInHaler, { showPlus: true })}
              </span>
            </div>

            <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
              <span className="text-xs text-slate-500 block font-medium">Uspořeno %</span>
              <span className={`text-base font-bold block mt-0.5 truncate ${signTone(aggregateSummary.savedPct)}`}>
                {formatPercent(aggregateSummary.savedPct)}
              </span>
            </div>

            <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
              <span className="text-xs text-slate-500 block font-medium">Investováno</span>
              <span className={`text-base font-bold block mt-0.5 truncate ${signTone(aggregateSummary.investedInHaler)}`}>
                {formatCurrency(aggregateSummary.investedInHaler, { showPlus: true })}
              </span>
            </div>

            <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
              <span className="text-xs text-slate-500 block font-medium">Investováno %</span>
              <span className={`text-base font-bold block mt-0.5 truncate ${signTone(aggregateSummary.investedPct)}`}>
                {formatPercent(aggregateSummary.investedPct)}
              </span>
            </div>

            <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm col-span-2 sm:col-span-1">
              <span className="text-xs text-slate-500 block font-medium">Změna investic</span>
              <span className={`text-base font-bold block mt-0.5 truncate ${
                signTone(aggregateSummary.investmentChange)
              }`}>
                {aggregateSummary.investmentChange === null ? '—' : formatCurrency(aggregateSummary.investmentChange, { showPlus: true })}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Dynamické sekce rozpočtu podle kategorií */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
        <h3 className="text-sm font-bold text-slate-900">Přehled rozpočtu podle kategorií</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {categoryBreakdown.map(({ category, totalInHaler, subcategories }) => (
            <div
              key={category.id}
              className="p-3 rounded-xl bg-slate-50 space-y-2"
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
                <div className="space-y-1 pt-1 border-t border-slate-200">
                  {subcategories.map(({ sub, totalInHaler: subTotal }) => (
                    <div key={sub.id} className="flex justify-between text-xs text-slate-500">
                      <span>{sub.name}</span>
                      <span className="font-medium text-slate-500">{formatCurrency(subTotal)}</span>
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
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ArrowRightLeft className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
                <span className="text-xs font-bold text-slate-900">Spoření a převody</span>
              </div>
              <span className="text-xs font-bold text-slate-900">
                {formatCurrency(totalTransfersInHaler)}
              </span>
            </div>
            {transferTxs.length > 0 ? (
              <div className="space-y-1 pt-1 border-t border-slate-200">
                {transferTxs.map(tx => (
                  <div key={tx.id} className="flex justify-between gap-3 text-xs text-slate-500">
                    <span className="truncate min-w-0">{tx.title}</span>
                    <span className="font-medium shrink-0">{formatCurrency(tx.status === 'executed' && tx.actualAmountInHaler !== undefined ? tx.actualAmountInHaler : tx.amountInHaler)}</span>
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
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-bold text-slate-900">Položky období</h3>
                <span className="px-2 py-0.5 text-xs font-semibold bg-slate-100 text-slate-500 rounded-md">
                  {periodTransactions.length}
                </span>
                <span className="text-xs font-semibold text-slate-500">Součet</span>
                <span className="px-2 py-0.5 text-xs font-semibold bg-slate-100 text-slate-500 rounded-md">
                  {formatCurrency(periodTransactionsSum, { showPlus: true })}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5">
              <div className="h-8 max-md:h-[52px] flex items-center gap-1 p-1 bg-slate-100 rounded-xl text-xs">
                <button
                  type="button"
                  onClick={() => setViewMode('daily')}
                  aria-pressed={viewMode === 'daily'}
                  className={`h-full flex items-center gap-1.5 px-3 rounded-lg font-semibold transition-all ${
                    viewMode === 'daily' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  <Calendar className="w-3.5 h-3.5" />
                  <span>Po dnech</span>
                </button>

                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  aria-pressed={viewMode === 'list'}
                  className={`h-full flex items-center gap-1.5 px-3 rounded-lg font-semibold transition-all ${
                    viewMode === 'list' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  <List className="w-3.5 h-3.5" />
                  <span>Klasický seznam</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => onOpenTransactionModal()}
                className="max-md:min-h-11 w-full sm:w-auto flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-xl shadow-sm transition-colors shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>Přidat položku</span>
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
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="max-md:min-h-11 w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
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
                className="max-md:min-h-11 inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold text-sky-700 hover:bg-sky-50 transition-colors"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
                Zrušit filtry ({activeFilterCount})
              </button>
            </div>
          )}
      </div>

      {/* Seznam všech položek tohoto období */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {/* 1. REŽIM: PO DNECH S DRAG-AND-DROP A PRŮBĚŽNÝM ZŮSTATKEM */}
        {viewMode === 'daily' ? (
          <div className="divide-y divide-slate-100">
            {dayGroups.length === 0 ? (
              <div className="py-12 text-center text-slate-500 text-sm">
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
                    <div role="separator" aria-label={`Dnes, ${formatCzechDate(todayIso)}`} className="flex items-center gap-3 px-4 sm:px-5 py-2 bg-slate-50 text-xs font-bold text-slate-900">
                      <span>Dnes · {formatCzechDate(todayIso)}</span>
                      <span className="h-px flex-1 bg-slate-300" aria-hidden="true" />
                    </div>
                  )}
                  <div className={`p-4 sm:p-5 space-y-3 ${isToday ? 'bg-slate-50' : ''}`}>
                    {/* Záhlaví dne */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <span className="font-bold text-slate-900 text-sm">
                          {formatCzechDate(date)}
                        </span>
                        {isToday && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-sky-50 text-sky-700 border border-sky-200">
                            Dnes
                          </span>
                        )}
                        <span className="text-xs text-slate-500">
                          ({txs.length} {txs.length === 1 ? 'položka' : txs.length < 5 ? 'položky' : 'položek'})
                        </span>

                        {hasNegative && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700 border border-red-200">
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
                      <p className="text-xs text-red-600 bg-red-50 p-2.5 rounded-xl border border-red-200">
                        Během dne klesne zůstatek pod nulu (nejníž na {formatCurrency(intraDay.minBalanceDuringDayInHaler)}). Přesuňte příjem před výdaj a zůstatek zůstane kladný.
                      </p>
                    )}

                    {/* Seznam položek v rámci dne (Draggable) */}
                    <div className="space-y-1.5">
                      {intraDay.steps.map(({ transaction: tx, runningBalanceInHaler }, stepIndex) => {
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

                              <span className="px-1.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-500 shrink-0">
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
                                    <span className="min-w-0 max-w-full text-xs font-bold text-slate-900 truncate">
                                      {tx.title}
                                    </span>
                                  )}
                                  {tx.recurringRuleId && (
                                    <span title="Pravidelná položka" className="shrink-0 inline-flex">
                                      <Repeat className="w-3.5 h-3.5 text-slate-500" />
                                    </span>
                                  )}
                                  {isCorrection ? (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200">
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
                                      className="max-md:inline-flex items-center justify-center min-w-11 min-h-11 md:min-w-0 md:min-h-0 p-1 rounded text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                                    >
                                      <Eye className="w-4 h-4" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => openCorrection(tx, true)}
                                      title="Smazat korekci"
                                      aria-label={`Smazat korekci: ${tx.title}`}
                                      className="max-md:inline-flex items-center justify-center min-w-11 min-h-11 md:min-w-0 md:min-h-0 p-1 rounded text-slate-500 hover:text-red-600 focus-visible:text-red-600 hover:bg-red-50 transition-colors"
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
                                        aria-label={`Označit jako uskutečněnou: ${tx.title}`}
                                        className="max-md:inline-flex items-center justify-center min-w-11 min-h-11 md:min-w-0 md:min-h-0 p-1 rounded text-slate-500 hover:text-emerald-600 focus-visible:text-emerald-600 hover:bg-emerald-50 transition-colors disabled:opacity-50"
                                      >
                                        <Check className="w-4 h-4" />
                                      </button>
                                    ) : (
                                      <button
                                        onClick={() => handleStatusChange(tx.id, 'planned')}
                                        disabled={updatingStatusTxId === tx.id || tx.date <= todayIso}
                                        title={tx.date <= todayIso ? PAST_PLANNED_HINT : 'Vrátit do plánovaných'}
                                        aria-label={`Vrátit do plánovaných: ${tx.title}`}
                                        className="max-md:inline-flex items-center justify-center min-w-11 min-h-11 md:min-w-0 md:min-h-0 p-1 rounded text-slate-500 hover:text-amber-600 focus-visible:text-amber-600 hover:bg-amber-50 transition-colors disabled:opacity-50"
                                      >
                                        <Clock className="w-4 h-4" />
                                      </button>
                                    )}
                                    <button
                                      onClick={() => onEditTransaction(tx)}
                                      title="Upravit položku"
                                      aria-label={`Upravit položku: ${tx.title}`}
                                      className="max-md:inline-flex items-center justify-center min-w-11 min-h-11 md:min-w-0 md:min-h-0 p-1 rounded text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                                    >
                                      <Edit3 className="w-4 h-4" />
                                    </button>
                                    <button
                                      onClick={() => duplicateTransaction(tx)}
                                      title="Duplikovat položku"
                                      aria-label={`Duplikovat položku: ${tx.title}`}
                                      className="max-md:inline-flex items-center justify-center min-w-11 min-h-11 md:min-w-0 md:min-h-0 p-1 rounded text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                                    >
                                      <Copy className="w-4 h-4" />
                                    </button>
                                    {tx.status !== 'cancelled' ? (
                                      <button
                                        onClick={() => handleStatusChange(tx.id, 'cancelled')}
                                        disabled={updatingStatusTxId === tx.id}
                                        title="Označit jako zrušenou"
                                        aria-label={`Označit jako zrušenou: ${tx.title}`}
                                        className="max-md:inline-flex items-center justify-center min-w-11 min-h-11 md:min-w-0 md:min-h-0 p-1 rounded text-slate-500 hover:text-amber-600 focus-visible:text-amber-600 hover:bg-amber-50 transition-colors disabled:opacity-50"
                                      >
                                        <Ban className="w-4 h-4" />
                                      </button>
                                    ) : (
                                      <button
                                        onClick={() => handleStatusChange(tx.id, 'planned')}
                                        disabled={updatingStatusTxId === tx.id}
                                        title="Vrátit zrušenou položku do plánovaných"
                                        aria-label={`Vrátit zrušenou položku do plánovaných: ${tx.title}`}
                                        className="max-md:inline-flex items-center justify-center min-w-11 min-h-11 md:min-w-0 md:min-h-0 p-1 rounded text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                                      >
                                        <RotateCcw className="w-4 h-4" />
                                      </button>
                                    )}
                                    <button
                                      onClick={() => setDeletingTx(tx)}
                                      disabled={isDeletingTx}
                                      title="Smazat položku"
                                      aria-label={`Smazat položku: ${tx.title}`}
                                      className="max-md:inline-flex items-center justify-center min-w-11 min-h-11 md:min-w-0 md:min-h-0 p-1 rounded text-slate-500 hover:text-red-600 focus-visible:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
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
          /* 2. REŽIM: KLASICKÁ TABULKA POLOŽEK */
          <div className="overflow-x-auto">
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
                      className="w-full py-2.5 px-4 flex items-center gap-1.5 font-semibold hover:text-slate-900 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500/40"
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
                  <td colSpan={8} className="py-8 text-center text-slate-500">
                    {emptyListMessage}
                  </td>
                </tr>
              ) : (
                sortedListTransactions.map((tx, rowIndex) => {
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
                    <tr
                      key={tx.id}
                      className={`hover:bg-slate-50 transition-colors ${
                        isCancelled ? 'line-through decoration-slate-400 bg-slate-50 text-slate-500' : isCorrection ? 'bg-slate-50' : ''
                      }`}
                    >
                      <td className="py-3 px-4 text-slate-500 overflow-hidden">
                        {formatCzechDate(tx.date)}
                      </td>
                      <td className="py-3 px-3 text-center overflow-hidden">
                        <span className="px-1.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-500">
                          #{tx.sequence || 1}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-900 overflow-hidden">
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
                            <span className="truncate min-w-0">{tx.title}</span>
                          )}
                          {tx.recurringRuleId && (
                            <span title="Pravidelná položka" className="shrink-0 inline-flex">
                              <Repeat className="w-3.5 h-3.5 text-slate-500" />
                            </span>
                          )}
                          {isCorrection && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-semibold shrink-0">
                              Korekce
                            </span>
                          )}
                        </div>
                        {tx.note && <span className="text-xs text-slate-500 block font-normal truncate">{tx.note}</span>}
                      </td>
                      <td className="py-3 px-4 text-slate-500 overflow-hidden">
                        {isCorrection ? (
                          <span className="text-slate-600 font-medium text-xs bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
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
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-500 overflow-hidden">
                        {sourceAcc ? (
                          <span className="block min-w-0" title={targetAcc ? `${sourceAcc.name} → ${targetAcc.name}` : sourceAcc.name}>
                            <span className="block truncate">{sourceAcc.name}</span>
                            {targetAcc && <span className="block text-slate-500 truncate">→ {targetAcc.name}</span>}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="py-3 px-4">
                        {/* Stejný štítek jako v zobrazení po dnech: korekce má vlastní štítek, ostatní stav lze změnit */}
                        {isCorrection ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                            Korekce
                          </span>
                        ) : (
                          renderStatusBadge(tx, rowIndex >= sortedListTransactions.length - 3 && sortedListTransactions.length > 3)
                        )}
                      </td>
                      <td className={`py-3 px-4 text-right font-bold overflow-hidden ${
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
                      </td>
                      <td className="py-3 px-4 text-right overflow-hidden">
                        <div className="flex items-center justify-end gap-1">
                          {isCorrection ? (
                            <>
                              <button
                                type="button"
                                onClick={() => openCorrection(tx)}
                                title="Detail a poznámka korekce"
                                aria-label={`Detail a poznámka korekce: ${tx.title}`}
                                className="max-md:inline-flex items-center justify-center min-w-11 min-h-11 md:min-w-0 md:min-h-0 p-1 rounded text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => openCorrection(tx, true)}
                                title="Smazat korekci"
                                aria-label={`Smazat korekci: ${tx.title}`}
                                className="max-md:inline-flex items-center justify-center min-w-11 min-h-11 md:min-w-0 md:min-h-0 p-1 rounded text-slate-500 hover:text-red-600 focus-visible:text-red-600 hover:bg-red-50 transition-colors"
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
                                  aria-label={`Označit jako uskutečněnou: ${tx.title}`}
                                  className="max-md:inline-flex items-center justify-center min-w-11 min-h-11 md:min-w-0 md:min-h-0 p-1 rounded text-slate-500 hover:text-emerald-600 focus-visible:text-emerald-600 hover:bg-emerald-50 transition-colors disabled:opacity-50"
                                >
                                  <Check className="w-4 h-4" />
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleStatusChange(tx.id, 'planned')}
                                  disabled={updatingStatusTxId === tx.id || tx.date <= todayIso}
                                  title={tx.date <= todayIso ? PAST_PLANNED_HINT : 'Vrátit do plánovaných'}
                                  aria-label={`Vrátit do plánovaných: ${tx.title}`}
                                  className="max-md:inline-flex items-center justify-center min-w-11 min-h-11 md:min-w-0 md:min-h-0 p-1 rounded text-slate-500 hover:text-amber-600 focus-visible:text-amber-600 hover:bg-amber-50 transition-colors disabled:opacity-50"
                                >
                                  <Clock className="w-4 h-4" />
                                </button>
                              )}
                              <button
                                onClick={() => onEditTransaction(tx)}
                                title="Upravit položku"
                                aria-label={`Upravit položku: ${tx.title}`}
                                className="max-md:inline-flex items-center justify-center min-w-11 min-h-11 md:min-w-0 md:min-h-0 p-1 rounded text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                              >
                                <Edit3 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => duplicateTransaction(tx)}
                                title="Duplikovat položku"
                                aria-label={`Duplikovat položku: ${tx.title}`}
                                className="max-md:inline-flex items-center justify-center min-w-11 min-h-11 md:min-w-0 md:min-h-0 p-1 rounded text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                              >
                                <Copy className="w-4 h-4" />
                              </button>
                              {tx.status !== 'cancelled' ? (
                                <button
                                  onClick={() => handleStatusChange(tx.id, 'cancelled')}
                                  disabled={updatingStatusTxId === tx.id}
                                  title="Označit jako zrušenou"
                                  aria-label={`Označit jako zrušenou: ${tx.title}`}
                                  className="max-md:inline-flex items-center justify-center min-w-11 min-h-11 md:min-w-0 md:min-h-0 p-1 rounded text-slate-500 hover:text-amber-600 focus-visible:text-amber-600 hover:bg-amber-50 transition-colors disabled:opacity-50"
                                >
                                  <Ban className="w-4 h-4" />
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleStatusChange(tx.id, 'planned')}
                                  disabled={updatingStatusTxId === tx.id}
                                  title="Vrátit zrušenou položku do plánovaných"
                                  aria-label={`Vrátit zrušenou položku do plánovaných: ${tx.title}`}
                                  className="max-md:inline-flex items-center justify-center min-w-11 min-h-11 md:min-w-0 md:min-h-0 p-1 rounded text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                                >
                                  <RotateCcw className="w-4 h-4" />
                                </button>
                              )}
                              <button
                                onClick={() => setDeletingTx(tx)}
                                disabled={isDeletingTx}
                                title="Smazat položku"
                                aria-label={`Smazat položku: ${tx.title}`}
                                className="max-md:inline-flex items-center justify-center min-w-11 min-h-11 md:min-w-0 md:min-h-0 p-1 rounded text-slate-500 hover:text-red-600 focus-visible:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
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
        correctionItem={selectedCorrection}
        startWithDeleteConfirm={correctionDeleteFirst}
      />
    </div>
);
};
