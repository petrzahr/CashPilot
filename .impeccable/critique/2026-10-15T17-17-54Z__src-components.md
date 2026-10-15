---
target: all screens and pop up forms
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 4
target_identity: "file:C:\\Users\\pzahr\\Disk Google\\Antigravity\\CashPilot\\src\\components"
timestamp: 2026-10-15T17-17-54Z
slug: src-components
---
# Critique: all screens and dialogs (src/components)

Score 24/40 (Acceptable). Heuristics: 1=3, 2=3, 3=2, 4=2, 5=3, 6=2, 7=2, 8=2, 9=3, 10=2.
Cognitive load: 6/8 checklist failures (high).

## Design specificity
The content is specific to CashPilot (running balance per item, intra-day overdraft warning, reconciliation, P/K matrix, what-if simulator). The chrome is generic Tailwind SaaS: gradient logo tiles with glow, tinted icon tiles on Settings headers, an icon-chip feature list on login, off-palette indigo/violet/rose, a separate dark style on DataLoadErrorScreen. The North Star "Klidný kokpit" is half delivered: dense, but with no lead instrument.
Detector: CLI 0 findings. Browser (login only): skipped-heading h1 -> h3 at LoginScreen.tsx:142.

## Priority issues
1. [P1] Budget KPI wall (2 hero tiles + 14 tiles, MonthlyBudgetScreen.tsx:700-879). Sky is used for money metrics, labels are colored, negative % values stay green/sky, a negative end balance is amber (785). Fix: one primary row; collapsible "Detail období"; neutral labels; value color by sign. Commands: distill, quieter, colorize.
2. [P1] No global tabular figures; only 5 files use tabular-nums. Fix: set font-variant-numeric: tabular-nums on body. Command: typeset.
3. [P1] Keyboard/AT gaps: clickable tr/div/th (OverviewScreen.tsx:127,204,305; sort headers in TransactionsScreen.tsx:479 and MonthlyBudgetScreen.tsx:1353); MultiSelectDropdown without aria-expanded, Esc or arrow keys; Escape closes all stacked dialogs (Modal.tsx:34, a window listener per modal); type toggle without aria-pressed. Commands: harden, audit.
4. [P1] Slow quick entry on mobile: no sticky add button, screen title hidden below 640px, Name comes before Amount, required "Pořadí v rámci dne", type=number money fields, toast overflows at 375px (ToastContainer.tsx:13). Commands: adapt, distill.
5. [P2] Dialog inconsistency: 3 recurrence-scope pickers, purple primary buttons (MarketValueModal, InvestmentFeeModal), dialog title 18px semibold vs the 16/700 spec, header period control shown on screens that ignore it, nav labels differ from screen titles. No confirmation for Drive download / restore / disconnect / simulator reset. Commands: polish, clarify, harden.

## Persona red flags
Alex: no shortcuts, hover-only move buttons, up to 7 row actions, duplicate tables. Sam: see issue 3, text-red-500 not AA-tuned, opacity-based states, swatches labelled "Barva n", hover-only chart tooltip. Casey: no title, 1080px table with actions off-screen, toast overflow, misaligned search icon. Household co-user: ~10 decisions per entry, Stav select despite auto-execution, no balance feedback after saving.

## Questions
1. Why does usable balance weigh the same as "Investováno %"?
2. Should the header period navigator exist on screens that ignore it?
3. Should anyone ever type "Pořadí v rámci dne"?
