import * as vscode from 'vscode';
import { Client, FileInfo, FileType } from 'basic-ftp';
import { ControllerConfig, getFtpOptions, getPassword } from './config';

export interface RemoteEntry {
	name: string;
	isDirectory: boolean;
	size: number;
	modified?: string;
}

let output: vscode.OutputChannel | undefined;

function log(msg: string): void {
	if (!output) {
		output = vscode.window.createOutputChannel('FANUC FTP');
	}
	output.appendLine(msg);
}

export function showLog(): void {
	if (!output) {
		output = vscode.window.createOutputChannel('FANUC FTP');
	}
	output.show(true);
}

/** Pro Steuerung nur eine Verbindung gleichzeitig - FANUC-Steuerungen haben sehr wenige FTP-Slots. */
const queues = new Map<string, Promise<unknown>>();

function serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
	const prev = queues.get(key) ?? Promise.resolve();
	const next = prev.catch(() => undefined).then(fn);
	queues.set(
		key,
		next.catch(() => undefined)
	);
	return next;
}

export class FtpError extends Error {
	constructor(message: string, public readonly cause?: unknown) {
		super(message);
		this.name = 'FtpError';
	}
}

async function withClient<T>(
	controller: ControllerConfig,
	secrets: vscode.SecretStorage,
	fn: (client: Client) => Promise<T>
): Promise<T> {
	const opts = getFtpOptions();
	return serialize(`${controller.host}:${controller.port ?? 21}`, async () => {
		const client = new Client(opts.timeout);
		client.ftp.verbose = opts.verbose;
		if (opts.verbose) {
			client.ftp.log = log;
		}
		try {
			await client.access({
				host: controller.host,
				port: controller.port ?? 21,
				user: controller.user || 'anonymous',
				password: (await getPassword(secrets, controller)) || '',
				secure: controller.secure === true
			});
			return await fn(client);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			log(`[${controller.name}] Fehler: ${msg}`);
			throw new FtpError(`${controller.name} (${controller.host}): ${msg}`, err);
		} finally {
			client.close();
		}
	});
}

function toEntries(list: FileInfo[]): RemoteEntry[] {
	return list
		.filter((f) => f.name !== '.' && f.name !== '..')
		.map((f) => ({
			name: f.name,
			isDirectory: f.type === FileType.Directory,
			size: f.size,
			modified: f.rawModifiedAt || undefined
		}))
		.sort((a, b) => {
			if (a.isDirectory !== b.isDirectory) {
				return a.isDirectory ? -1 : 1;
			}
			return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
		});
}

/**
 * Listet ein Gerät oder Verzeichnis.
 * FANUC-Steuerungen bilden Geräte als "md:", "fr:", "ud1:" ab; manche Firmwares
 * mögen nur CWD, andere akzeptieren den Pfad direkt in LIST.
 */
export async function list(
	controller: ControllerConfig,
	secrets: vscode.SecretStorage,
	remotePath: string
): Promise<RemoteEntry[]> {
	return withClient(controller, secrets, async (client) => {
		try {
			return toEntries(await client.list(remotePath));
		} catch (err) {
			log(`LIST "${remotePath}" fehlgeschlagen, versuche CWD: ${String(err)}`);
			await client.cd(remotePath);
			return toEntries(await client.list());
		}
	});
}

export async function downloadToFile(
	controller: ControllerConfig,
	secrets: vscode.SecretStorage,
	remotePath: string,
	localPath: string
): Promise<void> {
	await withClient(controller, secrets, async (client) => {
		await client.downloadTo(localPath, remotePath);
	});
}

export async function uploadFile(
	controller: ControllerConfig,
	secrets: vscode.SecretStorage,
	localPath: string,
	remotePath: string
): Promise<void> {
	await withClient(controller, secrets, async (client) => {
		await client.uploadFrom(localPath, remotePath);
	});
}

export async function remove(
	controller: ControllerConfig,
	secrets: vscode.SecretStorage,
	remotePath: string
): Promise<void> {
	await withClient(controller, secrets, async (client) => {
		await client.remove(remotePath);
	});
}

export async function ping(controller: ControllerConfig, secrets: vscode.SecretStorage): Promise<string> {
	return withClient(controller, secrets, async (client) => {
		const res = await client.send('SYST');
		return res.message;
	});
}

/** Fügt Gerät und Dateinamen zu einem Remote-Pfad zusammen. */
export function joinRemote(base: string, name: string): string {
	if (base.endsWith(':')) {
		return `${base}${name}`;
	}
	if (base.endsWith('/')) {
		return `${base}${name}`;
	}
	return `${base}/${name}`;
}
