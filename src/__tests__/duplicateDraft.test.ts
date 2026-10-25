import { describe, expect, it } from 'vitest';
import { getDuplicateDraft } from '../services/transactionForm';
import { Account, Category, Transaction } from '../types/finance';

const account = (id: string, status: Account['status'] = 'active'): Account => ({
  id, name: id, type: 'checking', currency: 'CZK', initialBalanceInHaler: 0, initialBalanceDate: '2026-01-01',
  isUsableCash: true, isNetWorth: true, isDefault: false, color: '', sortOrder: 1, status,
  createdAt: '', updatedAt: '',
});

const category = (id: string, parentId: string | null = null, status: Category['status'] = 'active'): Category => ({
  id, name: id, type: 'expense', parentId, status, sortOrder: 1, createdAt: '', updatedAt: '',
} as Category);

const source: Transaction = {
  id: 'tx1', title: 'Nákup', amountInHaler: 10000, actualAmountInHaler: 12345, date: '2026-09-20', sequence: 3,
  type: 'expense', sourceAccountId: 'acc', categoryId: 'food', subcategoryId: 'groceries', note: 'Lidl',
  status: 'executed', createdAt: '', updatedAt: '',
};

describe('getDuplicateDraft', () => {
  it('copies item details without "(kopie)" and uses the effective amount', () => {
    const draft = getDuplicateDraft(source, [account('acc')], [category('food'), category('groceries', 'food')]);
    expect(draft).toEqual({
      title: 'Nákup', amountStr: '123.45', type: 'expense', sourceAccountId: 'acc', targetAccountId: '',
      categoryId: 'food', subcategoryId: 'groceries', note: 'Lidl',
    });
  });

  it('uses the planned amount for a planned item', () => {
    const draft = getDuplicateDraft({ ...source, status: 'planned' }, [account('acc')], []);
    expect(draft.amountStr).toBe('100');
  });

  it('drops archived accounts and categories', () => {
    const draft = getDuplicateDraft(
      { ...source, type: 'transfer', targetAccountId: 'old' },
      [account('acc', 'archived'), account('old', 'archived')],
      [category('food', null, 'archived'), category('groceries', 'food')],
    );
    expect(draft.sourceAccountId).toBe('');
    expect(draft.targetAccountId).toBe('');
    expect(draft.categoryId).toBe('');
    expect(draft.subcategoryId).toBe('');
  });
});
