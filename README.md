# CashPilot – Osobní finance a 12měsíční forecast zůstatků

Kompletní webová aplikace pro správu osobního rozpočtu a precizní výhled budoucího vývoje financí na 12 měsíců dopředu.

---

## 📋 Systémové požadavky

Pro spuštění a běh aplikace potřebujete pouze:
* **Operační systém:** Windows 10 nebo 11 (aplikaci lze spustit i na macOS nebo Linuxu).
* **Běhové prostředí Node.js:** Verze **18.0.0 nebo novější** (doporučena stabilní verze LTS).
  * Pokud Node.js ještě nemáte, stáhněte si bezplatný instalátor z [nodejs.org](https://nodejs.org/).
* **Webový prohlížeč:** Jakýkoliv moderní prohlížeč (Google Chrome, Microsoft Edge, Mozilla Firefox, Brave, Safari).
* **Připojení k internetu:** Vyžadováno **pouze při prvním spuštění**, kdy se stáhnou potřebné knihovny. Poté aplikace funguje zcela offline.

---

## 🚀 Jak aplikaci spustit

### A. Běžné spuštění ve Windows (Doporučeno)
Aplikaci můžete snadno spustit **pouhým dvojklikem na soubor `start.bat`** v kořenové složce projektu.

Nemusíte otevírat terminál ani zadávat žádné příkazy:
1. V Průzkumníku Windows poklepejte na **`start.bat`**.
2. Skript automaticky provede:
   - Ověření přítomnosti Node.js.
   - Při prvním spuštění automaticky nainstaluje všechny potřebné knihovny (`npm install`). Při dalších spuštěních tento krok přeskočí a start je okamžitý.
   - Zkontroluje dostupnost výchozího portu `3000`. Pokud by byl port obsazen jinou aplikací, vybere nejbližší volný port (např. `3001`).
   - Nastartuje aplikační server a počká, dokud server skutečně neodpoví HTTP kódem 200.
   - **Automaticky otevře aplikaci ve vašem výchozím internetovém prohlížeči** (např. `http://localhost:3000/`).
3. Okno konzole ponechte během práce s aplikací otevřené.

### B. Alternativní spuštění přes příkazový řádek (pro vývojáře)
Pokud preferujete práci v terminálu:
```bash
# 1. Instalace závislostí (pouze poprvé)
npm install

# 2. Spuštění vývojového serveru
npm run dev

# 3. Spuštění s automatickým otevřením a health checkem
npm start

# 4. Spuštění 20 integračních a jednotkových testů
npm test

# 5. Produkční sestavení aplikace
npm run build
```

---

## 💾 Kde a jak jsou uložena data

* **100% soukromí a lokální úložiště:** Aplikace běží zcela lokálně na vašem počítači. Žádná vaše finanční data, částky ani účty se neposílají na žádný vzdálený cloud ani cizí server.
* **Místo uložení:** Data jsou bezpečně ukládána v perzistentním úložišti vašeho webového prohlížeče (`localStorage` pro doménu `http://localhost:3000`).
* **Trvalost dat:** Data zůstávají uložena i po zavření prohlížeče, restartu počítače nebo aktualizaci aplikace.

---

## 🔒 Jak vytvořit a obnovit zálohu

Doporučujeme pravidelně vytvářet zálohu vašich dat do souboru, zejména před čištěním mezipaměti prohlížeče nebo reinstalací systému:

### Vytvoření zálohy:
1. V levém navigačním menu aplikace klikněte na položku **Nastavení**.
2. Přejděte do sekce **Zálohování a obnova dat**.
3. Klikněte na tlačítko **Exportovat data do souboru JSON**.
4. Prohlížeč stáhne soubor se zálohou (např. `cashpilot-backup-2026-09-12.json`), který obsahuje všechny vaše účty, kategorie, položky rozpočtu a nastavení. Tento soubor si bezpečně uložte (např. na externí disk nebo zabezpečený cloud).

### Obnovení dat ze zálohy:
1. V aplikaci přejděte do **Nastavení** -> **Zálohování a obnova dat**.
2. V části *Obnovení ze souboru* klikněte na **Vybrat zálohu (.json)** a zvolte dříve stažený soubor.
3. Potvrďte obnovení tlačítkem **Obnovit data ze zálohy**. Aplikace okamžitě nahradí stávající data obsahem ze souboru a obnoví kompletní stav rozpočtu.

---

## 🛑 Jak aplikaci bezpečně ukončit

1. Ve webovém prohlížeči můžete záložku s aplikací CashPilot kdykoliv jednoduše zavřít. Veškeré zadané změny se ukládají v reálném čase ihned po jejich zadání.
2. V černém okně konzole (ve kterém běží `start.bat`):
   - Stiskněte klávesovou zkratku **`Ctrl + C`**, nebo
   - Jednoduše **zavřete okno křížkem** v pravém horním rohu.
3. Server CashPilot se korektně zastaví a uvolní síťový port.

---

## ✨ Klíčové funkce aplikace

- **100% v češtině**: Měna Kč, české formátování (`125 400 Kč`), formát data (`15. 9. 2026`), české názvy měsíců a kategorií.
- **Bezpečné finanční výpočty (Integer haléře)**: Vyloučení jakýchkoliv zaokrouhlovacích chyb běžného formátu plovoucí řádové čárky (IEEE 754 float).
- **Základní pravidlo kontinuity**: `Počáteční stav dalšího měsíce = konečný stav předchozího měsíce`.
- **Pořadí položek v rámci dne (Sequence)**:
  - Podpora pole `sequence` s rozestupy `10, 20, 30...`.
  - Řazení položek v rámci stejného dne přetažením myší (**Drag & Drop**).
  - Výpočet okamžitého průběžného zůstatku účtu po každé položce a varování při dočasném propadu účtu do mínusu.
- **Přizpůsobitelný rozpočtový měsíc**: Výchozí počátek 15. den v měsíci (např. 15. 9. 2026 – 14. 10. 2026).
- **12měsíční forecast likvidity**: Plynulý graf a matice účtů s rozlišením použitelných provozních peněz a celkového majetku.
- **Transparentní korekce**: Funkce „Aktualizovat skutečný stav“ porovná stav s bankou a zaeviduje jasnou účetní korekci.
- **20 automatických integračních testů**: Pokrývajících veškerou finanční logiku, přelomy roků, výjimky i sekvenční řazení.
