import {
  Account,
  AppSettings,
  BalanceCorrection,
  BudgetPeriod,
  ForecastResult,
  PeriodSummary,
  AccountPeriodBalance,
  RecurringException,
  RecurringRule,
  Transaction,
  MarketValueSnapshot,
  InvestmentFee
} from '../types/finance';
import { addHaler, subHaler } from './currencyService';
import { getAccountBalanceAtDate } from './accountBalance';
import { getFeesUpToPeriod, getInvestedAmountAtValuation } from './investmentPerformanceService';
import { getAccountFlowInHaler, getEffectiveAmountInHaler } from './accountScope';
import { getPeriodForDate, getPreviousDay, isDateInPeriod, getDaysInMonth, getTodayInPrague } from './periodService';
import { sortTransactionsByDateAndSequence } from './sequenceService';

/**
 * Centrální finanční výpočetní služba pro CashPilot.
 * Veškeré částky jsou v celých haléřích (integer).
 */

export function doesRuleApplyInPeriod(
  rule: RecurringRule,
  period: BudgetPeriod
): boolean {
  if (!rule.isActive) return false;
  if (rule.startDate > period.endDate) return false;
  if (rule.endDate && rule.endDate < period.startDate) return false;

  const ruleStartPeriod = getPeriodForDate(rule.startDate, period.startDay);
  
  const monthDiff = (period.year - ruleStartPeriod.year) * 12 + (period.month - ruleStartPeriod.month);
  if (monthDiff < 0) return false;

  switch (rule.frequency) {
    case 'monthly':
      return true;
    case 'bi_monthly':
      return monthDiff % 2 === 0;
    case 'quarterly':
      return monthDiff % 3 === 0;
    case 'semi_annually':
      return monthDiff % 6 === 0;
    case 'annually':
      return monthDiff % 12 === 0;
    case 'custom': {
      const interval = rule.intervalDays || 30;
      const startMs = new Date(rule.startDate).getTime();
      const pStartMs = new Date(period.startDate).getTime();
      const pEndMs = new Date(period.endDate).getTime();
      
      let curMs = startMs;
      const stepMs = interval * 86400000;
      while (curMs <= pEndMs) {
        if (curMs >= pStartMs && curMs <= pEndMs) return true;
        curMs += stepMs;
      }
      return false;
    }
    default:
      return false;
  }
}

export function generateOccurrenceForPeriod(
  rule: RecurringRule,
  period: BudgetPeriod,
  exceptions: RecurringException[] = [],
  sequence: number = 1,
  todayStr?: string,
  accounts?: Account[]
): Transaction | null {
  const startDay = period.startDay;
  const safeExceptions = Array.isArray(exceptions) ? exceptions : [];
  const ex = safeExceptions.find(e => e.ruleId === rule.id && e.periodKey === period.key);
  if (ex && ex.isCancelled) {
    return null;
  }

  let occDate: string;
  if (ex && ex.overrideDate) {
    occDate = ex.overrideDate;
  } else {
    let y = period.year;
    let m = period.month;
    if (startDay > 1 && rule.dayOfMonth < startDay) {
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    const maxDays = getDaysInMonth(y, m);
    const day = Math.max(1, Math.min(rule.dayOfMonth, maxDays));
    occDate = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (occDate < period.startDate) occDate = period.startDate;
    if (occDate > period.endDate) occDate = period.endDate;
  }

  if (rule.endDate && occDate > rule.endDate) {
    return null;
  }
  if (rule.startDate && occDate < rule.startDate) {
    return null;
  }

  const sourceAccountId = ex && ex.overrideSourceAccountId
    ? ex.overrideSourceAccountId
    : rule.sourceAccountId;

  const targetAccountId = ex && ex.overrideTargetAccountId
    ? ex.overrideTargetAccountId
    : rule.targetAccountId;

  // Pravidlo data aktivace účtu: nevytvářet výskyt před datem počátečního stavu účtu
  if (accounts && accounts.length > 0) {
    const srcAcc = accounts.find(a => a.id === sourceAccountId);
    if (srcAcc?.initialBalanceDate && occDate < srcAcc.initialBalanceDate) {
      return null;
    }
    if (targetAccountId) {
      const tgtAcc = accounts.find(a => a.id === targetAccountId);
      if (tgtAcc?.initialBalanceDate && occDate < tgtAcc.initialBalanceDate) {
        return null;
      }
    }
  }

  const amount = ex && ex.overrideAmountInHaler !== undefined
    ? ex.overrideAmountInHaler
    : rule.amountInHaler;

  const categoryId = ex && ex.overrideCategoryId
    ? ex.overrideCategoryId
    : rule.categoryId;

  const subcategoryId = ex && ex.overrideSubcategoryId
    ? ex.overrideSubcategoryId
    : rule.subcategoryId;

  const today = todayStr || getTodayInPrague();
  const autoStatus: 'executed' | 'planned' = occDate <= today ? 'executed' : 'planned';

  return {
    id: `virtual_${rule.id}_${period.key}`,
    title: rule.title,
    amountInHaler: amount,
    date: occDate,
    sequence: Math.max(1, Math.round(sequence || 1)),
    type: rule.type,
    sourceAccountId,
    targetAccountId,
    categoryId,
    subcategoryId,
    status: autoStatus,
    plannedAmountInHaler: amount,
    actualAmountInHaler: autoStatus === 'executed' ? amount : undefined,
    recurringRuleId: rule.id,
    isException: !!ex,
    note: rule.note,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}

export function getEffectiveTransactionsForPeriod(
  period: BudgetPeriod,
  transactions: Transaction[] = [],
  rules: RecurringRule[] = [],
  exceptions: RecurringException[] = [],
  todayStr?: string,
  accounts?: Account[]
): Transaction[] {
  const safeTxs = Array.isArray(transactions) ? transactions : [];
  const safeRules = Array.isArray(rules) ? rules : [];
  const safeExceptions = Array.isArray(exceptions) ? exceptions : [];
  const today = todayStr || getTodayInPrague();

  const periodManual = safeTxs.filter(t => isDateInPeriod(t.date, period));

  // Zjištění nejvyššího existujícího pořadí pro každý den v periodě
  const dayMaxSeq = new Map<string, number>();
  for (const t of periodManual) {
    if (t.date) {
      const current = dayMaxSeq.get(t.date) || 0;
      const seq = t.sequence && t.sequence > 0 ? t.sequence : 1;
      if (seq > current) {
        dayMaxSeq.set(t.date, seq);
      }
    }
  }

  // Deterministické řazení pravidel podle data vytvoření (createdAt) a poté interního ID
  const sortedRules = [...safeRules].sort((a, b) => {
    const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    if (timeA !== timeB) {
      return timeA - timeB;
    }
    return a.id.localeCompare(b.id);
  });

  // Nashromáždit výskyty, které se pro tuto periodu ještě nemají zhmotnit jako reálná transakce,
  // seskupené podle dne. override = absolutní pozice jen pro tuto periodu (výjimka),
  // rank = pořadí mezi opakovanými platbami platné napříč obdobími (orderRank pravidla).
  type PendingOccurrence = { virtual: Transaction; override?: number; rank?: number; rankUpdatedAt?: string; position?: number };
  const pendingByDate = new Map<string, PendingOccurrence[]>();
  for (const rule of sortedRules) {
    if (!doesRuleApplyInPeriod(rule, period)) continue;
    const virtual = generateOccurrenceForPeriod(rule, period, safeExceptions, 1, today, accounts);
    if (!virtual) continue;

    const txsForRule = periodManual.filter(t => t.recurringRuleId === rule.id);
    let alreadyInstantiated = false;
    if (txsForRule.length > 0) {
      if (txsForRule.some(t => t.date === virtual.date)) {
        alreadyInstantiated = true;
      } else if (virtual.date > rule.startDate && txsForRule.every(t => t.date === rule.startDate)) {
        alreadyInstantiated = false;
      } else {
        alreadyInstantiated = true;
      }
    }
    if (alreadyInstantiated) continue;

    const ex = safeExceptions.find(e => e.ruleId === rule.id && e.periodKey === period.key);
    const list = pendingByDate.get(virtual.date) || [];
    list.push({ virtual, override: ex?.overrideSequence, rank: rule.orderRank, rankUpdatedAt: rule.orderRankUpdatedAt, position: rule.orderPosition });
    pendingByDate.set(virtual.date, list);
  }

  const virtualTransactions: Transaction[] = [];
  const adjustedManualByDate = new Map<string, Transaction[]>();

  for (const [occDate, pending] of pendingByDate.entries()) {
    const hasCustomOrder = pending.some(p => p.override !== undefined || p.rank !== undefined || p.position !== undefined);

    if (!hasCustomOrder) {
      // Beze změny oproti dřívějšímu chování: postupné přidávání na konec dne.
      for (const { virtual } of pending) {
        const currentMax = dayMaxSeq.get(occDate) || 0;
        const nextSeq = currentMax + 1;
        dayMaxSeq.set(occDate, nextSeq);
        virtual.sequence = nextSeq;
        virtualTransactions.push(virtual);
      }
      continue;
    }

    // Základ dne: ruční/zhmotněné položky, za ně virtuální výskyty. Výskyty s pořadím série
    // (rank) jdou první ve svém pořadí, ostatní za nimi v původním pořadí.
    const withoutOverride = pending.filter(p => p.override === undefined);
    const ranked = withoutOverride.filter(p => p.rank !== undefined).sort((a, b) => {
      if (a.rank !== b.rank) return (a.rank as number) - (b.rank as number);
      const timeA = a.rankUpdatedAt ? new Date(a.rankUpdatedAt).getTime() : 0;
      const timeB = b.rankUpdatedAt ? new Date(b.rankUpdatedAt).getTime() : 0;
      if (timeA !== timeB) return timeA - timeB;
      return (a.virtual.recurringRuleId || '').localeCompare(b.virtual.recurringRuleId || '');
    });
    const unranked = withoutOverride.filter(p => p.rank === undefined);
    const overridden = pending.filter(p => p.override !== undefined).sort((a, b) => {
      if (a.override !== b.override) return (a.override as number) - (b.override as number);
      return (a.virtual.recurringRuleId || '').localeCompare(b.virtual.recurringRuleId || '');
    });

    const dayItems: Transaction[] = periodManual
      .filter(t => t.date === occDate)
      .sort((a, b) => {
        const seqA = a.sequence ?? 1;
        const seqB = b.sequence ?? 1;
        if (seqA !== seqB) return seqA - seqB;
        return (a.id || '').localeCompare(b.id || '');
      })
      .map(t => ({ ...t }));

    // Výskyty s pozicí série (orderPosition) se vloží přímo na svou pozici ve dni - i před ruční
    // položky; ostatní jdou na konec. Vkládá se v pořadí ranku, aby vzájemné pořadí sedělo.
    const positioned = ranked.filter(p => p.position !== undefined);
    for (const { virtual } of [...ranked.filter(p => p.position === undefined), ...unranked]) {
      dayItems.push(virtual);
    }
    for (const { virtual, position } of positioned) {
      const clampedIndex = Math.max(0, Math.min((position as number) - 1, dayItems.length));
      dayItems.splice(clampedIndex, 0, virtual);
    }
    // Absolutní pozice pro tuto periodu (přetažení v konkrétním dni) se uplatní nakonec.
    for (const { virtual, override } of overridden) {
      const clampedIndex = Math.max(0, Math.min((override as number) - 1, dayItems.length));
      dayItems.splice(clampedIndex, 0, virtual);
    }

    const renumbered = dayItems.map((item, idx) => ({ ...item, sequence: idx + 1 }));

    const manualForDate: Transaction[] = [];
    for (const item of renumbered) {
      if (item.id.startsWith('virtual_')) {
        virtualTransactions.push(item);
      } else {
        manualForDate.push(item);
      }
    }
    adjustedManualByDate.set(occDate, manualForDate);
  }
  const finalManual = periodManual.map(t => {
    const adjusted = adjustedManualByDate.get(t.date);
    if (!adjusted) return t;
    return adjusted.find(a => a.id === t.id) || t;
  });

  return sortTransactionsByDateAndSequence([...finalManual, ...virtualTransactions]);
}

/**
 * Roztřídí položky do období podle data jedním průchodem (binární hledání v obdobích seřazených
 * podle začátku). Vrací null, pokud se období překrývají - pak volající filtruje postaru.
 */
export function groupTransactionsByPeriod(
  periods: BudgetPeriod[],
  transactions: Transaction[]
): Map<BudgetPeriod, Transaction[]> | null {
  const sorted = [...periods].sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startDate <= sorted[i - 1].endDate) return null;
  }

  const groups = new Map<BudgetPeriod, Transaction[]>();
  for (const period of sorted) groups.set(period, []);

  for (const tx of transactions) {
    if (!tx.date) continue;
    let lo = 0;
    let hi = sorted.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid].startDate <= tx.date) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (found >= 0 && tx.date <= sorted[found].endDate) {
      groups.get(sorted[found])!.push(tx);
    }
  }
  return groups;
}

export function calculateForecast(
  periods: BudgetPeriod[],
  accounts: Account[],
  transactions: Transaction[] = [],
  recurringRules: RecurringRule[] = [],
  recurringExceptions: RecurringException[] = [],
  corrections: BalanceCorrection[] = [],
  settings: AppSettings = {
    currency: 'CZK',
    budgetStartDay: 15,
    overdraftLimitInHaler: 2000000,
    minReserveInHaler: 2000000,
    roundAmounts: false
  },
  marketValueSnapshots: MarketValueSnapshot[] = [],
  currentPeriodKey?: string,
  todayStr?: string,
  investmentFees: InvestmentFee[] = []
): ForecastResult {
  const safeFees = Array.isArray(investmentFees) ? investmentFees : [];
  const safeAccounts = Array.isArray(accounts) ? accounts : [];
  const safeTxs = Array.isArray(transactions) ? transactions : [];
  const safeRules = Array.isArray(recurringRules) ? recurringRules : [];
  const safeExceptions = Array.isArray(recurringExceptions) ? recurringExceptions : [];
  const safeCorrections = Array.isArray(corrections) ? corrections : [];
  const safeSnapshots = Array.isArray(marketValueSnapshots) ? marketValueSnapshots : [];

  const periodSummaries: PeriodSummary[] = [];

  const firstPeriod = periods[0];
  const runningBalances: Record<string, number> = {};
  const investedPrincipals: Record<string, number> = {};

  for (const acc of safeAccounts) {
    const initDate = acc.initialBalanceDate || '1970-01-01';
    const initBal = acc.initialBalanceInHaler || 0;

    if (!firstPeriod || firstPeriod.startDate < initDate) {
      // První perioda začíná před datem aktivace účtu -> před aktivací je stav 0
      runningBalances[acc.id] = 0;
      investedPrincipals[acc.id] = 0;
    } else if (firstPeriod.startDate === initDate) {
      // Datum aktivace odpovídá přesně prvnímu dni období -> počáteční stav je počáteční zůstatek
      runningBalances[acc.id] = initBal;
      investedPrincipals[acc.id] = initBal;
    } else {
      // firstPeriod.startDate > initDate (účet byl aktivován již před začátkem první periody)
      runningBalances[acc.id] = getAccountBalanceAtDate(
        acc,
        getPreviousDay(firstPeriod.startDate),
        { transactions: safeTxs, corrections: safeCorrections, snapshots: safeSnapshots },
        { includePlanned: true }
      );
      investedPrincipals[acc.id] = acc.type === 'investment' || acc.type === 'pension'
        ? getInvestedAmountAtValuation(acc, safeTxs.filter(t => t.date < firstPeriod.startDate), firstPeriod.startDate)
        : runningBalances[acc.id];
    }
  }

  let overallMinBalance = Infinity;

  // Položky se do období roztřídí jednou předem, místo filtrování celé historie pro každé období.
  // Výsledné položky období se pak znovu použijí i pro předpověď (stejné vstupy => stejný výsledek).
  const txsByPeriod = groupTransactionsByPeriod(periods, safeTxs);
  const effectiveByPeriod = new Map<BudgetPeriod, Transaction[]>();
  const getEffectiveForPeriod = (period: BudgetPeriod): Transaction[] => {
    let effective = effectiveByPeriod.get(period);
    if (!effective) {
      effective = getEffectiveTransactionsForPeriod(
        period,
        txsByPeriod ? txsByPeriod.get(period) || [] : safeTxs,
        safeRules,
        safeExceptions,
        todayStr,
        safeAccounts
      );
      effectiveByPeriod.set(period, effective);
    }
    return effective;
  };

  for (const period of periods) {
    const effectiveTxs = getEffectiveForPeriod(period);

    const periodCorrections = safeCorrections.filter(c => {
      if (!isDateInPeriod(c.checkDate, period)) return false;
      const acc = safeAccounts.find(a => a.id === c.accountId);
      if (acc && (acc.type === 'investment' || acc.type === 'pension')) return false;
      if (acc && acc.initialBalanceDate && c.checkDate < acc.initialBalanceDate) return false;
      const alreadyInTxs = effectiveTxs.some(t => t.id === c.id || (t.type === 'balance_adjustment' && t.sourceAccountId === c.accountId && t.date === c.checkDate && t.diffInHaler === c.diffInHaler));
      return !alreadyInTxs;
    });

    const accountBalances: Record<string, AccountPeriodBalance> = {};

    let periodTotalIncome = 0;
    let periodTotalExpense = 0;
    let periodTotalTransfers = 0;
    let periodTotalCorrections = 0;

    let periodOpeningTotal = 0;
    let periodClosingTotal = 0;

    let usableOpening = 0;
    let usableClosing = 0;

    let netWorthOpening = 0;
    let netWorthClosing = 0;

    for (const acc of safeAccounts) {
      const initDate = acc.initialBalanceDate || '1970-01-01';
      const initBal = acc.initialBalanceInHaler || 0;

      let opening = 0;
      if (period.endDate < initDate) {
        // Celé období končí před datem aktivace účtu
        opening = 0;
      } else if (initDate >= period.startDate && initDate <= period.endDate) {
        // Datum počátečního stavu leží uvnitř rozpočtového období
        if (initDate === period.startDate) {
          opening = initBal;
        } else {
          opening = 0;
        }
      } else {
        // Období následující po období založení
        opening = runningBalances[acc.id] || 0;
      }

      periodOpeningTotal = addHaler(periodOpeningTotal, opening);
      if (acc.isUsableCash) {
        usableOpening = addHaler(usableOpening, opening);
      }
      if (acc.isNetWorth) {
        netWorthOpening = addHaler(netWorthOpening, opening);
      }

      accountBalances[acc.id] = {
        accountId: acc.id,
        openingBalanceInHaler: opening,
        incomeInHaler: 0,
        expenseInHaler: 0,
        transfersInInHaler: 0,
        transfersOutInHaler: 0,
        correctionsInHaler: 0,
        closingBalanceInHaler: opening,
      };
    }

    for (const tx of effectiveTxs) {
      if (tx.status === 'cancelled') {
        continue;
      }

      const amount = getEffectiveAmountInHaler(tx);

      const srcAcc = safeAccounts.find(a => a.id === tx.sourceAccountId);
      const isSrcActive = !srcAcc || !srcAcc.initialBalanceDate || tx.date >= srcAcc.initialBalanceDate;

      const tgtAcc = tx.targetAccountId ? safeAccounts.find(a => a.id === tx.targetAccountId) : undefined;
      const isTgtActive = !tgtAcc || !tgtAcc.initialBalanceDate || tx.date >= tgtAcc.initialBalanceDate;

      if (tx.type === 'income') {
        if (isSrcActive) {
          const accBal = accountBalances[tx.sourceAccountId];
          if (accBal) {
            accBal.incomeInHaler = addHaler(accBal.incomeInHaler, amount);
            investedPrincipals[tx.sourceAccountId] = addHaler(investedPrincipals[tx.sourceAccountId] || 0, amount);
          }
          periodTotalIncome = addHaler(periodTotalIncome, amount);
        }
      } else if (tx.type === 'expense') {
        if (isSrcActive) {
          const accBal = accountBalances[tx.sourceAccountId];
          if (accBal) {
            accBal.expenseInHaler = addHaler(accBal.expenseInHaler, amount);
            investedPrincipals[tx.sourceAccountId] = subHaler(investedPrincipals[tx.sourceAccountId] || 0, amount);
          }
          periodTotalExpense = addHaler(periodTotalExpense, amount);
        }
      } else if (tx.type === 'transfer') {
        if (tx.sourceAccountId && accountBalances[tx.sourceAccountId] && isSrcActive) {
          accountBalances[tx.sourceAccountId].transfersOutInHaler = addHaler(
            accountBalances[tx.sourceAccountId].transfersOutInHaler,
            amount
          );
          investedPrincipals[tx.sourceAccountId] = subHaler(investedPrincipals[tx.sourceAccountId] || 0, amount);
        }
        if (tx.targetAccountId && accountBalances[tx.targetAccountId] && isTgtActive) {
          accountBalances[tx.targetAccountId].transfersInInHaler = addHaler(
            accountBalances[tx.targetAccountId].transfersInInHaler,
            amount
          );
          investedPrincipals[tx.targetAccountId] = addHaler(
            investedPrincipals[tx.targetAccountId] || 0,
            amount
          );
        }
        if (isSrcActive || isTgtActive) {
          periodTotalTransfers = addHaler(periodTotalTransfers, amount);
        }
      } else if (tx.type === 'balance_adjustment') {
        if (isSrcActive) {
          const accBal = accountBalances[tx.sourceAccountId];
          const diff = tx.diffInHaler !== undefined ? tx.diffInHaler : amount;
          if (accBal) {
            accBal.correctionsInHaler = addHaler(accBal.correctionsInHaler, diff);
          }
          periodTotalCorrections = addHaler(periodTotalCorrections, diff);
        }
      }
    }

    for (const corr of periodCorrections) {
      const accBal = accountBalances[corr.accountId];
      if (accBal) {
        accBal.correctionsInHaler = addHaler(accBal.correctionsInHaler, corr.diffInHaler);
      }
      periodTotalCorrections = addHaler(periodTotalCorrections, corr.diffInHaler);
    }

    for (const acc of safeAccounts) {
      const accBal = accountBalances[acc.id];
      const initDate = acc.initialBalanceDate || '1970-01-01';
      const initBal = acc.initialBalanceInHaler || 0;
      const isAsset = acc.type === 'investment' || acc.type === 'pension';

      // 1. Období před aktivací účtu -> zůstatek je 0 Kč
      if (period.endDate < initDate) {
        accBal.openingBalanceInHaler = 0;
        accBal.incomeInHaler = 0;
        accBal.expenseInHaler = 0;
        accBal.transfersInInHaler = 0;
        accBal.transfersOutInHaler = 0;
        accBal.correctionsInHaler = 0;
        accBal.closingBalanceInHaler = 0;
        if (isAsset) {
          accBal.marketValueInHaler = 0;
          accBal.investedPrincipalInHaler = 0;
          accBal.contributedPrincipalInHaler = 0;
          accBal.feesInHaler = 0;
          accBal.unrealizedGainLossInHaler = 0;
        }
        runningBalances[acc.id] = 0;
        investedPrincipals[acc.id] = 0;
        continue;
      }

      // 2. Pokud je účet aktivován uvnitř období po prvním dni (initDate > period.startDate)
      const baseInitialToAdd = (initDate > period.startDate && initDate <= period.endDate) ? initBal : 0;

      let closing = 0;
      if (isAsset) {
        if (initDate >= period.startDate && initDate <= period.endDate) {
          investedPrincipals[acc.id] = subHaler(
            addHaler(initBal, accBal.transfersInInHaler, accBal.incomeInHaler),
            addHaler(accBal.transfersOutInHaler, accBal.expenseInHaler)
          );
        }

        const snapshotsInPeriod = safeSnapshots
          .filter(s => s.accountId === acc.id && s.date >= period.startDate && s.date <= period.endDate && s.date >= initDate)
          .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));

        if (snapshotsInPeriod.length > 0) {
          const latestSnapInPeriod = snapshotsInPeriod[0];
          const netTransfersAfterSnap = effectiveTxs
            .filter(t => t.status !== 'cancelled' && t.date > latestSnapInPeriod.date && t.date >= initDate)
            .reduce((sum, t) => addHaler(sum, getAccountFlowInHaler(t, acc.id)), 0);
          closing = addHaler(latestSnapInPeriod.marketValueInHaler, netTransfersAfterSnap);
        } else {
          closing = addHaler(
            accBal.openingBalanceInHaler,
            baseInitialToAdd,
            accBal.incomeInHaler,
            subHaler(0, accBal.expenseInHaler),
            accBal.transfersInInHaler,
            subHaler(0, accBal.transfersOutInHaler)
          );
        }

        accBal.marketValueInHaler = closing;
        accBal.contributedPrincipalInHaler = investedPrincipals[acc.id] || 0;
        accBal.feesInHaler = getFeesUpToPeriod(safeFees, acc.id, period.key);
        accBal.investedPrincipalInHaler = subHaler(accBal.contributedPrincipalInHaler, accBal.feesInHaler);
        accBal.unrealizedGainLossInHaler = subHaler(closing, accBal.investedPrincipalInHaler);
        accBal.closingBalanceInHaler = closing;
      } else {
        closing = addHaler(
          accBal.openingBalanceInHaler,
          baseInitialToAdd,
          accBal.incomeInHaler,
          subHaler(0, accBal.expenseInHaler),
          accBal.transfersInInHaler,
          subHaler(0, accBal.transfersOutInHaler),
          accBal.correctionsInHaler
        );
        accBal.closingBalanceInHaler = closing;
      }

      runningBalances[acc.id] = closing;
      periodClosingTotal = addHaler(periodClosingTotal, closing);

      if (acc.isUsableCash) {
        usableClosing = addHaler(usableClosing, closing);
      }
      if (acc.isNetWorth) {
        netWorthClosing = addHaler(netWorthClosing, closing);
      }
    }

    const netChange = addHaler(periodTotalIncome, subHaler(0, periodTotalExpense), periodTotalCorrections);
    const usableNetChange = subHaler(usableClosing, usableOpening);

    const isNegative = usableClosing < 0;

    periodSummaries.push({
      period,
      openingBalanceInHaler: periodOpeningTotal,
      incomeInHaler: periodTotalIncome,
      expenseInHaler: periodTotalExpense,
      transfersInHaler: periodTotalTransfers,
      correctionsInHaler: periodTotalCorrections,
      netChangeInHaler: netChange,
      closingBalanceInHaler: periodClosingTotal,
      accountBalances,
      usableOpeningInHaler: usableOpening,
      usableClosingInHaler: usableClosing,
      usableNetChangeInHaler: usableNetChange,
      netWorthOpeningInHaler: netWorthOpening,
      netWorthClosingInHaler: netWorthClosing,
      isNegativeBalance: isNegative,
      minUsableBalanceInHaler: usableClosing,
    });
  }

  const today = todayStr || getTodayInPrague();
  let resolvedCurrentPeriod = currentPeriodKey
    ? periods.find(p => p.key === currentPeriodKey)
    : periods.find(p => isDateInPeriod(today, p));

  if (!resolvedCurrentPeriod) {
    resolvedCurrentPeriod = periods[0] || {
      key: '2026-09',
      name: 'Září 2026',
      year: 2026,
      month: 9,
      startDate: '2026-09-15',
      endDate: '2026-10-14'
    };
  }

  const currentSummary = periodSummaries.find(p => p.period.key === resolvedCurrentPeriod.key) || periodSummaries[0];

  const currentPeriodIdx = periodSummaries.findIndex(p => p.period.key === resolvedCurrentPeriod.key);
  const forecastMonths = 12;
  const historicalForecastPeriods = currentPeriodIdx >= 0
    ? periodSummaries.slice(currentPeriodIdx, currentPeriodIdx + forecastMonths)
    : periodSummaries.slice(0, forecastMonths);

  // Keep historical period balances intact; anchor the projected asset closing at today's value.
  // The period that has already started keeps its period-start opening and full-period flows,
  // so the row still adds up (opening + flows = closing, unless the market value changed).
  const assetValues = new Map(safeAccounts
    .filter(a => (a.type === 'investment' || a.type === 'pension') && (!a.initialBalanceDate || a.initialBalanceDate <= today))
    .map(a => [a.id, getAccountBalanceAtDate(a, today, { transactions: safeTxs, snapshots: safeSnapshots })]));
  const forecastPeriods = historicalForecastPeriods.map(summary => {
    const projected = { ...summary, accountBalances: { ...summary.accountBalances } };
    const remainingTxs = getEffectiveForPeriod(summary.period)
      .filter(t => t.status !== 'cancelled' && !(t.status === 'executed' && t.date <= today));
    for (const acc of safeAccounts) {
      const anchor = assetValues.get(acc.id);
      if (anchor === undefined) continue;
      const original = summary.accountBalances[acc.id];
      let remainingFlow = 0;
      for (const tx of remainingTxs) {
        remainingFlow = addHaler(remainingFlow, getAccountFlowInHaler(tx, acc.id));
      }
      const opening = summary.period.startDate <= today ? original.openingBalanceInHaler : anchor;
      const closing = addHaler(anchor, remainingFlow);
      projected.accountBalances[acc.id] = {
        ...original, openingBalanceInHaler: opening, closingBalanceInHaler: closing,
        marketValueInHaler: closing,
        unrealizedGainLossInHaler: subHaler(closing, original.investedPrincipalInHaler || 0),
      };
      projected.openingBalanceInHaler += opening - original.openingBalanceInHaler;
      projected.closingBalanceInHaler += closing - original.closingBalanceInHaler;
      if (acc.isNetWorth) {
        projected.netWorthOpeningInHaler += opening - original.openingBalanceInHaler;
        projected.netWorthClosingInHaler += closing - original.closingBalanceInHaler;
      }
      assetValues.set(acc.id, closing);
    }
    return projected;
  });

  overallMinBalance = Infinity;
  for (const s of forecastPeriods) {
    if (s.usableClosingInHaler < overallMinBalance) {
      overallMinBalance = s.usableClosingInHaler;
    }
  }

  return {
    periods: periodSummaries,
    forecastPeriods,
    allPeriods: periodSummaries,
    currentPeriod: resolvedCurrentPeriod,
    overallMinBalanceInHaler: overallMinBalance === Infinity ? 0 : overallMinBalance,
    usableCashNowInHaler: (() => {
      let usableNow = currentSummary ? currentSummary.usableOpeningInHaler : 0;
      if (currentSummary) {
        for (const acc of safeAccounts) {
          const initDate = acc.initialBalanceDate || '1970-01-01';
          if (initDate > currentSummary.period.startDate && initDate <= today && acc.isUsableCash) {
            usableNow = addHaler(usableNow, acc.initialBalanceInHaler);
          }
        }
      }
      return usableNow;
    })(),
    expectedClosingCurrentPeriodInHaler: currentSummary ? currentSummary.usableClosingInHaler : 0,
    netWorthNowInHaler: (() => {
      let netWorthNow = currentSummary ? currentSummary.netWorthOpeningInHaler : 0;
      if (currentSummary) {
        for (const acc of safeAccounts) {
          const initDate = acc.initialBalanceDate || '1970-01-01';
          if (initDate > currentSummary.period.startDate && initDate <= today && acc.isNetWorth) {
            netWorthNow = addHaler(netWorthNow, acc.initialBalanceInHaler);
          }
        }
      }
      for (const acc of safeAccounts) {
        if (!acc.isNetWorth || (acc.type !== 'investment' && acc.type !== 'pension')) continue;
        const initDate = acc.initialBalanceDate || '1970-01-01';
        const previousValue = currentSummary?.accountBalances[acc.id]?.openingBalanceInHaler || 0;
        const activatedValue = currentSummary && initDate > currentSummary.period.startDate && initDate <= today
          ? acc.initialBalanceInHaler : 0;
        netWorthNow += getAccountBalanceAtDate(acc, today, { transactions: safeTxs, snapshots: safeSnapshots }) - previousValue - activatedValue;
      }
      return netWorthNow;
    })(),
    plannedIncomeCurrentPeriodInHaler: currentSummary ? currentSummary.incomeInHaler : 0,
    plannedExpenseCurrentPeriodInHaler: currentSummary ? currentSummary.expenseInHaler : 0,
  };
}

export interface QuickFinancialOverview {
  checkingAndCashInHaler: number;
  checkingInHaler: number;
  cashInHaler: number;
  savingsInHaler: number;
  investmentsInHaler: number;
  pensionInHaler: number;
  totalNetWorthInHaler: number;
}

/**
 * Spočítá aktuální finanční přehled k danému kalendářnímu dni (výchozí: dnešek v Praze).
 * Nezahrnuje budoucí plánované položky, budoucí tržní hodnoty, archivované účty ani kontokorent.
 * Skupiny zahrnují všechny aktivní účty; celkové jmění pouze účty s isNetWorth.
 */
export function calculateQuickFinancialOverview(
  accounts: Account[] = [],
  transactions: Transaction[] = [],
  corrections: BalanceCorrection[] = [],
  marketValueSnapshots: MarketValueSnapshot[] = [],
  todayStr: string = getTodayInPrague()
): QuickFinancialOverview {
  const safeAccounts = Array.isArray(accounts) ? accounts.filter(a => a.status !== 'archived') : [];
  const safeTxs = Array.isArray(transactions) ? transactions : [];
  const safeCorrections = Array.isArray(corrections) ? corrections : [];
  const safeSnapshots = Array.isArray(marketValueSnapshots) ? marketValueSnapshots : [];

  let checkingAndCashInHaler = 0;
  let checkingInHaler = 0;
  let cashInHaler = 0;
  let savingsInHaler = 0;
  let investmentsInHaler = 0;
  let pensionInHaler = 0;
  let totalNetWorthInHaler = 0;

  for (const acc of safeAccounts) {
    const balance = getAccountBalanceAtDate(acc, todayStr, {
      transactions: safeTxs,
      corrections: safeCorrections,
      snapshots: safeSnapshots,
    });

    if (acc.type === 'checking' || acc.type === 'cash') {
      checkingAndCashInHaler = addHaler(checkingAndCashInHaler, balance);
      if (acc.type === 'checking') checkingInHaler = addHaler(checkingInHaler, balance);
      else cashInHaler = addHaler(cashInHaler, balance);
    } else if (acc.type === 'savings') {
      savingsInHaler = addHaler(savingsInHaler, balance);
    } else if (acc.type === 'investment') {
      investmentsInHaler = addHaler(investmentsInHaler, balance);
    } else if (acc.type === 'pension') {
      pensionInHaler = addHaler(pensionInHaler, balance);
    }
    // Account groups show all active balances; only net worth uses this opt-in.
    if (acc.isNetWorth) totalNetWorthInHaler = addHaler(totalNetWorthInHaler, balance);
  }

  return {
    checkingAndCashInHaler,
    checkingInHaler,
    cashInHaler,
    savingsInHaler,
    investmentsInHaler,
    pensionInHaler,
    totalNetWorthInHaler,
  };
}

