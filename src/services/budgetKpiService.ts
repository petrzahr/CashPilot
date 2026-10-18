import { Account, AccountPeriodBalance, Transaction } from '../types/finance';
import { addHaler, subHaler } from './currencyService';

export interface DefaultAccountKpis {
  actuallySavedInHaler: number;
  actuallySavedPct: number | null;
  savedInHaler: number;
  savedPct: number | null;
  investedInHaler: number;
  investedPct: number | null;
}

/**
 * KPI dlaždice Měsíčního rozpočtu počítané jen z výchozího účtu:
 * - Skutečně uspořeno = příjmy − výdaje + korekce výchozího účtu (bez převodů)
 * - Uspořeno / Investováno = čisté převody mezi výchozím účtem a spořicími,
 *   resp. investičními a penzijními účty (z výchozího účtu +, zpět na něj −)
 * - procenta se počítají z příjmů výchozího účtu
 */
export function calculateDefaultAccountKpis(
  defaultAccount: Account | undefined,
  accounts: Account[],
  defaultBalance: AccountPeriodBalance | undefined,
  periodTransactions: Transaction[]
): DefaultAccountKpis {
  const income = defaultBalance?.incomeInHaler ?? 0;
  const actuallySavedInHaler = defaultBalance
    ? addHaler(subHaler(defaultBalance.incomeInHaler, defaultBalance.expenseInHaler), defaultBalance.correctionsInHaler)
    : 0;

  let savedInHaler = 0;
  let investedInHaler = 0;
  if (defaultAccount) {
    const typeById = new Map(accounts.filter(a => a.status === 'active').map(a => [a.id, a.type]));
    for (const tx of periodTransactions) {
      if (tx.type !== 'transfer' || tx.status === 'cancelled') continue;
      const amount = tx.status === 'executed' && tx.actualAmountInHaler !== undefined ? tx.actualAmountInHaler : tx.amountInHaler;
      let counterpartyId: string | undefined;
      let signed = 0;
      if (tx.sourceAccountId === defaultAccount.id) {
        counterpartyId = tx.targetAccountId;
        signed = amount;
      } else if (tx.targetAccountId === defaultAccount.id) {
        counterpartyId = tx.sourceAccountId;
        signed = -amount;
      } else {
        continue;
      }
      const type = counterpartyId ? typeById.get(counterpartyId) : undefined;
      if (type === 'savings') savedInHaler = addHaler(savedInHaler, signed);
      else if (type === 'investment' || type === 'pension') investedInHaler = addHaler(investedInHaler, signed);
    }
  }

  const pct = (amount: number) => (income > 0 ? (amount / income) * 100 : null);
  return {
    actuallySavedInHaler,
    actuallySavedPct: pct(actuallySavedInHaler),
    savedInHaler,
    savedPct: pct(savedInHaler),
    investedInHaler,
    investedPct: pct(investedInHaler),
  };
}
