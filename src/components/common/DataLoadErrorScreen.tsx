import React, { useRef, useState } from 'react';
import { AlertTriangle, Download, Upload, RefreshCw, Trash2, ShieldCheck } from 'lucide-react';
import { ConfirmationModal } from './ConfirmationModal';
import { exportCorruptedRawData } from '../../services/storageService';

interface DataLoadErrorScreenProps {
  errorMessage?: string;
  recoveryKey?: string;
  corruptedRaw?: string;
  onRestoreBackup: (jsonStr: string) => void;
  onResetToFresh: () => void;
  onRetry: () => void;
}

export const DataLoadErrorScreen: React.FC<DataLoadErrorScreenProps> = ({
  errorMessage,
  recoveryKey,
  corruptedRaw,
  onRestoreBackup,
  onResetToFresh,
  onRetry,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const handleDownloadCorrupted = () => {
    if (corruptedRaw) {
      exportCorruptedRawData(corruptedRaw);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        onRestoreBackup(text);
        setRestoreError(null);
      } catch (err: any) {
        setRestoreError(err.message || 'Soubor se zálohou se nepodařilo načíst. Zkontrolujte, že jde o zálohu z CashPilotu (.json).');
      }
    };
    reader.readAsText(file);
    if (e.target) e.target.value = '';
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col items-center justify-center p-4 sm:p-6">
      {/* Stejná plocha a karta jako přihlášení: chyba je hlášená obsahem, ne jiným vzhledem aplikace */}
      <div className="max-w-xl w-full bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-sm space-y-5">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-amber-50 text-amber-600 shrink-0">
            <AlertTriangle className="w-6 h-6" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-extrabold text-slate-900 tracking-tight">
              Data aplikace se nepodařilo bezpečně načíst
            </h1>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 mt-1">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
              <span>Uložená data zůstala beze změny</span>
            </div>
          </div>
        </div>

        <div className="bg-amber-50 rounded-xl p-4 space-y-2 text-xs sm:text-sm text-amber-900">
          <p className="font-semibold">
            {errorMessage || 'Data uložená v tomto prohlížeči jsou poškozená nebo mají neplatný formát.'}
          </p>
          <p className="text-xs text-amber-800">
            Automatické ukládání je pozastavené, aby se nic nepřepsalo.
            {recoveryKey && ` Kopie poškozených dat je v prohlížeči uložená pod klíčem „${recoveryKey}“.`}
          </p>
        </div>

        {restoreError && (
          <div role="alert" className="panel panel-error">
            {restoreError}
          </div>
        )}

        <div className="space-y-3">
          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
            Jak pokračovat
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Tlačítko Stáhnout poškozená data */}
            <button
              type="button"
              onClick={handleDownloadCorrupted}
              disabled={!corruptedRaw}
              className="btn-secondary min-h-10 py-2.5"
            >
              <Download className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Stáhnout poškozená data (JSON)</span>
            </button>

            {/* Tlačítko Obnovit ze zálohy */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="btn-primary min-h-10 py-2.5"
            >
              <Upload className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Obnovit ze zálohy (JSON)</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>

          <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-200 text-xs font-semibold">
            <button
              type="button"
              onClick={onRetry}
              className="btn-text -mx-1"
            >
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Načíst znovu</span>
            </button>

            <button
              type="button"
              onClick={() => setConfirmResetOpen(true)}
              className="btn-text btn-text-danger -mx-1"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Začít s prázdnými daty</span>
            </button>
          </div>
        </div>
      </div>

      <ConfirmationModal
        isOpen={confirmResetOpen}
        onClose={() => setConfirmResetOpen(false)}
        onConfirm={onResetToFresh}
        title="Začít s prázdnými daty?"
        message="Poškozená data v tomto prohlížeči se zahodí a aplikace začne bez účtů a položek. Pokud jste si je ještě nestáhli, udělejte to nejdřív."
        confirmText="Zahodit data a začít znovu"
        isDestructive
      />
    </div>
  );
};
