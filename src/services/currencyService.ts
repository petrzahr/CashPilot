/**
 * Finanční pomocné funkce pro bezpečnou práci s celými haléři (integer math).
 * 1 Kč = 100 haléřů.
 */

export function halerToCzk(haler: number): number {
  return haler / 100;
}

export function czkToHaler(czk: number): number {
  return Math.round(czk * 100);
}

/**
 * Formátuje haléře do české měny, např. "125 400 Kč"
 */
export function formatCurrency(
  haler: number, 
  options: { showHaler?: boolean; showPlus?: boolean; currency?: string } = {}
): string {
  const { showHaler = false, showPlus = false, currency = 'Kč' } = options;
  const isNegative = haler < 0;
  const absHaler = Math.abs(haler);
  const czk = absHaler / 100;

  const formattedNumber = new Intl.NumberFormat('cs-CZ', {
    minimumFractionDigits: showHaler ? 2 : 0,
    maximumFractionDigits: showHaler ? 2 : 0,
  }).format(czk);

  let prefix = '';
  if (isNegative) {
    prefix = '− '; // Čistá typografická pomlčka
  } else if (showPlus && haler > 0) {
    prefix = '+ ';
  }

  return `${prefix}${formattedNumber} ${currency}`;
}

/**
 * Převede uživatelský textový vstup (např. "125 400,50", "125400", "50.2") na celé haléře.
 */
export function parseInputToHaler(input: string): number {
  if (!input) return 0;
  // Nahradit čárku tečkou, odstranit mezery a jiné znaky kromě číslic, tečky a mínusu
  const cleaned = input
    .replace(/\s+/g, '')
    .replace(',', '.')
    .replace(/[^0-9.-]/g, '');

  const num = parseFloat(cleaned);
  if (isNaN(num)) return 0;
  return Math.round(num * 100);
}

/**
 * Převede haléře na string vhodný do <input type="number" step="0.01">
 */
export function halerToInputValue(haler: number): string {
  if (haler === 0) return '';
  return (haler / 100).toString();
}

/**
 * Bezpečné sčítání a odčítání haléřů
 */
export function addHaler(...amounts: number[]): number {
  return amounts.reduce((acc, val) => Math.round(acc + val), 0);
}

export function subHaler(a: number, b: number): number {
  return Math.round(a - b);
}
