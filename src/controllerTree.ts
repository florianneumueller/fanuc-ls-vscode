import * as vscode from 'vscode';
import { ControllerConfig, devicesOf, getControllers } from './config';
import { joinRemote, list, RemoteEntry } from './ftp';

export type FanucNode = ControllerNode | DeviceNode | DirNode | FileNode | ErrorNode;

export class ControllerNode extends vscode.TreeItem {
	readonly kind = 'controller';
	constructor(public readonly controller: ControllerConfig) {
		super(controller.name, vscode.TreeItemCollapsibleState.Collapsed);
		this.description = `${controller.host}${controller.port && controller.port !== 21 ? ':' + controller.port : ''}`;
		this.tooltip = new vscode.MarkdownString(
			`**${controller.name}**\n\n- Host: \`${controller.host}\`\n- Port: \`${controller.port ?? 21}\`\n- Benutzer: \`${
				controller.user || 'anonymous'
			}\``
		);
		this.iconPath = new vscode.ThemeIcon('server-environment');
		this.contextValue = 'controller';
	}
}

export class DeviceNode extends vscode.TreeItem {
	readonly kind = 'device';
	constructor(public readonly controller: ControllerConfig, public readonly device: string) {
		super(device, vscode.TreeItemCollapsibleState.Collapsed);
		this.iconPath = new vscode.ThemeIcon('database');
		this.contextValue = 'device';
		this.tooltip = `${controller.name} - ${device}`;
	}
	get remotePath(): string {
		return this.device;
	}
}

export class DirNode extends vscode.TreeItem {
	readonly kind = 'dir';
	constructor(
		public readonly controller: ControllerConfig,
		public readonly remotePath: string,
		name: string
	) {
		super(name, vscode.TreeItemCollapsibleState.Collapsed);
		this.iconPath = vscode.ThemeIcon.Folder;
		this.contextValue = 'dir';
	}
}

export class FileNode extends vscode.TreeItem {
	readonly kind = 'file';
	constructor(
		public readonly controller: ControllerConfig,
		public readonly remotePath: string,
		public readonly entry: RemoteEntry
	) {
		super(entry.name, vscode.TreeItemCollapsibleState.None);
		this.description = formatSize(entry.size) + (entry.modified ? `  ${entry.modified}` : '');
		this.contextValue = 'file';
		this.resourceUri = vscode.Uri.parse(`fanuc-remote:/${entry.name}`);
		this.iconPath = new vscode.ThemeIcon(iconFor(entry.name));
		this.tooltip = `${controller.name}  ${remotePath}`;
		this.command = {
			command: 'fanucLs.openRemoteFile',
			title: 'Öffnen',
			arguments: [this]
		};
	}
}

export class ErrorNode extends vscode.TreeItem {
	readonly kind = 'error';
	constructor(message: string) {
		super(message, vscode.TreeItemCollapsibleState.None);
		this.iconPath = new vscode.ThemeIcon('warning');
		this.contextValue = 'error';
		this.tooltip = message;
	}
}

function iconFor(name: string): string {
	const lower = name.toLowerCase();
	if (lower.endsWith('.ls')) {
		return 'file-code';
	}
	if (lower.endsWith('.kl')) {
		return 'file-code';
	}
	if (lower.endsWith('.tp') || lower.endsWith('.pc')) {
		return 'file-binary';
	}
	if (lower.endsWith('.va') || lower.endsWith('.sv') || lower.endsWith('.vr')) {
		return 'settings-gear';
	}
	if (lower.endsWith('.dt') || lower.endsWith('.dg')) {
		return 'output';
	}
	return 'file';
}

function formatSize(bytes: number): string {
	if (!bytes || bytes < 0) {
		return '';
	}
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)} kB`;
	}
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export class ControllerTreeProvider implements vscode.TreeDataProvider<FanucNode> {
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<FanucNode | undefined>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private readonly cache = new Map<string, FanucNode[]>();

	constructor(private readonly secrets: vscode.SecretStorage) {}

	refresh(node?: FanucNode): void {
		if (node) {
			this.cache.delete(cacheKey(node));
		} else {
			this.cache.clear();
		}
		this._onDidChangeTreeData.fire(node);
	}

	getTreeItem(element: FanucNode): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: FanucNode): Promise<FanucNode[]> {
		if (!element) {
			return getControllers().map((c) => new ControllerNode(c));
		}
		if (element instanceof FileNode || element instanceof ErrorNode) {
			return [];
		}
		if (element instanceof ControllerNode) {
			return devicesOf(element.controller).map((d) => new DeviceNode(element.controller, d));
		}

		const key = cacheKey(element);
		const cached = this.cache.get(key);
		if (cached) {
			return cached;
		}

		const controller = element.controller;
		const remotePath = element instanceof DeviceNode ? element.remotePath : element.remotePath;
		try {
			const entries = await list(controller, this.secrets, remotePath);
			const nodes: FanucNode[] = entries.map((e) =>
				e.isDirectory
					? new DirNode(controller, joinRemote(remotePath, e.name), e.name)
					: new FileNode(controller, joinRemote(remotePath, e.name), e)
			);
			const result = nodes.length ? nodes : [new ErrorNode('(leer)')];
			this.cache.set(key, result);
			return result;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return [new ErrorNode(message)];
		}
	}
}

function cacheKey(node: FanucNode): string {
	if (node instanceof ControllerNode) {
		return `c:${node.controller.name}`;
	}
	if (node instanceof DeviceNode) {
		return `d:${node.controller.name}:${node.device}`;
	}
	if (node instanceof DirNode) {
		return `p:${node.controller.name}:${node.remotePath}`;
	}
	return `x:${node.label}`;
}
