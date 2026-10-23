import { describe, it, expect } from 'vitest';
import { createEmptyAppData } from '../constants/defaultData';
import { importBackup } from '../services/dataCommands';
import { AppData } from '../services/storageService';
import { Transaction } from '../types/finance';

const tx = (id: string, date: string, sequence: number, partial: Partial<Transaction> = {}): Transaction => ({
  id, title: id, type: 'expense', status: 'executed', date, sequence, amountInHaler: 1000,
  sourceAccountId: 'chk', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z', ...partial,
});

const dataWith = (transactions: Transaction[]): AppData => ({ ...createEmptyAppData(), transactions });

const order = (data: AppData, date: string) =>
  data.transactions.filter(t => t.date === date).map(t => [t.id, t.sequence]);

describe('importBackup', () => {
  it('existující položky dne zůstanou na místě, nové se připojí za ně v pořadí ze souboru', () => {
    const current = dataWith([tx('mine_1', '2026-09-15', 1), tx('mine_2', '2026-09-15', 2)]);
    const backup = dataWith([tx('new_b', '2026-09-15', 2), tx('new_a', '2026-09-15', 1)]);

    const { data } = importBackup(current, backup);
    expect(order(data, '2026-09-15')).toEqual([['mine_1', 1], ['mine_2', 2], ['new_a', 3], ['new_b', 4]]);
  });

  it('položka se stejným ID se nezdvojí ani nepřečísluje', () => {
    const current = dataWith([tx('same', '2026-09-15', 1)]);
    const { data } = importBackup(current, dataWith([tx('same', '2026-09-15', 5)]));
    expect(order(data, '2026-09-15')).toEqual([['same', 1]]);
  });

  it('nový den se seřadí podle pořadí v souboru, při shodě podle data vytvoření', () => {
    const backup = dataWith([
      tx('late', '2026-09-20', 1, { createdAt: '2026-09-20T12:00:00Z' }),
      tx('early', '2026-09-20', 1, { createdAt: '2026-09-20T08:00:00Z' }),
      tx('second', '2026-09-20', 2),
    ]);
    const { data } = importBackup(dataWith([]), backup);
    expect(order(data, '2026-09-20')).toEqual([['early', 1], ['late', 2], ['second', 3]]);
  });
});
