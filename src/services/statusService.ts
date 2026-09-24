import {
  RecurringException,
  RecurringRule,
  Transaction,
  TransactionStatus
} from '../types/finance';
import {
  generatePeriodsSequence,
  getPeriodForDate,
  getTodayInPrague,
  isDateInPeriod
} from './periodService';
import {
  applyRuleRankOrder,
  applyRulePositions,
  getNextSequenceForDate,
  insertOrUpdateWithSequence
} from './sequenceService';
import {
  doesRuleApplyInPeriod,
  generateOccurrenceForPeriod
} from './financialEngine';

/**
 * Určí automatický stav finanční položky podle kalendářního data:
 * - datum položky <= dnes -> 'executed' (Uskutečněná)
 * - datum položky > dnes -> 'planned' (Plánovaná)
 * 
 * Porovnání probíhá výhradně podle kalendářního data (YYYY-MM-DD)
 * v časovém pásmu Europe/Prague.
 */
export function getStatusForDate(date: string, referenceDateStr?: string): TransactionStatus {
  const today = referenceDateStr || getTodayInPrague();
  return date <= today ? 'executed' : 'planned';
}

export interface AutoExecuteResult {
  transactions: Transaction[];
  hasChanges: boolean;
  executedCount: number;
}

/**
 * Automaticky převede na 'executed' všechny plánované položky, jejichž datum
 * nastalo (datum <= dnes), a vytvoří reálné uskutečněné výskyty pro splatná opakovaná pravidla.
 * 
 * Pravidla a výjimky:
 * - Zrušené položky ('cancelled') a již uskutečněné položky ('executed') se NIKDY automaticky nemění.
 * - Budoucí položky (datum > dnes) zůstávají plánované ('planned').
 * - Při převodu na 'executed' se doplní actualAmountInHaler (pokud chybí).
 */
export function autoExecuteDueTransactions(
  transactions: Transaction[] = [],
  rules: RecurringRule[] = [],
  exceptions: RecurringException[] = [],
  budgetStartDay: number = 15,
  todayStr?: string
): AutoExecuteResult {
  const today = todayStr || getTodayInPrague();
  let hasChanges = false;
  let executedCount = 0;

  // 1. Zpracování existujících reálných transakcí
  let currentTxs: Transaction[] = (Array.isArray(transactions) ? transactions : []).map(tx => {
    // Pouze položky ve stavu 'planned' s datem <= dnes
    if (tx.status === 'planned' && tx.date <= today) {
      hasChanges = true;
      executedCount++;
      return {
        ...tx,
        status: 'executed',
        actualAmountInHaler: tx.actualAmountInHaler !== undefined
          ? tx.actualAmountInHaler
          : (tx.plannedAmountInHaler ?? tx.amountInHaler),
        updatedAt: new Date().toISOString()
      };
    }
    // Zrušené ('cancelled') a již uskutečněné ('executed') zůstávají beze změny
    return tx;
  });

  // 2. Zpracování splatných výskytů opakovaných plateb
  const safeRules = Array.isArray(rules) ? rules : [];
  const safeExceptions = Array.isArray(exceptions) ? exceptions : [];

  // Pravidla s požadovanou pozicí se zhmotňují vzestupně podle orderRank, aby se ve stejném dni
  // vložila do správného pořadí (stejné řazení jako u virtuálních výskytů v financialEngine).
  const rulesInOrder = [...safeRules].sort((a, b) => {
    const hintA = a.orderRank ?? Number.POSITIVE_INFINITY;
    const hintB = b.orderRank ?? Number.POSITIVE_INFINITY;
    if (hintA !== hintB) return hintA < hintB ? -1 : 1;
    return 0;
  });

  const seriesRanks = new Map<string, number>();
  for (const r of safeRules) {
    if (r.orderRank !== undefined) seriesRanks.set(r.id, r.orderRank);
  }
  // Pozice série ve dni (i vůči ručním položkám) - viz RecurringRule.orderPosition
  const seriesPositions = new Map<string, { position: number; rank: number }>();
  for (const r of safeRules) {
    if (r.orderPosition !== undefined) {
      seriesPositions.set(r.id, { position: r.orderPosition, rank: r.orderRank ?? r.orderPosition });
    }
  }

  for (const rule of rulesInOrder) {
    if (!rule.isActive) continue;
    if (rule.startDate > today) continue;

    const startPeriod = getPeriodForDate(rule.startDate, budgetStartDay);
    const currentPeriod = getPeriodForDate(today, budgetStartDay);

    const monthDiff = (currentPeriod.year - startPeriod.year) * 12 + (currentPeriod.month - startPeriod.month);
    if (monthDiff < 0) continue;

    const checkMonths = Math.min(monthDiff + 1, 24);
    const periodsToCheck = generatePeriodsSequence(
      startPeriod.year,
      startPeriod.month,
      checkMonths,
      budgetStartDay
    );

    for (const period of periodsToCheck) {
      if (!doesRuleApplyInPeriod(rule, period, budgetStartDay)) continue;

      const ex = safeExceptions.find(e => e.ruleId === rule.id && e.periodKey === period.key);
      if (ex && ex.isCancelled) continue;

      const occ = generateOccurrenceForPeriod(rule, period, safeExceptions, budgetStartDay, 1, today);
      if (!occ || occ.date > today) continue;

      const txsForRule = currentTxs.filter(t => t.recurringRuleId === rule.id && isDateInPeriod(t.date, period));
      let alreadyInstantiated = false;
      if (txsForRule.length > 0) {
        if (txsForRule.some(t => t.date === occ.date)) {
          alreadyInstantiated = true;
        } else if (occ.date > rule.startDate && txsForRule.every(t => t.date === rule.startDate)) {
          alreadyInstantiated = false;
        } else {
          alreadyInstantiated = true;
        }
      }

      if (alreadyInstantiated) continue;
        const lastSeq = getNextSequenceForDate(occ.date, currentTxs);
        // Pozice zvolená jen pro tuto periodu (výjimka) se zachová i po zhmotnění výskytu;
        // pořadí série (orderRank) se uplatní níže přeuspořádáním opakovaných položek dne.
        const override = ex?.overrideSequence;
        const nextSeq = override !== undefined ? Math.max(1, Math.min(Math.round(override), lastSeq)) : lastSeq;
        const nowIso = new Date().toISOString();
        const realTx: Transaction = {
          id: `tx_rec_${rule.id}_${period.key}`,
          title: occ.title,
          amountInHaler: occ.amountInHaler,
          plannedAmountInHaler: occ.amountInHaler,
          actualAmountInHaler: occ.amountInHaler,
          date: occ.date,
          sequence: nextSeq,
          type: occ.type,
          sourceAccountId: occ.sourceAccountId,
          targetAccountId: occ.targetAccountId,
          categoryId: occ.categoryId,
          subcategoryId: occ.subcategoryId,
          status: 'executed',
          recurringRuleId: rule.id,
          note: occ.note,
          isException: occ.isException,
          createdAt: occ.createdAt || nowIso,
          updatedAt: nowIso,
        };

        currentTxs = insertOrUpdateWithSequence(realTx, nextSeq, currentTxs);
        if (override === undefined && seriesPositions.size > 0) {
          currentTxs = applyRulePositions(currentTxs, seriesPositions, occ.date, occ.date);
        }
        if (override === undefined && seriesRanks.size > 0) {
          currentTxs = applyRuleRankOrder(currentTxs, seriesRanks, occ.date, occ.date);
        }
        hasChanges = true;
        executedCount++;
    }
  }

  return {
    transactions: currentTxs,
    hasChanges,
    executedCount
  };
}
