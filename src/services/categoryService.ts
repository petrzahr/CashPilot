import { Category } from '../types/finance';

/**
 * Porovná dva textové řetězce podle českých abecedních pravidel:
 * - Respektuje českou abecedu a diakritiku (např. C < Č, H < Ch, R < Ř, S < Š, Z < Ž).
 * - Ořezává úvodní a koncové mezery (trim).
 * - Ignoruje rozdíly mezi velkými a malými písmeny (case-insensitive).
 * - Pokud se řetězce shodují na základní úrovni, provede deterministické dořazení.
 */
export function czechStringCompare(a: string, b: string): number {
  const normA = (a || '').trim();
  const normB = (b || '').trim();
  const baseResult = normA.localeCompare(normB, 'cs', { sensitivity: 'base' });
  if (baseResult !== 0) {
    return baseResult;
  }
  return normA.localeCompare(normB, 'cs');
}

/**
 * Seřadí seznam kategorií abecedně vzestupně (A–Z) podle českých pravidel.
 * Původní pole nemutuje.
 */
export function sortCategoriesAlphabetically(categories: Category[]): Category[] {
  return [...categories].sort((a, b) => czechStringCompare(a.name, b.name));
}
