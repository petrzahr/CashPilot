import React, { useState, useMemo, useEffect } from 'react';
import { useFinance } from '../../context/FinanceContext';
import { MovementType, Transaction, TransactionStatus } from '../../types/finance';
import { addHaler, formatCurrency, subHaler } from '../../services/currencyService';
import { formatCzechDate } from '../../services/periodService';
import {
  Plus,
  Search,
  Check,
  Clock,
  Copy,
  Trash2,
  Ban,
  Edit3,
  ArrowUp,
  ArrowDown,
  Download,
  Eye,
  SlidersHorizontal,
  AlertTriangle,
  Repeat
} from 'lucide-react';
import { sortTransactionsByDateAndSequence } from '../../services/sequenceService';
import { getEffectiveTransactionsForPeriod } from '../../services/financialEngine';
import { czechStringCompare } from '../../services/categoryService';
import { DeleteTransactionModal } from './DeleteTransactionModal';
import { CorrectionDetailModal } from '../accounts/CorrectionDetailModal';
import { MultiSelectDropdown } from '../shared/MultiSelectDropdown';

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
}

export const TransactionsScreen: React.FC<TransactionsScreenProps> = ({
  onOpenTransactionModal,
  onEditTransaction,
}) => {
  const {
    transactions,
    recurringRules,
    recurringExceptions,
    settings,
    accounts,
    categories,
    selectedPeriod,
    duplicateTransaction,
    setTransactionStatus,
    deleteTransaction,
    exportCSV,
    dataConflicts,
    showToast,
  } = useFinance();

  // Stav mazání položky
  const [deletingTx, setDeletingTx] = useState<Transaction | null>(null);
  const [isDeletingTx, setIsDeletingTx] = useState(false);

  // Stav vybrané korekce pro detail modal
  const [selectedCorrection, setSelectedCorrection] = useState<Transaction | null>(null);

  // Stav probíhající změny stavu položky (Akce sloupec)
  const [updatingStatusTxId, setUpdatingStatusTxId] = useState<string | null>(null);

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

  // Suma vyfiltrovaných položek (příjem +, výdaj −, převod a korekce dle znaménka jako ve výpisu)
  const filteredTransactionsSum = useMemo(() => {
    return filteredTransactions.reduce((sum, tx) => {
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
  }, [filteredTransactions]);

  return (
    <div className="space-y-6 pb-12">
      {dataConflicts && dataConflicts.length > 0 && (
        <div className="p-4 bg-amber-50 border border-amber-300 rounded-2xl flex flex-col gap-2">
          <div className="flex items-center gap-2 text-amber-900 font-semibold text-sm">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
            <span>Nalezeny položky před datem aktivace účtu ({dataConflicts.length})</span>
          </div>
          <p className="text-xs text-amber-800">
            Následující položky mají datum dřívější než datum počátečního stavu příslušného účtu a nejsou započítány do zůstatků. Upravte prosím datum položky nebo datum počátečního stavu účtu.
          </p>
          <ul className="text-xs text-amber-900 list-disc list-inside space-y-1 mt-1">
            {dataConflicts.slice(0, 5).map((c, i) => (
              <li key={i}>
                <strong>{c.transaction.title}</strong>: {c.reason}
              </li>
            ))}
            {dataConflicts.length > 5 && (
              <li>...a dalších {dataConflicts.length - 5} položek</li>
            )}
          </ul>
        </div>
      )}

      {/* Horní akční lišta */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-bold text-slate-900">Položky</h3>
              <span className="px-2 py-0.5 text-xs font-semibold bg-slate-100 text-slate-500 rounded-md">
                {filteredTransactions.length}
              </span>
              <h3 className="text-sm font-bold text-slate-900">Suma položek</h3>
              <span className="px-2 py-0.5 text-xs font-semibold bg-slate-100 text-slate-500 rounded-md">
                {formatCurrency(filteredTransactionsSum, { showPlus: true })}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={exportCSV}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-500 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Exportovat CSV</span>
            </button>
            <button
              onClick={() => onOpenTransactionModal()}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-xl shadow-sm shadow-sky-200 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Přidat položku</span>
            </button>
          </div>
        </div>

        {/* Společný panel filtrů */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2.5 pt-3 border-t border-slate-100 text-xs">
          {/* 1. Vyhledávání */}
          <div className="relative sm:col-span-2 lg:col-span-2">
            <input
              type="text"
              placeholder="Vyhledat v názvu..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
            />
            <Search className="w-4 h-4 text-slate-500 absolute left-2.5 top-2" />
          </div>

          {/* 2. Období */}
          <div>
            <select
              value={periodFilter}
              onChange={(e) => setPeriodFilter(e.target.value as 'current' | 'all')}
              className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500/20 text-slate-500"
            >
              <option value="current">Aktuální období</option>
              <option value="all">Všechny položky</option>
            </select>
          </div>

          {/* 3. Účet */}
          <div>
            <MultiSelectDropdown
              placeholder="Všechny účty"
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
              placeholder="Všechny kategorie"
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
              placeholder="Všechny podkategorie"
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
              placeholder="Všechny typy"
              selected={typeFilter}
              onChange={setTypeFilter}
              options={TYPE_OPTIONS.map(t => ({ value: t.value, label: t.label }))}
            />
          </div>

          {/* 7. Stav */}
          <div>
            <MultiSelectDropdown
              placeholder="Všechny stavy"
              selected={statusFilter}
              onChange={setStatusFilter}
              options={STATUS_OPTIONS.map(s => ({ value: s.value, label: s.label }))}
            />
          </div>
        </div>
      </div>

      {/* Tabulka položek */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs whitespace-nowrap table-fixed">
            <thead>
              <tr className="bg-slate-50/75 border-b border-slate-200 text-slate-500 font-semibold select-none">
                <th
                  onClick={toggleDateSort}
                  className="w-[110px] py-2.5 px-4 cursor-pointer hover:text-slate-900 select-none transition-colors"
                  title={`Řazení podle data a pořadí (${dateSortOrder === 'asc' ? 'Vzestupně: od nejstarších, v rámci dne 1, 2, 3…' : 'Sestupně: od nejnovějších, v rámci dne …3, 2, 1'})`}
                >
                  <div className="flex items-center gap-1.5">
                    <span>Datum</span>
                    {dateSortOrder === 'asc' ? (
                      <ArrowUp className="w-3.5 h-3.5 text-sky-600" />
                    ) : (
                      <ArrowDown className="w-3.5 h-3.5 text-sky-600" />
                    )}
                  </div>
                </th>
                <th
                  className="w-[70px] py-2.5 px-3 text-center"
                  title="Pořadí v rámci dne"
                >
                  <span>Pořadí</span>
                </th>
                <th className="min-w-[160px] py-2.5 px-4">
                  <span>Název položky</span>
                </th>
                <th className="w-[160px] py-2.5 px-4">Kategorie</th>
                <th className="w-[150px] py-2.5 px-4">Účet</th>
                <th className="w-[140px] py-2.5 px-4">Stav</th>
                <th className="w-[120px] py-2.5 px-4 text-right">
                  <span>Částka</span>
                </th>
                <th className="w-[170px] py-2.5 px-4 text-right">Akce</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500">
                    Pro zadané filtry nebyly nalezeny žádné položky.
                  </td>
                </tr>
              ) : (
                filteredTransactions.map((tx) => {
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

                  const conflict = dataConflicts?.find(c => c.transaction.id === tx.id);

                  return (
                    <tr
                      key={tx.id}
                      className={`hover:bg-slate-50/80 transition-colors ${
                        isCancelled ? 'opacity-50 line-through' : isCorrection ? 'bg-amber-50/30' : conflict ? 'bg-rose-50/30' : ''
                      }`}
                    >
                      <td className="py-3 px-4 text-slate-500 overflow-hidden">
                        {formatCzechDate(tx.date)}
                      </td>
                      <td className="py-3 px-3 text-center overflow-hidden">
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-500">
                          #{tx.sequence || 1}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-900 overflow-hidden">
                        <div className="flex items-center gap-1.5 flex-nowrap min-w-0">
                          {isCorrection ? (
                            <button
                              type="button"
                              onClick={() => setSelectedCorrection(tx)}
                              className="hover:text-amber-800 hover:underline text-left font-bold text-slate-900 flex items-center gap-1.5 min-w-0"
                            >
                              <SlidersHorizontal className="w-3.5 h-3.5 text-amber-700 shrink-0" />
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
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 font-semibold shrink-0">
                              Korekce
                            </span>
                          )}
                          {conflict && (
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 font-semibold flex items-center gap-1 cursor-help shrink-0"
                              title={conflict.reason}
                            >
                              <AlertTriangle className="w-3 h-3 text-rose-600 shrink-0" />
                              Před aktivací
                            </span>
                          )}
                        </div>
                        {tx.note && <span className="text-[10px] text-slate-500 block font-normal truncate">{tx.note}</span>}
                      </td>
                      <td className="py-3 px-4 text-slate-500 overflow-hidden">
                        {isCorrection ? (
                          <span className="text-amber-800 font-medium text-[11px] bg-amber-50 px-2 py-0.5 rounded border border-amber-200/60">
                            Korekce zůstatku
                          </span>
                        ) : cat ? (
                          <div className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                            <span className="truncate">{cat.name}</span>
                            {subCat && <span className="text-slate-500 truncate">› {subCat.name}</span>}
                          </div>
                        ) : tx.type === 'transfer' ? (
                          <span className="text-sky-600 font-medium">Převod</span>
                        ) : (
                          <span className="text-slate-500 italic text-xs">Bez kategorie</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-500 overflow-hidden">
                        {sourceAcc ? (
                          <span className="flex items-center gap-1">
                            <span className="truncate">{sourceAcc.name}</span>
                            {targetAcc && <span className="text-sky-600 shrink-0">→ {targetAcc.name}</span>}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="py-3 px-4 overflow-hidden">
                        {isExecuted ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <Check className="w-3 h-3" /> Uskutečněná
                          </span>
                        ) : isCancelled ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-500 border border-slate-200">
                            <Ban className="w-3 h-3" /> Zrušená
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                            <Clock className="w-3 h-3" /> Plánovaná
                          </span>
                        )}
                      </td>
                      <td className={`py-3 px-4 text-right font-bold overflow-hidden ${
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
                      <td className="py-3 px-4 text-right overflow-hidden">
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
                              {!isExecuted ? (
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
                              {!isCancelled ? (
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
        correctionItem={selectedCorrection}
      />
    </div>
  );
};
