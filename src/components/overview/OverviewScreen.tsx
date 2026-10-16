import React, { useState, useMemo, useEffect } from 'react';
import { useFinance } from '../../context/FinanceContext';
import { formatCurrency } from '../../services/currencyService';
import { getOverviewPeriods, OverviewRange } from '../../services/periodService';
import { getAccountPeriodSummary } from '../../services/accountSummaryService';
import { addHaler, subHaler } from '../../services/currencyService';
import { DualPeriodFilterPanel } from '../shared/DualPeriodFilterPanel';
import { DualPeriodRange, resolveAnalyticsDateRange } from '../../services/analyticsEngine';
import { createBudgetPeriod, generatePeriodsBetween, getTodayInPrague } from '../../services/periodService';
import { BudgetPeriod } from '../../types/finance';
import {
  ChevronRight,
  ChevronDown
} from 'lucide-react';

interface OverviewScreenProps {
  onNavigateToBudget: (period: BudgetPeriod) => void;
}

export const OverviewScreen: React.FC<OverviewScreenProps> = ({ onNavigateToBudget }) => {
  const { forecast, settings, accounts, setSelectedPeriod, setOverviewPeriodBounds, transactions = [], corrections = [], marketValueSnapshots = [] } = useFinance();
  const [range, setRange] = useState<DualPeriodRange>({ direction: 'future', months: 12 });
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

  const displayPeriods = useMemo(() => selectedPeriods.flatMap(period => {
    const summary = getAccountPeriodSummary(forecast, period.key);
    return summary ? [summary] : [];
  }), [forecast, selectedPeriods]);

  const accountPeriods = displayPeriods;

  // Režimy zobrazení hlavní forecast tabulky
  const [forecastScope, setForecastScope] = useState<'usable' | 'all'>('usable');

  // Režimy zobrazení přehledu účtů
  const [accountViewMode, setAccountViewMode] = useState<'period' | 'matrix'>('period');
  const [expandedPeriodKey, setExpandedPeriodKey] = useState<string | null>(null);

  const activeAccounts = accounts.filter(a => a.status === 'active');

  const handlePeriodClick = (p: BudgetPeriod) => {
    setSelectedPeriod(p);
    onNavigateToBudget(p);
  };

  return (
    <div className="space-y-6">
      <DualPeriodFilterPanel
        range={range}
        onRangeChange={setRange}
        periods={selectedPeriods}
        currentPeriodKey={forecast.currentPeriod.key}
        ariaLabel="Období přehledů"
      />
      {/* Hlavní tabulka forecastu */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-slate-900">Vývoj zůstatků po obdobích</h2>
          {/* Přepínač: Použitelné peníze vs Všechny účty */}
          <div role="group" aria-label="Zobrazit zůstatky" className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
            <button
              type="button"
              onClick={() => setForecastScope('usable')}
              aria-pressed={forecastScope === 'usable'}
              className={`max-md:min-h-11 min-w-[132px] px-3 py-1.5 text-xs font-semibold rounded-lg transition-all text-center ${
                forecastScope === 'usable'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              Použitelné peníze
            </button>
            <button
              type="button"
              onClick={() => setForecastScope('all')}
              aria-pressed={forecastScope === 'all'}
              className={`max-md:min-h-11 min-w-[132px] px-3 py-1.5 text-xs font-semibold rounded-lg transition-all text-center ${
                forecastScope === 'all'
                  ? 'bg-white text-purple-600 shadow-sm'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              Celkový majetek
            </button>
          </div>
        </div>

        {/* Tabulka */}
        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-left text-xs whitespace-nowrap">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500">
                {/* První sloupec je připnutý, aby při posouvání do strany zůstal vidět název období */}
                <th className="sticky left-0 z-[1] bg-slate-50 py-2.5 px-4 max-sm:px-3 w-[112px] sm:w-[200px]">Období</th>
                <th className="py-2.5 px-4 w-[140px] text-right">Počáteční stav</th>
                <th className="py-2.5 px-4 w-[120px] text-right text-emerald-600">Příjmy</th>
                <th className="py-2.5 px-4 w-[120px] text-right text-red-600">Výdaje</th>
                <th className="py-2.5 px-4 w-[120px] text-right">Převody</th>
                <th className="py-2.5 px-4 w-[130px] text-right">Čistá změna</th>
                <th className="py-2.5 px-4 w-[140px] text-right">Konečný stav</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {displayPeriods.map((p) => {
                const isCurrent = p.period.key === forecast.currentPeriod.key;
                
                const opening = forecastScope === 'usable' ? p.usableOpeningInHaler : p.openingBalanceInHaler;
                const closing = forecastScope === 'usable' ? p.usableClosingInHaler : p.closingBalanceInHaler;
                const change = forecastScope === 'usable' ? p.usableNetChangeInHaler : p.netChangeInHaler;

                // Příjmy, výdaje a čisté převody jen z účtů zvoleného pohledu, aby řádek seděl na Čistou změnu
                let scopeIncome = 0;
                let scopeExpense = 0;
                let scopeTransfers = 0;
                for (const [accountId, bal] of Object.entries(p.accountBalances)) {
                  if (forecastScope === 'usable' && !accounts.find(a => a.id === accountId)?.isUsableCash) continue;
                  scopeIncome = addHaler(scopeIncome, bal.incomeInHaler);
                  scopeExpense = addHaler(scopeExpense, bal.expenseInHaler);
                  scopeTransfers = addHaler(scopeTransfers, subHaler(bal.transfersInInHaler, bal.transfersOutInHaler));
                }

                const isNegative = closing < 0;

                return (
                  <tr
                    key={p.period.key}
                    onClick={() => handlePeriodClick(p.period)}
                    className={`cursor-pointer transition-colors group ${
                      isCurrent ? 'bg-sky-50 hover:bg-sky-100' : 'bg-white hover:bg-slate-50'
                    }`}
                  >
                    <td className={`sticky left-0 z-[1] py-3 px-4 max-sm:px-3 max-sm:whitespace-normal font-semibold text-slate-900 transition-colors ${
                      isCurrent ? 'bg-sky-50 group-hover:bg-sky-100' : 'bg-white group-hover:bg-slate-50'
                    }`}>
                      {/* Řádek je klikací myší; klávesnice a čtečky dostávají skutečné tlačítko */}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handlePeriodClick(p.period); }}
                        aria-label={`Přejít do rozpočtu: ${p.period.name}`}
                        className="text-left rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 group-hover:text-sky-700"
                      >
                        {p.period.name}
                      </button>
                      {isCurrent && (
                        <span className="ml-2 max-sm:ml-0 max-sm:mt-1 chip bg-sky-50 text-sky-700">
                          Aktuální
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 w-[140px] text-right text-slate-500 font-medium">
                      {formatCurrency(opening)}
                    </td>
                    <td className="py-3 px-4 w-[120px] text-right font-semibold text-emerald-600">
                      {scopeIncome > 0 ? `+${formatCurrency(scopeIncome)}` : '0 Kč'}
                    </td>
                    <td className="py-3 px-4 w-[120px] text-right font-semibold text-red-600">
                      {scopeExpense > 0 ? `−${formatCurrency(scopeExpense)}` : '0 Kč'}
                    </td>
                    <td className={`py-3 px-4 w-[120px] text-right font-semibold ${
                      scopeTransfers > 0 ? 'text-emerald-600' : scopeTransfers < 0 ? 'text-red-600' : 'text-slate-500'
                    }`}>
                      {formatCurrency(scopeTransfers, { showPlus: true })}
                    </td>
                    <td className={`py-3 px-4 w-[130px] text-right font-medium ${
                      change > 0 ? 'text-emerald-600' : change < 0 ? 'text-red-600' : 'text-slate-500'
                    }`}>
                      {formatCurrency(change, { showPlus: true })}
                    </td>
                    <td className={`py-3 px-4 w-[140px] text-right font-bold ${
                      isNegative ? 'text-red-600' : 'text-slate-900'
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
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-slate-900">Účty</h2>
          <div className="flex items-center gap-2">
            <div role="group" aria-label="Zobrazení účtů" className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
              <button
                type="button"
                onClick={() => setAccountViewMode('period')}
                aria-pressed={accountViewMode === 'period'}
                className={`max-md:min-h-11 min-w-[132px] px-3 py-1.5 text-xs font-semibold rounded-lg transition-all text-center ${
                  accountViewMode === 'period' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                Podle období
              </button>
              <button
                type="button"
                onClick={() => setAccountViewMode('matrix')}
                aria-pressed={accountViewMode === 'matrix'}
                className={`max-md:min-h-11 min-w-[132px] px-3 py-1.5 text-xs font-semibold rounded-lg transition-all text-center ${
                  accountViewMode === 'matrix' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
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
                  <button
                    type="button"
                    onClick={() => setExpandedPeriodKey(isExpanded ? null : p.period.key)}
                    aria-expanded={isExpanded}
                    className="w-full text-left p-4 flex flex-wrap items-center justify-between gap-2 cursor-pointer hover:bg-slate-50 select-none focus:outline-none focus-visible:bg-slate-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500/40"
                  >
                    <span className="flex items-center gap-3">
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-slate-500" aria-hidden="true" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-slate-500" aria-hidden="true" />
                      )}
                      <span className="text-xs font-semibold text-slate-900">{p.period.name}</span>
                    </span>
                    <span className="text-xs font-semibold text-slate-900">
                      Zůstatek celkem: {formatCurrency(p.closingBalanceInHaler)}
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="pb-4 bg-slate-50 overflow-x-auto">
                      <table className="w-full table-fixed text-xs text-left">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500">
                            <th className="sticky left-0 z-[1] bg-slate-50 py-2.5 px-4 max-sm:px-3 w-[112px] sm:w-[200px]">Účet</th>
                            <th className="py-2.5 px-4 w-[140px] text-right">Počáteční stav</th>
                            {/* U účtů se do pohybů počítají i korekce a změny tržní hodnoty, proto jiné názvy než Příjmy/Výdaje */}
                            <th className="py-2.5 px-4 w-[120px] text-right text-emerald-600" title="Příjmy, kladné korekce zůstatku a růst tržní hodnoty">Přírůstky</th>
                            <th className="py-2.5 px-4 w-[120px] text-right text-red-600" title="Výdaje, záporné korekce zůstatku a pokles tržní hodnoty">Úbytky</th>
                            <th className="py-2.5 px-4 w-[120px] text-right">Převody</th>
                            <th className="py-2.5 px-4 w-[130px] text-right">Čistá změna</th>
                            <th className="py-2.5 px-4 w-[140px] text-right">Konečný stav</th>
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
                              <tr key={acc.id} className="group hover:bg-white">
                                <td className="sticky left-0 z-[1] bg-slate-50 group-hover:bg-white py-2.5 px-4 max-sm:px-3 max-sm:whitespace-normal font-medium text-slate-900">
                                  <div className="flex items-center max-sm:items-start max-sm:flex-wrap gap-x-2">
                                    <span className="w-2.5 h-2.5 rounded-full shrink-0 max-sm:mt-1" style={{ backgroundColor: acc.color }} />
                                    <span>{acc.name}</span>
                                    {acc.institution && <span className="text-slate-500 text-xs">({acc.institution})</span>}
                                  </div>
                                </td>
                                <td className="py-2.5 px-4 w-[140px] text-right text-slate-500 font-medium">
                                  {formatCurrency(accBal.openingBalanceInHaler)}
                                </td>
                                <td className="py-2.5 px-4 w-[120px] text-right font-semibold text-emerald-600">
                                  {incoming > 0 ? `+${formatCurrency(incoming)}` : '0 Kč'}
                                </td>
                                <td className="py-2.5 px-4 w-[120px] text-right font-semibold text-red-600">
                                  {outgoing > 0 ? `−${formatCurrency(outgoing)}` : '0 Kč'}
                                </td>
                                <td className={`py-2.5 px-4 w-[120px] text-right font-semibold ${
                                  netTransfers > 0 ? 'text-emerald-600' : netTransfers < 0 ? 'text-red-600' : 'text-slate-500'
                                }`}>
                                  {formatCurrency(netTransfers, { showPlus: true })}
                                </td>
                                <td className={`py-2.5 px-4 w-[130px] text-right font-medium ${
                                  netChange > 0 ? 'text-emerald-600' : netChange < 0 ? 'text-red-600' : 'text-slate-500'
                                }`}>
                                  {formatCurrency(netChange, { showPlus: true })}
                                </td>
                                <td className={`py-2.5 px-4 w-[140px] text-right font-bold ${
                                  accBal.closingBalanceInHaler < 0 ? 'text-red-600' : 'text-slate-900'
                                }`}>
                                  {formatCurrency(accBal.closingBalanceInHaler)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      <p className="px-4 pt-2 text-xs text-slate-500">
                        Přírůstky a úbytky zahrnují kromě příjmů a výdajů i korekce zůstatku a změny tržní hodnoty. Převody jsou čisté (příchozí − odchozí).
                      </p>
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
                  <th className="py-2.5 px-4 sticky left-0 bg-slate-50 shadow-[1px_0_0_0_rgb(var(--c-slate-200))] z-20">Účet</th>
                  {accountPeriods.map((p) => (
                    <th
                      key={p.period.key}
                      className="p-0 text-right min-w-[125px] hover:bg-slate-100 transition-colors"
                    >
                      <button
                        type="button"
                        onClick={() => handlePeriodClick(p.period)}
                        title={`Přejít do rozpočtu: ${p.period.name}`}
                        aria-label={`Přejít do rozpočtu: ${p.period.name}`}
                        className="w-full py-2.5 px-3 text-right text-slate-500 font-bold hover:text-sky-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500/40"
                      >
                        {p.period.name.split(' ')[0]} '{p.period.year.toString().slice(-2)}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {activeAccounts.map((acc) => (
                  <tr key={acc.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2.5 px-4 font-semibold text-slate-900 sticky left-0 bg-white shadow-[1px_0_0_0_rgb(var(--c-slate-200))] z-10">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: acc.color }} />
                        <div className="min-w-0">
                          <span className="truncate max-w-[140px] block text-xs font-semibold text-slate-900">{acc.name}</span>
                          {acc.institution && (
                            <span className="text-xs text-slate-500 truncate block font-normal leading-tight">{acc.institution}</span>
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
                                className="text-xs font-medium text-slate-500 select-none uppercase tracking-wider cursor-help"
                              >
                                P
                              </span>
                              <span
                                className={`text-xs font-normal whitespace-nowrap ${
                                  isOpeningNegative ? 'text-red-600 font-medium' : 'text-slate-500'
                                }`}
                              >
                                {formatCurrency(opening)}
                              </span>
                            </div>

                            {/* Konečný stav */}
                            <div className="flex items-center justify-end gap-1.5 leading-tight">
                              <span
                                title="K – konečný stav"
                                className={`text-xs font-bold select-none uppercase tracking-wider cursor-help ${
                                  isClosingNegative ? 'text-red-600' : 'text-slate-500'
                                }`}
                              >
                                K
                              </span>
                              <span
                                className={`text-xs font-bold whitespace-nowrap ${
                                  isClosingNegative ? 'text-red-600' : 'text-slate-900'
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
              <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                <tr>
                  <td className="py-3 px-4 text-slate-900 sticky left-0 bg-slate-50 shadow-[1px_0_0_0_rgb(var(--c-slate-200))] z-10">
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-slate-900">Celkový majetek</span>
                      <span className="text-xs font-normal text-slate-500">Zahrnuté účty</span>
                    </div>
                  </td>
                  {accountPeriods.map((p) => {
                    const totalOpening = p.netWorthOpeningInHaler;
                    const totalClosing = p.netWorthClosingInHaler;
                    const isOpeningNegative = totalOpening < 0;
                    const isClosingNegative = totalClosing < 0;

                    return (
                      <td key={p.period.key} className="py-2.5 px-3 text-right">
                        <div className="flex flex-col items-end gap-0.5">
                          <div className="flex items-center justify-end gap-1.5 leading-tight">
                            <span
                              title="P – počáteční stav"
                              className="text-xs font-semibold text-slate-500 select-none uppercase tracking-wider cursor-help"
                            >
                              P
                            </span>
                            <span
                              className={`text-xs font-medium whitespace-nowrap ${
                                isOpeningNegative ? 'text-red-600' : 'text-slate-500'
                              }`}
                            >
                              {formatCurrency(totalOpening)}
                            </span>
                          </div>
                          <div className="flex items-center justify-end gap-1.5 leading-tight">
                            <span
                              title="K – konečný stav"
                              className={`text-xs font-bold select-none uppercase tracking-wider cursor-help ${
                                isClosingNegative ? 'text-red-600' : 'text-slate-500'
                              }`}
                            >
                              K
                            </span>
                            <span
                              className={`text-xs font-bold whitespace-nowrap ${
                                isClosingNegative ? 'text-red-600' : 'text-purple-600'
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
