import { describe, it, expect } from 'vitest';
import { getEarliestActivityDate, resolvePeriodRange } from '../services/periodRange';
import { getPeriodForDate, normalizeStartDay } from '../services/periodService';
import { Account, Transaction } from '../types/finance';

const today = '2026-09-13'; // při startovním dni 15 běží období Srpen 2026 (15. 8. – 14. 9.)
const keys = (periods: { key: string }[]) => periods.map(p => p.key);

describe('resolvePeriodRange', () => {
  it('měsíce dozadu i dopředu vždy včetně aktuálního období, i přes konec roku', () => {
    expect(keys(resolvePeriodRange({ direction: 'past', months: 3 }, { current: getPeriodForDate(today, 15), startDay: 15 })))
      .toEqual(['2026-06', '2026-07', '2026-08']);
    expect(keys(resolvePeriodRange({ direction: 'future', months: 6 }, { current: getPeriodForDate(today, 15), startDay: 15 })))
      .toEqual(['2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01']);
    expect(resolvePeriodRange({ direction: 'past' }, { current: getPeriodForDate(today, 15), startDay: 15 })).toHaveLength(12);
  });

  it('aktuální období určuje startovní den', () => {
    expect(keys(resolvePeriodRange({ direction: 'past', months: 3 }, { current: getPeriodForDate(today, 1), startDay: 1 })))
      .toEqual(['2026-07', '2026-08', '2026-09']);
    const feb = resolvePeriodRange({ direction: 'future', months: 3 }, { current: getPeriodForDate('2026-02-28', 31), startDay: 31 });
    expect(feb.map(p => [p.key, p.startDate])).toEqual([
      ['2026-02', '2026-02-28'], ['2026-03', '2026-03-31'], ['2026-04', '2026-04-30'],
    ]);
  });

  it('Tento rok začíná lednovým obdobím aktuálního roku', () => {
    const ytd = resolvePeriodRange({ direction: 'past', preset: 'ytd' }, { current: getPeriodForDate(today, 15), startDay: 15 });
    expect(ytd[0].key).toBe('2026-01');
    expect(ytd[ytd.length - 1].key).toBe('2026-08');
    expect(ytd).toHaveLength(8);
  });

  it('Celá historie začíná obdobím nejstaršího záznamu, bez záznamů jen aktuálním obdobím', () => {
    const account = { initialBalanceDate: '2025-01-01' } as Account;
    const all = resolvePeriodRange({ direction: 'past', preset: 'all' }, { current: getPeriodForDate(today, 15), startDay: 15, data: { accounts: [account] } });
    expect(all[0].key).toBe('2024-12');
    expect(all[all.length - 1].key).toBe('2026-08');
    expect(keys(resolvePeriodRange({ direction: 'past', preset: 'all' }, { current: getPeriodForDate(today, 15), startDay: 15 }))).toEqual(['2026-08']);
  });

  it('vlastní rozsah od–do včetně; obrácené pořadí se prohodí, bez hranic jako 12 měsíců zpět', () => {
    const custom = resolvePeriodRange({ direction: 'past', preset: 'custom', from: '2026-05', to: '2026-08' }, { current: getPeriodForDate(today, 15), startDay: 15 });
    expect(keys(custom)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08']);
    expect(custom[0].startDate).toBe('2026-05-15');
    const reversed = resolvePeriodRange({ direction: 'past', preset: 'custom', from: '2026-08', to: '2026-05' }, { current: getPeriodForDate(today, 15), startDay: 15 });
    expect(keys(reversed)).toEqual(keys(custom));
    expect(resolvePeriodRange({ direction: 'past', preset: 'custom' }, { current: getPeriodForDate(today, 15), startDay: 15 })).toHaveLength(12);
  });
});

describe('getEarliestActivityDate', () => {
  it('bere počáteční zůstatky, provedené položky, korekce i ocenění; plánované ne', () => {
    const tx = (date: string, status: Transaction['status']) => ({ date, status } as Transaction);
    expect(getEarliestActivityDate({
      accounts: [{ initialBalanceDate: '2026-03-01' } as Account],
      transactions: [tx('2026-02-01', 'planned'), tx('2026-02-10', 'executed')],
      corrections: [],
      snapshots: [],
    }, today)).toBe('2026-02-10');
    expect(getEarliestActivityDate({}, today)).toBe(today);
  });
});

describe('normalizeStartDay', () => {
  it('ořeže na 1–31 a chybějící hodnota dává 15', () => {
    expect(normalizeStartDay(undefined)).toBe(15);
    expect(normalizeStartDay(0)).toBe(15);
    expect(normalizeStartDay(40)).toBe(31);
    expect(normalizeStartDay(-3)).toBe(1);
    expect(normalizeStartDay(10.6)).toBe(11);
  });
});
