import React, { useState, useMemo, useEffect } from 'react';
import { useFinance } from '../../context/FinanceContext';
import { MovementType, Transaction, TransactionStatus } from '../../types/finance';
import { formatCurrency } from '../../services/currencyService';
import { formatCzechDate } from '../../services/periodService';
import { 
  Plus, 
  Search, 
  ArrowUpRight, 
  ArrowDownRight, 
  ArrowRightLeft, 
  Check, 
  Copy, 
  Trash2, 
  Ban, 
  Edit3, 
  ArrowUp, 
  ArrowDown, 
  Download,
  Eye, 
  SlidersHorizontal, 
  AlertTriangle 
} from 'lucide-react';
import { sortTransactionsByDateAndSequence } from '../../services/sequenceService';
import { getEffectiveTransactionsForPeriod } from '../../services/financialEngine';
import { czechStringCompare } from '../../services/categoryService';
import { DeleteTransactionModal } from './DeleteTransactionModal';
import { CorrectionDetailModal } from '../accounts/CorrectionDetailModal';

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
    markTransactionExecuted,
    cancelTransaction,
    deleteTransaction,
    exportCSV,
    dataConflicts,
  } = useFinance();

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

  // Vyhledávání a filtry
  const [search, setSearch] = useState('');
  const [periodFilter, setPeriodFilter] = useState<'current' | 'all'>('current');
  const [accountFilter, setAccountFilter] = useState('');
  const [mainCategoryFilter, setMainCategoryFilter] = useState('');
  const [subCategoryFilter, setSubCategoryFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  const handleMainCategoryChange = (newMainId: string) => {
    setMainCategoryFilter(newMainId);
    setSubCategoryFilter('');
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

  // Podkategorie pro vybranou hlavní kategorii, seřazené abecedně A–Z
  const availableSubCategories = useMemo(() => {
    if (!mainCategoryFilter) return [];
    return categories
      .filter(c => {
        if (c.parentId !== mainCategoryFilter) return false;
        if (c.status === 'active') return true;
        return usedCategoryIdsInBase.has(c.id);
      })
      .sort((a, b) => czechStringCompare(a.name, b.name));
  }, [categories, mainCategoryFilter, usedCategoryIdsInBase]);

  // ID všech podkategorií patřících pod aktuálně vybranou hlavní kategorii
  const childSubCategoryIds = useMemo(() => {
    if (!mainCategoryFilter) return new Set<string>();
    return new Set(categories.filter(c => c.parentId === mainCategoryFilter).map(c => c.id));
  }, [categories, mainCategoryFilter]);

  // Bezpečný reset filtrů, pokud se vybraná hodnota stane neplatnou
  useEffect(() => {
    if (accountFilter && !sortedAccounts.some(a => a.id === accountFilter)) {
      setAccountFilter('');
    }
  }, [sortedAccounts, accountFilter]);

  useEffect(() => {
    if (mainCategoryFilter && !availableMainCategories.some(c => c.id === mainCategoryFilter)) {
      setMainCategoryFilter('');
      setSubCategoryFilter('');
    }
  }, [availableMainCategories, mainCategoryFilter]);

  useEffect(() => {
    if (subCategoryFilter && !availableSubCategories.some(c => c.id === subCategoryFilter)) {
      setSubCategoryFilter('');
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
        if (accountFilter) {
          if (tx.sourceAccountId !== accountFilter && tx.targetAccountId !== accountFilter) {
            return false;
          }
        }

        // Filtr hlavní kategorie a podkategorie
        if (mainCategoryFilter) {
          if (subCategoryFilter) {
            const matchesSub = tx.subcategoryId === subCategoryFilter || tx.categoryId === subCategoryFilter;
            if (!matchesSub) return false;
          } else {
            const matchesMain = tx.categoryId === mainCategoryFilter;
            const matchesChildSub = (tx.subcategoryId && childSubCategoryIds.has(tx.subcategoryId)) ||
                                    (tx.categoryId && childSubCategoryIds.has(tx.categoryId));
            if (!matchesMain && !matchesChildSub) return false;
          }
        }

        // Filtr typu
        if (typeFilter && tx.type !== typeFilter) {
          return false;
        }

        // Filtr stavu
        if (statusFilter && tx.status !== statusFilter) {
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

  return (
    <div className="space-y-5 pb-12">
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
            <h2 className="text-lg font-bold text-slate-900">Všechny finanční položky</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Přehled všech příjmů, výdajů a převodů včetně pořadí v rámci dne
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={exportCSV}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl transition-colors"
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
            <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-2" />
          </div>

          {/* 2. Období */}
          <div>
            <select
              value={periodFilter}
              onChange={(e) => setPeriodFilter(e.target.value as 'current' | 'all')}
              className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500/20 text-slate-700"
            >
              <option value="current">Aktuální období</option>
              <option value="all">Všechny položky</option>
            </select>
          </div>

          {/* 3. Účet */}
          <div>
            <select
              value={accountFilter}
              onChange={(e) => setAccountFilter(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500/20"
            >
              <option value="">Všechny účty</option>
              {sortedAccounts.map(a => (
                <option key={a.id} value={a.id}>
                  {a.name}{a.status === 'archived' ? ' (archivovaný)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* 4. Hlavní kategorie */}
          <div>
            <select
              value={mainCategoryFilter}
              onChange={(e) => handleMainCategoryChange(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500/20 text-slate-700"
            >
              <option value="">Všechny kategorie</option>
              {availableMainCategories.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.status === 'archived' ? ' (archivovaná)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* 5. Podkategorie */}
          <div>
            <select
              value={subCategoryFilter}
              disabled={!mainCategoryFilter || availableSubCategories.length === 0}
              onChange={(e) => setSubCategoryFilter(e.target.value)}
              className={`w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500/20 ${
                !mainCategoryFilter || availableSubCategories.length === 0
                  ? 'opacity-50 cursor-not-allowed text-slate-400'
                  : 'text-slate-700'
              }`}
            >
              {!mainCategoryFilter ? (
                <option value="">Nejprve vyberte hlavní kategorii</option>
              ) : availableSubCategories.length === 0 ? (
                <option value="">Žádné podkategorie</option>
              ) : (
                <>
                  <option value="">Všechny podkategorie</option>
                  {availableSubCategories.map(sub => (
                    <option key={sub.id} value={sub.id}>
                      {sub.name}{sub.status === 'archived' ? ' (archivovaná)' : ''}
                    </option>
                  ))}
                </>
              )}
            </select>
          </div>

          {/* 6. Typ */}
          <div>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500/20"
            >
              <option value="">Všechny typy</option>
              {TYPE_OPTIONS.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* 7. Stav */}
          <div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500/20"
            >
              <option value="">Všechny stavy</option>
              {STATUS_OPTIONS.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Tabulka položek */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs whitespace-nowrap">
            <thead>
              <tr className="bg-slate-50/75 border-b border-slate-200 text-slate-500 font-semibold select-none">
                <th 
                  onClick={toggleDateSort}
                  className="py-3 px-4 cursor-pointer hover:text-slate-900 select-none transition-colors"
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
                  className="py-3 px-3 text-center"
                  title="Pořadí v rámci dne"
                >
                  <span>Pořadí</span>
                </th>
                <th className="py-3 px-4">
                  <span>Název položky</span>
                </th>
                <th className="py-3 px-4">Kategorie</th>
                <th className="py-3 px-4">Účet</th>
                <th className="py-3 px-4">Stav</th>
                <th className="py-3 px-4 text-right">
                  <span>Částka</span>
                </th>
                <th className="py-3 px-4 text-right">Akce</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    Nenalezeny žádné transakce odpovídající zadaným filtrům.
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

                  let typeIcon = <ArrowDownRight className="w-3.5 h-3.5 text-red-500" />;
                  if (tx.type === 'income') typeIcon = <ArrowUpRight className="w-3.5 h-3.5 text-emerald-500" />;
                  if (tx.type === 'transfer') typeIcon = <ArrowRightLeft className="w-3.5 h-3.5 text-sky-500" />;
                  if (isCorrection) typeIcon = <SlidersHorizontal className="w-3.5 h-3.5 text-amber-700" />;

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
                      <td className="py-3 px-4 text-slate-500 font-medium">
                        {formatCzechDate(tx.date)}
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span className="inline-block px-2 py-0.5 rounded-md text-[11px] font-bold bg-slate-100 text-slate-700">
                          #{tx.sequence || 1}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-900">
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className={`p-1 rounded-md ${
                            isCorrection ? 'bg-amber-100' : tx.type === 'income' ? 'bg-emerald-50' : tx.type === 'expense' ? 'bg-red-50' : 'bg-sky-50'
                          }`}>
                            {typeIcon}
                          </div>
                          {isCorrection ? (
                            <button
                              type="button"
                              onClick={() => setSelectedCorrection(tx)}
                              className="hover:text-amber-800 hover:underline text-left font-bold text-slate-900"
                            >
                              {tx.title}
                            </button>
                          ) : (
                            <span>{tx.title}</span>
                          )}
                          {tx.recurringRuleId && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 font-normal">
                              Trvalá
                            </span>
                          )}
                          {isCorrection && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 font-semibold">
                              Korekce
                            </span>
                          )}
                          {conflict && (
                            <span 
                              className="text-[10px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 font-semibold flex items-center gap-1 cursor-help"
                              title={conflict.reason}
                            >
                              <AlertTriangle className="w-3 h-3 text-rose-600" />
                              Před aktivací
                            </span>
                          )}
                        </div>
                        {tx.note && <span className="text-[10px] text-slate-400 block font-normal mt-0.5">{tx.note}</span>}
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
                        {isExecuted ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <Check className="w-3 h-3" /> Uskutečněná
                          </span>
                        ) : isCancelled ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600">
                            Zrušená
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                            Plánovaná
                          </span>
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
                              {!isExecuted && !isCancelled && (
                                <button
                                  onClick={() => markTransactionExecuted(tx.id)}
                                  title="Označit jako uskutečněnou"
                                  className="p-1 rounded text-emerald-600 hover:bg-emerald-50"
                                >
                                  <Check className="w-4 h-4" />
                                </button>
                              )}
                              <button
                                onClick={() => onEditTransaction(tx)}
                                title="Upravit"
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
                              {!isCancelled && (
                                <button
                                  onClick={() => cancelTransaction(tx.id)}
                                  title="Zrušit"
                                  className="p-1 rounded text-amber-600 hover:bg-amber-50"
                                >
                                  <Ban className="w-4 h-4" />
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
