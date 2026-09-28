import * as vscode from 'vscode';

export interface ControllerConfig {
	name: string;
	host: string;
	port?: number;
	user?: string;
	secure?: boolean;
	devices?: string[];
}

export const DEFAULT_DEVICES = ['md:', 'fr:', 'mc:', 'ud1:'];

export function getControllers(): ControllerConfig[] {
	const raw = vscode.workspace.getConfiguration('fanucLs').get<ControllerConfig[]>('controllers', []);
	return (raw ?? []).filter((c) => c && c.name && c.host);
}

export async function saveControllers(list: ControllerConfig[]): Promise<void> {
	const cfg = vscode.workspace.getConfiguration('fanucLs');
	const inspect = cfg.inspect<ControllerConfig[]>('controllers');
	const target =
		inspect?.workspaceValue !== undefined
			? vscode.ConfigurationTarget.Workspace
			: vscode.ConfigurationTarget.Global;
	await cfg.update('controllers', list, target);
}

export function devicesOf(c: ControllerConfig): string[] {
	const list = c.devices && c.devices.length ? c.devices : DEFAULT_DEVICES;
	return list.map((d) => d.trim()).filter(Boolean);
}

function secretKey(c: ControllerConfig): string {
	return `fanucLs.password.${c.name}@${c.host}`;
}

export async function getPassword(secrets: vscode.SecretStorage, c: ControllerConfig): Promise<string> {
	const stored = await secrets.get(secretKey(c));
	return stored ?? '';
}

export async function setPassword(
	secrets: vscode.SecretStorage,
	c: ControllerConfig,
	password: string
): Promise<void> {
	if (password === '') {
		await secrets.delete(secretKey(c));
	} else {
		await secrets.store(secretKey(c), password);
	}
}

export interface FtpOptions {
	timeout: number;
	verbose: boolean;
	confirmUpload: boolean;
	validateBeforeUpload: boolean;
	downloadDirectory: string;
}

export function getFtpOptions(): FtpOptions {
	const cfg = vscode.workspace.getConfiguration('fanucLs');
	return {
		timeout: cfg.get<number>('ftp.timeout', 8000),
		verbose: cfg.get<boolean>('ftp.verbose', false),
		confirmUpload: cfg.get<boolean>('ftp.confirmUpload', true),
		validateBeforeUpload: cfg.get<boolean>('ftp.validateBeforeUpload', true),
		downloadDirectory: cfg.get<string>('ftp.downloadDirectory', '')
	};
}
