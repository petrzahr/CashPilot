import React, { useState, useMemo, useEffect } from 'react';
import { useFinance } from '../../context/FinanceContext';
import { MovementType, Transaction, TransactionStatus } from '../../types/finance';
import { addHaler, formatCurrency, subHaler } from '../../services/currencyService';
import { formatCzechDate, getTodayInPrague } from '../../services/periodService';
import { StatusBadgeMenu } from '../shared/StatusBadgeMenu';
import {
  Plus,
  Search,
  Copy,
  Trash2,
  Edit3,
  ArrowUp,
  ArrowDown,
  Download,
  Eye,
  SlidersHorizontal,
  AlertTriangle,
  Repeat,
  X
} from 'lucide-react';
import { } from '../../services/sequenceService';
import { getEffectiveTransactionsForPeriod } from '../../services/financialEngine';
import { czechStringCompare } from '../../services/categoryService';
import { getEffectiveAmountInHaler } from '../../services/accountScope';
import { DeleteTransactionModal } from './DeleteTransactionModal';
import { CorrectionDetailModal } from '../accounts/CorrectionDetailModal';
import { MultiSelectDropdown } from '../shared/MultiSelectDropdown';
import { MobileFiltersToggle } from '../shared/MobileFiltersToggle';

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

interface TransactionsScreenProps {
  onOpenTransactionModal: (initialDate?: string, initialType?: MovementType) => void;
  onEditTransaction: (tx: Transaction) => void;
  onDuplicateTransaction: (tx: Transaction) => void;
}

export const TransactionsScreen: React.FC<TransactionsScreenProps> = ({
  onOpenTransactionModal,
  onEditTransaction,
  onDuplicateTransaction,
}) => {
  const {
    transactions,
    recurringRules,
    recurringExceptions,
    settings,
    accounts,
    categories,
    selectedPeriod,
    setTransactionStatus,
    deleteTransaction,
    deleteCorrection,
    exportCSV,
    dataConflicts,
    showToast,
  } = useFinance();

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

  // Stav probíhající změny stavu položky (Akce sloupec)
  const [updatingStatusTxId, setUpdatingStatusTxId] = useState<string | null>(null);

  // Dnešní datum v pražském čase: minulé položky se nedají vrátit do plánu (uskuteční se samy)
  const todayIso = getTodayInPrague();

  const handleStatusChange = async (txId: string, newStatus: TransactionStatus) => {
    if (updatingStatusTxId) return;
    setUpdatingStatusTxId(txId);
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

  // Vyhledávání a filtry (multi-select - prázdný výběr = bez omezení)
  const [search, setSearch] = useState('');
  const [periodFilter, setPeriodFilter] = useState<'current' | 'all'>('current');
  const [accountFilter, setAccountFilter] = useState<string[]>([]);
  const [mainCategoryFilter, setMainCategoryFilter] = useState<string[]>([]);
  const [subCategoryFilter, setSubCategoryFilter] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);

  const handleMainCategoryChange = (newMainIds: string[]) => {
    setMainCategoryFilter(newMainIds);
    setSubCategoryFilter([]);
  };

  // Řazení - výchozí vzestupně (datum od nejstaršího po nejnovější, v rámci dne pořadí 1, 2, 3...)
  const [dateSortOrder, setDateSortOrder] = useState<'asc' | 'desc'>('asc');

  const toggleDateSort = () => {
    setDateSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'));
  };

  // Základní sada položek podle zvoleného režimu období
  const baseTransactions = useMemo(() => {
    if (periodFilter === 'current') {
      return getEffectiveTransactionsForPeriod(
        selectedPeriod,
        transactions,
        recurringRules,
        recurringExceptions,
        settings.budgetStartDay,
        undefined,
        accounts
      );
    }
    return transactions;
  }, [
    periodFilter,
    selectedPeriod,
    transactions,
    recurringRules,
    recurringExceptions,
    settings.budgetStartDay,
    accounts
  ]);

  // Množina ID kategorií použitých v aktuální sadě položek
  const usedCategoryIdsInBase = useMemo(() => {
    const ids = new Set<string>();
    for (const tx of baseTransactions) {
      if (tx.categoryId) ids.add(tx.categoryId);
      if (tx.subcategoryId) ids.add(tx.subcategoryId);
    }
    return ids;
  }, [baseTransactions]);

  // Seznam účtů seřazený abecedně A–Z (včetně případných archivovaných, které mají záznam v datech)
  const sortedAccounts = useMemo(() => {
    return [...accounts]
      .filter(a => a.status === 'active' || baseTransactions.some(t => t.sourceAccountId === a.id || t.targetAccountId === a.id))
      .sort((a, b) => czechStringCompare(a.name, b.name));
  }, [accounts, baseTransactions]);

  // Hlavní kategorie: všechny hlavní kategorie (příjmové i výdajové dohromady), seřazené abecedně A–Z
  // Archivované kategorie se zahrnou, pokud se nacházejí ve výsledných datech
  const availableMainCategories = useMemo(() => {
    return categories
      .filter(c => {
        if (c.parentId) return false;
        if (c.status === 'active') return true;
        if (usedCategoryIdsInBase.has(c.id)) return true;
        return categories.some(sub => sub.parentId === c.id && usedCategoryIdsInBase.has(sub.id));
      })
      .sort((a, b) => czechStringCompare(a.name, b.name));
  }, [categories, usedCategoryIdsInBase]);

  // Podkategorie pro vybrané hlavní kategorie, seřazené abecedně A–Z
  const availableSubCategories = useMemo(() => {
    if (mainCategoryFilter.length === 0) return [];
    return categories
      .filter(c => {
        if (!c.parentId || !mainCategoryFilter.includes(c.parentId)) return false;
        if (c.status === 'active') return true;
        return usedCategoryIdsInBase.has(c.id);
      })
      .sort((a, b) => czechStringCompare(a.name, b.name));
  }, [categories, mainCategoryFilter, usedCategoryIdsInBase]);

  // ID všech podkategorií patřících pod aktuálně vybrané hlavní kategorie
  const childSubCategoryIds = useMemo(() => {
    if (mainCategoryFilter.length === 0) return new Set<string>();
    return new Set(categories.filter(c => c.parentId && mainCategoryFilter.includes(c.parentId)).map(c => c.id));
  }, [categories, mainCategoryFilter]);

  // Bezpečný reset filtrů, pokud se vybraná hodnota stane neplatnou
  useEffect(() => {
    const valid = accountFilter.filter(id => sortedAccounts.some(a => a.id === id));
    if (valid.length !== accountFilter.length) {
      setAccountFilter(valid);
    }
  }, [sortedAccounts, accountFilter]);

  useEffect(() => {
    const valid = mainCategoryFilter.filter(id => availableMainCategories.some(c => c.id === id));
    if (valid.length !== mainCategoryFilter.length) {
      setMainCategoryFilter(valid);
      setSubCategoryFilter([]);
    }
  }, [availableMainCategories, mainCategoryFilter]);

  useEffect(() => {
    const valid = subCategoryFilter.filter(id => availableSubCategories.some(c => c.id === id));
    if (valid.length !== subCategoryFilter.length) {
      setSubCategoryFilter(valid);
    }
  }, [availableSubCategories, subCategoryFilter]);

  // Filtrované a seřazené položky
  const filteredTransactions = useMemo(() => {
    return baseTransactions
      .filter((tx) => {
        // Filtr období
        if (periodFilter === 'current') {
          if (tx.date < selectedPeriod.startDate || tx.date > selectedPeriod.endDate) {
            return false;
          }
        }

        // Filtr účtu
        if (accountFilter.length > 0) {
          const matchesAccount = accountFilter.includes(tx.sourceAccountId) ||
                                  (!!tx.targetAccountId && accountFilter.includes(tx.targetAccountId));
          if (!matchesAccount) return false;
        }

        // Filtr hlavní kategorie a podkategorie
        if (mainCategoryFilter.length > 0) {
          if (subCategoryFilter.length > 0) {
            const matchesSub = (!!tx.subcategoryId && subCategoryFilter.includes(tx.subcategoryId)) ||
                                (!!tx.categoryId && subCategoryFilter.includes(tx.categoryId));
            if (!matchesSub) return false;
          } else {
            const matchesMain = !!tx.categoryId && mainCategoryFilter.includes(tx.categoryId);
            const matchesChildSub = (tx.subcategoryId && childSubCategoryIds.has(tx.subcategoryId)) ||
                                    (tx.categoryId && childSubCategoryIds.has(tx.categoryId));
            if (!matchesMain && !matchesChildSub) return false;
          }
        }

        // Filtr typu
        if (typeFilter.length > 0 && !typeFilter.includes(tx.type)) {
          return false;
        }

        // Filtr stavu
        if (statusFilter.length > 0 && !statusFilter.includes(tx.status)) {
          return false;
        }

        // Textové vyhledávání
        if (search.trim()) {
          const s = search.toLowerCase();
          const matchTitle = tx.title.toLowerCase().includes(s);
          const matchNote = tx.note?.toLowerCase().includes(s);
          if (!matchTitle && !matchNote) return false;
        }

        return true;
      })
      .sort((a, b) => {
        const cmp = a.date.localeCompare(b.date);
        if (cmp !== 0) {
          return dateSortOrder === 'asc' ? cmp : -cmp;
        }
        // V rámci stejného dne řadíme podle sequence
        const seqA = a.sequence !== undefined ? a.sequence : 1;
        const seqB = b.sequence !== undefined ? b.sequence : 1;
        return dateSortOrder === 'asc' ? seqA - seqB : seqB - seqA;
      });
  }, [
    baseTransactions,
    search,
    periodFilter,
    accountFilter,
    mainCategoryFilter,
    subCategoryFilter,
    childSubCategoryIds,
    typeFilter,
    statusFilter,
    dateSortOrder,
    selectedPeriod
  ]);

  // Počet aktivních filtrů pro tlačítko „Zrušit filtry“ (volba období je samostatný přepínač)
  const activeFilterCount = [
    search.trim(), accountFilter, mainCategoryFilter, subCategoryFilter, typeFilter, statusFilter,
  ].filter(f => f.length > 0).length;
  // Na mobilu jsou filtry kromě hledání schované; počet zahrnuje i volbu „Všechna období“
  const [filtersOpen, setFiltersOpen] = useState(false);
  const hiddenFilterCount = activeFilterCount - (search.trim() ? 1 : 0) + (periodFilter === 'all' ? 1 : 0);
  const clearFilters = () => {
    setSearch('');
    setAccountFilter([]);
    setMainCategoryFilter([]);
    setSubCategoryFilter([]);
    setTypeFilter([]);
    setStatusFilter([]);
  };

  // Prázdný seznam: odliší chybějící položky od filtrů, které nic nenašly
  const emptyListMessage = baseTransactions.length === 0
    ? (periodFilter === 'current'
      ? 'V tomto období zatím nejsou žádné položky. Zobrazte všechny položky, nebo přidejte novou.'
      : 'Zatím nemáte žádné položky. Přidejte první tlačítkem Nová položka.')
    : 'Filtrům neodpovídá žádná položka. Upravte filtry, nebo je zrušte tlačítkem Zrušit filtry.';

  // Suma vyfiltrovaných položek (příjem +, výdaj −, převod a korekce dle znaménka jako ve výpisu)
  const filteredTransactionsSum = useMemo(() => {
    return filteredTransactions.reduce((sum, tx) => {
      const effectiveAmount = getEffectiveAmountInHaler(tx);
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
  }, [filteredTransactions]);

  // Části řádku sdílí tabulka (od md) i řádky-karty na mobilu, aby se obě podoby nerozešly
  const getRowParts = (tx: Transaction, rowIndex: number) => {
    const sourceAcc = accounts.find(a => a.id === tx.sourceAccountId);
    const targetAcc = tx.targetAccountId ? accounts.find(a => a.id === tx.targetAccountId) : null;
    const cat = categories.find(c => c.id === tx.categoryId);
    const subCat = categories.find(c => c.id === tx.subcategoryId);

    const effectiveAmount = getEffectiveAmountInHaler(tx);
    const isCancelled = tx.status === 'cancelled';
    const isCorrection = tx.type === 'balance_adjustment';

    const diff = tx.diffInHaler ?? (
      tx.actualBalanceInHaler !== undefined && tx.calculatedBalanceInHaler !== undefined
        ? tx.actualBalanceInHaler - tx.calculatedBalanceInHaler
        : tx.amountInHaler
    );

    const conflict = dataConflicts?.find(c => c.transaction.id === tx.id);

    const rowTone = isCancelled
      ? 'line-through decoration-slate-400 bg-slate-50 text-slate-500'
      : isCorrection ? 'bg-slate-50' : conflict ? 'bg-red-50/30' : '';

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
          // Název položky je vždy odkaz na její úpravu, stejně jako v Rozpočtu
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
        {conflict && (
          <span
            className="chip bg-red-100 text-red-700 cursor-help shrink-0"
            title={conflict.reason}
          >
            <AlertTriangle className="w-3 h-3 text-red-600 shrink-0" />
            Před aktivací
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
      <span className="text-sky-600 font-medium">Převod</span>
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
      <span className="text-sky-600 font-medium">Převod</span>
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

    // Stejný štítek stavu jako v rozpočtu; korekce má vlastní štítek
    const status = isCorrection ? (
      <span className="chip bg-slate-100 text-slate-600">
        Korekce
      </span>
    ) : (
      <StatusBadgeMenu
        tx={tx}
        todayIso={todayIso}
        isUpdating={updatingStatusTxId === tx.id}
        onChange={(status) => handleStatusChange(tx.id, status)}
        openUp={rowIndex >= filteredTransactions.length - 3 && filteredTransactions.length > 3}
      />
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
    );

    return { rowTone, title, note, category, categoryInline, account, accountInline, status, amountClass, amount, actions };
  };

  return (
    <div className="space-y-6">
      {dataConflicts && dataConflicts.length > 0 && (
        <div className="panel panel-warning flex flex-col gap-2">
          <div className="flex items-center gap-2 text-amber-900 font-semibold text-sm">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
            <span>Položky s datem před založením účtu ({dataConflicts.length})</span>
          </div>
          <p className="text-xs text-amber-800">
            Tyto položky jsou dřív, než začíná počáteční zůstatek jejich účtu, a do zůstatků se nepočítají. Posuňte datum položky, nebo u účtu dřívější datum počátečního zůstatku.
          </p>
          <ul className="text-xs text-amber-900 list-disc list-inside space-y-1 mt-1">
            {dataConflicts.slice(0, 5).map((c, i) => (
              <li key={i}>
                <strong>{c.transaction.title}</strong>: {c.reason}
              </li>
            ))}
            {dataConflicts.length > 5 && (
              <li>…a další ({dataConflicts.length - 5})</li>
            )}
          </ul>
        </div>
      )}

      {/* Horní akční lišta */}
      <div className="card p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-bold text-slate-900">Položky</h2>
              <span className="chip bg-slate-100 text-slate-600">
                {filteredTransactions.length}
              </span>
              <span className="text-xs font-semibold text-slate-500">Součet</span>
              <span className={`text-xs font-bold tabular-nums ${
                filteredTransactionsSum > 0 ? 'text-emerald-600' : filteredTransactionsSum < 0 ? 'text-red-600' : 'text-slate-900'
              }`}>
                {formatCurrency(filteredTransactionsSum, { showPlus: true })}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={exportCSV}
              className="max-md:min-h-11 flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-500 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Stáhnout CSV</span>
            </button>
            <button
              onClick={() => onOpenTransactionModal()}
              className="btn-primary"
            >
              <Plus className="w-4 h-4" />
              <span>Nová položka</span>
            </button>
          </div>
        </div>

        {/* Společný panel filtrů */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2.5 pt-3 border-t border-slate-100 text-xs">
          {/* 1. Vyhledávání */}
          <div className="relative sm:col-span-2 lg:col-span-2">
            <input
              type="text"
              placeholder="Hledat v názvu…"
              aria-label="Vyhledat v názvu položky"
              aria-keyshortcuts="/"
              data-search-input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setSearch(''); e.currentTarget.blur(); }
              }}
              className="max-md:min-h-11 w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
            />
            <Search className="w-4 h-4 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
          </div>

          <MobileFiltersToggle
            isOpen={filtersOpen}
            onToggle={() => setFiltersOpen(prev => !prev)}
            activeCount={hiddenFilterCount}
            controlsId="transactions-filters"
          />

          <div id="transactions-filters" className={`contents ${filtersOpen ? '' : 'max-md:hidden'}`}>
          {/* 2. Období */}
          <div>
            <select
              aria-label="Období"
              value={periodFilter}
              onChange={(e) => setPeriodFilter(e.target.value as 'current' | 'all')}
              className="max-md:min-h-11 w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 text-slate-500"
            >
              <option value="current">Vybrané období</option>
              <option value="all">Všechna období</option>
            </select>
          </div>

          {/* 3. Účet */}
          <div>
            <MultiSelectDropdown
              label="Účet" placeholder="Všechny účty"
              selected={accountFilter}
              onChange={setAccountFilter}
              options={sortedAccounts.map(a => ({
                value: a.id,
                label: `${a.name}${a.status === 'archived' ? ' (archivovaný)' : ''}`,
              }))}
            />
          </div>

          {/* 4. Hlavní kategorie */}
          <div>
            <MultiSelectDropdown
              label="Kategorie" placeholder="Všechny kategorie"
              selected={mainCategoryFilter}
              onChange={handleMainCategoryChange}
              options={availableMainCategories.map(c => ({
                value: c.id,
                label: `${c.name}${c.status === 'archived' ? ' (archivovaná)' : ''}`,
              }))}
            />
          </div>

          {/* 5. Podkategorie */}
          <div>
            <MultiSelectDropdown
              label="Podkategorie" placeholder="Všechny podkategorie"
              disabled={mainCategoryFilter.length === 0 || availableSubCategories.length === 0}
              disabledPlaceholder={mainCategoryFilter.length === 0 ? 'Nejprve vyberte hlavní kategorii' : 'Žádné podkategorie'}
              selected={subCategoryFilter}
              onChange={setSubCategoryFilter}
              options={availableSubCategories.map(sub => ({
                value: sub.id,
                label: `${sub.name}${sub.status === 'archived' ? ' (archivovaná)' : ''}`,
              }))}
            />
          </div>

          {/* 6. Typ */}
          <div>
            <MultiSelectDropdown
              label="Typ" placeholder="Všechny typy"
              selected={typeFilter}
              onChange={setTypeFilter}
              options={TYPE_OPTIONS.map(t => ({ value: t.value, label: t.label }))}
            />
          </div>

          {/* 7. Stav */}
          <div>
            <MultiSelectDropdown
              label="Stav" placeholder="Všechny stavy"
              selected={statusFilter}
              onChange={setStatusFilter}
              options={STATUS_OPTIONS.map(s => ({ value: s.value, label: s.label }))}
            />
          </div>
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

      {/* Seznam položek: do 1024px řádky-karty, od lg tabulka (bez posouvání od 1280px) */}
      <div className="card overflow-hidden">
        <ul className="lg:hidden divide-y divide-slate-100 text-xs">
          {filteredTransactions.length === 0 ? (
            <li className="py-8 px-4 text-center text-slate-500">{emptyListMessage}</li>
          ) : (
            filteredTransactions.map((tx, rowIndex) => {
              const p = getRowParts(tx, rowIndex);
              return (
                <li key={tx.id} className={`p-3 space-y-1.5 ${p.rowTone}`}>
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
          <table className="w-full min-w-[960px] text-left text-xs whitespace-nowrap table-fixed">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold select-none">
                <th
                  aria-sort={dateSortOrder === 'asc' ? 'ascending' : 'descending'}
                  className="w-[100px] p-0"
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
                <th
                  className="w-[64px] py-2.5 px-3 text-center"
                  title="Pořadí v rámci dne"
                >
                  <span>Pořadí</span>
                </th>
                <th className="min-w-[160px] py-2.5 px-4">
                  <span>Název položky</span>
                </th>
                <th className="w-[140px] py-2.5 px-4">Kategorie</th>
                <th className="w-[130px] py-2.5 px-4">Účet</th>
                <th className="w-[124px] py-2.5 px-4">Stav</th>
                <th className="w-[116px] py-2.5 px-4 text-right">
                  <span>Částka</span>
                </th>
                <th className="w-[120px] py-2.5 px-4 text-right">Akce</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="empty-state">
                    {emptyListMessage}
                  </td>
                </tr>
              ) : (
                filteredTransactions.map((tx, rowIndex) => {
                  const p = getRowParts(tx, rowIndex);
                  return (
                    <tr key={tx.id} className={`hover:bg-slate-50 transition-colors ${p.rowTone}`}>
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

      {/* Detail korekce pro zobrazení a editaci poznámky */}
      <CorrectionDetailModal
        isOpen={Boolean(selectedCorrection)}
        onClose={() => setSelectedCorrection(null)}
        correctionItem={selectedCorrection}      />
    </div>
  );
};
