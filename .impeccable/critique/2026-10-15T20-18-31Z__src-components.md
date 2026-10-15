---
target: all screens and pop up forms
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:C:\\Users\\pzahr\\Disk Google\\Antigravity\\CashPilot\\src\\components"
timestamp: 2026-10-15T20-18-31Z
slug: src-components
---
# Critique 2: all screens and dialogs (src/components)

Score 24/40 (Acceptable). Heuristics: 1=3, 2=3, 3=2, 4=2, 5=2, 6=3, 7=2, 8=2, 9=2, 10=3.
Cognitive load: 4/8 checklist failures (moderate), down from 6/8.
The first run's P1 issues are resolved. The Budget KPI tiles stay as they are by the owner's decision and were excluded from this review.

## Design specificity
The behaviour is clearly specific to CashPilot. The visual layer is stock Tailwind SaaS; the KPI tile is the only signature element.
Detector: CLI 0 findings. Browser check of the login screen: 0 findings, no overflow, no contrast failures, headings h1 -> h2.

## Priority issues
1. [P1] Deleting an account or category asks for confirmation ("nelze vrátit") and only then refuses (FinanceContext.tsx:1611). The refusal is a toast that disappears after 4 s (FinanceContext.tsx:425-427). Fix: check usage before the dialog and offer "Archivovat"; error toasts stay until dismissed. Command: harden.
2. [P1] A correction difference has three colour schemes: ReconciliationModal positive sky / negative amber, CorrectionDetailModal emerald / amber, lists emerald / red. Amber is also used for correction rows, but amber means "Plánovaná". Fix: emerald / red / neutral everywhere; mark corrections with an icon and a neutral chip. Command: colorize.
3. [P2] Money inputs: AccountModal, MarketValueModal, InvestmentFeeModal and ReconciliationModal use type=number. Percentages are shown with a dot in Analytics and Accounts. Fix: shared MoneyInput and formatPercent (cs-CZ). Command: harden.
4. [P2] Mobile drawer has no Escape, focus trap or inert. Status menu has no aria-expanded or Escape. AccountHistoryModal icon buttons are about 28px. Inputs at 12–14px trigger iOS zoom. Command: adapt.
5. [P2] Dense rows (up to 7 actions), no "Zrušit filtry", correction trash icon only opens the detail. Command: distill.
6. [P3] No "Dnes" marker in the daily list; Overview has no headings. Command: layout.

## Persona red flags
Alex: no shortcuts, no "Uložit a přidat další", filters reset when switching screens. Sam: drawer focus leaks, multiselect announces only "Vybráno: 2", opacity-based states. Casey: iOS zoom, 28px buttons, type=month. Co-user: focus doesn't land on Částka, no "další" after saving.
