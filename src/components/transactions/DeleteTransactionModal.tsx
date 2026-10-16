import React, { useState, useEffect } from 'react';
import { Modal, ModalFooter } from '../common/Modal';
import { Transaction } from '../../types/finance';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { RecurrenceScopePicker } from '../shared/RecurrenceScopePicker';

interface DeleteTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  transaction: Transaction | null;
  onConfirm: (
    tx: Transaction,
    recurringMode?: 'occurrence' | 'future' | 'series',
    deleteHistoricalExecuted?: boolean
  ) => Promise<boolean | void>;
  isDeleting: boolean;
  hasExecutedHistorical?: boolean;
}

export const DeleteTransactionModal: React.FC<DeleteTransactionModalProps> = ({
  isOpen,
  onClose,
  transaction,
  onConfirm,
  isDeleting,
  hasExecutedHistorical = false,
}) => {
  const [recurringMode, setRecurringMode] = useState<'occurrence' | 'future' | 'series'>('occurrence');
  const [deleteHistoricalExecuted, setDeleteHistoricalExecuted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Resetovat stav při každém otevření nového modálu
  useEffect(() => {
    if (isOpen) {
      setRecurringMode('occurrence');
      setDeleteHistoricalExecuted(false);
      setErrorMessage(null);
    }
  }, [isOpen, transaction]);

  if (!transaction) return null;

  const isRecurring = Boolean(
    transaction.recurringRuleId || transaction.id.startsWith('virtual_')
  );

  const handleConfirm = async () => {
    if (isDeleting) return;
    setErrorMessage(null);
    try {
      const result = await onConfirm(
        transaction,
        isRecurring ? recurringMode : undefined,
        deleteHistoricalExecuted
      );
      if (result === false) {
        setErrorMessage('Položku se nepodařilo smazat. Zkuste to prosím znovu.');
      } else {
        onClose();
      }
    } catch (err) {
      console.error(err);
      setErrorMessage('Položku se nepodařilo smazat. Zkuste to prosím znovu.');
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={isDeleting ? () => {} : onClose}
      title="Smazat položku?"
      maxWidth="max-w-lg"
    >
      <div className="space-y-4">
        {/* Chybová zpráva, pokud nastala chyba */}
        {errorMessage && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-medium">
            {errorMessage}
          </div>
        )}

        {/* Hlavní varovná zpráva */}
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl shrink-0 bg-red-50 text-red-600">
            <Trash2 className="w-5 h-5" />
          </div>
          <div className="text-sm text-slate-500 leading-relaxed">
            <p>
              Položka „<strong className="text-slate-900">{transaction.title}</strong>“ se smaže a zůstatky v tomto i všech dalších obdobích se přepočítají. Smazání nelze vrátit.
            </p>
          </div>
        </div>

        {/* Volby pro pravidelné položky */}
        {isRecurring && (
          <div className="mt-4 pt-3 border-t border-slate-100 space-y-3">
            <RecurrenceScopePicker
              legend="Pravidelná položka – co chcete smazat?"
              name="recurringDeleteMode"
              value={recurringMode}
              onChange={setRecurringMode}
              disabled={isDeleting}
              destructiveScope="series"
              descriptions={{
                occurrence: 'Ostatní výskyty série zůstanou beze změny.',
                future: 'Opakování skončí před tímto výskytem. Tento a budoucí výskyty se smažou, minulé zůstanou beze změny.',
                series: 'Smaže opakování a všechny jeho výskyty, minulé i budoucí. Uskutečněné položky smaže jen na výslovné potvrzení.',
              }}
            />
            {/* Ochrana historických uskutečněných položek při mazání budoucích výskytů nebo celé série */}
            {(recurringMode === 'future' || recurringMode === 'series') && hasExecutedHistorical && (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-amber-800">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  <span>Série obsahuje už uskutečněné položky</span>
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={deleteHistoricalExecuted}
                    onChange={(e) => setDeleteHistoricalExecuted(e.target.checked)}
                    disabled={isDeleting}
                    className="rounded text-red-600 focus:ring-red-500"
                  />
                  <span>Smazat i uskutečněné položky</span>
                </label>
                {!deleteHistoricalExecuted && (
                  <p className="text-xs text-amber-700">
                    Bez zaškrtnutí uskutečněné položky zůstanou.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Tlačítka akce */}
        <ModalFooter>
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="btn-secondary"
          >
            Zrušit
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isDeleting}
            className="btn-danger"
          >
            {isDeleting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Mazání…</span>
              </>
            ) : (
              <span>
                {!isRecurring || recurringMode === 'occurrence'
                  ? 'Smazat položku'
                  : recurringMode === 'future'
                    ? 'Smazat budoucí výskyty'
                    : 'Smazat celou sérii'}
              </span>
            )}
          </button>
        </ModalFooter>
      </div>
    </Modal>
  );
};
