# Synchronizace CashPilot v2

## Změna chování

Přítomnost záznamu v lokální cache není důkaz offline změny. Do aktuálního cloudu se přehrává pouze trvale uložená fronta operací. Všechny lokální změny procházejí jedním zápisem dat a fronty do localStorage před aktualizací React stavu. Rozdíl kolekcí zaznamenává také hromadná a navázaná smazání.

Datový formát 2 přidává `deletions`, `sync` a volitelný `resetMarker`. Tombstones se nečistí. Při shodném čase vyhrává smazání; novější úprava může záznam obnovit. Reset zavádí novou identitu epochy a blokuje operace starých instancí nezávisle na jejich hodinách. Při úpravách se zohledňuje také pozorovaná cloudová revize, při souběžném zápisu ETag.

`SyncController` obsluhuje úvodní načítání, ruční synchronizaci, debounce i návrat připojení. Změny během uploadu zůstanou ve frontě do dalšího průchodu. Ukončení relace ruší časovač a síťové požadavky; nepotvrzené operace zůstávají uložené. Token je svázaný s ověřenou identitou aktuální relace.

Cache, fronta, file ID a poslední potvrzená revize jsou v obálce `cashpilot_sync_v2:<Google permissionId>`. Stabilní náhodné ID zařízení je v `cashpilot_device_id_v2`. Při zjištěné změně stejné obálky jinou kartou se zápis zastaví s chybou a požadavkem na obnovení stránky.

## Cloudový protokol

Před každým uploadem se znovu vyhledá soubor v privátním `appDataFolder`, přečtou jeho metadata a obsah a ověří se, že se během čtení nezměnil. Nejednoznačný nebo neúplný seznam souborů upload zastaví. Ztráta dříve známého souboru také vyvolá chybu.

Metadata se čtou přes Drive API v2, které poskytuje ETag v JSON. Aktualizace používá v2 multipart `PUT` s `If-Match`; vytvoření nového souboru a záloh používá v3. Silný ETag je povinný. Slepý přepis ani kontrola samotného času poslední změny se nepoužívá. HTTP 412 opakuje stažení a sloučení, nejvýše ve třech pokusech. Po uploadu se znovu ověří kanonický soubor a jeho obsah, teprve potom se odstraní potvrzené operace z fronty.

Podklady API: [v2 metadata a ETag](https://developers.google.com/workspace/drive/api/reference/rest/v2/files), [v2 files.update](https://developers.google.com/workspace/drive/api/reference/rest/v2/files/update), [rozdíly v2 a v3](https://developers.google.com/workspace/drive/api/guides/v2-to-v3-reference).

## Migrace a zálohy

Před první migrací cloudového souboru vznikne úplná samostatná JSON kopie v `appDataFolder` s názvem `cashpilot_backup_before_sync_v2_<fileId>_<čas>.json` a lokální kopie pod klíčem účtu. Selhání zálohy zastaví migraci. Staré lokální úložiště se zachovává v původním klíči a v `cashpilot_legacy_cache_before_sync_v2`.

Starou cache bez ověřeného vlastníka a bez fronty nelze bezpečně označit za neodeslané změny. Automaticky se nepřimíchává do Google účtu. Zůstává zachovaná pro výslovnou obnovu/export. Již obnovené položky se nerozpoznávají podle názvů ani automaticky nemažou.

Migrace zachovává finanční kolekce včetně dříve automaticky odstraňovaných korekcí a snímků. Neopravuje pořadí nebo výchozí příznaky účtů. Historická kompatibilita názvu nastavení kontokorentu zůstává zachovaná. Finanční výpočty, období a pravidla generování opakovaných plateb se nemění.

## Ověření

- Výchozí stav: 415 testů prošlo.
- Opravený stav: 449 testů v 31 souborech prošlo. Původní testy očekávající implicitní offline změny nyní používají explicitní operace; test přihlášení čeká na cloud a migrační test zachovává původní příznaky účtů.
- `npm run test:sync-origins`: skutečný Chrome a dvě oddělené origins `http://127.0.0.1:4173` a `http://127.0.0.1:4174`, se syntetickým Google API. Ověřeno blokování editace při načítání, neobnovení smazané položky, nová kategorie, zavření před debounce, souběžné úpravy, opakování HTTP 412 a React StrictMode.
- Pro prohlížečový test je potřeba balíček `playwright` a Chrome. Volitelně lze nastavit `PLAYWRIGHT_MODULE` na instalovaný modul a `BROWSER_CHANNEL` na jiný dostupný kanál.

**Test se skutečným testovacím Google účtem a nasazením na Vercelu nebyl proveden.** Je potřeba ověřit skutečné oprávnění `drive.appdata`, ETag a v2 podmíněný upload v cílovém OAuth projektu. Mockované API tento integrační krok nenahrazuje.

## Nasazení a ruční ověření

1. Použít vyhrazený testovací Google účet a nasadit stejný opravený kód na testovací Vercel origin i localhost. Exportovat aktuální testovací JSON před testem.
2. Na první instanci vytvořit a smazat položky, vytvořit kategorii a počkat na stav Synchronizováno. Druhá instance se starší cache nesmí smazané položky obnovit.
3. Prověřit změny offline, zavření před uploadem, souběžné změny, reset, odhlášení a přihlášení jiným účtem. Zkontrolovat uložené tombstones, revize a vyprázdnění potvrzené fronty.
4. Prověřit, že skutečně zastaralý ETag vyvolá 412 a že při chybě zůstávají operace uložené. Pokud prostředí podmíněný zápis nepodporuje, opravu do produkce neuvolnit bez dalšího řešení souběhu.
5. Produkční opravu zavést na všechny používané origins a zavřít staré verze. Starý klient neumí zachovat nová metadata. Teprve potom ručně odstranit dříve nechtěně obnovené položky.

Produkční data ani cloudový soubor nebyly při vývoji nebo testování měněny.
