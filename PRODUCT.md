# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primárně autor a jeho domácnost. CashPilot je osobní nástroj na správu a plánování financí domácnosti. Několik dalších lidí ho používá jako schválení testovací uživatelé (přístup na žádost, viz přihlašovací obrazovka). Širší veřejnost zatím cílem není.

Hlavní práce: naplánovat příjmy a výdaje v rozpočtovém období, hlídat, kolik peněz zbývá a jak se zůstatky vyvinou dopředu, a průběžně zapisovat, co se skutečně stalo.

## Product Purpose

Mít osobní finance pod kontrolou: měsíční rozpočet, předpověď zůstatků po každé položce i na měsíce dopředu a přehledy vývoje majetku. Úspěch znamená, že uživatel na první pohled ví, jaký je jeho použitelný zůstatek a celkový majetek teď i na konci období.

## Positioning

Aplikace je stavěná na míru: každá funkce vychází z konkrétních individuálních požadavků autora, ne z obecné šablony rozpočtových aplikací. Rozhoduje to, co domácnost skutečně používá.

## Operating Context

- Používá se hlavně na počítači (plánování u stolu); telefon slouží k rychlé kontrole a zápisu, takže mobil musí plně fungovat, ale desktop je hlavní scéna.
- Data leží v soukromém aplikačním prostoru uživatelova Google Disku; přihlášení přes Google je povinné. Aplikace pracuje s místní mezipamětí a změny synchronizuje na pozadí.
- Rozpočtové období začíná nastavitelným dnem v měsíci (výchozí 15.).
- Celé rozhraní je v češtině, měna Kč, české formáty čísel a dat.

## Capabilities and Constraints

- Obrazovky: Měsíční rozpočet, Přehledy, Analýza a trendy, Mandatorní výdaje, Všechny položky, Účty, Kategorie, Nastavení.
- Položky mají stav Plánovaná / Uskutečněná / Zrušená; plánované položky s dnešním nebo starším datem se automaticky označí jako uskutečněné.
- Pravidelné položky (opakovaná pravidla), převody mezi účty, korekce zůstatku podle banky, investiční účty s tržní hodnotou a poplatky.
- Pořadí položek v rámci dne a průběžný zůstatek po každé položce.
- Částky se počítají v celých haléřích.
- Uskutečněná položka počítá se skutečnou částkou, plánovaná s plánovanou, a to všude.
- Výnos investic = tržní hodnota − (vklady − poplatky); jeden měsíční poplatek na rozpočtové období.
- Záměrně odmítnuto (nenavrhovat): import z banky, limity kategorií / plán vs. skutečnost, úvěrové účty, finanční cíle, štítky napříč kategoriemi.

## Brand Commitments

- Název CashPilot, podtitul „Vaše osobní finance pod kontrolou“, logo `public/favicon.svg`.
- Česká, věcná a srozumitelná řeč bez marketingového nadšení.

## Evidence on Hand

- Ukázková data pro vývoj a testy: `src/fixtures/demoData.ts`.
- Žádné recenze, reference ani statistiky uživatelů neexistují; nevymýšlet je.

## Product Principles

1. Jednoduchost před úplností: nová funkce musí vycházet ze skutečné potřeby domácnosti.
2. Čísla musí sedět: konzistentní pravidla výpočtu na všech obrazovkách, žádné zaokrouhlovací chyby.
3. Data patří uživateli: zůstávají v jeho Google Disku a nic se nesmí tiše ztratit.
4. Přehled na první pohled: hlavní stav financí je čitelný bez klikání.

## Accessibility & Inclusion

Kontrast textu alespoň 4,5:1 ve světlém i tmavém vzhledu, text nejméně 12px, dotykové plochy 44px na mobilu, respektování `prefers-reduced-motion` (podrobně v DESIGN.md).
