---
target: all screens and pop up forms
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:C:\\Users\\pzahr\\Disk Google\\Antigravity\\CashPilot\\src\\components"
timestamp: 2026-10-15T21-22-13Z
slug: src-components
---
# Critique 3: all screens and dialogs (src/components)

Score 27/40 (Good). Heuristics: 1=2, 2=3, 3=3, 4=2, 5=3, 6=3, 7=3, 8=3, 9=3, 10=2.
Cognitive load: 4/8 checklist failures (moderate).
Owner decisions were excluded from the review: the Budget KPI tiles, the header looking the same on every screen, and inline row actions.

## Design specificity
The content and behaviour are specific to CashPilot: "Dnes" divider, intra-day minus warning with a fix, reconciliation preview, simulation, archive instead of a blocked delete. The visual skin is generic Tailwind.
Detector: CLI 0 findings; browser check of the login screen 0 findings. Only the copy-email button is under 44px on desktop.

## Priority issues
1. [P1] Sync errors are effectively invisible: error, conflict, offline and idle all show the same amber dot, the label only appears from 1280px, and there is no toast (Header.tsx:120-132). Fix: red dot plus icon, label at every width, persistent toast with "Zkusit znovu", Czech error text. Command: harden.
2. [P1] ModalFooter has no flex-wrap (Modal.tsx:141); 3 buttons in TransactionModal (~410px) don't fit at 375px. Fix: wrap on max-sm with the primary button full width. Command: adapt.
3. [P2] "Odpojit" in Settings calls disconnectGoogleDrive with no confirmation (SettingsScreen.tsx:478), while the header path asks. Command: harden.
4. [P2] Number honesty and terminology: Mandatory rounds to 100 Kč without a note; "Investováno" and "Skutečně uspořeno" mean different things on different screens; Overview Příjmy/Výdaje include corrections. Command: clarify.
5. [P2] The status chip is clickable only in the daily view; a correction reads "Korekce" in one view and "Uskutečněná" in another; Pencil vs Edit3 in history; grey bins on account and category cards; "Plánovaná" is offered for past dates and then auto-executed. Command: polish.

## Persona red flags
Alex: no shortcuts, filters reset when switching screens, two period systems. Sam: archived cards at opacity-75, definitions only in title, purple-400 icon, swatches labelled "Barva n". Casey: footer overflow, 1080px table, CategoryModal toggle at 40px, error-screen links. Co-user: title is required, no category shortcut.
