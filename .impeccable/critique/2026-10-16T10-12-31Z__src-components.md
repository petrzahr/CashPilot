---
target: all screens and pop up forms
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 1
target_identity: "file:C:\\Users\\pzahr\\Disk Google\\Antigravity\\CashPilot\\src\\components"
timestamp: 2026-10-16T10-12-31Z
slug: src-components
---
# Critique 5: all screens and dialogs (src/components)

Score 27/40 (Acceptable, upper edge). Heuristics: 1=3, 2=3, 3=3, 4=2, 5=3, 6=3, 7=3, 8=2, 9=3, 10=2.
Cognitive load: 4/8 checklist failures (high). Failures: chunking, grouping, ≤4 choices per decision point, working memory.
Owner decisions excluded: Budget KPI tiles, header identical on all screens, inline row actions.

## Design specificity
The behaviour is clearly built for CashPilot: running balance per item, "Dnes" divider, "Během dne v mínusu" warning with fix, "Včetně kontokorentu", mandatory simulation, investment return rule. The visual skin could belong to any Tailwind dashboard. The palette discipline is strict but there is no signature form beyond it.
Detector: CLI 0 findings (src/components, src/App.tsx). Browser overlay on login at 1024px and 375px: 0 findings. Greps: only false positives (Google logo hex, DataLoadErrorScreen bg-slate-900 surface, aria-hidden drag handle). Heading skips h1→h3 on most screens, h4 in MonthlyBudgetScreen:668, SettingsScreen:605, DataActionConfirmationModal:86.

## Fixed since critique 4
- DataActionConfirmationModal Enter trap: fixed.
- Transactions mobile 1080px table and always-open filters: fixed (cards + MobileFiltersToggle). md+ still min-w 1080px.
- Budget row icons coloured at rest: fixed except correction delete (MonthlyBudgetScreen:1242).
- Overview 360px column: fixed (200px sticky); on mobile it takes ~58% of width.
- Sync labels shared via SYNC_LABELS: partly fixed.

## Priority issues
1. [P1] "Celkový majetek" means end-of-period on Budget (MonthlyBudgetScreen.tsx:656) and today in Sidebar (Sidebar.tsx:201, 239); "Použitelný zůstatek" hero has no time point. Fix: label with the moment ("Na konci období · 14. 11.") or pair today/end. Command: clarify.
2. [P2] Restore from file merges immediately with no confirmation (SettingsScreen.tsx:293-306 → importJSON). Delete takes four steps. Fix: confirmation dialog with add/overwrite counts, DataActionConfirmationModal layout. Command: harden.
3. [P2] Sync wording still split: static green "Připojeno" badge even during error (SettingsScreen.tsx:482-487 vs 569-573); "Poslední uložení" vs "Poslední synchronizace"; "Synchronizovat nyní" vs "Synchronizovat"; four disconnect wordings; amber-700 vs amber-600. Fix: one SyncStatus component, drop the static badge. Command: clarify + polish.
4. [P2] "Celá série" means three things: edit includes past (TransactionModal.tsx:489), reorder says all occurrences but past unchanged (ReorderScopeDialog.tsx:59), delete removes all with executed-protect checkbox (DeleteTransactionModal.tsx:107-133). Fix: one definition, explicit exceptions. Command: clarify.
5. [P2] DataLoadErrorScreen off-system: bg-slate-900 island, font-black, rounded-3xl, /10 tints + backdrop-blur, recovery buttons without min-h-11 (DataLoadErrorScreen.tsx:52-108). Fix: rebuild on surface tokens with red/amber info panel. Command: polish.

## Persona red flags
- Alex: no keyboard shortcuts; Transactions table min-w-[1080px] (TransactionsScreen.tsx:794) scrolls at 1280px with sidebar; status changeable three ways per row.
- Sam: heading outline h1→h3 on Budget, Transactions, Analytics, Mandatory, Accounts, Categories; definitions only in `title`; header sync state md–xl is a colour dot only (Header.tsx:128-146); login screen select-none (LoginScreen.tsx:42).
- Casey: Overview sticky 200px column on 343px viewport; Budget rows stack move buttons, sequence chip, badge and 6×44px actions.
- Household partner (phone check): app opens on Budget with end-of-period values and 16 numbers; today's balances only inside hamburger drawer.

## Minor observations
- Correction delete red at rest, icon 3.5 vs 4 in Transactions.
- Footer button weight font-medium vs font-semibold across dialogs.
- DataActionConfirmationModal placeholder equals the phrase (:153); disabled fades twice (bg-red-300 + opacity-60, :180).
- Nested-card feel: category tiles in category card (Budget:829), bordered day rows (:1118), balance panel in account card (Accounts:356), danger-zone rows (Settings:711).
- Mandatory simulation tints added rows emerald and edited rows amber (MandatoryExpensesScreen.tsx:235-236) – overloads meaning colours.
- Clock icon means both "planned" and "last checked/valued" (AccountsScreen.tsx:387, 398).
- "Zrušit" (cancel dialog) next to "Zrušená" status still ambiguous.
- Category archive is instant and the item vanishes (CategoriesScreen.tsx:206).
- Decorative gradient behind logo (Sidebar.tsx:134, App.tsx:231). Placeholder "..." instead of "…" (TransactionModal.tsx:799).
- Login doesn't say data stays in the user's Drive (LoginScreen.tsx:72-91); delete warning doesn't mention automatic Drive backups.

## Questions to consider
1. If the partner only checks the phone, why does the app open on a 16-number planning cockpit instead of "K dnešku"?
2. Should one label ever show two different numbers on two screens?
3. Deleting takes four deliberate steps and restoring from a file one click. Which one puts the data at more risk?
