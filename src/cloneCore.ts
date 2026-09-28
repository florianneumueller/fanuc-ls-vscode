/**
 * Klon eines Controllers in ein lokales Verzeichnis - ohne VS-Code-Abhängigkeit, damit testbar.
 *
 * Aufbau:
 *   <root>/.fanuc-clone.json     Manifest
 *   <root>/md/SCHWEISS1.LS       Datei von md:SCHWEISS1.LS
 *   <root>/ud1/BACKUP/X.LS       Datei von ud1:BACKUP/X.LS
 */
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

export const MANIFEST_NAME = '.fanuc-clone.json';

export interface CloneFile {
	remotePath: string;
	sha1: string;
	size: number;
}

export interface CloneManifest {
	version: 1;
	controller: string;
	host: string;
	created: string;
	updated: string;
	/** Ordnername -> Gerät, z. B. "md" -> "md:" */
	devices: Record<string, string>;
	/** relativer Pfad (mit "/") -> Stand beim letzten Abgleich */
	files: Record<string, CloneFile>;
}

export type ChangeKind = 'modified' | 'added' | 'deleted';

export interface CloneChange {
	kind: ChangeKind;
	/** relativer Pfad mit "/" */
	relPath: string;
	remotePath: string;
}

/** Ordnername für ein Gerät: "md:" -> "md", "ud1:" -> "ud1". */
export function deviceFolder(device: string): string {
	return device.replace(/[:\\/]+$/, '').replace(/[^A-Za-z0-9_.-]+/g, '_') || 'device';
}

/** Remote-Pfad aus Gerät und relativem Pfad innerhalb des Geräts. */
export function remotePathFor(device: string, relInDevice: string): string {
	const base = device.endsWith(':') || device.endsWith('/') ? device : device + '/';
	return base + relInDevice;
}

export async function sha1File(file: string): Promise<string> {
	const buf = await fs.readFile(file);
	return crypto.createHash('sha1').update(buf).digest('hex');
}

export async function readManifest(root: string): Promise<CloneManifest | undefined> {
	try {
		const raw = await fs.readFile(path.join(root, MANIFEST_NAME), 'utf8');
		const m = JSON.parse(raw) as CloneManifest;
		return m && m.version === 1 && m.files ? m : undefined;
	} catch {
		return undefined;
	}
}

export async function writeManifest(root: string, manifest: CloneManifest): Promise<void> {
	manifest.updated = new Date().toISOString();
	await fs.writeFile(path.join(root, MANIFEST_NAME), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

/** Dateiendung ohne Punkt, klein geschrieben. */
export function extOf(name: string): string {
	const m = /\.([^./\\]+)$/.exec(name);
	return m ? m[1].toLowerCase() : '';
}

/** Filter nach Dateitypen; leere Liste = alles. */
export function matchesTypes(name: string, types: string[]): boolean {
	if (!types.length) {
		return true;
	}
	const ext = extOf(name);
	return types.some((t) => t.replace(/^\*?\./, '').toLowerCase() === ext);
}

async function walk(dir: string, rel: string, out: string[]): Promise<void> {
	let entries: import('fs').Dirent[];
	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const e of entries) {
		if (e.name.startsWith('.')) {
			continue;
		}
		const childRel = rel ? `${rel}/${e.name}` : e.name;
		if (e.isDirectory()) {
			await walk(path.join(dir, e.name), childRel, out);
		} else if (e.isFile()) {
			out.push(childRel);
		}
	}
}

/**
 * Vergleicht den Inhalt des Klon-Verzeichnisses mit dem Manifest.
 * Neue Dateien werden nur in Geräteordnern gesucht, die im Manifest stehen.
 */
export async function computeChanges(root: string, manifest: CloneManifest): Promise<CloneChange[]> {
	const changes: CloneChange[] = [];
	for (const [rel, info] of Object.entries(manifest.files)) {
		const abs = path.join(root, ...rel.split('/'));
		let sha: string | undefined;
		try {
			sha = await sha1File(abs);
		} catch {
			changes.push({ kind: 'deleted', relPath: rel, remotePath: info.remotePath });
			continue;
		}
		if (sha !== info.sha1) {
			changes.push({ kind: 'modified', relPath: rel, remotePath: info.remotePath });
		}
	}
	for (const [folder, device] of Object.entries(manifest.devices)) {
		const found: string[] = [];
		await walk(path.join(root, folder), '', found);
		for (const inDevice of found) {
			const rel = `${folder}/${inDevice}`;
			if (!manifest.files[rel]) {
				changes.push({ kind: 'added', relPath: rel, remotePath: remotePathFor(device, inDevice) });
			}
		}
	}
	const order: Record<ChangeKind, number> = { modified: 0, added: 1, deleted: 2 };
	return changes.sort((a, b) => order[a.kind] - order[b.kind] || a.relPath.localeCompare(b.relPath));
}

/** Sucht vom Pfad aufwärts nach einem Klon-Manifest. */
export async function findCloneRoot(start: string): Promise<{ root: string; manifest: CloneManifest } | undefined> {
	let dir = start;
	try {
		if (!(await fs.stat(start)).isDirectory()) {
			dir = path.dirname(start);
		}
	} catch {
		dir = path.dirname(start);
	}
	for (let i = 0; i < 6; i++) {
		const manifest = await readManifest(dir);
		if (manifest) {
			return { root: dir, manifest };
		}
		const parent = path.dirname(dir);
		if (parent === dir) {
			break;
		}
		dir = parent;
	}
	return undefined;
}

/** Herkunft einer Datei innerhalb eines Klons: Controller und Remote-Pfad. */
export async function originFromClone(localPath: string): Promise<{ controller: string; remotePath: string } | undefined> {
	const clone = await findCloneRoot(localPath);
	if (!clone) {
		return undefined;
	}
	const rel = path.relative(clone.root, localPath).split(path.sep).join('/');
	const known = clone.manifest.files[rel];
	if (known) {
		return { controller: clone.manifest.controller, remotePath: known.remotePath };
	}
	const slash = rel.indexOf('/');
	const device = slash > 0 ? clone.manifest.devices[rel.slice(0, slash)] : undefined;
	if (!device) {
		return undefined;
	}
	return { controller: clone.manifest.controller, remotePath: remotePathFor(device, rel.slice(slash + 1)) };
}
