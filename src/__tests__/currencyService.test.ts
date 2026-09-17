import { describe, it, expect } from 'vitest';
import { formatCurrency } from '../services/currencyService';

describe('formatCurrency', () => {
  it('nezobrazuje záporné znaménko, pokud se částka zaokrouhlí na 0 Kč', () => {
    expect(formatCurrency(-1)).toBe('0 Kč'); // -0,01 Kč
    expect(formatCurrency(-49)).toBe('0 Kč'); // -0,49 Kč
  });

  it('zobrazuje záporné znaménko, pokud se částka zaokrouhlí na nenulovou hodnotu', () => {
    expect(formatCurrency(-50)).toBe('− 1 Kč'); // -0,50 Kč zaokrouhleno na -1
    expect(formatCurrency(-150000)).toBe(`− 1 500 Kč`);
  });

  it('s showHaler nezobrazuje záporné znaménko u přesně nulové částky', () => {
    expect(formatCurrency(0, { showHaler: true })).toBe('0,00 Kč');
  });

  it('kladné částky zůstávají beze změny', () => {
    expect(formatCurrency(150000)).toBe(`1 500 Kč`);
    expect(formatCurrency(0)).toBe('0 Kč');
  });
});
