import React, { useState, useMemo } from 'react';
import { useFinance } from '../../context/FinanceContext';
import { Modal } from '../common/Modal';
import { Account, Transaction, MarketValueSnapshot } from '../../types/finance';
import { formatCurrency, subHaler } from '../../services/currencyService';
import { formatCzechDate } from '../../services/periodService';
import { CorrectionDetailModal } from './CorrectionDetailModal';
import { MarketValueModal } from './MarketValueModal';
import { ConfirmationModal } from '../common/ConfirmationModal';
import {
  History,
  Pencil,
  Trash2,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  SlidersHorizontal,
  TrendingUp,
  Calendar,
  Eye,
  Info
} from 'lucide-react';

interface AccountHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  account: Account | null;
}

type UnifiedHistoryItem =
  | { kind: 'transaction'; data: Transaction; date: string; sequence?: number }
  | { kind: 'snapshot'; data: MarketValueSnapshot; date: string; sequence?: number };

export const AccountHistoryModal: React.FC<AccountHistoryModalProps> = ({
  isOpen,
  onClose,
  account,
}) => {
  const { transactions, marketValueSnapshots, corrections, deleteMarketValue, accounts } = useFinance();
  const [editingSnapshotId, setEditingSnapshotId] = useState<string | null>(null);
  const [deletingSnapshotId, setDeletingSnapshotId] = useState<string | null>(null);
  const editingSnapshot = marketValueSnapshots.find(s => s.id === editingSnapshotId);
  const deletingSnapshot = marketValueSnapshots.find(s => s.id === deletingSnapshotId);
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
          note: c.note || 'Korekce skutečného stavu',
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

      const combined: UnifiedHistoryItem[] = [
        ...txs.map(t => ({ kind: 'transaction' as const, data: t, date: t.date, sequence: t.sequence })),
        ...snaps.map(s => ({ kind: 'snapshot' as const, data: s, date: s.date, sequence: 999 }))
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
  }, [account, isAssetAccount, transactions, marketValueSnapshots, corrections]);

  if (!account) return null;

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={`Historie účtu: ${account.name}`}
        subtitle={isAssetAccount ? 'Historie vkladů, výběrů a tržních ocenění' : 'Kompletní přehled pohybů a korekcí'}
        maxWidth="max-w-2xl"
      >
        <div className="space-y-4 max-h-[70vh] flex flex-col">
          {/* Počáteční stav */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between text-xs text-slate-500 shrink-0">
            <span>Počáteční evidenční stav:</span>
            <span className="font-semibold text-slate-900 text-sm">
              {formatCurrency(account.initialBalanceInHaler)}
            </span>
          </div>

          {/* Seznam položek */}
          <div className="overflow-y-auto space-y-2 pr-1 flex-1 min-h-[200px]">
            {historyItems.length === 0 ? (
              <div className="text-center py-10 text-slate-500 text-sm">
                Na tomto účtu zatím nejsou žádné zaznamenané pohyby.
              </div>
            ) : (
              historyItems.map(item => {
                if (item.kind === 'snapshot') {
                  const snap = item.data;
                  return (
                    <div
                      key={snap.id}
                      className="p-3 bg-purple-50/60 border border-purple-200 rounded-xl flex items-center justify-between gap-3 text-sm hover:bg-purple-50 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="p-2 bg-purple-100 text-purple-700 rounded-lg shrink-0">
                          <TrendingUp className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-purple-950">Aktualizace tržní hodnoty</span>
                            <span className="text-xs px-2 py-0.5 bg-purple-200/70 text-purple-800 rounded-full font-medium">
                              Ocenění
                            </span>
                          </div>
                          <div className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
                            <span>{formatCzechDate(snap.date)}</span>
                            {snap.note && <span className="truncate">· {snap.note}</span>}
                          </div>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <span className="font-bold text-purple-900 text-base">
                          {formatCurrency(snap.marketValueInHaler)}
                        </span>
                        <div className="text-[11px] text-purple-600 font-medium">Tržní hodnota</div>
                        <div className="flex justify-end gap-1 mt-1">
                          <button type="button" onClick={() => setEditingSnapshotId(snap.id)} title="Upravit tržní ocenění" aria-label="Upravit tržní ocenění"
                            className="p-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors">
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button type="button" onClick={() => setDeletingSnapshotId(snap.id)} title="Smazat tržní ocenění" aria-label="Smazat tržní ocenění"
                            className="p-1.5 text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {snap.effectiveInvestedAmountInHaler === undefined ? 'Historický vložený kapitál není znám' : <>
                            <div>Vloženo: {formatCurrency(snap.effectiveInvestedAmountInHaler)}</div>
                            {snap.investedAmountAdjustmentInHaler !== undefined && <div>Korekce: {formatCurrency(snap.investedAmountAdjustmentInHaler)}</div>}
                            <div>Výnos / ztráta: {formatCurrency(subHaler(snap.marketValueInHaler, snap.effectiveInvestedAmountInHaler))}</div>
                          </>}
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

                if (isCorrection) {
                  const diff = tx.diffInHaler ?? 0;
                  amountDisplay = formatCurrency(diff, { showPlus: true });
                  amountClass = diff >= 0 ? 'text-emerald-700' : 'text-amber-700';
                  typeBadge = 'Korekce zůstatku';
                } else if (tx.type === 'income') {
                  amountDisplay = `+${formatCurrency(tx.amountInHaler)}`;
                  amountClass = 'text-emerald-600';
                  typeBadge = 'Příjem';
                } else if (tx.type === 'expense') {
                  amountDisplay = `-${formatCurrency(tx.amountInHaler)}`;
                  amountClass = 'text-red-600';
                  typeBadge = 'Výdaj';
                } else if (isIncomingTransfer) {
                  amountDisplay = `+${formatCurrency(tx.amountInHaler)}`;
                  amountClass = 'text-sky-600';
                  typeBadge = isAssetAccount ? 'Vklad do portfolia' : 'Příchozí převod';
                } else if (isOutgoingTransfer) {
                  amountDisplay = `-${formatCurrency(tx.amountInHaler)}`;
                  amountClass = 'text-indigo-600';
                  typeBadge = isAssetAccount ? 'Výběr z portfolia' : 'Odchozí převod';
                }

                return (
                  <div
                    key={tx.id}
                    className={`p-3 border rounded-xl flex items-center justify-between gap-3 text-sm transition-colors ${
                      isCorrection
                        ? 'bg-amber-50/40 border-amber-200 hover:bg-amber-50/70'
                        : 'bg-white border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`p-2 rounded-lg shrink-0 ${
                        isCorrection
                          ? 'bg-amber-100 text-amber-800'
                          : tx.type === 'income' || isIncomingTransfer
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
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900 truncate">
                            {tx.title}
                          </span>
                          <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                            isCorrection
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-slate-100 text-slate-500'
                          }`}>
                            {typeBadge}
                          </span>
                          {tx.sequence !== undefined && (
                            <span className="text-[10px] text-slate-500 font-medium">
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
                      <span className={`font-bold ${amountClass}`}>
                        {amountDisplay}
                      </span>
                      {isCorrection && (
                        <button
                          type="button"
                          onClick={() => setSelectedCorrection(tx)}
                          className="p-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                          title="Detail korekce"
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

          <div className="pt-3 border-t border-slate-100 flex justify-end shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-500 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
            >
              Zavřít
            </button>
          </div>
        </div>
      </Modal>

      {/* Detail korekce při rozkliknutí */}
      <MarketValueModal isOpen={isOpen && Boolean(editingSnapshot)} onClose={() => setEditingSnapshotId(null)}
        account={accounts.find(a => a.id === account.id) ?? account} snapshot={editingSnapshot} />
      <ConfirmationModal isOpen={isOpen && Boolean(deletingSnapshot)} onClose={() => setDeletingSnapshotId(null)}
        onConfirm={() => { if (deletingSnapshot) deleteMarketValue(deletingSnapshot.id); }}
        title="Smazat tržní ocenění?"
        message={`Ocenění${deletingSnapshot ? ` z ${formatCzechDate(deletingSnapshot.date)} (${formatCurrency(deletingSnapshot.marketValueInHaler)})` : ''} bude trvale odstraněno včetně související změny korekce. Navazující hodnoty a období se přepočítají.`}
        confirmText="Smazat ocenění" cancelText="Zrušit" isDestructive />
      <CorrectionDetailModal
        isOpen={Boolean(selectedCorrection)}
        onClose={() => setSelectedCorrection(null)}
        correctionItem={selectedCorrection}
      />
    </>
  );
};
