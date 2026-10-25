import React, { useState, useMemo } from 'react';
import { useFinance } from '../../context/FinanceContext';
import { MovementType, Transaction } from '../../types/finance';
import { formatCurrency } from '../../services/currencyService';
import { formatCzechDate, getTodayInPrague } from '../../services/periodService';
import {
  Plus,
  Search,
  ArrowUp,
  ArrowDown,
  Download,
  AlertTriangle,
  X
} from 'lucide-react';
import { sortTransactionsByDateAndSequence } from '../../services/sequenceService';
import { getEffectiveTransactionsForPeriod } from '../../services/financialEngine';
import { useItemFilters } from '../../hooks/useItemFilters';
import { useItemActions } from '../../hooks/useItemActions';
import { STATUS_OPTIONS, TYPE_OPTIONS, sumItemsInHaler } from '../../services/itemFilter';
import { buildItemRow } from '../../services/itemRow';
import { DeleteTransactionModal } from './DeleteTransactionModal';
import { CorrectionDetailModal } from '../accounts/CorrectionDetailModal';
import { MultiSelectDropdown } from '../shared/MultiSelectDropdown';
import { MobileFiltersToggle } from '../shared/MobileFiltersToggle';
import { buildItemRowParts } from '../shared/ItemRowParts';

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

  // Smazání, změna stavu a detail korekce (sdílené s Měsíčním rozpočtem)
  const itemActions = useItemActions({ transactions, deleteTransaction, deleteCorrection, setTransactionStatus, showToast });

  // Dnešní datum v pražském čase: minulé položky se nedají vrátit do plánu (uskuteční se samy)
  const todayIso = getTodayInPrague();

  // Volba období: aktuální období, nebo všechny položky
  const [periodFilter, setPeriodFilter] = useState<'current' | 'all'>('current');

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

  // Vyhledávání a filtry (sdílené s Měsíčním rozpočtem, viz useItemFilters)
  const itemFilters = useItemFilters(baseTransactions, accounts, categories);
  const {
    search,
    accounts: accountFilter,
    mainCategories: mainCategoryFilter,
    subCategories: subCategoryFilter,
    types: typeFilter,
    statuses: statusFilter,
  } = itemFilters.filters;
  const {
    setSearch,
    setAccounts: setAccountFilter,
    setMainCategories: handleMainCategoryChange,
    setSubCategories: setSubCategoryFilter,
    setTypes: setTypeFilter,
    setStatuses: setStatusFilter,
    clear: clearFilters,
    activeCount: activeFilterCount,
  } = itemFilters;
  const { accounts: sortedAccounts, mainCategories: availableMainCategories, subCategories: availableSubCategories } = itemFilters.options;

  // Filtrované a seřazené položky (v aktuálním období jen s datem v jeho rozsahu)
  const filteredTransactions = useMemo(() => sortTransactionsByDateAndSequence(
    itemFilters.filtered
      .filter(tx => periodFilter !== 'current' || (tx.date >= selectedPeriod.startDate && tx.date <= selectedPeriod.endDate)),
    dateSortOrder
  ), [itemFilters.filtered, periodFilter, selectedPeriod, dateSortOrder]);

  // Na mobilu jsou filtry kromě hledání schované; počet zahrnuje i volbu „Všechna období“
  const [filtersOpen, setFiltersOpen] = useState(false);
  const hiddenFilterCount = activeFilterCount - (search.trim() ? 1 : 0) + (periodFilter === 'all' ? 1 : 0);

  // Prázdný seznam: odliší chybějící položky od filtrů, které nic nenašly
  const emptyListMessage = baseTransactions.length === 0
    ? (periodFilter === 'current'
      ? 'V tomto období zatím nejsou žádné položky. Zobrazte všechny položky, nebo přidejte novou.'
      : 'Zatím nemáte žádné položky. Přidejte první tlačítkem Nová položka.')
    : 'Filtrům neodpovídá žádná položka. Upravte filtry, nebo je zrušte tlačítkem Zrušit filtry.';

  // Suma vyfiltrovaných položek (příjem +, výdaj −, převod a korekce dle znaménka jako ve výpisu)
  const filteredTransactionsSum = useMemo(() => sumItemsInHaler(filteredTransactions), [filteredTransactions]);

  // Části řádku sdílí tabulka (od md) i řádky-karty na mobilu, aby se obě podoby nerozešly
  const getRowParts = (tx: Transaction, rowIndex: number) => buildItemRowParts(
    tx,
    buildItemRow(tx, { accounts, categories, conflicts: dataConflicts }),
    {
      actions: itemActions,
      todayIso,
      openStatusUp: rowIndex >= filteredTransactions.length - 3 && filteredTransactions.length > 3,
      onEdit: onEditTransaction,
      onDuplicate: onDuplicateTransaction,
    }
  );

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
        isOpen={Boolean(itemActions.deletingTx)}
        onClose={itemActions.closeDelete}
        transaction={itemActions.deletingTx}
        isDeleting={itemActions.isDeletingTx}
        hasExecutedHistorical={itemActions.deletingTxHasExecutedHistorical}
        onConfirm={itemActions.confirmDelete}
      />

      {/* Detail korekce pro zobrazení a editaci poznámky */}
      <CorrectionDetailModal
        isOpen={Boolean(itemActions.selectedCorrection)}
        onClose={itemActions.closeCorrection}
        correctionItem={itemActions.selectedCorrection}      />
    </div>
  );
};
