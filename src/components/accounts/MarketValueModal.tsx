import React, { useState, useEffect, useMemo } from 'react';
import { useFinance } from '../../context/FinanceContext';
import { Modal } from '../common/Modal';
import { Account } from '../../types/finance';
import { getInvestedAmountAtValuation } from '../../services/investmentPerformanceService';
import { formatCurrency, halerToInputValue, parseInputToHaler, subHaler } from '../../services/currencyService';
import { getTodayInPrague, formatCzechDate } from '../../services/periodService';
import { TrendingUp, Info } from 'lucide-react';

interface MarketValueModalProps {
  isOpen: boolean;
  onClose: () => void;
  account: Account | null;
}

export const MarketValueModal: React.FC<MarketValueModalProps> = ({
  isOpen,
  onClose,
  account,
}) => {
  const { transactions, updateMarketValue } = useFinance();
  const [marketValueStr, setMarketValueStr] = useState('');
  const [adjustmentStr, setAdjustmentStr] = useState('');
  const [valuationDate, setValuationDate] = useState(() => getTodayInPrague());
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (account && isOpen) {
      const val = account.currentMarketValueInHaler || account.initialBalanceInHaler;
      setMarketValueStr((val / 100).toString());
      setAdjustmentStr(halerToInputValue(account.investedAmountAdjustmentInHaler ?? 0));
      const today = getTodayInPrague();
      const initialDate = account.initialBalanceDate && today < account.initialBalanceDate
        ? account.initialBalanceDate
        : today;
      setValuationDate(initialDate);
      setNote('');
      setIsSubmitting(false);
    }
  }, [account, isOpen]);

  const enteredValHaler = parseInputToHaler(marketValueStr);
  const adjustmentInHaler = parseInputToHaler(adjustmentStr);

  const investedHaler = useMemo(() => {
    if (!account) return 0;
    return getInvestedAmountAtValuation(
      { ...account, investedAmountAdjustmentInHaler: adjustmentInHaler }, transactions, valuationDate,
    );
  }, [account, transactions, adjustmentInHaler, valuationDate]);

  const gainLossHaler = subHaler(enteredValHaler, investedHaler);
  const gainLossPct = investedHaler !== 0 ? (gainLossHaler / investedHaler) * 100 : 0;

  if (!account) return null;

  const isPension = account.type === 'pension';
  const accountTypeLabel = isPension ? 'penzijního' : 'investičního';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!Number.isSafeInteger(adjustmentInHaler)) {
      alert('Zadejte platnou částku korekce.');
      return;
    }
    if (account.initialBalanceDate && valuationDate < account.initialBalanceDate) {
      alert(`Tento účet je aktivní až od ${formatCzechDate(account.initialBalanceDate)}. Zvolte stejné nebo pozdější datum.`);
      return;
    }
    setIsSubmitting(true);
    try {
      updateMarketValue(account.id, enteredValHaler, valuationDate, note,
        adjustmentInHaler === (account.investedAmountAdjustmentInHaler ?? 0) ? undefined : adjustmentInHaler);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Aktualizovat tržní hodnotu: ${account.name}`}
      subtitle={`Ocenění ${accountTypeLabel} účtu`}
      maxWidth="max-w-md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">Vložené prostředky:</span>
            <span className="font-semibold text-slate-800">{formatCurrency(investedHaler)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Nerealizovaný výnos / ztráta:</span>
            <span className={`font-bold ${gainLossHaler >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {formatCurrency(gainLossHaler, { showPlus: true })} ({gainLossPct >= 0 ? '+' : ''}{gainLossPct.toFixed(1)} %)
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Datum ocenění *
            </label>
            <input
              type="date"
              required
              min={account.initialBalanceDate}
              value={valuationDate}
              onChange={(e) => setValuationDate(e.target.value)}
              className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Aktuální tržní hodnota (Kč) *
            </label>
            <div className="relative">
              <input
                type="number"
                step="any"
                required
                value={marketValueStr}
                onChange={(e) => setMarketValueStr(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 font-semibold"
              />
              <span className="absolute right-3.5 top-2 text-xs font-semibold text-slate-400">Kč</span>
            </div>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Korekce vložené částky ({account.currency})
          </label>
          <input
            type="number"
            step="0.01"
            placeholder="0"
            value={adjustmentStr}
            onChange={(e) => setAdjustmentStr(e.target.value)}
            className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
          <p className="mt-1 text-xs text-slate-500">
            Kladná částka zvýší a záporná sníží vložený kapitál pro výpočet výnosu.
            Nemění tržní hodnotu ani platby. Vymazáním nebo zadáním 0 korekci zrušíte.
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Poznámka (např. zdroj ocenění)
          </label>
          <input
            type="text"
            placeholder="např. Výpis z penzijní společnosti k 30. 9."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>

        <div className="flex items-start gap-2 p-3 bg-purple-50/70 border border-purple-100 rounded-xl text-xs text-purple-900">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Změna tržní hodnoty majetkového účtu není příjem ani výdaj a neovlivňuje provozní rozpočet ani použitelné peníze. Ovlivňuje pouze hodnotu tohoto účtu a celkový čistý majetek.
          </span>
        </div>

        <div className="mt-5 flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 disabled:opacity-50"
          >
            Zrušit
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-5 py-2 text-sm font-semibold text-white bg-purple-600 hover:bg-purple-700 rounded-xl shadow-sm shadow-purple-200 disabled:opacity-50"
          >
            {isSubmitting ? 'Ukládám...' : 'Uložit hodnotu'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
