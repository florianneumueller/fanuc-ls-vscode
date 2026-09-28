# Änderungen

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
