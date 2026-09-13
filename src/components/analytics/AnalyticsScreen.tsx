import React, { useState, useMemo } from 'react';
import { useFinance } from '../../context/FinanceContext';
import { Transaction } from '../../types/finance';
import {
  AnalyticsPeriodPreset,
  AnalyticsFilters,
  resolveAnalyticsDateRange,
  getFilteredExecutedTransactions,
  calculateAnalyticsKPIs,
  calculateMonthlyCashFlow,
  calculateCategoryBreakdown,
  calculateNetWorthHistory,
  calculateExpenseMoMTrend,
  getTopExpenses,
  calculateFinancialExtremes,
} from '../../services/analyticsEngine';
import { formatCurrency } from '../../services/currencyService';
import { formatCzechDate, getTodayInPrague } from '../../services/periodService';
import { sortCategoriesAlphabetically, czechStringCompare } from '../../services/categoryService';
import { CashFlowBarChart } from './CashFlowBarChart';
import { CategoryBarChart } from './CategoryBarChart';
import { NetWorthHistoryChart } from './NetWorthHistoryChart';
import {
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownRight,
  DollarSign,
  PiggyBank,
  Calendar,
  AlertCircle,
  HelpCircle,
  Clock,
  Layers,
  Receipt,
  Tag,
  Landmark,
  Check,
} from 'lucide-react';

interface AnalyticsScreenProps {
  onEditTransaction?: (tx: Transaction) => void;
}

// Držíme stav vybraného období a filtrů na úrovni modulu, aby zůstal zachován při přechodu do jiné sekce
let savedPreset: AnalyticsPeriodPreset = '12m';
let savedCustomFrom = '';
let savedCustomTo = '';
let savedFilters: AnalyticsFilters = {
  accountId: null,
  categoryId: null,
  subcategoryId: null,
};

export const AnalyticsScreen: React.FC<AnalyticsScreenProps> = ({
  onEditTransaction,
}) => {
  const {
    accounts,
    categories,
    transactions,
    corrections,
    marketValueSnapshots,
  } = useFinance();

  const todayStr = getTodayInPrague();

  // Stav výběru období
  const [preset, setPreset] = useState<AnalyticsPeriodPreset>(() => savedPreset);
  const [customFromInput, setCustomFromInput] = useState<string>(() => savedCustomFrom);
  const [customToInput, setCustomToInput] = useState<string>(() => savedCustomTo);
  const [appliedCustomFrom, setAppliedCustomFrom] = useState<string>(() => savedCustomFrom);
  const [appliedCustomTo, setAppliedCustomTo] = useState<string>(() => savedCustomTo);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Stav doplňkových filtrů
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(() => savedFilters.accountId || null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(() => savedFilters.categoryId || null);
  const [selectedSubcategoryId, setSelectedSubcategoryId] = useState<string | null>(() => savedFilters.subcategoryId || null);

  // Aktualizace uloženého stavu
  const updatePreset = (newPreset: AnalyticsPeriodPreset) => {
    setPreset(newPreset);
    savedPreset = newPreset;
    setValidationError(null);
  };

  const handleApplyCustom = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!customFromInput || !customToInput) {
      setValidationError('Vyberte prosím počáteční i koncový měsíc.');
      return;
    }
    if (customFromInput > customToInput) {
      setValidationError('Počáteční měsíc nesmí být pozdější než koncový měsíc.');
      return;
    }
    const currentMonthKey = todayStr.slice(0, 7);
    if (customToInput > currentMonthKey) {
      setValidationError('Koncový měsíc nesmí být v budoucnosti.');
      return;
    }

    setValidationError(null);
    setAppliedCustomFrom(customFromInput);
    setAppliedCustomTo(customToInput);
    savedCustomFrom = customFromInput;
    savedCustomTo = customToInput;
    updatePreset('custom');
  };

  // Synchronizace filtrů s persistencí
  const handleSelectAccount = (id: string | null) => {
    setSelectedAccountId(id);
    savedFilters.accountId = id;
  };

  const handleSelectCategory = (id: string | null) => {
    setSelectedCategoryId(id);
    savedFilters.categoryId = id;
    setSelectedSubcategoryId(null);
    savedFilters.subcategoryId = null;
  };

  const handleSelectSubcategory = (id: string | null) => {
    setSelectedSubcategoryId(id);
    savedFilters.subcategoryId = id;
  };

  // Vyhodnocení rozsahu období
  const dateRangeResult = useMemo(() => {
    return resolveAnalyticsDateRange(
      preset,
      appliedCustomFrom,
      appliedCustomTo,
      {
        accounts,
        transactions,
        corrections,
        snapshots: marketValueSnapshots,
      },
      todayStr
    );
  }, [preset, appliedCustomFrom, appliedCustomTo, accounts, transactions, corrections, marketValueSnapshots, todayStr]);

  const dateRange = dateRangeResult.range;

  // Filtrované transakce
  const currentFilters = useMemo<AnalyticsFilters>(
    () => ({
      accountId: selectedAccountId,
      categoryId: selectedCategoryId,
      subcategoryId: selectedSubcategoryId,
    }),
    [selectedAccountId, selectedCategoryId, selectedSubcategoryId]
  );

  const filteredTxs = useMemo(() => {
    return getFilteredExecutedTransactions(
      transactions,
      dateRange,
      currentFilters,
      categories,
      todayStr
    );
  }, [transactions, dateRange, currentFilters, categories, todayStr]);

  // Všechny uskutečněné transakce (pro meziměsíční trendy i mimo vybraný rozsah)
  const allExecutedTxs = useMemo(() => {
    return transactions.filter((t) => t.status === 'executed' && t.date <= todayStr);
  }, [transactions, todayStr]);

  // Výpočty metrik
  const kpis = useMemo(() => {
    return calculateAnalyticsKPIs(
      dateRange,
      filteredTxs,
      accounts,
      transactions,
      corrections,
      marketValueSnapshots,
      selectedAccountId,
      todayStr
    );
  }, [dateRange, filteredTxs, accounts, transactions, corrections, marketValueSnapshots, selectedAccountId, todayStr]);

  const monthlyCashFlow = useMemo(() => {
    return calculateMonthlyCashFlow(dateRange.months, filteredTxs);
  }, [dateRange.months, filteredTxs]);

  const expenseCategories = useMemo(() => {
    return calculateCategoryBreakdown('expense', filteredTxs, categories);
  }, [filteredTxs, categories]);

  const incomeCategories = useMemo(() => {
    return calculateCategoryBreakdown('income', filteredTxs, categories);
  }, [filteredTxs, categories]);

  const netWorthHistory = useMemo(() => {
    return calculateNetWorthHistory(
      dateRange.months,
      accounts,
      transactions,
      corrections,
      marketValueSnapshots,
      selectedAccountId
    );
  }, [dateRange.months, accounts, transactions, corrections, marketValueSnapshots, selectedAccountId]);

  const expenseTrends = useMemo(() => {
    return calculateExpenseMoMTrend(
      dateRange.months,
      allExecutedTxs,
      currentFilters,
      categories,
      todayStr
    );
  }, [dateRange.months, allExecutedTxs, currentFilters, categories, todayStr]);

  const topExpenses = useMemo(() => {
    return getTopExpenses(filteredTxs, accounts, categories);
  }, [filteredTxs, accounts, categories]);

  const extremes = useMemo(() => {
    return calculateFinancialExtremes(monthlyCashFlow);
  }, [monthlyCashFlow]);

  // Seřazené účty pro filtr (abecedně A–Z)
  const sortedAccounts = useMemo(() => {
    return [...accounts].sort((a, b) => czechStringCompare(a.name, b.name));
  }, [accounts]);

  // Seřazené hlavní kategorie pro filtr (abecedně A–Z)
  const mainCategories = useMemo(() => {
    return sortCategoriesAlphabetically(categories.filter((c) => !c.parentId));
  }, [categories]);

  // Podkategorie pro vybranou hlavní kategorii
  const availableSubcategories = useMemo(() => {
    if (!selectedCategoryId) return [];
    return sortCategoriesAlphabetically(
      categories.filter((c) => c.parentId === selectedCategoryId)
    );
  }, [categories, selectedCategoryId]);

  const selectedAccountObj = accounts.find((a) => a.id === selectedAccountId);

  return (
    <div className="space-y-6 pb-12 animate-fadeIn">
      {/* 1. Panel pro výběr období */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200/80 shadow-sm space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Rychlé volby */}
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-2">
              Analyzované období
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => updatePreset('3m')}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border ${
                  preset === '3m'
                    ? 'bg-sky-600 text-white border-sky-600 shadow-sm shadow-sky-500/20'
                    : 'bg-slate-50 hover:bg-slate-100 text-slate-600 border-slate-200/80'
                }`}
              >
                Poslední 3 měsíce
              </button>

              <button
                type="button"
                onClick={() => updatePreset('6m')}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border ${
                  preset === '6m'
                    ? 'bg-sky-600 text-white border-sky-600 shadow-sm shadow-sky-500/20'
                    : 'bg-slate-50 hover:bg-slate-100 text-slate-600 border-slate-200/80'
                }`}
              >
                Posledních 6 měsíců
              </button>

              <button
                type="button"
                onClick={() => updatePreset('12m')}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border ${
                  preset === '12m'
                    ? 'bg-sky-600 text-white border-sky-600 shadow-sm shadow-sky-500/20'
                    : 'bg-slate-50 hover:bg-slate-100 text-slate-600 border-slate-200/80'
                }`}
              >
                Posledních 12 měsíců
              </button>

              <button
                type="button"
                onClick={() => updatePreset('ytd')}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border ${
                  preset === 'ytd'
                    ? 'bg-sky-600 text-white border-sky-600 shadow-sm shadow-sky-500/20'
                    : 'bg-slate-50 hover:bg-slate-100 text-slate-600 border-slate-200/80'
                }`}
              >
                Tento rok (YTD)
              </button>

              <button
                type="button"
                onClick={() => updatePreset('all')}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border ${
                  preset === 'all'
                    ? 'bg-sky-600 text-white border-sky-600 shadow-sm shadow-sky-500/20'
                    : 'bg-slate-50 hover:bg-slate-100 text-slate-600 border-slate-200/80'
                }`}
              >
                Celá historie
              </button>
            </div>
          </div>

          {/* Vlastní výběr Od - Do */}
          <form
            onSubmit={handleApplyCustom}
            className="flex flex-wrap items-center gap-2 pt-2 lg:pt-0 lg:border-l lg:border-slate-200/80 lg:pl-4"
          >
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-slate-500 font-medium">Od:</span>
              <input
                type="month"
                max={todayStr.slice(0, 7)}
                value={customFromInput}
                onChange={(e) => setCustomFromInput(e.target.value)}
                className="px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-700 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
              />
            </div>

            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-slate-500 font-medium">Do:</span>
              <input
                type="month"
                max={todayStr.slice(0, 7)}
                value={customToInput}
                onChange={(e) => setCustomToInput(e.target.value)}
                className="px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-700 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
              />
            </div>

            <button
              type="submit"
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                preset === 'custom'
                  ? 'bg-sky-600 text-white border-sky-600 shadow-sm'
                  : 'bg-slate-800 hover:bg-slate-900 text-white border-slate-800'
              }`}
            >
              OK
            </button>
          </form>
        </div>

        {/* Chybová validační zpráva */}
        {validationError && (
          <div className="flex items-center gap-2 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium animate-fadeIn">
            <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
            <span>{validationError}</span>
          </div>
        )}
      </div>

      {/* 2. Doplňkové filtry */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200/80 shadow-sm">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-2.5">
          Filtrovat zobrazená data
        </span>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Filtr účtu */}
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">
              Účet
            </label>
            <div className="relative">
              <select
                value={selectedAccountId || ''}
                onChange={(e) => handleSelectAccount(e.target.value || null)}
                className="w-full px-3 py-2 bg-slate-50 hover:bg-slate-100/80 focus:bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition-all appearance-none"
              >
                <option value="">Všechny účty</option>
                {sortedAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} {a.status === 'archived' ? '(Archivovaný)' : ''}
                  </option>
                ))}
              </select>
              <div className="absolute inset-y-0 right-0 flex items-center pr-2.5 pointer-events-none text-slate-400">
                <Landmark className="w-3.5 h-3.5" />
              </div>
            </div>
          </div>

          {/* Filtr hlavní kategorie */}
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">
              Kategorie
            </label>
            <div className="relative">
              <select
                value={selectedCategoryId || ''}
                onChange={(e) => handleSelectCategory(e.target.value || null)}
                className="w-full px-3 py-2 bg-slate-50 hover:bg-slate-100/80 focus:bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition-all appearance-none"
              >
                <option value="">Všechny kategorie</option>
                {mainCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.type === 'expense' ? 'výdaj' : 'příjem'})
                  </option>
                ))}
              </select>
              <div className="absolute inset-y-0 right-0 flex items-center pr-2.5 pointer-events-none text-slate-400">
                <Layers className="w-3.5 h-3.5" />
              </div>
            </div>
          </div>

          {/* Filtr podkategorie */}
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">
              Podkategorie
            </label>
            <div className="relative">
              <select
                disabled={!selectedCategoryId || availableSubcategories.length === 0}
                value={selectedSubcategoryId || ''}
                onChange={(e) => handleSelectSubcategory(e.target.value || null)}
                className={`w-full px-3 py-2 border rounded-xl text-xs font-semibold transition-all appearance-none ${
                  !selectedCategoryId || availableSubcategories.length === 0
                    ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                    : 'bg-slate-50 hover:bg-slate-100/80 focus:bg-white border-slate-200 text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500'
                }`}
              >
                <option value="">Všechny podkategorie</option>
                {availableSubcategories.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <div className="absolute inset-y-0 right-0 flex items-center pr-2.5 pointer-events-none text-slate-400">
                <Tag className="w-3.5 h-3.5" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Šest souhrnných KPI karet */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3.5">
        {/* Karta 1: Celkové příjmy */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm hover:border-slate-300 transition-all">
          <div className="flex items-center justify-between text-slate-500 mb-1.5">
            <span className="text-xs font-semibold">Celkové příjmy</span>
            <div className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600">
              <ArrowDownRight className="w-4 h-4" />
            </div>
          </div>
          <div className="text-lg font-bold text-slate-900 truncate tabular-nums">
            {formatCurrency(kpis.totalIncomeInHaler)}
          </div>
          <p className="text-[11px] text-slate-400 mt-1 truncate">
            Za zvolené období
          </p>
        </div>

        {/* Karta 2: Celkové výdaje */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm hover:border-slate-300 transition-all">
          <div className="flex items-center justify-between text-slate-500 mb-1.5">
            <span className="text-xs font-semibold">Celkové výdaje</span>
            <div className="p-1.5 rounded-lg bg-rose-50 text-rose-600">
              <ArrowUpRight className="w-4 h-4" />
            </div>
          </div>
          <div className="text-lg font-bold text-slate-900 truncate tabular-nums">
            {formatCurrency(kpis.totalExpenseInHaler)}
          </div>
          <p className="text-[11px] text-slate-400 mt-1 truncate">
            Bez interních převodů
          </p>
        </div>

        {/* Karta 3: Čistá změna */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm hover:border-slate-300 transition-all">
          <div className="flex items-center justify-between text-slate-500 mb-1.5">
            <span className="text-xs font-semibold">Čistá změna</span>
            <div className={`p-1.5 rounded-lg ${kpis.netChangeInHaler >= 0 ? 'bg-sky-50 text-sky-600' : 'bg-red-50 text-red-600'}`}>
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className={`text-lg font-bold truncate tabular-nums ${kpis.netChangeInHaler < 0 ? 'text-red-600' : 'text-slate-900'}`}>
            {formatCurrency(kpis.netChangeInHaler)}
          </div>
          <p className="text-[11px] text-slate-400 mt-1 truncate">
            Příjmy − výdaje
          </p>
        </div>

        {/* Karta 4: Míra úspor */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm hover:border-slate-300 transition-all">
          <div className="flex items-center justify-between text-slate-500 mb-1.5">
            <span className="text-xs font-semibold">Míra úspor</span>
            <div className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600">
              <PiggyBank className="w-4 h-4" />
            </div>
          </div>
          <div className="text-lg font-bold text-slate-900 truncate tabular-nums">
            {kpis.savingsRate !== null ? `${kpis.savingsRate.toFixed(1)} %` : '—'}
          </div>
          <p className="text-[11px] text-slate-400 mt-1 truncate" title={kpis.savingsRate === null ? 'Míru úspor nelze bez příjmů vypočítat' : 'Podíl úspor na příjmech'}>
            {kpis.savingsRate !== null ? 'Podíl na příjmech' : 'Bez příjmů'}
          </p>
        </div>

        {/* Karta 5: Průměrné měsíční výdaje */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm hover:border-slate-300 transition-all">
          <div className="flex items-center justify-between text-slate-500 mb-1.5">
            <span className="text-xs font-semibold">Průměrné výdaje</span>
            <div className="p-1.5 rounded-lg bg-amber-50 text-amber-600">
              <Calendar className="w-4 h-4" />
            </div>
          </div>
          <div className="text-lg font-bold text-slate-900 truncate tabular-nums">
            {formatCurrency(kpis.avgMonthlyExpenseInHaler)}
          </div>
          <p
            className="text-[11px] text-slate-400 mt-1 truncate flex items-center gap-1"
            title={kpis.hasPartialCurrentMonth ? 'Aktuální měsíc ještě není uzavřený' : 'Průměr za zahrnuté měsíce'}
          >
            <span>/ měsíc</span>
            {kpis.hasPartialCurrentMonth && (
              <span className="text-amber-500 font-semibold" title="Aktuální měsíc ještě probíhá">
                *
              </span>
            )}
          </p>
        </div>

        {/* Karta 6: Změna celkového jmění */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm hover:border-slate-300 transition-all">
          <div className="flex items-center justify-between text-slate-500 mb-1.5">
            <span className="text-xs font-semibold">Změna jmění</span>
            <div className={`p-1.5 rounded-lg ${kpis.netWorthChangeInHaler >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
              {kpis.netWorthChangeInHaler >= 0 ? (
                <TrendingUp className="w-4 h-4" />
              ) : (
                <TrendingDown className="w-4 h-4" />
              )}
            </div>
          </div>
          <div className={`text-lg font-bold truncate tabular-nums ${kpis.netWorthChangeInHaler < 0 ? 'text-red-600' : 'text-slate-900'}`}>
            {formatCurrency(kpis.netWorthChangeInHaler, { showPlus: true })}
          </div>
          <p className="text-[11px] text-slate-400 mt-1 truncate">
            {selectedAccountObj ? selectedAccountObj.name : 'Za všechny účty'}
          </p>
        </div>
      </div>

      {/* 4. Hlavní sloupcový graf Příjmy, výdaje a čistá změna */}
      <CashFlowBarChart data={monthlyCashFlow} />

      {/* 5. Rozpad kategorií (Výdaje & Příjmy) ve dvousloupcovém rozložení */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CategoryBarChart
          title="Výdaje podle kategorií"
          subtitle="Seřazeno podle výše útrat s možností rozbalení podkategorií"
          items={expenseCategories}
          emptyMessage="Ve vybraném období nebyly zaznamenány žádné výdaje."
        />

        <CategoryBarChart
          title="Příjmy podle kategorií"
          subtitle="Seřazeno podle výše příjmů s možností rozbalení podkategorií"
          items={incomeCategories}
          emptyMessage="Ve vybraném období nebyly zaznamenány žádné příjmy."
        />
      </div>

      {/* 6. Spojnicový graf vývoje celkového jmění */}
      <NetWorthHistoryChart
        data={netWorthHistory}
        accountFilterName={selectedAccountObj ? selectedAccountObj.name : null}
      />

      {/* 7. Dvousloupec: Meziměsíční trend výdajů & Finanční extrémy a průměry */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Trend výdajů */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Trend výdajů mezi měsíci
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Porovnání výdajů oproti předcházejícímu kalendářnímu měsíci
            </p>
          </div>

          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {expenseTrends.map((t) => {
              const isDecrease = t.changePercent !== null && t.changePercent < 0;
              const isIncrease = t.changePercent !== null && t.changePercent > 0;

              return (
                <div
                  key={t.monthKey}
                  className="p-3 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-800">{t.label}</span>
                    {t.isCurrentMonth && (
                      <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium" title="Srovnání ke stejnému dni měsíce">
                        Probíhající
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="font-extrabold text-slate-900 tabular-nums">
                      {formatCurrency(t.expenseInHaler)}
                    </span>

                    {t.changePercent !== null ? (
                      <span
                        className={`text-[11px] font-bold px-2 py-0.5 rounded-full tabular-nums flex items-center gap-0.5 ${
                          isDecrease
                            ? 'bg-emerald-100 text-emerald-700'
                            : isIncrease
                            ? 'bg-rose-100 text-rose-700'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                        title={
                          t.isSameDayComparison
                            ? 'Srovnání ke stejnému dni předchozího měsíce'
                            : 'Meziměsíční změna'
                        }
                      >
                        {isDecrease ? '↓ ' : isIncrease ? '↑ +' : ''}
                        {t.changePercent.toFixed(1)} %
                      </span>
                    ) : (
                      <span className="text-[11px] font-medium text-slate-400 px-2 py-0.5">
                        —
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Finanční extrémy a průměry */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Průměry a finanční extrémy
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Nejlepší a nejnáročnější měsíce ve vybraném období
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            {/* Nejvyšší příjem */}
            <div className="p-3 bg-emerald-50/70 border border-emerald-100 rounded-xl space-y-1">
              <span className="text-[11px] font-medium text-emerald-800">
                Nejvyšší měsíční příjem
              </span>
              <div className="text-sm font-bold text-emerald-900 tabular-nums">
                {extremes.highestIncomeMonth
                  ? formatCurrency(extremes.highestIncomeMonth.amountInHaler)
                  : '—'}
              </div>
              <p className="text-[10px] text-emerald-600 font-medium truncate">
                {extremes.highestIncomeMonth?.label || 'Žádná data'}
              </p>
            </div>

            {/* Nejvyšší výdaje */}
            <div className="p-3 bg-rose-50/70 border border-rose-100 rounded-xl space-y-1">
              <span className="text-[11px] font-medium text-rose-800">
                Nejvyšší měsíční výdaje
              </span>
              <div className="text-sm font-bold text-rose-900 tabular-nums">
                {extremes.highestExpenseMonth
                  ? formatCurrency(extremes.highestExpenseMonth.amountInHaler)
                  : '—'}
              </div>
              <p className="text-[10px] text-rose-600 font-medium truncate">
                {extremes.highestExpenseMonth?.label || 'Žádná data'}
              </p>
            </div>

            {/* Nejlepší čistá bilance */}
            <div className="p-3 bg-sky-50/70 border border-sky-100 rounded-xl space-y-1">
              <span className="text-[11px] font-medium text-sky-800">
                Nejlepší čistá bilance
              </span>
              <div className="text-sm font-bold text-sky-900 tabular-nums">
                {extremes.bestNetMonth
                  ? formatCurrency(extremes.bestNetMonth.amountInHaler)
                  : '—'}
              </div>
              <p className="text-[10px] text-sky-600 font-medium truncate">
                {extremes.bestNetMonth?.label || 'Žádná data'}
              </p>
            </div>

            {/* Nejhorší čistá bilance */}
            <div className="p-3 bg-amber-50/70 border border-amber-100 rounded-xl space-y-1">
              <span className="text-[11px] font-medium text-amber-800">
                Nejhorší čistá bilance
              </span>
              <div className="text-sm font-bold text-amber-900 tabular-nums">
                {extremes.worstNetMonth
                  ? formatCurrency(extremes.worstNetMonth.amountInHaler)
                  : '—'}
              </div>
              <p className="text-[10px] text-amber-600 font-medium truncate">
                {extremes.worstNetMonth?.label || 'Žádná data'}
              </p>
            </div>

            {/* Průměrný měsíční příjem */}
            <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl space-y-1">
              <span className="text-[11px] font-medium text-slate-600">
                Průměrný měsíční příjem
              </span>
              <div className="text-sm font-bold text-slate-900 tabular-nums">
                {formatCurrency(extremes.avgMonthlyIncomeInHaler)}
              </div>
              <p className="text-[10px] text-slate-400">Za zvolené období</p>
            </div>

            {/* Průměrná čistá změna */}
            <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl space-y-1">
              <span className="text-[11px] font-medium text-slate-600">
                Průměrná čistá bilance
              </span>
              <div
                className={`text-sm font-bold tabular-nums ${
                  extremes.avgMonthlyNetChangeInHaler < 0
                    ? 'text-red-600'
                    : 'text-slate-900'
                }`}
              >
                {formatCurrency(extremes.avgMonthlyNetChangeInHaler)}
              </div>
              <p className="text-[10px] text-slate-400">/ měsíc</p>
            </div>
          </div>
        </div>
      </div>

      {/* 8. Tabulka Nejvyšší výdaje */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-4">
        <div>
          <h3 className="text-sm font-bold text-slate-900">
            Nejvyšší výdaje ve vybraném období
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            10 nejvyšších uskutečněných výdajových položek (kliknutím položku upravíte)
          </p>
        </div>

        {topExpenses.length > 0 ? (
          <div className="overflow-x-auto -mx-5 px-5">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-slate-200/80 text-slate-400 font-semibold uppercase text-[10px] tracking-wider">
                  <th className="py-2.5 pr-4">Datum</th>
                  <th className="py-2.5 pr-4">Položka</th>
                  <th className="py-2.5 pr-4">Kategorie</th>
                  <th className="py-2.5 pr-4">Podkategorie</th>
                  <th className="py-2.5 pr-4">Účet</th>
                  <th className="py-2.5 text-right">Částka</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {topExpenses.map((item) => (
                  <tr
                    key={item.transaction.id}
                    onClick={() => onEditTransaction && onEditTransaction(item.transaction)}
                    className="hover:bg-slate-50/80 cursor-pointer transition-colors group"
                  >
                    <td className="py-2.5 pr-4 font-medium text-slate-500 whitespace-nowrap">
                      {formatCzechDate(item.transaction.date)}
                    </td>
                    <td className="py-2.5 pr-4 font-bold text-slate-900 group-hover:text-sky-600 transition-colors">
                      {item.transaction.title}
                    </td>
                    <td className="py-2.5 pr-4 text-slate-600 font-medium">
                      {item.categoryName}
                    </td>
                    <td className="py-2.5 pr-4 text-slate-500">
                      {item.subcategoryName || '—'}
                    </td>
                    <td className="py-2.5 pr-4 text-slate-600 font-medium">
                      {item.accountName}
                    </td>
                    <td className="py-2.5 text-right font-extrabold text-slate-900 tabular-nums whitespace-nowrap">
                      {formatCurrency(
                        item.transaction.actualAmountInHaler !== undefined
                          ? item.transaction.actualAmountInHaler
                          : item.transaction.amountInHaler
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-8 text-center text-xs text-slate-400">
            Ve vybraném období nebyly nalezeny žádné výdajové položky.
          </div>
        )}
      </div>
    </div>
  );
};
