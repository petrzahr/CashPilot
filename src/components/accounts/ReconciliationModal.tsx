import React, { useState, useEffect, useMemo, useId } from 'react';
import { useFinance } from '../../context/FinanceContext';
import { Modal, ModalFooter } from '../common/Modal';
import { Account } from '../../types/finance';
import { formatCurrency, parseInputToHaler, subHaler } from '../../services/currencyService';
import { getAccountBalanceAtDate } from '../../services/financialEngine';
import { getNextSequenceForDate } from '../../services/sequenceService';
import { getTodayInPrague, formatCzechDate } from '../../services/periodService';
import { CheckCircle, SlidersHorizontal } from 'lucide-react';
import { FieldError, FieldErrors, fieldStateClass, fieldErrorProps, focusFirstInvalid } from '../common/FieldError';

interface ReconciliationModalProps {
  isOpen: boolean;
  onClose: () => void;
  account: Account | null;
}

export const ReconciliationModal: React.FC<ReconciliationModalProps> = ({
  isOpen,
  onClose,
  account,
}) => {
  const fieldId = useId();
  const { transactions, corrections, accounts, reconcileBalance } = useFinance();
  const [actualBalanceStr, setActualBalanceStr] = useState('');
  const [checkDate, setCheckDate] = useState(() => getTodayInPrague());
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<FieldErrors<'balance' | 'date'>>({});

  // Vypočtený stav těsně před touto novou korekcí k zadanému datu kontroly a dalšímu pořadí
  const calculatedBalanceInHaler = useMemo(() => {
    if (!account) return 0;
    const nextSeq = getNextSequenceForDate(checkDate, transactions);
    return getAccountBalanceAtDate(
      account.id,
      checkDate,
      nextSeq,
      transactions,
      corrections,
      accounts
    );
  }, [account, checkDate, transactions, corrections, accounts]);

  const enteredActualHaler = parseInputToHaler(actualBalanceStr);
  const diffInHaler = subHaler(enteredActualHaler, calculatedBalanceInHaler);

  useEffect(() => {
    if (isOpen && account) {
      const today = getTodayInPrague();
      const initialDate = account.initialBalanceDate && today < account.initialBalanceDate
        ? account.initialBalanceDate
        : today;
      setCheckDate(initialDate);
      const nextSeq = getNextSequenceForDate(initialDate, transactions);
      const bal = getAccountBalanceAtDate(account.id, initialDate, nextSeq, transactions, corrections, accounts);
      setActualBalanceStr((bal / 100).toString());
      setNote('');
      setIsSubmitting(false);
      setErrors({});
    }
  }, [isOpen, account]);

  if (!account) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    const nextErrors: FieldErrors<'balance' | 'date'> = {};
    if (!actualBalanceStr.trim()) nextErrors.balance = 'Zadejte zůstatek podle banky.';
    if (account.initialBalanceDate && checkDate < account.initialBalanceDate) {
      nextErrors.date = `Tento účet je aktivní až od ${formatCzechDate(account.initialBalanceDate)}. Zvolte stejné nebo pozdější datum.`;
    }
    setErrors(nextErrors);
    if (nextErrors.balance || nextErrors.date) {
      focusFirstInvalid(nextErrors, [['balance', `${fieldId}-1`], ['date', `${fieldId}-2`]]);
      return;
    }
    setIsSubmitting(true);
    try {
      reconcileBalance(account.id, enteredActualHaler, checkDate, note);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Srovnat s bankou: ${account.name}`}
      subtitle="Zadejte zůstatek podle banky. Rozdíl se uloží jako korekce zůstatku."
      maxWidth="max-w-lg"
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
          <div className="flex justify-between items-center text-sm">
            <span className="text-slate-500">Zůstatek v CashPilotu</span>
            <span className="font-semibold text-slate-900">
              {formatCurrency(calculatedBalanceInHaler)}
            </span>
          </div>

          <div className="border-t border-slate-200 pt-2 flex justify-between items-center text-sm">
            <span className="text-slate-500">Zůstatek podle banky</span>
            <span className="font-semibold text-slate-900">
              {formatCurrency(enteredActualHaler)}
            </span>
          </div>

          <div className={`p-2.5 rounded-lg flex items-center justify-between text-sm font-medium ${
            diffInHaler === 0 
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
              : 'bg-slate-50 text-slate-900 border border-slate-200'
          }`}>
            <span className="flex items-center gap-1.5">
              {diffInHaler === 0
                ? <CheckCircle className="w-4 h-4" aria-hidden="true" />
                : <SlidersHorizontal className="w-4 h-4 text-slate-500" aria-hidden="true" />}
              {diffInHaler === 0 ? 'Zůstatky se shodují' : 'Korekce'}
            </span>
            {/* Barva rozdílu jen podle znaménka: přibývá zeleně, ubývá červeně – stejně jako v seznamech */}
            <span className={`font-bold ${diffInHaler > 0 ? 'text-emerald-600' : diffInHaler < 0 ? 'text-red-600' : ''}`}>
              {formatCurrency(diffInHaler, { showPlus: true })}
            </span>
          </div>
        </div>

        <div>
          <label htmlFor={`${fieldId}-1`} className="block text-xs font-semibold text-slate-500 mb-1">
            Zůstatek podle banky *
          </label>
          <div className="relative">
            <input id={`${fieldId}-1`}
              type="text"
              autoComplete="off"
              required
              value={actualBalanceStr}
              onChange={(e) => { setActualBalanceStr(e.target.value); setErrors(prev => ({ ...prev, balance: undefined })); }}
              {...fieldErrorProps(`${fieldId}-1`, errors.balance)}
              className={`w-full pl-3.5 pr-10 py-2 text-sm bg-white border rounded-xl focus:outline-none ${fieldStateClass(errors.balance, 'border-slate-200 focus:ring-2 focus:ring-sky-500')} font-semibold`}
            />
            <span className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-xs font-semibold text-slate-500">Kč</span>
          </div>
          <FieldError inputId={`${fieldId}-1`} message={errors.balance} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${fieldId}-2`} className="block text-xs font-semibold text-slate-500 mb-1">
              Ke dni *
            </label>
            <input id={`${fieldId}-2`}
              type="date"
              required
              min={account.initialBalanceDate}
              value={checkDate}
              onChange={(e) => { setCheckDate(e.target.value); setErrors(prev => ({ ...prev, date: undefined })); }}
              {...fieldErrorProps(`${fieldId}-2`, errors.date)}
              className={`w-full px-3.5 py-2 text-sm bg-white border rounded-xl focus:outline-none ${fieldStateClass(errors.date, 'border-slate-200 focus:ring-2 focus:ring-sky-500')}`}
            />
            <FieldError inputId={`${fieldId}-2`} message={errors.date} />
          </div>

          <div>
            <label htmlFor={`${fieldId}-3`} className="block text-xs font-semibold text-slate-500 mb-1">
              Poznámka (nepovinné)
            </label>
            <input id={`${fieldId}-3`}
              type="text"
              placeholder="např. výpis z banky k 15. 10."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>
        </div>

        <p className="text-xs text-slate-500 bg-sky-50/70 p-4 rounded-xl border border-sky-100">
          Dosavadní položky ani počáteční zůstatek se nezmění. Rozdíl se uloží jako korekce k tomuto dni a promítne se do zůstatků od tohoto dne dál.
        </p>

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
            {isSubmitting ? 'Ukládám…' : diffInHaler === 0 ? 'Potvrdit shodu' : 'Uložit korekci'}
          </button>
        </ModalFooter>
      </form>
    </Modal>
  );
};
