# Glossary

Domain terms used in code, docs and architecture reviews. Code for these lives in `src/services/accountScope.ts` unless noted.

**Default account** — the account marked `isDefault` that is not archived (`getDefaultAccount`). Budget KPI tiles, the category overview, mandatory expenses and Analytics are computed from it only. There is at most one; there may be none.

**Effective amount** — the amount a transaction counts with everywhere: an executed item uses `actualAmountInHaler` when set, anything else uses the planned `amountInHaler` (`getEffectiveAmountInHaler`). A planned item never uses a stale actual amount.

**Account flow** — the signed effect of a transaction on one account (`getAccountFlowInHaler`): income and incoming transfers add, expenses and outgoing transfers subtract. A transfer to the same account and a balance adjustment have no flow; corrections are handled by the forecast.

**Net transfers** — transfers seen from the default account, netted per counterparty account: outgoing counts +, money returned to the default account counts −. Both the Saved / Invested KPI tiles and the "Savings & transfers" row of the category overview use net transfers, so they always agree.

**Account balance** — the state of one account at the end of a day (`getAccountBalanceAtDate` in `src/services/accountBalance.ts`); 0 before the account's activation date. A liquid account is its initial balance plus the effect of its transactions plus legacy corrections not already stored as transactions. An investment or pension account is its latest valuation up to that day (market value snapshot, else the market value on the account) plus account flows after it; corrections never apply. By default only executed items count (actual balance); `includePlanned` gives the projected balance used for reconciliation and the forecast opening.

**Forecast** — the module that, from data, today and the ranges, computes summaries for all periods (`calculateForecast` in `src/services/financialEngine.ts`). It builds its own period sequence (`buildForecastPeriods`): 12 periods back and 12 ahead of the current period, the data bounds, the Overview and Analytics ranges and the selected period. Screens never push bounds into it. `usePeriodForecast` (`src/hooks/usePeriodForecast.ts`) holds today, the current and selected period, the screen ranges and the memoised forecast.

**Period view** — the answer to `getPeriod` for one period key: `{ period, projected, recorded, defaultAccount }`. Not built yet; it will replace `getAccountPeriodSummary`, `getDefaultAccountPeriodTotals` and `calculateDefaultAccountKpis`.

**Projected summary** — an aktuální or budoucí (current or future) period with investment and pension accounts anchored at today's market value (`forecastPeriods` of the forecast).

**Recorded summary** — a period summary built from stored values, with no projection (`periods` of the forecast).

**Command** — a pure function that changes app data: `(data, input, ctx) → { data, outcome }` (`src/services/transactionCommands.ts`). It never touches React, storage or toasts; `ctx` supplies the current time, today's date and new IDs, so tests can fix them. `FinanceContext` is only the adapter: it runs the command through the sync controller and turns the outcome into a toast or an undo action. When nothing changes, a command returns the original data object.
