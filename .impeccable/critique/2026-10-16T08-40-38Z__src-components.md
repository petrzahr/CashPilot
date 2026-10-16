---
target: all screens and pop up forms
total_score: 28
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 1
target_identity: "file:C:\\Users\\pzahr\\Disk Google\\Antigravity\\CashPilot\\src\\components"
timestamp: 2026-10-16T08-40-38Z
slug: src-components
---
# Critique 4: all screens and dialogs (src/components)

Score 28/40 (Good). Heuristics: 1=3, 2=3, 3=3, 4=3, 5=3, 6=3, 7=3, 8=2, 9=3, 10=2.
Cognitive load: 5/8 checklist failures (high). Failures: single focus, chunking, visual hierarchy, choices per decision point, progressive disclosure on mobile.
Owner decisions excluded: Budget KPI tiles, header identical on all screens, inline row actions.

## Design specificity
The behaviour is clearly built for CashPilot: the running balance after every item, the "Během dne v mínusu" warning with a suggested fix, the "Dnes" divider, the immutable-correction explanation, the simulation mode. The look is stock Tailwind (slate/sky, rounded-2xl, gradient logo tiles). The "Klidný kokpit" north star holds in the dialogs and Settings and breaks in the budget rows (coloured icons at rest) and on DataLoadErrorScreen.
Detector: CLI 0 findings (src/components, src/App.tsx). Browser overlay on the login screen at 1024px and 375px: 0 findings. Source greps found only false positives (Google logo hex, chart tooltip and inset panel using slate-900/alpha).

## Fixed since critique 3
- Header sync status: red, icon and label at every width. Fixed.
- ModalFooter wrapping at 375px. Fixed; side effect: on mobile, Tab order differs from visual order (`order:-1`).
- Settings "Odpojit" now confirms via DisconnectDriveDialog. Fixed; residual: the dialog is not styled as destructive.

## Priority issues
1. [P1] DataActionConfirmationModal.tsx:64-72 blocks Enter on every element except "Zrušit", so Enter on "Smazat…" and "Stáhnout zálohu" does nothing for keyboard users. The comment says the opposite intent. Fix: block Enter only in the phrase input. Command: harden.
2. [P2] Sync and auth state is reported 3 ways: Settings shows error/conflict in amber (SettingsScreen.tsx:531-535), LoginScreen.tsx:66 and App.tsx:236 show the raw driveError, and the cloud loader keeps spinning on error with no sign-out (App.tsx:224-240). Fix: one shared SyncStatusBadge, describeSyncError everywhere, error state plus "Odhlásit" on the loader. Command: clarify + harden.
3. [P2] Všechny položky on mobile is a min-w-[1080px] table (TransactionsScreen.tsx:513); filters (6–8) are always expanded (Transactions :407, Budget :937). Fix: stacked rows below md, as in the budget day view, and a "Filtry (n)" disclosure. Command: adapt.
4. [P2] Budget row actions are coloured at rest (MonthlyBudgetScreen.tsx:1245-1302), the Clock icon is used for two actions, and "Zrušit" means both cancel-dialog and cancel-item. Fix: slate at rest with the meaning colour on hover/focus, rename to "Označit jako zrušenou", give "Vrátit zrušenou do plánu" its own icon (RotateCcw). Command: quieter.
5. [P2] The Overview forecast table has a fixed 360px "Období" column (OverviewScreen.tsx:108, 243), about 1130px total, so it scrolls sideways on a 1366px laptop. Fix: auto/min ~180px, sticky first column. Command: layout.

## Persona red flags
- Alex: no keyboard shortcuts (new item, previous/next period); "Všechna období" renders every row.
- Sam: the Enter trap; heading jumps h1→h3 (Budget, Transactions, Analytics); disabled-button reasons only in `title`; error toast is role=alert nested inside role=status; Tab order ≠ visual order in 3-button footers.
- Casey: 1080px table; 6–8 stacked filters; bare 16px checkboxes without a 44px row (TransactionModal.tsx:708-727, SettingsScreen.tsx:374-391/576-584, DeleteTransactionModal.tsx:117-126); "Odpojit Google Disk" in the header menu lacks max-md:min-h-11 (Header.tsx:240).

## Minor observations
- Decorative colour: Settings backup icons are emerald/purple (SettingsScreen.tsx:619, 635); the hero KPI cards use gradients (MonthlyBudgetScreen.tsx:643, 650).
- Nested bordered panels: Budget category tiles :826, CorrectionDetailModal :113, Analytics trend rows :213, Settings Nebezpečná zóna :719.
- DataLoadErrorScreen has its own visual language (dark, rounded-3xl, font-black).
- text-purple-400 icon (AccountsScreen.tsx:387) is likely under 3:1 in light mode.
- Dead not-connected branches remain in Header :90-105 and Settings :457-502.
- "VYMAZAT" phrase vs "Smazat" elsewhere; the placeholder repeats the phrase, so the field looks pre-filled.
- Login never says that the data stays in your Google Drive; the footer repeats the subtitle.
- Definitions ("Uspořeno" vs "Skutečně uspořeno", P/K) only in `title` tooltips.

## Questions
1. Which one number should a phone user see on Budget without scrolling?
2. Should the disconnect dialog's primary action be "Synchronizovat a odpojit" when there are unsynced changes?
3. What does a calm-cockpit failure screen look like?
