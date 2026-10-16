import React, { useState } from 'react';
import { useFinance } from '../../context/FinanceContext';
import { Account, AccountType } from '../../types/finance';
import { getAccountPeriodSummary } from '../../services/accountSummaryService';
import { formatCurrency, formatPercent, subHaler } from '../../services/currencyService';
import { formatCzechDate } from '../../services/periodService';
import { AccountModal } from './AccountModal';
import { ReconciliationModal } from './ReconciliationModal';
import { MarketValueModal } from './MarketValueModal';
import { InvestmentFeeModal } from './InvestmentFeeModal';
import { AccountHistoryModal } from './AccountHistoryModal';
import { ConfirmationModal } from '../common/ConfirmationModal';
import { MultiSelectDropdown } from '../shared/MultiSelectDropdown';
import { MoveButtons } from '../shared/MoveButtons';
import { MoveDirection, moveIdByStep, moveIdToTarget } from '../../services/reorderService';
import { describeUsage, getAccountUsage, isInUse, UsageCount } from '../../services/usageService';
import {
  Plus, 
  Archive, 
  RotateCcw, 
  Trash2, 
  Edit3, 
  CalendarCheck,
  CalendarClock,
  History,
  GripVertical
} from 'lucide-react';

export const AccountsScreen: React.FC = () => {
  const {
    accounts,
    forecast,
    selectedPeriod,
    transactions,
    corrections,
    recurringRules,
    archiveAccount,
    restoreAccount,
    deleteAccount,
    reorderAccounts,
    showToast,
  } = useFinance();

  // Čekající potvrzení archivace nebo smazání účtu (vlastní dialog místo window.confirm)
  const [pendingAction, setPendingAction] = useState<
    | { kind: 'archive'; account: Account }
    | { kind: 'blocked'; account: Account; usage: UsageCount }
    | null
  >(null);

  const [showArchived, setShowArchived] = useState(false);
  const [typeFilters, setTypeFilters] = useState<AccountType[]>([]);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);

  // Reconciliace, Tržní hodnota a Historie modály
  const [reconcileAccount, setReconcileAccount] = useState<Account | null>(null);
  const [marketValueAccount, setMarketValueAccount] = useState<Account | null>(null);
  const [feeAccount, setFeeAccount] = useState<Account | null>(null);
  const [historyAccount, setHistoryAccount] = useState<Account | null>(null);

  // Změna pořadí účtů přetažením (drag-and-drop)
  const [dragHandleAccountId, setDragHandleAccountId] = useState<string | null>(null);
  const [draggedAccountId, setDraggedAccountId] = useState<string | null>(null);
  const [dropTargetAccountId, setDropTargetAccountId] = useState<string | null>(null);

  const displayedAccounts = accounts
    .filter(a => showArchived ? true : a.status === 'active')
    .filter(a => typeFilters.length === 0 || typeFilters.includes(a.type));

  const currentSummary = getAccountPeriodSummary(forecast, selectedPeriod.key);

  const resetDragState = () => {
    setDragHandleAccountId(null);
    setDraggedAccountId(null);
    setDropTargetAccountId(null);
  };

  const handleDragStart = (e: React.DragEvent, accId: string) => {
    e.dataTransfer.setData('text/plain', accId);
    e.dataTransfer.effectAllowed = 'move';
    setDraggedAccountId(accId);
  };

  const handleDragOver = (e: React.DragEvent, accId: string) => {
    if (!draggedAccountId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dropTargetAccountId !== accId) {
      setDropTargetAccountId(accId);
    }
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const sourceId = draggedAccountId || e.dataTransfer.getData('text/plain');
    // Pořadí se počítá nad úplným seznamem účtů, aby skryté archivované
    // účty zůstaly na své relativní pozici.
    const orderedIds = sourceId ? moveIdToTarget(accounts.map(a => a.id), sourceId, targetId) : null;
    if (orderedIds) reorderAccounts(orderedIds);
    resetDragState();
  };

  // Posun o jedno místo tlačítky (dotyk a klávesnice), sousedem je předchozí/další zobrazený účet
  const handleMoveAccount = (accId: string, direction: MoveDirection) => {
    const orderedIds = moveIdByStep(accounts.map(a => a.id), displayedAccounts.map(a => a.id), accId, direction);
    if (orderedIds) reorderAccounts(orderedIds);
  };

  const handleOpenAdd = () => {
    setEditingAccount(null);
    setAccountModalOpen(true);
  };

  const handleOpenEdit = (acc: Account) => {
    setEditingAccount(acc);
    setAccountModalOpen(true);
  };

  const runArchive = (acc: Account) => {
    const res = archiveAccount(acc.id);
    if (!res.success && res.message) {
      showToast(res.message, 'error');
    }
  };

  // Výchozí účet se archivuje až po potvrzení, ostatní hned (archivace je vratná)
  const handleArchive = (acc: Account) => {
    if (acc.isDefault) {
      setPendingAction({ kind: 'archive', account: acc });
      return;
    }
    runArchive(acc);
  };

  // Použitý účet smazat nejde – místo varování „nelze vrátit“ rovnou nabídneme archivaci
  // Nepoužitý účet se smaže hned a oznámení nabídne „Vrátit“
  const handleDelete = (acc: Account) => {
    const usage = getAccountUsage(acc.id, transactions, recurringRules);
    if (isInUse(usage)) {
      setPendingAction({ kind: 'blocked', account: acc, usage });
      return;
    }
    const res = deleteAccount(acc.id);
    if (!res.success && res.message) showToast(res.message, 'error');
  };

  const confirmPendingAction = () => {
    if (!pendingAction) return;
    if (pendingAction.kind === 'archive') {
      runArchive(pendingAction.account);
      return;
    }
    if (pendingAction.account.status === 'active') runArchive(pendingAction.account);
  };

  const pendingMessage = !pendingAction
    ? ''
    : pendingAction.kind === 'blocked'
      ? `Účet „${pendingAction.account.name}“ používá ${describeUsage(pendingAction.usage)}, proto ho nejde smazat. ${
          pendingAction.account.status === 'active'
            ? `Můžete ho archivovat: zmizí z nabídek, ale historie zůstane.${pendingAction.account.isDefault ? ' Je to výchozí účet, takže potom nebude žádný účet výchozí.' : ''}`
            : 'Účet už je archivovaný, v nabídkách se nezobrazuje.'
        }`
    : `„${pendingAction.account.name}“ je výchozí účet. Po archivaci nebude žádný účet výchozí: nové položky nebudou mít předvyplněný účet a rozpočet nezobrazí souhrn období. Archivaci jde později vrátit.`;

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
    <div className="space-y-6">
      {/* Hlavička správy účtů */}
      <div className="card p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="w-full sm:w-56 text-xs">
          <MultiSelectDropdown
            placeholder="Všechny typy účtů"
            selected={typeFilters}
            onChange={(values) => setTypeFilters(values as AccountType[])}
            options={(['checking', 'cash', 'savings', 'investment', 'pension', 'other'] as AccountType[]).map(type => ({
              value: type,
              label: getTypeLabel(type) ?? type,
            }))}
          />
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-medium text-slate-500 cursor-pointer select-none">
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
            className="btn-primary"
          >
            <Plus className="w-4 h-4" />
            <span>Nový účet</span>
          </button>
        </div>
      </div>

      {displayedAccounts.length === 0 && (
        <div className="card empty-state">
          <p className="text-sm font-semibold text-slate-900">
            {accounts.length === 0 ? 'Zatím nemáte žádný účet' : 'Žádný účet neodpovídá výběru'}
          </p>
          <p className="text-xs text-slate-500">
            {accounts.length === 0
              ? 'Přidejte první účet tlačítkem Nový účet. Bez účtu nejde zapisovat položky.'
              : 'Zrušte filtr typů nebo zapněte Zobrazit archivované účty.'}
          </p>
        </div>
      )}

      {/* Karty jednotlivých účtů */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {displayedAccounts.map((acc, index) => {
          const accBal = currentSummary?.accountBalances[acc.id];
          const closingBalance = accBal?.closingBalanceInHaler ?? acc.initialBalanceInHaler;
          
          // Poslední provedená korekce pro tento účet
          const accCorrections = corrections.filter(c => c.accountId === acc.id).sort((a, b) => b.checkDate.localeCompare(a.checkDate));
          const lastCorrection = accCorrections[0];

          const isInvestment = acc.type === 'investment' || acc.type === 'pension';
          // Tržní hodnota ke konci období je tentýž údaj jako Očekávaný zůstatek (výpočet rozpočtu
          // bere poslední tržní hodnotu v období a pozdější vklady), takže výnos sedí s kartou.
          const marketValue = closingBalance;
          // Výnos = tržní hodnota − (vloženo − poplatky); zobrazené „Vloženo“ jsou čisté vklady.
          const contributedPrincipal = accBal?.contributedPrincipalInHaler ?? acc.initialBalanceInHaler;
          const feesTotal = accBal?.feesInHaler ?? 0;
          const investedPrincipal = subHaler(contributedPrincipal, feesTotal);
          const unrealizedProfitHaler = subHaler(marketValue, investedPrincipal);
          const unrealizedPct = investedPrincipal ? (unrealizedProfitHaler / investedPrincipal) * 100 : 0;

          return (
            <div
              key={acc.id}
              draggable={dragHandleAccountId === acc.id}
              onDragStart={(e) => handleDragStart(e, acc.id)}
              onDragEnd={resetDragState}
              onDragOver={(e) => handleDragOver(e, acc.id)}
              onDragLeave={() => setDropTargetAccountId(prev => (prev === acc.id ? null : prev))}
              onDrop={(e) => handleDrop(e, acc.id)}
              className={`group card p-5 transition-all space-y-4 ${
                acc.status === 'archived'
                  ? 'border-slate-200 !bg-slate-50 border-dashed'
                  : 'border-slate-200 hover:border-slate-300'
              } ${draggedAccountId === acc.id ? 'opacity-50' : ''} ${
                dropTargetAccountId === acc.id && draggedAccountId !== acc.id
                  ? 'ring-2 ring-sky-400 border-sky-300'
                  : ''
              }`}
            >
              {/* Hlavička karty účtu */}
              <div className="flex items-start justify-between gap-3 max-md:flex-wrap max-md:gap-y-1">
                <div className="flex items-center gap-2.5 min-w-0">
                  {/* Úchyt pro přetažení myší; z klávesnice a na dotyku slouží tlačítka posunu */}
                  <button
                    type="button"
                    title="Přetažením změníte pořadí účtu"
                    aria-hidden="true"
                    tabIndex={-1}
                    onMouseDown={() => setDragHandleAccountId(acc.id)}
                    onMouseUp={() => setDragHandleAccountId(null)}
                    className="max-md:hidden -ml-1.5 p-0.5 rounded-lg text-slate-500 hover:text-slate-600 hover:bg-slate-100 cursor-grab active:cursor-grabbing transition-colors shrink-0"
                  >
                    <GripVertical className="w-4 h-4" />
                  </button>
                  <div
                    className="w-4 h-4 rounded-full shrink-0 shadow-sm"
                    style={{ backgroundColor: acc.color }}
                  />
                  <div>
                    <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <span>{acc.name}</span>
                      {acc.status === 'archived' && (
                        <span className="chip bg-slate-100 text-slate-600">
                          Archivovaný
                        </span>
                      )}
                    </h2>
                    <p className="text-xs text-slate-500">
                      {getTypeLabel(acc.type)} {acc.institution && `• ${acc.institution}`}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1 max-md:ml-auto">
                  <MoveButtons
                    itemLabel={`účet ${acc.name}`}
                    canMoveUp={index > 0}
                    canMoveDown={index < displayedAccounts.length - 1}
                    onMove={(direction) => handleMoveAccount(acc.id, direction)}
                  />
                  <button
                    onClick={() => handleOpenEdit(acc)}
                    title="Upravit účet"
                    aria-label={`Upravit účet: ${acc.name}`}
                    className="btn-icon"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  {acc.status === 'active' ? (
                    <button
                      onClick={() => handleArchive(acc)}
                      title="Archivovat účet"
                      aria-label={`Archivovat účet: ${acc.name}`}
                      className="btn-icon btn-icon-archive"
                    >
                      <Archive className="w-4 h-4" />
                    </button>
                  ) : (
                    <button
                      onClick={() => restoreAccount(acc.id)}
                      title="Obnovit z archivu"
                      aria-label={`Obnovit z archivu: ${acc.name}`}
                      className="btn-icon btn-icon-restore"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(acc)}
                    title="Smazat účet"
                    aria-label={`Smazat účet: ${acc.name}`}
                    className="btn-icon btn-icon-danger"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Finanční zůstatek */}
              <div className="p-4 bg-slate-50 rounded-xl space-y-1">
                <span className="text-xs text-slate-500 font-medium block">
                  Očekávaný zůstatek
                </span>
                <div className={`text-xl font-extrabold truncate ${
                  closingBalance < 0 ? 'text-red-600' : 'text-slate-900'
                }`}>
                  {formatCurrency(closingBalance)}
                </div>

                {isInvestment && (
                  <div className="pt-2 mt-2 border-t border-slate-200 flex items-center justify-between text-xs">
                    <span className="text-slate-500">
                      {`Vklady: ${formatCurrency(contributedPrincipal)}`}
                      {feesTotal !== 0 && <>
                        <span className="block">{`Poplatky: ${formatCurrency(-feesTotal)}`}</span>
                        <span className="block">{`Investováno: ${formatCurrency(investedPrincipal)}`}</span>
                      </>}
                    </span>
                    <span className={`font-bold ${unrealizedProfitHaler >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {formatCurrency(unrealizedProfitHaler, { showPlus: true })} ({formatPercent(unrealizedPct, { showPlus: true })})
                    </span>
                  </div>
                )}
              </div>

              {/* Informace o kontrole nebo ocenění */}
              <div className="text-xs text-slate-500 space-y-1">
                {isInvestment ? (
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1">
                      <CalendarClock className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
                      Tržní hodnota zadána:
                    </span>
                    <span className="font-medium text-slate-500">
                      {acc.marketValueUpdatedAt ? formatCzechDate(acc.marketValueUpdatedAt) : 'zatím ne'}
                    </span>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1">
                        <CalendarCheck className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
                        Naposledy srovnáno s bankou:
                      </span>
                      <span className="font-medium text-slate-500">
                        {lastCorrection ? formatCzechDate(lastCorrection.checkDate) : 'zatím ne'}
                      </span>
                    </div>
                    {lastCorrection && (
                      <div className="flex items-center justify-between text-slate-500">
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
              <div className="flex items-center gap-2 text-xs text-slate-500">
                {acc.isUsableCash && (
                  <span className="chip bg-sky-50 text-sky-700">
                    Použitelné peníze
                  </span>
                )}
                {acc.isNetWorth && (
                  <span className="chip bg-purple-50 text-purple-700">
                    Celkový majetek
                  </span>
                )}
              </div>

              {/* Akční tlačítka pro účet */}
              <div className="pt-2 border-t border-slate-100 flex items-center gap-2">
                {isInvestment ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setMarketValueAccount(acc)}
                      className="btn-secondary flex-1"
                    >
                      Tržní hodnota
                    </button>
                    <button
                      type="button"
                      onClick={() => setFeeAccount(acc)}
                      title="Zadat měsíční poplatek obchodníka"
                      className="btn-secondary shrink-0"
                    >
                      Poplatek
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setReconcileAccount(acc)}
                    className="btn-secondary flex-1"
                  >
                    Srovnat s bankou
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setHistoryAccount(acc)}
                  title="Historie účtu"
                  className="btn-secondary shrink-0"
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

      <InvestmentFeeModal
        isOpen={!!feeAccount}
        onClose={() => setFeeAccount(null)}
        account={feeAccount}
      />

      <AccountHistoryModal
        isOpen={!!historyAccount}
        onClose={() => setHistoryAccount(null)}
        account={historyAccount}
      />

      <ConfirmationModal
        isOpen={!!pendingAction}
        onClose={() => setPendingAction(null)}
        onConfirm={confirmPendingAction}
        title={pendingAction?.kind === 'blocked' ? 'Účet nejde smazat' : 'Archivovat výchozí účet?'}
        message={pendingMessage}
        confirmText={pendingAction?.account.status === 'active' ? 'Archivovat účet' : 'Rozumím'}
        showCancel={pendingAction?.account.status === 'active'}
      />
    </div>
  );
};
