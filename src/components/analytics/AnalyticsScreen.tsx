import { DualPeriodFilterPanel } from '../shared/DualPeriodFilterPanel';
import React, { useState, useMemo } from 'react';
import { useFinance } from '../../context/FinanceContext';
import {
  AnalyticsDateRange,
  AnalyticsFilters,
  DualPeriodRange,
  resolveDualPeriodRange,
  getFilteredExecutedTransactions,
  calculateMonthlyCashFlow,
  calculateExpenseMoMTrend,
  getTopExpenses,
  calculateFinancialExtremes,
} from '../../services/analyticsEngine';
import { formatCurrency } from '../../services/currencyService';
import {
  formatCzechDate,
  getTodayInPrague,
  getPeriodForDate,
} from '../../services/periodService';

// Držíme stav vybraného období na úrovni modulu, aby zůstal zachován při přechodu do jiné sekce
let savedRange: DualPeriodRange = { direction: 'past', months: 12 };

const noFilters: AnalyticsFilters = {
  accountId: null,
  categoryId: null,
  subcategoryId: null,
};

export const AnalyticsScreen: React.FC = () => {
  const {
    accounts,
    categories,
    transactions,
    corrections,
    marketValueSnapshots,
    settings,
  } = useFinance();

  const todayStr = getTodayInPrague();
  const budgetStartDay = settings?.budgetStartDay || 15;

  const currentPeriod = useMemo(() => {
    return getPeriodForDate(todayStr, budgetStartDay);
  }, [todayStr, budgetStartDay]);

  // Stav výběru období
  const [range, setRange] = useState<DualPeriodRange>(() => savedRange);

  // Aktualizace uloženého stavu
  const updateRange = (newRange: DualPeriodRange) => {
    setRange(newRange);
    savedRange = newRange;
  };

  // Vyhodnocení rozsahu období pomocí hlavního filtru Budoucnost/Historie (shodného se sekcí Přehledy)
  const periods = useMemo(() => {
    return resolveDualPeriodRange(
      range,
      currentPeriod,
      {
        accounts,
        transactions,
        corrections,
        snapshots: marketValueSnapshots,
      },
      todayStr,
      budgetStartDay
    );
  }, [range, currentPeriod, accounts, transactions, corrections, marketValueSnapshots, todayStr, budgetStartDay]);

  const dateRange = useMemo<AnalyticsDateRange>(() => {
    const first = periods[0];
    const last = periods[periods.length - 1];
    return {
      preset: range.preset === 'custom' || range.preset === 'ytd' || range.preset === 'all' ? range.preset : '12m',
      startDate: first ? first.startDate : todayStr,
      endDate: last ? last.analysisEndDate : todayStr,
      fromPeriodKey: first ? first.key : '',
      toPeriodKey: last ? last.key : '',
      periods,
    };
  }, [periods, range.preset, todayStr]);

  // Filtrované transakce
  const filteredTxs = useMemo(() => {
    return getFilteredExecutedTransactions(
      transactions,
      dateRange,
      noFilters,
      categories,
      todayStr
    );
  }, [transactions, dateRange, categories, todayStr]);

  // Všechny uskutečněné transakce (pro meziměsíční trendy i mimo vybraný rozsah)
  const allExecutedTxs = useMemo(() => {
    return transactions.filter((t) => t.status === 'executed' && t.date <= todayStr);
  }, [transactions, todayStr]);

  const monthlyCashFlow = useMemo(() => {
    return calculateMonthlyCashFlow(dateRange.periods, filteredTxs, budgetStartDay);
  }, [dateRange.periods, filteredTxs, budgetStartDay]);

  const expenseTrends = useMemo(() => {
    return calculateExpenseMoMTrend(
      dateRange.periods,
      allExecutedTxs,
      noFilters,
      categories,
      todayStr,
      budgetStartDay
    );
  }, [dateRange.periods, allExecutedTxs, categories, todayStr, budgetStartDay]);

  const topExpenses = useMemo(() => {
    return getTopExpenses(filteredTxs, accounts, categories);
  }, [filteredTxs, accounts, categories]);

  const extremes = useMemo(() => {
    return calculateFinancialExtremes(monthlyCashFlow);
  }, [monthlyCashFlow]);

  return (
    <div className="space-y-6 pb-12 animate-fadeIn">
      {/* 1. Hlavní filtr období (shodný se sekcí Přehledy) */}
      <DualPeriodFilterPanel
        range={range}
        onRangeChange={updateRange}
        periods={periods}
        currentPeriodKey={currentPeriod.key}
        ariaLabel="Analyzované období"
      />

      {/* 2. Dvousloupec: Meziměsíční trend výdajů & Finanční extrémy a průměry */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Trend výdajů */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Trend výdajů mezi obdobími
            </h3>
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
                    <span className="font-bold text-slate-900">{t.label}</span>
                    {t.isCurrentMonth && (
                      <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium" title="Srovnání ke stejnému dni období">
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
                            ? 'bg-red-100 text-red-700'
                            : 'bg-slate-100 text-slate-500'
                        }`}
                        title={
                          t.isSameDayComparison
                            ? 'Srovnání ke stejnému dni období'
                            : 'Změna oproti předchozímu období'
                        }
                      >
                        {isDecrease ? '↓ ' : isIncrease ? '↑ +' : ''}
                        {t.changePercent.toFixed(1)} %
                      </span>
                    ) : (
                      <span className="text-[11px] font-medium text-slate-500 px-2 py-0.5">
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
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            {/* Nejvyšší příjem */}
            <div className="p-3 bg-emerald-50/70 border border-emerald-100 rounded-xl space-y-1">
              <span className="text-[11px] font-medium text-emerald-800">
                Nejvyšší příjem za období
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
            <div className="p-3 bg-red-50/70 border border-red-100 rounded-xl space-y-1">
              <span className="text-[11px] font-medium text-red-800">
                Nejvyšší výdaje za období
              </span>
              <div className="text-sm font-bold text-red-900 tabular-nums">
                {extremes.highestExpenseMonth
                  ? formatCurrency(extremes.highestExpenseMonth.amountInHaler)
                  : '—'}
              </div>
              <p className="text-[10px] text-red-600 font-medium truncate">
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

            {/* Průměrný příjem */}
            <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl space-y-1">
              <span className="text-[11px] font-medium text-slate-500">
                Průměrný příjem za období
              </span>
              <div className="text-sm font-bold text-slate-900 tabular-nums">
                {formatCurrency(extremes.avgMonthlyIncomeInHaler)}
              </div>
              <p className="text-[10px] text-slate-500">Za zvolené období</p>
            </div>

            {/* Průměrná čistá změna */}
            <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl space-y-1">
              <span className="text-[11px] font-medium text-slate-500">
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
              <p className="text-[10px] text-slate-500">/ období</p>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Tabulka Nejvyšší výdaje */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-4">
        <div>
          <h3 className="text-sm font-bold text-slate-900">
            Nejvyšší výdaje ve vybraném období
          </h3>
        </div>

        {topExpenses.length > 0 ? (
          <div className="overflow-x-auto -mx-5 px-5">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-slate-200/80 text-slate-500 font-semibold uppercase text-[10px] tracking-wider">
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
                  <tr key={item.transaction.id}>
                    <td className="py-2.5 pr-4 font-medium text-slate-500 whitespace-nowrap">
                      {formatCzechDate(item.transaction.date)}
                    </td>
                    <td className="py-2.5 pr-4 font-bold text-slate-900">
                      {item.transaction.title}
                    </td>
                    <td className="py-2.5 pr-4 text-slate-500 font-medium">
                      {item.categoryName}
                    </td>
                    <td className="py-2.5 pr-4 text-slate-500">
                      {item.subcategoryName || '—'}
                    </td>
                    <td className="py-2.5 pr-4 text-slate-500 font-medium">
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
          <div className="py-8 text-center text-xs text-slate-500">
            Ve vybraném období nebyly nalezeny žádné výdajové položky.
          </div>
        )}
      </div>
    </div>
  );
};
