# FANUC TP (LS) — VS Code Extension

Unterstützung für FANUC-TP-Programme im ASCII-Listing-Format (`.ls`): Syntaxhighlighting, Snippets, Syntaxprüfung und ein Sidepanel für den FTP-Dateitransfer zur Robotersteuerung.

Alles greift automatisch, sobald eine Datei mit der Endung `.ls` geöffnet wird. Zusätzlich erkennt VS Code auch Dateien ohne passende Endung, wenn die erste Zeile mit `/PROG` beginnt.

---

## Installation

```bash
npm install
npm run compile
```

Zum Ausprobieren `F5` drücken — es öffnet sich ein zweites VS-Code-Fenster mit geladener Extension. Zum Installieren ein VSIX bauen:

```bash
npm run package        # nutzt das lokal installierte @vscode/vsce (Node >= 22)
code --install-extension fanuc-ls-0.2.0.vsix
```

### Automatischer Build (GitHub Actions)

Die Pipeline `.github/workflows/build.yml` baut bei jedem Push auf `main`, bei Pull Requests und manuell (*Actions → Build VSIX → Run workflow*) ein VSIX und hängt es als Artefakt `fanuc-ls-vsix` an den Workflow-Lauf. Ein GitHub-Release mit dem VSIX entsteht entweder durch Push eines Tags `v*` (z. B. `git tag v0.2.0 && git push origin v0.2.0`; der Tag muss zur Version in `package.json` passen) oder durch manuellen Start des Workflows mit Häkchen bei *release* — dann wird der Tag `v<version>` aus `package.json` automatisch angelegt. Vor jedem neuen Release die `version` in `package.json` erhöhen.

Im Ordner `examples/` liegt ein vollständiges Beispielprogramm zum Testen.

---

## Funktionsumfang

### 1. Syntaxhighlighting

Eigene TextMate-Grammatik (`syntaxes/fanuc-ls.tmLanguage.json`) mit eigenen Scopes für:

| Element | Scope |
|---|---|
| Abschnitte `/PROG` `/ATTR` `/APPL` `/MN` `/POS` `/END` | `keyword.control.section.fanuc` |
| Programmname | `entity.name.function.program.fanuc` |
| Zeilennummern | `constant.numeric.line.fanuc` |
| Bewegungsart `J` `L` `C` `A` | `keyword.control.motion.fanuc` |
| Geschwindigkeit + Einheit | `constant.numeric` / `keyword.other.unit.fanuc` |
| Überschleifen `FINE` / `CNTn` / `CD` | `constant.language.termination.fanuc` |
| Bewegungsoptionen `ACCn`, `Offset,`, `Skip,`, `TB`, `DB`, `PTH`, `Wjnt` … | `storage.modifier.motion-option.fanuc` |
| Schweißbefehle `Arc Start`, `Weld End`, `Weave Sine` … | `support.function.weld.fanuc` |
| E/A `DI` `DO` `RI` `RO` `GI` `GO` `AI` `AO` `UI` `UO` `F` `M` | `support.variable.io.fanuc` |
| Register `R` `PR` `AR` `SR` `VR` `TIMER` | `support.variable.register.fanuc` |
| Positionen `P[..]` | `support.variable.position.fanuc` |
| Sprungmarken `LBL[..]` | `entity.name.label.fanuc` |
| Systemvariablen `$…` | `variable.language.sysvar.fanuc` |
| Bemerkungen `!…` | `comment.line.remark.fanuc` |

Der `/POS`-Block bekommt einen eigenen Kontext, damit `P` und `R` dort als Koordinatenkomponenten und nicht als Position bzw. Register eingefärbt werden.

Zusätzlich: Outline-Ansicht (Programm → Abschnitte → Labels und Positionen), Faltung über die Abschnitte, Einrückungsregeln für `IF … THEN` / `ENDIF` und `FOR` / `ENDFOR`.

### 2. Snippets

48 Snippets, u. a.:

| Prefix | Ergebnis |
|---|---|
| `prog` | komplettes LS-Gerüst mit ATTR-Block und aktuellem Zeitstempel |
| `pos` / `posj` | Positionsdatensatz kartesisch bzw. in Achswerten |
| `j` `l` `c` `a` | Bewegungsbefehle mit Auswahlliste für FINE/CNT |
| `loffset` `lskip` `ltb` `lpr` | Bewegung mit Offset, Skip-Bedingung, Time-Before, Positionsregister |
| `if` `ifblock` `ifelse` `select` `for` | Verzweigungen und Schleifen |
| `lbl` `lbln` `jmp` `call` `callarg` `end` | Sprungmarken und Programmaufrufe |
| `waitdi` `waitto` `waittime` | Warteanweisungen inkl. Timeout-Sprung |
| `do` `pulse` `go` `r` `pr` `prel` | E/A und Register |
| `utool` `uframe` `payload` `ovr` | Werkzeug, Koordinatensystem, Nutzlast, Override |
| `arcstart` `arcend` `weldstart` `weldend` `weave` | Schweiß- und Pendelbefehle |
| `seam` | kompletter Baustein Anfahren → Schweißen → Freifahren |
| `msg` `ualm` `timer` `col` `pause` | Meldungen, Alarme, Timer, Kollisionserkennung |

### 3. Syntaxprüfung

Läuft beim Tippen (entprellt) oder erst beim Speichern — einstellbar über `fanucLs.validation.run`. Geprüft wird:

**Struktur**
- fehlende Abschnitte `/PROG`, `/ATTR`, `/MN`, `/END`
- Programmname vorhanden, gültige Zeichen, maximal 36 Zeichen
- Programmname im Header gegen den Dateinamen
- `LINE_COUNT` aus dem `/ATTR`-Block gegen die tatsächliche Zeilenzahl

**Zeilen**
- lückenlos fortlaufende Nummerierung im `/MN`-Block
- fehlendes `;` am Zeilenende
- unausgeglichene Klammern
- optional: strenges Zeilenformat (4-stellige rechtsbündige Nummer, zwei Leerzeichen nach dem Doppelpunkt bei Nicht-Bewegungsbefehlen)

**Bewegungsbefehle**
- `J` mit anderer Einheit als `%`, Bahnbewegung mit `%`
- Achsgeschwindigkeit über 100 %
- Bahngeschwindigkeit über einer konfigurierbaren Warnschwelle
- fehlende Überschleifart, `CNT` größer 100

**Referenzen**
- `P[n]` verwendet, aber im `/POS`-Block nicht definiert
- `P[n]` doppelt definiert
- `P[n]` definiert, aber nie verwendet (Hinweis, wird ausgegraut)
- `LBL[n]` undefiniert, doppelt oder nie angesprungen
- `IF … THEN` ohne `ENDIF`, `FOR` ohne `ENDFOR`, `ELSE` ohne `IF`
- `CALL`/`RUN` auf ein Programm, zu dem es im Workspace keine Datei gibt (nur Hinweis — auf der Steuerung kann es trotzdem existieren)
- Registerindizes über den konfigurierten Obergrenzen, Index `0`
- `UTOOL_NUM` außerhalb 1–10, `UFRAME_NUM` außerhalb 0–10

**Quick Fixes** (Glühbirne bzw. `Strg+.`)
- Zeilennummern neu nummerieren (aktualisiert auch `LINE_COUNT` und `MODIFIED`)
- `LINE_COUNT` korrigieren
- fehlendes Semikolon anfügen

Jede Regel lässt sich einzeln abschalten, die Grenzwerte pro Registertyp stehen unter `fanucLs.validation.limits` und sollten an die jeweilige Steuerungskonfiguration angepasst werden.

### 4. Sidepanel mit FTP-Zugriff

Eigenes Icon in der Activity Bar. Baum: **Controller → Gerät (`md:`, `fr:`, `mc:`, `ud1:`) → Dateien**.

- Klick auf eine Datei lädt sie in ein temporäres Verzeichnis und öffnet sie im Editor
- `Herunterladen` legt sie im Workspace ab (Standard: Unterordner `fanuc/`)
- `Ganzes Gerät sichern` zieht alle Dateien eines Geräts in einen Ordner — praktisch als Schnellsicherung vor Änderungen
- `Datei hierher laden` bzw. der Wolken-Button in der Editor-Titelleiste lädt zurück auf die Steuerung
- Die Herkunft einer heruntergeladenen Datei wird gemerkt: beim Upload wird der ursprüngliche Pfad als Ziel vorgeschlagen
- Vor dem Upload läuft optional die Syntaxprüfung; bei Fehlern kommt eine Rückfrage
- Passwörter liegen im `SecretStorage` von VS Code, nicht in `settings.json`
- Pro Steuerung wird immer nur eine FTP-Verbindung gleichzeitig aufgebaut, weil FANUC-Steuerungen nur sehr wenige Sitzungen zulassen
- `FANUC: FTP-Protokoll anzeigen` öffnet das Protokoll für die Fehlersuche (vorher `fanucLs.ftp.verbose` einschalten)

### 5. Zeilennummern automatisch verwalten

Die Nummerierung im `/MN`-Block wird gepflegt, ohne dass man sie von Hand mitzählt:

- **Beim Tippen:** Sobald im `/MN`-Block eine neue Zeile begonnen wird, setzt die Extension die nächste Nummer und nummeriert alles darunter nach. `LINE_COUNT` zieht mit. Läuft über `editor.formatOnType`, gehört also zum normalen Undo-Schritt.
- **Dokument formatieren** (`Umschalt+Alt+F`) nummeriert den ganzen Block durch. Das ist auch der Weg, um mehrzeilige Snippets wie `ifblock` oder `seam` nachträglich zu nummerieren — die kommen naturgemäß ohne Nummern ins Dokument.
- **Beim Speichern:** dafür in den Einstellungen `"editor.formatOnSave": true` für `[fanuc-ls]` setzen (steht auskommentiert bereits als Voreinstellung auf `false`).
- **Befehl** `FANUC: Zeilennummern neu nummerieren` macht dasselbe und aktualisiert zusätzlich `MODIFIED`.

Zwei Regeln, die dabei eingehalten werden:

- Fortsetzungszeilen bleiben unnummeriert. Steht die vorige Anweisung noch offen, weil das `;` fehlt — etwa der zweite Punkt einer Kreisbewegung —, bekommt die Folgezeile keine Nummer.
- Bewegungsbefehle stehen direkt hinter dem Doppelpunkt (`   7:L P[2] …`), alle anderen Anweisungen mit zwei Leerzeichen Abstand (`   8:  DO[1]=ON ;`). Bei neu vergebenen Nummern gilt das immer; bei bereits nummerierten Zeilen nur, wenn `fanucLs.format.normalizeSpacing` eingeschaltet ist.

Abschalten über `fanucLs.format.autoNumber`.

---

## Einstellungen

| Einstellung | Standard | Bedeutung |
|---|---|---|
| `fanucLs.controllers` | `[]` | Liste der Steuerungen (Name, Host, Port, Benutzer, Geräte) |
| `fanucLs.ftp.timeout` | `8000` | Timeout in ms |
| `fanucLs.ftp.verbose` | `false` | FTP-Protokoll mitschreiben |
| `fanucLs.ftp.downloadDirectory` | `""` | Zielordner für Downloads |
| `fanucLs.ftp.confirmUpload` | `true` | Rückfrage vor dem Überschreiben |
| `fanucLs.ftp.validateBeforeUpload` | `true` | Syntaxprüfung vor dem Upload |
| `fanucLs.validation.enable` | `true` | Prüfung insgesamt |
| `fanucLs.validation.run` | `onType` | `onType` oder `onSave` |
| `fanucLs.format.autoNumber` | `true` | Zeilennummer beim Zeilenumbruch automatisch setzen |
| `fanucLs.format.normalizeSpacing` | `false` | Abstand hinter dem Doppelpunkt vereinheitlichen |
| `fanucLs.validation.limits` | siehe `package.json` | Obergrenzen je Registertyp |
| `fanucLs.validation.maxLinearSpeed` | `2000` | Warnschwelle mm/sec |

Beispiel:

```jsonc
"fanucLs.controllers": [
  {
    "name": "R1 Schweißzelle",
    "host": "192.168.0.10",
    "port": 21,
    "user": "anonymous",
    "devices": ["md:", "fr:", "ud1:"]
  }
]
```

---

## Praxishinweise zur Steuerung

- **FTP aktivieren:** `MENU → SETUP → Host Comm → FTP`. Der FTP-Server der Steuerung hat nur wenige Verbindungs-Slots; hängt eine Sitzung, hilft meist ein Neustart des FTP-Servers im selben Menü.
- **Anmeldung:** Viele Steuerungen akzeptieren `anonymous` ohne Passwort. Ist ein Benutzer eingerichtet, gehört das Passwort über `FANUC: Passwort hinterlegen` in den SecretStorage.
- **Geräte:** `md:` ist der flüchtige Arbeitsspeicher (dort liegen die geladenen Programme), `fr:` der FROM-Speicher, `mc:` die Memory Card, `ud1:` ein USB-Stick. Die Liste je Controller ist frei konfigurierbar.
- **ASCII-Upload:** Ein `.ls` direkt nach `md:` zu schreiben, setzt die Option *ASCII Upload* (J537) voraus. Fehlt sie, kann das Listing nur abgelegt (z. B. auf `ud1:`) und über das Teach Pendant geladen werden — oder man arbeitet mit `.tp`-Binärdateien. Die Extension lädt die Datei unverändert hoch; welche Geräte die Steuerung akzeptiert, entscheidet sie selbst.
- **Zeilennummern:** Beim Bearbeiten im Texteditor verrutscht die Nummerierung schnell. `FANUC: Zeilennummern neu nummerieren` setzt sie fortlaufend und korrigiert `LINE_COUNT` und `MODIFIED` gleich mit. Vor jedem Upload einmal ausführen.
- **Zeilenenden:** LS-Dateien verwenden CRLF. Für `[fanuc-ls]` ist `files.eol` entsprechend voreingestellt, `trimTrailingWhitespace` ist bewusst aus, weil die Leerzeichen vor dem `;` zum Originalformat gehören.

---

## Projektstruktur

```
fanuc-ls/
├── package.json                      Manifest: Sprache, Grammatik, Snippets, Views, Befehle, Einstellungen
├── language-configuration.json       Kommentare, Klammern, Faltung, Einrückung
├── syntaxes/fanuc-ls.tmLanguage.json TextMate-Grammatik
├── snippets/fanuc-ls.json            48 Snippets
├── examples/SCHWEISS1.LS             Beispielprogramm
└── src/
    ├── extension.ts       Aktivierung, Trigger für die Prüfung
    ├── parser.ts          LS-Parser: Abschnitte, Attribute, TP-Zeilen, Positionen, Bewegungen
    ├── diagnostics.ts     alle Prüfregeln
    ├── quickfix.ts        Quick Fixes
    ├── edits.ts           Neunummerierung, LINE_COUNT, MODIFIED
    ├── format.ts          automatische Zeilennummern (on type, Dokument formatieren)
    ├── symbols.ts         Outline
    ├── config.ts          Controllerliste und Passwörter
    ├── ftp.ts             FTP-Zugriff (basic-ftp), eine Verbindung je Steuerung
    ├── controllerTree.ts  Sidepanel
    └── commands.ts        alle Befehle
```

## Naheliegende Erweiterungen

- `FileSystemProvider` für `fanuc://`, damit `Strg+S` direkt auf die Steuerung schreibt
- Gehe-zu-Definition von `CALL PROG` zur Datei und von `P[n]` in den `/POS`-Block
- Hover mit Koordinaten einer Position und mit dem Kommentar hinter `R[n]` (aus `numreg.vr`)
- Vergleich „Datei im Workspace ↔ Datei auf der Steuerung“ als Diff
- KAREL-Unterstützung (`.kl`) mit derselben Infrastruktur
