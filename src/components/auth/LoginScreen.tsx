import React, { useState } from 'react';
import { useFinance } from '../../context/FinanceContext';
import { GoogleIcon } from '../common/GoogleIcon';
import { AlertCircle, Loader2, Mail, Check } from 'lucide-react';
import { buildGmailComposeUrl, ACCESS_REQUEST_EMAIL } from '../../constants/authConfig';
import { describeLoginError } from '../../services/syncErrorText';

export const LoginScreen: React.FC = () => {
  const { connectGoogleDrive, driveSyncStatus, driveError } = useFinance();
  const isSyncing = (driveSyncStatus === 'syncing' || driveSyncStatus === 'loading');
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
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-4 sm:p-6 select-none">
      {/* Minimální vstup: kdo jsem, jedna akce, cesta pro ty, kdo přístup nemají */}
      <div className="max-w-sm w-full bg-white rounded-2xl border border-slate-200 shadow-sm p-7 sm:p-8 space-y-6">

        {/* Logo a hlavička */}
        <div className="text-center space-y-3">
          <div className={`inline-flex items-center justify-center w-14 h-14 rounded-2xl ${isSyncing ? 'animate-pulse motion-reduce:animate-none' : ''}`}>
            <img src="./favicon.svg?v=3" alt="" className="w-full h-full rounded-2xl" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 leading-tight">
              CashPilot
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Vaše osobní finance pod kontrolou
            </p>
          </div>
        </div>

        {/* Chybové hlášení při selhání přihlášení */}
        {driveError && (
          <div className="panel panel-error flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold block">Přihlášení se nezdařilo</span>
              <span className="text-red-600">{describeLoginError(driveError)}</span>
            </div>
          </div>
        )}

        {/* Hlavní akce - Tlačítko přihlášení */}
        <div>
          <button
            type="button"
            onClick={connectGoogleDrive}
            disabled={isSyncing}
            className="w-full min-h-12 flex items-center justify-center gap-3 px-6 py-3 rounded-xl bg-white hover:bg-slate-50 text-slate-900 font-bold border border-slate-300 shadow-sm hover:border-sky-300 transition-colors active:scale-[0.99] cursor-pointer disabled:opacity-75 disabled:cursor-not-allowed text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40"
          >
            {isSyncing ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin text-sky-600" />
                <span>Přihlašuji a načítám data…</span>
              </>
            ) : (
              <>
                <GoogleIcon className="w-5 h-5 shrink-0" />
                <span>Přihlásit se přes Google</span>
              </>
            )}
          </button>
        </div>

        {/* Žádost o přístup: aplikace je jen pro schválené testovací uživatele */}
        <div className="pt-5 border-t border-slate-100 text-center text-xs text-slate-500 space-y-1 select-text">
          <h2 className="font-semibold text-slate-600">Nemáte přístup?</h2>
          {/* Adresa je vidět i jako text, aby šla označit a zkopírovat ručně */}
          <p className="select-all text-slate-600 break-all">{ACCESS_REQUEST_EMAIL}</p>
          <div className="flex flex-col items-center">
            <a
              href={buildGmailComposeUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="min-h-11 md:min-h-8 inline-flex items-center gap-1.5 px-2 rounded-lg font-semibold text-sky-700 hover:bg-sky-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40"
            >
              <Mail className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>Požádat o přístup přes Gmail</span>
            </a>
            {copiedEmail ? (
              <span role="status" className="min-h-11 md:min-h-8 inline-flex items-center gap-1.5 px-2 font-medium text-emerald-600">
                <Check className="w-3.5 h-3.5" aria-hidden="true" />
                <span>E-mailová adresa byla zkopírována.</span>
              </span>
            ) : (
              <button
                type="button"
                onClick={handleCopyEmail}
                title={`Zkopírovat adresu ${ACCESS_REQUEST_EMAIL}`}
                className="min-h-11 md:min-h-8 inline-flex items-center px-2 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-50 underline underline-offset-2 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40"
              >
                Zkopírovat kontaktní e-mail
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Patička */}
      <footer className="mt-8 text-center text-xs text-slate-500 font-medium">
        CashPilot &bull; Vaše osobní finance pod kontrolou
      </footer>
    </div>
  );
};
