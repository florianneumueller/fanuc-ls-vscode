---
name: fanuc-tp-programmierung
description: Erstellen, Ändern, Prüfen und Erklären von FANUC-Roboterprogrammen im TP-ASCII-Listing-Format (.ls / .LS) – Bewegungen, Register, E/A, Sprünge, Schweißbefehle, /ATTR- und /POS-Block. Verwenden, wenn der Benutzer ein FANUC-TP-Programm, eine .ls-Datei, Teach-Pendant-Code, Roboterbewegungen (J/L/C-Befehle, P[n], PR[n]), Palettierung, Greifer-Logik oder Lichtbogenschweißen auf einer FANUC-Steuerung (R-30iA/R-30iB/R-30iB Plus) bearbeitet oder anfragt.
---

# FANUC-TP-Programmierung (.ls)

Dieser Skill beschreibt, wie Programme für FANUC-Robotersteuerungen im **ASCII-Listing-Format** (`.ls`) geschrieben werden. Genau dieses Format lädt die Steuerung per *ASCII Upload* und liest die VS-Code-Extension *FANUC TP (LS)*.

Nachschlagewerke in diesem Skill:
- [references/syntax.md](references/syntax.md): Befehlsreferenz (Bewegungen, Register, E/A, Verzweigungen, Warten, Aufrufe, Schweißen)
- [references/beispiele.md](references/beispiele.md): vollständige Beispielprogramme (Pick & Place, Palettierung, Schweißnaht, Unterprogramm mit Argumenten)
- [templates/programm-vorlage.ls](templates/programm-vorlage.ls): leeres Programmgerüst

Lies `references/syntax.md`, bevor du Befehle verwendest, deren genaue Schreibweise du nicht sicher kennst. Erfinde keine Befehle. Ist etwas nicht belegt, sag das und frage nach.

## Arbeitsweise

1. **Rahmen klären**, bevor Code entsteht. Fehlende Angaben erfragen oder als Annahme ausweisen:
   - Werkzeug- und Benutzerkoordinaten (`UTOOL_NUM`, `UFRAME_NUM`)
   - E/A-Belegung: Welches `DO`/`DI`/`RO`/`RI` ist Greifer, Sensor, Freigabe? **Nie raten.** Platzhalter verwenden und in einer Bemerkung kennzeichnen.
   - Registerbereiche, die frei sind: `R[n]` und `PR[n]` werden steuerungsweit geteilt.
   - Bewegungsgruppen und externe Achsen (`DEFAULT_GROUP`)
2. **Vorhandenen Code lesen:** Bei Änderungen die bestehende Datei komplett lesen und Stil, Nummerierung, Registerverwendung und Kommentarsprache übernehmen.
3. **Programm schreiben:** strikt nach den Formatregeln unten.
4. **Prüfen:** Checkliste am Ende durchgehen. In VS Code mit der Extension anschließend `FANUC: Syntax prüfen` bzw. die Probleme-Ansicht auswerten und `FANUC: Zeilennummern neu nummerieren` ausführen.
5. **Übergeben:** Kurz zusammenfassen, was das Programm tut, welche Positionen noch geteacht werden müssen und welche Annahmen (E/A, Register, Frames) getroffen wurden.

## Dateiaufbau (verbindlich)

Abschnitte immer in dieser Reihenfolge:

```
/PROG  NAME
/ATTR
... Attribute ...
/APPL
/MN
... Programmzeilen ...
/POS
... Positionsdaten ...
/END
```

- `NAME` in Großbuchstaben, Buchstaben/Ziffern/Unterstrich. Er muss mit dem Dateinamen übereinstimmen (`NAME.LS`).
- `/APPL` darf leer sein. Bei Schweißprogrammen stehen dort applikationsspezifische Daten.
- Zeilenenden sind **CRLF**. Leerzeichen vor dem `;` gehören zum Originalformat und bleiben erhalten.
- Für neue Programme `templates/programm-vorlage.ls` als Ausgangspunkt nehmen.

## Formatregeln im /MN-Block

- Jede Anweisung hat eine **Zeilennummer**: rechtsbündig in 4 Stellen, dann `:`. Die Nummern laufen ohne Lücken ab 1.
- **Bewegungsbefehle** folgen direkt auf den Doppelpunkt: `   5:L P[2] 200mm/sec FINE    ;`
- **Alle anderen Anweisungen** folgen nach zwei Leerzeichen: `   6:  DO[1]=ON ;`
- Jede Anweisung endet mit ` ;`.
- **Fortsetzungszeilen** haben keine Nummer, z. B. der zweite Punkt einer Kreisbewegung:
  ```
     7:C P[3]    
      :  P[4] 100mm/sec CNT50    ;
  ```
- Bemerkungen: `   1:  !Greifer oeffnen ;`. Umlaute möglichst vermeiden (ae/oe/ue), weil ältere Steuerungen sie falsch darstellen.
- **`LINE_COUNT`** im `/ATTR`-Block = Anzahl nummerierter Zeilen in `/MN`. Nach jeder Änderung anpassen.
- `MODIFIED` bei Änderungen auf das aktuelle Datum setzen (`DATE JJ-MM-TT  TIME hh:mm:ss`).

## Bewegungen – die wichtigsten Regeln

- Syntax: `<Art> <Ziel> <Geschwindigkeit> <Überschleifen> [Optionen] ;`
- `J` (Gelenk) nur mit `%` (1–100) oder Zeit (`sec`/`msec`).
- `L`, `C`, `A` (Bahn) nur mit Bahngeschwindigkeit: `mm/sec`, `cm/min`, `inch/min`, `deg/sec`, `sec`, `msec`. **Nie `%` bei Bahnbewegungen.**
- Überschleifen: `FINE` (exakter Halt) oder `CNT0`–`CNT100`. `FINE` verwenden, wenn danach geschaltet, gegriffen, gemessen oder gewartet wird.
- Ziel `P[n]` braucht einen Eintrag im `/POS`-Block. Ziel `PR[n]` nimmt die Position aus einem Positionsregister, das dann keinen `/POS`-Eintrag braucht.
- Anfahren und Abfahren über Vorposition: erst `J`/`L` mit `CNT` auf eine Position über dem Ziel, dann `L … FINE` auf das Ziel. Bei Palettierung oder Offsets bietet sich `Offset,PR[n]` an.

## /POS-Block

Jede im `/MN`-Block verwendete `P[n]` wird genau einmal definiert:

```
P[1:"Vorpos Greifen"]{
   GP1:
	UF : 1, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =   500.000  mm,	Y =     0.000  mm,	Z =   300.000  mm,
	W =   180.000 deg,	P =     0.000 deg,	R =     0.000 deg
};
```

- `UF`/`UT` passen zu `UFRAME_NUM`/`UTOOL_NUM`, die vor der Bewegung aktiv sind.
- Achswerte statt kartesisch: `J1 = … deg, J2 = …` (siehe `references/syntax.md`).
- **Koordinaten nie erfinden und als echt ausgeben.** Unbekannte Positionen mit Nullwerten oder plausiblen Platzhaltern anlegen und im Kommentar mit `"TEACH"` markieren, z. B. `P[3:"TEACH Ablage"]`. In der Antwort ausdrücklich darauf hinweisen, dass diese Punkte am Roboter geteacht werden müssen.
- Weitere Gruppen und externe Achsen: Für jede Gruppe aus `DEFAULT_GROUP` einen `GPn:`-Block; externe Achsen als `E1 = … mm/deg`.

## Sicherheit

Roboterprogramme bewegen reale Maschinen. Deshalb gilt immer:
- Generierten Code **nie als einsatzbereit** bezeichnen. Der Hinweis gehört dazu: Test im Betriebsart T1, mit reduziertem Override und im Einzelschritt; Positionen und Kollisionsfreiheit prüfen.
- Keine Sicherheitsfunktionen umgehen: kein Überbrücken von `UI`/`SI`, kein Abschalten der Kollisionserkennung (`COL DETECT OFF`) ohne ausdrückliche, begründete Anforderung. In dem Fall mit Warnhinweis.
- Keine Systemvariablen (`$…`) ändern, die Sicherheits- oder Achsgrenzen betreffen.
- Hohe Geschwindigkeiten (über 1000 mm/sec) nur, wenn verlangt. Die Extension warnt standardmäßig ab 2000 mm/sec.

## Checkliste vor der Ausgabe

- [ ] Abschnitte vollständig und in richtiger Reihenfolge, `/PROG`-Name = Dateiname
- [ ] Zeilennummern lückenlos, `LINE_COUNT` stimmt
- [ ] Jede Anweisung endet mit `;`; Fortsetzungszeilen ohne Nummer
- [ ] `J` nur mit `%`/Zeit, `L`/`C`/`A` nie mit `%`; jede Bewegung hat `FINE` oder `CNTn`
- [ ] Jede `P[n]` ist in `/POS` definiert, keine doppelt; zu teachende Punkte markiert
- [ ] Jedes `JMP LBL[n]` hat ein `LBL[n]`; `IF … THEN`/`ENDIF`, `FOR`/`ENDFOR`, `SELECT` vollständig
- [ ] `UTOOL_NUM`/`UFRAME_NUM` vor der ersten Bewegung gesetzt
- [ ] Angenommene E/A, Register und Frames in der Antwort aufgelistet
- [ ] Sicherheitshinweis zum Test gegeben
