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

        // Status icon
        const statusIcon = user.status === 'Active' ? '$(circle-filled)' : '$(circle-outline)';
        const statusColor = user.status === 'Active' ? '#00ff00' : '#ffaa00';

        this.description = `${user.activity}`;
        this.tooltip = new vscode.MarkdownString(
            `**${user.username}**\n\n` +
            `Status: ${user.status}\n` +
            `Activity: ${user.activity}\n` +
            (user.project ? `Project: ${user.project}\n` : '') +
            (user.language ? `Language: ${user.language}` : '')
        );

        // Set icon with color
        this.iconPath = new vscode.ThemeIcon(
            user.status === 'Active' ? 'circle-filled' : 'circle-outline',
            new vscode.ThemeColor(user.status === 'Active' ? 'terminal.ansiGreen' : 'terminal.ansiYellow')
        );

        this.contextValue = 'explorerUser';
    }
}
