import { describe, expect, it } from 'vitest';
import { groupTransactionsByPeriod } from '../services/financialEngine';
import { generatePeriodsSequence, isDateInPeriod } from '../services/periodService';
import { Transaction } from '../types/finance';

const tx = (id: string, date: string): Transaction => ({
  id, title: id, amountInHaler: 100, date, sequence: 1, type: 'expense',
  sourceAccountId: 'a', status: 'planned', createdAt: '', updatedAt: '',
} as Transaction);

describe('groupTransactionsByPeriod', () => {
  const periods = generatePeriodsSequence(2026, 1, 6, 15);
  const transactions = [
    tx('before', '2025-12-01'),
    tx('start', periods[0].startDate),
    tx('end', periods[0].endDate),
    tx('mid', '2026-03-20'),
    tx('mid2', '2026-03-16'),
    tx('last', periods[5].endDate),
    tx('after', '2027-01-01'),
    tx('nodate', ''),
  ];

  it('matches filtering every period by date, keeping input order', () => {
    const groups = groupTransactionsByPeriod(periods, transactions)!;
    for (const period of periods) {
      expect(groups.get(period)).toEqual(transactions.filter(t => isDateInPeriod(t.date, period)));
    }
  });

  it('works with periods passed in any order', () => {
    const shuffled = [periods[3], periods[0], periods[5], periods[1], periods[4], periods[2]];
    const groups = groupTransactionsByPeriod(shuffled, transactions)!;
    for (const period of shuffled) {
      expect(groups.get(period)).toEqual(transactions.filter(t => isDateInPeriod(t.date, period)));
    }
  });

  it('returns null for overlapping periods so the caller falls back to filtering', () => {
    const overlapping = [periods[0], { ...periods[0], key: 'dup' }];
    expect(groupTransactionsByPeriod(overlapping, transactions)).toBeNull();
  });
});
