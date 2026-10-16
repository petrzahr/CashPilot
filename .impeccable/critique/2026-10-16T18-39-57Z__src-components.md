---
target: all screens and pop up forms
total_score: 28
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:C:\\Users\\pzahr\\Disk Google\\Antigravity\\CashPilot\\src\\components"
timestamp: 2026-10-16T18-39-57Z
slug: src-components
---
# Critique 7: all screens and dialogs (src/components)

Score 28/40 (Good, low edge). Heuristics: 1=3, 2=3, 3=3, 4=2, 5=3, 6=3, 7=3, 8=2, 9=3, 10=3.
Cognitive load: 5/8 checklist failures; chunking (7-tile rows) is owner-accepted, so 4 count. The failures are single focus, row hierarchy, ≤4 choices and working memory.
Owner decisions excluded: Budget screen structure and rows ("Rozpočet nech být"), header identical on all screens, inline row actions, tagline, monospace reset phrase, input focus ring, account card icons, net worth only in the drawer, subcategory rows.

## Design specificity
Behaviour and money semantics are authored for this product: the day ledger with running balance, "Dnes", the intra-day negative warning, the shared recurrence scope picker, the chart table that doubles as a legend, and the mandatory simulation. Token discipline is strict. The drift is at component level: 3 primary button recipes, ~12 secondary button strings with two hover languages, ~11 badge combinations, and 3 field focus recipes.
Detector: CLI 1 finding, gray-on-color at ReconciliationModal.tsx:180. Browser overlay on login at desktop and 375px: 0. Greps clean for hex, <12px text, palette, backdrops and stripes; all table headers are uniform; 7 translucent fills on white.

## Priority issues
1. [P1] Component drift.
   - Primary buttons come in 3 variants: CategoriesScreen:133, Sidebar:165, TransactionModal:856. DESIGN says 12px bold.
   - Secondary buttons: 13 dialog cancel buttons use a grey hover, while the toolbar uses a blue hover (DESIGN says blue). They also differ in white vs slate-50 fill (AccountsScreen:435 vs :461).
   - Badges mix rounded, rounded-md and rounded-full, and both bordered and borderless. The same "conflict" meaning has 2 styles (Transactions:401 vs MonthlyBudget:1100).
   - Fields: a solid ring with no border change at TransactionModal:765/788/803 and ReconciliationModal:142/161/175; focus:ring-slate-300 at DataActionConfirmationModal:164.
   - Fix: btn-primary, btn-secondary, chip and field recipes. Command: polish/extract.
2. [P1] The undo toast is a timed trap. It is removed after 8 s regardless of hover or focus (FinanceContext:436-438), it is unreachable by keyboard in time, and there is no Ctrl+Z. Undo is now the only safety net for single deletes. Fix: pause on hover/focus, Ctrl+Z for the latest undo. Command: harden.
3. [P2] "Převody" in the Overview forecast is the gross volume of all transfers, independent of scope (financialEngine:741, OverviewScreen:164). Negative values would show "0 Kč". In the per-account table and on Budget the same word means net signed. In the "Použitelné peníze" scope the row does not add up. Fix: net signed transfers for the scope, or rename to "Objem převodů". Command: clarify.
4. [P2] Reconciliation dialog: the result panel ("Korekce −X") sits above the input and shows the full balance before anything is typed (ReconciliationModal:97-128). The info box at :180 repeats the subtitle at :93 and is the detector's gray-on-color finding. The amount field has no inputMode (:135, AccountModal:191). Fix: input first, diff after input, drop the box, inputMode. Command: clarify.
5. [P3] Translucent fills on white: TransactionsScreen:373, OverviewScreen:372, MonthlyBudgetScreen:754 and :1160, RecurrenceScopePicker:51-52, StatusBadgeMenu:7-8, Header:221 (hover). Command: polish.

## Persona red flags
- Alex: no bulk select in Všechny položky; no Ctrl+Z; shortcuts only in `title`; every chart bar is its own tab stop (no roving tabindex).
- Sam: undo toast; menu focus is only focus-visible:bg-slate-100 (MultiSelectDropdown:154/167, StatusBadgeMenu:125); checkbox border slate-300 (MultiSelectDropdown:171); repeat icon has only a title (MonthlyBudgetScreen:1211); desktop move arrows are 16px (MoveButtons:31).
- Casey: no inputMode on balance fields; Kategorie/Podkategorie are two columns at 375px (TransactionModal:658).
- Author phone check: sync status is icon-only below 1280px; "Dnes" button helps.

## Minor
- Transfer target account shown in sky (TransactionsScreen:446).
- Mixed 3.5/4 icon sizes in action clusters (CategoriesScreen:259/268/286, Mandatory:318/328).
- opacity-80 on subcategory actions (CategoriesScreen:252).
- KPI tile labels not uppercase vs DESIGN label style (MonthlyBudgetScreen:700).
- "Klasický seznam" (:941).
- Sum chip looks like the count chip (:908-914).
- Header "Odpojit" menu button lacks min-h-11 (Header:200).
- Disabled "Obnovit výchozí stav" is always visible (Mandatory:630).
- Loading screen logo gradient (App:270).
- Dead non-recurring copy "nelze vrátit" in DeleteTransactionModal (:89, :160).
- Investment return has no "Výnos" label (AccountsScreen:372).
- Focus-ring aura opacity varies between /20, /30 and /40.
- Sidebar scrim is /30 vs Modal /40.

## Questions
1. Should undo be a keyboard command and a lasting "naposledy smazané" rather than an 8 s toast?
2. One button recipe or many: what would a single secondary-button language look like?
3. Should the phone open Budget already scrolled to "Dnes", same structure, different start position?
