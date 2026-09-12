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
  FileText 
} from 'lucide-react';

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
  } = useFinance();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [budgetStartDay, setBudgetStartDay] = useState(settings.budgetStartDay);
  const [minReserveStr, setMinReserveStr] = useState(halerToInputValue(settings.minReserveInHaler));
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
  }, [settings.budgetStartDay]);

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
    const reserveHaler = parseInputToHaler(minReserveStr);
    updateSettings({
      minReserveInHaler: reserveHaler,
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
              Konfigurace začátku rozpočtového měsíce a minimální finanční rezervy
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

            {/* Minimální finanční rezerva */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Minimální finanční rezerva (Kč)
              </label>
              <div className="relative">
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={minReserveStr}
                  onChange={(e) => setMinReserveStr(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500 font-semibold"
                />
                <span className="absolute right-3.5 top-2 text-xs font-semibold text-slate-400">Kč</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                Při poklesu použitelných peněz pod tuto částku se zobrazí upozornění.
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

      {/* 3. Zálohování a Export */}
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
