import React, { useState, useEffect, useMemo, useId } from 'react';
import { useFinance } from '../../context/FinanceContext';
import { Modal, ModalFooter } from '../common/Modal';
import { Account, MarketValueSnapshot } from '../../types/finance';
import { getFeesUpToDate, getInvestedAmountAtValuation } from '../../services/investmentPerformanceService';
import { formatCurrency, formatPercent, parseInputToHaler, subHaler } from '../../services/currencyService';
import { getTodayInPrague, formatCzechDate } from '../../services/periodService';
import { Info } from 'lucide-react';
import { FieldError, FieldErrors, fieldStateClass, fieldErrorProps, focusFirstInvalid } from '../common/FieldError';

interface MarketValueModalProps {
  isOpen: boolean;
  onClose: () => void;
  account: Account | null;
  snapshot?: MarketValueSnapshot | null;
}

export const MarketValueModal: React.FC<MarketValueModalProps> = ({
  isOpen,
  onClose,
  account,
  snapshot,
}) => {
  const fieldId = useId();
  const { transactions, investmentFees = [], settings, updateMarketValue, editMarketValue } = useFinance();
  const [marketValueStr, setMarketValueStr] = useState('');
  const [valuationDate, setValuationDate] = useState(() => getTodayInPrague());
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<FieldErrors<'date' | 'value'>>({});

  useEffect(() => {
    setErrors({});
    if (account && isOpen) {
      const val = snapshot?.marketValueInHaler ?? account.currentMarketValueInHaler ?? account.initialBalanceInHaler;
      setMarketValueStr((val / 100).toString());
      const today = getTodayInPrague();
      const initialDate = account.initialBalanceDate && today < account.initialBalanceDate
        ? account.initialBalanceDate
        : today;
      setValuationDate(snapshot?.date ?? initialDate);
      setNote(snapshot?.note ?? '');
      setIsSubmitting(false);
    }
  }, [account, isOpen, snapshot]);

  const enteredValHaler = parseInputToHaler(marketValueStr);

  const { investedHaler, feesHaler } = useMemo(() => {
    if (!account) return { investedHaler: 0, feesHaler: 0 };
    return {
      investedHaler: getInvestedAmountAtValuation(account, transactions, valuationDate),
      feesHaler: getFeesUpToDate(investmentFees, account.id, valuationDate, settings.budgetStartDay),
    };
  }, [account, transactions, investmentFees, valuationDate, settings.budgetStartDay]);

  const returnBaseHaler = subHaler(investedHaler, feesHaler);
  const gainLossHaler = subHaler(enteredValHaler, returnBaseHaler);
  const gainLossPct = returnBaseHaler !== 0 ? (gainLossHaler / returnBaseHaler) * 100 : 0;

  if (!account) return null;

  const isPension = account.type === 'pension';
  const accountTypeLabel = isPension ? 'penzijní' : 'investiční';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    const nextErrors: FieldErrors<'date' | 'value'> = {};
    if (account.initialBalanceDate && valuationDate < account.initialBalanceDate) {
      nextErrors.date = `Tento účet je aktivní až od ${formatCzechDate(account.initialBalanceDate)}. Zvolte stejné nebo pozdější datum.`;
    }
    if (!marketValueStr.trim() || !Number.isSafeInteger(enteredValHaler)) {
      nextErrors.value = 'Zadejte tržní hodnotu jako číslo, např. 125000.';
    }
    setErrors(nextErrors);
    if (nextErrors.date || nextErrors.value) {
      focusFirstInvalid(nextErrors, [['date', `${fieldId}-1`], ['value', `${fieldId}-2`]]);
      return;
    }
    setIsSubmitting(true);
    try {
      if (snapshot) {
        editMarketValue(snapshot.id, { date: valuationDate, marketValueInHaler: enteredValHaler,
          note: note.trim() || undefined });
      } else {
        updateMarketValue(account.id, enteredValHaler, valuationDate, note);
      }
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`${snapshot ? 'Upravit tržní hodnotu' : 'Zadat tržní hodnotu'}: ${account.name}`}
      subtitle={`Kolik má ${accountTypeLabel} účet k danému dni hodnotu`}
      maxWidth="max-w-md"
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">Vklady</span>
            <span className="font-semibold text-slate-900">{formatCurrency(investedHaler)}</span>
          </div>
          {feesHaler !== 0 && (
            <div className="flex justify-between">
              <span className="text-slate-500">Poplatky</span>
              <span className="font-semibold text-slate-900">{formatCurrency(-feesHaler)}</span>
            </div>
          )}
          {feesHaler !== 0 && (
            <div className="flex justify-between">
              <span className="text-slate-500">Vklady po odečtení poplatků</span>
              <span className="font-semibold text-slate-900">{formatCurrency(returnBaseHaler)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-slate-500">Výnos při této hodnotě</span>
            <span className={`font-bold ${gainLossHaler >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {`${formatCurrency(gainLossHaler, { showPlus: true })} (${formatPercent(gainLossPct, { showPlus: true })})`}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${fieldId}-1`} className="block text-xs font-semibold text-slate-500 mb-1">
              Ke dni *
            </label>
            <input id={`${fieldId}-1`}
              type="date"
              required
              min={account.initialBalanceDate}
              value={valuationDate}
              onChange={(e) => { setValuationDate(e.target.value); setErrors(prev => ({ ...prev, date: undefined })); }}
              {...fieldErrorProps(`${fieldId}-1`, errors.date)}
              className={`w-full px-3.5 py-2 text-sm bg-white border rounded-xl focus:outline-none ${fieldStateClass(errors.date, 'border-slate-200 focus:ring-2 focus:ring-sky-500')}`}
            />
            <FieldError inputId={`${fieldId}-1`} message={errors.date} />
          </div>

          <div>
            <label htmlFor={`${fieldId}-2`} className="block text-xs font-semibold text-slate-500 mb-1">
              Tržní hodnota *
            </label>
            <div className="relative">
              <input id={`${fieldId}-2`}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                required
                value={marketValueStr}
                onChange={(e) => { setMarketValueStr(e.target.value); setErrors(prev => ({ ...prev, value: undefined })); }}
                {...fieldErrorProps(`${fieldId}-2`, errors.value)}
                className={`w-full pl-3.5 pr-10 py-2 text-sm bg-white border rounded-xl focus:outline-none ${fieldStateClass(errors.value, 'border-slate-200 focus:ring-2 focus:ring-sky-500')} font-semibold`}
              />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-xs font-semibold text-slate-500">Kč</span>
            </div>
            <FieldError inputId={`${fieldId}-2`} message={errors.value} />
          </div>
        </div>

        <div>
          <label htmlFor={`${fieldId}-3`} className="block text-xs font-semibold text-slate-500 mb-1">
            Poznámka (nepovinné)
          </label>
          <input id={`${fieldId}-3`}
            type="text"
            placeholder="např. Výpis z penzijní společnosti k 30. 9."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>

        <div className="flex items-start gap-2 p-4 bg-purple-50 border border-purple-100 rounded-xl text-xs text-purple-900">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Změna tržní hodnoty není příjem ani výdaj. Rozpočet ani použitelné peníze nemění, jen hodnotu tohoto účtu a celkový majetek.
          </span>
        </div>

        <ModalFooter>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm font-semibold text-slate-500 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 disabled:opacity-50"
          >
            Zrušit
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-5 py-2 text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-xl shadow-sm disabled:opacity-50"
          >
            {isSubmitting ? 'Ukládám…' : 'Uložit tržní hodnotu'}
          </button>
        </ModalFooter>
      </form>
    </Modal>
  );
};
