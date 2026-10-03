# Installation

## Variante A: fertiges VSIX (empfohlen)

1. Unter [Releases](https://github.com/frontline-networks/fanuc-ls-vscode/releases) die neueste Datei `fanuc-ls-<version>.vsix` herunterladen.
2. In VS Code: **Erweiterungen** (`Strg+Umschalt+X`) → Menü `…` oben rechts → **Install from VSIX…** / **Aus VSIX installieren…** → Datei wählen.

   Alternativ auf der Kommandozeile:
   ```bash
   code --install-extension fanuc-ls-0.6.0.vsix
   ```
3. VS Code neu laden, wenn es angeboten wird.

Zwischenstände ohne Release gibt es als Artefakt `fanuc-ls-vsix` an jedem Lauf unter **Actions → Build VSIX**.

**Voraussetzung:** VS Code 1.85 oder neuer.

## Variante B: aus dem Quellcode

```bash
git clone https://github.com/frontline-networks/fanuc-ls-vscode.git
cd fanuc-ls-vscode
npm install
npm run compile
```

- **Ausprobieren ohne Installation:** Ordner in VS Code öffnen und `F5` drücken. Es startet ein zweites Fenster (*Extension Development Host*) mit geladener Extension.
- **Eigenes VSIX bauen:** `npm run package`. Dafür wird Node.js 22 oder neuer benötigt.

## Aktualisieren

Ein neueres VSIX einfach über das alte installieren. Einstellungen und hinterlegte Passwörter bleiben erhalten.
