import React, { useState, useEffect, useMemo } from 'react';
import { useFinance } from '../../context/FinanceContext';
import { Modal } from '../common/Modal';
import { Account } from '../../types/finance';
import { formatCurrency, parseInputToHaler, subHaler } from '../../services/currencyService';
import { getAccountBalanceAtDate } from '../../services/financialEngine';
import { getNextSequenceForDate } from '../../services/sequenceService';
import { getTodayInPrague, formatCzechDate } from '../../services/periodService';
import { CheckCircle, AlertTriangle } from 'lucide-react';

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
  const { transactions, corrections, accounts, reconcileBalance } = useFinance();
  const [actualBalanceStr, setActualBalanceStr] = useState('');
  const [checkDate, setCheckDate] = useState(() => getTodayInPrague());
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

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
    }
  }, [isOpen, account]);

  if (!account) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (account.initialBalanceDate && checkDate < account.initialBalanceDate) {
      alert(`Tento účet je aktivní až od ${formatCzechDate(account.initialBalanceDate)}. Zvolte stejné nebo pozdější datum.`);
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
      title={`Aktualizovat skutečný stav: ${account.name}`}
      subtitle="Porovnání evidovaného a reálného bankovního zůstatku"
      maxWidth="max-w-lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
          <div className="flex justify-between items-center text-sm">
            <span className="text-slate-500">Vypočítaný stav v aplikaci:</span>
            <span className="font-semibold text-slate-900">
              {formatCurrency(calculatedBalanceInHaler)}
            </span>
          </div>

          <div className="border-t border-slate-200 pt-2 flex justify-between items-center text-sm">
            <span className="text-slate-500">Zadaný skutečný stav:</span>
            <span className="font-semibold text-slate-900">
              {formatCurrency(enteredActualHaler)}
            </span>
          </div>

          <div className={`p-2.5 rounded-lg flex items-center justify-between text-sm font-medium ${
            diffInHaler === 0 
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
              : diffInHaler > 0 
                ? 'bg-sky-50 text-sky-700 border border-sky-200' 
                : 'bg-amber-50 text-amber-700 border border-amber-200'
          }`}>
            <span className="flex items-center gap-1.5">
              {diffInHaler === 0 ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
              Rozdíl (korekce):
            </span>
            <span className="font-bold">
              {formatCurrency(diffInHaler, { showPlus: true })}
            </span>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">
            Skutečný zůstatek na výpisu / v bance (Kč) *
          </label>
          <div className="relative">
            <input
              type="number"
              step="any"
              required
              value={actualBalanceStr}
              onChange={(e) => setActualBalanceStr(e.target.value)}
              className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500 font-semibold"
            />
            <span className="absolute right-3.5 top-2 text-xs font-semibold text-slate-500">Kč</span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">
              Datum kontroly *
            </label>
            <input
              type="date"
              required
              min={account.initialBalanceDate}
              value={checkDate}
              onChange={(e) => setCheckDate(e.target.value)}
              className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">
              Poznámka ke kontrole
            </label>
            <input
              type="text"
              placeholder="např. Bankovní výpis k 15. dni"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>
        </div>

        <p className="text-xs text-slate-500 bg-sky-50/70 p-3 rounded-xl border border-sky-100">
          💡 <strong>Princip CashPilot:</strong> Aplikace nikdy potají nepřepisuje historické položky ani původní počáteční stav. Rozdíl se uloží jako transparentní korekce zůstatku k tomuto datu a promítne se do navazujícího výhledu.
        </p>

        <div className="mt-5 flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm font-medium text-slate-500 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 disabled:opacity-50"
          >
            Zrušit
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-5 py-2 text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-xl shadow-sm shadow-sky-200 disabled:opacity-50"
          >
            {isSubmitting ? 'Ukládám...' : diffInHaler === 0 ? 'Potvrdit shodu stavu' : 'Uložit skutečný stav'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
