import React, { useState, useEffect } from 'react';
import { useFinance } from '../../context/FinanceContext';
import { Modal, ModalFooter } from '../common/Modal';
import { ConfirmationModal } from '../common/ConfirmationModal';
import { Transaction, BalanceCorrection } from '../../types/finance';
import { formatCurrency } from '../../services/currencyService';
import { formatCzechDate } from '../../services/periodService';
import { SlidersHorizontal, Trash2, Check, Info, Calendar, FileText } from 'lucide-react';

interface CorrectionDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  correctionItem: Transaction | BalanceCorrection | null;
  /** Otevřít rovnou s potvrzením smazání (akce „Smazat korekci“ v seznamu) */
  startWithDeleteConfirm?: boolean;
}

export const CorrectionDetailModal: React.FC<CorrectionDetailModalProps> = ({
  isOpen,
  onClose,
  correctionItem,
  startWithDeleteConfirm = false,
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
      setIsConfirmDeleteOpen(startWithDeleteConfirm);
    }
  }, [currentItem, isOpen, startWithDeleteConfirm]);

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

  // Zavřením (Zavřít, křížek, Escape, klik mimo) se změněná poznámka sama uloží, aby se neztratila
  const handleClose = () => {
    if (note !== (currentItem.note || '')) updateCorrectionNote(currentItem.id, note);
    onClose();
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
        onClose={handleClose}
        title="Detail korekce zůstatku"
        subtitle={account ? `Účet: ${account.name}` : undefined}
        maxWidth="max-w-lg"
      >
        <div className="space-y-5">
          {/* Finanční přehled korekce */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-slate-500">Ke dni</span>
              <span className="font-semibold text-slate-900 flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-slate-500" />
                {dateStr ? formatCzechDate(dateStr) : '—'}
                {sequence !== undefined && (
                  <span className="ml-1 px-1.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-500">
                    {sequence}. v pořadí dne
                  </span>
                )}
              </span>
            </div>

            <div className="border-t border-slate-200 pt-2 flex justify-between items-center">
              <span className="text-slate-500">Zůstatek v CashPilotu před korekcí</span>
              <span className="font-medium text-slate-500">
                {formatCurrency(calcBal)}
              </span>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-slate-500">Zůstatek podle banky</span>
              <span className="font-semibold text-slate-900">
                {formatCurrency(actualBal)}
              </span>
            </div>

            <div className="mt-2 p-2.5 rounded-lg flex items-center justify-between text-sm font-semibold bg-slate-50 text-slate-900 border border-slate-200">
              <span className="flex items-center gap-1.5">
                <SlidersHorizontal className="w-4 h-4 text-slate-500" aria-hidden="true" />
                Korekce
              </span>
              {/* Barva rozdílu jen podle znaménka, stejně jako v seznamech a při odsouhlasení */}
              <span className={`font-bold text-base ${diff > 0 ? 'text-emerald-600' : diff < 0 ? 'text-red-600' : 'text-slate-500'}`}>
                {formatCurrency(diff, { showPlus: true })}
              </span>
            </div>
          </div>

          {/* Editace poznámky */}
          <form onSubmit={handleSaveNote} className="space-y-2">
            <label htmlFor="correction-note" className="block text-xs font-semibold text-slate-500 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-slate-500" />
              Poznámka
            </label>
            <div className="flex gap-2">
              <input
                id="correction-note"
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="např. výpis z banky k 15. 10."
                className="flex-1 px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <button
                type="submit"
                className="px-3.5 py-2 text-xs font-semibold text-sky-700 bg-sky-50 border border-sky-200 rounded-xl hover:bg-sky-100 transition-colors flex items-center gap-1"
              >
                <Check className="w-3.5 h-3.5" />
                Uložit poznámku
              </button>
            </div>
          </form>

          {/* Upozornění na neměnnost finanční částky */}
          <div className="flex items-start gap-2 p-4 bg-amber-50/80 border border-amber-200 rounded-xl text-xs text-amber-900">
            <Info className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
            <span>
              Částku korekce nejde upravit, protože z ní vycházejí všechny další zůstatky. Pokud nesedí, korekci smažte a na účtu znovu zvolte Srovnat s bankou.
            </span>
          </div>

          {/* Patička s akcemi */}
          <ModalFooter className="justify-between">
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
              onClick={handleClose}
              className="px-4 py-2 text-sm font-semibold text-slate-500 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
            >
              Zavřít
            </button>
          </ModalFooter>
        </div>
      </Modal>

      <ConfirmationModal
        isOpen={isConfirmDeleteOpen}
        onClose={() => setIsConfirmDeleteOpen(false)}
        onConfirm={handleDelete}
        title="Smazat korekci zůstatku?"
        message="Korekce se smaže a zůstatky od tohoto dne dál se přepočítají. Smazání nelze vrátit."
        confirmText="Smazat korekci"
        cancelText="Zrušit"
        isDestructive={true}
      />
    </>
  );
};
