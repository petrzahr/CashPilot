import { ForecastResult, PeriodSummary } from '../types/finance';

/** Use the shared projection for current/future periods, and historical data otherwise. */
export function getAccountPeriodSummary(forecast: ForecastResult, periodKey: string): PeriodSummary | undefined {
  return forecast.forecastPeriods?.find(summary => summary.period.key === periodKey)
    ?? forecast.periods.find(summary => summary.period.key === periodKey);
}
