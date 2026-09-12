import { describe, it, expect } from 'vitest';
import { Transaction } from '../types/finance';
import {
  calculateIntraDayRunningBalances,
  getNextSequenceForDate,
  insertOrUpdateWithSequence,
  reorderDayTransactions,
  sortTransactionsByDateAndSequence,
  deleteTransactionAndReorder
} from '../services/sequenceService';

describe('CashPilot - Pořadí položek (1, 2, 3...) a řazení gridu', () => {
  const baseTx = (id: string, date: string, sequence: number, type: 'income' | 'expense' | 'transfer' = 'expense', amount: number = 100000): Transaction => ({
    id,
    title: `Položka ${id}`,
    date,
    sequence,
    type,
    amountInHaler: amount,
    sourceAccountId: 'acc_main',
    status: 'planned',
    createdAt: `2026-09-01T10:00:0${id}Z`,
    updatedAt: `2026-09-01T10:00:0${id}Z`,
  });

  // 1. Nová položka dostane pořadí 1 v prázdném dni a následující volné pořadí (1, 2, 3...)
  it('Nová položka dostane pořadí 1 v prázdném dni a následující volné pořadí (1, 2, 3...)', () => {
    // V prázdném dni dostane 1
    const emptyDaySeq = getNextSequenceForDate('2026-09-20', []);
    expect(emptyDaySeq).toBe(1);

    // Pokud existují položky s pořadím 1, 2, předvyplní se 3
    const existing: Transaction[] = [
      baseTx('1', '2026-09-20', 1),
      baseTx('2', '2026-09-20', 2),
    ];
    const nextSeq = getNextSequenceForDate('2026-09-20', existing);
    expect(nextSeq).toBe(3);
  });

  // 2. Každý nový kalendářní den začíná samostatnou řadou od 1
  it('Každý nový kalendářní den začíná samostatnou řadou od 1', () => {
    const existing: Transaction[] = [
      baseTx('1', '2026-09-20', 1),
      baseTx('2', '2026-09-20', 2),
      baseTx('3', '2026-09-20', 3),
    ];

    // Nový den 2026-09-21 zatím nemá žádné položky -> začíná od 1
    const nextSeqForNewDay = getNextSequenceForDate('2026-09-21', existing);
    expect(nextSeqForNewDay).toBe(1);
  });

  // 3. Při změně data položky dostane poslední pořadí v novém dni a původní den se přečísluje bez mezer
  it('Při změně data položky dostane poslední volné pořadí v novém dni a původní den se přečísluje bez mezer', () => {
    const day1Txs: Transaction[] = [
      baseTx('1', '2026-09-20', 1),
      baseTx('2', '2026-09-20', 2),
      baseTx('3', '2026-09-20', 3),
    ];
    const day2Txs: Transaction[] = [
      baseTx('4', '2026-09-25', 1),
      baseTx('5', '2026-09-25', 2),
    ];
    const all = [...day1Txs, ...day2Txs];

    // Přesouváme položku '2' z 20. 9. na 25. 9.
    const itemToMove = { ...day1Txs[1], date: '2026-09-25' };
    const nextSeq = getNextSequenceForDate('2026-09-25', all.filter(t => t.id !== '2'));
    expect(nextSeq).toBe(3);

    const result = insertOrUpdateWithSequence(itemToMove, nextSeq, all, '2026-09-20');

    // V původním dni (20. 9.) zůstaly položky 1 a 3 přečíslované na 1 a 2 (žádná mezera!)
    const remainingDay1 = result.filter(t => t.date === '2026-09-20').sort((a, b) => a.sequence - b.sequence);
    expect(remainingDay1).toHaveLength(2);
    expect(remainingDay1[0].id).toBe('1');
    expect(remainingDay1[0].sequence).toBe(1);
    expect(remainingDay1[1].id).toBe('3');
    expect(remainingDay1[1].sequence).toBe(2);

    // V novém dni (25. 9.) jsou položky 4, 5 a přesunutá 2 s pořadími 1, 2, 3
    const updatedDay2 = result.filter(t => t.date === '2026-09-25').sort((a, b) => a.sequence - b.sequence);
    expect(updatedDay2).toHaveLength(3);
    expect(updatedDay2[0].id).toBe('4');
    expect(updatedDay2[0].sequence).toBe(1);
    expect(updatedDay2[1].id).toBe('5');
    expect(updatedDay2[1].sequence).toBe(2);
    expect(updatedDay2[2].id).toBe('2');
    expect(updatedDay2[2].sequence).toBe(3);
  });

  // 4. Ruční změna pořadí: přesun položky ze 4 na 2 posune 2 a 3 na 3 a 4 a přečísluje celý den (1, 2, 3, 4)
  it('Ruční změna pořadí: přesun ze 4 na 2 posune ostatní a přečísluje na 1, 2, 3, 4', () => {
    const dayTxs: Transaction[] = [
      baseTx('1', '2026-09-20', 1),
      baseTx('2', '2026-09-20', 2),
      baseTx('3', '2026-09-20', 3),
      baseTx('4', '2026-09-20', 4),
    ];

    // Uživatel změní položce '4' pořadí na 2
    const tx4 = { ...dayTxs[3] };
    const result = insertOrUpdateWithSequence(tx4, 2, dayTxs);

    expect(result).toHaveLength(4);
    // Výsledné pořadí: '1' -> 1, '4' -> 2, '2' -> 3, '3' -> 4
    expect(result[0].id).toBe('1');
    expect(result[0].sequence).toBe(1);

    expect(result[1].id).toBe('4');
    expect(result[1].sequence).toBe(2);

    expect(result[2].id).toBe('2');
    expect(result[2].sequence).toBe(3);

    expect(result[3].id).toBe('3');
    expect(result[3].sequence).toBe(4);
  });

  // 5. Drag-and-drop přečísluje položky na souvislou řadu 1, 2, 3…
  it('Drag-and-drop přečísluje položky na souvislou řadu 1, 2, 3…', () => {
    const dayTxs: Transaction[] = [
      baseTx('A', '2026-09-20', 1),
      baseTx('B', '2026-09-20', 2),
      baseTx('C', '2026-09-20', 3),
    ];

    // Přetažení 'C' na první místo: nové pořadí ['C', 'A', 'B']
    const reordered = reorderDayTransactions('2026-09-20', ['C', 'A', 'B'], dayTxs);

    expect(reordered[0].id).toBe('C');
    expect(reordered[0].sequence).toBe(1);

    expect(reordered[1].id).toBe('A');
    expect(reordered[1].sequence).toBe(2);

    expect(reordered[2].id).toBe('B');
    expect(reordered[2].sequence).toBe(3);
  });

  // 6. Odstranění položky automaticky přečísluje zbývající položky daného dne bez mezer
  it('Odstranění položky automaticky přečísluje zbývající položky daného dne bez mezer', () => {
    const dayTxs: Transaction[] = [
      baseTx('1', '2026-09-20', 1),
      baseTx('2', '2026-09-20', 2),
      baseTx('3', '2026-09-20', 3),
      baseTx('4', '2026-09-20', 4),
    ];

    // Smažeme položku 2
    const afterDelete = deleteTransactionAndReorder('2', dayTxs);

    expect(afterDelete).toHaveLength(3);
    expect(afterDelete[0].id).toBe('1');
    expect(afterDelete[0].sequence).toBe(1);
    expect(afterDelete[1].id).toBe('3');
    expect(afterDelete[1].sequence).toBe(2);
    expect(afterDelete[2].id).toBe('4');
    expect(afterDelete[2].sequence).toBe(3);
  });

  // 7. Řazení gridu: Vzestupně (datum asc, sequence asc 1, 2, 3...) a Sestupně (datum desc, sequence desc ...3, 2, 1)
  it('Řazení gridu: Datum asc řadí sekvenci vzestupně (1, 2, 3...), Datum desc řadí sekvenci sestupně (...3, 2, 1)', () => {
    const txs: Transaction[] = [
      baseTx('1', '2026-09-15', 2),
      baseTx('2', '2026-09-15', 1),
      baseTx('3', '2026-09-16', 2),
      baseTx('4', '2026-09-16', 1),
    ];

    // Výchozí řazení: vzestupně
    const ascSorted = sortTransactionsByDateAndSequence(txs, 'asc');
    expect(ascSorted.map(t => `${t.date}#${t.sequence}`)).toEqual([
      '2026-09-15#1',
      '2026-09-15#2',
      '2026-09-16#1',
      '2026-09-16#2',
    ]);

    // Přepnutí na sestupně: datum od nejnovějšího po nejstarší, v rámci dne pořadí od nejvyššího po nejnižší
    const descSorted = sortTransactionsByDateAndSequence(txs, 'desc');
    expect(descSorted.map(t => `${t.date}#${t.sequence}`)).toEqual([
      '2026-09-16#2',
      '2026-09-16#1',
      '2026-09-15#2',
      '2026-09-15#1',
    ]);
  });

  // 8. Průběžný zůstatek respektuje pořadí položek (1, 2, 3...)
  it('Průběžný zůstatek respektuje pořadí položek a předchází falešnému dočasnému přečerpání', () => {
    const startBalance = 200000; // 2 000 Kč

    const expenseTx = baseTx('exp', '2026-09-20', 1, 'expense', 500000); // 5 000 Kč
    const incomeTx = baseTx('inc', '2026-09-20', 2, 'income', 1000000);  // 10 000 Kč

    // Výdaj před příjmem (1, 2): 2000 - 5000 = -3000 (dočasně záporný!)
    const badIntraDay = calculateIntraDayRunningBalances(startBalance, [expenseTx, incomeTx]);
    expect(badIntraDay.hasTemporaryNegative).toBe(true);
    expect(badIntraDay.steps[0].isTemporaryNegative).toBe(true);

    // Příjem před výdajem (1, 2): 2000 + 10000 = 12000, 12000 - 5000 = 7000 (žádný záporný stav)
    const goodIntraDay = calculateIntraDayRunningBalances(startBalance, [
      { ...incomeTx, sequence: 1 },
      { ...expenseTx, sequence: 2 },
    ]);
    expect(goodIntraDay.hasTemporaryNegative).toBe(false);
    expect(goodIntraDay.steps[0].isTemporaryNegative).toBe(false);
    expect(goodIntraDay.steps[1].isTemporaryNegative).toBe(false);
    expect(goodIntraDay.endOfDayBalanceInHaler).toBe(700000);
  });
});
