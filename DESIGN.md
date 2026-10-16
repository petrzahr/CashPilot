---
name: CashPilot
description: Osobní finance pod kontrolou – rozpočet, předpověď zůstatků a přehledy v soukromém Google Disku.
colors:
  pilot-blue: "#0278b6"
  pilot-blue-deep: "#0369a1"
  pilot-blue-tint: "#f0f9ff"
  canvas: "#f8fafc"
  surface: "#ffffff"
  fill: "#f1f5f9"
  hairline: "#e2e8f0"
  ink: "#0f172a"
  ink-secondary: "#607087"
  income-green: "#04835d"
  expense-red: "#d62424"
  planned-amber: "#b45309"
  planned-amber-tint: "#fffbeb"
  investment-purple: "#9333ea"
  night-canvas: "#0b1322"
  night-surface: "#121c30"
  night-fill: "#1a2640"
  night-hairline: "#263452"
  night-ink: "#eef2f8"
  night-ink-secondary: "#97a6c0"
  night-blue: "#38bdf8"
typography:
  kpi:
    fontFamily: "Plus Jakarta Sans, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 800
    lineHeight: 1.25
    fontFeature: "tnum"
  headline:
    fontFamily: "Plus Jakarta Sans, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.25
  title:
    fontFamily: "Plus Jakarta Sans, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 700
    lineHeight: 1.4
  body:
    fontFamily: "Plus Jakarta Sans, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.5
    fontFeature: "tnum"
  label:
    fontFamily: "Plus Jakarta Sans, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "0.05em"
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  2xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.pilot-blue}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "10px 16px"
  button-primary-hover:
    backgroundColor: "{colors.pilot-blue-deep}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.lg}"
    padding: "6px 12px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.xl}"
    padding: "20px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "8px 14px"
  nav-item-active:
    backgroundColor: "{colors.pilot-blue-tint}"
    textColor: "{colors.pilot-blue-deep}"
    rounded: "{rounded.lg}"
    padding: "10px 14px"
  chip-planned:
    backgroundColor: "{colors.planned-amber-tint}"
    textColor: "{colors.planned-amber}"
    rounded: "{rounded.md}"
    padding: "2px 8px"
---

# Design System: CashPilot

## Overview

**Creative North Star: "Klidný kokpit"**

CashPilot je přístrojová deska osobních financí. Pilot nepotřebuje efekty, potřebuje přístroje, které se čtou na první pohled: čísla jsou na prvním místě, barva hlásí jen stav a akci a všechno ostatní ustupuje do klidné šedomodré. Rozhraní je husté, protože uživatel pracuje s tabulkami a desítkami položek, ale nikdy ne přeplněné: karty oddělují skupiny přístrojů, uvnitř karty drží řád zarovnání a tabulková čísla.

Aplikace má dva rovnocenné vzhledy. Světlý je papírově čistý (bílé karty na velmi světlém plátně), tmavý „Noční modř“ je kokpit v noci: plátno je nejtmavší, karty o stupeň světlejší, výplně a hover ještě o stupeň výš. Tmavý vzhled není převrácený světlý – každá role má vlastní, ručně zvolenou hodnotu s ověřeným kontrastem. Výchozí je vzhled podle systému; uživatel ho může v Nastavení → Vzhled přepnout natrvalo pro dané zařízení.

**Key Characteristics:**
- Čísla jsou hlavní obsah: tabulkové číslice, KPI v 24px extrabold, částky zarovnané vpravo.
- Barva nese význam (příjem, výdaj, plánováno, investice, akce), nikdy dekoraci.
- Ploché karty se 16px zaobleními a jemným stínem, žádné vnořené karty.
- Hustá typografie s pevnou spodní hranicí 12px.
- Dva navržené vzhledy (světlý, Noční modř) ze stejných tokenů.

## Colors

Klidná šedomodrá základna s jedinou modrou pro akci a čtyřmi významovými barvami pro peníze.

### Primary
- **Pilotní modř** (pilot-blue): primární tlačítka („Nová položka“, „Přidat položku“), aktivní volby, odkazy a fokus. V tmavém vzhledu ji nahrazuje **Noční modř** (night-blue) s tmavým textem na tlačítku.
- **Hluboká pilotní modř** (pilot-blue-deep): hover primárního tlačítka, text aktivní položky navigace.
- **Modrý nádech** (pilot-blue-tint): pozadí aktivní položky navigace a informačních štítků.

### Secondary
- **Zelená příjmu** (income-green): příjmy, kladné změny, „Uskutečněná“, úspěch.
- **Červená výdaje** (expense-red): výdaje, záporné zůstatky, mazání, chyby.
- **Jantar plánu** (planned-amber): stav „Plánovaná“, upozornění, vrácení do plánu.
- **Fialová investic** (investment-purple): stav a identita, nikdy akce ani ozdoba. Částka celkového majetku (na všech obrazovkách), štítek a volba „Celkový majetek“, ikona tržní hodnoty a infopanely investičních dialogů. Akce u investičních účtů jsou neutrální jako u ostatních účtů; výnos i dlaždice „Investováno“ se barví podle znaménka (zelená/červená) jako ostatní toky období.

### Neutral
- **Plátno** (canvas / night-canvas): pozadí aplikace, zapuštěné panely a hlavičky tabulek.
- **Povrch** (surface / night-surface): karty, dialogy, hlavička, postranní panel.
- **Výplň** (fill / night-fill): hover, podklad segmentových přepínačů, štítky.
- **Linka** (hairline / night-hairline): okraje karet a polí, oddělovače řádků.
- **Inkoust** (ink / night-ink): nadpisy, hodnoty, primární text.
- **Vedlejší inkoust** (ink-secondary / night-ink-secondary): popisky, metadata, neaktivní volby.

### Named Rules
**The Meaning-Only Rule.** Barva v rozhraní vždy znamená peníze nebo stav: zelená přichází, červená odchází, jantar čeká, fialová roste, modrá jedná. Kategorie mají vlastní uživatelské barvy jen jako tečky a pruhy grafů.

**The Token Rule.** Barvy se píší výhradně Tailwind třídami palety (slate, sky, red, amber, emerald, purple, white) nebo tokeny `scrim` a `table-*`. Paleta v `tailwind.config.js` je uzavřená, jiné rodiny (rose, blue, gray…) neexistují. Linky a podklady jsou plné (`border-slate-200`, `bg-slate-50`); průhlednost jen tam, kde leží nad barvou. Ty čtou proměnné ze `src/theme.css`, takže fungují v obou vzhledech. Hex hodnota v komponentě je chyba, s výjimkou dat (barvy kategorií a sérií grafů) a loga Google.

**The AA Rule.** Každá dvojice text/pozadí má v obou vzhledech kontrast alespoň 4,5:1 (ikony a ovládací prvky 3:1). Proto jsou světlé odstíny slate-500, sky-500 (fokus) a sky/emerald/amber/red-600 oproti výchozímu Tailwindu mírně ztmavené. V tmavém vzhledu jsou jantarové podklady teplé hnědé, aby se plánované a upozornění nepletly s chybami.

## Typography

**Body Font:** Plus Jakarta Sans (s fallbackem system-ui, sans-serif), řezy 400–800.

**Character:** Jedna geometricky vlídná bezpatková rodina pro všechno; hierarchii nese řez a velikost, ne druhé písmo.

### Hierarchy
- **KPI** (800, 24px): hlavní čísla na kartách rozpočtu („Použitelný zůstatek“, „Celkový majetek“).
- **Headline** (700, 16px): název obrazovky v hlavičce a nadpisy sekcí v Nastavení.
- **Title** (700, 14px): nadpisy karet, názvy kategorií a účtů.
- **Body** (500, 12px, tabulkové číslice): data, řádky tabulek, popisy, formulářové popisky.
- **Label** (700, 12px, velká písmena, prostrkání 0,05em): krátké nadpisy skupin a popisky hlavních KPI. Popisky běžných číselných dlaždic (např. 14 dlaždic Rozpočtu) jsou v řezu Body, aby se hlavní čísla odlišila od vedlejších.

### Named Rules
**The 12px Floor Rule.** Žádný text není menší než 12px, ani štítky, osy grafů a metadata. Méně důležité se odlišuje barvou a řezem, ne zmenšením.

## Layout

Postranní panel 256px vlevo (na mobilu vysouvací zásuvka), hlavička 64px a obsah v kontejneru do 1280px s okrajem 16px (mobil) / 24px (od 640px). Obsah tvoří mřížky karet: KPI v řadách po 2–7, přehledy po 1–4 sloupcích. Rytmus stojí na 4px kroku; uvnitř karet převažují mezery 8–12px, mezi kartami 16–24px. Husté číselné dlaždice mají vnitřní okraj 12px, vnořené informační panely 16px; mezi sekcemi obrazovky je 24px, související bloky (např. řady KPI) drží u sebe 12–16px. Spodní okraj 64px patří rámci aplikace, ne jednotlivým obrazovkám. Řady se 7–8 dlaždicemi nebo filtry se plně rozkládají až od 1280px (xl), pod tím se lámou do 4 sloupců. Nastavení má od 1280px vpravo lepkavý obsah stránky se zvýrazněním aktuální sekce. Zlomy: 640px (sm), 768px (md, objeví se postranní panel), 1024px (lg, v hlavičce se ukáže popisek „Aktuální období“), 1280px (xl, text stavu synchronizace). Široké tabulky se posouvají vodorovně ve vlastním kontejneru, stránka nikdy.

## Elevation & Depth

Hloubka je tonální, stín jen podporuje. Ve světlém vzhledu leží bílé karty na světlém plátně s jemným stínem; v tmavém je karta o stupeň světlejší než plátno a výplň o další stupeň. Výraznější stín mají jen plovoucí vrstvy.

### Shadow Vocabulary
- **Karta** (`box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05)`): karty, segmentové volby, sekundární tlačítka.
- **Plovoucí nabídka** (`box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)`): rozbalovací menu, toasty, bubliny grafů (povrch s linkou v obou vzhledech).
- **Dialog** (`box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)`): modální okna nad ztmavujícím `scrim`.

### Named Rules
**The Scrim Rule.** Pozadí pod dialogem a mobilním menu vždy ztmavuje (token `scrim`), v obou vzhledech.

## Shapes

Měkké, ale ne nafouklé tvary: karty 16px, tlačítka, pole a segmentové přepínače 12px, malé ikonové akce a štítky 6–8px, tečky kategorií a avatary plně kulaté. Okraje jsou 1px vlasové linky; zaoblení se nikdy nekombinuje s barevným levým pruhem.

## Components

Každý opakovaný prvek má jeden recept jako třídu v `src/index.css` (`@layer components`). Nové místo použije třídu, nevymýšlí vlastní kombinaci; rozložení (šířka, flex, grid, mezery kolem) doplňuje místo použití utilitami.

### Buttons
- **Shape:** zaoblení 12px.
- **Primary (`btn-primary`):** pilotní modř s bílým textem, 12px bold, výška 32px (v liště dialogu 40px), na dotyku 44px; v tmavém vzhledu noční modř s tmavým textem. Zakázané tlačítko je šedé (výplň s vedlejším inkoustem), ne průhledné.
- **Danger (`btn-danger`):** stejný recept v červené pro nevratnou nebo mazací akci v dialogu.
- **Secondary (`btn-secondary`):** povrch s vlasovou linkou, vedlejší inkoust, 12px semibold, jemný stín, hover modrý text i okraj. Zrušit v dialozích, Stáhnout, Dnes, Synchronizovat nyní, akce na kartách. Světle barevné podklady tlačítek se nepoužívají.
- **Secondary danger (`btn-secondary btn-secondary-danger`):** vstup do mazání nebo odpojení (Smazat všechny položky / účty / kategorie, Odpojit Google Disk); červené až při najetí, nevratná červená akce je až v dialogu. Jen „Smazat všechna data“ má plné `btn-danger`.
- **Text (`btn-text`, `btn-text-danger`):** nejtišší úroveň akce (hlavní → vedlejší → textová), bez rámečku a podkladu, modrý text jako odkaz, při najetí podtržení; červená varianta pro nevratný únik (reset na chybové obrazovce). Zrušit filtry, Načíst znovu.
- **Hover / Focus:** hover o stupeň tmavší (ve tmavém světlejší); fokus klávesnicí modrý prstenec.
- **Icon actions (`btn-icon`):** 16px ikona bez rámečku, zaoblení 8px, v klidu vedlejší inkoust, na mobilu plocha 44×44px, vždy `aria-label` s názvem položky. Barva při najetí jen podle významu: `btn-icon-danger` smazat (červená), `btn-icon-archive` archivovat (jantar), `btn-icon-restore` obnovit nebo přidat (modrá), ostatní tmavě šedá.
- **Popisky:** tlačítko pro přidání se jmenuje stejně jako dialog, který otevře („Nová položka“, „Nový účet“, „Nová kategorie“).

### Chips
- **Tvar (`chip`):** zaoblení 6px, 12px medium, bez rámečku, barva jen podle významu: šedá (pořadí, počty, Archivovaný, Korekce, účet), červená (konflikt, v mínusu), modrá (Dnes, Aktuální), fialová (majetek), jantar (plánováno). Plně kulaté jsou jen tečky kategorií.
- **Stav:** „Plánovaná“ jantarový nádech s jantarovým textem, „Uskutečněná“ zelený, „Zrušená“ šedý; štítek je zároveň tlačítko pro změnu stavu a má stejný tvar jako `chip`.
- **Součet** se neukazuje jako štítek, ale jako tučné číslo barevné podle znaménka.

### Segmented controls
- **Recept (`segmented` + `segment`):** podklad výplň, 4px vnitřní okraj a mezera, volba 12px semibold, celková výška 32px (na dotyku 52px). Vybraná volba (`aria-pressed="true"`) je povrch se stínem; barvu má jen podle významu (výdaj červeně, příjem zeleně, celkový majetek fialově), jinak inkoust.

### Panels
- **Recept (`panel` + `panel-error` / `panel-warning` / `panel-info`):** odsazení 12px, zaoblení 12px, 1px linka, 12px text. Chyba červená, varování jantarová, informace modrá. Ikona vlevo (`flex items-start gap-2.5`) nebo skládaný obsah (`space-y-2`) doplní místo použití.

### Cards / Containers
- **Corner Style:** 16px.
- **Background:** povrch; zapuštěné panely uvnitř karty plátno.
- **Shadow Strategy:** stín Karta.
- **Border:** 1px vlasová linka.
- **Internal Padding:** 20px všude (třídy `card` + `p-5`), mezery uvnitř 16px. Karta s tabulkou má záhlaví `card-header` (20px do stran, 16px nahoru a dolů, linka pod ním).

### Dialogs
- **Structure:** pevná hlavička, posouvající se obsah a akční lišta `ModalFooter` přilepená ke spodnímu okraji; dialog se vždy vejde do viditelné výšky (okraj 16px, od 640px 24px) a nikdy se neposouvá dvakrát.
- **Spacing:** vnitřní okraj 20px na mobilu, 24px od 640px; pole 16px od sebe, 24px nad akční lištou.
- **Fields & actions:** pole i tlačítka v liště mají 40px, na dotyku 44px; na úzkém mobilu se tlačítka roztáhnou na šířku lišty.

### Inputs / Fields
- **Style:** povrch, 1px linka, zaoblení 12px, text 14px.
- **Focus:** okraj do modré a jemná modrá aura.
- **Error / Disabled:** chyba červeným okrajem a textem pod polem; zakázané pole na plátně s vedlejším inkoustem.

### Navigation
- **Style:** svislý seznam v postranním panelu, 12px semibold s ikonou 16px; aktivní položka modrý nádech a hluboká modř, `aria-current="page"`. Na mobilu zásuvka nad ztmavením, zavíraná křížkem nebo klepnutím mimo.

### Interaction rules
- **Mazání a archivace:** každá jednotlivá vratná akce (smazat položku, korekci, tržní hodnotu, poplatek, nepoužitý účet nebo kategorii; archivovat účet nebo kategorii) proběhne hned a oznámení nabídne „Vrátit“ (8 s, při najetí či fokusu se odpočet zastaví, Ctrl/⌘+Z). Dialog jen tam, kde je potřeba něco vybrat nebo vysvětlit: rozsah pravidelné položky, hromadné mazání, archivace výchozího účtu, smazání použitého účtu nebo kategorie (nabídne archivaci).
- **Název položky** v seznamech je vždy odkaz na její úpravu (u korekce na detail).
- **Oznámení** o jedné věci říká typ a název („Účet „Spoření“ byl archivován.“); věc bez názvu se pojmenuje datem nebo částkou. Vždy „smazat“, nikdy „odstranit“.

### Rozpočtová karta (signature)
Hlavní KPI karta: popisek velkými písmeny 12px, pod ním částka 24px extrabold v tabulkových číslicích, barevná jen když nese význam (příjem, výdaj, investice).

## Do's and Don'ts

### Do:
- **Do** používej Tailwind třídy palety a tokeny `scrim` a `table-*`; nové barevné role přidávej do `src/theme.css` pro oba vzhledy současně.
- **Do** ověř každý nový text v obou vzhledech na kontrast alespoň 4,5:1.
- **Do** drž text na 12px a výš; důležitost odlišuj řezem a barvou.
- **Do** dávej částkám tabulkové číslice a zarovnání vpravo.
- **Do** ikonovým tlačítkům na mobilu 44px plochu a `aria-label` s názvem položky.
- **Do** respektuj `prefers-reduced-motion`: pohyb mizí, změna stavu zůstává.

### Don't:
- **Don't** zapisuj hex barvy do komponent (kromě barev kategorií, sérií grafů a loga Google).
- **Don't** používej `bg-slate-900` a podobné pro ztmavení pozadí; v tmavém vzhledu se otočí do světla – použij `scrim`.
- **Don't** používej barvu jako dekoraci nebo jediný nosič informace; stav má i text nebo ikonu.
- **Don't** vnořuj karty do karet a nepřidávej barevné levé pruhy.
- **Don't** zmenšuj text pod 12px ani v hustých tabulkách a grafech.
