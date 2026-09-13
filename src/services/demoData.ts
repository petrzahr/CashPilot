/**
 * Zpětná kompatibilita pro importy v testech a existujících nástrojích.
 * Produkční inicializace používá čisté konstanty z '../constants/defaultData'.
 */
export {
  CURRENT_DATA_VERSION,
  DEFAULT_SETTINGS,
  DEFAULT_CATEGORIES,
  createEmptyAppData,
} from '../constants/defaultData';

export {
  DEMO_ACCOUNTS,
  DEMO_RECURRING_RULES,
  DEMO_TRANSACTIONS,
  KNOWN_DEMO_ACCOUNT_IDS,
  KNOWN_DEMO_RULE_IDS,
  KNOWN_DEMO_TX_IDS,
  isKnownDemoRecordId,
} from '../fixtures/demoData';
