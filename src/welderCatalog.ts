/**
 * Alle Funktionen der Extension als Kacheln für die Startseite des Seitenreiters
 * "FANUC Schweißen" - ohne VS-Code-Abhängigkeit, damit testbar (jeder Befehl aus
 * package.json muss hier vorkommen).
 */

export interface Tile {
	command: string;
	icon: string;
	label: string;
	/** Erklärung als Tooltip */
	hint: string;
	/** Datei, die vorher im Editor aktiv sein muss */
	needs?: 'fanuc-ls' | 'fanuc-karel';
}

export interface Section {
	id: string;
	title: string;
	/** standardmäßig aufgeklappt */
	open?: boolean;
	tiles: Tile[];
}

/** Befehle, die nur intern (mit Argumenten aus Bäumen/Hovern) aufgerufen werden. */
export const INTERNAL_COMMANDS = ['fanucLs.labels.reveal'];

export const SECTIONS: Section[] = [
	{
		id: 'often',
		title: 'Häufig',
		open: true,
		tiles: [
			{ command: 'fanucLs.welder.download', icon: '📥', label: 'Programm holen', hint: 'Programm vom Roboter auf den PC holen und öffnen' },
			{ command: 'fanucLs.welder.upload', icon: '📤', label: 'Auf Roboter laden', hint: 'Programm prüfen und auf den Roboter laden – bei Fehlern gesperrt' },
			{ command: 'fanucLs.welder.speed', icon: '🔥', label: 'Geschwindigkeit', hint: 'Geschwindigkeit der Schweißnähte ändern (fester Wert oder Prozent)' },
			{ command: 'fanucLs.welder.mirror', icon: '🪞', label: 'Spiegeln', hint: 'Programm spiegeln, z. B. für das linke/rechte Bauteil' },
			{ command: 'fanucLs.welder.check', icon: '✅', label: 'Prüfen', hint: 'Programm prüfen und Fehler verständlich anzeigen' },
			{ command: 'fanucLs.welder.backup', icon: '💾', label: 'Sicherung', hint: 'Alle Dateien eines Roboters auf den PC kopieren' }
		]
	},
	{
		id: 'program',
		title: 'Programm',
		open: true,
		tiles: [
			{ command: 'fanucLs.newProgram', icon: '📄', label: 'Neues Programm', hint: 'Leeres TP-Programm anlegen' },
			{ command: 'fanucLs.validate', icon: '🔍', label: 'Syntax prüfen', hint: 'Prüfung starten, Ergebnisse im Fenster „Probleme“', needs: 'fanuc-ls' },
			{ command: 'fanucLs.renumber', icon: '🔢', label: 'Zeilen nummerieren', hint: 'Zeilennummern fortlaufend neu nummerieren', needs: 'fanuc-ls' },
			{ command: 'fanucLs.fixLineCount', icon: '🧮', label: 'LINE_COUNT', hint: 'LINE_COUNT im Kopf korrigieren', needs: 'fanuc-ls' },
			{ command: 'fanucLs.uploadCurrentFile', icon: '☁️', label: 'Hochladen', hint: 'Aktuelles Programm auf die Steuerung laden (Expertenablauf)', needs: 'fanuc-ls' },
			{ command: 'fanucLs.compareWithController', icon: '↔️', label: 'Mit Roboter vergleichen', hint: 'Unterschiede zwischen PC und Roboter anzeigen', needs: 'fanuc-ls' },
			{ command: 'fanucLs.mirrorGroup', icon: '🪞', label: 'Gruppe spiegeln', hint: 'Bewegungsgruppe spiegeln (Expertenablauf über Auswahllisten)', needs: 'fanuc-ls' }
		]
	},
	{
		id: 'labels',
		title: 'Sprungmarken',
		tiles: [
			{ command: 'fanucLs.labels.insert', icon: '🏷️', label: 'Einfügen', hint: 'Neue Sprungmarke LBL[n] unter der Cursorzeile einfügen', needs: 'fanuc-ls' },
			{ command: 'fanucLs.labels.renumberAll', icon: '🔢', label: 'Alle neu nummerieren', hint: 'Alle Sprungmarken in Reihenfolge neu nummerieren, Sprünge werden angepasst', needs: 'fanuc-ls' },
			{ command: 'fanucLs.labels.editComment', icon: '💬', label: 'Kommentar ändern', hint: 'Kommentar einer Sprungmarke bearbeiten', needs: 'fanuc-ls' },
			{ command: 'fanucLs.labels.changeNumber', icon: '#️⃣', label: 'Nummer ändern', hint: 'Nummer einer Sprungmarke ändern, alle Sprünge werden mitgeändert', needs: 'fanuc-ls' }
		]
	},
	{
		id: 'positions',
		title: 'Positionen & Achsen',
		tiles: [
			{ command: 'fanucLs.positions.create', icon: '📍', label: 'Position anlegen', hint: 'Fehlende Position P[n] im /POS-Block anlegen', needs: 'fanuc-ls' },
			{ command: 'fanucLs.groups.addGroup', icon: '➕', label: 'Gruppe hinzufügen', hint: 'Bewegungsgruppe in DEFAULT_GROUP und allen Positionen ergänzen', needs: 'fanuc-ls' },
			{ command: 'fanucLs.groups.removeGroup', icon: '➖', label: 'Gruppe entfernen', hint: 'Bewegungsgruppe aus DEFAULT_GROUP und allen Positionen entfernen', needs: 'fanuc-ls' },
			{ command: 'fanucLs.groups.addExtAxis', icon: '⚙️', label: 'Zusatzachse hinzufügen', hint: 'Externe Achse (E1…E3) in allen Positionen einer Gruppe ergänzen', needs: 'fanuc-ls' },
			{ command: 'fanucLs.groups.removeExtAxis', icon: '✖️', label: 'Zusatzachse entfernen', hint: 'Externe Achse aus allen Positionen entfernen', needs: 'fanuc-ls' }
		]
	},
	{
		id: 'io',
		title: 'Ein-/Ausgänge',
		tiles: [
			{ command: 'fanucLs.io.importFromController', icon: '📥', label: 'Vom Roboter importieren', hint: 'E/A-Kommentare vom Roboter übernehmen' },
			{ command: 'fanucLs.io.importCsv', icon: '📑', label: 'CSV importieren', hint: 'E/A-Liste aus einer CSV-Datei laden' },
			{ command: 'fanucLs.io.exportCsv', icon: '📤', label: 'CSV exportieren', hint: 'E/A-Liste als CSV speichern (z. B. für Excel)' },
			{ command: 'fanucLs.io.editRanges', icon: '📏', label: 'Gültige Bereiche', hint: 'Erlaubte Nummernbereiche für DO, DI, R, PR … festlegen' },
			{ command: 'fanucLs.io.toggleStatus', icon: '👁️', label: 'Status ein/aus', hint: 'Gespeicherten E/A-Status (ON/OFF) im Editor ein- oder ausblenden' },
			{ command: 'fanucLs.io.stripStatus', icon: '🧹', label: 'Status entfernen', hint: 'Gespeicherten E/A-Status aus dem Programm löschen', needs: 'fanuc-ls' },
			{ command: 'fanucLs.io.refresh', icon: '🔄', label: 'Neu laden', hint: 'E/A-Liste neu einlesen' }
		]
	},
	{
		id: 'robot',
		title: 'Roboter & Dateien',
		tiles: [
			{ command: 'fanucLs.welder.setup', icon: '🤖', label: 'Roboter einrichten', hint: 'Neuen Roboter mit Verbindungstest anlegen' },
			{ command: 'fanucLs.addController', icon: '➕', label: 'Roboter (Experte)', hint: 'Roboter mit Port, Benutzer und Geräten anlegen' },
			{ command: 'fanucLs.editController', icon: '✏️', label: 'Roboter bearbeiten', hint: 'Name, IP-Adresse, Port, Geräte ändern' },
			{ command: 'fanucLs.setPassword', icon: '🔑', label: 'Passwort', hint: 'FTP-Passwort hinterlegen oder löschen' },
			{ command: 'fanucLs.removeController', icon: '🗑️', label: 'Roboter entfernen', hint: 'Roboter aus der Liste entfernen' },
			{ command: 'fanucLs.openRemoteFile', icon: '📂', label: 'Datei ansehen', hint: 'Datei vom Roboter zum Ansehen öffnen (temporär)' },
			{ command: 'fanucLs.downloadFile', icon: '⬇️', label: 'Datei herunterladen', hint: 'Beliebige Datei vom Roboter in den Arbeitsordner laden' },
			{ command: 'fanucLs.uploadToDevice', icon: '⬆️', label: 'Dateien hochladen', hint: 'Dateien vom PC auf ein Gerät des Roboters laden' },
			{ command: 'fanucLs.downloadDevice', icon: '🗄️', label: 'Gerät sichern', hint: 'Alle Dateien eines Geräts (md:, fr: …) sichern' },
			{ command: 'fanucLs.compareRemoteWithLocal', icon: '↔️', label: 'Roboterdatei vergleichen', hint: 'Datei auf dem Roboter mit der Kopie am PC vergleichen' },
			{ command: 'fanucLs.deleteRemoteFile', icon: '❌', label: 'Datei löschen', hint: 'Datei auf dem Roboter löschen (mit Rückfrage)' },
			{ command: 'fanucLs.refresh', icon: '🔄', label: 'Aktualisieren', hint: 'Dateilisten der Roboter neu laden' },
			{ command: 'fanucLs.showLog', icon: '📜', label: 'FTP-Protokoll', hint: 'Protokoll der Verbindungen für die Fehlersuche' }
		]
	},
	{
		id: 'clone',
		title: 'Klon (Roboter-Abbild am PC)',
		tiles: [
			{ command: 'fanucLs.clone.create', icon: '🧬', label: 'Klonen / aktualisieren', hint: 'Dateien eines Roboters als Arbeitskopie im Ordner ablegen' },
			{ command: 'fanucLs.clone.showChanges', icon: '📝', label: 'Änderungen anzeigen', hint: 'Was wurde im Klon seit dem Holen geändert?' },
			{ command: 'fanucLs.clone.pushChanges', icon: '🚀', label: 'Änderungen übertragen', hint: 'Geänderte Dateien des Klons auf den Roboter laden' }
		]
	},
	{
		id: 'special',
		title: 'Argument-Wizard & KAREL',
		tiles: [
			{ command: 'fanucLs.dt.newFile', icon: '🧾', label: 'Neue ARGDISP-Datei', hint: 'ARGDISP-Datei (.DT) für den Argument-Wizard anlegen' },
			{ command: 'fanucLs.dt.fromProgram', icon: '🧩', label: 'Argumente beschreiben', hint: 'Argumente (AR[n]) des Programms für den Wizard beschreiben', needs: 'fanuc-ls' },
			{ command: 'fanucLs.karel.compile', icon: '🛠️', label: 'KAREL kompilieren', hint: 'KAREL-Datei mit ktrans übersetzen', needs: 'fanuc-karel' }
		]
	}
];

export function allTiles(): Tile[] {
	return SECTIONS.flatMap((s) => s.tiles);
}
