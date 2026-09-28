# Befehlsreferenz FANUC TP (ASCII-Listing)

Die Beispiele zeigen den Teil **nach** der Zeilennummer. Hinter dem `;` darf in LS-Dateien nichts mehr stehen; Kommentare sind eigene Zeilen `!Text ;`. Bewegungen stehen direkt hinter `:`, alles andere nach zwei Leerzeichen. Die vollständige Zeile sieht also so aus: `  12:L P[3] 100mm/sec FINE    ;` bzw. `  13:  DO[1]=ON ;`.

## Inhalt
1. Bewegungen
2. Bewegungsoptionen
3. Positionsdaten (/POS)
4. Register und Positionsregister
5. Ein-/Ausgänge
6. Verzweigungen und Schleifen
7. Warten
8. Programmaufrufe
9. Frames, Nutzlast, Override
10. Meldungen, Alarme, Timer, Programmsteuerung
11. Lichtbogenschweißen
12. /ATTR-Block

---

## 1. Bewegungen

| Art | Bedeutung | Geschwindigkeit |
|---|---|---|
| `J` | Gelenkinterpolation | `1%`–`100%`, oder `sec`/`msec` |
| `L` | Linear | `mm/sec`, `cm/min`, `inch/min`, `deg/sec` (reine Umorientierung), `sec`, `msec` |
| `C` | Kreis über Zwischenpunkt | wie `L` |
| `A` | Circular Arc (Kreisbogen über Punktfolge) | wie `L` |

```
J P[1] 100% FINE    ;
L P[2] 250mm/sec CNT50    ;
L PR[5] 500mm/sec FINE    ;
J P[3] R[10]% CNT100    ;
```

- `J P[3] R[10]% CNT100    ;`: Geschwindigkeit indirekt aus Register

Kreisbewegung: Zwischenpunkt und Zielpunkt. Der Zielpunkt steht in einer **Fortsetzungszeile ohne Nummer**:

```
   7:C P[3]    
    :  P[4] 100mm/sec CNT50    ;
```

**Überschleifen**
- `FINE`: Roboter hält exakt an. Pflicht vor Greifen, Schalten, Messen, `WAIT`.
- `CNT0` … `CNT100`: Überschleifen, 100 = maximal verrundet.

## 2. Bewegungsoptionen

Optionen stehen nach dem Überschleifen, vor dem `;`:

| Option | Beispiel | Wirkung |
|---|---|---|
| Beschleunigung | `L P[1] 500mm/sec CNT100 ACC80    ;` | `ACC` 0–150 % |
| Offset | `L P[1] 200mm/sec FINE Offset,PR[1]    ;` | Ziel um `PR[1]` versetzt (im aktiven UFRAME) |
| Werkzeug-Offset | `L P[1] 200mm/sec FINE Tool_Offset,PR[2]    ;` | Versatz im Werkzeugkoordinatensystem |
| Skip | `L P[1] 50mm/sec FINE Skip,LBL[5]    ;` | Abbruch bei `SKIP CONDITION`; ohne Auslösen Sprung nach `LBL[5]` |
| Time Before | `L P[1] 300mm/sec CNT50 TB .50sec,DO[3]=ON    ;` | Aktion 0,5 s vor Erreichen des Punkts |
| Time After | `L P[1] 300mm/sec FINE TA .20sec,DO[3]=OFF    ;` | Aktion nach Erreichen |
| Handgelenk-Gelenk | `L P[1] 200mm/sec CNT50 Wjnt    ;` | Handachsen gelenkinterpoliert |
| Inkrementell | `L P[1] 100mm/sec FINE INC    ;` | P[1] als relativer Versatz. Sparsam einsetzen |
| Bahnoptimierung | `L P[1] 800mm/sec CNT100 PTH    ;` | bessere Bahntreue bei CNT |

Skip-Bedingung vorab setzen:
```
  SKIP CONDITION DI[5]=ON ;
L P[6] 20mm/sec FINE Skip,LBL[9]    ;
```

Offset-Bedingung (für mehrere Bewegungen mit `Offset` ohne Register):
```
  OFFSET CONDITION PR[3] ;
L P[1] 100mm/sec FINE Offset    ;
```

## 3. Positionsdaten (/POS)

Kartesisch:
```
P[1:"Vorpos Greifen"]{
   GP1:
	UF : 1, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =   500.000  mm,	Y =     0.000  mm,	Z =   300.000  mm,
	W =   180.000 deg,	P =     0.000 deg,	R =     0.000 deg
};
```

Achswerte:
```
P[2]{
   GP1:
	UF : 1, UT : 1,
	J1=     0.000 deg,	J2=     0.000 deg,	J3=     0.000 deg,
	J4=     0.000 deg,	J5=   -90.000 deg,	J6=     0.000 deg
};
```

- `CONFIG`: Handgelenk `N`/`F` (no flip / flip), Ellbogen `U`/`D` (up/down), Vorne/Hinten `T`/`B`, dann die Umdrehungszähler der Achsen 1, 4, 6. Ohne Kenntnis der Zelle den Wert eines vorhandenen Punkts übernehmen, sonst `'N U T, 0, 0, 0'`.
- Zweite Bewegungsgruppe: zusätzlicher Block `GP2:` mit eigenen `UF`/`UT` und Achswerten.
- Externe Achsen in derselben Gruppe: nach den Koordinaten `E1 =   100.000  mm` (Linearachse) bzw. `deg` (Drehachse).
- Kommentar zum Punkt: `P[n:"Text"]`.

## 4. Register und Positionsregister

```
R[1]=0 ;
R[1]=R[1]+1 ;
R[2]=R[3]*2 ;
R[4]=R[5] DIV 3 ;
R[4]=R[5] MOD 3 ;
R[6]=DI[3] ;
R[7]=GI[1] ;
PR[1]=LPOS ;
PR[2]=JPOS ;
PR[3]=P[4] ;
PR[4]=PR[4]-PR[4] ;
PR[4,3]=50 ;
PR[4,1]=R[10]*100 ;
PR[5]=UFRAME[1] ;
PR[6]=UTOOL[1] ;
```

- `R[4]=R[5] DIV 3 ;`: ganzzahlige Division
- `R[6]=DI[3] ;`: Eingang als 0/1
- `PR[1]=LPOS ;`: aktuelle kartesische Position
- `PR[2]=JPOS ;`: aktuelle Achsposition
- `PR[4]=PR[4]-PR[4] ;`: PR auf null setzen (übliches Idiom)
- `PR[4,3]=50 ;`: Element 3 (= Z) von PR[4]
Elementindex bei kartesischen PR: 1=X, 2=Y, 3=Z, 4=W, 5=P, 6=R.

Weitere Datentypen: `AR[n]` (Argumente eines Aufrufs, nur lesend), `SR[n]` (String-Register), `$…` (Systemvariablen).

## 5. Ein-/Ausgänge

| Typ | Bedeutung |
|---|---|
| `DI`/`DO` | digitale Ein-/Ausgänge |
| `RI`/`RO` | Roboter-E/A (Greiferstecker am Arm) |
| `GI`/`GO` | Gruppen-E/A (Zahlenwert über mehrere Bits) |
| `AI`/`AO` | analoge E/A |
| `UI`/`UO` | Peripherie-E/A (SPS-Schnittstelle, **nicht beschreiben**) |
| `SI`/`SO` | Bedienfeld-E/A |
| `F` | Flags |
| `M` | Merker (Marker) |

```
DO[1]=ON ;
DO[1]=OFF ;
RO[2]=ON ;
DO[3]=PULSE,0.5sec ;
DO[4]=R[1] ;
GO[1]=R[2] ;
F[1]=ON ;
```

## 6. Verzweigungen und Schleifen

Einzeilig:
```
IF R[1]=5,JMP LBL[2] ;
IF DI[3]=ON,CALL AUSWERFEN ;
IF R[1]>=R[2],JMP LBL[9] ;
IF (DI[1] AND !DI[2]),JMP LBL[3] ;
```

- `IF (DI[1] AND !DI[2]),JMP LBL[3] ;`: Mixed Logic, ! = NICHT
Vergleichsoperatoren: `=`, `<>`, `<`, `<=`, `>`, `>=`.

Block (Mixed Logic, Klammern Pflicht):
```
IF (R[1]=1) THEN ;
  DO[1]=ON ;
ELSE ;
  DO[1]=OFF ;
ENDIF ;
```

SELECT:
```
SELECT R[1]=1,JMP LBL[1] ;
       =2,JMP LBL[2] ;
       =3,CALL TYP3 ;
       ELSE,JMP LBL[99] ;
```

Schleife:
```
FOR R[1]=1 TO 10 ;
  CALL ZYKLUS ;
ENDFOR ;
```

Sprungmarken:
```
LBL[1] ;
LBL[10:Hauptschleife] ;
JMP LBL[10] ;
```

## 7. Warten

```
WAIT   1.00(sec) ;
WAIT R[5] ;
WAIT DI[1]=ON    ;
WAIT DI[1]=ON TIMEOUT,LBL[99]    ;
WAIT (DI[1] AND DI[2])    ;
WAIT R[1]>=10    ;
```

- `WAIT R[5] ;`: Zeit in Sekunden aus Register
- `WAIT DI[1]=ON TIMEOUT,LBL[99]    ;`: Timeout aus $WAITTMOUT

## 8. Programmaufrufe

```
CALL GREIFEN ;
CALL ABLEGEN(3,R[2],'TEXT') ;
RUN HINTERGRUND ;
END ;
```

- `CALL ABLEGEN(3,R[2],'TEXT') ;`: im Unterprogramm als AR[1], AR[2], AR[3]
- `RUN HINTERGRUND ;`: startet parallel (Multitasking)
- `END ;`: Ende des Programms / Rückkehr

Unterprogramm mit Argumenten:
```
IF AR[1]=1,JMP LBL[1] ;
```

## 9. Frames, Nutzlast, Override

```
UTOOL_NUM=1 ;
UFRAME_NUM=2 ;
UTOOL_NUM=R[3] ;
PAYLOAD[2] ;
OVERRIDE=50% ;
```

`UTOOL_NUM` und `UFRAME_NUM` gehören **vor die erste Bewegung**. Die Werte müssen zu `UT`/`UF` der Positionen passen.

## 10. Meldungen, Alarme, Timer, Programmsteuerung

```
MESSAGE[Teil fehlt] ;
UALM[1] ;
TIMER[1]=START ;
TIMER[1]=STOP ;
TIMER[1]=RESET ;
R[20]=TIMER[1] ;
PAUSE ;
ABORT ;
COL DETECT ON ;
!Bemerkung ;
```

- `UALM[1] ;`: Benutzeralarm, Text in $UALRM_MSG[1]

## 11. Lichtbogenschweißen (ArcTool)

```
Arc Start[1] ;
L P[3] 10mm/sec FINE    ;
Arc End[1] ;
Weld Start[1,1] ;
Weld End[1,1] ;
Weave Sine[1] ;
Weave End ;
```

- `Arc Start[1] ;`: Schweißprozedur 1
- `Arc End[1] ;`: Endkrater-Prozedur 1
- `Weld Start[1,1] ;`: Weld Procedure, Schedule
- `Weave Sine[1] ;`: Pendeln: Sine, Circle, Figure 8, L

Typischer Ablauf: Anfahrt `J … CNT100` → `L … FINE` auf Nahtanfang → `Arc Start` → Schweißbahn mit Schweißgeschwindigkeit → `Arc End` → Freifahren mit `L`.

## 12. /ATTR-Block

| Feld | Hinweis |
|---|---|
| `OWNER` | `MNEDITOR` |
| `COMMENT` | Programmkommentar in Anführungszeichen |
| `PROG_SIZE`, `MEMORY_SIZE` | beim ASCII-Upload von der Steuerung neu berechnet, `0` ist zulässig |
| `CREATE`, `MODIFIED` | `DATE JJ-MM-TT  TIME hh:mm:ss` |
| `LINE_COUNT` | Anzahl der Zeilen im /MN-Block, muss stimmen |
| `PROTECT` | `READ_WRITE` oder `READ` |
| `TCD:` | Task-Einstellungen, Standardwerte aus der Vorlage übernehmen |
| `DEFAULT_GROUP` | fünf Stellen für Gruppe 1–5: `1` = aktiv, `*` = nicht verwendet, z. B. `1,1,*,*,*` |
| `CONTROL_CODE` | `00000000 00000000` |
