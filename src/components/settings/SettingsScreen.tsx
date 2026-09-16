import { SYNC_LABELS } from '../../services/syncController';
import React, { useState, useRef } from 'react';
import { useFinance } from '../../context/FinanceContext';
import { formatCurrency, halerToInputValue, parseInputToHaler } from '../../services/currencyService';
import { isDemoModeEnabled } from '../../services/storageService';
import { ConfirmationModal } from '../common/ConfirmationModal';
import { DataActionConfirmationModal } from './DataActionConfirmationModal';
import { 
  Settings, 
  Download, 
  Upload, 
  Trash2, 
  Sparkles, 
  ShieldAlert, 
  Calendar, 
  Coins, 
  Layers, 
  CheckCircle2, 
  FileText,
  Cloud,
  RefreshCw,
  LogOut,
  AlertCircle
} from 'lucide-react';

import { GoogleIcon } from '../common/GoogleIcon';

export const SettingsScreen: React.FC = () => {
  const {
    settings,
    updateSettings,
    accounts,
    updateAccount,
    categories,
    transactions,
    recurringRules,
    recurringExceptions,
    corrections,
    marketValueSnapshots,
    exportJSON,
    importJSON,
    exportCSV,
    loadDemoData,
    clearAllTransactions,
    clearAllAccounts,
    clearAllCategories,
    resetAllData,
    isDriveConnected,
    driveSyncStatus,
    driveUser,
    lastDriveSyncTime,
    driveError,
    connectGoogleDrive,
    disconnectGoogleDrive,
    syncWithGoogleDrive,
  } = useFinance();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [budgetStartDay, setBudgetStartDay] = useState(settings.budgetStartDay);
  const [overdraftLimitStr, setOverdraftLimitStr] = useState(
    halerToInputValue(settings.overdraftLimitInHaler ?? settings.minReserveInHaler ?? 0)
  );
  const [roundAmounts, setRoundAmounts] = useState(settings.roundAmounts);

  // Potvrzovací dialogy
  const [confirmStartDayOpen, setConfirmStartDayOpen] = useState(false);
  const [pendingStartDay, setPendingStartDay] = useState<number | null>(null);

  const [confirmLoadDemoOpen, setConfirmLoadDemoOpen] = useState(false);
  const [confirmClearTransactionsOpen, setConfirmClearTransactionsOpen] = useState(false);
  const [confirmClearAccountsOpen, setConfirmClearAccountsOpen] = useState(false);
  const [confirmClearCategoriesOpen, setConfirmClearCategoriesOpen] = useState(false);
  const [confirmResetAllOpen, setConfirmResetAllOpen] = useState(false);

  // Synchronizace při změně zvenčí
  React.useEffect(() => {
    setBudgetStartDay(settings.budgetStartDay);
    setOverdraftLimitStr(
      halerToInputValue(settings.overdraftLimitInHaler ?? settings.minReserveInHaler ?? 0)
    );
    setRoundAmounts(settings.roundAmounts);
  }, [settings.budgetStartDay, settings.overdraftLimitInHaler, settings.minReserveInHaler, settings.roundAmounts]);

  const handleStartDayChange = (newDay: number) => {
    if (isNaN(newDay) || newDay < 1 || newDay > 31 || !Number.isInteger(newDay)) return;
    if (newDay === settings.budgetStartDay) return;

    if (transactions.length > 0) {
      setPendingStartDay(newDay);
      setConfirmStartDayOpen(true);
    } else {
      setBudgetStartDay(newDay);
      updateSettings({ budgetStartDay: newDay });
    }
  };

  const handleConfirmStartDayChange = () => {
    if (pendingStartDay !== null) {
      setBudgetStartDay(pendingStartDay);
      updateSettings({ budgetStartDay: pendingStartDay });
      setPendingStartDay(null);
      setConfirmStartDayOpen(false);
    }
  };

  const handleCancelStartDayChange = () => {
    setPendingStartDay(null);
    setConfirmStartDayOpen(false);
  };

  const handleSaveGeneral = (e: React.FormEvent) => {
    e.preventDefault();
    const overdraftHaler = parseInputToHaler(overdraftLimitStr);
    updateSettings({
      overdraftLimitInHaler: overdraftHaler,
      minReserveInHaler: overdraftHaler, // Pro zpětnou kompatibilitu
      roundAmounts,
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        importJSON(content);
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="space-y-6 pb-16 max-w-4xl">
      {/* 1. Finanční pravidla a rozpočtový měsíc */}
      <div className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/80 shadow-sm space-y-5">
        <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
          <div className="p-2 rounded-xl bg-sky-50 text-sky-600">
            <Calendar className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Rozpočtové období a pravidla</h2>
            <p className="text-xs text-slate-500">
              Konfigurace začátku rozpočtového měsíce a výše kontokorentu
            </p>
          </div>
        </div>

        <form onSubmit={handleSaveGeneral} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Počáteční den období */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">
                Počáteční den rozpočtového měsíce
              </label>
              <select
                value={budgetStartDay}
                onChange={(e) => handleStartDayChange(parseInt(e.target.value, 10))}
                className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500 font-semibold text-slate-900"
              >
                {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                  <option key={day} value={day}>
                    {`${day}. den v měsíci`}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-500 mt-1">
                {budgetStartDay === 1
                  ? 'Období odpovídá celému kalendářnímu měsíci (např. 1. 9. – 30. 9.).'
                  : `Např. ${budgetStartDay}. den znamená období od ${budgetStartDay}. dne do dne předcházejícího v dalším měsíci.`}
              </p>
            </div>

            {/* Výše kontokorentu */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">
                Výše kontokorentu (Kč)
              </label>
              <div className="relative">
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={overdraftLimitStr}
                  onChange={(e) => setOverdraftLimitStr(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500 font-semibold"
                />
                <span className="absolute right-3.5 top-2 text-xs font-semibold text-slate-500">Kč</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                Limit povoleného záporného zůstatku pro výchozí účet (zadává se kladně, např. 20 000 Kč).
              </p>
            </div>

            {/* Měna */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">
                Základní měna
              </label>
              <input
                type="text"
                disabled
                value="Kč (CZK)"
                className="w-full px-3.5 py-2 text-sm bg-slate-100 border border-slate-200 rounded-xl text-slate-500 font-medium cursor-not-allowed"
              />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              className="px-5 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-xl shadow-sm shadow-sky-200 transition-colors"
            >
              Uložit pravidla
            </button>
          </div>
        </form>
      </div>

      {/* 2. Zahrnutí jednotlivých účtů do rozpočtu */}
      <div className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/80 shadow-sm space-y-4">
        <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
          <div className="p-2 rounded-xl bg-purple-50 text-purple-600">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Zahrnutí účtů do forecastu</h2>
            <p className="text-xs text-slate-500">
              Přepněte, zda se daný účet počítá do okamžitě použitelných peněz a celkového majetku
            </p>
          </div>
        </div>

        <div className="divide-y divide-slate-100">
          {accounts.map((acc) => (
            <div key={acc.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2.5">
                <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: acc.color }} />
                <div>
                  <span className="font-bold text-slate-900 text-sm block">{acc.name}</span>
                  <span className="text-slate-500">{acc.institution || 'Bez instituce'}</span>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={acc.isUsableCash}
                    onChange={(e) => updateAccount({ ...acc, isUsableCash: e.target.checked })}
                    className="w-4 h-4 text-sky-600 rounded border-slate-300 focus:ring-sky-500"
                  />
                  <span className="font-medium text-slate-500">Použitelné peníze</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={acc.isNetWorth}
                    onChange={(e) => updateAccount({ ...acc, isNetWorth: e.target.checked })}
                    className="w-4 h-4 text-purple-600 rounded border-slate-300 focus:ring-purple-500"
                  />
                  <span className="font-medium text-slate-500">Celkový majetek</span>
                </label>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 3. Google Disk – Cloudová synchronizace */}
      <div className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/80 shadow-sm space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-sky-50 text-sky-600">
              <Cloud className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <span>Google Disk – Cloudová synchronizace</span>
                {isDriveConnected && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    <CheckCircle2 className="w-3 h-3" />
                    Připojeno
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-500">
                Automatické ukládání a obnova dat v privátním prostoru vašeho Google účtu (appDataFolder)
              </p>
            </div>
          </div>

          {!isDriveConnected ? (
            <button
              type="button"
              onClick={connectGoogleDrive}
              disabled={driveSyncStatus === 'syncing'}
              className="flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-500 shadow-sm transition-all hover:border-sky-300 active:scale-[0.98] cursor-pointer"
            >
              <GoogleIcon className="w-4 h-4 shrink-0" />
              <span>{driveSyncStatus === 'syncing' ? 'Připojuji...' : 'Připojit Google Disk'}</span>
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => syncWithGoogleDrive('upload')}
                disabled={driveSyncStatus === 'syncing'}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-sky-50 hover:bg-sky-100 text-sky-700 transition-colors cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${driveSyncStatus === 'syncing' ? 'animate-spin' : ''}`} />
                <span>Synchronizovat</span>
              </button>

              <button
                type="button"
                onClick={disconnectGoogleDrive}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Odpojit</span>
              </button>
            </div>
          )}
        </div>

        {/* Informační obsah */}
        {!isDriveConnected ? (
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200/80 text-xs text-slate-500 space-y-2">
            <p className="font-semibold text-slate-900">
              Proč připojit Google Disk?
            </p>
            <ul className="list-disc list-inside space-y-1 text-slate-500">
              <li><strong>Offline-first:</strong> Aplikace i nadále běží bleskově a ukládá změny lokálně na vašem zařízení.</li>
              <li><strong>Bezpečný soukromý prostor:</strong> Data se ukládají do skrytého prostoru <code className="bg-slate-200/80 px-1 py-0.5 rounded text-[11px]">appDataFolder</code>, kam nemá přístup žádná jiná aplikace ani běžné vyhledávání na Disku.</li>
              <li><strong>Automatické zálohování:</strong> Každá úprava rozpočtu, účtu či platby se na pozadí synchronizuje na váš Google Disk.</li>
            </ul>
          </div>
        ) : (
          <div className="space-y-3 text-xs">
            <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                {driveUser?.photoLink ? (
                  <img
                    src={driveUser.photoLink}
                    alt={driveUser.displayName || 'Google'}
                    className="w-10 h-10 rounded-full border border-slate-200 shrink-0"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-sky-100 text-sky-700 flex items-center justify-center font-bold text-sm shrink-0">
                    {driveUser?.displayName ? driveUser.displayName[0].toUpperCase() : 'G'}
                  </div>
                )}
                <div>
                  <p className="font-bold text-slate-900">{driveUser?.displayName || 'Google Účet'}</p>
                  <p className="text-[11px] text-slate-500">{driveUser?.emailAddress || 'Propojeno s Google Drive'}</p>
                </div>
              </div>

              <div className="text-right">
                <div className="flex items-center gap-1.5 justify-end font-semibold">
                  {driveSyncStatus === 'syncing' ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-sky-600" />
                      <span className="text-sky-600">Probíhá synchronizace...</span>
                    </>
                  ) : driveSyncStatus !== 'synced' ? (
                    <>
                      <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                      <span className="text-amber-600">{SYNC_LABELS[driveSyncStatus]}</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      <span className="text-emerald-700">{SYNC_LABELS[driveSyncStatus]}</span>
                    </>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Poslední synchronizace: {lastDriveSyncTime ? lastDriveSyncTime.toLocaleString('cs-CZ') : 'Při této relaci'}
                </p>
              </div>
            </div>

            {driveError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{driveError}</span>
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={() => syncWithGoogleDrive('upload')}
                disabled={driveSyncStatus === 'syncing'}
                className="px-3.5 py-2 text-xs font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 rounded-xl transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${driveSyncStatus === 'syncing' ? 'animate-spin' : ''}`} />
                <span>Vynutit uložení na Google Disk</span>
              </button>

              <button
                type="button"
                onClick={() => syncWithGoogleDrive('download')}
                disabled={driveSyncStatus === 'syncing'}
                className="px-3.5 py-2 text-xs font-semibold text-slate-500 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5 text-slate-500" />
                <span>Stáhnout data z Google Disku</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 4. Zálohování a Export */}
      <div className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/80 shadow-sm space-y-4">
        <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
          <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600">
            <Download className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Zálohování a přenositelnost dat</h2>
            <p className="text-xs text-slate-500">
              Uložte kompletní zálohu do jednoho souboru nebo obnovte data
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button
            onClick={exportJSON}
            className="flex flex-col items-center justify-center p-4 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition-colors text-center space-y-1.5"
          >
            <Download className="w-5 h-5 text-sky-600" />
            <span className="text-xs font-bold text-slate-900">Exportovat JSON zálohu</span>
            <span className="text-[10px] text-slate-500">Kompletní stav aplikace</span>
          </button>

          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center justify-center p-4 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition-colors text-center space-y-1.5"
          >
            <Upload className="w-5 h-5 text-emerald-600" />
            <span className="text-xs font-bold text-slate-900">Obnovit ze zálohy</span>
            <span className="text-[10px] text-slate-500">Nahrát .json soubor</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleFileChange}
            className="hidden"
          />

          <button
            onClick={exportCSV}
            className="flex flex-col items-center justify-center p-4 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition-colors text-center space-y-1.5"
          >
            <FileText className="w-5 h-5 text-purple-600" />
            <span className="text-xs font-bold text-slate-900">Export položek (CSV)</span>
            <span className="text-[10px] text-slate-500">Pro Excel či tabulky</span>
          </button>
        </div>
      </div>

      {/* 4. Správa dat a reset */}
      <div className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/80 shadow-sm space-y-6">
        <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
          <div className="p-2 rounded-xl bg-amber-50 text-amber-600">
            <Trash2 className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Správa dat a reset</h2>
            <p className="text-xs text-slate-500">
              Samostatná správa jednotlivých finančních dat nebo kompletní reset aplikace
            </p>
          </div>
        </div>

        {/* Správa jednotlivých dat */}
        <div className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Správa jednotlivých dat
          </h3>

          <div className="space-y-2.5">
            {/* 1. Vymazat všechny transakce */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition-colors gap-3">
              <div>
                <h4 className="text-sm font-bold text-slate-900">Vymazat všechny transakce</h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  Odstraní všechny finanční položky a související pohyby. Účty, kategorie a nastavení zůstanou zachované.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfirmClearTransactionsOpen(true)}
                className="px-4 py-2 text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-xl transition-colors shrink-0 self-start sm:self-center"
              >
                Vymazat všechny transakce
              </button>
            </div>

            {/* 2. Vymazat všechny účty */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition-colors gap-3">
              <div>
                <h4 className="text-sm font-bold text-slate-900">Vymazat všechny účty</h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  Odstraní všechny účty a všechna data, která jsou na tyto účty přímo navázaná. Kategorie a nastavení zůstanou zachované.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfirmClearAccountsOpen(true)}
                className="px-4 py-2 text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-xl transition-colors shrink-0 self-start sm:self-center"
              >
                Vymazat všechny účty
              </button>
            </div>

            {/* 3. Vymazat všechny kategorie */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition-colors gap-3">
              <div>
                <h4 className="text-sm font-bold text-slate-900">Vymazat všechny kategorie</h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  Odstraní všechny hlavní kategorie a podkategorie. Finanční položky, účty a nastavení zůstanou zachované.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfirmClearCategoriesOpen(true)}
                className="px-4 py-2 text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-xl transition-colors shrink-0 self-start sm:self-center"
              >
                Vymazat všechny kategorie
              </button>
            </div>
          </div>
        </div>

        {/* Nebezpečná zóna */}
        <div className="pt-2">
          <div className="p-4 sm:p-5 rounded-2xl border-2 border-red-100 bg-red-50/30 space-y-3">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-red-600" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-red-700">
                Nebezpečná zóna
              </h3>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-bold text-slate-900">Kompletně vymazat všechna data</h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  Trvale odstraní všechna uživatelská data a vrátí aplikaci do čistého počátečního stavu.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfirmResetAllOpen(true)}
                className="px-4 py-2.5 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl shadow-sm shadow-red-200 transition-colors shrink-0 self-start sm:self-center"
              >
                Kompletně vymazat všechna data
              </button>
            </div>
          </div>
        </div>

        {/* Načíst ukázková data (pouze při zapnutém demo režimu) */}
        {isDemoModeEnabled() && (
          <div className="pt-2 border-t border-slate-100 flex justify-end">
            <button
              type="button"
              onClick={() => setConfirmLoadDemoOpen(true)}
              className="px-3 py-1.5 text-xs font-medium text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-lg transition-colors"
            >
              Načíst ukázková data (Demo režim)
            </button>
          </div>
        )}
      </div>

      {/* Potvrzovací dialog pro změnu začátku měsíce */}
      <ConfirmationModal
        isOpen={confirmStartDayOpen}
        onClose={handleCancelStartDayChange}
        onConfirm={handleConfirmStartDayChange}
        title="Změna počátečního dne rozpočtového měsíce"
        message="Změna počátečního dne přesune některé položky mezi rozpočtovými obdobími a přepočítá všechny navazující zůstatky. Chcete pokračovat?"
        confirmText="Ano, pokračovat"
      />

      {/* Potvrzovací dialog pro načtení demo dat (pouze demo režim) */}
      <ConfirmationModal
        isOpen={confirmLoadDemoOpen}
        onClose={() => setConfirmLoadDemoOpen(false)}
        onConfirm={loadDemoData}
        title="Načíst ukázková data"
        message="Tato akce nahradí stávající data ukázkovým portfoliem účtů, pravidelnou mzdou, hypotékou a výdaji. Přejete si pokračovat?"
        confirmText="Načíst demo"
      />

      {/* Dialog 1: Vymazat všechny transakce */}
      <DataActionConfirmationModal
        isOpen={confirmClearTransactionsOpen}
        onClose={() => setConfirmClearTransactionsOpen(false)}
        onConfirm={() => {
          clearAllTransactions();
          setConfirmClearTransactionsOpen(false);
        }}
        title="Vymazat všechny transakce"
        description="Odstraní všechny finanční položky a související pohyby. Účty, kategorie a nastavení zůstanou zachované."
        warningMessage="Tuto operaci nelze běžně vrátit zpět."
        affectedRecords={[
          { label: 'Finanční položky (transakce)', count: transactions.length },
          { label: 'Pravidla opakovaných plateb', count: recurringRules.length },
          { label: 'Výjimky opakovaných plateb', count: recurringExceptions.length },
          { label: 'Korekce zůstatků', count: corrections.length },
        ]}
        confirmButtonText="Vymazat všechny transakce"
        onDownloadBackup={exportJSON}
      />

      {/* Dialog 2: Vymazat všechny účty */}
      <DataActionConfirmationModal
        isOpen={confirmClearAccountsOpen}
        onClose={() => setConfirmClearAccountsOpen(false)}
        onConfirm={() => {
          clearAllAccounts();
          setConfirmClearAccountsOpen(false);
        }}
        title="Vymazat všechny účty"
        description="Odstraní všechny účty a všechna data, která jsou na tyto účty přímo navázaná. Kategorie a nastavení zůstanou zachované."
        warningMessage="Odstraněním účtů budou odstraněny také všechny transakce, převody, opakované platby, korekce a tržní hodnoty navázané na tyto účty. Tuto operaci nelze běžně vrátit zpět."
        affectedRecords={[
          { label: 'Účty (aktivní i archivované)', count: accounts.length },
          { label: 'Finanční položky (transakce)', count: transactions.length },
          { label: 'Pravidla opakovaných plateb', count: recurringRules.length },
          { label: 'Výjimky opakovaných plateb', count: recurringExceptions.length },
          { label: 'Korekce zůstatků', count: corrections.length },
          { label: 'Tržní hodnoty investic a penzí', count: marketValueSnapshots.length },
        ]}
        confirmButtonText="Vymazat všechny účty"
        onDownloadBackup={exportJSON}
      />

      {/* Dialog 3: Vymazat všechny kategorie */}
      <DataActionConfirmationModal
        isOpen={confirmClearCategoriesOpen}
        onClose={() => setConfirmClearCategoriesOpen(false)}
        onConfirm={() => {
          clearAllCategories();
          setConfirmClearCategoriesOpen(false);
        }}
        title="Vymazat všechny kategorie"
        description="Odstraní všechny hlavní kategorie a podkategorie. Finanční položky, účty a nastavení zůstanou zachované."
        warningMessage="U všech existujících transakcí a pravidel bude kategorie nastavena na „Bez kategorie“. Tuto operaci nelze běžně vrátit zpět."
        affectedRecords={[
          { label: 'Hlavní kategorie', count: categories.filter(c => !c.parentId).length },
          { label: 'Podkategorie', count: categories.filter(c => !!c.parentId).length },
          { label: 'Položky s přiřazenou kategorií', count: transactions.filter(t => t.categoryId).length },
          { label: 'Pravidla s přiřazenou kategorií', count: recurringRules.filter(r => r.categoryId).length },
        ]}
        confirmButtonText="Vymazat všechny kategorie"
        onDownloadBackup={exportJSON}
      />

      {/* Dialog 4: Kompletně vymazat všechna data */}
      <DataActionConfirmationModal
        isOpen={confirmResetAllOpen}
        onClose={() => setConfirmResetAllOpen(false)}
        onConfirm={() => {
          resetAllData();
          setConfirmResetAllOpen(false);
        }}
        title="Kompletně vymazat všechna data"
        description="Budou odstraněny všechny účty, transakce, kategorie, opakované platby, korekce, tržní hodnoty a nastavení aplikace."
        warningMessage="Trvale odstraní všechna uživatelská data a vrátí aplikaci do čistého počátečního stavu. Tuto operaci nelze vzít zpět."
        affectedRecords={[
          { label: 'Účty', count: accounts.length },
          { label: 'Finanční položky (transakce)', count: transactions.length },
          { label: 'Pravidla opakovaných plateb', count: recurringRules.length },
          { label: 'Korekce zůstatků', count: corrections.length },
          { label: 'Tržní hodnoty', count: marketValueSnapshots.length },
          { label: 'Kategorie a podkategorie', count: categories.length },
        ]}
        confirmButtonText="Trvale vymazat vše"
        onDownloadBackup={exportJSON}
        requiresConfirmationPhrase={true}
        confirmationPhrase="VYMAZAT VŠE"
      />
    </div>
  );
};
