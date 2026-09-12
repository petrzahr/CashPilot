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
  MarketValueSnapshot
} from '../types/finance';
import { addHaler, subHaler } from './currencyService';
import { getPeriodForDate, isDateInPeriod, getDaysInMonth, getTodayInPrague } from './periodService';
import { sortTransactionsByDateAndSequence } from './sequenceService';

/**
 * Centrální finanční výpočetní služba pro CashPilot.
 * Veškeré částky jsou v celých haléřích (integer).
 */

export function doesRuleApplyInPeriod(
  rule: RecurringRule,
  period: BudgetPeriod,
  startDay: number = 15
): boolean {
  if (!rule.isActive) return false;
  if (rule.startDate > period.endDate) return false;
  if (rule.endDate && rule.endDate < period.startDate) return false;

  const ruleStartPeriod = getPeriodForDate(rule.startDate, startDay);
  
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
  startDay: number = 15,
  sequence: number = 1,
  todayStr?: string,
  accounts?: Account[]
): Transaction | null {
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
  startDay: number = 15,
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

  const virtualTransactions: Transaction[] = [];
  for (const rule of sortedRules) {
    if (doesRuleApplyInPeriod(rule, period, startDay)) {
      const virtual = generateOccurrenceForPeriod(rule, period, safeExceptions, startDay, 1, today, accounts);
      if (virtual) {
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

        if (!alreadyInstantiated) {
          const occDate = virtual.date;
          const currentMax = dayMaxSeq.get(occDate) || 0;
          const nextSeq = currentMax + 1;
          dayMaxSeq.set(occDate, nextSeq);
          virtual.sequence = nextSeq;
          virtualTransactions.push(virtual);
        }
      }
    }
  }

  return sortTransactionsByDateAndSequence([...periodManual, ...virtualTransactions]);
}

/**
 * Vypočítá přesný stav účtu k zadanému kalendářnímu datu a volitelně před zadaným pořadím v rámci dne.
 * Používá se pro určení vypočítaného stavu před aplikací nové korekce zůstatku.
 */
export function getAccountBalanceAtDate(
  accountId: string,
  targetDate: string,
  targetSequence?: number,
  transactions: Transaction[] = [],
  corrections: BalanceCorrection[] = [],
  accounts: Account[] = []
): number {
  const safeAccounts = Array.isArray(accounts) ? accounts : [];
  const safeTxs = Array.isArray(transactions) ? transactions : [];
  const safeCorrections = Array.isArray(corrections) ? corrections : [];

  const account = safeAccounts.find(a => a.id === accountId);
  if (!account) return 0;

  const initDate = account.initialBalanceDate || '1970-01-01';
  // Před datem aktivace účet ještě neexistuje a jeho zůstatek je striktně 0 Kč
  if (targetDate < initDate) {
    return 0;
  }

  let balance = account.initialBalanceInHaler;

  const relevantTxs = safeTxs.filter(t => {
    if (t.status === 'cancelled') return false;
    if (t.sourceAccountId !== accountId && t.targetAccountId !== accountId) return false;
    if (t.date < initDate) return false;
    if (t.date < targetDate) return true;
    if (t.date === targetDate) {
      if (targetSequence !== undefined) {
        return (t.sequence ?? 1) < targetSequence;
      }
      return true;
    }
    return false;
  });

  const sorted = sortTransactionsByDateAndSequence(relevantTxs, 'asc');

  for (const t of sorted) {
    const amount = t.status === 'executed' && t.actualAmountInHaler !== undefined
      ? t.actualAmountInHaler
      : t.amountInHaler;

    if (t.type === 'income' && t.sourceAccountId === accountId) {
      balance = addHaler(balance, amount);
    } else if (t.type === 'expense' && t.sourceAccountId === accountId) {
      balance = subHaler(balance, amount);
    } else if (t.type === 'transfer') {
      if (t.sourceAccountId === accountId) {
        balance = subHaler(balance, amount);
      }
      if (t.targetAccountId === accountId) {
        balance = addHaler(balance, amount);
      }
    } else if (t.type === 'balance_adjustment' && t.sourceAccountId === accountId) {
      const diff = t.diffInHaler !== undefined ? t.diffInHaler : amount;
      balance = addHaler(balance, diff);
    }
  }

  // Započíst starší legacy korekce pouze pro standardní účty a pouze pokud nejsou již v transactions
  if (account.type !== 'investment' && account.type !== 'pension') {
    const relevantLegacyCorrections = safeCorrections.filter(c => {
      if (c.accountId !== accountId) return false;
      if (c.checkDate < initDate) return false;
      const isAlreadyInTxs = safeTxs.some(t => t.id === c.id || (t.type === 'balance_adjustment' && t.date === c.checkDate && t.diffInHaler === c.diffInHaler));
      if (isAlreadyInTxs) return false;
      return c.checkDate <= targetDate;
    });
    for (const c of relevantLegacyCorrections) {
      balance = addHaler(balance, c.diffInHaler);
    }
  }

  return balance;
}

export function getAccountBalanceBeforeDate(
  accountId: string,
  targetStartDate: string,
  transactions: Transaction[] = [],
  corrections: BalanceCorrection[] = [],
  accounts: Account[] = []
): number {
  const safeAccounts = Array.isArray(accounts) ? accounts : [];
  const safeTxs = Array.isArray(transactions) ? transactions : [];
  const safeCorrections = Array.isArray(corrections) ? corrections : [];

  const account = safeAccounts.find(a => a.id === accountId);
  if (!account) return 0;

  const initDate = account.initialBalanceDate || '1970-01-01';
  // Pokud datum začátku leží před datem aktivace nebo v den aktivace, před tímto dnem je zůstatek 0
  if (targetStartDate <= initDate) {
    return 0;
  }

  let balance = account.initialBalanceInHaler;

  const priorTxs = safeTxs.filter(t => 
    t.date >= initDate &&
    t.date < targetStartDate && 
    t.status !== 'cancelled' &&
    (t.sourceAccountId === accountId || t.targetAccountId === accountId)
  );

  for (const t of priorTxs) {
    const amount = t.status === 'executed' && t.actualAmountInHaler !== undefined
      ? t.actualAmountInHaler
      : t.amountInHaler;

    if (t.type === 'income' && t.sourceAccountId === accountId) {
      balance = addHaler(balance, amount);
    } else if (t.type === 'expense' && t.sourceAccountId === accountId) {
      balance = subHaler(balance, amount);
    } else if (t.type === 'transfer') {
      if (t.sourceAccountId === accountId) {
        balance = subHaler(balance, amount);
      }
      if (t.targetAccountId === accountId) {
        balance = addHaler(balance, amount);
      }
    } else if (t.type === 'balance_adjustment' && t.sourceAccountId === accountId) {
      const diff = t.diffInHaler !== undefined ? t.diffInHaler : amount;
      balance = addHaler(balance, diff);
    }
  }

  // Korekce zůstatku se aplikují POUZE pro standardní účty (nikoliv pro majetkové investiční a penzijní účty)
  if (account.type !== 'investment' && account.type !== 'pension') {
    const priorCorrections = safeCorrections.filter(c => {
      if (c.accountId !== accountId || c.checkDate < initDate || c.checkDate >= targetStartDate) return false;
      const isAlreadyInTxs = safeTxs.some(t => t.id === c.id || (t.type === 'balance_adjustment' && t.date === c.checkDate && t.diffInHaler === c.diffInHaler));
      return !isAlreadyInTxs;
    });
    for (const c of priorCorrections) {
      balance = addHaler(balance, c.diffInHaler);
    }
  }

  return balance;
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
    forecastMonths: 12,
    roundAmounts: false
  },
  marketValueSnapshots: MarketValueSnapshot[] = [],
  currentPeriodKey?: string,
  todayStr?: string
): ForecastResult {
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
    const isAsset = acc.type === 'investment' || acc.type === 'pension';
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
      if (isAsset) {
        const priorSnapshots = safeSnapshots
          .filter(s => s.accountId === acc.id && s.date >= initDate && (!firstPeriod || s.date <= firstPeriod.startDate))
          .sort((a, b) => b.date.localeCompare(a.date));
        const latestPriorSnap = priorSnapshots[0];

        let baseVal = initBal;
        let valDate = initDate;

        if (latestPriorSnap) {
          baseVal = latestPriorSnap.marketValueInHaler;
          valDate = latestPriorSnap.date;
        } else if (acc.currentMarketValueInHaler !== undefined && acc.marketValueUpdatedAt && acc.marketValueUpdatedAt >= initDate && (!firstPeriod || acc.marketValueUpdatedAt <= firstPeriod.startDate)) {
          baseVal = acc.currentMarketValueInHaler;
          valDate = acc.marketValueUpdatedAt;
        } else if (acc.currentMarketValueInHaler !== undefined) {
          baseVal = acc.currentMarketValueInHaler;
        }

        let netTransfers = 0;
        if (firstPeriod) {
          for (const t of safeTxs) {
            if (t.status === 'cancelled' || t.type !== 'transfer') continue;
            if (t.date >= initDate && t.date > valDate && t.date < firstPeriod.startDate) {
              const amt = t.status === 'executed' && t.actualAmountInHaler !== undefined ? t.actualAmountInHaler : t.amountInHaler;
              if (t.targetAccountId === acc.id) netTransfers = addHaler(netTransfers, amt);
              if (t.sourceAccountId === acc.id) netTransfers = subHaler(netTransfers, amt);
            }
          }
        }
        runningBalances[acc.id] = addHaler(baseVal, netTransfers);
      } else {
        runningBalances[acc.id] = getAccountBalanceBeforeDate(
          acc.id,
          firstPeriod.startDate,
          safeTxs,
          safeCorrections,
          safeAccounts
        );
      }
      investedPrincipals[acc.id] = runningBalances[acc.id];
    }
  }

  let overallMinBalance = Infinity;
  let earliestShortage: BudgetPeriod | null = null;

  for (const period of periods) {
    const effectiveTxs = getEffectiveTransactionsForPeriod(
      period,
      safeTxs,
      safeRules,
      safeExceptions,
      settings.budgetStartDay,
      todayStr,
      safeAccounts
    );

    const periodCorrections = safeCorrections.filter(c => {
      if (!isDateInPeriod(c.checkDate, period)) return false;
      const acc = safeAccounts.find(a => a.id === c.accountId);
      if (acc && (acc.type === 'investment' || acc.type === 'pension')) return false;
      if (acc && acc.initialBalanceDate && c.checkDate < acc.initialBalanceDate) return false;
      const alreadyInTxs = effectiveTxs.some(t => t.id === c.id || (t.type === 'balance_adjustment' && t.date === c.checkDate && t.diffInHaler === c.diffInHaler));
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

      const amount = (tx.status === 'executed' && tx.actualAmountInHaler !== undefined)
        ? tx.actualAmountInHaler
        : tx.amountInHaler;

      const srcAcc = safeAccounts.find(a => a.id === tx.sourceAccountId);
      const isSrcActive = !srcAcc || !srcAcc.initialBalanceDate || tx.date >= srcAcc.initialBalanceDate;

      const tgtAcc = tx.targetAccountId ? safeAccounts.find(a => a.id === tx.targetAccountId) : undefined;
      const isTgtActive = !tgtAcc || !tgtAcc.initialBalanceDate || tx.date >= tgtAcc.initialBalanceDate;

      if (tx.type === 'income') {
        if (isSrcActive) {
          const accBal = accountBalances[tx.sourceAccountId];
          if (accBal) {
            accBal.incomeInHaler = addHaler(accBal.incomeInHaler, amount);
          }
          periodTotalIncome = addHaler(periodTotalIncome, amount);
        }
      } else if (tx.type === 'expense') {
        if (isSrcActive) {
          const accBal = accountBalances[tx.sourceAccountId];
          if (accBal) {
            accBal.expenseInHaler = addHaler(accBal.expenseInHaler, amount);
          }
          periodTotalExpense = addHaler(periodTotalExpense, amount);
        }
      } else if (tx.type === 'transfer') {
        if (tx.sourceAccountId && accountBalances[tx.sourceAccountId] && isSrcActive) {
          accountBalances[tx.sourceAccountId].transfersOutInHaler = addHaler(
            accountBalances[tx.sourceAccountId].transfersOutInHaler,
            amount
          );
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
          investedPrincipals[acc.id] = addHaler(initBal, accBal.transfersInInHaler);
        }

        const snapshotsInPeriod = safeSnapshots
          .filter(s => s.accountId === acc.id && s.date >= period.startDate && s.date <= period.endDate && s.date >= initDate)
          .sort((a, b) => b.date.localeCompare(a.date));

        if (snapshotsInPeriod.length > 0) {
          const latestSnapInPeriod = snapshotsInPeriod[0];
          const netTransfersAfterSnap = effectiveTxs
            .filter(t => t.status !== 'cancelled' && t.type === 'transfer' && t.date > latestSnapInPeriod.date && t.date >= initDate)
            .reduce((sum, t) => {
              const amt = t.status === 'executed' && t.actualAmountInHaler !== undefined ? t.actualAmountInHaler : t.amountInHaler;
              if (t.targetAccountId === acc.id) return addHaler(sum, amt);
              if (t.sourceAccountId === acc.id) return subHaler(sum, amt);
              return sum;
            }, 0);
          closing = addHaler(latestSnapInPeriod.marketValueInHaler, netTransfersAfterSnap);
        } else {
          closing = addHaler(
            accBal.openingBalanceInHaler,
            baseInitialToAdd,
            accBal.transfersInInHaler,
            subHaler(0, accBal.transfersOutInHaler)
          );
        }

        accBal.marketValueInHaler = closing;
        accBal.investedPrincipalInHaler = investedPrincipals[acc.id];
        accBal.unrealizedGainLossInHaler = subHaler(closing, investedPrincipals[acc.id] || 0);
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
    const overdraftLimit = settings.overdraftLimitInHaler ?? settings.minReserveInHaler ?? 0;
    const isBelowReserve = usableClosing < overdraftLimit;

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
      isBelowReserve: isBelowReserve,
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
  const forecastMonths = settings.forecastMonths || 12;
  const forecastPeriods = currentPeriodIdx >= 0
    ? periodSummaries.slice(currentPeriodIdx, currentPeriodIdx + forecastMonths)
    : periodSummaries.slice(0, forecastMonths);

  overallMinBalance = Infinity;
  earliestShortage = null;
  for (const s of forecastPeriods) {
    if (s.usableClosingInHaler < overallMinBalance) {
      overallMinBalance = s.usableClosingInHaler;
    }
    if (!earliestShortage && (s.isNegativeBalance || s.isBelowReserve)) {
      earliestShortage = s.period;
    }
  }

  return {
    periods: periodSummaries,
    forecastPeriods,
    allPeriods: periodSummaries,
    currentPeriod: resolvedCurrentPeriod,
    earliestShortagePeriod: earliestShortage,
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
      return netWorthNow;
    })(),
    plannedIncomeCurrentPeriodInHaler: currentSummary ? currentSummary.incomeInHaler : 0,
    plannedExpenseCurrentPeriodInHaler: currentSummary ? currentSummary.expenseInHaler : 0,
  };
}
