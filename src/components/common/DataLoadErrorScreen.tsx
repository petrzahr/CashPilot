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
        setRestoreError(err.message || 'Soubor se zálohou nelze načíst.');
      }
    };
    reader.readAsText(file);
    if (e.target) e.target.value = '';
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center justify-center p-4 sm:p-6">
      <div className="max-w-xl w-full bg-slate-800/90 border border-slate-700/80 rounded-3xl p-6 sm:p-8 shadow-2xl backdrop-blur-md space-y-6">
        <div className="flex items-center gap-4">
          <div className="p-3.5 rounded-2xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <AlertTriangle className="w-8 h-8" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
              Data aplikace se nepodařilo bezpečně načíst
            </h1>
            <div className="flex items-center gap-1.5 text-xs text-emerald-400 mt-1">
              <ShieldCheck className="w-4 h-4" />
              <span>Původní data v úložišti nebyla přepsána</span>
            </div>
          </div>
        </div>

        <div className="bg-slate-900/60 rounded-2xl p-4 border border-slate-700/50 space-y-2 text-xs sm:text-sm text-slate-300">
          <p className="font-semibold text-slate-200">
            {errorMessage || 'V lokálním úložišti byl nalezen neplatný nebo poškozený formát dat.'}
          </p>
          <p className="text-slate-400 text-xs">
            Abychom zabránili ztrátě vašich skutečných financí, automatické ukládání bylo zastaveno.
            {recoveryKey && ` Bezpečnostní kopie poškozeného stavu byla uložena pod klíčem "${recoveryKey}".`}
          </p>
        </div>

        {restoreError && (
          <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl text-xs">
            {restoreError}
          </div>
        )}

        <div className="space-y-3 pt-2">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            Doporučený postup nápravy
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Tlačítko Stáhnout poškozená data */}
            <button
              onClick={handleDownloadCorrupted}
              disabled={!corruptedRaw}
              className="flex items-center justify-center gap-2.5 px-4 py-3 bg-slate-700/60 hover:bg-slate-700 border border-slate-600 rounded-xl text-xs font-semibold text-white transition-all disabled:opacity-50"
            >
              <Download className="w-4 h-4 text-sky-400" />
              <span>Stáhnout kopii (JSON)</span>
            </button>

            {/* Tlačítko Obnovit ze zálohy */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center justify-center gap-2.5 px-4 py-3 bg-sky-600 hover:bg-sky-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-sky-600/30 transition-all"
            >
              <Upload className="w-4 h-4" />
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

          <div className="flex items-center justify-between pt-4 border-t border-slate-700/60 text-xs">
            <button
              onClick={onRetry}
              className="flex items-center gap-1.5 text-slate-400 hover:text-white transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Zkusit znovu načíst</span>
            </button>

            <button
              onClick={() => setConfirmResetOpen(true)}
              className="flex items-center gap-1.5 text-red-400 hover:text-red-300 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Založit čistou instalaci</span>
            </button>
          </div>
        </div>
      </div>

      <ConfirmationModal
        isOpen={confirmResetOpen}
        onClose={() => setConfirmResetOpen(false)}
        onConfirm={onResetToFresh}
        title="Založit novou čistou instalaci"
        message="POZOR: Tato akce zahodí aktuálně poškozená data v lokálním úložišti a založí zcela čistou aplikaci bez účtů a transakcí. Doporučujeme si nejprve stáhnout kopii poškozených dat. Chcete pokračovat?"
        confirmText="Ano, založit čistou aplikaci"
        isDestructive
      />
    </div>
  );
};
