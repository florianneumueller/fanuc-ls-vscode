import * as vscode from 'vscode';
import { ControllerConfig } from './config';
import * as ftp from './ftp';

/** Gerät, auf dem die geladenen TP- und KAREL-Programme liegen. */
export const PROGRAM_DEVICE = 'md:';

const TTL_OK = 5 * 60 * 1000;
const TTL_ERROR = 60 * 1000;
const PROGRAM_EXT = /\.(tp|ls|pc|mr)$/i;

interface Entry {
	names?: Set<string>;
	error?: string;
	stamp: number;
	pending?: Promise<void>;
}

export interface ProgramLookup {
	/** Programmnamen (groß geschrieben), sobald geladen */
	names?: Set<string>;
	/** Fehlermeldung des letzten Ladeversuchs */
	error?: string;
}

/**
 * Programmliste je Controller, im Hintergrund per FTP geladen und zwischengespeichert.
 * `lookup` blockiert nie: fehlt die Liste oder ist sie veraltet, wird sie nachgeladen
 * und `onDidUpdate` gefeuert, sobald sie da ist.
 */
export class ControllerProgramIndex implements vscode.Disposable {
	private readonly cache = new Map<string, Entry>();
	private readonly emitter = new vscode.EventEmitter<void>();
	readonly onDidUpdate = this.emitter.event;

	constructor(private readonly secrets: vscode.SecretStorage) {}

	lookup(controller: ControllerConfig): ProgramLookup {
		const key = keyOf(controller);
		const entry = this.cache.get(key);
		const now = Date.now();
		const stale = !entry || now - entry.stamp > (entry.error ? TTL_ERROR : TTL_OK);
		if (stale && !entry?.pending) {
			this.load(controller, key, entry);
		}
		return entry ? { names: entry.names, error: entry.error } : {};
	}

	invalidate(controllerName?: string): void {
		if (!controllerName) {
			this.cache.clear();
		} else {
			for (const key of [...this.cache.keys()]) {
				if (key.startsWith(controllerName + '@')) {
					this.cache.delete(key);
				}
			}
		}
		this.emitter.fire();
	}

	dispose(): void {
		this.emitter.dispose();
	}

	private load(controller: ControllerConfig, key: string, previous: Entry | undefined): void {
		const entry: Entry = previous ?? { stamp: 0 };
		entry.pending = ftp
			.list(controller, this.secrets, PROGRAM_DEVICE)
			.then((list) => {
				entry.names = new Set(
					list
						.filter((e) => !e.isDirectory && PROGRAM_EXT.test(e.name))
						.map((e) => e.name.replace(PROGRAM_EXT, '').toUpperCase())
				);
				entry.error = undefined;
			})
			.catch((err) => {
				entry.error = err instanceof Error ? err.message : String(err);
			})
			.finally(() => {
				entry.stamp = Date.now();
				entry.pending = undefined;
				this.emitter.fire();
			});
		this.cache.set(key, entry);
	}
}

function keyOf(c: ControllerConfig): string {
	return `${c.name}@${c.host}:${c.port ?? 21}`;
}
