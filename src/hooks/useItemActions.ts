import { useMemo, useState } from 'react';
import { Transaction, TransactionStatus } from '../types/finance';
import { parseVirtualId } from '../services/transactionCommands';
import type { ActionResult } from '../services/commandFeedback';

export type RecurringDeleteMode = 'occurrence' | 'future' | 'series';

export interface ItemActionsDeps {
  transactions: Transaction[];
  deleteTransaction: (id: string, recurringMode?: RecurringDeleteMode, deleteHistoricalExecuted?: boolean) => ActionResult;
  deleteCorrection: (id: string) => ActionResult;
  setTransactionStatus: (id: string, newStatus: TransactionStatus) => ActionResult;
  showToast: (text: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
}

/** Prodleva před změnou stavu, aby štítek stihl ukázat probíhající změnu. */
export const STATUS_CHANGE_DELAY_MS = 60;

/**
 * Akce řádků položek sdílené Rozpočtem a Všemi položkami: smazání (pravidelná položka přes
 * volbu rozsahu), změna stavu štítkem a detail korekce.
 */
export function useItemActions(deps: ItemActionsDeps) {
  const { transactions, deleteTransaction, deleteCorrection, setTransactionStatus, showToast } = deps;

  // Stav mazání položky
  const [deletingTx, setDeletingTx] = useState<Transaction | null>(null);
  const [isDeletingTx, setIsDeletingTx] = useState(false);
  // Běžná položka se smaže hned (oznámení nabídne „Vrátit“), pravidelná potřebuje volbu rozsahu
  const requestDelete = (tx: Transaction) => {
    if (tx.recurringRuleId || tx.id.startsWith('virtual_')) setDeletingTx(tx);
    else deleteTransaction(tx.id);
  };
  const closeDelete = () => {
    if (!isDeletingTx) setDeletingTx(null);
  };
  const confirmDelete = async (tx: Transaction, mode?: RecurringDeleteMode, deleteHistorical?: boolean) => {
    setIsDeletingTx(true);
    try {
      return deleteTransaction(tx.id, mode, deleteHistorical).ok;
    } finally {
      setIsDeletingTx(false);
    }
  };

  const deletingTxHasExecutedHistorical = useMemo(() => {
    if (!deletingTx) return false;
    const ruleId = deletingTx.recurringRuleId ?? parseVirtualId(deletingTx.id)?.ruleId;
    if (!ruleId) return false;
    return transactions.some(t => t.recurringRuleId === ruleId && t.status === 'executed');
  }, [deletingTx, transactions]);

  // Stav probíhající změny stavu položky
  const [updatingStatusTxId, setUpdatingStatusTxId] = useState<string | null>(null);
  const handleStatusChange = async (txId: string, newStatus: TransactionStatus) => {
    if (updatingStatusTxId) return; // Zabraň vícenásobnému kliknutí
    setUpdatingStatusTxId(txId);
    try {
      await new Promise(resolve => setTimeout(resolve, STATUS_CHANGE_DELAY_MS));
      setTransactionStatus(txId, newStatus);
    } catch (err) {
      console.error(err);
      showToast('Při změně stavu položky došlo k chybě.', 'error');
    } finally {
      setUpdatingStatusTxId(null);
    }
  };

  // Stav vybrané korekce pro detail modal
  const [selectedCorrection, setSelectedCorrection] = useState<Transaction | null>(null);
  const openCorrection = (tx: Transaction) => setSelectedCorrection(tx);
  const closeCorrection = () => setSelectedCorrection(null);

  return {
    requestDelete,
    deletingTx,
    isDeletingTx,
    closeDelete,
    confirmDelete,
    deletingTxHasExecutedHistorical,
    deleteCorrection,
    updatingStatusTxId,
    handleStatusChange,
    selectedCorrection,
    openCorrection,
    closeCorrection,
  };
}

export type ItemActions = ReturnType<typeof useItemActions>;
