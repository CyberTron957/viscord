import * as vscode from 'vscode';
import { WsClient, UserStatus } from './wsClient';

export class SidebarProvider implements vscode.TreeDataProvider<Friend> {
    private _onDidChangeTreeData: vscode.EventEmitter<Friend | undefined | null | void> = new vscode.EventEmitter<Friend | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<Friend | undefined | null | void> = this._onDidChangeTreeData.event;

    private friends: UserStatus[] = [];
    private wsClient: WsClient;
    private username: string;
    private context: vscode.ExtensionContext;
    private friendList: string[] = [];

    constructor(context: vscode.ExtensionContext, username: string) {
        this.context = context;
        this.username = username;
        this.friendList = this.context.globalState.get<string[]>('friendList', []);

        this.wsClient = new WsClient((users) => {
            // Filter users to only show friends
            this.friends = users.filter(u => this.friendList.includes(u.username));
            this.refresh();
        });
        this.wsClient.connect(username);
    }

    addFriend(username: string) {
        if (!this.friendList.includes(username)) {
            this.friendList.push(username);
            this.context.globalState.update('friendList', this.friendList);
            this.refresh();
        }
    }

    removeFriend(username: string) {
        const index = this.friendList.indexOf(username);
        if (index !== -1) {
            this.friendList.splice(index, 1);
            this.context.globalState.update('friendList', this.friendList);
            this.refresh();
        }
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: Friend): vscode.TreeItem {
        return element;
    }

    getChildren(element?: Friend): Thenable<Friend[]> {
        if (element) {
            return Promise.resolve([]);
        } else {
            return Promise.resolve(this.getFriends());
        }
    }

    private getFriends(): Friend[] {
        return this.friends.map(f => new Friend(
            f.username,
            f.status,
            f.activity,
            f.project,
            f.language,
            vscode.TreeItemCollapsibleState.None
        ));
    }

    public updateStatus(status: Partial<UserStatus>) {
        this.wsClient.updateStatus(status);
    }
}

class Friend extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        private status: string,
        private activity: string,
        private project: string,
        private language: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
        this.tooltip = `${this.label} - ${this.status}\nProject: ${this.project}\nLanguage: ${this.language}`;
        this.description = `${this.status} - ${this.activity}`;

        this.setIcon(status);
    }

    private setIcon(status: string) {
        // In a real app, we would use path to icons
        // For now, we can use built-in product icons or emojis in label if needed, 
        // but TreeItem has iconPath property.
        // Let's use simple ThemeIcons for now.
        if (status === 'Online') {
            this.iconPath = new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('testing.iconPassed'));
        } else if (status === 'Away') {
            this.iconPath = new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('testing.iconSkipped'));
        } else {
            this.iconPath = new vscode.ThemeIcon('circle-outline');
        }
    }
}
