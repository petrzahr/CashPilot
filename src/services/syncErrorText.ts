/**
 * Převede technickou chybu synchronizace (často anglickou hlášku prohlížeče nebo Google API)
 * na českou větu, která říká, co se stalo a co s tím udělat. Česká hláška aplikace projde beze změny.
 */
export function describeSyncError(message: string | null | undefined): string {
  const fallback = 'Změny se nepodařilo uložit na Google Disk. Zůstávají v tomto zařízení a uloží se při další synchronizaci.';
  if (!message) return fallback;
  const http = describeHttpError(message);
  if (http) return http;
  const lower = message.toLowerCase();
  if (lower.includes('failed to fetch') || lower.includes('network') || lower.includes('load failed') || lower.includes('timeout')) {
    return 'Nepodařilo se spojit s Google Diskem. Zkontrolujte připojení k internetu, změny zůstávají v tomto zařízení.';
  }
  if (lower.includes('401') || lower.includes('403') || lower.includes('unauthorized') || lower.includes('token')) {
    return 'Přihlášení ke Google Disku vypršelo. Přihlaste se znovu, změny zůstávají v tomto zařízení.';
  }
  if (lower.includes('quota') || lower.includes('429') || lower.includes('rate')) {
    return 'Google Disk teď dočasně odmítá požadavky. Zkuste to za chvíli znovu.';
  }
  // Hláška bez české diakritiky je nejspíš technická; ukážeme srozumitelný popis
  return /[áčďéěíňóřšťúůýž]/i.test(message) ? message : fallback;
}

/**
 * Hlášky služby Google Disku mají tvar „Česká věta (HTTP 503): {surová odpověď serveru}“.
 * Uživatel uvidí jen českou větu a další krok podle kódu; surový text zůstává v technických podrobnostech.
 */
function describeHttpError(message: string): string | null {
  const match = message.match(/^([\s\S]*?)\s*\(HTTP (\d{3})\)/);
  if (!match) return null;
  const status = Number(match[2]);
  if (status === 401 || status === 403) {
    return 'Přihlášení ke Google Disku vypršelo. Přihlaste se znovu, změny zůstávají v tomto zařízení.';
  }
  if (status === 429) {
    return 'Google Disk teď dočasně odmítá požadavky. Zkuste to za chvíli znovu.';
  }
  const base = match[1].replace(/[.:\s]+$/, '');
  // Uklidňující dovětek, který hláška nese za technickou částí (např. u konfliktu), zůstává
  const reassurance = /Žádný soubor nebyl přepsán\.\s*$/.test(message) ? ' Žádný soubor nebyl přepsán.' : '';
  const nextStep = status >= 500
    ? ' Google Disk má teď potíže, zkuste to za chvíli znovu. Změny zůstávají v tomto zařízení.'
    : ' Zkuste to znovu, změny zůstávají v tomto zařízení.';
  return `${base}.${reassurance}${nextStep}`;
}

/** Vrátí původní technický text chyby, pokud se liší od toho, co vidí uživatel. */
export function getSyncErrorDetails(message: string | null | undefined): string | null {
  if (!message) return null;
  return describeSyncError(message) === message ? null : message;
}

/**
 * Převede chybu přihlášení přes Google (kódy Google Identity Services jako `popup_closed`)
 * na českou větu s dalším krokem. Česká hláška aplikace projde beze změny.
 */
export function describeLoginError(message: string | null | undefined): string {
  const fallback = 'Přihlášení přes Google se nezdařilo. Zkuste to prosím znovu.';
  if (!message) return fallback;
  const lower = message.toLowerCase();
  if (lower.includes('popup_failed_to_open') || lower.includes('blocked')) {
    return 'Prohlížeč zablokoval přihlašovací okno. Povolte pro tuto stránku vyskakovací okna a zkuste to znovu.';
  }
  if (lower.includes('popup_closed') || lower.includes('closed')) {
    return 'Přihlašovací okno bylo zavřeno dřív, než se přihlášení dokončilo. Zkuste to znovu.';
  }
  if (lower.includes('access_denied') || lower.includes('denied')) {
    return 'Přístup ke Google Disku nebyl povolen. Bez něj CashPilot nemůže ukládat vaše data.';
  }
  if (lower.includes('failed to fetch') || lower.includes('network') || lower.includes('timeout')) {
    return 'Nepodařilo se spojit s Googlem. Zkontrolujte připojení k internetu a zkuste to znovu.';
  }
  return /[áčďéěíňóřšťúůýž]/i.test(message) ? message : fallback;
}
