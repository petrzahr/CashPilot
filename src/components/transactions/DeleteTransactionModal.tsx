import React, { useState, useEffect } from 'react';
import { Modal } from '../common/Modal';
import { Transaction } from '../../types/finance';
import { AlertTriangle, Loader2, Repeat, Trash2 } from 'lucide-react';

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
        setErrorMessage('Při mazání položky došlo k chybě.');
      } else {
        onClose();
      }
    } catch (err) {
      console.error(err);
      setErrorMessage('Při mazání položky došlo k chybě.');
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
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-medium">
            {errorMessage}
          </div>
        )}

        {/* Hlavní varovná zpráva */}
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl shrink-0 bg-red-50 text-red-600 border border-red-100">
            <Trash2 className="w-5 h-5" />
          </div>
          <div className="text-sm text-slate-500 leading-relaxed">
            <p>
              Položka „<strong className="text-slate-900">{transaction.title}</strong>“ bude trvale odstraněna. Tato akce ovlivní zůstatky aktuálního a všech následujících období.
            </p>
          </div>
        </div>

        {/* Volby pro pravidelné položky */}
        {isRecurring && (
          <div className="mt-4 pt-3 border-t border-slate-100 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
              <Repeat className="w-4 h-4 text-sky-600" />
              <span>Tato položka patří do pravidelné série. Vyberte rozsah:</span>
            </div>

            <div className="space-y-2">
              {/* 1. Pouze tato položka */}
              <label
                className={`flex items-start gap-3 p-3 rounded-xl border transition-all cursor-pointer ${
                  recurringMode === 'occurrence'
                    ? 'border-sky-500 bg-sky-50/60 text-slate-900 shadow-sm'
                    : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-500'
                }`}
              >
                <input
                  type="radio"
                  name="recurringDeleteMode"
                  value="occurrence"
                  checked={recurringMode === 'occurrence'}
                  onChange={() => setRecurringMode('occurrence')}
                  disabled={isDeleting}
                  className="mt-0.5 text-sky-600 focus:ring-sky-500"
                />
                <div className="text-xs">
                  <div className="font-semibold text-slate-900">Pouze tato položka</div>
                  <div className="text-slate-500 mt-0.5">
                    Vytvoří výjimku v pravidelné sérii, aby se odstraněný výskyt po novém načtení znovu nevygeneroval.
                  </div>
                </div>
              </label>

              {/* 2. Tato a všechny budoucí položky */}
              <label
                className={`flex items-start gap-3 p-3 rounded-xl border transition-all cursor-pointer ${
                  recurringMode === 'future'
                    ? 'border-sky-500 bg-sky-50/60 text-slate-900 shadow-sm'
                    : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-500'
                }`}
              >
                <input
                  type="radio"
                  name="recurringDeleteMode"
                  value="future"
                  checked={recurringMode === 'future'}
                  onChange={() => setRecurringMode('future')}
                  disabled={isDeleting}
                  className="mt-0.5 text-sky-600 focus:ring-sky-500"
                />
                <div className="text-xs">
                  <div className="font-semibold text-slate-900">Tato a všechny budoucí položky</div>
                  <div className="text-slate-500 mt-0.5">
                    Ukončí nebo upraví pravidlo opakování od vybraného výskytu. Minulé výskyty zůstanou zachovány.
                  </div>
                </div>
              </label>

              {/* 3. Celá série */}
              <label
                className={`flex items-start gap-3 p-3 rounded-xl border transition-all cursor-pointer ${
                  recurringMode === 'series'
                    ? 'border-red-500 bg-red-50/50 text-slate-900 shadow-sm'
                    : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-500'
                }`}
              >
                <input
                  type="radio"
                  name="recurringDeleteMode"
                  value="series"
                  checked={recurringMode === 'series'}
                  onChange={() => setRecurringMode('series')}
                  disabled={isDeleting}
                  className="mt-0.5 text-red-600 focus:ring-red-500"
                />
                <div className="text-xs">
                  <div className="font-semibold text-slate-900">Celá série</div>
                  <div className="text-slate-500 mt-0.5">
                    Odstraní pravidlo i všechny jeho výskyty, které lze podle současného datového modelu bezpečně odstranit.
                  </div>
                </div>
              </label>
            </div>

            {/* Ochrana historických uskutečněných položek při mazání celé série */}
            {recurringMode === 'series' && hasExecutedHistorical && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-amber-800">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  <span>Série obsahuje již uskutečněné historické položky</span>
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={deleteHistoricalExecuted}
                    onChange={(e) => setDeleteHistoricalExecuted(e.target.checked)}
                    disabled={isDeleting}
                    className="rounded text-red-600 focus:ring-red-500"
                  />
                  <span>Smazat i již uskutečněné historické položky</span>
                </label>
                {!deleteHistoricalExecuted && (
                  <p className="text-[11px] text-amber-700/90 italic">
                    Uskutečněné položky zůstanou bez výslovného zaškrtnutí v historii zachovány.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Tlačítka akce */}
        <div className="mt-6 pt-3 border-t border-slate-100 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="px-4 py-2 text-sm font-medium text-slate-500 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            Zrušit
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isDeleting}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 active:bg-red-800 rounded-xl shadow-sm shadow-red-200 disabled:opacity-60 transition-all cursor-pointer"
          >
            {isDeleting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Mazání…</span>
              </>
            ) : (
              <span>Smazat položku</span>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
};
