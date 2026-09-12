import React, { useState, useRef } from 'react';
import { useFinance } from '../../context/FinanceContext';
import { formatCurrency, halerToInputValue, parseInputToHaler } from '../../services/currencyService';
import { ConfirmationModal } from '../common/ConfirmationModal';
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

const GoogleIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg className={className} viewBox="0 0 24 24">
    <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"/>
    <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.34 24 12 24z"/>
    <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.97 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/>
    <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.34 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
  </svg>
);

export const SettingsScreen: React.FC = () => {
  const {
    settings,
    updateSettings,
    accounts,
    updateAccount,
    transactions,
    exportJSON,
    importJSON,
    exportCSV,
    loadDemoData,
    clearDemoData,
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
  const [forecastMonths, setForecastMonths] = useState(settings.forecastMonths || 12);
  const [roundAmounts, setRoundAmounts] = useState(settings.roundAmounts);

  // Potvrzovací dialogy
  const [confirmStartDayOpen, setConfirmStartDayOpen] = useState(false);
  const [pendingStartDay, setPendingStartDay] = useState<number | null>(null);

  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [confirmClearDemoOpen, setConfirmClearDemoOpen] = useState(false);
  const [confirmLoadDemoOpen, setConfirmLoadDemoOpen] = useState(false);

  // Synchronizace při změně zvenčí
  React.useEffect(() => {
    setBudgetStartDay(settings.budgetStartDay);
    setOverdraftLimitStr(
      halerToInputValue(settings.overdraftLimitInHaler ?? settings.minReserveInHaler ?? 0)
    );
    setForecastMonths(settings.forecastMonths || 12);
    setRoundAmounts(settings.roundAmounts);
  }, [settings.budgetStartDay, settings.overdraftLimitInHaler, settings.minReserveInHaler, settings.forecastMonths, settings.roundAmounts]);

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
      forecastMonths,
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
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Počáteční den rozpočtového měsíce
              </label>
              <select
                value={budgetStartDay}
                onChange={(e) => handleStartDayChange(parseInt(e.target.value, 10))}
                className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500 font-semibold text-slate-800"
              >
                {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                  <option key={day} value={day}>
                    {day === 1
                      ? '1. den (standardní kalendářní měsíc)'
                      : day === 15
                      ? '15. den v měsíci (výchozí doporučeno)'
                      : `${day}. den v měsíci`}
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
              <label className="block text-xs font-semibold text-slate-700 mb-1">
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
                <span className="absolute right-3.5 top-2 text-xs font-semibold text-slate-400">Kč</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                Limit povoleného záporného zůstatku pro výchozí účet (zadává se kladně, např. 20 000 Kč).
              </p>
            </div>

            {/* Horizont forecastu */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Horizont forecastu (počet měsíců)
              </label>
              <select
                value={forecastMonths}
                onChange={(e) => setForecastMonths(parseInt(e.target.value, 10))}
                className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500 font-medium"
              >
                <option value={6}>6 měsíců</option>
                <option value={12}>12 měsíců (doporučeno)</option>
                <option value={18}>18 měsíců</option>
                <option value={24}>24 měsíců</option>
              </select>
            </div>

            {/* Měna */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
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
                  <span className="text-slate-400">{acc.institution || 'Bez instituce'}</span>
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
                  <span className="font-medium text-slate-700">Použitelné peníze</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={acc.isNetWorth}
                    onChange={(e) => updateAccount({ ...acc, isNetWorth: e.target.checked })}
                    className="w-4 h-4 text-purple-600 rounded border-slate-300 focus:ring-purple-500"
                  />
                  <span className="font-medium text-slate-700">Celkový majetek</span>
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
              className="flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 shadow-sm transition-all hover:border-sky-300 active:scale-[0.98] cursor-pointer"
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
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200/80 text-xs text-slate-600 space-y-2">
            <p className="font-semibold text-slate-800">
              Proč připojit Google Disk?
            </p>
            <ul className="list-disc list-inside space-y-1 text-slate-600">
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
                  ) : driveSyncStatus === 'error' ? (
                    <>
                      <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                      <span className="text-amber-600">Chyba synchronizace</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      <span className="text-emerald-700">Data jsou v cloudu aktuální</span>
                    </>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">
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
                className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5 text-slate-600" />
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
            <span className="text-[10px] text-slate-400">Kompletní stav aplikace</span>
          </button>

          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center justify-center p-4 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition-colors text-center space-y-1.5"
          >
            <Upload className="w-5 h-5 text-emerald-600" />
            <span className="text-xs font-bold text-slate-900">Obnovit ze zálohy</span>
            <span className="text-[10px] text-slate-400">Nahrát .json soubor</span>
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
            <span className="text-[10px] text-slate-400">Pro Excel či tabulky</span>
          </button>
        </div>
      </div>

      {/* 4. Ukázková data a správa úložiště */}
      <div className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/80 shadow-sm space-y-4">
        <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
          <div className="p-2 rounded-xl bg-amber-50 text-amber-600">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Ukázková data a reset</h2>
            <p className="text-xs text-slate-500">
              Možnost načíst demonstrační profil pro prezentaci nebo smazat data
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => setConfirmLoadDemoOpen(true)}
            className="px-4 py-2 text-xs font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-xl transition-colors"
          >
            Načíst ukázková data
          </button>

          <button
            onClick={() => setConfirmClearDemoOpen(true)}
            className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl transition-colors"
          >
            Odstranit ukázkové položky
          </button>

          <button
            onClick={() => setConfirmResetOpen(true)}
            className="px-4 py-2 text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-xl transition-colors ml-auto"
          >
            Kompletně vymazat všechna data
          </button>
        </div>
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

      {/* Potvrzovací dialog pro načtení demo dat */}
      <ConfirmationModal
        isOpen={confirmLoadDemoOpen}
        onClose={() => setConfirmLoadDemoOpen(false)}
        onConfirm={loadDemoData}
        title="Načíst ukázková data"
        message="Tato akce nahradí stávající data ukázkovým portfoliem účtů (Běžný, Spořicí Air Bank, ČSOB Odvážný...), pravidelnou mzdou, hypotékou a výdaji. Přejete si pokračovat?"
        confirmText="Načíst demo"
      />

      {/* Potvrzovací dialog pro vyčištění demo dat */}
      <ConfirmationModal
        isOpen={confirmClearDemoOpen}
        onClose={() => setConfirmClearDemoOpen(false)}
        onConfirm={clearDemoData}
        title="Odstranit položky"
        message="Opravdu si přejete smazat všechny transakce a trvalá pravidla? Účty a kategorie zůstanou zachovány."
        confirmText="Odstranit položky"
        isDestructive
      />

      {/* Potvrzovací dialog pro kompletní reset */}
      <ConfirmationModal
        isOpen={confirmResetOpen}
        onClose={() => setConfirmResetOpen(false)}
        onConfirm={resetAllData}
        title="Kompletní smazání dat"
        message="POZOR: Tato akce je nevratná. Dojde k trvalému smazání všech účtů, transakcí, korekcí a pravidel. Doporučujeme předem provést export JSON zálohy. Chcete opravdu pokračovat?"
        confirmText="Trvale smazat vše"
        isDestructive
      />
    </div>
  );
};
