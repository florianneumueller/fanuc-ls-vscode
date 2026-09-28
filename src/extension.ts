import * as vscode from 'vscode';
import { DIAG_SOURCE, invalidateProgramCache, setCallTargetSource, validate } from './diagnostics';
import { ControllerProgramIndex } from './controllerPrograms';
import { FanucCodeActionProvider } from './quickfix';
import { FanucSymbolProvider } from './symbols';
import { ControllerTreeProvider } from './controllerTree';
import { originOf, registerCommands } from './commands';
import { FanucDocumentFormatter, FanucOnTypeFormatter } from './format';

const SELECTOR: vscode.DocumentSelector = { language: 'fanuc-ls' };

export function activate(context: vscode.ExtensionContext): void {
	const diagnostics = vscode.languages.createDiagnosticCollection(DIAG_SOURCE);
	context.subscriptions.push(diagnostics);

	const timers = new Map<string, NodeJS.Timeout>();

	const runValidation = async (doc: vscode.TextDocument): Promise<void> => {
		if (doc.languageId !== 'fanuc-ls') {
			return;
		}
		try {
			diagnostics.set(doc.uri, await validate(doc));
		} catch (err) {
			console.error('fanuc-ls: Validierung fehlgeschlagen', err);
		}
	};

	const schedule = (doc: vscode.TextDocument): void => {
		if (doc.languageId !== 'fanuc-ls') {
			return;
		}
		const key = doc.uri.toString();
		const existing = timers.get(key);
		if (existing) {
			clearTimeout(existing);
		}
		timers.set(
			key,
			setTimeout(() => {
				timers.delete(key);
				void runValidation(doc);
			}, 300)
		);
	};

	// --- Sprachfeatures ------------------------------------------------------

	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider(
			SELECTOR,
			new FanucCodeActionProvider(),
			FanucCodeActionProvider.metadata
		),
		vscode.languages.registerDocumentSymbolProvider(SELECTOR, new FanucSymbolProvider()),
		vscode.languages.registerOnTypeFormattingEditProvider(SELECTOR, new FanucOnTypeFormatter(), '\n'),
		vscode.languages.registerDocumentFormattingEditProvider(SELECTOR, new FanucDocumentFormatter())
	);

	// --- Sidepanel -----------------------------------------------------------

	const tree = new ControllerTreeProvider(context.secrets);
	context.subscriptions.push(
		vscode.window.createTreeView('fanucLs.controllers', {
			treeDataProvider: tree,
			showCollapseAll: true
		})
	);

	// --- Programmlisten der Controller für die CALL-Prüfung ------------------

	const programIndex = new ControllerProgramIndex(context.secrets);
	context.subscriptions.push(
		programIndex,
		programIndex.onDidUpdate(() => {
			for (const doc of vscode.workspace.textDocuments) {
				void runValidation(doc);
			}
		})
	);
	setCallTargetSource({
		index: programIndex,
		originOf: async (fsPath) => (await originOf(context, fsPath))?.controller
	});

	// --- Validierungs-Trigger ------------------------------------------------

	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument((doc) => void runValidation(doc)),
		vscode.workspace.onDidSaveTextDocument((doc) => {
			invalidateProgramCache();
			void runValidation(doc);
		}),
		vscode.workspace.onDidChangeTextDocument((e) => {
			const mode = vscode.workspace
				.getConfiguration('fanucLs', e.document.uri)
				.get<string>('validation.run', 'onType');
			if (mode === 'onType') {
				schedule(e.document);
			}
		}),
		vscode.workspace.onDidCloseTextDocument((doc) => diagnostics.delete(doc.uri)),
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('fanucLs.validation')) {
				for (const doc of vscode.workspace.textDocuments) {
					void runValidation(doc);
				}
			}
			if (e.affectsConfiguration('fanucLs.controllers') || e.affectsConfiguration('fanucLs.ftp')) {
				tree.refresh();
				programIndex.invalidate();
			}
		})
	);

	for (const doc of vscode.workspace.textDocuments) {
		void runValidation(doc);
	}

	registerCommands(context, tree, diagnostics, runValidation, programIndex);
}

export function deactivate(): void {
	/* nichts aufzuräumen - alles hängt an context.subscriptions */
}
