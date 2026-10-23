import { Account, BalanceCorrection, MarketValueSnapshot, Transaction } from '../types/finance';
import { addHaler } from './currencyService';
import { getAccountFlowInHaler, getEffectiveAmountInHaler } from './accountScope';

export interface BalanceSources {
  transactions: Transaction[];
  corrections?: BalanceCorrection[];
  snapshots?: MarketValueSnapshot[];
}

export interface BalanceOptions {
  /** Započítat i plánované položky (předpokládaný stav). Výchozí: jen provedené. */
  includePlanned?: boolean;
  /** V den `date` započítat jen položky s pořadím menším než toto. */
  beforeSequence?: number;
}

const isAssetAccount = (account: Account) => account.type === 'investment' || account.type === 'pension';

/**
 * Stav účtu ke konci zadaného dne. Před datem aktivace je stav 0.
 * - Běžný účet: počáteční zůstatek + dopady položek + starší korekce, které ještě nejsou mezi položkami.
 * - Investiční a penzijní účet: poslední ocenění k datu (snapshot, jinak tržní hodnota na účtu)
 *   + toky po něm; korekce se nepoužívají.
 */
export function getAccountBalanceAtDate(
  account: Account,
  date: string,
  sources: BalanceSources,
  options: BalanceOptions = {}
): number {
  const initDate = account.initialBalanceDate || '1970-01-01';
  if (date < initDate) return 0;

  const transactions = Array.isArray(sources.transactions) ? sources.transactions : [];
  return isAssetAccount(account)
    ? assetBalance(account, initDate, date, transactions, sources.snapshots, options)
    : liquidBalance(account, initDate, date, transactions, sources.corrections, options);
}

/** Dopad položky na zůstatek: tok účtu, u korekce její rozdíl. */
function balanceEffectInHaler(t: Transaction, accountId: string): number {
  if (t.type === 'balance_adjustment') {
    if (t.sourceAccountId !== accountId) return 0;
    return t.diffInHaler !== undefined ? t.diffInHaler : getEffectiveAmountInHaler(t);
  }
  return getAccountFlowInHaler(t, accountId);
}

/** Starší korekce může být uložená zároveň jako položka balance_adjustment - pak se nepočítá dvakrát. */
function isCorrectionInTransactions(c: BalanceCorrection, transactions: Transaction[]): boolean {
  return transactions.some(t =>
    t.id === c.id ||
    (t.type === 'balance_adjustment' && t.sourceAccountId === c.accountId && t.date === c.checkDate && t.diffInHaler === c.diffInHaler)
  );
}

function liquidBalance(
  account: Account,
  initDate: string,
  date: string,
  transactions: Transaction[],
  corrections: BalanceCorrection[] | undefined,
  { includePlanned = false, beforeSequence }: BalanceOptions
): number {
  let balance = account.initialBalanceInHaler || 0;

  for (const t of transactions) {
    if (t.status === 'cancelled') continue;
    // Korekce platí hned, bez ohledu na stav
    if (!includePlanned && t.status !== 'executed' && t.type !== 'balance_adjustment') continue;
    if (t.date < initDate || t.date > date) continue;
    if (t.date === date && beforeSequence !== undefined && (t.sequence ?? 1) >= beforeSequence) continue;
    balance = addHaler(balance, balanceEffectInHaler(t, account.id));
  }

  for (const c of Array.isArray(corrections) ? corrections : []) {
    if (c.accountId !== account.id || c.checkDate < initDate || c.checkDate > date) continue;
    if (isCorrectionInTransactions(c, transactions)) continue;
    balance = addHaler(balance, c.diffInHaler);
  }

  return balance;
}

function assetBalance(
  account: Account,
  initDate: string,
  date: string,
  transactions: Transaction[],
  snapshots: MarketValueSnapshot[] | undefined,
  { includePlanned = false }: BalanceOptions
): number {
  const latestSnapshot = (Array.isArray(snapshots) ? snapshots : [])
    .filter(s => s.accountId === account.id && s.date >= initDate && s.date <= date)
    .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || '') || b.id.localeCompare(a.id))[0];

  let value = account.initialBalanceInHaler || 0;
  // Toky se počítají po datu ocenění; bez ocenění od data aktivace včetně
  let flowsAfter: string | null = null;

  if (latestSnapshot) {
    value = latestSnapshot.marketValueInHaler;
    flowsAfter = latestSnapshot.date;
  } else if (
    account.currentMarketValueInHaler !== undefined &&
    account.marketValueUpdatedAt &&
    account.marketValueUpdatedAt >= initDate &&
    account.marketValueUpdatedAt <= date
  ) {
    value = account.currentMarketValueInHaler;
    flowsAfter = account.marketValueUpdatedAt;
  } else if (account.currentMarketValueInHaler !== undefined && !account.marketValueUpdatedAt) {
    value = account.currentMarketValueInHaler;
  }

  for (const t of transactions) {
    if (t.status === 'cancelled') continue;
    if (!includePlanned && t.status !== 'executed') continue;
    if (t.date > date) continue;
    if (flowsAfter !== null ? t.date <= flowsAfter : t.date < initDate) continue;
    value = addHaler(value, getAccountFlowInHaler(t, account.id));
  }

  return value;
}
