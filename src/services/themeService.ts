/**
 * Volba vzhledu (světlý / tmavý / podle systému). Jde o nastavení zařízení, ne dat,
 * proto se ukládá do localStorage a nesynchronizuje se přes Google Disk.
 * Stejnou logiku před prvním vykreslením opakuje krátký skript v index.html (bez probliknutí).
 */

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'cashpilot_theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';

export function getThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // localStorage může být nedostupné (soukromý režim) - použije se výchozí volba
  }
  return 'system';
}

export function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return preference;
}

export function applyTheme(preference: ThemePreference = getThemePreference()): ResolvedTheme {
  const resolved = resolveTheme(preference);
  if (typeof document === 'undefined') return resolved;
  document.documentElement.dataset.theme = resolved;
  return resolved;
}

export function setThemePreference(preference: ThemePreference): ResolvedTheme {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Volba platí aspoň pro tuto relaci
  }
  const resolved = applyTheme(preference);
  window.dispatchEvent(new CustomEvent<ThemePreference>('cashpilot-theme-change', { detail: preference }));
  return resolved;
}

/** Při volbě "podle systému" sleduje změnu vzhledu systému a hned ji promítne do aplikace. */
export function watchSystemTheme(): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const media = window.matchMedia(DARK_QUERY);
  const onChange = () => {
    if (getThemePreference() === 'system') applyTheme('system');
  };
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
