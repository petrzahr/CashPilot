# Glossary

Domain terms used in code, docs and architecture reviews. Code for these lives in `src/services/accountScope.ts` unless noted.

**Default account** — the account marked `isDefault` that is not archived (`getDefaultAccount`). Budget KPI tiles, the category overview, mandatory expenses and Analytics are computed from it only. There is at most one; there may be none.

**Effective amount** — the amount a transaction counts with everywhere: an executed item uses `actualAmountInHaler` when set, anything else uses the planned `amountInHaler` (`getEffectiveAmountInHaler`). A planned item never uses a stale actual amount.

**Account flow** — the signed effect of a transaction on one account (`getAccountFlowInHaler`): income and incoming transfers add, expenses and outgoing transfers subtract. A transfer to the same account and a balance adjustment have no flow; corrections are handled by the forecast.

**Net transfers** — transfers seen from the default account, netted per counterparty account: outgoing counts +, money returned to the default account counts −. Both the Saved / Invested KPI tiles and the "Savings & transfers" row of the category overview use net transfers, so they always agree.

**Account balance** — the state of one account at the end of a day (`getAccountBalanceAtDate` in `src/services/accountBalance.ts`); 0 before the account's activation date. A liquid account is its initial balance plus the effect of its transactions plus legacy corrections not already stored as transactions. An investment or pension account is its latest valuation up to that day (market value snapshot, else the market value on the account) plus account flows after it; corrections never apply. By default only executed items count (actual balance); `includePlanned` gives the projected balance used for reconciliation and the forecast opening.
