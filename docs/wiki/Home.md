# FANUC TP (LS) – VS Code Extension

Die Extension macht VS Code zum Editor für FANUC-TP-Programme im ASCII-Listing-Format (`.ls`) und für KAREL-Quelltexte (`.kl`). Sie bietet:

- **Syntaxhighlighting & Outline**: Abschnitte, Bewegungen, Register, E/A, Schweißbefehle
- **Syntaxprüfung** beim Tippen, mit Quick Fixes
- **48 Snippets** und **automatische Zeilennummern** im `/MN`-Block
- **Schweißer-Oberfläche**: eigener Seitenreiter mit Assistenten für Anwender ohne Programmiererfahrung (Programm holen, Geschwindigkeit ändern, spiegeln, prüfen, laden, sichern)
- **Controller-Ansicht mit FTP**: Programme direkt von der Robotersteuerung öffnen, sichern und hochladen

![Übersicht](images/01-syntaxhighlighting.png)

## Seiten

| Seite | Inhalt |
|---|---|
| [[Installation]] | VSIX installieren, aus dem Quellcode bauen |
| [[Erste Schritte]] | In 5 Minuten vom leeren Ordner zum ersten Programm |
| [[Schweißer-Oberfläche]] | Seitenreiter *FANUC Schweißen* mit Assistenten, einfacher Modus für Schweißer |
| [[Syntaxhighlighting und Outline]] | Farben, Gliederung, Faltung |
| [[Syntaxprüfung]] | Alle Prüfregeln, Quick Fixes, Grenzwerte |
| [[Sprungmarken]] | Label-Ansicht, Umbenennen, Einfügen, Neu nummerieren |
| [[Bewegungsgruppen und externe Achsen]] | Prüfung gegen DEFAULT_GROUP, Achsen und Gruppen hinzufügen/entfernen |
| [[Snippets und Zeilennummern]] | Snippet-Liste, automatische Nummerierung |
| [[Ein und Ausgänge]] | E/A-Kommentare importieren, Hover, gültige Bereiche, Status ausblenden |
| [[KAREL]] | KAREL-Dateien (.kl): Highlighting, Outline, Snippets, Kompilieren mit ktrans |
| [[Argument-Wizard]] | ARGDISP-Dateien (.DT) für „Wizard to input arguments“: Highlighting, Prüfung, Snippets, CALL-Prüfung |
| [[Controller und FTP]] | Steuerung einrichten, Dateien übertragen, Sicherung |
| [[Einstellungen]] | Alle Optionen mit Standardwerten |
| [[Praxishinweise]] | Tipps zur Steuerung (FTP, Geräte, ASCII-Upload) |
| [[Copilot-Skill]] | GitHub-Copilot-Skill für FANUC-Programmierung |
| [[Befehle]] | Alle `FANUC:`-Befehle der Befehlspalette |
| [[Entwicklung und Release]] | Projektstruktur, Build-Pipeline, Releases |

## Fehler melden / Ideen

Bugs und Feature-Ideen bitte als [Issue](https://github.com/frontline-networks/fanuc-ls-vscode/issues/new/choose) anlegen. Dafür gibt es Formulare für *Bug melden* und *Feature-Idee*.
