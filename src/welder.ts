/**
 * Schweißer-Oberfläche: eigener Seitenreiter mit großen Kacheln und
 * Schritt-für-Schritt-Assistenten für Anwender ohne Programmiererfahrung.
 *
 * Die Assistenten nutzen dieselbe Logik wie die Expertenbefehle
 * (FTP, Syntaxprüfung, Spiegeln) - nur die Bedienung ist vereinfacht.
 */
import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ControllerConfig, devicesOf, getControllers, saveControllers, setPassword } from './config';
import { FanucApi } from './commands';
import * as ftp from './ftp';
import { MirrorOptions, mirrorChanges, mirrorGroups } from './mirror';
import { copyPathFor, describe as describeMirror, mirrorInPlace, reportLines, warningCount, writeMirroredCopy } from './mirrorCommand';
import { isValidProgramName, parse } from './parser';
import { parsePositions } from './posData';
import {
	WELD_SPEED_RANGE,
	findSeams,
	formatSpeed,
	scaleSeamSpeedChanges,
	seamSummary,
	setSeamSpeedChanges,
	toMmPerSec
} from './weldCore';
import { TextChange } from './textChange';
import { SECTIONS, allTiles } from './welderCatalog';
import {
	Wizard,
	backButton,
	button,
	cancelButton,
	card,
	checkCard,
	document as htmlDocument,
	esc,
	field,
	filterBox,
	list,
	message,
	num,
	page,
	radioCard,
	str
} from './welderUi';

const WIKI = 'https://github.com/frontline-networks/fanuc-ls-vscode/wiki/Schwei%C3%9Fer-Oberfl%C3%A4che';
const SAFETY = 'Vor dem Automatikbetrieb das Programm im Handbetrieb (T1) mit reduzierter Geschwindigkeit abfahren.';

/** Zuletzt aktives TP-Programm (der Assistent selbst hat den Fokus, daher merken). */
let lastProgram: vscode.Uri | undefined;
let onProgramChanged: (() => void) | undefined;
/** Zuletzt bearbeitete Datei je Sprache (für Kacheln, die eine offene Datei brauchen). */
const lastByLanguage = new Map<string, vscode.Uri>();

function setLastProgram(uri: vscode.Uri): void {
	lastProgram = uri;
	lastByLanguage.set('fanuc-ls', uri);
	onProgramChanged?.();
}

export function registerWelder(context: vscode.ExtensionContext, api: FanucApi): void {
	const home = new WelderHome();
	onProgramChanged = () => home.programChanged();
	const track = (e: vscode.TextEditor | undefined) => {
		if (e && e.document.languageId === 'fanuc-ls') {
			setLastProgram(e.document.uri);
		} else if (e && e.document.languageId === 'fanuc-karel') {
			lastByLanguage.set('fanuc-karel', e.document.uri);
		}
	};
	track(vscode.window.activeTextEditor);

	const reg = (id: string, fn: () => Promise<void>) =>
		context.subscriptions.push(
			vscode.commands.registerCommand(id, async () => {
				try {
					await fn();
				} catch (err) {
					vscode.window.showErrorMessage(`Unerwarteter Fehler: ${err instanceof Error ? err.message : String(err)}`);
				}
			})
		);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider('fanucLs.welder.home', home),
		vscode.window.onDidChangeActiveTextEditor(track),
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('fanucLs')) {
				home.refresh();
			}
		})
	);

	reg('fanucLs.welder.download', () => downloadWizard(api));
	reg('fanucLs.welder.check', () => checkWizard(api));
	reg('fanucLs.welder.speed', () => speedWizard());
	reg('fanucLs.welder.mirror', () => mirrorWizard());
	reg('fanucLs.welder.upload', () => uploadWizard(api));
	reg('fanucLs.welder.backup', () => backupWizard(api));
	reg('fanucLs.welder.setup', async () => {
		const w = new Wizard('Roboter einrichten');
		await setupRobot(w, api);
		w.close();
	});
}

// --- Startseite im Seitenreiter ---------------------------------------------------

class WelderHome implements vscode.WebviewViewProvider {
	private view?: vscode.WebviewView;

	resolveWebviewView(view: vscode.WebviewView): void {
		this.view = view;
		view.webview.options = { enableScripts: true };
		view.webview.onDidReceiveMessage(async (m: { act: string; arg?: string }) => {
			try {
				if (m.act === 'run' && m.arg) {
					await runTile(m.arg);
				} else if (m.act === 'help') {
					await vscode.env.openExternal(vscode.Uri.parse(WIKI));
				} else if (m.act === 'settings') {
					await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:frontlinenetworks.fanuc-ls');
				} else if (m.act === 'simple') {
					const cfg = vscode.workspace.getConfiguration('fanucLs');
					await cfg.update('simpleMode', !cfg.get<boolean>('simpleMode', false), vscode.ConfigurationTarget.Global);
				}
			} catch (err) {
				vscode.window.showErrorMessage(`Unerwarteter Fehler: ${err instanceof Error ? err.message : String(err)}`);
			}
		});
		view.onDidChangeVisibility(() => this.refresh());
		this.refresh();
	}

	/** Nur die Programmanzeige aktualisieren (Suche und aufgeklappte Bereiche bleiben). */
	programChanged(): void {
		void this.view?.webview.postMessage({ type: 'program', name: lastProgram ? path.basename(lastProgram.fsPath) : '' });
	}

	refresh(): void {
		if (!this.view) {
			return;
		}
		const robots = getControllers();
		const simple = vscode.workspace.getConfiguration('fanucLs').get<boolean>('simpleMode', false);
		const prog = lastProgram ? path.basename(lastProgram.fsPath) : '';
		const tile = (act: string, arg: string | undefined, icon: string, label: string, hint: string) =>
			`<button class="tile" data-act="${act}"${arg ? ` data-arg="${esc(arg)}"` : ''} title="${esc(hint)}"><span class="icon">${icon}</span><span>${esc(label)}</span></button>`;
		const sections = SECTIONS.map(
			(sec) =>
				`<details data-id="${sec.id}"${sec.open ? ' open' : ''}><summary>${esc(sec.title)}</summary><div class="tiles">${sec.tiles
					.map((t) => tile('run', t.command, t.icon, t.label, t.hint + (t.needs === 'fanuc-ls' ? ' (für das zuletzt bearbeitete Programm)' : t.needs === 'fanuc-karel' ? ' (für die zuletzt bearbeitete KAREL-Datei)' : '')))
					.join('')}</div></details>`
		).join('');
		const view =
			`<details data-id="view" open><summary>Ansicht & Hilfe</summary><div class="tiles">` +
			tile('simple', undefined, simple ? '🧰' : '🙈', simple ? 'Experten­ansicht ein' : 'Experten­ansicht aus', simple ? 'Controller-Baum, Sprungmarken, E/A und alle Menüs wieder einblenden' : 'Nur diese Oberfläche anzeigen (einfacher Modus)') +
			tile('settings', undefined, '⚙️', 'Einstellungen', 'Alle Einstellungen der Extension') +
			tile('help', undefined, '❓', 'Hilfe', 'Anleitung im Wiki öffnen') +
			`</div></details>`;
		const body = `
			<div class="status">📝 <span class="prog">${prog ? esc(prog) : 'kein Programm geöffnet'}</span><br>🤖 ${robots.length ? esc(robots.map((r) => r.name).join(', ')) : 'noch kein Roboter eingerichtet'}</div>
			${robots.length === 0 ? `<div class="tiles">${tile('run', 'fanucLs.welder.setup', '🤖', 'Roboter einrichten', 'Zuerst den Roboter einrichten')}</div>` : ''}
			<input class="search" type="search" placeholder="Funktion suchen …">
			${sections}${view}`;
		this.view.webview.html = htmlDocument('Schweißen', body, HOME_SCRIPT).replace('<body>', '<body class="home">');
	}
}

const HOME_SCRIPT = `
const st = vscode.getState() || { open: {}, q: '' };
const q = document.querySelector('input.search');
document.querySelectorAll('details[data-id]').forEach((d) => {
	if (d.dataset.id in st.open) d.open = st.open[d.dataset.id];
	d.addEventListener('toggle', () => {
		if (q.value.trim()) return;
		st.open[d.dataset.id] = d.open;
		vscode.setState(st);
	});
});
function applyFilter() {
	const v = q.value.toLowerCase().trim();
	st.q = q.value;
	vscode.setState(st);
	document.querySelectorAll('.tile').forEach((t) => {
		t.style.display = !v || (t.textContent + ' ' + t.title).toLowerCase().includes(v) ? '' : 'none';
	});
	document.querySelectorAll('details[data-id]').forEach((d) => {
		const any = [...d.querySelectorAll('.tile')].some((t) => t.style.display !== 'none');
		d.style.display = any ? '' : 'none';
		if (v) d.open = true;
		else d.open = d.dataset.id in st.open ? st.open[d.dataset.id] : d.hasAttribute('data-default-open');
	});
}
document.querySelectorAll('details[open]').forEach((d) => d.setAttribute('data-default-open', ''));
q.value = st.q || '';
q.addEventListener('input', applyFilter);
if (q.value) applyFilter();
window.addEventListener('message', (e) => {
	if (e.data.type === 'program') {
		document.querySelectorAll('.prog').forEach((el) => (el.textContent = e.data.name || 'kein Programm geöffnet'));
	}
});
document.body.classList.remove('busy');
`;

/** Kachel ausführen: bei Bedarf vorher das zuletzt bearbeitete Programm in den Vordergrund holen. */
async function runTile(command: string): Promise<void> {
	const t = allTiles().find((x) => x.command === command);
	if (t?.needs) {
		const uri = lastByLanguage.get(t.needs);
		if (!uri) {
			const what = t.needs === 'fanuc-karel' ? 'eine KAREL-Datei (.kl)' : 'ein Programm';
			const choice = await vscode.window.showWarningMessage(
				`Dafür muss zuerst ${what} geöffnet sein.`,
				...(t.needs === 'fanuc-ls' ? ['Programm vom Roboter holen'] : []),
				'Datei öffnen …'
			);
			if (choice === 'Programm vom Roboter holen') {
				await vscode.commands.executeCommand('fanucLs.welder.download');
			} else if (choice) {
				const picked = await vscode.window.showOpenDialog({
					canSelectMany: false,
					filters: t.needs === 'fanuc-karel' ? { KAREL: ['kl', 'KL'] } : { 'TP-Programme': ['ls', 'LS'] }
				});
				if (picked?.[0]) {
					await vscode.window.showTextDocument(picked[0], { preview: false });
				}
			}
			return;
		}
		await vscode.window.showTextDocument(uri, { preview: false });
	}
	await vscode.commands.executeCommand(command);
}

// --- gemeinsame Schritte -------------------------------------------------------------

type Pick<T> = { value: T } | 'back' | undefined;

/** Programm auswählen: aktuelles, geöffnete und Programme im Arbeitsbereich. */
async function pickProgram(w: Wizard, progress: [number, number], question: string, allowBack = false): Promise<Pick<vscode.TextDocument>> {
	const uris = new Map<string, vscode.Uri>();
	if (lastProgram) {
		uris.set(lastProgram.toString(), lastProgram);
	}
	for (const d of vscode.workspace.textDocuments) {
		if (d.languageId === 'fanuc-ls') {
			uris.set(d.uri.toString(), d.uri);
		}
	}
	for (const u of await vscode.workspace.findFiles('**/*.[lL][sS]', '**/node_modules/**', 300)) {
		uris.set(u.toString(), u);
	}
	const all = [...uris.values()];
	const cards = all
		.map((u, i) => {
			const current = lastProgram && u.toString() === lastProgram.toString();
			const where = u.scheme === 'file' ? vscode.workspace.asRelativePath(u) : 'nicht gespeichert';
			return card(current ? '📝' : '📄', path.basename(u.fsPath).replace(/\.ls$/i, ''), (current ? '<b>zuletzt bearbeitet</b> · ' : '') + esc(where), 'pick', String(i), 'compact filterable');
		})
		.join('');
	for (;;) {
		const r = await w.step(
			page({
				progress,
				title: question,
				intro: all.length ? 'Auf das Programm klicken.' : 'Im geöffneten Ordner wurde kein Programm (.LS) gefunden.',
				content: (all.length > 8 ? filterBox('Programmname suchen …') : '') + cards,
				buttons: (allowBack ? backButton() : '') + button('📂 Andere Datei auswählen …', 'browse') + cancelButton()
			})
		);
		if (r.act === 'cancel') {
			return undefined;
		}
		if (r.act === 'back') {
			return 'back';
		}
		let uri: vscode.Uri | undefined;
		if (r.act === 'browse') {
			uri = (
				await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Auswählen', filters: { 'TP-Programme': ['ls', 'LS'] } })
			)?.[0];
		} else if (r.act === 'pick') {
			uri = all[Number(r.arg)];
		}
		if (uri) {
			const doc = await vscode.workspace.openTextDocument(uri);
			if (doc.languageId !== 'fanuc-ls') {
				await vscode.languages.setTextDocumentLanguage(doc, 'fanuc-ls');
			}
			await vscode.window.showTextDocument(doc, { viewColumn: w.editorColumn, preview: false, preserveFocus: true });
			setLastProgram(doc.uri);
			return { value: doc };
		}
	}
}

/** Roboter auswählen (bei Bedarf zuerst einrichten). */
async function pickRobot(w: Wizard, api: FanucApi, progress: [number, number], question: string): Promise<Pick<ControllerConfig>> {
	for (;;) {
		const robots = getControllers();
		const r = await w.step(
			page({
				progress,
				title: question,
				intro: robots.length ? 'Auf den Roboter klicken.' : 'Es ist noch kein Roboter eingerichtet.',
				content:
					robots.map((c, i) => card('🤖', c.name, `IP-Adresse ${esc(c.host)}`, 'pick', String(i))).join('') +
					card('➕', 'Neuen Roboter einrichten', 'IP-Adresse eintragen und Verbindung testen', 'setup', undefined, 'compact'),
				buttons: cancelButton()
			})
		);
		if (r.act === 'cancel') {
			return undefined;
		}
		if (r.act === 'pick') {
			return { value: robots[Number(r.arg)] };
		}
		if (r.act === 'setup') {
			const created = await setupRobot(w, api);
			if (w.closed) {
				return undefined;
			}
			if (created) {
				return { value: created };
			}
		}
	}
}

function tpLineLabel(doc: vscode.TextDocument, line: number): string {
	const m = /^\s*(\d+):/.exec(doc.lineAt(Math.min(line, doc.lineCount - 1)).text);
	return m ? `Zeile ${m[1]}` : `Dateizeile ${line + 1}`;
}

async function reveal(w: Wizard, doc: vscode.TextDocument, line: number): Promise<void> {
	const editor = await vscode.window.showTextDocument(doc, { viewColumn: w.editorColumn, preview: false });
	const pos = new vscode.Position(line, 0);
	editor.selection = new vscode.Selection(pos, pos);
	editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
}

function issueList(doc: vscode.TextDocument, diags: vscode.Diagnostic[]): string {
	return `<ul class="issues">${diags
		.sort((a, b) => a.range.start.line - b.range.start.line)
		.map((d) => `<li><b>${button(esc(tpLineLabel(doc, d.range.start.line)), 'goto', { arg: String(d.range.start.line) }).replace('class="secondary"', 'class="link"')}</b><span>${esc(d.message)}</span></li>`)
		.join('')}</ul>`;
}

function programFacts(doc: vscode.TextDocument): string {
	const p = parse(doc.getText());
	const comment = p.attrs.get('COMMENT')?.value.replace(/^"|"$/g, '');
	const seams = findSeams(doc.getText()).length;
	return `<table>
		<tr><th>Programm</th><td><b>${esc(p.progName ?? '?')}</b>${comment ? ` – ${esc(comment)}` : ''}</td></tr>
		<tr><th>Zeilen</th><td>${p.tpLines.length}</td></tr>
		<tr><th>Schweißnähte</th><td>${seams}</td></tr>
		<tr><th>Positionen</th><td>${p.positions.filter((x) => x.kind === 'P').length}</td></tr>
	</table>`;
}

async function applyChangesToDoc(doc: vscode.TextDocument, changes: TextChange[]): Promise<void> {
	const edit = new vscode.WorkspaceEdit();
	edit.set(
		doc.uri,
		changes.map((c) => vscode.TextEdit.replace(new vscode.Range(c.line, c.start, c.endLine ?? c.line, c.end), c.text))
	);
	await vscode.workspace.applyEdit(edit);
	if (!doc.isUntitled) {
		await doc.save();
	}
}

/** Abschlussseite mit weiteren sinnvollen Schritten. */
async function finish(w: Wizard, title: string, content: string, next: ('speed' | 'mirror' | 'check' | 'upload')[]): Promise<void> {
	const tiles: Record<string, string> = {
		speed: card('🔥', 'Schweißgeschwindigkeit ändern', '', 'next', 'fanucLs.welder.speed', 'compact'),
		mirror: card('🪞', 'Programm spiegeln', '', 'next', 'fanucLs.welder.mirror', 'compact'),
		check: card('✅', 'Programm prüfen', '', 'next', 'fanucLs.welder.check', 'compact'),
		upload: card('📤', 'Auf Roboter laden', '', 'next', 'fanucLs.welder.upload', 'compact')
	};
	const r = await w.step(
		page({
			title,
			content: content + (next.length ? `<h2>Wie geht es weiter?</h2>${next.map((n) => tiles[n]).join('')}` : ''),
			buttons: button('Fertig', 'done', { primary: true })
		})
	);
	w.close();
	if (r.act === 'next' && r.arg) {
		await vscode.commands.executeCommand(r.arg);
	}
}

function ftpErrorText(err: unknown): string {
	const msg = err instanceof Error ? err.message : String(err);
	return `Der Roboter antwortet nicht oder hat die Anfrage abgelehnt.<br><small>${esc(msg)}</small><br><br>Bitte prüfen:<br>• Ist der PC mit dem Roboternetz verbunden (Netzwerkkabel)?<br>• Stimmt die IP-Adresse?<br>• Ist die Steuerung eingeschaltet?`;
}

function formatDate(s: string): string {
	const d = new Date(s);
	return isNaN(d.getTime()) ? s : d.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
}

/** Ordnername aus Robotername bzw. Gerät (Umlaute bleiben, "md:" -> "md"). */
function sanitize(s: string): string {
	return s.replace(/:$/, '').replace(/[^\p{L}\p{N}_. ()-]+/gu, '_').trim();
}

async function exists(file: string): Promise<boolean> {
	try {
		await fs.access(file);
		return true;
	} catch {
		return false;
	}
}

// --- Roboter einrichten ------------------------------------------------------------------

async function setupRobot(w: Wizard, api: FanucApi): Promise<ControllerConfig | undefined> {
	let values = { name: getControllers().length ? '' : 'Roboter 1', host: '', password: '' };
	let error: string | undefined;
	for (;;) {
		const r = await w.step(
			page({
				progress: [1, 2],
				title: 'Roboter einrichten',
				intro: 'Die IP-Adresse steht am Programmierhandgerät unter <b>MENU → SETUP → Host Comm → TCP/IP</b>.',
				error,
				content:
					field('Name', 'name', values.name, { placeholder: 'z. B. Schweißzelle 1', hint: 'Frei wählbar – so erscheint der Roboter in der Liste.' }) +
					field('IP-Adresse', 'host', values.host, { placeholder: '192.168.0.10' }) +
					field('Passwort', 'password', values.password, { type: 'password', hint: 'Nur nötig, wenn am Roboter ein FTP-Passwort eingerichtet ist – sonst leer lassen.' }),
				buttons: button('Verbindung testen und speichern', 'next', { primary: true }) + cancelButton()
			})
		);
		if (r.act === 'cancel') {
			return undefined;
		}
		values = { name: str(r.values.name), host: str(r.values.host), password: str(r.values.password) };
		if (!values.name) {
			error = 'Bitte einen Namen eingeben.';
			continue;
		}
		if (!/^[A-Za-z0-9.-]+$/.test(values.host)) {
			error = 'Bitte eine gültige IP-Adresse eingeben, z. B. 192.168.0.10';
			continue;
		}
		if (getControllers().some((c) => c.name === values.name)) {
			error = `Den Namen „${esc(values.name)}“ gibt es schon. Bitte einen anderen wählen.`;
			continue;
		}
		const cfg: ControllerConfig = { name: values.name, host: values.host, port: 21, user: 'anonymous' };
		await setPassword(api.secrets, cfg, values.password);
		w.busy(`Verbindung zu ${values.host} wird getestet …`);
		let ok = true;
		let detail = '';
		try {
			await ftp.ping(cfg, api.secrets);
		} catch (err) {
			ok = false;
			detail = ftpErrorText(err);
		}
		if (!ok) {
			const r2 = await w.step(
				page({
					progress: [2, 2],
					title: 'Keine Verbindung',
					content: message('error', detail),
					buttons: backButton() + button('Trotzdem speichern', 'save') + cancelButton()
				})
			);
			if (r2.act === 'back') {
				error = undefined;
				continue;
			}
			if (r2.act !== 'save') {
				await setPassword(api.secrets, cfg, '');
				return undefined;
			}
		}
		await saveControllers([...getControllers(), cfg]);
		api.refresh();
		vscode.window.showInformationMessage(`Roboter „${cfg.name}“ eingerichtet${ok ? ' – Verbindung OK' : ''}.`);
		return cfg;
	}
}

// --- Programm vom Roboter holen ---------------------------------------------------------

async function downloadWizard(api: FanucApi): Promise<void> {
	const w = new Wizard('Programm holen');
	const robot = await pickRobot(w, api, [1, 3], 'Von welchem Roboter?');
	if (!robot || robot === 'back') {
		return w.close();
	}
	const c = robot.value;
	const device = devicesOf(c)[0] ?? 'md:';

	for (;;) {
		w.busy(`Programmliste von ${c.name} wird geladen …`);
		let entries: ftp.RemoteEntry[];
		try {
			entries = (await ftp.list(c, api.secrets, device)).filter((e) => !e.isDirectory && /\.ls$/i.test(e.name));
		} catch (err) {
			const r = await w.step(page({ title: 'Keine Verbindung', content: message('error', ftpErrorText(err)), buttons: button('Erneut versuchen', 'retry', { primary: true }) + cancelButton() }));
			if (r.act === 'retry') {
				continue;
			}
			return w.close();
		}
		entries.sort((a, b) => a.name.localeCompare(b.name));
		const r = await w.step(
			page({
				progress: [2, 3],
				title: 'Welches Programm?',
				intro: `${entries.length} Programme auf ${esc(c.name)}.`,
				content: filterBox('Programmname suchen …') + entries.map((e, i) => card('📄', e.name.replace(/\.ls$/i, ''), e.modified ? `geändert ${esc(formatDate(e.modified))}` : '', 'pick', String(i), 'compact filterable')).join(''),
				buttons: button('🔄 Liste neu laden', 'retry') + cancelButton()
			})
		);
		if (r.act === 'retry') {
			continue;
		}
		if (r.act !== 'pick') {
			return w.close();
		}
		const entry = entries[Number(r.arg)];
		const baseDir = await api.resolveDownloadDir();
		if (!baseDir) {
			return w.close();
		}
		const dir = path.join(baseDir, sanitize(c.name));
		const local = path.join(dir, entry.name);
		const remotePath = ftp.joinRemote(device, entry.name);

		if (await exists(local)) {
			const r2 = await w.step(
				page({
					progress: [3, 3],
					title: `${entry.name.replace(/\.ls$/i, '')} ist schon auf dem PC`,
					content: message('warn', `Es gibt bereits eine Kopie:<br><code>${esc(vscode.workspace.asRelativePath(local))}</code><br>Soll sie durch den aktuellen Stand vom Roboter ersetzt werden? Änderungen am PC gehen dabei verloren.`),
					buttons: button('Vom Roboter holen (ersetzen)', 'replace', { primary: true }) + button('Kopie am PC öffnen', 'open') + cancelButton()
				})
			);
			if (r2.act === 'cancel') {
				return w.close();
			}
			if (r2.act === 'open') {
				await openProgram(w, local);
				return finish(w, 'Programm geöffnet', message('ok', `<b>${esc(entry.name)}</b> ist links geöffnet (Kopie vom PC).`), ['speed', 'mirror', 'check', 'upload']);
			}
		}

		w.busy(`${entry.name} wird geholt …`);
		try {
			await fs.mkdir(dir, { recursive: true });
			await ftp.downloadToFile(c, api.secrets, remotePath, local);
		} catch (err) {
			const r3 = await w.step(page({ title: 'Holen fehlgeschlagen', content: message('error', ftpErrorText(err)), buttons: button('Erneut versuchen', 'retry', { primary: true }) + cancelButton() }));
			if (r3.act === 'retry') {
				continue;
			}
			return w.close();
		}
		api.rememberOrigin(local, { controller: c.name, remotePath });
		await openProgram(w, local);
		return finish(
			w,
			'Programm geholt',
			message('ok', `<b>${esc(entry.name)}</b> von ${esc(c.name)} ist jetzt links geöffnet.<br><small>Gespeichert unter ${esc(vscode.workspace.asRelativePath(local))}</small>`),
			['speed', 'mirror', 'check', 'upload']
		);
	}
}

async function openProgram(w: Wizard, file: string): Promise<void> {
	const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
	await vscode.window.showTextDocument(doc, { viewColumn: w.editorColumn, preview: false, preserveFocus: true });
	setLastProgram(doc.uri);
}

// --- Programm prüfen -----------------------------------------------------------------------------

async function checkWizard(api: FanucApi): Promise<void> {
	const w = new Wizard('Programm prüfen');
	const picked = await pickProgram(w, [1, 2], 'Welches Programm prüfen?');
	if (!picked || picked === 'back') {
		return w.close();
	}
	const doc = picked.value;
	for (;;) {
		w.busy('Programm wird geprüft …');
		const diags = await api.check(doc);
		const errors = diags.filter((d) => d.severity === vscode.DiagnosticSeverity.Error);
		const hints = diags.filter((d) => d.severity !== vscode.DiagnosticSeverity.Error);
		const content =
			programFacts(doc) +
			(errors.length === 0
				? message('ok', hints.length ? `<b>Keine Fehler.</b> Es gibt ${hints.length} Hinweis(e) – das Programm kann trotzdem geladen werden.` : '<b>Alles in Ordnung.</b> Das Programm kann auf den Roboter geladen werden.')
				: message('error', `<b>${errors.length} Fehler</b> – so lässt sich das Programm nicht auf den Roboter laden. Auf die Zeile klicken, um sie anzuzeigen.`)) +
			(errors.length ? `<h2>Muss behoben werden</h2>${issueList(doc, errors)}` : '') +
			(hints.length ? `<h2>Hinweise</h2>${issueList(doc, hints)}` : '');
		const r = await w.step(
			page({
				progress: [2, 2],
				title: `Prüfergebnis: ${path.basename(doc.uri.fsPath)}`,
				content,
				buttons: (errors.length === 0 ? button('📤 Auf Roboter laden', 'upload', { primary: true }) : '') + button('🔄 Erneut prüfen', 'again', { primary: errors.length > 0 }) + button('Fertig', 'cancel')
			})
		);
		if (r.act === 'goto') {
			await reveal(w, doc, Number(r.arg));
			continue;
		}
		if (r.act === 'again') {
			continue;
		}
		w.close();
		if (r.act === 'upload') {
			await vscode.commands.executeCommand('fanucLs.welder.upload');
		}
		return;
	}
}

// --- Schweißgeschwindigkeit ------------------------------------------------------------------

async function speedWizard(): Promise<void> {
	const w = new Wizard('Schweißgeschwindigkeit');
	const total = 4;
	let doc: vscode.TextDocument | undefined;
	let selected: number[] = [];
	let mode = 'set';
	let speedIn = '';
	let percentIn = '+10';
	let step = 1;
	let error: string | undefined;

	for (;;) {
		if (step === 1) {
			const p = await pickProgram(w, [1, total], 'In welchem Programm?');
			if (!p || p === 'back') {
				return w.close();
			}
			doc = p.value;
			selected = [];
			step = 2;
			continue;
		}
		const seams = findSeams(doc!.getText());
		if (step === 2) {
			if (seams.length === 0) {
				const r = await w.step(
					page({
						progress: [2, total],
						title: 'Keine Schweißnaht gefunden',
						content: message('warn', 'In diesem Programm gibt es keine Naht (Befehle <code>Arc Start</code> … <code>Arc End</code>).'),
						buttons: backButton() + cancelButton()
					})
				);
				if (r.act === 'back') {
					step = 1;
					continue;
				}
				return w.close();
			}
			if (selected.length === 0) {
				selected = seams.map((s) => s.number);
			}
			const r = await w.step(
				page({
					progress: [2, total],
					title: 'Welche Nähte ändern?',
					intro: 'Haken setzen bei allen Nähten, deren Geschwindigkeit geändert werden soll.',
					error,
					content: seams
						.map((s) =>
							checkCard(
								'seam',
								String(s.number),
								`Naht ${s.number}`,
								esc(seamSummary(s)) + (s.schedule ? ` · Schweißprozedur ${esc(s.schedule)}` : '') + (s.weave ? ` · ${esc(s.weave)}` : '') + (s.moves.some((m) => m.speed === undefined) ? '<br>⚠️ enthält Bewegungen mit Geschwindigkeit aus Register/Prozedur – diese bleiben unverändert' : ''),
								selected.includes(s.number)
							)
						)
						.join(''),
					buttons: backButton() + button('Weiter →', 'next', { primary: true }) + cancelButton()
				})
			);
			error = undefined;
			if (r.act === 'cancel') {
				return w.close();
			}
			selected = list(r.values.seam).map(Number);
			if (r.act === 'back') {
				step = 1;
				continue;
			}
			if (selected.length === 0) {
				error = 'Bitte mindestens eine Naht auswählen.';
				continue;
			}
			if (!seams.some((s) => selected.includes(s.number) && s.moves.some((m) => m.speed !== undefined && m.type !== 'J'))) {
				error = 'Die gewählten Nähte haben keine Geschwindigkeit als Zahl (z. B. <code>WELD_SPEED</code> oder Register). Diese wird in der Schweißprozedur am Roboter eingestellt.';
				continue;
			}
			step = 3;
			continue;
		}
		const chosen = seams.filter((s) => selected.includes(s.number));
		const moves = chosen.flatMap((s) => s.moves.filter((m) => m.speed !== undefined && m.type !== 'J').map((m) => ({ seam: s.number, m })));
		const units = [...new Set(moves.map((x) => x.m.unit!))];
		if (step === 3) {
			if (!speedIn) {
				speedIn = formatSpeed(moves[0].m.speed!);
			}
			const r = await w.step(
				page({
					progress: [3, total],
					title: 'Neue Geschwindigkeit',
					intro: `Bisher: ${esc([...new Set(moves.map((x) => `${formatSpeed(x.m.speed!)} ${x.m.unit}`))].join(', '))}`,
					error,
					content:
						radioCard('mode', 'set', 'Auf einen festen Wert setzen', 'Alle gewählten Nähte bekommen dieselbe Geschwindigkeit.', mode === 'set') +
						field('Neue Geschwindigkeit', 'speed', speedIn, { unit: units.length === 1 ? units[0] : 'in der jeweiligen Einheit' }) +
						radioCard('mode', 'scale', 'Um Prozent schneller/langsamer', 'z. B. +10 = 10 % schneller, -5 = 5 % langsamer. Unterschiedliche Geschwindigkeiten bleiben im Verhältnis erhalten.', mode === 'scale') +
						field('Änderung', 'percent', percentIn, { unit: '%' }),
					buttons: backButton() + button('Vorschau →', 'next', { primary: true }) + cancelButton()
				})
			);
			error = undefined;
			if (r.act === 'cancel') {
				return w.close();
			}
			mode = str(r.values.mode) || 'set';
			speedIn = str(r.values.speed);
			percentIn = str(r.values.percent);
			if (r.act === 'back') {
				step = 2;
				continue;
			}
			if (mode === 'set' && !(num(speedIn)! > 0)) {
				error = 'Bitte eine Geschwindigkeit größer als 0 eingeben (z. B. 8 oder 8,5).';
				continue;
			}
			if (mode === 'scale' && (num(percentIn) === undefined || num(percentIn)! <= -100 || num(percentIn) === 0)) {
				error = 'Bitte eine Prozentzahl eingeben, z. B. +10 oder -5.';
				continue;
			}
			step = 4;
			continue;
		}
		// step 4: Vorschau
		const changes = mode === 'set' ? setSeamSpeedChanges(seams, selected, num(speedIn)!) : scaleSeamSpeedChanges(seams, selected, num(percentIn)!);
		const newOf = (line: number) => changes.find((c) => c.line === line)?.text;
		const unusual = moves.filter((x) => {
			const v = toMmPerSec(Number(newOf(x.m.line)), x.m.unit!);
			return v < WELD_SPEED_RANGE.min || v > WELD_SPEED_RANGE.max;
		});
		const rows = moves
			.map((x) => `<tr><td>Naht ${x.seam}</td><td>Zeile ${x.m.tpNum}</td><td>${formatSpeed(x.m.speed!)} ${esc(x.m.unit)}</td><td class="new">${esc(newOf(x.m.line))} ${esc(x.m.unit)}</td></tr>`)
			.join('');
		const r = await w.step(
			page({
				progress: [4, total],
				title: 'Vorschau – bitte prüfen',
				intro: `${changes.length} Bewegung(en) in ${path.basename(doc!.uri.fsPath)} werden geändert. Alles andere bleibt, wie es ist.`,
				content:
					`<table><tr><th>Naht</th><th>Zeile</th><th>bisher</th><th>neu</th></tr>${rows}</table>` +
					(unusual.length ? message('warn', `Ungewöhnliche Schweißgeschwindigkeit (üblich ca. ${WELD_SPEED_RANGE.min}–${WELD_SPEED_RANGE.max} mm/sec). Bitte Eingabe prüfen.`) : ''),
				buttons: backButton() + button('✔ Übernehmen', 'apply', { primary: true }) + cancelButton()
			})
		);
		if (r.act === 'back') {
			step = 3;
			continue;
		}
		if (r.act !== 'apply') {
			return w.close();
		}
		await applyChangesToDoc(doc!, changes);
		return finish(
			w,
			'Geschwindigkeit geändert',
			message('ok', `${changes.length} Bewegung(en) geändert und gespeichert.<br><small>Rückgängig machen: im Programmfenster <b>Strg+Z</b> drücken.</small>`) + message('info', SAFETY),
			['check', 'upload']
		);
	}
}

// --- Spiegeln -----------------------------------------------------------------------------

async function mirrorWizard(): Promise<void> {
	const w = new Wizard('Programm spiegeln');
	const total = 5;
	let doc: vscode.TextDocument | undefined;
	let group: number | undefined;
	let values: Record<string, string | string[]> = {};
	let target = 'copy';
	let newName = '';
	let step = 1;
	let error: string | undefined;

	for (;;) {
		if (step === 1) {
			const p = await pickProgram(w, [1, total], 'Welches Programm spiegeln?');
			if (!p || p === 'back') {
				return w.close();
			}
			doc = p.value;
			group = undefined;
			values = {};
			newName = `${parse(doc.getText()).progName ?? path.basename(doc.uri.fsPath).replace(/\.[^.]+$/, '')}_M`.slice(0, 36);
			step = 2;
			continue;
		}
		const groups = mirrorGroups(parsePositions(doc!.getText()));
		if (groups.length === 0) {
			const r = await w.step(page({ title: 'Keine Positionen', content: message('warn', 'Das Programm enthält keine Positionen, die gespiegelt werden können.'), buttons: backButton() + cancelButton() }));
			if (r.act === 'back') {
				step = 1;
				continue;
			}
			return w.close();
		}
		if (step === 2) {
			if (groups.length === 1) {
				group = groups[0].group;
				step = 3;
				continue;
			}
			const r = await w.step(
				page({
					progress: [2, total],
					title: 'Was soll gespiegelt werden?',
					intro: 'Nur die gewählte Bewegungsgruppe wird gespiegelt – alle anderen (z. B. Positionierer oder Lineareinheit) bleiben genau so, wie sie sind.',
					content: groups
						.map((g) =>
							card(
								g.group === 1 ? '🤖' : '⚙️',
								`Gruppe ${g.group}${g.group === 1 ? ' (meist der Roboter)' : ''}`,
								`${g.kind === 'cartesian' ? 'kartesisch (X, Y, Z …)' : g.kind === 'joint' ? 'Achswerte ' + esc(g.axes.map((a) => a.name).join(', ')) : 'gemischt'} · ${g.positions} Position(en)${g.extAxes.length ? ' · Zusatzachsen ' + esc(g.extAxes.map((a) => a.name).join(', ')) : ''}`,
								'pick',
								String(g.group)
							)
						)
						.join(''),
					buttons: backButton() + cancelButton()
				})
			);
			if (r.act === 'back') {
				step = 1;
				continue;
			}
			if (r.act !== 'pick') {
				return w.close();
			}
			if (Number(r.arg) !== group) {
				values = {};
			}
			group = Number(r.arg);
			step = 3;
			continue;
		}
		const g = groups.find((x) => x.group === group)!;
		const axisCandidates = [...(g.kind !== 'cartesian' ? g.axes.filter((a) => /^J\d+$/.test(a.name)) : []), ...g.extAxes];
		const buildOptions = (): MirrorOptions | string => {
			const opts: MirrorOptions = { group: g.group };
			if (g.kind !== 'joint') {
				const plane = str(values.plane) || 'XZ';
				const off = num(values.offset ?? '0');
				if (off === undefined) {
					return 'Bitte für die Lage der Spiegelebene eine Zahl eingeben (0, wenn unklar).';
				}
				opts.plane = plane as 'XZ' | 'YZ';
				opts.offset = off;
			}
			const axes: Record<string, number> = {};
			for (const name of list(values.axes)) {
				const c = num(values[`center_${name}`] ?? '0');
				if (c === undefined) {
					return `Bitte für ${esc(name)} einen Mittelwert eingeben.`;
				}
				axes[name] = c;
			}
			if (g.kind === 'joint' && Object.keys(axes).length === 0) {
				return 'Bitte mindestens eine Achse auswählen.';
			}
			if (Object.keys(axes).length) {
				opts.axes = axes;
			}
			return opts;
		};
		if (step === 3) {
			const plane = str(values.plane) || 'XZ';
			const checkedAxes = values.axes ? list(values.axes) : g.kind === 'joint' ? ['J1'] : [];
			const r = await w.step(
				page({
					progress: [3, total],
					title: 'Wie spiegeln?',
					intro: g.kind !== 'joint' ? 'Die Spiegelebene liegt im Benutzer-Koordinatensystem (UF) der Positionen.' : 'Die Werte werden um einen Mittelwert gespiegelt: neu = 2 × Mitte − alt.',
					error,
					content:
						(g.kind !== 'joint'
							? radioCard('plane', 'XZ', 'Links ↔ rechts tauschen', 'Y-Werte werden gespiegelt (Spiegelebene XZ). Die Brennerneigung wird mit angepasst.', plane === 'XZ') +
								radioCard('plane', 'YZ', 'Vorne ↔ hinten tauschen', 'X-Werte werden gespiegelt (Spiegelebene YZ). Die Brennerneigung wird mit angepasst.', plane === 'YZ') +
								field('Lage der Spiegelebene', 'offset', str(values.offset) || '0', { unit: 'mm', hint: 'Abstand der Ebene vom Nullpunkt des UF (Y bzw. X). Liegt die Bauteilmitte bei Y = 250, hier 250 eintragen.' })
							: '') +
						(axisCandidates.length
							? `<h2>${g.kind === 'joint' ? 'Welche Achsen spiegeln?' : 'Zusatzachsen ebenfalls spiegeln? (optional)'}</h2>` +
								axisCandidates
									.map((a) => checkCard('axes', a.name, a.name, `Mittelwert, um den gespiegelt wird:`, checkedAxes.includes(a.name)) + field(`Mitte ${a.name}`, `center_${a.name}`, str(values[`center_${a.name}`]) || '0', { unit: a.unit }))
									.join('')
							: ''),
					buttons: backButton() + button('Weiter →', 'next', { primary: true }) + cancelButton()
				})
			);
			error = undefined;
			if (r.act === 'cancel') {
				return w.close();
			}
			values = r.values;
			if (r.act === 'back') {
				step = groups.length === 1 ? 1 : 2;
				continue;
			}
			const o = buildOptions();
			if (typeof o === 'string') {
				error = o;
				continue;
			}
			step = 4;
			continue;
		}
		if (step === 4) {
			const r = await w.step(
				page({
					progress: [4, total],
					title: 'Wohin mit dem Ergebnis?',
					error,
					content:
						radioCard('target', 'copy', 'Als neues Programm speichern (empfohlen)', 'Das Original bleibt unverändert.', target === 'copy') +
						field('Name des neuen Programms', 'name', newName, { hint: 'Nur Buchstaben, Ziffern und _ (max. 36 Zeichen).' }) +
						radioCard('target', 'inplace', 'Dieses Programm direkt ändern', 'Rückgängig mit Strg+Z im Programmfenster.', target === 'inplace'),
					buttons: backButton() + button('Vorschau →', 'next', { primary: true }) + cancelButton()
				})
			);
			error = undefined;
			if (r.act === 'cancel') {
				return w.close();
			}
			target = str(r.values.target) || 'copy';
			newName = str(r.values.name).toUpperCase();
			if (r.act === 'back') {
				step = 3;
				continue;
			}
			if (target === 'copy' && (!isValidProgramName(newName) || newName.length > 36)) {
				error = 'Ungültiger Programmname: nur Buchstaben, Ziffern und _ (max. 36 Zeichen).';
				continue;
			}
			step = 5;
			continue;
		}
		// step 5: Vorschau
		const opts = buildOptions() as MirrorOptions;
		const { report } = mirrorChanges(doc!.getText(), opts);
		const file = target === 'copy' ? copyPathFor(doc!, newName) : undefined;
		const overwrite = file && (await exists(file));
		const r = await w.step(
			page({
				progress: [5, total],
				title: 'Vorschau – bitte prüfen',
				content:
					(report.mirrored.length
						? message('ok', `<b>${report.mirrored.length} Position(en)</b> in Gruppe ${g.group} werden gespiegelt. Alle anderen Gruppen bleiben unverändert.`)
						: message('error', `In Gruppe ${g.group} wird keine Position gespiegelt – bitte Einstellungen prüfen.`)) +
					(warningCount(report) ? message('warn', `${warningCount(report)} Stelle(n) müssen von Hand geprüft werden (siehe unten).`) : '') +
					(overwrite ? message('warn', `Das Programm <b>${esc(newName)}</b> gibt es schon am PC – es wird ersetzt.`) : '') +
					`<ul>${reportLines(opts, report).map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`,
				buttons: backButton() + (report.mirrored.length ? button('🪞 Jetzt spiegeln', 'apply', { primary: true }) : '') + cancelButton()
			})
		);
		if (r.act === 'back') {
			step = 4;
			continue;
		}
		if (r.act !== 'apply') {
			return w.close();
		}
		let resultName: string;
		if (target === 'inplace') {
			await mirrorInPlace(doc!, opts);
			if (!doc!.isUntitled) {
				await doc!.save();
			}
			resultName = path.basename(doc!.uri.fsPath);
		} else {
			const res = await writeMirroredCopy(doc!, opts, newName);
			const d = await vscode.workspace.openTextDocument(res.uri);
			await vscode.window.showTextDocument(d, { viewColumn: w.editorColumn, preview: false, preserveFocus: true });
			setLastProgram(d.uri);
			resultName = path.basename(res.uri.fsPath);
		}
		return finish(
			w,
			'Gespiegelt',
			message('ok', `${esc(describeMirror(opts))} – Ergebnis: <b>${esc(resultName)}</b> (links geöffnet).`) + message('warn', 'Gespiegelte Bahnen unbedingt am Roboter kontrollieren: Brennerstellung, Achsstellungen (CONFIG) und Störkonturen. ' + SAFETY),
			['check', 'upload']
		);
	}
}

// --- Auf Roboter laden ------------------------------------------------------------------------

async function uploadWizard(api: FanucApi): Promise<void> {
	const w = new Wizard('Auf Roboter laden');
	const total = 4;
	let step = 1;
	let doc: vscode.TextDocument | undefined;
	let robotName: string | undefined;

	for (;;) {
		if (step === 1) {
			const p = await pickProgram(w, [1, total], 'Welches Programm laden?');
			if (!p || p === 'back') {
				return w.close();
			}
			doc = p.value;
			step = 2;
			continue;
		}
		if (doc!.isUntitled) {
			const r = await w.step(page({ title: 'Programm ist nicht gespeichert', content: message('warn', 'Bitte das Programm zuerst speichern (Strg+S).'), buttons: backButton() + cancelButton() }));
			if (r.act === 'back') {
				step = 1;
				continue;
			}
			return w.close();
		}
		if (doc!.isDirty) {
			await doc!.save();
		}
		if (step === 2) {
			w.busy('Programm wird geprüft …');
			const diags = await api.check(doc!);
			const errors = diags.filter((d) => d.severity === vscode.DiagnosticSeverity.Error);
			if (errors.length) {
				const r = await w.step(
					page({
						progress: [2, total],
						title: 'Programm hat Fehler',
						content: message('error', `<b>${errors.length} Fehler</b> – das Programm wird so nicht geladen, damit am Roboter nichts kaputtgeht. Auf die Zeile klicken, um sie anzuzeigen.`) + issueList(doc!, errors),
						buttons: backButton() + button('🔄 Erneut prüfen', 'again', { primary: true }) + cancelButton()
					})
				);
				if (r.act === 'goto') {
					await reveal(w, doc!, Number(r.arg));
					continue;
				}
				if (r.act === 'again') {
					continue;
				}
				if (r.act === 'back') {
					step = 1;
					continue;
				}
				return w.close();
			}
			step = 3;
			continue;
		}
		const origin = await api.originOf(doc!.uri.fsPath);
		const robots = getControllers();
		const fileName = path.basename(doc!.uri.fsPath);
		const remoteFor = (c: ControllerConfig) => (origin && origin.controller === c.name ? origin.remotePath : ftp.joinRemote(devicesOf(c)[0] ?? 'md:', fileName));
		if (step === 3) {
			if (robots.length === 0) {
				const p = await pickRobot(w, api, [3, total], 'Auf welchen Roboter?');
				if (!p || p === 'back') {
					return w.close();
				}
				robotName = p.value.name;
				step = 4;
				continue;
			}
			const ordered = [...robots].sort((a, b) => Number(b.name === origin?.controller) - Number(a.name === origin?.controller));
			const r = await w.step(
				page({
					progress: [3, total],
					title: 'Auf welchen Roboter?',
					content:
						message('ok', 'Prüfung bestanden – keine Fehler.') +
						ordered
						.map((c) => card('🤖', c.name === origin?.controller ? `Zurück auf ${c.name}` : `Auf ${c.name}`, `${c.name === origin?.controller ? 'Von hier wurde das Programm geholt · ' : ''}${esc(remoteFor(c))}`, 'pick', c.name))
						.join(''),
					buttons: backButton() + cancelButton()
				})
			);
			if (r.act === 'back') {
				step = 1;
				continue;
			}
			if (r.act !== 'pick') {
				return w.close();
			}
			robotName = r.arg;
			step = 4;
			continue;
		}
		// step 4: bestätigen und laden
		const c = getControllers().find((x) => x.name === robotName);
		if (!c) {
			step = 3;
			continue;
		}
		const remotePath = remoteFor(c);
		w.busy(`Verbindung zu ${c.name} …`);
		let existsRemote: boolean | undefined;
		try {
			const dir = remotePath.replace(/[^/:]*$/, '');
			existsRemote = (await ftp.list(c, api.secrets, dir)).some((e) => e.name.toLowerCase() === fileName.toLowerCase());
		} catch (err) {
			const r = await w.step(page({ title: 'Keine Verbindung', content: message('error', ftpErrorText(err)), buttons: backButton() + button('Erneut versuchen', 'retry', { primary: true }) + cancelButton() }));
			if (r.act === 'retry') {
				continue;
			}
			if (r.act === 'back') {
				step = 3;
				continue;
			}
			return w.close();
		}
		const r = await w.step(
			page({
				progress: [4, total],
				title: 'Jetzt laden?',
				content:
					`<table><tr><th>Programm</th><td><b>${esc(fileName)}</b></td></tr><tr><th>Roboter</th><td><b>${esc(c.name)}</b> (${esc(c.host)})</td></tr><tr><th>Ziel</th><td><code>${esc(remotePath)}</code></td></tr></table>` +
					(existsRemote ? message('warn', `Auf ${esc(c.name)} gibt es dieses Programm schon – es wird <b>ersetzt</b>. Das Programm darf am Roboter gerade nicht ausgewählt sein oder laufen.`) : message('info', 'Das Programm ist neu auf dem Roboter.')),
				buttons: backButton() + button('📤 Jetzt auf Roboter laden', 'upload', { primary: true }) + cancelButton()
			})
		);
		if (r.act === 'back') {
			step = 3;
			continue;
		}
		if (r.act !== 'upload') {
			return w.close();
		}
		w.busy(`${fileName} wird auf ${c.name} geladen …`);
		try {
			await api.upload(doc!.uri.fsPath, c, remotePath);
		} catch (err) {
			const r2 = await w.step(
				page({
					title: 'Laden fehlgeschlagen',
					content: message('error', ftpErrorText(err) + '<br>• Ist das Programm am Roboter gerade ausgewählt oder schreibgeschützt?'),
					buttons: button('Erneut versuchen', 'retry', { primary: true }) + cancelButton()
				})
			);
			if (r2.act === 'retry') {
				continue;
			}
			return w.close();
		}
		return finish(w, 'Programm geladen', message('ok', `<b>${esc(fileName)}</b> ist jetzt auf ${esc(c.name)}.`) + message('warn', SAFETY), []);
	}
}

// --- Sicherung -------------------------------------------------------------------------------

async function backupWizard(api: FanucApi): Promise<void> {
	const w = new Wizard('Sicherung');
	const robot = await pickRobot(w, api, [1, 3], 'Welchen Roboter sichern?');
	if (!robot || robot === 'back') {
		return w.close();
	}
	const c = robot.value;
	const baseDir = await api.resolveDownloadDir();
	if (!baseDir) {
		return w.close();
	}
	const d = new Date();
	const p2 = (n: number) => String(n).padStart(2, '0');
	const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}`;
	const target = path.join(baseDir, 'Sicherungen', sanitize(c.name), stamp);
	const devices = devicesOf(c);

	let error: string | undefined;
	let chosen: string[] = [devices[0] ?? 'md:'];
	for (;;) {
		const r = await w.step(
			page({
				progress: [2, 3],
				title: 'Was sichern?',
				intro: `Die Dateien werden auf den PC kopiert nach<br><code>${esc(vscode.workspace.asRelativePath(target))}</code><br>Am Roboter wird nichts verändert.`,
				error,
				content: devices
					.map((dev) => checkCard('dev', dev, dev, dev === 'md:' ? 'Alle Programme (empfohlen)' : dev === 'fr:' ? 'FROM-Speicher' : dev === 'mc:' ? 'Speicherkarte' : dev.startsWith('ud') ? 'USB-Stick am Roboter' : '', chosen.includes(dev)))
					.join(''),
				buttons: button('💾 Sicherung starten', 'go', { primary: true }) + cancelButton()
			})
		);
		if (r.act !== 'go') {
			return w.close();
		}
		chosen = list(r.values.dev);
		if (chosen.length === 0) {
			error = 'Bitte mindestens einen Speicher auswählen.';
			continue;
		}
		break;
	}

	let done = 0;
	const failed: string[] = [];
	try {
		for (const dev of chosen) {
			w.busy(`Dateiliste von ${dev} wird geladen …`);
			const files = (await ftp.list(c, api.secrets, dev)).filter((e) => !e.isDirectory);
			const dir = path.join(target, sanitize(dev));
			await fs.mkdir(dir, { recursive: true });
			let i = 0;
			for (const e of files) {
				i++;
				w.busy(`${dev}  ${i} von ${files.length}: ${e.name}`);
				try {
					await ftp.downloadToFile(c, api.secrets, ftp.joinRemote(dev, e.name), path.join(dir, e.name));
					done++;
				} catch {
					failed.push(`${dev}${e.name}`);
				}
			}
		}
	} catch (err) {
		await w.step(page({ title: 'Sicherung fehlgeschlagen', content: message('error', ftpErrorText(err)), buttons: button('Schließen', 'cancel') }));
		return w.close();
	}
	w.onCommand = (cmd) => {
		if (cmd === 'reveal') {
			void vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(target));
		}
	};
	await w.step(
		page({
			progress: [3, 3],
			title: 'Sicherung fertig',
			content:
				message('ok', `<b>${done} Datei(en)</b> von ${esc(c.name)} gesichert.<br><code>${esc(target)}</code>`) +
				(failed.length ? message('warn', `${failed.length} Datei(en) konnten nicht gelesen werden (am Roboter gesperrt):<br><small>${esc(failed.slice(0, 20).join(', '))}${failed.length > 20 ? ' …' : ''}</small>`) : ''),
			buttons: button('📂 Ordner öffnen', 'cmd:reveal') + button('Fertig', 'done', { primary: true })
		})
	);
	w.close();
}
