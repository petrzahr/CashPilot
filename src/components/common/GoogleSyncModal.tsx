import React from 'react';
import { Modal } from './Modal';
import { AppData } from '../../services/storageService';
import { DriveFileInfo } from '../../services/googleDriveService';
import { Cloud, ArrowDownCircle, ArrowUpCircle, AlertTriangle } from 'lucide-react';

interface GoogleSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileInfo: DriveFileInfo;
  remoteData: AppData;
  localData: AppData;
  onSelectChoice: (choice: 'use_remote' | 'use_local') => void;
}

export const GoogleSyncModal: React.FC<GoogleSyncModalProps> = ({
  isOpen,
  onClose,
  fileInfo,
  remoteData,
  localData,
  onSelectChoice,
}) => {
  const remoteDateStr = fileInfo.modifiedTime
    ? new Date(fileInfo.modifiedTime).toLocaleString('cs-CZ', {
        day: 'numeric',
        month: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Neznámé datum';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Data nalezena na Google Disku" maxWidth="max-w-lg">
      <div className="space-y-4 text-xs text-slate-600">
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold text-amber-900">
              V privátním prostoru vašeho Google Disku byla nalezena existující data CashPilot.
            </p>
            <p className="text-amber-800">
              Vyberte, zda si přejete načíst uložená data z Google Disku, nebo zachovat aktuální lokální data a přepsat data na Disku.
            </p>
          </div>
        </div>

        {/* Srovnání dat */}
        <div className="grid grid-cols-2 gap-3 pt-1">
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5">
            <div className="flex items-center gap-1.5 font-bold text-slate-800 text-[13px]">
              <Cloud className="w-4 h-4 text-sky-600" />
              <span>Google Disk</span>
            </div>
            <p className="text-[11px] text-slate-400">Upraveno: {remoteDateStr}</p>
            <ul className="space-y-0.5 text-[11px] text-slate-600 pt-1">
              <li>Účty: <span className="font-semibold text-slate-800">{remoteData.accounts?.length || 0}</span></li>
              <li>Položky: <span className="font-semibold text-slate-800">{remoteData.transactions?.length || 0}</span></li>
              <li>Pravidla: <span className="font-semibold text-slate-800">{remoteData.recurringRules?.length || 0}</span></li>
            </ul>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5">
            <div className="flex items-center gap-1.5 font-bold text-slate-800 text-[13px]">
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
              <span>Tento počítač</span>
            </div>
            <p className="text-[11px] text-slate-400">Lokální stav</p>
            <ul className="space-y-0.5 text-[11px] text-slate-600 pt-1">
              <li>Účty: <span className="font-semibold text-slate-800">{localData.accounts?.length || 0}</span></li>
              <li>Položky: <span className="font-semibold text-slate-800">{localData.transactions?.length || 0}</span></li>
              <li>Pravidla: <span className="font-semibold text-slate-800">{localData.recurringRules?.length || 0}</span></li>
            </ul>
          </div>
        </div>

        {/* Akční tlačítka */}
        <div className="space-y-2 pt-2">
          <button
            type="button"
            onClick={() => onSelectChoice('use_remote')}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold shadow-sm shadow-sky-200 transition-all cursor-pointer"
          >
            <ArrowDownCircle className="w-4 h-4" />
            <span>Načíst data z Google Disku (přepsat lokální)</span>
          </button>

          <button
            type="button"
            onClick={() => onSelectChoice('use_local')}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 font-semibold transition-all cursor-pointer"
          >
            <ArrowUpCircle className="w-4 h-4 text-emerald-600" />
            <span>Zachovat lokální data (nahrát na Google Disk)</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="w-full py-1.5 text-center text-slate-400 hover:text-slate-600 font-medium transition-colors"
          >
            Zrušit a ponechat bez synchronizace
          </button>
        </div>
      </div>
    </Modal>
  );
};
