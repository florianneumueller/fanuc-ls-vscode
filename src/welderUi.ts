/**
 * Bausteine für die Schweißer-Oberfläche: Assistenten-Fenster (Webview) mit
 * schrittweiser Führung und HTML-Helfer im VS-Code-Farbschema.
 *
 * Ablauf eines Assistenten:
 *   const w = new Wizard('Programm holen');
 *   const r = await w.step(page({ ... }));   // wartet auf einen Klick
 *   if (r.act === 'cancel') return;
 */
import * as vscode from 'vscode';

export interface StepResult {
	/** data-act des geklickten Knopfs; 'cancel', wenn das Fenster geschlossen wurde */
	act: string;
	/** data-arg des geklickten Knopfs */
	arg?: string;
	/** Eingabefelder: Text/Radio als String, Checkboxen als Liste der angehakten Werte */
	values: Record<string, string | string[]>;
}

export class Wizard {
	private readonly panel: vscode.WebviewPanel;
	private pending?: (r: StepResult) => void;
	private disposed = false;
	/** Wird nach einem Klick auf data-act="open:<command>" ausgeführt, ohne den Schritt zu beenden. */
	onCommand?: (command: string, arg?: string) => void;

	constructor(title: string) {
		this.panel = vscode.window.createWebviewPanel('fanucLs.wizard', title, { viewColumn: vscode.ViewColumn.Two, preserveFocus: false }, {
			enableScripts: true,
			retainContextWhenHidden: true
		});
		this.panel.webview.onDidReceiveMessage((m: StepResult) => {
			if (m.act.startsWith('cmd:')) {
				this.onCommand?.(m.act.slice(4), m.arg);
				return;
			}
			const p = this.pending;
			this.pending = undefined;
			p?.(m);
		});
		this.panel.onDidDispose(() => {
			this.disposed = true;
			const p = this.pending;
			this.pending = undefined;
			p?.({ act: 'cancel', values: {} });
		});
	}

	/** Spalte für Programme: die, in der der Assistent nicht liegt. */
	get editorColumn(): vscode.ViewColumn {
		return this.panel.viewColumn === vscode.ViewColumn.One ? vscode.ViewColumn.Two : vscode.ViewColumn.One;
	}

	get closed(): boolean {
		return this.disposed;
	}

	/** Zeigt einen Schritt und wartet auf einen Knopfdruck. */
	step(body: string): Promise<StepResult> {
		if (this.disposed) {
			return Promise.resolve({ act: 'cancel', values: {} });
		}
		this.panel.webview.html = document(this.panel.title, body);
		return new Promise((resolve) => (this.pending = resolve));
	}

	/** Zeigt einen Wartehinweis (kein Knopf). */
	busy(text: string): void {
		if (!this.disposed) {
			this.panel.webview.html = document(this.panel.title, `<div class="busy-box"><div class="spinner"></div><p>${esc(text)}</p></div>`);
		}
	}

	close(): void {
		if (!this.disposed) {
			this.panel.dispose();
		}
	}
}

// --- HTML-Helfer ---------------------------------------------------------------

export function esc(s: unknown): string {
	return String(s ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

export interface PageOptions {
	/** z. B. [2, 4] = Schritt 2 von 4 */
	progress?: [number, number];
	title: string;
	intro?: string;
	/** fertiges HTML */
	content?: string;
	error?: string;
	buttons?: string;
}

export function page(o: PageOptions): string {
	const steps = o.progress
		? `<div class="steps">${Array.from({ length: o.progress[1] }, (_, i) => `<span class="${i + 1 < o.progress![0] ? 'done' : i + 1 === o.progress![0] ? 'now' : ''}"></span>`).join('')}<em>Schritt ${o.progress[0]} von ${o.progress[1]}</em></div>`
		: '';
	return `${steps}<h1>${esc(o.title)}</h1>${o.intro ? `<p class="intro">${o.intro}</p>` : ''}${o.error ? `<div class="msg error">⚠️ ${o.error}</div>` : ''}<div class="content">${o.content ?? ''}</div><div class="buttons">${o.buttons ?? ''}</div>`;
}

export function button(label: string, act: string, opts: { primary?: boolean; arg?: string; danger?: boolean } = {}): string {
	const cls = opts.danger ? 'danger' : opts.primary ? 'primary' : 'secondary';
	return `<button class="${cls}" data-act="${esc(act)}"${opts.arg !== undefined ? ` data-arg="${esc(opts.arg)}"` : ''}>${label}</button>`;
}

export const cancelButton = () => button('Abbrechen', 'cancel');
export const backButton = () => button('← Zurück', 'back');

/** Große anklickbare Karte (eine Auswahl = ein Klick). */
export function card(icon: string, title: string, text: string, act: string, arg?: string, extra = ''): string {
	return `<button class="card ${extra}" data-act="${esc(act)}"${arg !== undefined ? ` data-arg="${esc(arg)}"` : ''}><span class="icon">${icon}</span><span class="text"><strong>${esc(title)}</strong><small>${text}</small></span></button>`;
}

/** Auswahl per Optionsfeld als Karte. */
export function radioCard(name: string, value: string, title: string, text: string, checked: boolean): string {
	return `<label class="choice"><input type="radio" name="${esc(name)}" value="${esc(value)}"${checked ? ' checked' : ''}><span><strong>${esc(title)}</strong><small>${text}</small></span></label>`;
}

export function checkCard(name: string, value: string, title: string, text: string, checked: boolean): string {
	return `<label class="choice"><input type="checkbox" name="${esc(name)}" value="${esc(value)}"${checked ? ' checked' : ''}><span><strong>${esc(title)}</strong><small>${text}</small></span></label>`;
}

export function field(label: string, name: string, value: string, opts: { hint?: string; type?: string; unit?: string; placeholder?: string } = {}): string {
	return `<label class="field"><span>${esc(label)}</span><span class="input"><input type="${opts.type ?? 'text'}" name="${esc(name)}" value="${esc(value)}"${opts.placeholder ? ` placeholder="${esc(opts.placeholder)}"` : ''}>${opts.unit ? `<em>${esc(opts.unit)}</em>` : ''}</span>${opts.hint ? `<small>${opts.hint}</small>` : ''}</label>`;
}

export function message(kind: 'ok' | 'warn' | 'error' | 'info', html: string): string {
	const icon = { ok: '✅', warn: '⚠️', error: '⛔', info: 'ℹ️' }[kind];
	return `<div class="msg ${kind}">${icon} ${html}</div>`;
}

/** Suchfeld, das die Elemente mit der Klasse "filterable" ein-/ausblendet. */
export function filterBox(placeholder: string): string {
	return `<input class="filter" type="search" placeholder="${esc(placeholder)}" data-filter=".filterable" autofocus>`;
}

/** Zahl aus einer Eingabe (Komma oder Punkt). */
export function num(v: string | string[] | undefined): number | undefined {
	const s = String(Array.isArray(v) ? v[0] ?? '' : v ?? '').trim().replace(',', '.');
	if (s === '' || !/^[-+]?\d+(\.\d+)?$/.test(s)) {
		return undefined;
	}
	return Number(s);
}

export function str(v: string | string[] | undefined): string {
	return String(Array.isArray(v) ? v[0] ?? '' : v ?? '').trim();
}

export function list(v: string | string[] | undefined): string[] {
	return Array.isArray(v) ? v : v ? [v] : [];
}

function nonce(): string {
	let s = '';
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		s += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return s;
}

export const STYLE = `
:root { --gap: 12px; }
body { font-family: var(--vscode-font-family); font-size: 14px; color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 8px 20px 32px; max-width: 760px; line-height: 1.45; }
h1 { font-size: 1.6em; font-weight: 600; margin: 8px 0 6px; }
h2 { font-size: 1.15em; margin: 20px 0 8px; }
p.intro { font-size: 1.05em; color: var(--vscode-descriptionForeground); margin: 0 0 16px; }
.steps { display: flex; gap: 6px; align-items: center; margin: 8px 0 4px; }
.steps span { width: 34px; height: 6px; border-radius: 3px; background: var(--vscode-input-border, #8884); }
.steps span.done { background: var(--vscode-button-background); opacity: .5; }
.steps span.now { background: var(--vscode-button-background); }
.steps em { margin-left: 8px; font-style: normal; color: var(--vscode-descriptionForeground); font-size: .9em; }
.content { display: flex; flex-direction: column; gap: var(--gap); }
.buttons { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 24px; }
button { font: inherit; cursor: pointer; border-radius: 6px; padding: 10px 20px; font-size: 1.05em; border: 1px solid transparent; }
button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); font-weight: 600; }
button.primary:hover { background: var(--vscode-button-hoverBackground); }
button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
button.danger { background: var(--vscode-inputValidation-errorBackground, #a1260d); color: var(--vscode-foreground); border-color: var(--vscode-inputValidation-errorBorder, #be1100); }
button.link { background: none; border: none; color: var(--vscode-textLink-foreground); padding: 0 4px; font-size: 1em; }
.card { display: flex; gap: 14px; align-items: center; text-align: left; width: 100%; background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background)); color: var(--vscode-foreground); border: 1px solid var(--vscode-widget-border, var(--vscode-input-border, #8884)); padding: 14px 16px; }
.card:hover, .card:focus { border-color: var(--vscode-focusBorder); background: var(--vscode-list-hoverBackground); }
.card .icon { font-size: 1.9em; width: 1.4em; text-align: center; }
.card .text { display: flex; flex-direction: column; }
.card strong { font-size: 1.05em; }
.card small, .choice small, .field small { color: var(--vscode-descriptionForeground); font-size: .92em; }
.card.compact { padding: 8px 14px; }
.card.compact .icon { font-size: 1.3em; }
.choice { display: flex; gap: 12px; align-items: flex-start; border: 1px solid var(--vscode-widget-border, var(--vscode-input-border, #8884)); border-radius: 6px; padding: 12px 14px; cursor: pointer; background: var(--vscode-editorWidget-background, transparent); }
.choice:hover { border-color: var(--vscode-focusBorder); }
.choice:has(input:checked) { border-color: var(--vscode-focusBorder); background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
.choice input { margin-top: 4px; transform: scale(1.3); }
.choice span { display: flex; flex-direction: column; }
.field { display: flex; flex-direction: column; gap: 4px; }
.field > span:first-child { font-weight: 600; }
.field .input { display: flex; align-items: center; gap: 8px; }
.field input, input.filter { font: inherit; font-size: 1.1em; padding: 8px 10px; border-radius: 4px; border: 1px solid var(--vscode-input-border, #8884); background: var(--vscode-input-background); color: var(--vscode-input-foreground); max-width: 320px; width: 100%; }
input.filter { max-width: none; box-sizing: border-box; }
.field em { font-style: normal; color: var(--vscode-descriptionForeground); }
.msg { border-radius: 6px; padding: 12px 14px; border-left: 4px solid; background: var(--vscode-textBlockQuote-background); }
.msg.ok { border-color: var(--vscode-testing-iconPassed, #388a34); }
.msg.warn { border-color: var(--vscode-editorWarning-foreground, #bf8803); }
.msg.error { border-color: var(--vscode-editorError-foreground, #e51400); }
.msg.info { border-color: var(--vscode-textLink-foreground); }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--vscode-widget-border, #8883); }
th { color: var(--vscode-descriptionForeground); font-weight: 600; }
td.new { font-weight: 700; color: var(--vscode-textLink-foreground); }
ul.issues { margin: 0; padding-left: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
ul.issues li { display: flex; gap: 10px; align-items: baseline; }
ul.issues li b { white-space: nowrap; }
code { font-family: var(--vscode-editor-font-family); }
.busy-box { display: flex; flex-direction: column; align-items: center; margin-top: 80px; gap: 16px; font-size: 1.1em; }
.spinner { width: 36px; height: 36px; border: 4px solid var(--vscode-input-border, #8884); border-top-color: var(--vscode-button-background); border-radius: 50%; animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
body.busy .buttons button { opacity: .5; pointer-events: none; }
.home { padding: 6px 10px 16px; max-width: none; font-size: 13px; }
.home .status { font-size: 12px; color: var(--vscode-descriptionForeground); margin: 4px 0 8px; line-height: 1.6; }
.home input.search { font: inherit; width: 100%; box-sizing: border-box; padding: 5px 8px; margin-bottom: 6px; border-radius: 4px; border: 1px solid var(--vscode-input-border, #8884); background: var(--vscode-input-background); color: var(--vscode-input-foreground); }
.home details { margin-bottom: 4px; }
.home summary { cursor: pointer; padding: 6px 0 4px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--vscode-descriptionForeground); user-select: none; }
.tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(78px, 1fr)); gap: 5px; margin-bottom: 4px; }
.tile { display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: 3px; padding: 7px 3px 6px; font-size: 11px; line-height: 1.2; text-align: center; border-radius: 5px; background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background)); color: var(--vscode-foreground); border: 1px solid var(--vscode-widget-border, var(--vscode-input-border, #8884)); hyphens: manual; overflow-wrap: break-word; }
.tile:hover, .tile:focus { border-color: var(--vscode-focusBorder); background: var(--vscode-list-hoverBackground); }
.tile .icon { font-size: 18px; line-height: 1; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
`;

const SCRIPT = `
const vscode = acquireVsCodeApi();
function collect() {
	const values = {};
	document.querySelectorAll('input[name], select[name], textarea[name]').forEach((el) => {
		if (el.type === 'checkbox') {
			(values[el.name] = values[el.name] || []);
			if (el.checked) values[el.name].push(el.value);
		} else if (el.type === 'radio') {
			if (el.checked) values[el.name] = el.value;
		} else {
			values[el.name] = el.value;
		}
	});
	return values;
}
document.addEventListener('click', (e) => {
	const b = e.target.closest('[data-act]');
	if (!b) return;
	e.preventDefault();
	const act = b.dataset.act;
	if (!act.startsWith('cmd:')) document.body.classList.add('busy');
	vscode.postMessage({ act, arg: b.dataset.arg, values: collect() });
});
document.addEventListener('keydown', (e) => {
	if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'search') {
		const p = document.querySelector('.buttons button.primary');
		if (p) { e.preventDefault(); p.click(); }
	}
});
document.querySelectorAll('[data-filter]').forEach((inp) => {
	inp.addEventListener('input', () => {
		const q = inp.value.toLowerCase();
		document.querySelectorAll(inp.dataset.filter).forEach((el) => {
			el.style.display = el.textContent.toLowerCase().includes(q) ? '' : 'none';
		});
	});
});
const first = document.querySelector('[autofocus], .content input:not([type=radio]):not([type=checkbox])');
if (first) first.focus();
`;

export function document(title: string, body: string, extraScript = ''): string {
	const n = nonce();
	return `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${n}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${esc(title)}</title><style>${STYLE}</style></head>
<body>${body}<script nonce="${n}">${SCRIPT}${extraScript}</script></body></html>`;
}
