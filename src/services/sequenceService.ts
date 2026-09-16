import { IntraDayStep, IntraDaySummary, Transaction } from '../types/finance';
import { addHaler, subHaler } from './currencyService';

/**
 * Služba pro správu pořadí transakcí v rámci kalendářního dne.
 * Používá souvislou inkrementální řadu: 1, 2, 3, 4…
 * Každý kalendářní den má vlastní samostatnou sekvenci začínající od 1.
 */

/**
 * Vrátí další volné pořadí pro daný kalendářní den.
 * Pokud v daném dni ještě žádná položka není, začíná se od 1.
 * Pokud existují položky s pořadím 1 a 2, vrátí 3.
 */
export function getNextSequenceForDate(date: string, transactions: Transaction[]): number {
  const dayTxs = transactions.filter(t => t.date === date);
  if (dayTxs.length === 0) {
    return 1;
  }
  const maxSeq = Math.max(...dayTxs.map(t => t.sequence || 0));
  return Math.max(dayTxs.length + 1, maxSeq + 1);
}

/**
 * Stabilní třídění položek:
 * 1. datum
 * 2. pořadí v rámci dne (sequence) ve stejném směru jako datum
 * 3. interní ID položky jako stabilní pomocné řazení
 */
export function sortTransactionsByDateAndSequence(
  transactions: Transaction[],
  dateOrder: 'asc' | 'desc' = 'asc'
): Transaction[] {
  return [...transactions].sort((a, b) => {
    // 1. Datum
    const dateCmp = dateOrder === 'asc'
      ? a.date.localeCompare(b.date)
      : b.date.localeCompare(a.date);
    if (dateCmp !== 0) return dateCmp;

    // 2. Pořadí v rámci dne (vždy ve stejném směru jako datum)
    const seqA = a.sequence ?? 1;
    const seqB = b.sequence ?? 1;
    const seqCmp = dateOrder === 'asc' ? seqA - seqB : seqB - seqA;
    if (seqCmp !== 0) return seqCmp;

    // 3. Interní ID jako poslední pomocné kritérium
    return dateOrder === 'asc'
      ? (a.id || '').localeCompare(b.id || '')
      : (b.id || '').localeCompare(a.id || '');
  });
}

/**
 * Normalizuje pořadí všech položek daného dne na čistou souvislou řadu: 1, 2, 3, 4…
 * Zachovává relativní pořadí.
 */
export function normalizeDaySequences(dayTransactions: Transaction[]): Transaction[] {
  const sorted = [...dayTransactions].sort((a, b) => {
    const seqA = a.sequence ?? 1;
    const seqB = b.sequence ?? 1;
    if (seqA !== seqB) return seqA - seqB;
    const createdCmp = (a.createdAt || '').localeCompare(b.createdAt || '');
    if (createdCmp !== 0) return createdCmp;
    return (a.id || '').localeCompare(b.id || '');
  });

  return sorted.map((tx, idx) => ({
    ...tx,
    sequence: idx + 1,
  }));
}

/**
 * Provede přeuspořádání položek v rámci dne po drag-and-drop operaci.
 */
export function reorderDayTransactions(
  date: string,
  orderedIds: string[],
  allTransactions: Transaction[]
): Transaction[] {
  const dayTxs = allTransactions.filter(t => t.date === date);
  const otherTxs = allTransactions.filter(t => t.date !== date);

  const idMap = new Map(dayTxs.map(t => [t.id, t]));
  const updatedDayTxs: Transaction[] = [];

  // 1. Položky seřazené dle orderedIds s pořadím 1, 2, 3...
  orderedIds.forEach((id, index) => {
    const tx = idMap.get(id);
    if (tx) {
      updatedDayTxs.push({
        ...tx,
        sequence: index + 1,
        updatedAt: new Date().toISOString(),
      });
      idMap.delete(id);
    }
  });

  // 2. Případné zbylé položky
  Array.from(idMap.values()).forEach(tx => {
    updatedDayTxs.push({
      ...tx,
      sequence: updatedDayTxs.length + 1,
    });
  });

  return sortTransactionsByDateAndSequence([...otherTxs, ...updatedDayTxs]);
}

/**
 * Vloží nebo upraví položku s požadovaným pořadím.
 * - Pokud se změnilo datum položky (oldDate !== txToSave.date), zbývající položky původního dne se přečíslují bez mezer.
 * - V cílovém dni se položka vloží na požadovanou pozici a ostatní položky se posunou.
 * - Následně se celý den normalizuje do čisté řady 1, 2, 3, 4…
 */
export function insertOrUpdateWithSequence(
  txToSave: Transaction,
  targetSequence: number,
  allTransactions: Transaction[],
  oldDate?: string
): Transaction[] {
  const safeTargetSeq = Math.max(1, Math.round(targetSequence));
  const targetDay = txToSave.date;

  // 1. Pokud se změnilo datum a existoval starý den, přečíslujeme zbývající položky starého dne
  let nonTargetTxs: Transaction[];
  if (oldDate && oldDate !== targetDay) {
    const oldDayRemaining = allTransactions.filter(t => t.date === oldDate && t.id !== txToSave.id);
    const normalizedOldDay = normalizeDaySequences(oldDayRemaining);
    const otherTxs = allTransactions.filter(t => t.date !== oldDate && t.date !== targetDay && t.id !== txToSave.id);
    nonTargetTxs = [...otherTxs, ...normalizedOldDay];
  } else {
    nonTargetTxs = allTransactions.filter(t => t.date !== targetDay && t.id !== txToSave.id);
  }

  // 2. Položky cílového dne (vyjma ukládané) seřazené podle stávajícího pořadí
  const targetDayOtherTxs = allTransactions
    .filter(t => t.date === targetDay && t.id !== txToSave.id)
    .sort((a, b) => {
      const seqA = a.sequence ?? 1;
      const seqB = b.sequence ?? 1;
      if (seqA !== seqB) return seqA - seqB;
      return (a.id || '').localeCompare(b.id || '');
    });

  // 3. Vložení na požadovanou pozici a posunutí zbývajících položek
  const targetIndex = Math.max(0, Math.min(safeTargetSeq - 1, targetDayOtherTxs.length));
  const updatedDayTxs = [...targetDayOtherTxs];
  updatedDayTxs.splice(targetIndex, 0, txToSave);

  // 4. Přidělení čisté souvislé řady 1, 2, 3, 4…
  const normalizedTargetDay = updatedDayTxs.map((tx, idx) => ({
    ...tx,
    sequence: idx + 1,
  }));

  return sortTransactionsByDateAndSequence([...nonTargetTxs, ...normalizedTargetDay]);
}

/**
 * Odstraní transakci a přečísluje zbývající položky daného dne tak, aby nevznikla mezera.
 */
export function deleteTransactionAndReorder(
  id: string,
  allTransactions: Transaction[]
): Transaction[] {
  const txToDelete = allTransactions.find(t => t.id === id);
  if (!txToDelete) return allTransactions;

  const day = txToDelete.date;
  const dayRemaining = allTransactions.filter(t => t.date === day && t.id !== id);
  const normalizedDay = normalizeDaySequences(dayRemaining);
  const otherTxs = allTransactions.filter(t => t.date !== day && t.id !== id);

  return sortTransactionsByDateAndSequence([...otherTxs, ...normalizedDay]);
}

/**
 * Odstraní množinu transakcí a přečísluje zbývající položky všech dotčených kalendářních dní.
 */
export function deleteTransactionsAndReorder(
  idsToDelete: Set<string>,
  allTransactions: Transaction[]
): Transaction[] {
  if (idsToDelete.size === 0) return allTransactions;

  const affectedDates = new Set<string>();
  for (const t of allTransactions) {
    if (idsToDelete.has(t.id)) {
      affectedDates.add(t.date);
    }
  }

  const remaining = allTransactions.filter(t => !idsToDelete.has(t.id));
  const unaffected = remaining.filter(t => !affectedDates.has(t.date));
  const normalizedAffected: Transaction[] = [];

  for (const date of affectedDates) {
    const dayTxs = remaining.filter(t => t.date === date);
    normalizedAffected.push(...normalizeDaySequences(dayTxs));
  }

  return sortTransactionsByDateAndSequence([...unaffected, ...normalizedAffected]);
}

/**
 * Spočítá průběžný zůstatek položku po položce v rámci daného dne podle jejich přesného pořadí.
 */
export function calculateIntraDayRunningBalances(
  startOfDayBalanceInHaler: number,
  dayTransactions: Transaction[],
  accountId?: string,
  usableAccountIds?: Set<string>
): IntraDaySummary {
  const sorted = [...dayTransactions].sort((a, b) => (a.sequence ?? 1) - (b.sequence ?? 1));

  let currentBalance = startOfDayBalanceInHaler;
  let minBalance = startOfDayBalanceInHaler;
  let hasTemporaryNegative = false;

  const steps: IntraDayStep[] = [];

  for (const tx of sorted) {
    if (tx.status === 'cancelled') {
      // Zrušená položka zůstává v přehledu na své pozici, ale nemění zůstatek
      steps.push({
        transaction: tx,
        runningBalanceInHaler: currentBalance,
        isTemporaryNegative: false,
      });
      continue;
    }

    const amt = tx.status === 'executed' && tx.actualAmountInHaler !== undefined
      ? tx.actualAmountInHaler
      : tx.amountInHaler;

    if (accountId) {
      if (tx.type === 'income' && tx.sourceAccountId === accountId) {
        currentBalance = addHaler(currentBalance, amt);
      } else if (tx.type === 'expense' && tx.sourceAccountId === accountId) {
        currentBalance = subHaler(currentBalance, amt);
      } else if (tx.type === 'transfer') {
        if (tx.sourceAccountId === accountId) {
          currentBalance = subHaler(currentBalance, amt);
        } else if (tx.targetAccountId === accountId) {
          currentBalance = addHaler(currentBalance, amt);
        }
      } else if (tx.type === 'balance_adjustment' && tx.sourceAccountId === accountId) {
        const diff = tx.diffInHaler !== undefined ? tx.diffInHaler : amt;
        currentBalance = addHaler(currentBalance, diff);
      }
    } else {
      // Bez konkrétního účtu jde o agregovaný (např. "použitelné peníze") pohled přes více účtů.
      // Pokud je dána množina účtů zahrnutých do agregace, počítáme jen pohyby, které se jí týkají -
      // jinak by např. převod mimo tuto skupinu (do spoření/investic) zůstal v průběžném zůstatku neviditelný.
      const isIncluded = (id?: string) => !usableAccountIds || (id !== undefined && usableAccountIds.has(id));
      if (tx.type === 'income') {
        if (isIncluded(tx.sourceAccountId)) currentBalance = addHaler(currentBalance, amt);
      } else if (tx.type === 'expense') {
        if (isIncluded(tx.sourceAccountId)) currentBalance = subHaler(currentBalance, amt);
      } else if (tx.type === 'transfer') {
        if (isIncluded(tx.sourceAccountId)) currentBalance = subHaler(currentBalance, amt);
        if (isIncluded(tx.targetAccountId)) currentBalance = addHaler(currentBalance, amt);
      } else if (tx.type === 'balance_adjustment') {
        if (isIncluded(tx.sourceAccountId)) {
          const diff = tx.diffInHaler !== undefined ? tx.diffInHaler : amt;
          currentBalance = addHaler(currentBalance, diff);
        }
      }
    }

    const isNegativeAtThisStep = currentBalance < 0;
    if (isNegativeAtThisStep) {
      hasTemporaryNegative = true;
    }
    if (currentBalance < minBalance) {
      minBalance = currentBalance;
    }

    steps.push({
      transaction: tx,
      runningBalanceInHaler: currentBalance,
      isTemporaryNegative: isNegativeAtThisStep,
    });
  }

  return {
    date: dayTransactions[0]?.date || '',
    startOfDayBalanceInHaler,
    endOfDayBalanceInHaler: currentBalance,
    hasTemporaryNegative,
    minBalanceDuringDayInHaler: minBalance,
    steps,
  };
}

/**
 * Opraví případná chybná budoucí plánovaná pořadí (např. pevně nastavené 10),
 * duplicity nebo mezery v pořadí.
 * Pro každý dotčený kalendářní den přečísluje položky do souvislé řady 1, 2, 3…
 * Nemění automaticky historické uskutečněné platby, pokud netrpí duplicitami či mezerami.
 */
export function sanitizeAndRepairSequences(
  transactions: Transaction[],
  todayStr: string = new Date().toISOString().slice(0, 10)
): Transaction[] {
  const dayMap = new Map<string, Transaction[]>();
  for (const tx of transactions) {
    const list = dayMap.get(tx.date) || [];
    list.push(tx);
    dayMap.set(tx.date, list);
  }

  let hasChanges = false;
  const result: Transaction[] = [];

  for (const [date, dayTxs] of dayMap.entries()) {
    const hasErroneous10 = dayTxs.some(t => t.status === 'planned' && t.sequence === 10);
    const sequences = dayTxs.map(t => t.sequence || 0);
    const hasDuplicates = new Set(sequences).size !== sequences.length;
    const hasInvalidSeq = sequences.some(s => s <= 0 || !Number.isInteger(s));
    const sortedSeqs = [...sequences].sort((a, b) => a - b);
    const hasGaps = sortedSeqs.some((s, i) => s !== i + 1);

    const isFutureOrPlanned = date >= todayStr || dayTxs.some(t => t.status === 'planned');

    if (isFutureOrPlanned && (hasErroneous10 || hasDuplicates || hasInvalidSeq || hasGaps)) {
      hasChanges = true;
      const normalized = normalizeDaySequences(dayTxs);
      result.push(...normalized);
    } else {
      result.push(...dayTxs);
    }
  }

  return hasChanges ? sortTransactionsByDateAndSequence(result) : transactions;
}
