# Änderungen

## Unveröffentlicht

- **Argument-Wizard (ARGDISP-Dateien, `.DT`)**: eigene Sprache mit Syntaxhighlighting, Syntaxprüfung nach FANUC-Handbuch (mit Zuordnung zu den Alarmen FILE-096…102), Quick Fixes, Outline, Snippets, Hover mit Vorschau des CALL am Teach Pendant
- CALL-Argumente in TP-Programmen werden gegen die ARGDISP-Beschreibung geprüft (Anzahl, V-/W-Werte, Typ), auch in der LS-Form `"Bedeutung"=Wert`; Hover auf `CALL` zeigt die Argumente
- Befehle: Argumente eines TP-Programms (verwendete `AR[n]`) als ARGDISP-Block anlegen, neue ARGDISP-Datei

## 0.4.0

Großes Funktions-Update: Arbeiten mit dem Controller als lokaler Klon, Verwaltung von Sprungmarken, E/A und Bewegungsgruppen, Spiegeln von Programmen und KAREL-Unterstützung. Ausführliche Beschreibungen mit Screenshots im [Wiki](https://github.com/frontline-networks/fanuc-ls-vscode/wiki).

### Neu

- **Controller klonen** (#10): Geräte einer Steuerung in einen Ordner laden, lokale Änderungen anzeigen und gezielt zurückübertragen. Dateien, die inzwischen am Teach Pendant geändert wurden, werden nicht überschrieben, sondern als Konflikt gemeldet.
- **Vergleich lokal ↔ Controller** (#8): Diff-Editor in beide Richtungen (Editor-Titelleiste bzw. Kontextmenü der Controller-Ansicht).
- **Sprungmarken-Editor** (#7): Ansicht „Sprungmarken“ mit allen Sprüngen je Label; Einfügen mit nächster freier Nummer, Kommentar bearbeiten, Nummer ändern, alle neu nummerieren. Im Editor: Gehe zu Definition (F12), Verweise, Umbenennen (F2), Hover, Hervorhebung, Vervollständigung.
- **E/A-Verwaltung** (#1, #2): Ansicht „E/A“ mit Kommentaren aus den Programmen, Import vom Controller (z. B. `md:IOSTATE.DG`) und aus CSV, Export als CSV; Hover und Vervollständigung mit Kommentar. Der im Text gespeicherte Status (`DO[6338:ON :…]`) wird ausgeblendet oder per Befehl entfernt.
- **Bewegungsgruppen und externe Achsen** (#4, #5): Positionen werden gegen `DEFAULT_GROUP` geprüft; Quick Fixes gleichen Positionen und Header ab. Befehle zum Hinzufügen/Entfernen von externen Achsen und Gruppen sowie zum Anlegen fehlender Positionen.
- **Bewegungsgruppe spiegeln**: eine Gruppe isoliert spiegeln, alle anderen bleiben unverändert – kartesisch an XZ-/YZ-Ebene mit Versatz (Orientierung wird mitgerechnet), Achswerte und externe Achsen um wählbare Mittelwerte; als neues Programm oder in der Datei, mit Prüfbericht.
- **KAREL** (#6): Sprache `.kl` mit Syntaxhighlighting, Outline, Einrückung/Faltung, 24 Snippets und Kompilieren über ktrans (ROBOGUIDE).

### Verbessert

- **CALL/RUN-Prüfung gegen die Steuerung** (#9): Die Programmliste von `md:` wird im Hintergrund geladen; fehlende Programme werden als Warnung gemeldet (`fanucLs.validation.checkCallTargetsOnController`).
- **Gültige Bereiche** statt nur Obergrenzen in `fanucLs.validation.limits`, z. B. `"DO": "1-512, 6001-7000"`, mit Quick Fix; Signale aus importierten E/A-Listen gelten als gültig.
- Dateien in einem Klon kennen ihre Herkunft auch ohne gemerkten Download (Upload, Vergleich, CALL-Prüfung).
- Neue Einstellungen: `fanucLs.clone.fileTypes`, `fanucLs.validation.checkGroups`, `fanucLs.io.hideStatus`, `fanucLs.karel.ktransPath`, `fanucLs.karel.ktransArgs`.

### Behoben

- Programmnamen mit Ziffern, auch am Anfang (`100_PICK`), werden nicht mehr als Fehler gemeldet und korrekt hervorgehoben (#3).

### Hinweise

- Neu erzeugte Achs-, Gruppen- und Positionswerte sind Platzhalter (0 bzw. „TEACH“), gespiegelte Positionen ungeprüft: vor dem Einsatz in T1 mit reduziertem Override testen.
- Nicht an echter Hardware geprüft: Aufbau von `IOSTATE.DG` (#2), LS-Format externer Achsen/zweiter Gruppen (#5), Aufruf von ktrans (#6). Rückmeldungen bitte in den jeweiligen Issues.

## 0.3.0

- GitHub-Copilot-Agent-Skill `fanuc-tp-programmierung` mit Befehlsreferenz, geprüften Beispielprogrammen, Programmvorlage sowie Format- und Sicherheitsregeln
- Der Skill wird mit der Extension installiert (`chatSkills`, VS Code ≥ 1.109) und ist über `fanucLs.copilot.skill` abschaltbar
- Dokumentation als GitHub-Wiki mit Screenshots

## 0.2.0

- Automatische Zeilennummern: beim Beginn einer neuen Zeile im `/MN`-Block wird die nächste Nummer gesetzt und der Rest nachnummeriert (`editor.formatOnType`)
- `Dokument formatieren` nummeriert den ganzen `/MN`-Block durch und vergibt Nummern auch an Zeilen, die noch keine haben — etwa aus mehrzeiligen Snippets
- Fortsetzungszeilen einer noch offenen Anweisung (zweiter Punkt einer Kreisbewegung) bleiben korrekt unnummeriert
- Neue Einstellungen `fanucLs.format.autoNumber` und `fanucLs.format.normalizeSpacing`
- Snippets `lbl`, `call`, `pos` und `prog` ohne verschachtelte Platzhalter; neu `lbln` und `callarg`

## 0.1.0

Erste Fassung.

- Syntaxhighlighting für `.ls` über eine eigene TextMate-Grammatik, inklusive eigenem Kontext für den `/POS`-Block
- 46 Snippets für TP-Befehle, Bewegungen, Verzweigungen und Schweißbefehle
- Syntaxprüfung: Abschnitte, Zeilennummern, `LINE_COUNT`, Semikolon, Klammern, Bewegungsparameter, Positionen, Sprungmarken, Blockstrukturen, Registerindizes, `CALL`-Ziele
- Quick Fixes für Neunummerierung, `LINE_COUNT` und fehlendes Semikolon
- Outline über Abschnitte, Labels und Positionen
- Sidepanel mit FTP-Zugriff auf die Steuerung: Durchsuchen, Öffnen, Herunterladen, Hochladen, Löschen, Gerätesicherung
- Passwörter im SecretStorage, eine FTP-Verbindung je Steuerung
