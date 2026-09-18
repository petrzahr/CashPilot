import React, { useState, useEffect } from 'react';
import { Modal } from '../common/Modal';
import { ArrowUpDown, Repeat } from 'lucide-react';

interface ReorderScopeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  transactionTitle: string;
  onConfirm: (mode: 'occurrence' | 'future' | 'series') => void;
}

export const ReorderScopeDialog: React.FC<ReorderScopeDialogProps> = ({
  isOpen,
  onClose,
  transactionTitle,
  onConfirm,
}) => {
  const [mode, setMode] = useState<'occurrence' | 'future' | 'series'>('occurrence');

  // Resetovat volbu při každém otevření dialogu
  useEffect(() => {
    if (isOpen) {
      setMode('occurrence');
    }
  }, [isOpen]);

  const handleConfirm = () => {
    onConfirm(mode);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Přeuspořádat pravidelnou položku"
      maxWidth="max-w-lg"
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl shrink-0 bg-sky-50 text-sky-600 border border-sky-100">
            <ArrowUpDown className="w-5 h-5" />
          </div>
          <div className="text-sm text-slate-500 leading-relaxed">
            <p>
              Položka „<strong className="text-slate-900">{transactionTitle}</strong>“ patří do pravidelné série. Vyberte, na co se má nové pořadí vztahovat.
            </p>
          </div>
        </div>

        <div className="pt-1 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 mb-1">
            <Repeat className="w-4 h-4 text-sky-600" />
            <span>Rozsah přeuspořádání</span>
          </div>

          <label
            className={`flex items-start gap-3 p-3 rounded-xl border transition-all cursor-pointer ${
              mode === 'occurrence'
                ? 'border-sky-500 bg-sky-50/60 text-slate-900 shadow-sm'
                : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-500'
            }`}
          >
            <input
              type="radio"
              name="reorderScopeMode"
              value="occurrence"
              checked={mode === 'occurrence'}
              onChange={() => setMode('occurrence')}
              className="mt-0.5 text-sky-600 focus:ring-sky-500"
            />
            <div className="text-xs">
              <div className="font-semibold text-slate-900">Jen tento výskyt</div>
              <div className="text-slate-500 mt-0.5">
                Nové pořadí se uplatní pouze v aktuálně zobrazeném období.
              </div>
            </div>
          </label>

          <label
            className={`flex items-start gap-3 p-3 rounded-xl border transition-all cursor-pointer ${
              mode === 'future'
                ? 'border-sky-500 bg-sky-50/60 text-slate-900 shadow-sm'
                : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-500'
            }`}
          >
            <input
              type="radio"
              name="reorderScopeMode"
              value="future"
              checked={mode === 'future'}
              onChange={() => setMode('future')}
              className="mt-0.5 text-sky-600 focus:ring-sky-500"
            />
            <div className="text-xs">
              <div className="font-semibold text-slate-900">Tento a všechny budoucí výskyty</div>
              <div className="text-slate-500 mt-0.5">
                Pravidlo se rozdělí a nové pořadí bude platit od tohoto výskytu dál. Minulé výskyty zůstanou beze změny.
              </div>
            </div>
          </label>

          <label
            className={`flex items-start gap-3 p-3 rounded-xl border transition-all cursor-pointer ${
              mode === 'series'
                ? 'border-sky-500 bg-sky-50/60 text-slate-900 shadow-sm'
                : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-500'
            }`}
          >
            <input
              type="radio"
              name="reorderScopeMode"
              value="series"
              checked={mode === 'series'}
              onChange={() => setMode('series')}
              className="mt-0.5 text-sky-600 focus:ring-sky-500"
            />
            <div className="text-xs">
              <div className="font-semibold text-slate-900">Celá série</div>
              <div className="text-slate-500 mt-0.5">
                Nové pořadí bude platit pro všechny budoucí výskyty. Již zaznamenané minulé položky zůstanou beze změny.
              </div>
            </div>
          </label>
        </div>

        <div className="mt-6 pt-3 border-t border-slate-100 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-500 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
          >
            Zrušit
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 active:bg-sky-800 rounded-xl shadow-sm shadow-sky-200 transition-all cursor-pointer"
          >
            <span>Potvrdit</span>
          </button>
        </div>
      </div>
    </Modal>
  );
};
