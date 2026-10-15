/**
 * Převede technickou chybu synchronizace (často anglickou hlášku prohlížeče nebo Google API)
 * na českou větu, která říká, co se stalo a co s tím udělat. Česká hláška aplikace projde beze změny.
 */
export function describeSyncError(message: string | null | undefined): string {
  const fallback = 'Změny se nepodařilo uložit na Google Disk. Zůstávají v tomto zařízení a uloží se při další synchronizaci.';
  if (!message) return fallback;
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
