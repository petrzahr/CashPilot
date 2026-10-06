import { Account, Category, RecurringException, RecurringRule, Transaction } from '../types/finance';
import { BudgetPeriodInfo } from './analyticsEngine';
import { czechStringCompare, sortCategoriesAlphabetically } from './categoryService';
import { addHaler } from './currencyService';
import { getEffectiveTransactionsForPeriod } from './financialEngine';

export type CategoryBreakdownGroup = 'income' | 'expense' | 'transfer';

export interface CategoryBreakdownSubRow {
  key: string;
  label: string;
  amountsInHaler: number[];   // částka za každé období (index odpovídá periods)
  totalInHaler: number;
}

export interface CategoryBreakdownRow {
  key: string;
  label: string;
  color: string;
  group: CategoryBreakdownGroup;
  amountsInHaler: number[];
  totalInHaler: number;
  children: CategoryBreakdownSubRow[];
}

export interface CategoryBreakdownResult {
  rows: CategoryBreakdownRow[];   // příjmové A–Z, výdajové A–Z, nakonec Spoření & Převody
  incomeTotalsInHaler: number[];
  incomeTotalInHaler: number;
  expenseTotalsInHaler: number[];
  expenseTotalInHaler: number;
}

export const NO_SUBCATEGORY_LABEL = '(bez podkategorie)';
const UNCATEGORIZED_KEY = '__uncategorized';
const TRANSFERS_KEY = '__transfers';

const effectiveAmount = (t: Transaction) =>
  t.status === 'executed' && t.actualAmountInHaler !== undefined ? t.actualAmountInHaler : t.amountInHaler;

const sum = (values: number[]) => values.reduce((s, v) => addHaler(s, v), 0);

/**
 * Souhrn podle kategorií a podkategorií za každé rozpočtové období vybraného rozsahu.
 * Položky období se berou stejně jako v "Přehledu rozpočtu podle kategorií" v Měsíčním
 * rozpočtu (efektivní položky celého období včetně plánovaných a opakovaných, bez zrušených).
 * Kategorie i podkategorie jsou řazené abecedně (nejdřív příjmové, pak výdajové), prázdné
 * řádky se vynechávají. Převody jsou v samostatném řádku "Spoření & Převody" rozpadlém
 * podle cílového účtu.
 */
export function calculateCategoryBreakdown(
  periods: BudgetPeriodInfo[],
  transactions: Transaction[],
  recurringRules: RecurringRule[],
  recurringExceptions: RecurringException[],
  categories: Category[],
  accounts: Account[],
  startDay: number
): CategoryBreakdownResult {
  const periodCount = periods.length;
  const zeros = () => new Array<number>(periodCount).fill(0);

  const catMap = new Map(categories.map((c) => [c.id, c]));
  const accMap = new Map(accounts.map((a) => [a.id, a]));

  // mainId -> (subKey -> částky po obdobích); subKey '' = přímo na hlavní kategorii
  const catAmounts = new Map<string, Map<string, number[]>>();
  // targetAccountId -> částky po obdobích
  const transferAmounts = new Map<string, number[]>();
  // Nezařazené položky podle typu
  const uncategorized = { income: zeros(), expense: zeros() };

  const add = (map: Map<string, number[]>, key: string, idx: number, amount: number) => {
    let arr = map.get(key);
    if (!arr) {
      arr = zeros();
      map.set(key, arr);
    }
    arr[idx] = addHaler(arr[idx], amount);
  };

  periods.forEach((p, idx) => {
    const txs = getEffectiveTransactionsForPeriod(
      p.period,
      transactions,
      recurringRules,
      recurringExceptions,
      startDay,
      undefined,
      accounts
    );

    for (const t of txs) {
      if (t.status === 'cancelled' || t.type === 'balance_adjustment') continue;
      const amount = effectiveAmount(t);

      if (t.type === 'transfer') {
        add(transferAmounts, t.targetAccountId || '', idx, amount);
        continue;
      }

      // Položka může mít v categoryId rovnou podkategorii - dohledáme její hlavní kategorii
      const cat = t.categoryId ? catMap.get(t.categoryId) : undefined;
      const sub = t.subcategoryId ? catMap.get(t.subcategoryId) : cat?.parentId ? cat : undefined;
      const mainId = sub?.parentId ?? (cat && !cat.parentId ? cat.id : undefined);

      if (!mainId || !catMap.has(mainId)) {
        const bucket = t.type === 'income' ? uncategorized.income : uncategorized.expense;
        bucket[idx] = addHaler(bucket[idx], amount);
        continue;
      }

      let subs = catAmounts.get(mainId);
      if (!subs) {
        subs = new Map();
        catAmounts.set(mainId, subs);
      }
      add(subs, sub?.id ?? '', idx, amount);
    }
  });

  const buildCategoryRow = (main: Category): CategoryBreakdownRow | null => {
    const subs = catAmounts.get(main.id);
    if (!subs) return null;

    const children: CategoryBreakdownSubRow[] = [...subs.entries()]
      .map(([subId, amounts]) => ({
        key: subId || `${main.id}__direct`,
        label: subId ? catMap.get(subId)?.name ?? NO_SUBCATEGORY_LABEL : NO_SUBCATEGORY_LABEL,
        amountsInHaler: amounts,
        totalInHaler: sum(amounts),
      }))
      .filter((c) => c.amountsInHaler.some((v) => v !== 0))
      // "(bez podkategorie)" vždy na konec, ostatní abecedně
      .sort((a, b) =>
        a.label === NO_SUBCATEGORY_LABEL ? 1 : b.label === NO_SUBCATEGORY_LABEL ? -1 : czechStringCompare(a.label, b.label)
      );

    if (children.length === 0) return null;

    const amountsInHaler = zeros().map((_, i) => sum(children.map((c) => c.amountsInHaler[i])));
    return {
      key: main.id,
      label: main.name,
      color: main.color,
      group: main.type === 'income' ? 'income' : 'expense',
      amountsInHaler,
      totalInHaler: sum(amountsInHaler),
      children,
    };
  };

  const mains = categories.filter((c) => !c.parentId);
  const incomeRows = sortCategoriesAlphabetically(mains.filter((c) => c.type === 'income'))
    .map(buildCategoryRow)
    .filter((r): r is CategoryBreakdownRow => r !== null);
  const expenseRows = sortCategoriesAlphabetically(mains.filter((c) => c.type !== 'income'))
    .map(buildCategoryRow)
    .filter((r): r is CategoryBreakdownRow => r !== null);

  const uncategorizedRow = (group: 'income' | 'expense'): CategoryBreakdownRow[] => {
    const amounts = uncategorized[group];
    if (!amounts.some((v) => v !== 0)) return [];
    return [{
      key: `${UNCATEGORIZED_KEY}_${group}`,
      label: 'Bez kategorie',
      color: '#94a3b8',
      group,
      amountsInHaler: amounts,
      totalInHaler: sum(amounts),
      children: [],
    }];
  };

  const allIncomeRows = [...incomeRows, ...uncategorizedRow('income')];
  const allExpenseRows = [...expenseRows, ...uncategorizedRow('expense')];

  const totalsOf = (rows: CategoryBreakdownRow[]) =>
    zeros().map((_, i) => sum(rows.map((r) => r.amountsInHaler[i])));
  const incomeTotalsInHaler = totalsOf(allIncomeRows);
  const expenseTotalsInHaler = totalsOf(allExpenseRows);

  const transferChildren: CategoryBreakdownSubRow[] = [...transferAmounts.entries()]
    .map(([accId, amounts]) => ({
      key: `${TRANSFERS_KEY}_${accId}`,
      label: accMap.get(accId)?.name ?? 'Neznámý účet',
      amountsInHaler: amounts,
      totalInHaler: sum(amounts),
    }))
    .filter((c) => c.amountsInHaler.some((v) => v !== 0))
    .sort((a, b) => czechStringCompare(a.label, b.label));

  const transferAmountsInHaler = zeros().map((_, i) => sum(transferChildren.map((c) => c.amountsInHaler[i])));
  const transferRow: CategoryBreakdownRow = {
    key: TRANSFERS_KEY,
    label: 'Spoření & Převody',
    color: '#0284c7',
    group: 'transfer',
    amountsInHaler: transferAmountsInHaler,
    totalInHaler: sum(transferAmountsInHaler),
    children: transferChildren,
  };

  return {
    rows: [...allIncomeRows, ...allExpenseRows, transferRow],
    incomeTotalsInHaler,
    incomeTotalInHaler: sum(incomeTotalsInHaler),
    expenseTotalsInHaler,
    expenseTotalInHaler: sum(expenseTotalsInHaler),
  };
}
