# Syntaxprüfung

Die Prüfung läuft beim Tippen oder beim Speichern, einstellbar über `fanucLs.validation.run`. Fehler erscheinen als Wellenlinie im Editor, in der Scrollleiste und in der Ansicht **Probleme** (`Strg+Umschalt+M`).

![Probleme-Ansicht mit Meldungen](images/02-syntaxpruefung.png)

Beim Überfahren mit der Maus erscheint die Meldung als Hover, darunter ein Link zum Quick Fix:

![Hover mit Meldung](images/04-diagnose-hover.png)

## Prüfregeln

**Struktur**
- fehlende Abschnitte `/PROG`, `/ATTR`, `/MN`, `/END`
- Programmname vorhanden, gültige Zeichen, maximal 36 Zeichen
- Programmname im Header gegen den Dateinamen *(abschaltbar: `checkProgramName`)*
- `LINE_COUNT` gegen die tatsächliche Zeilenzahl *(`checkLineCount`)*

**Zeilen**
- lückenlos fortlaufende Nummerierung im `/MN`-Block *(`checkLineNumbers`)*
- fehlendes `;` am Zeilenende
- unausgeglichene Klammern
- optional: strenges Zeilenformat *(`checkLineFormat`, standardmäßig aus)*

**Bewegungsbefehle** *(`checkMotion`)*
- `J` mit anderer Einheit als `%`, Bahnbewegung (`L`, `C`, `A`) mit `%`
- Achsgeschwindigkeit über 100 %
- Bahngeschwindigkeit über der Warnschwelle `maxLinearSpeed` (Standard 2000 mm/sec)
- fehlende Überschleifart, `CNT` größer 100

**Referenzen**
- `P[n]` verwendet, aber nicht im `/POS`-Block definiert; doppelt definiert; nie verwendet (ausgegraut) *(`checkPositions`, `reportUnusedPositions`)*
- Positionen gegen `DEFAULT_GROUP`: fehlende oder überzählige Bewegungsgruppen, uneinheitliche externe Achsen, siehe [[Bewegungsgruppen und externe Achsen]] *(`checkGroups`)*
- `LBL[n]` undefiniert, doppelt oder nie angesprungen *(`checkLabels`)*
- `IF … THEN` ohne `ENDIF`, `FOR` ohne `ENDFOR`, `ELSE` ohne `IF`
- `CALL`/`RUN` auf ein Programm, das **auf der Steuerung** (`md:`) nicht vorhanden ist (Warnung). Die Programmliste wird im Hintergrund per FTP geladen und 5 Minuten zwischengespeichert; geprüft wird gegen den Controller, von dem die Datei stammt (Download, Öffnen oder [[Klon|Controller-und-FTP#controller-klonen]]), oder gegen alle Controller *(`checkCallTargetsOnController`)*
- ohne Programmliste einer Steuerung: `CALL`/`RUN` auf ein Programm ohne passende Datei im Workspace. Das ist nur ein Hinweis *(`checkCallTargets`)*
- Register- und E/A-Indizes außerhalb der Bereiche aus `fanucLs.validation.limits` (auch mehrere Bereiche wie `"1-512, 6001-7000"`), Index `0`; Signale aus einer importierten [[E/A-Liste|Ein-und-Ausgänge]] gelten als gültig
- `UTOOL_NUM` außerhalb 1–10, `UFRAME_NUM` außerhalb 0–10

Jede Regel lässt sich unter [[Einstellungen]] einzeln abschalten.

## Quick Fixes

Cursor auf die markierte Stelle setzen und `Strg+.` drücken (oder auf die Glühbirne klicken):

![Quick-Fix-Menü](images/03-quickfix.png)

| Quick Fix | Wirkung |
|---|---|
| Zeilennummern neu nummerieren | nummeriert `/MN` durch, aktualisiert `LINE_COUNT` und `MODIFIED` |
| LINE_COUNT korrigieren | setzt `LINE_COUNT` auf die tatsächliche Zeilenzahl |
| Semikolon anfügen | ergänzt das fehlende `;` |
| Gültige Bereiche für … bearbeiten | erweitert die Bereiche in `fanucLs.validation.limits` um den passenden Block |
| P[n] im /POS-Block anlegen | legt die fehlende Position mit passenden Gruppen und Achsen an (Werte 0, zum Teachen) |
| GPx ergänzen / entfernen / (de)aktivieren | gleicht Positionen und `DEFAULT_GROUP` ab |

## Grenzwerte an die Steuerung anpassen

Die gültigen Bereiche je Typ stehen in `fanucLs.validation.limits`. Eine Zahl `n` bedeutet `1..n`, `0` schaltet die Prüfung ab, mehrere Bereiche als Text:

```jsonc
"fanucLs.validation.limits": {
  "R": 200, "PR": 100, "DI": "1-512, 4001-5000", "DO": "1-512, 6001-7000", "F": 1024
}
```

Siehe auch [[Ein und Ausgänge]].

Nicht aufgeführte Typen behalten ihren Standardwert.
