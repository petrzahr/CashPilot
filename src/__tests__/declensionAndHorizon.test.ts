import { describe, it, expect } from 'vitest';
import { getCzechMonthWord, formatMonthsCount, generatePeriodsSequence } from '../services/periodService';

describe('České skloňování slova měsíc a dynamický horizont výhledu', () => {
  it('správně skloňuje slovo měsíc pro všechny požadované horizonty', () => {
    // 1 měsíc
    expect(getCzechMonthWord(1)).toBe('měsíc');
    expect(formatMonthsCount(1)).toBe('1 měsíc');

    // 2 až 4 měsíce
    expect(getCzechMonthWord(2)).toBe('měsíce');
    expect(formatMonthsCount(2)).toBe('2 měsíce');

    expect(getCzechMonthWord(3)).toBe('měsíce');
    expect(formatMonthsCount(3)).toBe('3 měsíce');

    expect(getCzechMonthWord(4)).toBe('měsíce');
    expect(formatMonthsCount(4)).toBe('4 měsíce');

    // 5 a více měsíců (včetně 11, 12, 14, 21, 22, 24, 25)
    expect(getCzechMonthWord(5)).toBe('měsíců');
    expect(formatMonthsCount(5)).toBe('5 měsíců');

    expect(getCzechMonthWord(6)).toBe('měsíců');
    expect(formatMonthsCount(6)).toBe('6 měsíců');

    expect(getCzechMonthWord(11)).toBe('měsíců');
    expect(formatMonthsCount(11)).toBe('11 měsíců');

    expect(getCzechMonthWord(12)).toBe('měsíců');
    expect(formatMonthsCount(12)).toBe('12 měsíců');

    expect(getCzechMonthWord(14)).toBe('měsíců');
    expect(formatMonthsCount(14)).toBe('14 měsíců');

    expect(getCzechMonthWord(18)).toBe('měsíců');
    expect(formatMonthsCount(18)).toBe('18 měsíců');

    expect(getCzechMonthWord(21)).toBe('měsíců');
    expect(formatMonthsCount(21)).toBe('21 měsíců');

    expect(getCzechMonthWord(22)).toBe('měsíců');
    expect(formatMonthsCount(22)).toBe('22 měsíců');

    expect(getCzechMonthWord(24)).toBe('měsíců');
    expect(formatMonthsCount(24)).toBe('24 měsíců');

    expect(getCzechMonthWord(25)).toBe('měsíců');
    expect(formatMonthsCount(25)).toBe('25 měsíců');
  });

  it('správně sestavuje požadované texty v sekci Přehled', () => {
    const horizons = [1, 3, 6, 12, 18, 24];

    const chartTitles = horizons.map(h => `Výhled vývoje financí na ${formatMonthsCount(h)}`);
    expect(chartTitles).toEqual([
      'Výhled vývoje financí na 1 měsíc',
      'Výhled vývoje financí na 3 měsíce',
      'Výhled vývoje financí na 6 měsíců',
      'Výhled vývoje financí na 12 měsíců',
      'Výhled vývoje financí na 18 měsíců',
      'Výhled vývoje financí na 24 měsíců'
    ]);

    const accountsTitles = horizons.map(h => `Přehled všech účtů na ${formatMonthsCount(h)}`);
    expect(accountsTitles).toEqual([
      'Přehled všech účtů na 1 měsíc',
      'Přehled všech účtů na 3 měsíce',
      'Přehled všech účtů na 6 měsíců',
      'Přehled všech účtů na 12 měsíců',
      'Přehled všech účtů na 18 měsíců',
      'Přehled všech účtů na 24 měsíců'
    ]);

    expect(`Nejnižší očekávaný zůstatek během ${formatMonthsCount(9)}`).toBe('Nejnižší očekávaný zůstatek během 9 měsíců');
  });

  it('generuje přesný počet období podle nastaveného horizontu', () => {
    const seq6 = generatePeriodsSequence(2026, 9, 6, 15);
    expect(seq6).toHaveLength(6);

    const seq12 = generatePeriodsSequence(2026, 9, 12, 15);
    expect(seq12).toHaveLength(12);

    const seq18 = generatePeriodsSequence(2026, 9, 18, 15);
    expect(seq18).toHaveLength(18);

    const seq24 = generatePeriodsSequence(2026, 9, 24, 15);
    expect(seq24).toHaveLength(24);
  });
});
