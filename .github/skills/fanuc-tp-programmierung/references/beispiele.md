# Beispielprogramme

Alle Beispiele sind vollständige `.ls`-Dateien und wurden mit der Syntaxprüfung der Extension *FANUC TP (LS)* ohne Befund geprüft. Positionen mit `TEACH` im Kommentar sind Platzhalter und müssen am Roboter geteacht werden. E/A-Belegungen sind Annahmen und stehen als Bemerkung im Programm.

Die Programme rufen sich gegenseitig auf: `PICKPLACE` und `PALETTE` nutzen `GREIFER`, `PALETTE` nutzt zusätzlich `PICKPLACE_G`.

## Inhalt
1. GREIFER: Unterprogramm mit Argument, Timeout-Behandlung
2. PICKPLACE: Greifen und Ablegen mit Vorpositionen
3. PICKPLACE_G: nur Greifen (Baustein für die Palettierung)
4. PALETTE: verschachtelte Schleifen, Offset über Positionsregister
5. NAHT1: Lichtbogenschweißen mit Pendeln und Kreisbewegung

## 1. GREIFER: Unterprogramm mit Argument

Aufruf mit `CALL GREIFER(1)` (schließen) oder `CALL GREIFER(0)` (öffnen). Das Argument kommt als `AR[1]` an. Es hat keine Bewegungen, deshalb ist `DEFAULT_GROUP` komplett `*`, und es gibt keine Positionen. Meldet der Sensor nicht rechtzeitig, löst das Programm `UALM[1]` aus.

Annahmen: `RO[1]` = Greifer zu, `RO[2]` = Greifer auf, `RI[1]` = geschlossen, `RI[2]` = offen.

```
/PROG  GREIFER
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "Greifer auf/zu, AR[1]";
PROG_SIZE	= 0;
CREATE		= DATE 26-09-28  TIME 12:00:00;
MODIFIED	= DATE 26-09-28  TIME 12:00:00;
FILE_NAME	= ;
VERSION		= 0;
LINE_COUNT	= 17;
MEMORY_SIZE	= 0;
PROTECT		= READ_WRITE;
TCD:  STACK_SIZE	= 0,
      TASK_PRIORITY	= 50,
      TIME_SLICE	= 0,
      BUSY_LAMP_OFF	= 0,
      ABORT_REQUEST	= 0,
      PAUSE_REQUEST	= 0;
DEFAULT_GROUP	= *,*,*,*,*;
CONTROL_CODE	= 00000000 00000000;
/APPL
/MN
   1:  !AR[1]=1 schliessen, AR[1]=0 oeffnen ;
   2:  !Annahme: RO[1]=zu, RO[2]=auf ;
   3:  !Annahme: RI[1]=geschlossen ;
   4:  !Annahme: RI[2]=offen ;
   5:  IF AR[1]=1,JMP LBL[1] ;
   6:  RO[1]=OFF ;
   7:  RO[2]=ON ;
   8:  WAIT RI[2]=ON TIMEOUT,LBL[99]    ;
   9:  END ;
  10:  LBL[1:Schliessen] ;
  11:  RO[2]=OFF ;
  12:  RO[1]=ON ;
  13:  WAIT RI[1]=ON TIMEOUT,LBL[99]    ;
  14:  END ;
  15:  LBL[99:Timeout] ;
  16:  UALM[1] ;
  17:  END ;
/POS
/END
```

## 2. PICKPLACE: Greifen und Ablegen

Jeder Greif- bzw. Ablagepunkt wird über eine Vorposition angefahren: schnell mit `CNT` auf die Vorposition, dann `L … FINE` auf den Punkt, greifen, zurück zur Vorposition. Fehlt das Teil, springt das Programm nach `LBL[99]` und löst einen Alarm aus.

Annahmen: `DI[10]` = Teil vorhanden, `UTOOL 1` = Greifer, `UFRAME 1` = Arbeitstisch, `PAYLOAD[1]` = Greifer mit Teil.

```
/PROG  PICKPLACE
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "Teil greifen und ablegen";
PROG_SIZE	= 0;
CREATE		= DATE 26-09-28  TIME 12:00:00;
MODIFIED	= DATE 26-09-28  TIME 12:00:00;
FILE_NAME	= ;
VERSION		= 0;
LINE_COUNT	= 24;
MEMORY_SIZE	= 0;
PROTECT		= READ_WRITE;
TCD:  STACK_SIZE	= 0,
      TASK_PRIORITY	= 50,
      TIME_SLICE	= 0,
      BUSY_LAMP_OFF	= 0,
      ABORT_REQUEST	= 0,
      PAUSE_REQUEST	= 0;
DEFAULT_GROUP	= 1,*,*,*,*;
CONTROL_CODE	= 00000000 00000000;
/APPL
/MN
   1:  !Pick and Place ;
   2:  !Annahme: DI[10]=Teil vorhanden ;
   3:  UTOOL_NUM=1 ;
   4:  UFRAME_NUM=1 ;
   5:  PAYLOAD[1] ;
   6:  CALL GREIFER(0) ;
   7:J P[1] 50% FINE    ;
   8:  WAIT DI[10]=ON TIMEOUT,LBL[99]    ;
   9:  !Greifen ;
  10:J P[2] 50% CNT50    ;
  11:L P[3] 200mm/sec FINE    ;
  12:  CALL GREIFER(1) ;
  13:L P[2] 500mm/sec CNT50    ;
  14:  !Ablegen ;
  15:J P[4] 50% CNT50    ;
  16:L P[5] 200mm/sec FINE    ;
  17:  CALL GREIFER(0) ;
  18:L P[4] 500mm/sec CNT50    ;
  19:J P[1] 50% FINE    ;
  20:  END ;
  21:  LBL[99:Kein Teil] ;
  22:  MESSAGE[Kein Teil vorhanden] ;
  23:  UALM[2] ;
  24:  END ;
/POS
P[1:"TEACH Home"]{
   GP1:
	UF : 1, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =   400.000  mm,	Y =     0.000  mm,	Z =   500.000  mm,
	W =   180.000 deg,	P =     0.000 deg,	R =     0.000 deg
};
P[2:"TEACH Vorpos Greifen"]{
   GP1:
	UF : 1, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =   600.000  mm,	Y =  -200.000  mm,	Z =   300.000  mm,
	W =   180.000 deg,	P =     0.000 deg,	R =     0.000 deg
};
P[3:"TEACH Greifen"]{
   GP1:
	UF : 1, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =   600.000  mm,	Y =  -200.000  mm,	Z =   150.000  mm,
	W =   180.000 deg,	P =     0.000 deg,	R =     0.000 deg
};
P[4:"TEACH Vorpos Ablage"]{
   GP1:
	UF : 1, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =   600.000  mm,	Y =   200.000  mm,	Z =   300.000  mm,
	W =   180.000 deg,	P =     0.000 deg,	R =     0.000 deg
};
P[5:"TEACH Ablage"]{
   GP1:
	UF : 1, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =   600.000  mm,	Y =   200.000  mm,	Z =   150.000  mm,
	W =   180.000 deg,	P =     0.000 deg,	R =     0.000 deg
};
/END
```

## 3. PICKPLACE_G: nur Greifen

```
/PROG  PICKPLACE_G
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "Nur Greifen";
PROG_SIZE	= 0;
CREATE		= DATE 26-09-28  TIME 12:00:00;
MODIFIED	= DATE 26-09-28  TIME 12:00:00;
FILE_NAME	= ;
VERSION		= 0;
LINE_COUNT	= 7;
MEMORY_SIZE	= 0;
PROTECT		= READ_WRITE;
TCD:  STACK_SIZE	= 0,
      TASK_PRIORITY	= 50,
      TIME_SLICE	= 0,
      BUSY_LAMP_OFF	= 0,
      ABORT_REQUEST	= 0,
      PAUSE_REQUEST	= 0;
DEFAULT_GROUP	= 1,*,*,*,*;
CONTROL_CODE	= 00000000 00000000;
/APPL
/MN
   1:  !Teil greifen ;
   2:  UTOOL_NUM=1 ;
   3:  UFRAME_NUM=1 ;
   4:J P[1] 50% CNT50    ;
   5:L P[2] 200mm/sec FINE    ;
   6:  CALL GREIFER(1) ;
   7:L P[1] 500mm/sec CNT50    ;
/POS
P[1:"TEACH Vorpos Greifen"]{
   GP1:
	UF : 1, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =   600.000  mm,	Y =  -200.000  mm,	Z =   300.000  mm,
	W =   180.000 deg,	P =     0.000 deg,	R =     0.000 deg
};
P[2:"TEACH Greifen"]{
   GP1:
	UF : 1, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =   600.000  mm,	Y =  -200.000  mm,	Z =   150.000  mm,
	W =   180.000 deg,	P =     0.000 deg,	R =     0.000 deg
};
/END
```

## 4. PALETTE: Palettierung mit Offset

Zwei `FOR`-Schleifen laufen über Reihen (`R[1]`) und Spalten (`R[2]`). Der Versatz wird in `PR[1]` berechnet (`PR[1,1]` = X, `PR[1,2]` = Y). `PR[1]=LPOS` gefolgt von `PR[1]=PR[1]-PR[1]` ist das übliche Idiom, um ein kartesisches Positionsregister auf null zu setzen.

Wichtig: `PICKPLACE_G` setzt `UFRAME_NUM=1`. Nach dem Aufruf muss deshalb `UFRAME_NUM=2` erneut gesetzt werden, weil die Ablagepunkte im Palettenframe (UF 2) geteacht sind. Frames bleiben nach einem `CALL` so, wie das Unterprogramm sie hinterlassen hat.

Annahmen: `UFRAME 2` liegt in der Palettenecke, `DO[20]` = Meldung „Palette voll“, `DI[20]` = Quittung Palette getauscht.

```
/PROG  PALETTE
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "3x4 Palette belegen";
PROG_SIZE	= 0;
CREATE		= DATE 26-09-28  TIME 12:00:00;
MODIFIED	= DATE 26-09-28  TIME 12:00:00;
FILE_NAME	= ;
VERSION		= 0;
LINE_COUNT	= 25;
MEMORY_SIZE	= 0;
PROTECT		= READ_WRITE;
TCD:  STACK_SIZE	= 0,
      TASK_PRIORITY	= 50,
      TIME_SLICE	= 0,
      BUSY_LAMP_OFF	= 0,
      ABORT_REQUEST	= 0,
      PAUSE_REQUEST	= 0;
DEFAULT_GROUP	= 1,*,*,*,*;
CONTROL_CODE	= 00000000 00000000;
/APPL
/MN
   1:  !Palette 3 Reihen x 4 Spalten ;
   2:  !Raster X=120mm, Y=80mm ;
   3:  !R[1]=Reihe, R[2]=Spalte ;
   4:  !PR[1]=Offset ;
   5:  UTOOL_NUM=1 ;
   6:  PR[1]=LPOS ;
   7:  PR[1]=PR[1]-PR[1] ;
   8:  FOR R[1]=0 TO 2 ;
   9:  FOR R[2]=0 TO 3 ;
  10:  PR[1,1]=R[1]*120 ;
  11:  PR[1,2]=R[2]*80 ;
  12:  CALL PICKPLACE_G ;
  13:  !Ablage im Palettenframe ;
  14:  UFRAME_NUM=2 ;
  15:J P[2] 50% CNT50 Offset,PR[1]    ;
  16:L P[1] 200mm/sec FINE Offset,PR[1]    ;
  17:  CALL GREIFER(0) ;
  18:L P[2] 500mm/sec CNT50 Offset,PR[1]    ;
  19:  ENDFOR ;
  20:  ENDFOR ;
  21:  !Palette voll melden ;
  22:  DO[20]=PULSE,1.0sec ;
  23:  MESSAGE[Palette voll] ;
  24:  WAIT DI[20]=ON    ;
  25:  END ;
/POS
P[1:"TEACH Ablage Ecke"]{
   GP1:
	UF : 2, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =     0.000  mm,	Y =     0.000  mm,	Z =    50.000  mm,
	W =   180.000 deg,	P =     0.000 deg,	R =     0.000 deg
};
P[2:"TEACH Vorpos Ecke"]{
   GP1:
	UF : 2, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =     0.000  mm,	Y =     0.000  mm,	Z =   200.000  mm,
	W =   180.000 deg,	P =     0.000 deg,	R =     0.000 deg
};
/END
```

## 5. NAHT1: Schweißnaht mit Pendeln und Kreis

Anfahren mit `CNT100`, Nahtanfang mit `FINE`, dann `Arc Start`. Pendeln wird mit `Weave Sine[1]` ein- und mit `Weave End` ausgeschaltet. Die Kreisbewegung `C` hat ihren Zielpunkt in einer Fortsetzungszeile ohne Nummer. Nach `Arc End` wird mit `L` freigefahren.

Annahmen: Schweißprozedur 1 und Pendelprozedur 1 sind auf der Steuerung eingerichtet (ArcTool).

```
/PROG  NAHT1
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "Kehlnaht mit Pendeln und Kreis";
PROG_SIZE	= 0;
CREATE		= DATE 26-09-28  TIME 12:00:00;
MODIFIED	= DATE 26-09-28  TIME 12:00:00;
FILE_NAME	= ;
VERSION		= 0;
LINE_COUNT	= 15;
MEMORY_SIZE	= 0;
PROTECT		= READ_WRITE;
TCD:  STACK_SIZE	= 0,
      TASK_PRIORITY	= 50,
      TIME_SLICE	= 0,
      BUSY_LAMP_OFF	= 0,
      ABORT_REQUEST	= 0,
      PAUSE_REQUEST	= 0;
DEFAULT_GROUP	= 1,*,*,*,*;
CONTROL_CODE	= 00000000 00000000;
/APPL
/MN
   1:  !Kehlnaht mit Pendeln ;
   2:  UTOOL_NUM=1 ;
   3:  UFRAME_NUM=1 ;
   4:J P[1] 50% CNT100    ;
   5:L P[2] 200mm/sec FINE    ;
   6:  Arc Start[1] ;
   7:  Weave Sine[1] ;
   8:L P[3] 8mm/sec CNT100    ;
   9:C P[4]    
    :  P[5] 8mm/sec FINE    ;
  10:  Weave End ;
  11:  Arc End[1] ;
  12:L P[6] 300mm/sec CNT100    ;
  13:J P[1] 50% FINE    ;
  14:  !Ende ;
  15:  END ;
/POS
P[1:"TEACH Anfahrt"]{
   GP1:
	UF : 1, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =   800.000  mm,	Y =     0.000  mm,	Z =   400.000  mm,
	W =   180.000 deg,	P =     0.000 deg,	R =     0.000 deg
};
P[2:"TEACH Nahtanfang"]{
   GP1:
	UF : 1, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =   800.000  mm,	Y =     0.000  mm,	Z =   200.000  mm,
	W =   180.000 deg,	P =     0.000 deg,	R =     0.000 deg
};
P[3:"TEACH Naht gerade"]{
   GP1:
	UF : 1, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =   950.000  mm,	Y =     0.000  mm,	Z =   200.000  mm,
	W =   180.000 deg,	P =     0.000 deg,	R =     0.000 deg
};
P[4:"TEACH Kreis Mitte"]{
   GP1:
	UF : 1, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =  1000.000  mm,	Y =    50.000  mm,	Z =   200.000  mm,
	W =   180.000 deg,	P =     0.000 deg,	R =     0.000 deg
};
P[5:"TEACH Kreis Ende"]{
   GP1:
	UF : 1, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =   950.000  mm,	Y =   100.000  mm,	Z =   200.000  mm,
	W =   180.000 deg,	P =     0.000 deg,	R =     0.000 deg
};
P[6:"TEACH Freifahren"]{
   GP1:
	UF : 1, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =   950.000  mm,	Y =   100.000  mm,	Z =   350.000  mm,
	W =   180.000 deg,	P =     0.000 deg,	R =     0.000 deg
};
/END
```
