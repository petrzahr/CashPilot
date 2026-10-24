import { useCallback, useMemo, useState } from 'react';
import { BudgetPeriod, PeriodRangeScreen } from '../types/finance';
import { buildForecastPeriods, calculateForecast, ForecastData } from '../services/financialEngine';
import type { DualPeriodRange } from '../services/periodRange';
import { SessionRange, rememberSessionRange, resolveSessionRange } from '../services/periodRangePreference';
import {
  createBudgetPeriod,
  getNextPeriod,
  getPeriodForDate,
  getPreviousPeriod,
  getTodayInPrague,
  normalizeStartDay,
} from '../services/periodService';

/**
 * Období a předpověď: dnešek, aktuální a vybrané období s navigací, rozsahy obrazovek
 * Majetek a Analýza (pamatované v rámci relace) a předpověď, která všechno z toho pokrývá.
 */
export function usePeriodForecast(data: ForecastData) {
  const [today, setToday] = useState<string>(() => getTodayInPrague());
  const startDay = normalizeStartDay(data.settings.budgetStartDay);

  const currentPeriod = useMemo(() => getPeriodForDate(today, startDay), [today, startDay]);

  // Vybrané období se pamatuje jako měsíc; hranice se odvodí z aktuálního dne začátku období
  const [selectedMonth, setSelectedMonth] = useState(() => ({ year: currentPeriod.year, month: currentPeriod.month }));
  const selectedPeriod = useMemo(
    () => createBudgetPeriod(selectedMonth.year, selectedMonth.month, startDay),
    [selectedMonth, startDay]
  );

  const setSelectedPeriod = useCallback((period: BudgetPeriod) => {
    setSelectedMonth({ year: period.year, month: period.month });
  }, []);
  const goToNextPeriod = useCallback(() => {
    setSelectedMonth(prev => {
      const next = getNextPeriod(createBudgetPeriod(prev.year, prev.month, startDay));
      return { year: next.year, month: next.month };
    });
  }, [startDay]);
  const goToPreviousPeriod = useCallback(() => {
    setSelectedMonth(prev => {
      const previous = getPreviousPeriod(createBudgetPeriod(prev.year, prev.month, startDay));
      return { year: previous.year, month: previous.month };
    });
  }, [startDay]);
  const goToCurrentPeriod = useCallback(() => {
    const liveToday = getTodayInPrague();
    setToday(liveToday);
    const liveCurrent = getPeriodForDate(liveToday, startDay);
    setSelectedMonth({ year: liveCurrent.year, month: liveCurrent.month });
  }, [startDay]);

  const isCurrentPeriodSelected = selectedPeriod.key === currentPeriod.key;

  const { accounts, transactions, recurringRules, recurringExceptions, corrections, settings, marketValueSnapshots, investmentFees } = data;

  const [sessionRanges, setSessionRanges] = useState<Partial<Record<PeriodRangeScreen, SessionRange>>>({});
  // Výchozí rozsah závisí jen na defaultPeriodRanges, ne na zbytku nastavení
  const defaultRanges = settings.defaultPeriodRanges;
  const periodRanges = useMemo<Record<PeriodRangeScreen, DualPeriodRange>>(() => ({
    overview: resolveSessionRange(sessionRanges.overview, settings, 'overview'),
    analytics: resolveSessionRange(sessionRanges.analytics, settings, 'analytics'),
  }), [sessionRanges, defaultRanges]);
  const setPeriodRange = useCallback((screen: PeriodRangeScreen, range: DualPeriodRange) => {
    setSessionRanges(prev => ({ ...prev, [screen]: rememberSessionRange(settings, screen, range) }));
  }, [settings]);

  // Přepnutí měsíce uvnitř pokrytého rozsahu nemá přepočítávat celou předpověď:
  // vybrané období se předpovědi předá, jen když leží mimo sekvenci bez něj.
  const dataDeps = [accounts, transactions, recurringRules, recurringExceptions, corrections, settings, marketValueSnapshots, investmentFees];
  const coveredPeriods = useMemo(
    () => buildForecastPeriods(data, { today, ranges: periodRanges }),
    [...dataDeps, today, periodRanges]
  );
  const selectedOutside = selectedPeriod.startDate < coveredPeriods[0].startDate
    || selectedPeriod.startDate > coveredPeriods[coveredPeriods.length - 1].startDate;
  const forecastSelection = selectedOutside ? selectedPeriod : undefined;

  const forecast = useMemo(
    () => calculateForecast(data, { today, ranges: periodRanges, selectedPeriod: forecastSelection }),
    [...dataDeps, today, periodRanges, forecastSelection]
  );

  const forecastSequence = useMemo(() => forecast.forecastPeriods?.map(p => p.period) ?? [], [forecast.forecastPeriods]);

  return {
    today,
    setToday,
    currentPeriod,
    selectedPeriod,
    setSelectedPeriod,
    goToNextPeriod,
    goToPreviousPeriod,
    goToCurrentPeriod,
    isCurrentPeriodSelected,
    periodRanges,
    setPeriodRange,
    forecast,
    forecastSequence,
  };
}
