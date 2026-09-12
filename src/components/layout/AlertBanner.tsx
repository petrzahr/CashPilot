import React from 'react';
import { useFinance } from '../../context/FinanceContext';
import { formatCurrency } from '../../services/currencyService';
import { AlertTriangle, ShieldAlert } from 'lucide-react';

export const AlertBanner: React.FC = () => {
  const { forecast, settings, setSelectedPeriod } = useFinance();

  const earliestShortage = forecast.earliestShortagePeriod;
  if (!earliestShortage) return null;

  const shortageSummary = forecast.periods.find(p => p.period.key === earliestShortage.key);
  const closing = shortageSummary ? shortageSummary.usableClosingInHaler : 0;
  const isNegative = closing < 0;

  return (
    <div className="mx-4 sm:mx-6 mt-4 p-3.5 rounded-2xl border bg-amber-50/90 border-amber-200/80 text-amber-900 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <div className="p-1.5 rounded-lg bg-amber-100 text-amber-700 shrink-0">
          <AlertTriangle className="w-4 h-4" />
        </div>
        <div className="text-xs">
          <span className="font-bold">
            {isNegative ? 'Varování – Hrozí záporný zůstatek:' : 'Upozornění – Pokles pod minimální rezervu:'}
          </span>{' '}
          V období <strong>{earliestShortage.name}</strong> klesnou použitelné peníze na{' '}
          <strong className={isNegative ? 'text-red-700' : 'text-amber-800'}>
            {formatCurrency(closing)}
          </strong>{' '}
          (nastavená rezerva je {formatCurrency(settings.minReserveInHaler)}).
        </div>
      </div>

      <button
        onClick={() => setSelectedPeriod(earliestShortage)}
        className="self-start sm:self-auto px-3 py-1.5 text-xs font-bold text-amber-800 bg-amber-100/80 hover:bg-amber-200 rounded-xl transition-colors shrink-0"
      >
        Zobrazit {earliestShortage.name}
      </button>
    </div>
  );
};
