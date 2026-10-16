# Critique ignore list

Rozhodnutí autora (jediného uživatele). Nálezy, které odpovídají některé položce níže, kritika tiše vynechá a nenavrhuje je znovu. Seznam platí, dokud ho autor sám nezmění.

## Rozvržení a struktura
- Hlavička je na všech obrazovkách stejná: nic se v ní neskrývá ani nepřidává podle obrazovky. Text stavu synchronizace je až od 1280 px, pod tím stačí ikona.
- Měsíční rozpočet: struktura obrazovky zůstává. To platí pro 2 hlavní dlaždice + 7 + 7 dlaždic, jejich hierarchii a pořadí, řádky položek včetně „Zůstatek po položce“, pořadí #n a typografie řádku. Na hlavních dlaždicích nejsou popisky časového bodu („Na konci období“).
- Rozpočet je úvodní obrazovka i na telefonu; nemá jinou výchozí pozici posunu.
- Dnešní celkový majetek je jen v postranním panelu nebo mobilním menu, ne v mobilní hlavičce.
- Akce v řádcích (upravit, duplikovat, smazat, archivovat…) jsou vždy viditelná tlačítka, nikdy nabídka „…“. Rozložení ikon na kartě účtu na telefonu zůstává.
- Podkategorie v Kategoriích jsou řádky na podkladu plátna (není to karta v kartě).

## Texty a značka
- Podtitul „Vaše osobní finance pod kontrolou“ je na přihlášení dvakrát a v postranním panelu (závazek značky v PRODUCT.md).
- Bez uklidňujících textů o Google Disku na přihlášení a v dialozích mazání.
- Tlačítko „Zrušit“ v dialozích se nepřejmenovává.
- „Čistá změna“ (změna zůstatku včetně převodů) a „čistá bilance“ (příjmy − výdaje) jsou záměrně různé pojmy. „Průměrně ušetří“ v Mandatorních výdajích je záměrně jiný pojem než „Skutečně uspořeno“.
- Výnos na kartě investičního účtu nemá popisek „Výnos“.
- Popisky 14 běžných KPI dlaždic jsou v řezu Body, ne velkými písmeny (viz DESIGN.md).

## Vzhled
- Fokus polí: modrý okraj + aura 20 % (podle DESIGN.md), nezesilovat.
- Opisovaná fráze při smazání všech dat je neproporcionálním písmem.
- Jemné průsvitné podklady jsou záměrné: záporné řádky a řádky v konfliktu (bg-red-50/30, /60), dlaždice překročeného kontokorentu (/90), vybrané volby v RecurrenceScopePicker a StatusBadgeMenu, hover tlačítek v hlavičce. Plné jsou jen informační panely.
- Šipky pro posun položky v „Po dnech“ jsou na počítači 16 px vysoké.

## Funkce (záměrně nejsou)
- Import z banky, limity kategorií / plán vs. skutečnost, úvěrové účty, finanční cíle, štítky napříč kategoriemi.
- Hromadný výběr a hromadná změna stavu ve Všech položkách.
- Přehled klávesových zkratek (dialog „?“); zkratky stačí v title.
- Seznam „k revizi“ pro prošlé plánované položky: plánované položky s dnešním nebo starším datem se automaticky uskuteční.
