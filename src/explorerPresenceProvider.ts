import * as vscode from 'vscode';
import { UserStatus } from './wsClient';

export class ExplorerPresenceProvider implements vscode.TreeDataProvider<UserItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<UserItem | undefined | null | void> = new vscode.EventEmitter<UserItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<UserItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private onlineUsers: UserStatus[] = [];

    constructor() { }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    updateUsers(users: UserStatus[]): void {
        // Only show online users (not offline)
        this.onlineUsers = users.filter(u => u.status !== 'Offline');
        this.refresh();
    }

    getTreeItem(element: UserItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: UserItem): Thenable<UserItem[]> {
        if (element) {
            return Promise.resolve([]);
        }

        if (this.onlineUsers.length === 0) {
            return Promise.resolve([]);
        }

        // Show online users sorted by status (Active > Idle)
        const sorted = [...this.onlineUsers].sort((a, b) => {
            if (a.status === 'Active' && b.status !== 'Active') return -1;
            if (a.status !== 'Active' && b.status === 'Active') return 1;
            return a.username.localeCompare(b.username);
        });

        return Promise.resolve(sorted.map(user => new UserItem(user)));
    }
}

class UserItem extends vscode.TreeItem {
    constructor(public user: UserStatus) {
        super(user.username, vscode.TreeItemCollapsibleState.None);

        // Richer description: Activity • Project (Language)
        const parts = [];
        if (user.activity) parts.push(user.activity);

        // Only show project/lang if not Hidden
        if (user.project && user.project !== 'Hidden') parts.push(user.project);
        if (user.language && user.language !== 'Hidden') parts.push(`(${user.language})`);

        this.description = parts.join(' • ');

        this.tooltip = new vscode.MarkdownString(
            `**${user.username}**\n\n` +
            `Status: ${user.status}\n` +
            `Activity: ${user.activity}\n` +
            (user.project && user.project !== 'Hidden' ? `Project: ${user.project}\n` : '') +
            (user.language && user.language !== 'Hidden' ? `Language: ${user.language}` : '')
        );

        // Set icon with color
        if (user.status === 'Online') {
            this.iconPath = new vscode.ThemeIcon('record', new vscode.ThemeColor('charts.green'));
        } else if (user.status === 'Away') {
            this.iconPath = new vscode.ThemeIcon('record', new vscode.ThemeColor('charts.yellow'));
        } else {
            this.iconPath = new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('charts.gray'));
        }

        this.contextValue = 'explorerUser';
    }
}
