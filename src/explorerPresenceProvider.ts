import * as vscode from 'vscode';
import { UserStatus } from './wsClient';
import { buildUserDescription, buildUserTooltip, getUserStatusIcon } from './utils';

export class ExplorerPresenceProvider implements vscode.TreeDataProvider<UserItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<UserItem | undefined | null | void> = new vscode.EventEmitter<UserItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<UserItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private onlineUsers: UserStatus[] = [];
    private pinnedFriends: string[] = [];

    constructor() { }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    updateUsers(users: UserStatus[], pinnedFriends: string[]): void {
        // Only show online users (not offline)
        this.onlineUsers = users.filter(u => u.status !== 'Offline');
        this.pinnedFriends = pinnedFriends;
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

        // Filter to show ONLY pinned close friends
        const pinnedLower = this.pinnedFriends.map(f => f.toLowerCase());
        const pinnedOnlineUsers = this.onlineUsers.filter(u =>
            pinnedLower.includes(u.username.toLowerCase())
        );

        // Sort by status (Active > Idle)
        const sorted = [...pinnedOnlineUsers].sort((a, b) => {
            if (a.status === 'Online' && b.status !== 'Online') return -1;
            if (a.status !== 'Online' && b.status === 'Online') return 1;
            return a.username.localeCompare(b.username);
        });

        return Promise.resolve(sorted.map(user => new UserItem(user)));
    }
}

class UserItem extends vscode.TreeItem {
    constructor(public user: UserStatus) {
        super(user.username, vscode.TreeItemCollapsibleState.None);

        this.description = buildUserDescription(user);
        this.tooltip = buildUserTooltip(user);
        this.iconPath = getUserStatusIcon(user.status);
        this.contextValue = 'explorerUser';
    }
}

