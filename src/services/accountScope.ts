import { Account, Transaction } from '../types/finance';
import { addHaler, subHaler } from './currencyService';

/** Výchozí účet, pokud existuje a není archivovaný. */
export function getDefaultAccount(accounts: Account[]): Account | undefined {
  return accounts.find((a) => a.isDefault && a.status !== 'archived');
}

/** Efektivní částka položky: provedená se skutečnou částkou, ostatní s plánovanou. */
export function getEffectiveAmountInHaler(tx: Transaction): number {
  return tx.status === 'executed' && tx.actualAmountInHaler !== undefined ? tx.actualAmountInHaler : tx.amountInHaler;
}

/**
 * Znaménkový dopad položky na účet: příjem a převod dovnitř přičítají, výdaj a převod ven
 * odečítají. Převod na tentýž účet a korekce (balance_adjustment) vrací 0.
 */
export function getAccountFlowInHaler(
  tx: Transaction,
  accountId: string,
  amountInHaler: number = getEffectiveAmountInHaler(tx)
): number {
  if (tx.type === 'transfer') {
    let flow = 0;
    if (tx.targetAccountId === accountId) flow = addHaler(flow, amountInHaler);
    if (tx.sourceAccountId === accountId) flow = subHaler(flow, amountInHaler);
    return flow;
  }
  if (tx.sourceAccountId !== accountId) return 0;
  if (tx.type === 'income') return amountInHaler;
  if (tx.type === 'expense') return subHaler(0, amountInHaler);
  return 0;
}
