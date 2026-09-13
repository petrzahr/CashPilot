import React, { useState } from 'react';
import { useFinance } from '../../context/FinanceContext';
import { GoogleIcon } from '../common/GoogleIcon';
import { Compass, ShieldCheck, Zap, TrendingUp, AlertCircle, Loader2, Mail, Check } from 'lucide-react';
import { buildGmailComposeUrl, ACCESS_REQUEST_EMAIL } from '../../constants/authConfig';

export const LoginScreen: React.FC = () => {
  const { connectGoogleDrive, driveSyncStatus, driveError } = useFinance();
  const isSyncing = driveSyncStatus === 'syncing';
  const [copiedEmail, setCopiedEmail] = useState(false);

  const handleCopyEmail = async (e: React.MouseEvent) => {
    e.preventDefault();
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(ACCESS_REQUEST_EMAIL);
        setCopiedEmail(true);
        setTimeout(() => setCopiedEmail(false), 3000);
      } else if (typeof document !== 'undefined') {
        const textarea = document.createElement('textarea');
        textarea.value = ACCESS_REQUEST_EMAIL;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        setCopiedEmail(true);
        setTimeout(() => setCopiedEmail(false), 3000);
      }
    } catch {
      // Fallback v případě selhání schránky
      if (typeof window !== 'undefined') {
        window.prompt('Zkopírujte si prosím kontaktní e-mail:', ACCESS_REQUEST_EMAIL);
      }
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-sky-50/40 to-slate-100 flex flex-col justify-center items-center p-4 sm:p-6 select-none">
      <div className="max-w-md w-full bg-white rounded-3xl border border-slate-200/80 shadow-xl shadow-slate-200/60 p-7 sm:p-9 space-y-7">
        
        {/* Logo a hlavička */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-tr from-sky-600 to-sky-500 text-white shadow-lg shadow-sky-500/25 mb-1">
            <Compass className="w-9 h-9" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 leading-tight">
              CashPilot
            </h1>
            <p className="text-xs text-sky-600 font-bold uppercase tracking-wider mt-0.5">
              Osobní rozpočet & forecast
            </p>
          </div>
          <p className="text-sm text-slate-600 pt-1 leading-relaxed">
            Mějte své příjmy, výdaje i budoucí vývoj zůstatků pod kontrolou. Data jsou bezpečně uložena v soukromém prostoru vašeho účtu Google.
          </p>
        </div>

        {/* Přehled výhod */}
        <div className="bg-slate-50/80 rounded-2xl p-4 border border-slate-200/60 space-y-3 text-xs text-slate-600">
          <div className="flex items-start gap-3">
            <div className="p-1 rounded-lg bg-sky-100 text-sky-700 shrink-0 mt-0.5">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <span className="font-semibold text-slate-800 block">Soukromé úložiště Google Disk</span>
              <span>Vaše finanční data jsou bezpečně uložena v neveřejném aplikačním prostoru vašeho účtu Google.</span>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="p-1 rounded-lg bg-emerald-100 text-emerald-700 shrink-0 mt-0.5">
              <Zap className="w-4 h-4" />
            </div>
            <div>
              <span className="font-semibold text-slate-800 block">Automatická synchronizace</span>
              <span>Aplikace pracuje rychle s místní mezipamětí a všechny změny průběžně ukládá na pozadí.</span>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="p-1 rounded-lg bg-indigo-100 text-indigo-700 shrink-0 mt-0.5">
              <TrendingUp className="w-4 h-4" />
            </div>
            <div>
              <span className="font-semibold text-slate-800 block">Plánování a statistiky</span>
              <span>Plánujte budoucí příjmy a výdaje a sledujte vývoj svých financí v přehledných statistikách.</span>
            </div>
          </div>
        </div>

        {/* Chybové hlášení při selhání přihlášení */}
        {driveError && (
          <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2.5 text-xs text-red-700">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold block">Přihlášení se nezdařilo</span>
              <span className="text-red-600">{driveError}</span>
            </div>
          </div>
        )}

        {/* Hlavní akce - Tlačítko přihlášení */}
        <div className="space-y-3 pt-1">
          <button
            type="button"
            onClick={connectGoogleDrive}
            disabled={isSyncing}
            className="w-full flex items-center justify-center gap-3 px-6 py-3.5 rounded-2xl bg-white hover:bg-slate-50 text-slate-800 font-bold border border-slate-300 shadow-md shadow-slate-200/50 hover:border-sky-300 hover:shadow-lg transition-all active:scale-[0.99] cursor-pointer disabled:opacity-75 disabled:cursor-not-allowed text-sm"
          >
            {isSyncing ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin text-sky-600" />
                <span>Přihlašuji a načítám data...</span>
              </>
            ) : (
              <>
                <GoogleIcon className="w-5 h-5 shrink-0" />
                <span>Přihlásit se přes Google</span>
              </>
            )}
          </button>

          <p className="text-[11px] text-center text-slate-400">
            Pro vstup do aplikace je vyžadováno přihlášení k vašemu Google účtu.
          </p>
        </div>

        {/* Oddělovač */}
        <div className="relative flex items-center py-0.5">
          <div className="flex-grow border-t border-slate-200" />
          <span className="flex-shrink mx-3 text-xs font-medium text-slate-400">nebo</span>
          <div className="flex-grow border-t border-slate-200" />
        </div>

        {/* Žádost o přístup do testovacího režimu */}
        <div className="space-y-3 text-center sm:text-left">
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-slate-800">Nemáte přístup?</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              CashPilot je momentálně dostupný pouze schváleným testovacím uživatelům. Pošlete žádost o přístup a po schválení se budete moci přihlásit svým účtem Google.
            </p>
          </div>

          <a
            href={buildGmailComposeUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 hover:text-slate-900 border border-slate-200 shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 active:scale-[0.99] cursor-pointer"
          >
            <Mail className="w-4 h-4 text-slate-500 shrink-0" />
            <span>Požádat o přístup přes Gmail</span>
          </a>

          <div className="flex flex-col items-center sm:items-start pt-0.5">
            {copiedEmail ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600">
                <Check className="w-3.5 h-3.5" />
                <span>E-mailová adresa byla zkopírována.</span>
              </span>
            ) : (
              <button
                type="button"
                onClick={handleCopyEmail}
                title={`Zkopírovat adresu ${ACCESS_REQUEST_EMAIL}`}
                className="text-xs text-slate-500 hover:text-slate-700 underline underline-offset-2 transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-sky-500 rounded"
              >
                Zkopírovat kontaktní e-mail
              </button>
            )}
          </div>
        </div>

      </div>

      {/* Patička */}
      <footer className="mt-8 text-center text-xs text-slate-400 font-medium">
        CashPilot &bull; Vaše osobní finance pod kontrolou
      </footer>
    </div>
  );
};
