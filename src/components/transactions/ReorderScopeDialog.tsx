import React, { useState, useEffect } from 'react';
import { Modal, ModalFooter } from '../common/Modal';
import { ArrowUpDown } from 'lucide-react';
import { RecurrenceScopePicker } from '../shared/RecurrenceScopePicker';

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
      title="Změnit pořadí pravidelné položky"
      maxWidth="max-w-lg"
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl shrink-0 bg-sky-50 text-sky-600 border border-sky-100">
            <ArrowUpDown className="w-5 h-5" />
          </div>
          <div className="text-sm text-slate-500 leading-relaxed">
            <p>
              Položka „<strong className="text-slate-900">{transactionTitle}</strong>“ se opakuje. Vyberte, pro které výskyty má nové pořadí platit.
            </p>
          </div>
        </div>

        <RecurrenceScopePicker
          legend="Platí pro"
          name="reorderScopeMode"
          value={mode}
          onChange={setMode}
          descriptions={{
            occurrence: 'Nové pořadí se uplatní pouze v aktuálně zobrazeném období.',
            future: 'Nové pořadí platí od tohoto výskytu dál. Minulé výskyty zůstanou beze změny.',
            series: 'Nové pořadí platí pro všechny výskyty. Minulé položky, které už jsou uložené, zůstanou beze změny.',
          }}
        />

        <ModalFooter>
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
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 active:bg-sky-800 rounded-xl shadow-sm transition-all cursor-pointer"
          >
            <span>Uložit pořadí</span>
          </button>
        </ModalFooter>
      </div>
    </Modal>
  );
};
