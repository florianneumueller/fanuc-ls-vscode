# Copilot-Skill: FANUC-TP-Programmierung

Im Repository liegt ein **Agent Skill** für GitHub Copilot. Er bringt Copilot bei, FANUC-TP-Programme im `.ls`-Format korrekt zu schreiben, zu ändern und zu prüfen.

```
.github/skills/fanuc-tp-programmierung/
├── SKILL.md                     Arbeitsweise, Formatregeln, Sicherheit, Checkliste
├── references/syntax.md         Befehlsreferenz (Bewegungen, Register, E/A, IF/SELECT/FOR, WAIT, CALL, Schweißen)
├── references/beispiele.md      geprüfte Beispielprogramme (Greifer, Pick & Place, Palette, Schweißnaht)
└── templates/programm-vorlage.ls  leeres Programmgerüst
```

## Was der Skill bewirkt

- **Korrektes Format:** Abschnittsreihenfolge, 4-stellige Zeilennummern, Abstand hinter dem Doppelpunkt, `;`, Fortsetzungszeilen bei `C`, `LINE_COUNT`, CRLF.
- **Korrekte Bewegungen:** `J` nur mit `%`, Bahnbewegungen nie mit `%`, `FINE` vor Schalten und Greifen, Anfahrt über Vorpositionen.
- **Keine erfundenen Daten:** Unbekannte Positionen werden als `P[n:"TEACH …"]` angelegt, E/A-Belegungen werden erfragt oder als Annahme ausgewiesen.
- **Sicherheit:** kein Umgehen von Sicherheitsfunktionen, immer ein Hinweis auf den Test in T1 mit reduziertem Override.
- **Selbstprüfung:** Checkliste vor der Ausgabe, danach Syntaxprüfung der Extension.

Alle Beispielprogramme im Skill laufen ohne Befund durch die Syntaxprüfung der Extension.

## Verwenden

**Mit der Extension (empfohlen):** Der Skill ist im VSIX enthalten und wird über den Contribution Point `chatSkills` automatisch bei Copilot registriert. Mit der Extension ist er also schon installiert, in jedem Projekt, ohne Kopieren. Voraussetzungen:
- VS Code **1.109 oder neuer** mit GitHub Copilot. Ältere Versionen ignorieren den Skill, alle anderen Funktionen der Extension laufen trotzdem.
- Chat im Modus **Agent**.
- Abschalten lässt er sich über die Einstellung `fanucLs.copilot.skill`.

**In diesem Repository:** Der Skill wird automatisch gefunden, sobald Copilot im Agent-Modus arbeitet:
- VS Code: Chat im Modus *Agent*
- Copilot CLI und Copilot Cloud Agent

Copilot lädt den Skill selbst, wenn es um FANUC-Programme geht. Gezielt aufrufen lässt er sich im Chat mit `/fanuc-tp-programmierung`.

**Ohne die Extension** (z. B. für die Copilot CLI oder den Cloud Agent in einem Roboter-Repository) den Ordner kopieren:

| Weg | Ziel | Wirkung |
|---|---|---|
| pro Projekt | Ordner nach `<projekt>/.github/skills/fanuc-tp-programmierung/` kopieren | gilt für alle, die das Projekt nutzen |
| persönlich | Ordner nach `~/.copilot/skills/fanuc-tp-programmierung/` kopieren (Windows: `%USERPROFILE%\.copilot\skills\…`) | gilt für dich in allen Projekten |

## Beispiel-Prompts

- „Schreibe ein Programm `ENTNAHME`, das ein Teil aus der Presse entnimmt und auf dem Band ablegt. Greifer über `CALL GREIFER`.“
- „Mach aus `PICKPLACE.LS` eine Palettierung 4×5 mit 100 mm Raster.“
- „Prüfe `SCHWEISS1.LS` auf Fehler und erkläre, was das Programm macht.“
- „Füge vor jedem Greifen eine Abfrage auf `DI[12]` mit Timeout und Alarm ein.“

> Von Copilot erzeugte Roboterprogramme sind ein Entwurf. Vor dem Einsatz Positionen teachen, E/A prüfen und das Programm in T1 mit reduziertem Override im Einzelschritt testen.

## Skill anpassen

Firmeneigene Konventionen gehören direkt in `SKILL.md`, etwa Registerbereiche, Standard-E/A, Namensregeln oder feste Unterprogramme. Weitere Beispiele können unter `references/` ergänzt werden. Die Dateien sind normales Markdown.
