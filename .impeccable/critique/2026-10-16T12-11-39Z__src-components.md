---
target: all screens and pop up forms
total_score: 28
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:C:\\Users\\pzahr\\Disk Google\\Antigravity\\CashPilot\\src\\components"
timestamp: 2026-10-16T12-11-39Z
slug: src-components
---
# Critique 6: all screens and dialogs (src/components)

Score 28/40 (Good, low edge). Heuristics: 1=3, 2=3, 3=2, 4=3, 5=3, 6=3, 7=3, 8=2, 9=3, 10=3.
Cognitive load: 4/8 checklist failures (high): single focus, chunking, visual hierarchy, ≤4 choices.
Owner decisions excluded: Budget KPI tiles stay, header identical on all screens, inline row actions.

## Design specificity
The behaviour is specific to CashPilot (about 90%): running balance per item, the "Dnes" divider, the intra-day overdraft warning with a fix, mandatory-expense simulation, and restore-as-merge preview. The form is generic (about 70%): every block is the same white rounded-2xl card with a border and shadow, the Settings sections share an icon-chip header, and there is a GitHub-style "Nebezpečná zóna". The "Rozpočtová karta" signature looks like every other tile.
Detector: CLI 0 findings (src/components, src/App.tsx). Browser overlay on the login screen at desktop and 375px: 0. Project greps: 0 off-palette colours, 0 hex except the Google logo, 0 text under 12px, 0 slate-900 backdrops, 0 left stripes, no heading skips, all 14 dialogs built on Modal.

## Priority issues
1. [P1] Usable balance is buried on Budget. It shares a 2-column tile with net worth (MonthlyBudgetScreen.tsx:645-650), followed by 14 equal-weight tiles (680-819), the category grid, the filters and then the list. Every row repeats "Zůstatek po položce:" (1216) and a "#n" chip (1151). Fix: usable balance as the single hero, quieter tile strip (tiles stay), balance label moved to a caption, #n only when a day has more than one item. Command: layout, quieter.
2. [P1] Quick phone entry in TransactionModal. The ModalFooter has whitespace-nowrap and flex-auto with no flex-wrap, inside an overflow-hidden dialog (Modal.tsx:107, 141). Create mode has 3 buttons ("Zrušit", "Uložit a další", "Vytvořit položku"; TransactionModal.tsx:809-835), which need about 385px but only about 303px is available at 375px. Focus goes to the dialog container, not the amount field (Modal.tsx:59). Clicking the scrim or pressing Esc discards a dirty form (Modal.tsx:96). Fix: wrap the footer and put the primary button full width on mobile, autofocus the amount field in create mode, confirm before discarding a dirty form. Command: adapt, harden.
3. [P2] No undo after deletes. Single deletes (transaction, correction, market value, fee) use a confirm dialog that ends on "nelze vrátit", although toasts support actions (ToastContainer.tsx:40-50). Fix: delete immediately plus a "Vrátit" toast; keep dialogs for series scope and bulk deletes. Command: harden.
4. [P2] Nested cards and term drift. Bordered cards sit inside cards in Analytics (AnalyticsScreen.tsx:213, 261-332), Settings backup and danger zone (SettingsScreen.tsx:644-673, 755) and Categories pills (CategoriesScreen.tsx:242). Terms drift: "Čistá změna" vs "čistá bilance"; "Skutečně uspořeno" vs "Průměrně ušetří". Fix: flatten to inset rows; one glossary. Command: polish, clarify.
5. [P3] Small inconsistencies:
   - correction badge pill vs chip (MonthlyBudgetScreen.tsx:1177 vs TransactionsScreen.tsx:453)
   - delete icons always red in AccountHistoryModal (182, 225)
   - Mandatory sticky header without sticky body cells (MandatoryExpensesScreen.tsx:463 vs 482)
   - Overview "Celkový majetek" toggle not purple (OverviewScreen.tsx:88-99)
   - translucent fills on white (SettingsScreen.tsx:755, AnalyticsScreen.tsx:261, ReconciliationModal.tsx:180)
   Command: polish.

## Persona red flags
- Alex: no click-to-edit on row title (MonthlyBudgetScreen.tsx:1167); no "/" search shortcut; Budget list and Všechny položky duplicate the toolbar.
- Sam: dialogs focus the container; destructive ConfirmationModal doesn't focus Cancel (ConfirmationModal.tsx:46-67); input focus ring at 20% opacity; chart tooltips are hover-only (the data table compensates).
- Casey: new-item footer overflow; the account card header has 5 icon buttons at 44px (AccountsScreen.tsx:311-353); 16px checkboxes with ~20px label rows in Settings and Categories.
- Author phone check: today's net worth is only in the drawer; 7+7 tiles push "Dnes" far down; there is no jump-to-today control.

## Minor
- The tagline appears 3 times (login twice, sidebar).
- Dead gradient behind the sidebar logo (Sidebar.tsx:134).
- KPI labels are semibold, but DESIGN.md says 700.
- The "Dnes" group uses the same bg-slate-50 as cancelled and correction rows.
- font-mono on the reset phrase.
- The Mandatory explainer is long.
- Investment card closingBalance vs marketValue in past periods needs a check (AccountsScreen.tsx:248-256, 364).
- 34 active:scale/transition-all uses but only 11 motion-reduce guards, and no global rule.

## Questions
1. If usable balance is the success metric, why does it share equal weight with net worth and 14 more numbers before the first item?
2. What does "Všechny položky" do that an all-periods toggle on Budget wouldn't?
3. Would an undo toast make the cockpit calmer than a dozen "nelze vrátit" dialogs?
