import React, { useState, useEffect } from 'react';
import { useFinance } from '../../context/FinanceContext';
import { Modal } from '../common/Modal';
import { ConfirmationModal } from '../common/ConfirmationModal';
import { Transaction, BalanceCorrection } from '../../types/finance';
import { formatCurrency } from '../../services/currencyService';
import { formatCzechDate } from '../../services/periodService';
import { SlidersHorizontal, Trash2, Check, Info, Calendar, FileText } from 'lucide-react';

interface CorrectionDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  correctionItem: Transaction | BalanceCorrection | null;
}

export const CorrectionDetailModal: React.FC<CorrectionDetailModalProps> = ({
  isOpen,
  onClose,
  correctionItem,
}) => {
  const { accounts, transactions, corrections, updateCorrectionNote, deleteCorrection } = useFinance();
  const [note, setNote] = useState('');
  const [isConfirmDeleteOpen, setIsConfirmDeleteOpen] = useState(false);

  // Získat nejaktuálnější data položky ze stavu
  const currentItem = React.useMemo(() => {
    if (!correctionItem) return null;
    const tx = transactions.find(t => t.id === correctionItem.id);
    if (tx) return tx;
    const corr = corrections.find(c => c.id === correctionItem.id);
    if (corr) return corr;
    return correctionItem;
  }, [correctionItem, transactions, corrections]);

  useEffect(() => {
    if (currentItem && isOpen) {
      setNote(currentItem.note || '');
      setIsConfirmDeleteOpen(false);
    }
  }, [currentItem, isOpen]);

  if (!currentItem) return null;

  const accountId = (currentItem as Transaction).sourceAccountId || (currentItem as BalanceCorrection).accountId;
  const account = accounts.find(a => a.id === accountId);
  const dateStr = (currentItem as Transaction).date || (currentItem as BalanceCorrection).checkDate;
  const sequence = currentItem.sequence;
  const calcBal = currentItem.calculatedBalanceInHaler ?? 0;
  const actualBal = currentItem.actualBalanceInHaler ?? 0;
  const diff = currentItem.diffInHaler ?? 0;

  const handleSaveNote = (e: React.FormEvent) => {
    e.preventDefault();
    updateCorrectionNote(currentItem.id, note);
  };

  const handleDelete = async () => {
    const ok = await deleteCorrection(currentItem.id);
    if (ok) {
      setIsConfirmDeleteOpen(false);
      onClose();
    }
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title="Detail korekce zůstatku"
        subtitle={account ? `Účet: ${account.name}` : undefined}
        maxWidth="max-w-lg"
      >
        <div className="space-y-5">
          {/* Finanční přehled korekce */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-slate-500">Datum kontroly:</span>
              <span className="font-semibold text-slate-900 flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-slate-500" />
                {dateStr ? formatCzechDate(dateStr) : '—'}
                {sequence !== undefined && (
                  <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-500">
                    #{sequence}. v dni
                  </span>
                )}
              </span>
            </div>

            <div className="border-t border-slate-200 pt-2 flex justify-between items-center">
              <span className="text-slate-500">Vypočítaný stav před korekcí:</span>
              <span className="font-medium text-slate-500">
                {formatCurrency(calcBal)}
              </span>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-slate-500">Evidovaný skutečný stav:</span>
              <span className="font-semibold text-slate-900">
                {formatCurrency(actualBal)}
              </span>
            </div>

            <div className={`mt-2 p-2.5 rounded-lg flex items-center justify-between text-sm font-semibold ${
              diff > 0
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : diff < 0
                  ? 'bg-amber-50 text-amber-700 border border-amber-200'
                  : 'bg-slate-100 text-slate-500'
            }`}>
              <span className="flex items-center gap-1.5">
                <SlidersHorizontal className="w-4 h-4" />
                Výše korekce:
              </span>
              <span className="font-bold text-base">
                {formatCurrency(diff, { showPlus: true })}
              </span>
            </div>
          </div>

          {/* Editace poznámky */}
          <form onSubmit={handleSaveNote} className="space-y-2">
            <label className="block text-xs font-semibold text-slate-500 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-slate-500" />
              Poznámka ke korekci
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Důvod korekce nebo zdroj výpisu..."
                className="flex-1 px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <button
                type="submit"
                className="px-3.5 py-2 text-xs font-semibold text-sky-700 bg-sky-50 border border-sky-200 rounded-xl hover:bg-sky-100 transition-colors flex items-center gap-1"
              >
                <Check className="w-3.5 h-3.5" />
                Uložit
              </button>
            </div>
          </form>

          {/* Upozornění na neměnnost finanční částky */}
          <div className="flex items-start gap-2 p-3 bg-amber-50/80 border border-amber-200 rounded-xl text-xs text-amber-900">
            <Info className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
            <span>
              Částku evidované korekce nelze přímo změnit, aby byla zachována integrita navazujících výpočtů. Pokud potřebujete stav opravit, smažte tuto korekci a zadejte skutečný stav znovu.
            </span>
          </div>

          {/* Patička s akcemi */}
          <div className="pt-2 flex justify-between items-center border-t border-slate-100">
            <button
              type="button"
              onClick={() => setIsConfirmDeleteOpen(true)}
              className="px-3 py-2 text-xs font-semibold text-red-600 hover:text-red-700 hover:bg-red-50 rounded-xl transition-colors flex items-center gap-1.5"
            >
              <Trash2 className="w-4 h-4" />
              Smazat korekci
            </button>

            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-500 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
            >
              Zavřít
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmationModal
        isOpen={isConfirmDeleteOpen}
        onClose={() => setIsConfirmDeleteOpen(false)}
        onConfirm={handleDelete}
        title="Smazat korekci zůstatku?"
        message="Korekce zůstatku bude trvale odstraněna. Tato akce ovlivní zůstatky aktuálního a všech následujících období."
        confirmText="Smazat korekci"
        cancelText="Zrušit"
        isDestructive={true}
      />
    </>
  );
};
