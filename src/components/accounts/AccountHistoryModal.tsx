import React, { useState, useMemo } from 'react';
import { useFinance } from '../../context/FinanceContext';
import { Modal, ModalFooter } from '../common/Modal';
import { Account, Transaction, MarketValueSnapshot, InvestmentFee } from '../../types/finance';
import { formatCurrency, subHaler } from '../../services/currencyService';
import { createBudgetPeriod, formatCzechDate } from '../../services/periodService';
import { getAccountFees, getFeesUpToDate, getInvestedAmountAtValuation } from '../../services/investmentPerformanceService';
import { getEffectiveAmountInHaler } from '../../services/accountScope';
import { getCorrectionDiffInHaler } from '../../services/itemFilter';
import { CorrectionDetailModal } from './CorrectionDetailModal';
import { MarketValueModal } from './MarketValueModal';
import { InvestmentFeeModal } from './InvestmentFeeModal';
import {
  Edit3,
  Trash2,
  ArrowDownLeft,
  ArrowUpRight,
  SlidersHorizontal,
  TrendingUp,
  Eye,
  Receipt,
  Clock,
  Ban,
} from 'lucide-react';

interface AccountHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  account: Account | null;
}

type UnifiedHistoryItem =
  | { kind: 'transaction'; data: Transaction; date: string; sequence?: number }
  | { kind: 'snapshot'; data: MarketValueSnapshot; date: string; sequence?: number }
  | { kind: 'fee'; data: InvestmentFee; date: string; periodName: string; sequence?: number };

export const AccountHistoryModal: React.FC<AccountHistoryModalProps> = ({
  isOpen,
  onClose,
  account,
}) => {
  const { transactions, marketValueSnapshots, investmentFees = [], settings, corrections, deleteMarketValue, deleteInvestmentFee, accounts } = useFinance();
  const [editingSnapshotId, setEditingSnapshotId] = useState<string | null>(null);
  const [editingFeePeriodKey, setEditingFeePeriodKey] = useState<string | null>(null);
  const editingSnapshot = marketValueSnapshots.find(s => s.id === editingSnapshotId);
  const [selectedCorrection, setSelectedCorrection] = useState<Transaction | null>(null);

  const isAssetAccount = account?.type === 'investment' || account?.type === 'pension';

  const historyItems = useMemo<UnifiedHistoryItem[]>(() => {
    if (!account) return [];

    if (!isAssetAccount) {
      // Standardní účet: všechny pohyby včetně balance_adjustment
      const txs = transactions.filter(
        t => t.sourceAccountId === account.id || t.targetAccountId === account.id
      );

      // Zahrnout i případné starší záznamy z corrections bez odpovídající transakce,
      // aby v historii účtu nikdy neexistoval žádný skrytý záznam
      const legacyCorrections: Transaction[] = (corrections || [])
        .filter(c => c.accountId === account.id && !txs.some(t => t.id === c.id))
        .map(c => ({
          id: c.id,
          title: 'Korekce zůstatku',
          amountInHaler: Math.abs(c.diffInHaler),
          date: c.checkDate,
          sequence: c.sequence ?? 999,
          type: 'balance_adjustment' as const,
          sourceAccountId: c.accountId,
          status: 'executed' as const,
          actualAmountInHaler: Math.abs(c.diffInHaler),
          calculatedBalanceInHaler: c.calculatedBalanceInHaler,
          actualBalanceInHaler: c.actualBalanceInHaler,
          diffInHaler: c.diffInHaler,
          note: c.note || 'Korekce podle banky',
          createdAt: c.createdAt,
          updatedAt: c.updatedAt || c.createdAt || new Date().toISOString()
        }));

      const allItems = [...txs, ...legacyCorrections];

      return allItems
        .map(t => ({ kind: 'transaction' as const, data: t, date: t.date, sequence: t.sequence }))
        .sort((a, b) => {
          const dateCmp = b.date.localeCompare(a.date);
          if (dateCmp !== 0) return dateCmp;
          return (b.sequence ?? 0) - (a.sequence ?? 0);
        });
    } else {
      // Majetkový účet (investiční / penzijní): převody + snapshoty tržního ocenění
      const txs = transactions.filter(
        t => (t.sourceAccountId === account.id || t.targetAccountId === account.id) &&
             t.type === 'transfer' &&
             t.status !== 'cancelled'
      );

      const snaps = (marketValueSnapshots || []).filter(s => s.accountId === account.id);
      // Poplatek se řadí na začátek svého rozpočtového období.
      const fees = getAccountFees(investmentFees, account.id).map(f => {
        const [y, m] = f.periodKey.split('-').map(Number);
        const period = createBudgetPeriod(y, m, settings.budgetStartDay);
        return { kind: 'fee' as const, data: f, date: period.startDate, periodName: period.name, sequence: -1 };
      });

      const combined: UnifiedHistoryItem[] = [
        ...txs.map(t => ({ kind: 'transaction' as const, data: t, date: t.date, sequence: t.sequence })),
        ...snaps.map(s => ({ kind: 'snapshot' as const, data: s, date: s.date, sequence: 999 })),
        ...fees,
      ];

      return combined.sort((a, b) => {
        const dateCmp = b.date.localeCompare(a.date);
        if (dateCmp !== 0) return dateCmp;
        if (a.kind === 'snapshot' && b.kind === 'snapshot') {
          return b.data.createdAt.localeCompare(a.data.createdAt) || b.data.id.localeCompare(a.data.id);
        }
        return (b.sequence ?? 0) - (a.sequence ?? 0);
      });
    }
  }, [account, isAssetAccount, transactions, marketValueSnapshots, investmentFees, settings.budgetStartDay, corrections]);

  if (!account) return null;

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={`Historie účtu: ${account.name}`}
        subtitle={isAssetAccount ? 'Vklady, výběry, poplatky a tržní hodnoty, od nejnovějších' : 'Všechny pohyby a korekce zůstatku, od nejnovějších'}
        maxWidth="max-w-2xl"
      >
        <div className="space-y-4">
          {/* Počáteční stav */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between text-xs text-slate-500">
            <span>Počáteční zůstatek{account.initialBalanceDate ? ` k ${formatCzechDate(account.initialBalanceDate)}` : ''}</span>
            <span className="font-semibold text-slate-900 text-sm">
              {formatCurrency(account.initialBalanceInHaler)}
            </span>
          </div>

          {/* Seznam položek */}
          <div className="space-y-2">
            {historyItems.length === 0 ? (
              <div className="text-center py-10 text-slate-500 text-sm">
                Na tomto účtu zatím nejsou žádné pohyby.
              </div>
            ) : (
              historyItems.map(item => {
                if (item.kind === 'fee') {
                  const fee = item.data;
                  return (
                    <div
                      key={fee.id}
                      className="p-3 bg-white border border-slate-200 rounded-xl flex items-center justify-between gap-3 text-sm hover:bg-slate-50 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="p-2 bg-slate-100 text-slate-600 rounded-lg shrink-0">
                          <Receipt className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-900">Poplatek obchodníka</span>
                          </div>
                          <div className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
                            <span>{item.periodName}</span>
                            {fee.note && <span className="truncate">· {fee.note}</span>}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="font-bold text-slate-700 mr-2">{formatCurrency(-fee.amountInHaler)}</span>
                        <button type="button" onClick={() => setEditingFeePeriodKey(fee.periodKey)} title="Upravit poplatek" aria-label={`Upravit poplatek: ${item.periodName}`}
                          className="btn-icon">
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button type="button" onClick={() => deleteInvestmentFee(fee.id)} title="Smazat poplatek" aria-label={`Smazat poplatek: ${item.periodName}`}
                          className="btn-icon btn-icon-danger">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                }

                if (item.kind === 'snapshot') {
                  const snap = item.data;
                  const snapInvested = getInvestedAmountAtValuation(account, transactions, snap.date);
                  const snapFees = getFeesUpToDate(investmentFees, account.id, snap.date, settings.budgetStartDay);
                  const snapReturn = subHaler(snap.marketValueInHaler, subHaler(snapInvested, snapFees));
                  return (
                    <div
                      key={snap.id}
                      className="p-3 bg-white border border-slate-200 rounded-xl flex items-center justify-between gap-3 text-sm hover:bg-slate-50 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="p-2 bg-purple-50 text-purple-600 rounded-lg shrink-0">
                          <TrendingUp className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-900">Tržní hodnota</span>
                          </div>
                          <div className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
                            <span>{formatCzechDate(snap.date)}</span>
                            {snap.note && <span className="truncate">· {snap.note}</span>}
                          </div>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <span className="font-bold text-slate-900 text-base">
                          {formatCurrency(snap.marketValueInHaler)}
                        </span>
                        <div className="flex justify-end gap-1 mt-1">
                          <button type="button" onClick={() => setEditingSnapshotId(snap.id)} title="Upravit tržní hodnotu" aria-label={`Upravit tržní hodnotu z ${formatCzechDate(snap.date)}`}
                            className="btn-icon">
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button type="button" onClick={() => deleteMarketValue(snap.id)} title="Smazat tržní hodnotu" aria-label={`Smazat tržní hodnotu z ${formatCzechDate(snap.date)}`}
                            className="btn-icon btn-icon-danger">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="text-xs text-slate-500">
                          <div>Vklady: {formatCurrency(snapInvested)}</div>
                          {snapFees !== 0 && <>
                            <div>Poplatky: {formatCurrency(-snapFees)}</div>
                            <div>Investováno: {formatCurrency(subHaler(snapInvested, snapFees))}</div>
                          </>}
                          <div>Výnos: <span className={`font-semibold ${snapReturn >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{formatCurrency(snapReturn, { showPlus: true })}</span></div>
                        </div>
                      </div>
                    </div>
                  );
                }

                // Transaction item
                const tx = item.data;
                const isCorrection = tx.type === 'balance_adjustment';
                const isIncomingTransfer = tx.type === 'transfer' && tx.targetAccountId === account.id;
                const isOutgoingTransfer = tx.type === 'transfer' && tx.sourceAccountId === account.id;

                let amountDisplay = '';
                let amountClass = '';
                let typeBadge = '';
                const effectiveAmount = getEffectiveAmountInHaler(tx);

                if (isCorrection) {
                  const diff = getCorrectionDiffInHaler(tx);
                  amountDisplay = formatCurrency(diff, { showPlus: true });
                  amountClass = diff >= 0 ? 'text-emerald-600' : 'text-red-600';
                  typeBadge = 'Korekce zůstatku';
                } else if (tx.type === 'income') {
                  amountDisplay = `+${formatCurrency(effectiveAmount)}`;
                  amountClass = 'text-emerald-600';
                  typeBadge = 'Příjem';
                } else if (tx.type === 'expense') {
                  amountDisplay = `−${formatCurrency(effectiveAmount)}`;
                  amountClass = 'text-red-600';
                  typeBadge = 'Výdaj';
                } else if (isIncomingTransfer) {
                  amountDisplay = `+${formatCurrency(effectiveAmount)}`;
                  amountClass = 'text-slate-900';
                  typeBadge = isAssetAccount ? 'Vklad do portfolia' : 'Příchozí převod';
                } else if (isOutgoingTransfer) {
                  amountDisplay = `−${formatCurrency(effectiveAmount)}`;
                  amountClass = 'text-slate-900';
                  typeBadge = isAssetAccount ? 'Výběr z portfolia' : 'Odchozí převod';
                }

                return (
                  <div
                    key={tx.id}
                    className={`p-3 border rounded-xl flex items-center justify-between gap-3 text-sm transition-colors ${
                      isCorrection
                        ? 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                        : 'bg-white border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`p-2 rounded-lg shrink-0 ${
                        isCorrection
                          ? 'bg-slate-100 text-slate-500'
                          : tx.type === 'transfer'
                            ? 'bg-slate-100 text-slate-500'
                          : tx.type === 'income'
                            ? 'bg-emerald-50 text-emerald-600'
                            : 'bg-red-50 text-red-600'
                      }`}>
                        {isCorrection ? (
                          <SlidersHorizontal className="w-4 h-4" />
                        ) : tx.type === 'income' || isIncomingTransfer ? (
                          <ArrowDownLeft className="w-4 h-4" />
                        ) : (
                          <ArrowUpRight className="w-4 h-4" />
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="min-w-0 max-w-full font-semibold text-slate-900 truncate">
                            {tx.title}
                          </span>
                          <span className="chip bg-slate-100 text-slate-600">
                            {typeBadge}
                          </span>
                          {/* Historie obsahuje i plán: stav musí být vidět, jinak se plánovaná tváří jako proběhlá */}
                          {!isCorrection && tx.status === 'planned' && (
                            <span className="chip bg-amber-50 text-amber-700">
                              <Clock className="w-3 h-3" aria-hidden="true" /> Plánovaná
                            </span>
                          )}
                          {!isCorrection && tx.status === 'cancelled' && (
                            <span className="chip bg-slate-100 text-slate-600">
                              <Ban className="w-3 h-3" aria-hidden="true" /> Zrušená
                            </span>
                          )}
                          {tx.sequence !== undefined && (
                            <span className="chip bg-slate-100 text-slate-600 shrink-0">
                              #{tx.sequence}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
                          <span>{formatCzechDate(tx.date)}</span>
                          {tx.note && <span className="truncate">· {tx.note}</span>}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <span className={`font-bold ${tx.status === 'cancelled' ? 'line-through text-slate-500' : amountClass}`}>
                        {amountDisplay}
                      </span>
                      {isCorrection && (
                        <button
                          type="button"
                          onClick={() => setSelectedCorrection(tx)}
                          className="btn-icon"
                          title="Detail korekce"
                          aria-label={`Detail korekce z ${formatCzechDate(tx.date)}`}
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <ModalFooter>
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary"
            >
              Zavřít
            </button>
          </ModalFooter>
        </div>
      </Modal>

      {/* Detail korekce při rozkliknutí */}
      <MarketValueModal isOpen={isOpen && Boolean(editingSnapshot)} onClose={() => setEditingSnapshotId(null)}
        account={accounts.find(a => a.id === account.id) ?? account} snapshot={editingSnapshot} />
      <InvestmentFeeModal isOpen={isOpen && editingFeePeriodKey !== null} onClose={() => setEditingFeePeriodKey(null)}
        account={accounts.find(a => a.id === account.id) ?? account} periodKey={editingFeePeriodKey} />
      <CorrectionDetailModal
        isOpen={Boolean(selectedCorrection)}
        onClose={() => setSelectedCorrection(null)}
        correctionItem={selectedCorrection}
      />
    </>
  );
};
