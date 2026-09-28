# Bewegungsgruppen und externe Achsen

`DEFAULT_GROUP` im `/ATTR`-Block legt fest, welche Bewegungsgruppen ein Programm bewegt. Die Stellen stehen für GP1 bis GP5, `1` heißt aktiv, `*` heißt nicht verwendet. `1,1,*,*,*` bedeutet also Roboter (GP1) plus eine zweite Gruppe, etwa einen Dreh-Kipp-Tisch. Jede Position im `/POS`-Block braucht dann Daten für genau diese Gruppen:

```
P[1]{
   GP1:
	UF : 1, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =   100.000  mm,	Y =   200.000  mm,	Z =   300.000  mm,
	W =   180.000 deg,	P =     0.000 deg,	R =     0.000 deg,
	E1=   500.000  mm
   GP2:
	UF : 0, UT : 1,
	J1=     0.000 deg,	J2=    90.000 deg
};
```

`E1` bis `E3` sind **externe Achsen** innerhalb einer Gruppe (z. B. eine Fahrschiene, die mit dem Roboter in GP1 läuft).

## Prüfung

| Meldung | Bedeutung |
|---|---|
| P[n] enthält keine Daten für GPx | Gruppe ist in `DEFAULT_GROUP` aktiv, fehlt aber in der Position |
| P[n] enthält GPx, die nicht aktiv ist | Position hat Daten einer Gruppe, die `DEFAULT_GROUP` nicht aktiviert |
| externe Achsen … die übrigen Positionen haben … | innerhalb einer Gruppe haben nicht alle Positionen dieselben externen Achsen (Warnung) |
| DEFAULT_GROUP aktiviert keine Bewegungsgruppe | das Programm hat Bewegungsbefehle, aber `DEFAULT_GROUP = *,*,*,*,*` |

Abschaltbar über `fanucLs.validation.checkGroups`.

## Header ändern – Positionen passen sich an

Wird `DEFAULT_GROUP` von Hand geändert, zeigt die Prüfung sofort alle betroffenen Positionen. Mit `Strg+.` gibt es passende Quick Fixes:

- **GPx in allen Positionen ergänzen**: fügt den Gruppenblock in jede Position ein. Der Aufbau (Achsen, `UF`/`UT`) wird von einer vorhandenen Position der Gruppe übernommen, sonst werden Achsanzahl und Einheit abgefragt. Alle Werte stehen auf 0 und müssen geteacht werden.
- **GPx in DEFAULT_GROUP deaktivieren**: macht die Änderung am Header rückgängig und entfernt die Gruppe aus allen Positionen.
- **GPx aus allen Positionen entfernen** bzw. **GPx in DEFAULT_GROUP aktivieren**: für Positionen mit einer nicht aktiven Gruppe.

## Befehle

Rechtsklick im Editor → **FANUC: Positionen & Achsen** oder über die Befehlspalette:

| Befehl | Wirkung |
|---|---|
| Position im /POS-Block anlegen | legt `P[n:"TEACH"]` mit allen aktiven Gruppen und externen Achsen an (Werte 0). Auch als Quick Fix bei „P[n] … nicht definiert“ |
| Externe Achse hinzufügen | ergänzt die nächste freie Achse (`E1`, `E2`, `E3`) mit Einheit mm oder deg in allen Positionen der Gruppe |
| Externe Achse entfernen | entfernt die Achse aus allen Positionen; warnt, wenn Werte ungleich 0 verloren gehen |
| Bewegungsgruppe hinzufügen | aktiviert GPx in `DEFAULT_GROUP` und ergänzt die Gruppe in allen Positionen |
| Bewegungsgruppe entfernen | deaktiviert GPx und entfernt ihre Daten aus allen Positionen (mit Rückfrage) |

Alle Änderungen lassen sich mit `Strg+Z` in einem Schritt rückgängig machen.

> Neu angelegte Achs- und Gruppenwerte sind **Platzhalter (0)**. Vor dem Einsatz die Positionen am Roboter teachen und das Programm in T1 mit reduziertem Override testen.
