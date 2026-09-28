/** Textänderung in Dokumentkoordinaten - ohne VS-Code-Abhängigkeit, damit testbar. */
export interface TextChange {
	line: number;
	start: number;
	/** letzte betroffene Zeile (Standard: `line`) */
	endLine?: number;
	end: number;
	text: string;
}

/** Wendet Textänderungen auf einen Text an (für Tests und Vorschau). */
export function applyChanges(text: string, changes: TextChange[]): string {
	const eol = text.includes('\r\n') ? '\r\n' : '\n';
	const lines = text.split(/\r?\n/);
	const sorted = [...changes].sort((a, b) => b.line - a.line || b.start - a.start);
	for (const c of sorted) {
		const endLine = c.endLine ?? c.line;
		const merged = lines[c.line].slice(0, c.start) + c.text + lines[endLine].slice(c.end);
		lines.splice(c.line, endLine - c.line + 1, ...merged.split(/\r?\n/));
	}
	return lines.join(eol);
}
