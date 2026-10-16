import React, { useState, useEffect, useRef } from 'react';
import { Modal, ModalFooter } from '../common/Modal';
import { AlertTriangle, Download, Check } from 'lucide-react';

export interface AffectedRecordGroup {
  label: string;
  count: number;
}

export interface DataActionConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  warningMessage?: string;
  affectedRecords: AffectedRecordGroup[];
  confirmButtonText: string;
  onDownloadBackup: () => void;
  requiresConfirmationPhrase?: boolean;
  confirmationPhrase?: string;
}

export const DataActionConfirmationModal: React.FC<DataActionConfirmationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  warningMessage = 'Smazání nelze vrátit. Data půjde obnovit jen ze zálohy.',
  affectedRecords,
  confirmButtonText,
  onDownloadBackup,
  requiresConfirmationPhrase = false,
  confirmationPhrase = 'VYMAZAT VŠE',
}) => {
  const [confirmationInput, setConfirmationInput] = useState('');
  const [backupDownloaded, setBackupDownloaded] = useState(false);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  // Při otevření vyresetovat stav a automaticky zaostřit tlačítko Zrušit
  useEffect(() => {
    if (isOpen) {
      setConfirmationInput('');
      setBackupDownloaded(false);
      // Timeout zajistí spolehlivé zaostření po vykreslení modalu
      const timer = setTimeout(() => {
        cancelButtonRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const isConfirmed = requiresConfirmationPhrase
    ? confirmationInput.trim() === confirmationPhrase
    : true;

  const handleDownloadBackup = () => {
    onDownloadBackup();
    setBackupDownloaded(true);
  };

  // Enter v poli potvrzovací fráze nesmí nic potvrdit. Tlačítka se Enterem
  // aktivují normálně, uživatel na ně musí nejdřív záměrně přejít.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} maxWidth="max-w-lg">
      <div className="space-y-4 text-sm text-slate-500" onKeyDown={handleKeyDown}>
        {/* Varování a popis */}
        <div className="flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-200/80 text-red-800">
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold text-xs sm:text-sm text-red-900">{description}</p>
            <p className="text-xs text-red-700">{warningMessage}</p>
          </div>
        </div>

        {/* Počty dotčených záznamů */}
        <div className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Co se smaže
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {affectedRecords.map((item, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs"
              >
                <span className="font-medium text-slate-500">{item.label}</span>
                <span
                  className={`font-bold px-2 py-0.5 rounded-md ${
                    item.count > 0
                      ? 'bg-red-100 text-red-800'
                      : 'bg-slate-200 text-slate-500'
                  }`}
                >
                  {item.count}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Nabídka stažení JSON zálohy */}
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-slate-900">Nejdřív si stáhněte zálohu</p>
            <p className="text-xs text-slate-500">
              Ze souboru zálohy (JSON) obnovíte data v Nastavení → Záloha do souboru.
            </p>
          </div>
          <button
            type="button"
            onClick={handleDownloadBackup}
            className={`max-md:min-h-11 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors shrink-0 ${
              backupDownloaded
                ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                : 'bg-white text-slate-500 border border-slate-300 hover:bg-slate-100'
            }`}
          >
            {backupDownloaded ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                Záloha stažena
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5 text-sky-600" />
                Stáhnout zálohu
              </>
            )}
          </button>
        </div>

        {/* Potvrzovací fráze pro kompletní reset */}
        {requiresConfirmationPhrase && (
          <div className="space-y-1.5 pt-1">
            <label htmlFor="data-action-confirmation" className="block text-xs font-semibold text-slate-500">
              Pro potvrzení napište <span className="font-mono font-bold text-red-600 select-all">{confirmationPhrase}</span>
            </label>
            <input
              id="data-action-confirmation"
              type="text"
              autoComplete="off"
              value={confirmationInput}
              onChange={(e) => setConfirmationInput(e.target.value)}
              className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 font-mono"
            />
          </div>
        )}

        {/* Tlačítka akce */}
        <ModalFooter>
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-semibold text-slate-500 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-300"
          >
            Zrušit
          </button>
          <button
            type="button"
            disabled={!isConfirmed}
            onClick={() => {
              if (!isConfirmed) return;
              onConfirm();
              onClose();
            }}
            className={`px-4 py-2 text-sm font-semibold rounded-xl transition-all ${
              isConfirmed
                ? 'text-white bg-red-600 hover:bg-red-700 shadow-sm cursor-pointer'
                : 'text-slate-500 bg-slate-200 cursor-not-allowed'
            }`}
          >
            {confirmButtonText}
          </button>
        </ModalFooter>
      </div>
    </Modal>
  );
};
