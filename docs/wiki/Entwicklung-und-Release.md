# Entwicklung und Release

## Projektstruktur

```
├── package.json                      Manifest: Sprache, Grammatik, Snippets, Views, Befehle, Einstellungen
├── language-configuration.json       Kommentare, Klammern, Faltung, Einrückung
├── syntaxes/fanuc-ls.tmLanguage.json TextMate-Grammatik
├── snippets/fanuc-ls.json            Snippets
├── examples/SCHWEISS1.LS             Beispielprogramm
├── docs/wiki/                        Quelle dieses Wikis (inkl. Screenshots)
└── src/
    ├── extension.ts       Aktivierung, Trigger für die Prüfung
    ├── parser.ts          LS-Parser: Abschnitte, Attribute, TP-Zeilen, Positionen, Bewegungen
    ├── diagnostics.ts     alle Prüfregeln
    ├── quickfix.ts        Quick Fixes
    ├── edits.ts           Neunummerierung, LINE_COUNT, MODIFIED
    ├── format.ts          automatische Zeilennummern
    ├── symbols.ts         Outline
    ├── config.ts          Controllerliste und Passwörter
    ├── ftp.ts             FTP-Zugriff (basic-ftp), eine Verbindung je Steuerung
    ├── controllerTree.ts  Sidepanel
    └── commands.ts        alle Befehle
```

## Lokal entwickeln

```bash
npm install
npm run watch      # kompiliert bei jeder Änderung
```

Dann in VS Code `F5` drücken, damit der *Extension Development Host* startet. `npm run package` baut ein VSIX (Node.js ≥ 22).

## Build-Pipeline

`.github/workflows/build.yml` läuft bei jedem Push auf `main`, bei Pull Requests und manuell. Sie kompiliert, baut das VSIX und hängt es als Artefakt `fanuc-ls-vsix` an den Lauf.

## Release erstellen

1. `version` in `package.json` erhöhen und `CHANGELOG.md` ergänzen, dann auf `main` pushen.
2. Entweder:
   - **Actions → Build VSIX → Run workflow** mit Häkchen bei **release**. Der Tag `v<version>` wird automatisch angelegt.
   - oder lokal `git tag v0.3.0 && git push origin v0.3.0`. Der Tag muss zur Version passen.
3. Das Release mit angehängtem VSIX erscheint unter [Releases](https://github.com/frontline-networks/fanuc-ls-vscode/releases).

## Wiki pflegen

Die Wiki-Seiten liegen versioniert unter `docs/wiki/` im Repository. Bei jedem Push auf `main`, der dort etwas ändert, kopiert der Workflow `.github/workflows/wiki.yml` sie ins GitHub-Wiki. Änderungen daher im Repository vornehmen, nicht direkt im Wiki. Direkte Wiki-Änderungen werden beim nächsten Lauf überschrieben.

Dateinamen werden zu Seitentiteln: `-` wird im Titel zum Leerzeichen. Links zwischen Seiten: `[[Seitentitel]]`.

## Issues

Bugs und Ideen werden als [Issues](https://github.com/frontline-networks/fanuc-ls-vscode/issues) mit Labels (`bug`, `enhancement`, `bereich: …`) verwaltet. Die Labels sind in `.github/labels.yml` definiert.
