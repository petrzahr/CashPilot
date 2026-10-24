import { DualPeriodFilterPanel } from '../shared/DualPeriodFilterPanel';
import { AlertCircle } from 'lucide-react';
import { CashFlowCompositionChart } from './CashFlowCompositionChart';
import { CategoryBreakdownTable } from './CategoryBreakdownTable';
import { calculateCategoryBreakdown } from '../../services/categoryBreakdownService';
import { getDefaultAccount, getEffectiveAmountInHaler } from '../../services/accountScope';
import React, { useMemo } from 'react';
import { useFinance } from '../../context/FinanceContext';
import {
  AnalyticsFilters,
  createBudgetPeriodInfo,
  toAnalyticsDateRange,
  getFilteredExecutedTransactions,
  calculateMonthlyCashFlow,
  calculateExpenseMoMTrend,
  getTopExpenses,
  calculateFinancialExtremes,
  calculateCashFlowComposition,
} from '../../services/analyticsEngine';
import { formatCurrency, formatPercent } from '../../services/currencyService';
import {
  formatCzechDate,
  getTodayInPrague,
  normalizeStartDay,
} from '../../services/periodService';
import { DualPeriodRange, resolvePeriodRange } from '../../services/periodRange';

/** Čistá bilance nese barvu jen podle znaménka: přebytek zelený, schodek červený. */
const netTone = (amountInHaler: number | undefined) =>
  amountInHaler === undefined ? 'text-slate-500' : amountInHaler > 0 ? 'text-emerald-600' : amountInHaler < 0 ? 'text-red-600' : 'text-slate-900';

export const AnalyticsScreen: React.FC = () => {
  const {
    accounts,
    categories,
    transactions,
    corrections,
    marketValueSnapshots,
    settings,
    forecast,
    periodRanges,
    setPeriodRange,
    recurringRules,
    recurringExceptions,
  } = useFinance();

  const todayStr = getTodayInPrague();
  const budgetStartDay = normalizeStartDay(settings?.budgetStartDay);

  // Celá analýza se počítá jen z výchozího účtu (stejně jako Měsíční rozpočet)
  const defaultAccount = useMemo(
    () => getDefaultAccount(accounts),
    [accounts]
  );
  const accountFilters = useMemo<AnalyticsFilters>(
    () => ({ accountId: defaultAccount?.id ?? null, categoryId: null, subcategoryId: null }),
    [defaultAccount]
  );

  // Výběr období začíná na výchozím rozsahu z Nastavení; v rámci relace se pamatuje i při přechodu do jiné sekce
  const range = periodRanges.analytics;
  const updateRange = (newRange: DualPeriodRange) => setPeriodRange('analytics', newRange);

  // Vyhodnocení rozsahu období pomocí hlavního filtru Budoucnost/Historie (shodného se sekcí Majetek);
  // aktuální období bere z předpovědi stejně jako Majetek, aby se obě sekce vždy shodly
  const currentPeriod = forecast.currentPeriod;
  const periods = useMemo(() => resolvePeriodRange(range, {
    current: currentPeriod,
    startDay: budgetStartDay,
    data: { accounts, transactions, corrections, snapshots: marketValueSnapshots },
  }).map(period => createBudgetPeriodInfo(period, todayStr)), [range, currentPeriod, accounts, transactions, corrections, marketValueSnapshots, todayStr, budgetStartDay]);
  // Předpověď rozsah pokrývá sama (viz buildForecastPeriods), graf Příjmy/Výdaje/Skutečně uspořeno má souhrny pro všechna období

  const dateRange = useMemo(() => toAnalyticsDateRange(periods, todayStr), [periods, todayStr]);

  // Filtrované transakce
  const filteredTxs = useMemo(() => {
    return getFilteredExecutedTransactions(
      transactions,
      dateRange,
      accountFilters,
      categories,
      todayStr
    );
  }, [transactions, dateRange, accountFilters, categories, todayStr]);

  // Všechny uskutečněné transakce (pro meziměsíční trendy i mimo vybraný rozsah)
  const allExecutedTxs = useMemo(() => {
    return transactions.filter((t) => t.status === 'executed' && t.date <= todayStr);
  }, [transactions, todayStr]);

  const monthlyCashFlow = useMemo(() => {
    return calculateMonthlyCashFlow(dateRange.periods, filteredTxs);
  }, [dateRange.periods, filteredTxs]);

  const expenseTrends = useMemo(() => {
    return calculateExpenseMoMTrend(
      dateRange.periods,
      allExecutedTxs,
      accountFilters,
      categories,
      todayStr
    );
  }, [dateRange.periods, allExecutedTxs, accountFilters, categories, todayStr, budgetStartDay]);

  const topExpenses = useMemo(() => {
    return getTopExpenses(filteredTxs, accounts, categories);
  }, [filteredTxs, accounts, categories]);

  const extremes = useMemo(() => {
    return calculateFinancialExtremes(monthlyCashFlow);
  }, [monthlyCashFlow]);

  const cashFlowComposition = useMemo(() => {
    return calculateCashFlowComposition(dateRange.periods, forecast);
  }, [dateRange.periods, forecast]);

  const categoryBreakdown = useMemo(() => {
    return calculateCategoryBreakdown(
      dateRange.periods,
      transactions,
      recurringRules,
      recurringExceptions,
      categories,
      accounts,
      defaultAccount?.id
    );
  }, [dateRange.periods, transactions, recurringRules, recurringExceptions, categories, accounts, budgetStartDay, defaultAccount]);

  return (
    <div className="space-y-6">
      {/* 1. Hlavní filtr období (shodný se sekcí Přehledy) */}
      <DualPeriodFilterPanel
        range={range}
        onRangeChange={updateRange}
        periods={periods}
        currentPeriodKey={currentPeriod.key}
        ariaLabel="Analyzované období"
      />

      {!defaultAccount ? (
        <div className="panel panel-warning flex items-start gap-2.5">
          <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h2 className="text-sm font-bold text-amber-900">Chybí výchozí účet</h2>
            <p className="text-xs text-amber-700 leading-relaxed">
              Analýza se počítá z výchozího účtu. V sekci <strong>Účty</strong> upravte hlavní účet a zaškrtněte Výchozí účet.
            </p>
          </div>
        </div>
      ) : (
      <>
      {/* 2. Rozsah analýzy: všechny sekce níže jsou jen z výchozího účtu */}
      <div className="flex items-center gap-2 px-0.5 text-xs text-slate-500">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: defaultAccount.color }} aria-hidden="true" />
        <span>
          Výchozí účet: <span className="font-semibold text-slate-900">{defaultAccount.name}</span>
        </span>
      </div>

      {/* 3. Finanční přehled: příjmy, výdaje a skutečně uspořeno (hodnoty shodné s Měsíčním rozpočtem) */}
      <CashFlowCompositionChart data={cashFlowComposition} />

      {/* 4. Souhrn podle kategorií a podkategorií za vybrané období */}
      <CategoryBreakdownTable periods={dateRange.periods} data={categoryBreakdown} />

      {/* 5. Dvousloupec: Meziměsíční trend výdajů & Finanční extrémy a průměry */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Trend výdajů */}
        <div className="card p-5 space-y-4">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              Trend výdajů mezi obdobími
            </h2>
          </div>

          <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto pr-1">
            {expenseTrends.map((t) => {
              const isDecrease = t.changePercent !== null && t.changePercent < 0;
              const isIncrease = t.changePercent !== null && t.changePercent > 0;

              return (
                <div
                  key={t.monthKey}
                  className="py-2.5 flex items-center justify-between text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900">{t.label}</span>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="font-extrabold text-slate-900 tabular-nums">
                      {formatCurrency(t.expenseInHaler)}
                    </span>

                    {t.changePercent !== null ? (
                      <span
                        className={`chip tabular-nums ${
                          isDecrease
                            ? 'bg-emerald-50 text-emerald-700'
                            : isIncrease
                            ? 'bg-red-50 text-red-700'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                        title="Změna oproti celému předchozímu období"
                      >
                        {/* Směr nese šipka, číslo je bez znaménka, aby nevzniklo „↓ −5 %“ */}
                        {isDecrease ? '↓ ' : isIncrease ? '↑ ' : ''}
                        {formatPercent(isDecrease || isIncrease ? Math.abs(t.changePercent) : t.changePercent)}
                      </span>
                    ) : (
                      <span className="chip bg-slate-100 text-slate-600">
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
        <div className="card p-5 space-y-4">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              Průměry a finanční extrémy
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            {/* Nejvyšší příjem */}
            <div className="p-3 bg-slate-50 rounded-xl space-y-1">
              <span className="text-xs font-medium text-slate-500">
                Nejvyšší příjem za období
              </span>
              <div className="text-sm font-bold text-emerald-600 tabular-nums">
                {extremes.highestIncomeMonth
                  ? formatCurrency(extremes.highestIncomeMonth.amountInHaler)
                  : '—'}
              </div>
              <p className="text-xs text-slate-500 font-medium truncate">
                {extremes.highestIncomeMonth?.label || 'Žádná data'}
              </p>
            </div>

            {/* Nejvyšší výdaje */}
            <div className="p-3 bg-slate-50 rounded-xl space-y-1">
              <span className="text-xs font-medium text-slate-500">
                Nejvyšší výdaje za období
              </span>
              <div className="text-sm font-bold text-red-600 tabular-nums">
                {extremes.highestExpenseMonth
                  ? formatCurrency(extremes.highestExpenseMonth.amountInHaler)
                  : '—'}
              </div>
              <p className="text-xs text-slate-500 font-medium truncate">
                {extremes.highestExpenseMonth?.label || 'Žádná data'}
              </p>
            </div>

            {/* Nejlepší čistá bilance */}
            <div className="p-3 bg-slate-50 rounded-xl space-y-1">
              <span className="text-xs font-medium text-slate-500">
                Nejlepší čistá bilance
              </span>
              <div className={`text-sm font-bold tabular-nums ${netTone(extremes.bestNetMonth?.amountInHaler)}`}>
                {extremes.bestNetMonth
                  ? formatCurrency(extremes.bestNetMonth.amountInHaler)
                  : '—'}
              </div>
              <p className="text-xs text-slate-500 font-medium truncate">
                {extremes.bestNetMonth?.label || 'Žádná data'}
              </p>
            </div>

            {/* Nejhorší čistá bilance */}
            <div className="p-3 bg-slate-50 rounded-xl space-y-1">
              <span className="text-xs font-medium text-slate-500">
                Nejhorší čistá bilance
              </span>
              <div className={`text-sm font-bold tabular-nums ${netTone(extremes.worstNetMonth?.amountInHaler)}`}>
                {extremes.worstNetMonth
                  ? formatCurrency(extremes.worstNetMonth.amountInHaler)
                  : '—'}
              </div>
              <p className="text-xs text-slate-500 font-medium truncate">
                {extremes.worstNetMonth?.label || 'Žádná data'}
              </p>
            </div>

            {/* Průměrný příjem */}
            <div className="p-3 bg-slate-50 rounded-xl space-y-1">
              <span className="text-xs font-medium text-slate-500">
                Průměrný příjem za období
              </span>
              <div className="text-sm font-bold text-slate-900 tabular-nums">
                {formatCurrency(extremes.avgMonthlyIncomeInHaler)}
              </div>
              <p className="text-xs text-slate-500">Za vybraná období</p>
            </div>

            {/* Průměrná čistá bilance: barva podle znaménka jako u nejlepší a nejhorší */}
            <div className="p-3 bg-slate-50 rounded-xl space-y-1">
              <span className="text-xs font-medium text-slate-500">
                Průměrná čistá bilance za období
              </span>
              <div className={`text-sm font-bold tabular-nums ${netTone(extremes.avgMonthlyNetChangeInHaler)}`}>
                {formatCurrency(extremes.avgMonthlyNetChangeInHaler)}
              </div>
              <p className="text-xs text-slate-500">Za vybraná období</p>
            </div>
          </div>
        </div>
      </div>

      {/* 6. Tabulka Nejvyšší výdaje */}
      <div className="card overflow-hidden">
        <div className="card-header">
          <h2 className="text-sm font-bold text-slate-900">
            Nejvyšší výdaje ve vybraném období
          </h2>
        </div>

        {topExpenses.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold text-xs">
                  <th className="py-2.5 px-4">Datum</th>
                  <th className="py-2.5 px-4">Položka</th>
                  <th className="py-2.5 px-4">Kategorie</th>
                  <th className="py-2.5 px-4">Podkategorie</th>
                  <th className="py-2.5 px-4">Účet</th>
                  <th className="py-2.5 px-4 text-right">Částka</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {topExpenses.map((item) => (
                  <tr key={item.transaction.id}>
                    <td className="py-2.5 px-4 font-medium text-slate-500 whitespace-nowrap">
                      {formatCzechDate(item.transaction.date)}
                    </td>
                    <td className="py-2.5 px-4 font-bold text-slate-900">
                      {item.transaction.title}
                    </td>
                    <td className="py-2.5 px-4 text-slate-500 font-medium">
                      {item.categoryName}
                    </td>
                    <td className="py-2.5 px-4 text-slate-500">
                      {item.subcategoryName || '—'}
                    </td>
                    <td className="py-2.5 px-4 text-slate-500 font-medium">
                      {item.accountName}
                    </td>
                    <td className="py-2.5 px-4 text-right font-extrabold text-red-600 tabular-nums whitespace-nowrap">
                      {formatCurrency(getEffectiveAmountInHaler(item.transaction))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            Ve vybraném období nebyly nalezeny žádné výdajové položky.
          </div>
        )}
      </div>
      </>
      )}
    </div>
  );
};
