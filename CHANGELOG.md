# Änderungen

## Unveröffentlicht

- Programmnamen dürfen Ziffern enthalten, auch am Anfang (#3)
- Vergleich lokale Datei ↔ Controller im Diff-Editor, in beide Richtungen (#8)
- Controller klonen: Geräte in einen Ordner laden, Änderungen anzeigen und gezielt zurückübertragen, mit Konfliktprüfung gegen Änderungen auf der Steuerung (#10)
- CALL/RUN-Ziele werden im Hintergrund gegen die Programmliste der Steuerung geprüft (`fanucLs.validation.checkCallTargetsOnController`) (#9)
- Sprungmarken: eigene Ansicht mit Sprüngen je Label, Einfügen, Kommentar bearbeiten, Nummer ändern, alle neu nummerieren; im Editor Gehe zu Definition, Verweise, Umbenennen (F2), Hover, Hervorhebung, Vervollständigung (#7)
- Positionen werden gegen `DEFAULT_GROUP` geprüft (fehlende/überzählige Gruppen, uneinheitliche externe Achsen) mit Quick Fixes (#4)
- Befehle: externe Achse hinzufügen/entfernen, Bewegungsgruppe hinzufügen/entfernen, Position anlegen (auch als Quick Fix für nicht definierte P[n]) (#5)
- E/A-Verwaltung: Ansicht E/A mit Kommentaren aus Programmen, Import vom Controller (z. B. `md:IOSTATE.DG`) und aus CSV, Export als CSV, Hover und Vervollständigung mit Kommentar (#1)
- Gültige Bereiche je Typ (`"DO": "1-512, 6001-7000"`) mit Quick Fix; importierte Signale gelten als gültig; gespeicherter Status wie `ON :` wird im Editor ausgeblendet oder per Befehl entfernt (#2)
- KAREL (`.kl`): Syntaxhighlighting, Outline, Einrückung/Faltung, Snippets, Kompilieren mit ktrans (`fanucLs.karel.ktransPath`) (#6)
- Bewegungsgruppe spiegeln: eine Gruppe isoliert spiegeln – kartesisch an XZ-/YZ-Ebene mit Versatz (Orientierung wird umgerechnet), Achswerte und externe Achsen um wählbare Mittelwerte; als neues Programm oder in der Datei; Bericht mit Prüfhinweisen
- Dateien in einem Klon kennen ihre Herkunft auch ohne gemerkten Download (Upload, Vergleich, CALL-Prüfung)

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
