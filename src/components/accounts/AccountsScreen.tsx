import React, { useState } from 'react';
import { useFinance } from '../../context/FinanceContext';
import { Account, AccountType } from '../../types/finance';
import { formatCurrency, subHaler } from '../../services/currencyService';
import { formatCzechDate } from '../../services/periodService';
import { AccountModal } from './AccountModal';
import { ReconciliationModal } from './ReconciliationModal';
import { MarketValueModal } from './MarketValueModal';
import { AccountHistoryModal } from './AccountHistoryModal';
import { 
  Plus, 
  Wallet, 
  TrendingUp, 
  Shield, 
  Archive, 
  RotateCcw, 
  Trash2, 
  Edit3, 
  CheckCircle2, 
  AlertTriangle, 
  Clock, 
  ExternalLink,
  History 
} from 'lucide-react';

export const AccountsScreen: React.FC = () => {
  const {
    accounts,
    forecast,
    selectedPeriod,
    corrections,
    marketValueSnapshots,
    archiveAccount,
    restoreAccount,
    deleteAccount,
  } = useFinance();

  const [showArchived, setShowArchived] = useState(false);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);

  // Reconciliace, Tržní hodnota a Historie modály
  const [reconcileAccount, setReconcileAccount] = useState<Account | null>(null);
  const [marketValueAccount, setMarketValueAccount] = useState<Account | null>(null);
  const [historyAccount, setHistoryAccount] = useState<Account | null>(null);

  const displayedAccounts = accounts.filter(a => showArchived ? true : a.status === 'active');

  const currentSummary = forecast.periods.find(p => p.period.key === selectedPeriod.key);

  const handleOpenAdd = () => {
    setEditingAccount(null);
    setAccountModalOpen(true);
  };

  const handleOpenEdit = (acc: Account) => {
    setEditingAccount(acc);
    setAccountModalOpen(true);
  };

  const handleArchive = (acc: Account) => {
    if (acc.isDefault) {
      if (!confirm('Tento účet je nastaven jako výchozí. Po jeho archivaci aplikace již nebude mít žádný výchozí účet. Přejete si pokračovat?')) {
        return;
      }
    }
    const res = archiveAccount(acc.id);
    if (!res.success && res.message) {
      alert(res.message);
    }
  };

  const handleDelete = (acc: Account) => {
    let confirmMsg = `Opravdu si přejete smazat účet „${acc.name}“?`;
    if (acc.isDefault) {
      confirmMsg = `Tento účet je nastaven jako výchozí. Po jeho smazání aplikace již nebude mít žádný výchozí účet.\n\nOpravdu si přejete smazat účet „${acc.name}“?`;
    }
    if (confirm(confirmMsg)) {
      const res = deleteAccount(acc.id);
      if (!res.success && res.message) {
        alert(res.message);
      }
    }
  };

  const getTypeLabel = (type: AccountType) => {
    switch (type) {
      case 'checking': return 'Běžný účet';
      case 'cash': return 'Hotovost';
      case 'savings': return 'Spořicí účet';
      case 'investment': return 'Investiční účet';
      case 'pension': return 'Penzijní účet';
      case 'other': return 'Jiný účet';
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Hlavička správy účtů */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Správa finančních účtů</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Běžné, spořicí, hotovostní a investiční účty s možností kontroly skutečného zůstatku
          </p>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-medium text-slate-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="w-4 h-4 text-sky-600 rounded border-slate-300 focus:ring-sky-500"
            />
            <span>Zobrazit archivované účty</span>
          </label>

          <button
            onClick={handleOpenAdd}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-xl shadow-sm shadow-sky-200 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Přidat účet</span>
          </button>
        </div>
      </div>

      {/* Karty jednotlivých účtů */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {displayedAccounts.map((acc) => {
          const accBal = currentSummary?.accountBalances[acc.id];
          const closingBalance = accBal?.closingBalanceInHaler ?? acc.initialBalanceInHaler;
          
          // Poslední provedená korekce pro tento účet
          const accCorrections = corrections.filter(c => c.accountId === acc.id).sort((a, b) => b.checkDate.localeCompare(a.checkDate));
          const lastCorrection = accCorrections[0];

          const isInvestment = acc.type === 'investment' || acc.type === 'pension';
          const marketValue = acc.currentMarketValueInHaler || closingBalance;
          const investedPrincipal = accBal?.investedPrincipalInHaler || acc.initialBalanceInHaler;
          const unrealizedProfitHaler = subHaler(marketValue, investedPrincipal);
          const unrealizedPct = investedPrincipal > 0 ? (unrealizedProfitHaler / investedPrincipal) * 100 : 0;

          return (
            <div
              key={acc.id}
              className={`bg-white rounded-2xl border p-5 shadow-sm transition-all space-y-4 ${
                acc.status === 'archived' 
                  ? 'border-slate-200/50 bg-slate-50/50 opacity-75' 
                  : 'border-slate-200/80 hover:border-slate-300'
              }`}
            >
              {/* Hlavička karty účtu */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-4 h-4 rounded-full shrink-0 shadow-sm"
                    style={{ backgroundColor: acc.color }}
                  />
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <span>{acc.name}</span>
                      {acc.isDefault && (
                        <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-sky-100 text-sky-700 rounded">
                          Výchozí
                        </span>
                      )}
                      {acc.status === 'archived' && (
                        <span className="px-1.5 py-0.2 text-[10px] font-semibold bg-slate-200 text-slate-600 rounded">
                          Archivovaný
                        </span>
                      )}
                    </h3>
                    <p className="text-xs text-slate-400">
                      {getTypeLabel(acc.type)} {acc.institution && `• ${acc.institution}`}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleOpenEdit(acc)}
                    title="Upravit účet"
                    className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  {acc.status === 'active' ? (
                    <button
                      onClick={() => handleArchive(acc)}
                      title="Archivovat účet"
                      className="p-1 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                    >
                      <Archive className="w-4 h-4" />
                    </button>
                  ) : (
                    <button
                      onClick={() => restoreAccount(acc.id)}
                      title="Obnovit z archivu"
                      className="p-1 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-50 transition-colors"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(acc)}
                    title="Smazat účet"
                    className="p-1 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Finanční zůstatek */}
              <div className="p-3.5 bg-slate-50/70 border border-slate-100 rounded-xl space-y-1">
                <span className="text-[11px] text-slate-500 font-medium block">
                  {isInvestment ? 'Tržní hodnota portfolia' : `Očekávaný stav k ${selectedPeriod.name}`}
                </span>
                <div className={`text-xl font-extrabold truncate ${
                  closingBalance < 0 ? 'text-red-600' : 'text-slate-900'
                }`}>
                  {formatCurrency(isInvestment ? marketValue : closingBalance)}
                </div>

                {isInvestment && (
                  <div className="pt-2 mt-2 border-t border-slate-200/60 flex items-center justify-between text-xs">
                    <span className="text-slate-500">Vloženo: {formatCurrency(investedPrincipal)}</span>
                    <span className={`font-bold ${unrealizedProfitHaler >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {unrealizedProfitHaler >= 0 ? '+' : ''}{formatCurrency(unrealizedProfitHaler)} ({unrealizedPct >= 0 ? '+' : ''}{unrealizedPct.toFixed(1)} %)
                    </span>
                  </div>
                )}
              </div>

              {/* Informace o kontrole nebo ocenění */}
              <div className="text-[11px] text-slate-500 space-y-1">
                {isInvestment ? (
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-purple-400" />
                      Poslední tržní ocenění:
                    </span>
                    <span className="font-medium text-slate-700">
                      {acc.marketValueUpdatedAt ? formatCzechDate(acc.marketValueUpdatedAt) : 'Zatím neověřeno'}
                    </span>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        Poslední kontrola zůstatku:
                      </span>
                      <span className="font-medium text-slate-700">
                        {lastCorrection ? formatCzechDate(lastCorrection.checkDate) : 'Zatím neověřeno'}
                      </span>
                    </div>
                    {lastCorrection && (
                      <div className="flex items-center justify-between text-slate-400">
                        <span>Poslední korekce:</span>
                        <span className={lastCorrection.diffInHaler >= 0 ? 'text-emerald-600 font-semibold' : 'text-red-600 font-semibold'}>
                          {formatCurrency(lastCorrection.diffInHaler, { showPlus: true })}
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Příznaky zahrnutí do rozpočtu */}
              <div className="flex items-center gap-2 text-[11px] text-slate-500">
                {acc.isUsableCash && (
                  <span className="px-2 py-0.5 rounded-md bg-sky-50 text-sky-700 font-semibold">
                    Použitelné peníze
                  </span>
                )}
                {acc.isNetWorth && (
                  <span className="px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 font-semibold">
                    Celkový majetek
                  </span>
                )}
              </div>

              {/* Akční tlačítka pro účet */}
              <div className="pt-2 border-t border-slate-100 flex items-center gap-2">
                {isInvestment ? (
                  <button
                    type="button"
                    onClick={() => setMarketValueAccount(acc)}
                    className="flex-1 py-2 px-3 text-xs font-semibold text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-xl transition-colors text-center"
                  >
                    Aktualizovat tržní hodnotu
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setReconcileAccount(acc)}
                    className="flex-1 py-2 px-3 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl transition-colors text-center"
                  >
                    Aktualizovat skutečný stav
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setHistoryAccount(acc)}
                  title="Historie účtu"
                  className="py-2 px-3 text-xs font-medium text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl transition-colors flex items-center gap-1 shrink-0"
                >
                  <History className="w-3.5 h-3.5 text-slate-500" />
                  <span>Historie</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modály */}
      <AccountModal
        isOpen={accountModalOpen}
        onClose={() => setAccountModalOpen(false)}
        accountToEdit={editingAccount}
      />

      <ReconciliationModal
        isOpen={!!reconcileAccount}
        onClose={() => setReconcileAccount(null)}
        account={reconcileAccount}
      />

      <MarketValueModal
        isOpen={!!marketValueAccount}
        onClose={() => setMarketValueAccount(null)}
        account={marketValueAccount}
      />

      <AccountHistoryModal
        isOpen={!!historyAccount}
        onClose={() => setHistoryAccount(null)}
        account={historyAccount}
      />
    </div>
  );
};
