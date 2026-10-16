import { SyncStatusLabel, formatLastSync } from '../common/SyncStatusIndicator';
import React, { useState, useRef, useId, useEffect } from 'react';
import { useFinance } from '../../context/FinanceContext';
import { halerToInputValue, parseInputToHaler } from '../../services/currencyService';
import { isDemoModeEnabled, validateAndParseBackup } from '../../services/storageService';
import { RestoreConfirmationModal, buildRestorePreview, type RestorePreview } from './RestoreConfirmationModal';
import { DRIVE_BACKUP_MAX_COUNT } from '../../services/driveBackupService';
import { ConfirmationModal } from '../common/ConfirmationModal';
import { DisconnectDriveDialog } from '../common/DisconnectDriveDialog';
import { describeSyncError, getSyncErrorDetails } from '../../services/syncErrorText';
import { DataActionConfirmationModal } from './DataActionConfirmationModal';
import { 
  Download, 
  Upload, 
  Trash2,
  Calendar, 
  Layers, 
  CheckCircle2, 
  FileText,
  Cloud,
  RefreshCw,
  LogOut,
  AlertCircle,
  Palette,
  Monitor,
  Sun,
  Moon,
  Check,
  Copy
} from 'lucide-react';

import { GoogleIcon } from '../common/GoogleIcon';
import { getThemePreference, setThemePreference, ThemePreference } from '../../services/themeService';

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: React.ReactNode }[] = [
  { value: 'system', label: 'Podle systému', icon: <Monitor className="w-4 h-4" /> },
  { value: 'light', label: 'Světlý', icon: <Sun className="w-4 h-4" /> },
  { value: 'dark', label: 'Tmavý', icon: <Moon className="w-4 h-4" /> },
];

// Původní technický text chyby synchronizace, aby ho uživatel mohl poslat autorovi
const SyncErrorDetails: React.FC<{ message: string }> = ({ message }) => {
  const [copied, setCopied] = useState(false);
  const details = getSyncErrorDetails(message);
  if (!details) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(details);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <details className="group pl-6 text-xs">
      <summary className="max-md:min-h-11 flex items-center cursor-pointer font-semibold text-red-700 hover:text-red-800 select-none rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30">
        Technické podrobnosti
      </summary>
      <div className="mt-2 space-y-2">
        <pre className="p-2 max-h-40 overflow-auto bg-white border border-red-200 rounded-lg text-slate-600 whitespace-pre-wrap break-all font-mono">{details}</pre>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="max-md:min-h-11 inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-red-200 rounded-lg font-semibold text-red-700 hover:bg-red-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30"
        >
          {copied ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
          <span aria-live="polite">{copied ? 'Zkopírováno' : 'Zkopírovat'}</span>
        </button>
      </div>
    </details>
  );
};

// Obsah stránky pro široké obrazovky; názvy odpovídají nadpisům sekcí.
const SETTINGS_SECTIONS = [
  { id: 'nastaveni-obdobi', label: 'Rozpočtové období a pravidla' },
  { id: 'nastaveni-ucty', label: 'Započítání účtů' },
  { id: 'nastaveni-vzhled', label: 'Vzhled' },
  { id: 'nastaveni-disk', label: 'Synchronizace s Google Diskem' },
  { id: 'nastaveni-zalohy', label: 'Záloha do souboru' },
  { id: 'nastaveni-data', label: 'Mazání dat' },
] as const;

type SettingsSectionId = typeof SETTINGS_SECTIONS[number]['id'];

const SECTION_CLASS = 'scroll-mt-6 focus:outline-none';

// Najde nejbližšího předka, který se posouvá (obsah aplikace neroluje celé okno).
function getScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
    node = node.parentElement;
  }
  return null;
}

const SettingsOutline: React.FC<{ contentRef: React.RefObject<HTMLDivElement> }> = ({ contentRef }) => {
  const [activeId, setActiveId] = useState<SettingsSectionId>(SETTINGS_SECTIONS[0].id);
  // Po kliknutí drží zvolenou sekci, dokud plynulé posouvání nedoběhne (spodní sekce nedojedou nahoru).
  const clickedRef = useRef<{ id: SettingsSectionId; until: number } | null>(null);

  useEffect(() => {
    const scroller = getScrollParent(contentRef.current);
    if (!scroller) return;
    const update = () => {
      const clicked = clickedRef.current;
      if (clicked && Date.now() < clicked.until) {
        clicked.until = Date.now() + 150;
        return;
      }
      const top = scroller.getBoundingClientRect().top + 96;
      const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4;
      let current: SettingsSectionId = SETTINGS_SECTIONS[0].id;
      for (const { id } of SETTINGS_SECTIONS) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= top) current = id;
      }
      setActiveId(atBottom ? SETTINGS_SECTIONS[SETTINGS_SECTIONS.length - 1].id : current);
    };
    update();
    scroller.addEventListener('scroll', update, { passive: true });
    return () => scroller.removeEventListener('scroll', update);
  }, [contentRef]);

  const goTo = (id: SettingsSectionId) => {
    const el = document.getElementById(id);
    if (!el) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    el.focus({ preventScroll: true });
    clickedRef.current = { id, until: Date.now() + 150 };
    setActiveId(id);
  };

  return (
    <nav aria-label="Obsah nastavení" className="hidden xl:block sticky top-6 space-y-2">
      <p className="px-3 text-xs font-bold uppercase tracking-wide text-slate-500">Na této stránce</p>
      <ul className="space-y-0.5">
        {SETTINGS_SECTIONS.map(({ id, label }) => {
          const isActive = activeId === id;
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => goTo(id)}
                aria-current={isActive ? 'location' : undefined}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs font-semibold leading-snug transition-colors ${
                  isActive
                    ? 'bg-sky-50 text-sky-700'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

export const SettingsScreen: React.FC = () => {
  const fieldId = useId();
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
    investmentFees,
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
    driveBackupEnabled,
    setDriveBackupEnabled,
    lastDriveBackupTime,
    runDriveBackupNow,
  } = useFinance();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [restorePreview, setRestorePreview] = useState<RestorePreview | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const [budgetStartDay, setBudgetStartDay] = useState(settings.budgetStartDay);
  const [overdraftLimitStr, setOverdraftLimitStr] = useState(
    halerToInputValue(settings.overdraftLimitInHaler ?? settings.minReserveInHaler ?? 0)
  );
  const [roundAmounts, setRoundAmounts] = useState(settings.roundAmounts);
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(() => getThemePreference());

  const handleThemeChange = (preference: ThemePreference) => {
    setThemePreference(preference);
    setThemePreferenceState(preference);
  };

  // Potvrzovací dialogy
  const [confirmStartDayOpen, setConfirmStartDayOpen] = useState(false);
  const [pendingStartDay, setPendingStartDay] = useState<number | null>(null);

  const [confirmLoadDemoOpen, setConfirmLoadDemoOpen] = useState(false);
  const [confirmClearTransactionsOpen, setConfirmClearTransactionsOpen] = useState(false);
  const [confirmClearAccountsOpen, setConfirmClearAccountsOpen] = useState(false);
  const [confirmClearCategoriesOpen, setConfirmClearCategoriesOpen] = useState(false);
  const [confirmResetAllOpen, setConfirmResetAllOpen] = useState(false);
  const [confirmDisconnectOpen, setConfirmDisconnectOpen] = useState(false);

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

  // Kontokorent se ukládá sám po opuštění pole nebo Enteru, stejně jako ostatní nastavení
  const [overdraftSaved, setOverdraftSaved] = useState(false);
  useEffect(() => {
    if (!overdraftSaved) return;
    const timer = window.setTimeout(() => setOverdraftSaved(false), 2500);
    return () => window.clearTimeout(timer);
  }, [overdraftSaved]);

  const saveOverdraft = () => {
    const overdraftHaler = Math.abs(parseInputToHaler(overdraftLimitStr));
    const currentHaler = settings.overdraftLimitInHaler ?? settings.minReserveInHaler ?? 0;
    if (overdraftHaler === currentHaler) {
      setOverdraftLimitStr(halerToInputValue(currentHaler));
      return;
    }
    updateSettings({
      overdraftLimitInHaler: overdraftHaler,
      minReserveInHaler: overdraftHaler, // Pro zpětnou kompatibilitu
      roundAmounts,
    });
    setOverdraftSaved(true);
  };

  const handleSaveGeneral = (e: React.FormEvent) => {
    e.preventDefault();
    saveOverdraft();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (!content) return;
      // Nejdřív jen náhled: sloučení proběhne až po potvrzení v dialogu.
      try {
        const parsed = validateAndParseBackup(content);
        setRestorePreview({
          fileName: file.name,
          content,
          ...buildRestorePreview(parsed, {
            transactions, accounts, categories, recurringRules,
            recurringExceptions, corrections, marketValueSnapshots, investmentFees,
          }),
        });
      } catch {
        // Neplatný soubor nahlásí importJSON stejnou chybou jako dřív.
        importJSON(content);
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div>
      <div className="xl:grid xl:grid-cols-[minmax(0,56rem)_13rem] xl:gap-8 xl:items-start">
        <div ref={contentRef} className="space-y-6 max-w-4xl min-w-0">
          {/* 1. Finanční pravidla a rozpočtový měsíc */}
          <section id="nastaveni-obdobi" tabIndex={-1} aria-labelledby="nastaveni-obdobi-title" className={`${SECTION_CLASS} card p-5 space-y-4`}>
            <div className="flex items-center gap-2.5 pb-4 border-b border-slate-100">
              <div className="p-2 rounded-xl bg-slate-100 text-slate-500">
                <Calendar className="w-5 h-5" />
              </div>
              <div>
                <h2 id="nastaveni-obdobi-title" className="text-base font-bold text-slate-900">Rozpočtové období a pravidla</h2>
                <p className="text-xs text-slate-500">
                  Kdy začíná rozpočtové období a jak hluboko smí výchozí účet do mínusu
                </p>
              </div>
            </div>

            <form onSubmit={handleSaveGeneral} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Počáteční den období */}
                <div>
                  <label htmlFor={`${fieldId}-1`} className="block text-xs font-semibold text-slate-500 mb-1">
                    Období začíná
                  </label>
                  <select id={`${fieldId}-1`}
                    value={budgetStartDay}
                    onChange={(e) => handleStartDayChange(parseInt(e.target.value, 10))}
                    className="w-full max-md:min-h-11 px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 font-semibold text-slate-900"
                  >
                    {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                      <option key={day} value={day}>
                        {`${day}. den v měsíci`}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-500 mt-1">
                    {budgetStartDay === 1
                      ? 'Období odpovídá kalendářnímu měsíci (např. 1. 9. – 30. 9.).'
                      : `Období trvá od ${budgetStartDay}. dne v měsíci do ${budgetStartDay - 1}. dne následujícího měsíce.`}
                  </p>
                </div>

                {/* Výše kontokorentu */}
                <div>
                  <label htmlFor={`${fieldId}-2`} className="block text-xs font-semibold text-slate-500 mb-1">
                    Kontokorent
                  </label>
                  <div className="relative">
                    <input id={`${fieldId}-2`}
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={overdraftLimitStr}
                      onChange={(e) => setOverdraftLimitStr(e.target.value)}
                      onBlur={saveOverdraft}
                      aria-describedby={`${fieldId}-2-hint`}
                      className="w-full max-md:min-h-11 pl-3.5 pr-10 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 font-semibold"
                    />
                    <span className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-xs font-semibold text-slate-500">Kč</span>
                  </div>
                  <p id={`${fieldId}-2-hint`} className="text-xs text-slate-500 mt-1">
                    Kolik smí výchozí účet jít do mínusu, např. 20 000. Uloží se po opuštění pole.
                  </p>
                  <p role="status" className="text-xs font-semibold text-emerald-600 mt-1 min-h-[1rem] flex items-center gap-1">
                    {overdraftSaved && (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                        Kontokorent uložen
                      </>
                    )}
                  </p>
                </div>

              </div>
            </form>
          </section>

          {/* 2. Zahrnutí jednotlivých účtů do rozpočtu */}
          <section id="nastaveni-ucty" tabIndex={-1} aria-labelledby="nastaveni-ucty-title" className={`${SECTION_CLASS} card p-5 space-y-4`}>
            <div className="flex items-center gap-2.5 pb-4 border-b border-slate-100">
              <div className="p-2 rounded-xl bg-slate-100 text-slate-500">
                <Layers className="w-5 h-5" />
              </div>
              <div>
                <h2 id="nastaveni-ucty-title" className="text-base font-bold text-slate-900">Započítání účtů</h2>
                <p className="text-xs text-slate-500">
                  Které účty se počítají do použitelných peněz a které do celkového majetku
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
                      <span className="text-slate-500">{acc.institution || 'Banka neuvedena'}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 max-md:min-h-11 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={acc.isUsableCash}
                        onChange={(e) => updateAccount({ ...acc, isUsableCash: e.target.checked })}
                        className="w-4 h-4 text-sky-600 rounded border-slate-300 focus:ring-sky-500"
                      />
                      <span className="font-medium text-slate-500">Použitelné peníze</span>
                    </label>

                    <label className="flex items-center gap-2 max-md:min-h-11 cursor-pointer select-none">
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
          </section>

          {/* Vzhled aplikace (nastavení tohoto zařízení) */}
          <section id="nastaveni-vzhled" tabIndex={-1} aria-labelledby="nastaveni-vzhled-title" className={`${SECTION_CLASS} card p-5 space-y-4`}>
            <div className="flex items-center gap-2.5 pb-4 border-b border-slate-100">
              <div className="p-2 rounded-xl bg-slate-100 text-slate-500">
                <Palette className="w-5 h-5" />
              </div>
              <div>
                <h2 id="nastaveni-vzhled-title" className="text-base font-bold text-slate-900">Vzhled</h2>
                <p className="text-xs text-slate-500">
                  Světlý nebo tmavý vzhled. Volba platí pro toto zařízení a nesynchronizuje se.
                </p>
              </div>
            </div>

            <div role="group" aria-label="Vzhled aplikace" className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-xl max-w-md">
              {THEME_OPTIONS.map((option) => {
                const active = themePreference === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => handleThemeChange(option.value)}
                    className={`min-h-11 flex flex-col sm:flex-row items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-semibold transition-colors ${
                      active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    <span className={active ? 'text-sky-600' : ''}>{option.icon}</span>
                    <span>{option.label}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* 3. Google Disk – Cloudová synchronizace */}
          <section id="nastaveni-disk" tabIndex={-1} aria-labelledby="nastaveni-disk-title" className={`${SECTION_CLASS} card p-5 space-y-4`}>
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 flex-wrap gap-2">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-slate-100 text-slate-500">
                  <Cloud className="w-5 h-5" />
                </div>
                <div>
                  <h2 id="nastaveni-disk-title" className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <span>Synchronizace s Google Diskem</span>
                  </h2>
                  <p className="text-xs text-slate-500">
                    Data se průběžně ukládají do skryté složky aplikace ve vašem Google Disku
                  </p>
                </div>
              </div>

              {!isDriveConnected ? (
                <button
                  type="button"
                  onClick={connectGoogleDrive}
                  disabled={driveSyncStatus === 'syncing'}
                  className="btn-secondary"
                >
                  <GoogleIcon className="w-4 h-4 shrink-0" />
                  <span>{driveSyncStatus === 'syncing' ? 'Připojuji…' : 'Připojit Google Disk'}</span>
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => syncWithGoogleDrive('upload')}
                    disabled={driveSyncStatus === 'syncing'}
                    className="max-md:min-h-11 flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-sky-50 hover:bg-sky-100 text-sky-700 transition-colors cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${driveSyncStatus === 'syncing' ? 'animate-spin' : ''}`} />
                    <span>Synchronizovat nyní</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setConfirmDisconnectOpen(true)}
                    className="max-md:min-h-11 flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Odpojit Google Disk</span>
                  </button>
                </div>
              )}
            </div>

            {/* Informační obsah */}
            {!isDriveConnected ? (
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-500 space-y-2">
                <p className="font-semibold text-slate-900">
                  Proč připojit Google Disk?
                </p>
                <ul className="list-disc list-inside space-y-1 text-slate-500">
                  <li><strong>Funguje i bez připojení:</strong> změny se uloží v zařízení a odešlou se, jakmile to půjde.</li>
                  <li><strong>Soukromé úložiště:</strong> data leží ve skryté složce aplikace, kterou jiné aplikace ani vyhledávání na Disku nevidí.</li>
                  <li><strong>Průběžná záloha:</strong> každá změna se na pozadí uloží na váš Google Disk.</li>
                </ul>
              </div>
            ) : (
              <div className="space-y-3 text-xs">
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-3">
                    {driveUser?.photoLink ? (
                      <img
                        src={driveUser.photoLink}
                        alt={driveUser.displayName || 'Účet Google'}
                        className="w-10 h-10 rounded-full border border-slate-200 shrink-0"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-sky-100 text-sky-700 flex items-center justify-center font-bold text-sm shrink-0">
                        {driveUser?.displayName ? driveUser.displayName[0].toUpperCase() : 'G'}
                      </div>
                    )}
                    <div>
                      <p className="font-bold text-slate-900">{driveUser?.displayName || 'Účet Google'}</p>
                      <p className="text-xs text-slate-500">{driveUser?.emailAddress || 'Připojeno ke Google Disku'}</p>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="flex justify-end">
                      <SyncStatusLabel status={driveSyncStatus} />
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Poslední synchronizace: {formatLastSync(lastDriveSyncTime)}
                    </p>
                  </div>
                </div>

                {driveError && (
                  <div className="panel panel-error space-y-2">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{describeSyncError(driveError)}</span>
                    </div>
                    <SyncErrorDetails message={driveError} />
                  </div>
                )}

                {/* Synchronizace má jediné tlačítko „Synchronizovat“ v záhlaví sekce: nahrání i stažení dělají totéž */}
                <div className="pt-3 mt-1 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Automatické zálohy na Disk</h3>
                    <p className="text-xs text-slate-500 mt-0.5 max-w-md">
                      Při spuštění aplikace (nejvýše jednou za 24 hodin) se uloží kopie dat do složky
                      <strong> „CashPilot zalohy“</strong> na vašem Google Disku. Uchovává se posledních {DRIVE_BACKUP_MAX_COUNT} záloh.
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      Poslední záloha: {lastDriveBackupTime ? lastDriveBackupTime.toLocaleString('cs-CZ') : 'zatím žádná'}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      type="button"
                      onClick={() => void runDriveBackupNow()}
                      className="max-md:min-h-11 px-3 py-1.5 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors cursor-pointer"
                    >
                      Zálohovat nyní
                    </button>
                    <label className="flex items-center gap-2 max-md:min-h-11 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={driveBackupEnabled}
                        onChange={(e) => setDriveBackupEnabled(e.target.checked)}
                        className="w-4 h-4 text-sky-600 rounded border-slate-300 focus:ring-sky-500"
                      />
                      <span className="text-xs font-medium text-slate-500">Zálohovat automaticky</span>
                    </label>
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* 4. Zálohování a Export */}
          <section id="nastaveni-zalohy" tabIndex={-1} aria-labelledby="nastaveni-zalohy-title" className={`${SECTION_CLASS} card p-5 space-y-4`}>
            <div className="flex items-center gap-2.5 pb-4 border-b border-slate-100">
              <div className="p-2 rounded-xl bg-slate-100 text-slate-500">
                <Download className="w-5 h-5" />
              </div>
              <div>
                <h2 id="nastaveni-zalohy-title" className="text-base font-bold text-slate-900">Záloha do souboru</h2>
                <p className="text-xs text-slate-500">
                  Stáhněte si všechna data do souboru nebo je ze souboru obnovte
                </p>
              </div>
            </div>

            {/* Stejný vzor řádků jako v Mazání dat: popis vlevo, akce vpravo */}
            <div className="divide-y divide-slate-200">
              {[
                { title: 'Stáhnout zálohu (JSON)', text: 'Všechna data a nastavení v jednom souboru.', label: 'Stáhnout zálohu', icon: Download, onClick: exportJSON },
                { title: 'Obnovit ze zálohy', text: 'Sloučí soubor .json s aktuálními daty. Nic se nesmaže ani nepřepíše.', label: 'Vybrat soubor', icon: Upload, onClick: () => fileInputRef.current?.click() },
                { title: 'Stáhnout položky (CSV)', text: 'Pro Excel nebo jiné tabulky.', label: 'Stáhnout CSV', icon: FileText, onClick: exportCSV },
              ].map(({ title, text, label, icon: Icon, onClick }) => (
                <div key={title} className="flex flex-col sm:flex-row sm:items-center justify-between py-4 first:pt-0 last:pb-0 gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">{title}</h3>
                    <p className="text-xs text-slate-500 mt-0.5">{text}</p>
                  </div>
                  <button
                    type="button"
                    onClick={onClick}
                    className="btn-secondary shrink-0 self-start sm:self-center"
                  >
                    <Icon className="w-4 h-4" aria-hidden="true" />
                    {label}
                  </button>
                </div>
              ))}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleFileChange}
              className="hidden"
            />
          </section>

          {/* 4. Správa dat a reset */}
          <section id="nastaveni-data" tabIndex={-1} aria-labelledby="nastaveni-data-title" className={`${SECTION_CLASS} card p-5 space-y-4`}>
            <div className="flex items-center gap-2.5 pb-4 border-b border-slate-100">
              {/* Jediná barevná ikona sekcí: mazání dat nese význam, ostatní jsou neutrální */}
              <div className="p-2 rounded-xl bg-red-50 text-red-600">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h2 id="nastaveni-data-title" className="text-base font-bold text-slate-900">Mazání dat</h2>
                <p className="text-xs text-slate-500">
                  Smažte jen část dat, nebo všechno najednou. Před smazáním nabídneme stažení zálohy.
                </p>
              </div>
            </div>

            {/* Správa jednotlivých dat */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Smazat část dat
              </h3>

              <div className="divide-y divide-slate-200">
                {/* 1. Vymazat všechny transakce */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between py-4 first:pt-0 last:pb-0 gap-3">
                  <div>
                    <h4 className="text-sm font-bold text-slate-900">Smazat všechny položky</h4>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Smaže položky, pravidelné položky a korekce zůstatků. Účty, kategorie a nastavení zůstanou.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setConfirmClearTransactionsOpen(true)}
                    className="max-md:min-h-11 px-4 py-2 text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-xl transition-colors shrink-0 self-start sm:self-center"
                  >
                    Smazat všechny položky
                  </button>
                </div>

                {/* 2. Vymazat všechny účty */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between py-4 first:pt-0 last:pb-0 gap-3">
                  <div>
                    <h4 className="text-sm font-bold text-slate-900">Smazat všechny účty</h4>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Smaže účty i všechno, co k nim patří: položky, převody, korekce a tržní hodnoty. Kategorie a nastavení zůstanou.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setConfirmClearAccountsOpen(true)}
                    className="max-md:min-h-11 px-4 py-2 text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-xl transition-colors shrink-0 self-start sm:self-center"
                  >
                    Smazat všechny účty
                  </button>
                </div>

                {/* 3. Vymazat všechny kategorie */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between py-4 first:pt-0 last:pb-0 gap-3">
                  <div>
                    <h4 className="text-sm font-bold text-slate-900">Smazat všechny kategorie</h4>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Smaže kategorie i podkategorie. Položky zůstanou, jen budou bez kategorie.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setConfirmClearCategoriesOpen(true)}
                    className="max-md:min-h-11 px-4 py-2 text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-xl transition-colors shrink-0 self-start sm:self-center"
                  >
                    Smazat všechny kategorie
                  </button>
                </div>
              </div>
            </div>

            {/* Smazání všeho: stejný řádek jako výše, váhu nese plné červené tlačítko */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Smazat vše
              </h3>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-bold text-slate-900">Smazat všechna data</h4>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Smaže účty, položky, kategorie i nastavení. Aplikace začne od nuly.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setConfirmResetAllOpen(true)}
                  className="btn-danger shrink-0 self-start sm:self-center"
                >
                  Smazat všechna data
                </button>
              </div>
            </div>

            {/* Načíst ukázková data (pouze při zapnutém demo režimu) */}
            {isDemoModeEnabled() && (
              <div className="pt-2 border-t border-slate-100 flex justify-end">
                <button
                  type="button"
                  onClick={() => setConfirmLoadDemoOpen(true)}
                  className="max-md:min-h-11 px-3 py-1.5 text-xs font-medium text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-lg transition-colors"
                >
                  Načíst ukázková data (demo režim)
                </button>
              </div>
            )}
          </section>
        </div>
        <SettingsOutline contentRef={contentRef} />
      </div>

      {/* Odpojení Disku se potvrzuje stejně jako z hlavičky */}
      <DisconnectDriveDialog isOpen={confirmDisconnectOpen} onClose={() => setConfirmDisconnectOpen(false)} />

      {/* Potvrzovací dialog pro změnu začátku měsíce */}
      <ConfirmationModal
        isOpen={confirmStartDayOpen}
        onClose={handleCancelStartDayChange}
        onConfirm={handleConfirmStartDayChange}
        title="Změnit začátek období?"
        message={`Období budou začínat ${pendingStartDay ?? budgetStartDay}. dnem v měsíci. Některé položky se tím přesunou do jiného období a zůstatky se přepočítají.`}
        confirmText="Změnit začátek období"
      />

      {/* Potvrzovací dialog pro načtení demo dat (pouze demo režim) */}
      <ConfirmationModal
        isOpen={confirmLoadDemoOpen}
        onClose={() => setConfirmLoadDemoOpen(false)}
        onConfirm={loadDemoData}
        title="Nahradit data ukázkovými?"
        message="Všechna současná data nahradí ukázkové účty, mzda, hypotéka a výdaje. Pokud chcete svá data zachovat, nejdřív si stáhněte zálohu."
        confirmText="Nahradit ukázkovými daty"
      />

      <RestoreConfirmationModal
        preview={restorePreview}
        onClose={() => setRestorePreview(null)}
        onConfirm={importJSON}
      />

      {/* Dialog 1: Vymazat všechny transakce */}
      <DataActionConfirmationModal
        isOpen={confirmClearTransactionsOpen}
        onClose={() => setConfirmClearTransactionsOpen(false)}
        onConfirm={() => {
          clearAllTransactions();
          setConfirmClearTransactionsOpen(false);
        }}
        title="Smazat všechny položky?"
        description="Smaže položky, pravidelné položky a korekce zůstatků. Účty, kategorie a nastavení zůstanou."
        affectedRecords={[
          { label: 'Položky', count: transactions.length },
          { label: 'Pravidelné položky', count: recurringRules.length },
          { label: 'Upravené výskyty pravidelných položek', count: recurringExceptions.length },
          { label: 'Korekce zůstatků', count: corrections.length },
        ]}
        confirmButtonText="Smazat všechny položky"
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
        title="Smazat všechny účty?"
        description="Smaže všechny účty i všechno, co k nim patří: položky, převody, pravidelné položky, korekce a tržní hodnoty. Kategorie a nastavení zůstanou."
        affectedRecords={[
          { label: 'Účty (i archivované)', count: accounts.length },
          { label: 'Položky', count: transactions.length },
          { label: 'Pravidelné položky', count: recurringRules.length },
          { label: 'Upravené výskyty pravidelných položek', count: recurringExceptions.length },
          { label: 'Korekce zůstatků', count: corrections.length },
          { label: 'Tržní hodnoty', count: marketValueSnapshots.length },
        ]}
        confirmButtonText="Smazat všechny účty"
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
        title="Smazat všechny kategorie?"
        description="Smaže všechny kategorie a podkategorie. Položky a pravidelné položky zůstanou, jen budou bez kategorie."
        affectedRecords={[
          { label: 'Hlavní kategorie', count: categories.filter(c => !c.parentId).length },
          { label: 'Podkategorie', count: categories.filter(c => !!c.parentId).length },
          { label: 'Položky, které ztratí kategorii', count: transactions.filter(t => t.categoryId).length },
          { label: 'Pravidelné položky, které ztratí kategorii', count: recurringRules.filter(r => r.categoryId).length },
        ]}
        confirmButtonText="Smazat všechny kategorie"
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
        title="Smazat všechna data?"
        description="Smaže účty, položky, pravidelné položky, kategorie, korekce, tržní hodnoty i nastavení. Aplikace začne od nuly."
        affectedRecords={[
          { label: 'Účty', count: accounts.length },
          { label: 'Položky', count: transactions.length },
          { label: 'Pravidelné položky', count: recurringRules.length },
          { label: 'Korekce zůstatků', count: corrections.length },
          { label: 'Tržní hodnoty', count: marketValueSnapshots.length },
          { label: 'Kategorie a podkategorie', count: categories.length },
        ]}
        confirmButtonText="Smazat všechna data"
        onDownloadBackup={exportJSON}
        requiresConfirmationPhrase={true}
        confirmationPhrase="VYMAZAT VŠE"
      />
    </div>
  );
};
