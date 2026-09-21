import { describe, it, expect } from 'vitest';
import {
  createBudgetPeriod,
  getPeriodForDate,
  getPreviousDayString,
  getDaysInMonth,
  formatPeriodRange,
  generatePeriodsSequence
} from '../services/periodService';
import { Transaction } from '../types/finance';

describe('PeriodService - Počáteční den rozpočtového měsíce (1–31) a kratší měsíce', () => {

  describe('Základní výpočet dnů v měsíci a posunu o den zpět', () => {
    it('Správně určí počet dnů v měsíci včetně přestupného roku', () => {
      expect(getDaysInMonth(2026, 1)).toBe(31);
      expect(getDaysInMonth(2026, 2)).toBe(28); // Běžný rok
      expect(getDaysInMonth(2028, 2)).toBe(29); // Přestupný rok
      expect(getDaysInMonth(2026, 4)).toBe(30);
      expect(getDaysInMonth(2026, 12)).toBe(31);
    });

    it('getPreviousDayString vrátí přesný předchozí den bez ohledu na DST', () => {
      expect(getPreviousDayString('2026-03-01')).toBe('2026-02-28');
      expect(getPreviousDayString('2028-03-01')).toBe('2028-02-29'); // Přestupný rok
      expect(getPreviousDayString('2026-01-01')).toBe('2025-12-31');
      expect(getPreviousDayString('2026-10-15')).toBe('2026-10-14');
    });
  });

  describe('Den 1: Standardní kalendářní měsíce', () => {
    it('Běžný rok 2026', () => {
      const jan = createBudgetPeriod(2026, 1, 1);
      expect(jan.startDate).toBe('2026-01-01');
      expect(jan.endDate).toBe('2026-01-31');

      const feb = createBudgetPeriod(2026, 2, 1);
      expect(feb.startDate).toBe('2026-02-01');
      expect(feb.endDate).toBe('2026-02-28');

      const dec = createBudgetPeriod(2026, 12, 1);
      expect(dec.startDate).toBe('2026-12-01');
      expect(dec.endDate).toBe('2026-12-31');
    });

    it('Přestupný rok 2028', () => {
      const feb = createBudgetPeriod(2028, 2, 1);
      expect(feb.startDate).toBe('2028-02-01');
      expect(feb.endDate).toBe('2028-02-29');
    });
  });

  describe('Den 15: Výchozí nastavení', () => {
    it('Běžný rok 2026', () => {
      const sep = createBudgetPeriod(2026, 9, 15);
      expect(sep.startDate).toBe('2026-09-15');
      expect(sep.endDate).toBe('2026-10-14');
      expect(formatPeriodRange(sep)).toBe('15. 9. 2026 – 14. 10. 2026');

      const jan = createBudgetPeriod(2026, 1, 15);
      expect(jan.startDate).toBe('2026-01-15');
      expect(jan.endDate).toBe('2026-02-14');

      const feb = createBudgetPeriod(2026, 2, 15);
      expect(feb.startDate).toBe('2026-02-15');
      expect(feb.endDate).toBe('2026-03-14');

      const dec = createBudgetPeriod(2026, 12, 15);
      expect(dec.startDate).toBe('2026-12-15');
      expect(dec.endDate).toBe('2027-01-14');
    });
  });

  describe('Den 28: Začátek 28. den', () => {
    it('Běžný rok 2026', () => {
      const jan = createBudgetPeriod(2026, 1, 28);
      expect(jan.startDate).toBe('2026-01-28');
      expect(jan.endDate).toBe('2026-02-27');

      const feb = createBudgetPeriod(2026, 2, 28);
      expect(feb.startDate).toBe('2026-02-28');
      expect(feb.endDate).toBe('2026-03-27');
    });

    it('Přestupný rok 2028', () => {
      const jan = createBudgetPeriod(2028, 1, 28);
      expect(jan.startDate).toBe('2028-01-28');
      expect(jan.endDate).toBe('2028-02-27');

      const feb = createBudgetPeriod(2028, 2, 28);
      expect(feb.startDate).toBe('2028-02-28');
      expect(feb.endDate).toBe('2028-03-27');
    });
  });

  describe('Den 29: Kratší únor v běžném roce vs přestupný rok', () => {
    it('Běžný rok 2026 (únor má 28 dní -> začne 28. února)', () => {
      const jan = createBudgetPeriod(2026, 1, 29);
      expect(jan.startDate).toBe('2026-01-29');
      // Únor začíná 2026-02-28, takže leden končí 2026-02-27
      expect(jan.endDate).toBe('2026-02-27');

      const feb = createBudgetPeriod(2026, 2, 29);
      expect(feb.startDate).toBe('2026-02-28');
      // Březen začíná 2026-03-29, takže únor končí 2026-03-28
      expect(feb.endDate).toBe('2026-03-28');
    });

    it('Přestupný rok 2028 (únor má 29 dní -> začne přesně 29. února)', () => {
      const jan = createBudgetPeriod(2028, 1, 29);
      expect(jan.startDate).toBe('2028-01-29');
      expect(jan.endDate).toBe('2028-02-28');

      const feb = createBudgetPeriod(2028, 2, 29);
      expect(feb.startDate).toBe('2028-02-29');
      expect(feb.endDate).toBe('2028-03-28');
    });
  });

  describe('Den 30: Začátek 30. den měsíce', () => {
    it('Běžný rok 2026', () => {
      const jan = createBudgetPeriod(2026, 1, 30);
      expect(jan.startDate).toBe('2026-01-30');
      expect(jan.endDate).toBe('2026-02-27'); // Únor začíná 28. 2.

      const feb = createBudgetPeriod(2026, 2, 30);
      expect(feb.startDate).toBe('2026-02-28');
      expect(feb.endDate).toBe('2026-03-29'); // Březen začíná 30. 3.
    });

    it('Přestupný rok 2028', () => {
      const jan = createBudgetPeriod(2028, 1, 30);
      expect(jan.startDate).toBe('2028-01-30');
      expect(jan.endDate).toBe('2028-02-28'); // Únor začíná 29. 2.

      const feb = createBudgetPeriod(2028, 2, 30);
      expect(feb.startDate).toBe('2028-02-29');
      expect(feb.endDate).toBe('2028-03-29'); // Březen začíná 30. 3.
    });
  });

  describe('Den 31: Extrémní případ (kratší měsíce 28, 29 a 30 dní)', () => {
    it('Běžný rok 2026', () => {
      // Leden má 31 dní: začátek 31. 1.
      const jan = createBudgetPeriod(2026, 1, 31);
      expect(jan.startDate).toBe('2026-01-31');
      // Únorové období začne 28. 2. (poslední den února), leden tedy končí 27. 2.
      expect(jan.endDate).toBe('2026-02-27');

      // Únorové období začíná 28. 2.
      const feb = createBudgetPeriod(2026, 2, 31);
      expect(feb.startDate).toBe('2026-02-28');
      // Březen začíná 31. 3., únor tedy končí 30. 3.
      expect(feb.endDate).toBe('2026-03-30');

      // Březen začíná 31. 3.
      const mar = createBudgetPeriod(2026, 3, 31);
      expect(mar.startDate).toBe('2026-03-31');
      // Duben má 30 dní -> duben začne 30. 4., březen tedy končí 29. 4.
      expect(mar.endDate).toBe('2026-04-29');

      // Duben začíná 30. 4.
      const apr = createBudgetPeriod(2026, 4, 31);
      expect(apr.startDate).toBe('2026-04-30');
      // Květen má 31 dní -> květen začne 31. 5., duben tedy končí 30. 5.
      expect(apr.endDate).toBe('2026-05-30');

      // Prosinec začíná 31. 12.
      const dec = createBudgetPeriod(2026, 12, 31);
      expect(dec.startDate).toBe('2026-12-31');
      // Leden 2027 začne 31. 1. 2027, prosinec tedy končí 30. 1. 2027
      expect(dec.endDate).toBe('2027-01-30');
    });

    it('Přestupný rok 2028', () => {
      const jan = createBudgetPeriod(2028, 1, 31);
      expect(jan.startDate).toBe('2028-01-31');
      // Únor 2028 začne 29. 2., leden končí 28. 2.
      expect(jan.endDate).toBe('2028-02-28');

      const feb = createBudgetPeriod(2028, 2, 31);
      expect(feb.startDate).toBe('2028-02-29');
      // Březen začne 31. 3., únor končí 30. 3.
      expect(feb.endDate).toBe('2028-03-30');

      // Ověření, že 29. únor spadá do Února 2028
      const pLeap = getPeriodForDate('2028-02-29', 31);
      expect(pLeap.key).toBe('2028-02');
      expect(pLeap.name).toBe('Únor 2028');
    });
  });

  describe('Souvislá časová osa bez mezer a překryvů (1, 15, 28, 29, 30, 31)', () => {
    const testDays = [1, 15, 28, 29, 30, 31];
    const testYears = [2026, 2028]; // Běžný a přestupný rok

    testDays.forEach(startDay => {
      testYears.forEach(year => {
        it(`Zaručuje souvislou osu bez mezer pro startDay=${startDay} v roce ${year}`, () => {
          const periods = generatePeriodsSequence(year, 1, 12, startDay);
          
          for (let i = 0; i < periods.length - 1; i++) {
            const current = periods[i];
            const next = periods[i + 1];

            // Konec aktuální periody musí být přesně den před začátkem následující
            expect(getPreviousDayString(next.startDate)).toBe(current.endDate);

            // Začátek musí být <= konec
            expect(current.startDate <= current.endDate).toBe(true);
          }

          // Otestovat každý den v roce, zda má přesně jednu jednoznačnou periodu
          const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
          const totalDays = isLeap ? 366 : 365;

          const startDateObj = new Date(Date.UTC(year, 0, 1));
          for (let d = 0; d < totalDays; d++) {
            const curDate = new Date(startDateObj.getTime() + d * 86400000);
            const dateStr = curDate.toISOString().slice(0, 10);
            const p = getPeriodForDate(dateStr, startDay);

            // Datum musí spadat přesně do intervalu [startDate, endDate]
            expect(dateStr >= p.startDate).toBe(true);
            expect(dateStr <= p.endDate).toBe(true);
          }
        });
      });
    });
  });

  describe('Dopad změny počátečního dne na přeřazení transakcí', () => {
    it('Přeřadí položky mezi periodami při změně startovního dne z 15 na 1', () => {
      // Položka 10. 9. 2026
      // Při startDay 15 patří do periody Srpen 2026 (15. 8. – 14. 9.)
      const pStart15 = getPeriodForDate('2026-09-10', 15);
      expect(pStart15.key).toBe('2026-08');
      expect(pStart15.name).toBe('Srpen 2026');

      // Při startDay 1 patří do periody Září 2026 (1. 9. – 30. 9.)
      const pStart1 = getPeriodForDate('2026-09-10', 1);
      expect(pStart1.key).toBe('2026-09');
      expect(pStart1.name).toBe('Září 2026');
    });

    it('Přeřadí položky při změně na startDay 31', () => {
      // 15. 2. 2026
      // Při startDay 31 patří do Leden 2026 (31. 1. – 27. 2.)
      const p1 = getPeriodForDate('2026-02-15', 31);
      expect(p1.key).toBe('2026-01');

      // 28. 2. 2026
      // Při startDay 31 patří do Únor 2026 (28. 2. – 30. 3.)
      const p2 = getPeriodForDate('2026-02-28', 31);
      expect(p2.key).toBe('2026-02');
    });
  });

  describe('Tlačítko a funkce Aktuální období', () => {
    it('Správně určí aktuální rozpočtové období před a po počátečním dni (příklad 12. 9. vs 15. 9.)', () => {
      // 12. 9. 2026 při startDay 15: vybere období 15. 8. 2026 – 14. 9. 2026
      const beforeStart = getPeriodForDate('2026-09-12', 15);
      expect(beforeStart.startDate).toBe('2026-08-15');
      expect(beforeStart.endDate).toBe('2026-09-14');
      expect(formatPeriodRange(beforeStart)).toBe('15. 8. 2026 – 14. 9. 2026');

      // 15. 9. 2026 při startDay 15: vybere období 15. 9. 2026 – 14. 10. 2026
      const afterStart = getPeriodForDate('2026-09-15', 15);
      expect(afterStart.startDate).toBe('2026-09-15');
      expect(afterStart.endDate).toBe('2026-10-14');
      expect(formatPeriodRange(afterStart)).toBe('15. 9. 2026 – 14. 10. 2026');
    });

    it('Správně určí aktuální období pro mezní dny 29, 30 a 31 v kratších měsících a na přelomu roku', () => {
      // Start day 31: 15. 2. 2026 spadá do Leden 2026 (31. 1. – 27. 2.)
      const febMid = getPeriodForDate('2026-02-15', 31);
      expect(febMid.startDate).toBe('2026-01-31');
      expect(febMid.endDate).toBe('2026-02-27');

      // Start day 31: 28. 2. 2026 spadá do Únor 2026 (28. 2. – 30. 3.)
      const febEnd = getPeriodForDate('2026-02-28', 31);
      expect(febEnd.startDate).toBe('2026-02-28');
      expect(febEnd.endDate).toBe('2026-03-30');

      // Přelom roku: 31. 12. 2026 při startDay 15 spadá do Prosinec 2026 (15. 12. 2026 – 14. 1. 2027)
      const yearEnd = getPeriodForDate('2026-12-31', 15);
      expect(yearEnd.startDate).toBe('2026-12-15');
      expect(yearEnd.endDate).toBe('2027-01-14');

      // 10. 1. 2027 při startDay 15 stále spadá do Prosinec 2026 (15. 12. 2026 – 14. 1. 2027)
      const janStart = getPeriodForDate('2027-01-10', 15);
      expect(janStart.startDate).toBe('2026-12-15');
      expect(janStart.endDate).toBe('2027-01-14');
    });

    it('Správně vyhodnotí stav vybrané periody (isCurrentPeriodSelected) z minulosti i budoucnosti', () => {
      const todayDate = '2026-09-12';
      const current = getPeriodForDate(todayDate, 15); // 2026-08-15 – 2026-09-14

      // Minulá perioda (např. Červen 2026)
      const pastPeriod = createBudgetPeriod(2026, 6, 15);
      const isPastCurrent = pastPeriod.startDate === current.startDate && pastPeriod.endDate === current.endDate;
      expect(isPastCurrent).toBe(false);

      // Budoucí perioda (např. Prosinec 2026)
      const futurePeriod = createBudgetPeriod(2026, 12, 15);
      const isFutureCurrent = futurePeriod.startDate === current.startDate && futurePeriod.endDate === current.endDate;
      expect(isFutureCurrent).toBe(false);

      // Aktuální perioda
      const currentSelected = createBudgetPeriod(current.year, current.month, 15);
      const isCurrentSelected = currentSelected.startDate === current.startDate && currentSelected.endDate === current.endDate;
      expect(isCurrentSelected).toBe(true);
    });

    it('Filtrování transakcí po přechodu na aktuální období zachová filtr Všechny položky i specifické filtry', () => {
      const current = getPeriodForDate('2026-09-12', 15); // 2026-08-15 – 2026-09-14
      const txs: Transaction[] = [
        { id: '1', title: 'Minulá položka', amountInHaler: 10000, date: '2026-07-01', sequence: 1, type: 'expense', sourceAccountId: 'acc1', categoryId: 'food', status: 'executed', createdAt: '', updatedAt: '' },
        { id: '2', title: 'Aktuální jídlo', amountInHaler: 20000, date: '2026-08-25', sequence: 1, type: 'expense', sourceAccountId: 'acc1', categoryId: 'food', status: 'executed', createdAt: '', updatedAt: '' },
        { id: '3', title: 'Aktuální nájem', amountInHaler: 50000, date: '2026-09-05', sequence: 1, type: 'expense', sourceAccountId: 'acc1', categoryId: 'rent', status: 'planned', createdAt: '', updatedAt: '' },
        { id: '4', title: 'Budoucí položka', amountInHaler: 30000, date: '2026-11-10', sequence: 1, type: 'expense', sourceAccountId: 'acc1', categoryId: 'food', status: 'planned', createdAt: '', updatedAt: '' },
      ];

      // Režim 1: Filtr 'current' (Aktuální období) zobrazí pouze položky 2 a 3
      const filteredCurrent = txs.filter(t => t.date >= current.startDate && t.date <= current.endDate);
      expect(filteredCurrent.map(t => t.id)).toEqual(['2', '3']);

      // Režim 1 + zachování filtru kategorie 'food'
      const filteredCurrentFood = filteredCurrent.filter(t => t.categoryId === 'food');
      expect(filteredCurrentFood.map(t => t.id)).toEqual(['2']);

      // Režim 2: Filtr 'all' (Všechny položky) ponechá všechny položky i po návratu k aktuálnímu období
      const filteredAll = txs;
      expect(filteredAll).toHaveLength(4);

      // Režim 2 + filtr kategorie 'food'
      const filteredAllFood = filteredAll.filter(t => t.categoryId === 'food');
      expect(filteredAllFood.map(t => t.id)).toEqual(['1', '2', '4']);
    });
  });
});
