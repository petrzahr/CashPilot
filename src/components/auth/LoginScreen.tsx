import React from 'react';
import { useFinance } from '../../context/FinanceContext';
import { GoogleIcon } from '../common/GoogleIcon';
import { Compass, ShieldCheck, Zap, TrendingUp, AlertCircle, Loader2 } from 'lucide-react';

export const LoginScreen: React.FC = () => {
  const { connectGoogleDrive, driveSyncStatus, driveError } = useFinance();
  const isSyncing = driveSyncStatus === 'syncing';

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
            Inteligentní plánování příjmů, výdajů a predikce zůstatků účtů v čase s bezpečným privátním cloudovým úložištěm.
          </p>
        </div>

        {/* Přehled výhod */}
        <div className="bg-slate-50/80 rounded-2xl p-4 border border-slate-200/60 space-y-3 text-xs text-slate-600">
          <div className="flex items-start gap-3">
            <div className="p-1 rounded-lg bg-sky-100 text-sky-700 shrink-0 mt-0.5">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <span className="font-semibold text-slate-800 block">Privátní Google Disk</span>
              <span>Data se ukládají v privátním aplikačním prostoru vašeho účtu Google.</span>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="p-1 rounded-lg bg-emerald-100 text-emerald-700 shrink-0 mt-0.5">
              <Zap className="w-4 h-4" />
            </div>
            <div>
              <span className="font-semibold text-slate-800 block">Tichá synchronizace</span>
              <span>Rychlá práce v mezipaměti a automatické ukládání změn na pozadí.</span>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="p-1 rounded-lg bg-indigo-100 text-indigo-700 shrink-0 mt-0.5">
              <TrendingUp className="w-4 h-4" />
            </div>
            <div>
              <span className="font-semibold text-slate-800 block">Výhled a kontokorent</span>
              <span>Dlouhodobý horizont a hlídání limitů vašich bankovních účtů.</span>
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

      </div>

      {/* Patička */}
      <footer className="mt-8 text-center text-xs text-slate-400 font-medium">
        CashPilot &bull; Vaše osobní finance pod kontrolou
      </footer>
    </div>
  );
};
