import React, { useState, useMemo, useEffect } from 'react';
import { useFinance } from '../../context/FinanceContext';
import { formatCurrency } from '../../services/currencyService';
import { formatMonthsCount, formatCzechDate, getOverviewPeriods, OverviewRange } from '../../services/periodService';
import { getAccountPeriodSummary } from '../../services/accountSummaryService';
import { addHaler, subHaler } from '../../services/currencyService';
import { PeriodRangeSelector } from '../shared/PeriodRangeSelector';
import { resolveAnalyticsDateRange } from '../../services/analyticsEngine';
import { createBudgetPeriod, generatePeriodsBetween, getTodayInPrague } from '../../services/periodService';
import { BudgetPeriod } from '../../types/finance';
import {
  Calendar,
  ChevronRight,
  ChevronDown
} from 'lucide-react';

interface OverviewScreenProps {
  onNavigateToBudget: (period: BudgetPeriod) => void;
}

export const OverviewScreen: React.FC<OverviewScreenProps> = ({ onNavigateToBudget }) => {
  const { forecast, settings, accounts, setSelectedPeriod, setOverviewPeriodBounds, transactions = [], corrections = [], marketValueSnapshots = [] } = useFinance();
  type Range = { direction: 'future' | 'past'; months?: OverviewRange['months']; preset?: 'ytd' | 'all' | 'custom'; from?: string; to?: string };
  const [range, setRange] = useState<Range>({ direction: 'future', months: 12 });
  const [drafts, setDrafts] = useState({ future: { from: '', to: '' }, past: { from: '', to: '' } });
  const [validationError, setValidationError] = useState<string | null>(null);
  const selectedPeriods = useMemo(() => {
    if (range.preset === 'custom') {
      const [fy, fm] = range.from!.split('-').map(Number);
      const [ty, tm] = range.to!.split('-').map(Number);
      return generatePeriodsBetween(createBudgetPeriod(fy, fm, settings.budgetStartDay), createBudgetPeriod(ty, tm, settings.budgetStartDay), settings.budgetStartDay);
    }
    if (range.preset) return resolveAnalyticsDateRange(range.preset, undefined, undefined,
      { accounts, transactions, corrections, snapshots: marketValueSnapshots }, getTodayInPrague(), settings.budgetStartDay).range.periods.map(info => info.period);
    return getOverviewPeriods(forecast.currentPeriod, range as OverviewRange, settings.budgetStartDay);
  }, [forecast.currentPeriod, range, settings.budgetStartDay, accounts, transactions, corrections, marketValueSnapshots]);
  const firstPeriod = selectedPeriods[0];
  const lastPeriod = selectedPeriods[selectedPeriods.length - 1];
  useEffect(() => {
    setOverviewPeriodBounds?.([firstPeriod, lastPeriod]);
  }, [firstPeriod.key, lastPeriod.key, settings.budgetStartDay, setOverviewPeriodBounds]);
  useEffect(() => () => setOverviewPeriodBounds?.(null), [setOverviewPeriodBounds]);
  useEffect(() => {
    setDrafts(previous => ({ ...previous, [range.direction]: { from: firstPeriod.key, to: lastPeriod.key } }));
  }, [range.direction, firstPeriod.key, lastPeriod.key]);

  const displayPeriods = useMemo(() => selectedPeriods.flatMap(period => {
    const summary = getAccountPeriodSummary(forecast, period.key);
    return summary ? [summary] : [];
  }), [forecast, selectedPeriods]);

  const accountPeriods = displayPeriods;

  // Režimy zobrazení hlavní forecast tabulky
  const [forecastScope, setForecastScope] = useState<'usable' | 'all'>('usable');

  // Režimy zobrazení přehledu účtů
  const [accountViewMode, setAccountViewMode] = useState<'period' | 'matrix'>('period');
  const [expandedPeriodKey, setExpandedPeriodKey] = useState<string | null>(forecast.currentPeriod?.key || displayPeriods[0]?.period.key || null);

  const activeAccounts = accounts.filter(a => a.status === 'active');

  const handlePeriodClick = (p: BudgetPeriod) => {
    setSelectedPeriod(p);
    onNavigateToBudget(p);
  };

  const overdraftLimit = settings.overdraftLimitInHaler ?? settings.minReserveInHaler ?? 0;

  return (
    <div className="space-y-6 pb-12">
      <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-4" aria-label="Období přehledů">
        {(['future', 'past'] as const).map(direction => (
          <div key={direction} className="flex flex-wrap items-center justify-between gap-3" role="group" aria-label={direction === 'future' ? 'Budoucí období' : 'Minulá období'}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-bold text-slate-900 w-20">{direction === 'future' ? 'Budoucnost' : 'Historie'}</span>
              {(direction === 'future' ? [3, 6, 12, 18, 24] as const : [3, 6, 12, 'ytd', 'all'] as const).map(preset => {
                const active = range.direction === direction && (typeof preset === 'number' ? range.months === preset : range.preset === preset);
                return <button
                  key={preset}
                  type="button"
                  aria-pressed={active}
                  onClick={() => { setRange(typeof preset === 'number' ? { direction, months: preset } : { direction, preset }); setValidationError(null); }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border ${active
                    ? 'bg-sky-600 text-white border-sky-600 shadow-sm shadow-sky-500/20'
                    : 'bg-slate-50 hover:bg-slate-100 text-slate-600 border-slate-200/80'}`}
                >
                  {preset === 'ytd' ? 'Tento rok (YTD)' : preset === 'all' ? 'Celá historie' : `${direction === 'future' ? (preset === 3 ? 'Příští' : 'Příštích') : preset === 3 ? 'Poslední' : 'Posledních'} ${formatMonthsCount(preset)}`}
                </button>;
              })}
            </div>
            <div className="ml-auto max-w-full">
              <PeriodRangeSelector
                from={drafts[direction].from}
                to={drafts[direction].to}
                max={direction === 'past' ? forecast.currentPeriod.key : undefined}
                active={range.direction === direction && range.preset === 'custom'}
                onFromChange={from => { setDrafts(previous => ({ ...previous, [direction]: { ...previous[direction], from } })); setValidationError(null); }}
                onToChange={to => { setDrafts(previous => ({ ...previous, [direction]: { ...previous[direction], to } })); setValidationError(null); }}
                onSubmit={event => {
                  event.preventDefault();
                  const { from, to } = drafts[direction];
                  if (!from || !to) { setValidationError('Vyberte prosím počáteční i koncový měsíc.'); return; }
                  if (from > to) { setValidationError('Počáteční měsíc nesmí být pozdější než koncový měsíc.'); return; }
                  if (direction === 'past' && to > forecast.currentPeriod.key) { setValidationError('Koncové rozpočtové období nesmí být v budoucnosti.'); return; }
                  if (direction === 'future' && to < forecast.currentPeriod.key) { setValidationError('Koncové rozpočtové období nesmí být v minulosti.'); return; }
                  setValidationError(null);
                  setRange({ direction, preset: 'custom', from, to });
                }}
              />
            </div>
          </div>
        ))}
        {validationError && <p role="alert" className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium">{validationError}</p>}
        <p className="text-xs text-slate-500 flex flex-wrap items-center gap-2">
          <Calendar className="w-3.5 h-3.5" />
          {formatCzechDate(selectedPeriods[0].startDate)} – {formatCzechDate(selectedPeriods[selectedPeriods.length - 1].endDate)}
          {selectedPeriods.some(period => period.key === forecast.currentPeriod.key) && <span>· Včetně aktuálního rozpočtového období</span>}
        </p>
      </div>
      {/* Hlavní tabulka forecastu */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Přepínač: Použitelné peníze vs Všechny účty */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
            <button
              type="button"
              onClick={() => setForecastScope('usable')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                forecastScope === 'usable'
                  ? 'bg-white text-sky-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Použitelné peníze
            </button>
            <button
              type="button"
              onClick={() => setForecastScope('all')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                forecastScope === 'all'
                  ? 'bg-white text-purple-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Všechny účty (Celkem)
            </button>
          </div>
        </div>

        {/* Tabulka */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs whitespace-nowrap">
            <thead>
              <tr className="bg-slate-50/75 border-b border-slate-200/80 text-xs font-semibold text-slate-500">
                <th className="py-3 px-4">Období</th>
                <th className="py-3 px-4">Rozsah dat</th>
                <th className="py-3 px-4 text-right">Počáteční stav</th>
                <th className="py-3 px-4 text-right text-emerald-600">Příjmy</th>
                <th className="py-3 px-4 text-right text-red-600">Výdaje</th>
                <th className="py-3 px-4 text-right text-sky-600">Převody</th>
                <th className="py-3 px-4 text-right">Čistá změna</th>
                <th className="py-3 px-4 text-right">Konečný stav</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {displayPeriods.map((p, idx) => {
                const isCurrent = p.period.key === forecast.currentPeriod.key;
                
                const opening = forecastScope === 'usable' ? p.usableOpeningInHaler : p.openingBalanceInHaler;
                const closing = forecastScope === 'usable' ? p.usableClosingInHaler : p.closingBalanceInHaler;
                const change = forecastScope === 'usable' ? p.usableNetChangeInHaler : p.netChangeInHaler;

                const isNegative = closing < 0;
                const isBelowReserve = forecastScope === 'usable' && closing < overdraftLimit;

                return (
                  <tr
                    key={p.period.key}
                    onClick={() => handlePeriodClick(p.period)}
                    className={`cursor-pointer transition-colors group ${
                      isCurrent ? 'bg-sky-50/40 hover:bg-sky-50/70' : 'hover:bg-slate-50/70'
                    }`}
                  >
                    <td className="py-3 px-4 font-semibold text-slate-900 flex items-center gap-2">
                      <span>{p.period.name}</span>
                      {isCurrent && (
                        <span className="px-1.5 py-0.5 text-[10px] font-bold bg-sky-100 text-sky-800 rounded">
                          Aktuální
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-500">
                      {p.period.startDate} až {p.period.endDate}
                    </td>
                    <td className="py-3 px-4 text-right text-slate-700 font-medium">
                      {formatCurrency(opening)}
                    </td>
                    <td className="py-3 px-4 text-right font-semibold text-emerald-600">
                      {p.incomeInHaler > 0 ? `+${formatCurrency(p.incomeInHaler)}` : '0 Kč'}
                    </td>
                    <td className="py-3 px-4 text-right font-semibold text-red-600">
                      {p.expenseInHaler > 0 ? `−${formatCurrency(p.expenseInHaler)}` : '0 Kč'}
                    </td>
                    <td className="py-3 px-4 text-right font-semibold text-sky-600">
                      {p.transfersInHaler > 0 ? formatCurrency(p.transfersInHaler) : '0 Kč'}
                    </td>
                    <td className={`py-3 px-4 text-right font-medium ${
                      change > 0 ? 'text-emerald-600' : change < 0 ? 'text-red-600' : 'text-slate-600'
                    }`}>
                      {formatCurrency(change, { showPlus: true })}
                    </td>
                    <td className={`py-3 px-4 text-right font-bold ${
                      isNegative 
                        ? 'text-red-600' 
                        : isBelowReserve 
                          ? 'text-amber-600' 
                          : 'text-slate-900'
                    }`}>
                      {formatCurrency(closing)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Přehled účtů */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
              <button
                type="button"
                onClick={() => setAccountViewMode('period')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                  accountViewMode === 'period' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                Podle období
              </button>
              <button
                type="button"
                onClick={() => setAccountViewMode('matrix')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                  accountViewMode === 'matrix' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                Matice účtů
              </button>
            </div>
          </div>
        </div>

        {/* 1. Režim: Přehled podle období */}
        {accountViewMode === 'period' && (
          <div className="divide-y divide-slate-100">
            {accountPeriods.map((p) => {
              const isExpanded = expandedPeriodKey === p.period.key;

              return (
                <div key={p.period.key} className="transition-colors">
                  <div
                    onClick={() => setExpandedPeriodKey(isExpanded ? null : p.period.key)}
                    className="p-4 flex flex-wrap items-center justify-between gap-2 cursor-pointer hover:bg-slate-50 select-none"
                  >
                    <div className="flex items-center gap-3">
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-slate-400" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-slate-400" />
                      )}
                      <div>
                        <span className="text-xs font-semibold text-slate-900">{p.period.name}</span>
                        <span className="text-xs text-slate-400 ml-2">({p.period.startDate} – {p.period.endDate})</span>
                      </div>
                    </div>
                    <div className="text-xs font-semibold text-slate-800">
                      Zůstatek celkem: {formatCurrency(p.closingBalanceInHaler)}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="px-4 pb-4 bg-slate-50/50 overflow-x-auto">
                      <table className="w-full text-xs text-left">
                        <thead>
                          <tr className="border-b border-slate-200 text-slate-400 font-semibold">
                            <th className="py-2">Účet</th>
                            <th className="py-2 text-right">Počáteční stav</th>
                            <th className="py-2 text-right text-emerald-600">Příjmy</th>
                            <th className="py-2 text-right text-red-600">Výdaje</th>
                            <th className="py-2 text-right text-sky-600">Převody</th>
                            <th className="py-2 text-right">Čistá změna</th>
                            <th className="py-2 text-right font-bold text-slate-900">Konečný stav</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {activeAccounts.map((acc) => {
                            const accBal = p.accountBalances[acc.id];
                            if (!accBal) return null;

                            // Pro investiční/penzijní účty konečný stav zahrnuje i změnu tržní hodnoty,
                            // kterou je nutné promítnout do pohybů, jinak počáteční + pohyby != konečný stav.
                            const valuationChangeInHaler = (acc.type === 'investment' || acc.type === 'pension')
                              ? subHaler(subHaler(accBal.closingBalanceInHaler, accBal.openingBalanceInHaler), subHaler(accBal.transfersInInHaler, accBal.transfersOutInHaler))
                              : 0;

                            const incoming = addHaler(accBal.incomeInHaler, accBal.correctionsInHaler > 0 ? accBal.correctionsInHaler : 0, valuationChangeInHaler > 0 ? valuationChangeInHaler : 0);
                            const outgoing = addHaler(accBal.expenseInHaler, accBal.correctionsInHaler < 0 ? Math.abs(accBal.correctionsInHaler) : 0, valuationChangeInHaler < 0 ? Math.abs(valuationChangeInHaler) : 0);
                            const netTransfers = subHaler(accBal.transfersInInHaler, accBal.transfersOutInHaler);
                            const netChange = subHaler(accBal.closingBalanceInHaler, accBal.openingBalanceInHaler);

                            return (
                              <tr key={acc.id} className="hover:bg-white/80">
                                <td className="py-2.5 font-medium text-slate-900 flex items-center gap-2">
                                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: acc.color }} />
                                  <span>{acc.name}</span>
                                  {acc.institution && <span className="text-slate-400 text-[10px]">({acc.institution})</span>}
                                </td>
                                <td className="py-2.5 text-right text-slate-600">
                                  {formatCurrency(accBal.openingBalanceInHaler)}
                                </td>
                                <td className="py-2.5 text-right font-medium text-emerald-600">
                                  {incoming > 0 ? `+${formatCurrency(incoming)}` : '0 Kč'}
                                </td>
                                <td className="py-2.5 text-right font-medium text-red-600">
                                  {outgoing > 0 ? `−${formatCurrency(outgoing)}` : '0 Kč'}
                                </td>
                                <td className={`py-2.5 text-right font-medium ${
                                  netTransfers > 0 ? 'text-emerald-600' : netTransfers < 0 ? 'text-red-600' : 'text-slate-500'
                                }`}>
                                  {formatCurrency(netTransfers, { showPlus: true })}
                                </td>
                                <td className={`py-2.5 text-right font-medium ${
                                  netChange > 0 ? 'text-emerald-600' : netChange < 0 ? 'text-red-600' : 'text-slate-600'
                                }`}>
                                  {formatCurrency(netChange, { showPlus: true })}
                                </td>
                                <td className={`py-2.5 text-right font-bold ${
                                  accBal.closingBalanceInHaler < 0 ? 'text-red-600' : 'text-slate-900'
                                }`}>
                                  {formatCurrency(accBal.closingBalanceInHaler)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* 2. Režim: Matice účtů (řádky = účty, sloupce = jednotlivá období) */}
        {accountViewMode === 'matrix' && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left whitespace-nowrap">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold">
                  <th className="py-3 px-4 sticky left-0 bg-slate-50 shadow-[1px_0_0_0_#e2e8f0] z-20">Účet</th>
                  {accountPeriods.map((p) => (
                    <th
                      key={p.period.key}
                      onClick={() => handlePeriodClick(p.period)}
                      className="py-2.5 px-3 text-right min-w-[125px] cursor-pointer hover:bg-slate-100/80 transition-colors"
                      title={`Přejít do rozpočtu: ${p.period.name}`}
                    >
                      <span className="block text-slate-700 font-bold hover:text-sky-700">
                        {p.period.name.split(' ')[0]} '{p.period.year.toString().slice(-2)}
                      </span>
                      <span className="text-[10px] text-slate-400 font-normal block">
                        {p.period.startDate.slice(5)} – {p.period.endDate.slice(5)}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {activeAccounts.map((acc) => (
                  <tr key={acc.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-2.5 px-4 font-semibold text-slate-900 sticky left-0 bg-white shadow-[1px_0_0_0_#e2e8f0] z-10">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: acc.color }} />
                        <div className="min-w-0">
                          <span className="truncate max-w-[140px] block text-xs font-semibold text-slate-900">{acc.name}</span>
                          {acc.institution && (
                            <span className="text-[10px] text-slate-400 truncate block font-normal leading-tight">{acc.institution}</span>
                          )}
                        </div>
                      </div>
                    </td>
                    {accountPeriods.map((p) => {
                      const accBal = p.accountBalances[acc.id];
                      const opening = accBal?.openingBalanceInHaler || 0;
                      const closing = accBal?.closingBalanceInHaler || 0;

                      const isOpeningNegative = opening < 0;
                      const isClosingNegative = closing < 0;
                      const isClosingBelowReserve = acc.isUsableCash && closing < overdraftLimit && closing >= 0;

                      return (
                        <td
                          key={p.period.key}
                          className={`py-2 px-3 text-right ${
                            isClosingNegative ? 'bg-red-50/30' : ''
                          }`}
                        >
                          <div className="flex flex-col items-end gap-0.5">
                            {/* Počáteční stav */}
                            <div className="flex items-center justify-end gap-1.5 leading-tight">
                              <span
                                title="P – počáteční stav"
                                className="text-[10px] font-medium text-slate-400 select-none uppercase tracking-wider cursor-help"
                              >
                                P
                              </span>
                              <span
                                className={`text-[11px] font-normal whitespace-nowrap ${
                                  isOpeningNegative ? 'text-red-500 font-medium' : 'text-slate-500'
                                }`}
                              >
                                {formatCurrency(opening)}
                              </span>
                            </div>

                            {/* Konečný stav */}
                            <div className="flex items-center justify-end gap-1.5 leading-tight">
                              <span
                                title="K – konečný stav"
                                className={`text-[10px] font-bold select-none uppercase tracking-wider cursor-help ${
                                  isClosingNegative
                                    ? 'text-red-600'
                                    : isClosingBelowReserve
                                      ? 'text-amber-600'
                                      : 'text-slate-600'
                                }`}
                              >
                                K
                              </span>
                              <span
                                className={`text-xs font-bold whitespace-nowrap ${
                                  isClosingNegative
                                    ? 'text-red-600'
                                    : isClosingBelowReserve
                                      ? 'text-amber-600'
                                      : 'text-slate-900'
                                }`}
                              >
                                {formatCurrency(closing)}
                              </span>
                            </div>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-slate-200 bg-slate-50/90 font-semibold">
                <tr>
                  <td className="py-3 px-4 text-slate-900 sticky left-0 bg-slate-50 shadow-[1px_0_0_0_#e2e8f0] z-10">
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-slate-900">Celkový majetek</span>
                      <span className="text-[10px] font-normal text-slate-400">Zahrnuté účty</span>
                    </div>
                  </td>
                  {accountPeriods.map((p) => {
                    const totalOpening = p.netWorthOpeningInHaler;
                    const totalClosing = p.netWorthClosingInHaler;
                    const isOpeningNegative = totalOpening < 0;
                    const isClosingNegative = totalClosing < 0;
                    const isClosingBelowReserve = totalClosing < overdraftLimit && totalClosing >= 0;

                    return (
                      <td key={p.period.key} className="py-2.5 px-3 text-right">
                        <div className="flex flex-col items-end gap-0.5">
                          <div className="flex items-center justify-end gap-1.5 leading-tight">
                            <span
                              title="P – počáteční stav"
                              className="text-[10px] font-semibold text-slate-400 select-none uppercase tracking-wider cursor-help"
                            >
                              P
                            </span>
                            <span
                              className={`text-[11px] font-medium whitespace-nowrap ${
                                isOpeningNegative ? 'text-red-500' : 'text-slate-600'
                              }`}
                            >
                              {formatCurrency(totalOpening)}
                            </span>
                          </div>
                          <div className="flex items-center justify-end gap-1.5 leading-tight">
                            <span
                              title="K – konečný stav"
                              className={`text-[10px] font-bold select-none uppercase tracking-wider cursor-help ${
                                isClosingNegative ? 'text-red-600' : isClosingBelowReserve ? 'text-amber-600' : 'text-slate-600'
                              }`}
                            >
                              K
                            </span>
                            <span
                              className={`text-xs font-bold whitespace-nowrap ${
                                isClosingNegative
                                  ? 'text-red-600'
                                  : isClosingBelowReserve
                                    ? 'text-amber-600'
                                    : 'text-slate-900'
                              }`}
                            >
                              {formatCurrency(totalClosing)}
                            </span>
                          </div>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
