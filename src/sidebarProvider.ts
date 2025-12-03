import * as vscode from 'vscode';
import { WsClient, UserStatus } from './wsClient';
import { GitHubService, GitHubUser } from './githubService';

export class SidebarProvider implements vscode.TreeDataProvider<TreeNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<TreeNode | undefined | null | void> = new vscode.EventEmitter<TreeNode | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<TreeNode | undefined | null | void> = this._onDidChangeTreeData.event;

    private allUsers: UserStatus[] = [];
    private wsClient: WsClient;
    private context: vscode.ExtensionContext;
    private profile: GitHubUser;
    private followers: GitHubUser[];
    private following: GitHubUser[];
    private githubService: GitHubService;
    private closeFriends: string[] = [];
    private isGitHubConnected: boolean;

    constructor(
        context: vscode.ExtensionContext,
        profile: GitHubUser,
        followers: GitHubUser[],
        following: GitHubUser[],
        githubService: GitHubService,
        isGitHubConnected: boolean
    ) {
        this.context = context;
        this.profile = profile;
        this.followers = followers;
        this.following = following;
        this.githubService = githubService;
        this.isGitHubConnected = isGitHubConnected;
        this.closeFriends = this.context.globalState.get<string[]>('closeFriends', []);

        this.wsClient = new WsClient((users) => {
            this.allUsers = users;
            this.refresh();
        });

        // Connect with username and optional token
        const token = this.isGitHubConnected ? githubService.getToken() : undefined;
        this.wsClient.connect(profile.login, token);
    }

    addCloseFriend(githubId: string) {
        if (!this.closeFriends.includes(githubId)) {
            this.closeFriends.push(githubId);
            this.context.globalState.update('closeFriends', this.closeFriends);
            this.refresh();
        }
    }

    removeCloseFriend(githubId: string) {
        const index = this.closeFriends.indexOf(githubId);
        if (index !== -1) {
            this.closeFriends.splice(index, 1);
            this.context.globalState.update('closeFriends', this.closeFriends);
            this.refresh();
        }
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TreeNode): vscode.TreeItem {
        return element;
    }

    getChildren(element?: TreeNode): Thenable<TreeNode[]> {
        if (element) {
            // Return children of a category
            if (element instanceof Category) {
                return Promise.resolve(this.getUsersForCategory(element.label));
            }
            return Promise.resolve([]);
        } else {
            // Return top-level categories
            return Promise.resolve(this.getCategories());
        }
    }

    private getCategories(): Category[] {
        const followingCount = this.getFollowingUsers().length;
        const followersCount = this.getFollowersUsers().length;
        const allUsersCount = this.allUsers.filter(u => u.username !== this.profile.login).length;
        const closeFriendsCount = this.getCloseFriendsUsers().length;

        return [
            new Category('Close Friends', vscode.TreeItemCollapsibleState.Expanded, closeFriendsCount),
            new Category('Following', vscode.TreeItemCollapsibleState.Collapsed, followingCount),
            new Category('Followers', vscode.TreeItemCollapsibleState.Collapsed, followersCount),
            new Category('All Users', vscode.TreeItemCollapsibleState.Collapsed, allUsersCount),
        ];
    }

    private getUsersForCategory(category: string): UserNode[] {
        let users: UserStatus[] = [];

        switch (category) {
            case 'Close Friends':
                users = this.getCloseFriendsUsers();
                break;
            case 'Following':
                users = this.getFollowingUsers();
                break;
            case 'Followers':
                users = this.getFollowersUsers();
                break;
            case 'All Users':
                users = this.allUsers.filter(u => u.username !== this.profile.login);
                break;
        }

        return users.map(u => new UserNode(u, vscode.TreeItemCollapsibleState.None));
    }

    private getFollowingUsers(): UserStatus[] {
        const followingLogins = this.following.map(f => f.login.toLowerCase());
        return this.allUsers.filter(u => followingLogins.includes(u.username.toLowerCase()));
    }

    private getFollowersUsers(): UserStatus[] {
        const followerLogins = this.followers.map(f => f.login.toLowerCase());
        return this.allUsers.filter(u => followerLogins.includes(u.username.toLowerCase()));
    }

    private getCloseFriendsUsers(): UserStatus[] {
        const closeFriendsLower = this.closeFriends.map(f => f.toLowerCase());
        return this.allUsers.filter(u => closeFriendsLower.includes(u.username.toLowerCase()));
    }

    public updateStatus(status: Partial<UserStatus>) {
        this.wsClient.updateStatus(status);
    }

    sendMessage(data: any) {
        this.wsClient.send(data);
    }

    reconnectAsGuest(guestUsername: string) {
        // Disconnect current connection
        this.wsClient.disconnect();

        // Clear followers/following
        this.followers = [];
        this.following = [];

        // Update profile
        this.profile = {
            login: guestUsername,
            avatar_url: 'https://avatars.githubusercontent.com/u/0?s=200&v=4',
            html_url: ''
        } as any;

        // Reconnect with guest credentials (no token)
        this.wsClient.connect(guestUsername, undefined);

        // Refresh the sidebar
        this.refresh();
    }

    disconnect() {
        this.wsClient.disconnect();
    }

    connectGitHub(profile: GitHubUser, followers: GitHubUser[], following: GitHubUser[], guestUsername?: string) {
        // Update GitHub data
        this.profile = profile;
        this.followers = followers;
        this.following = following;
        this.isGitHubConnected = true;

        // Reconnect WebSocket with GitHub token and guest alias
        const token = this.githubService.getToken();
        this.wsClient.disconnect();
        this.wsClient.connect(profile.login, token);

        // Send alias to server if transitioning from guest
        if (guestUsername) {
            this.sendMessage({
                type: 'createAlias',
                githubUsername: profile.login,
                guestUsername: guestUsername,
                githubId: profile.id
            });
        }

        // Refresh sidebar
        this.refresh();
    }

    disconnectGitHub(guestUsername: string) {
        // Clear GitHub data
        this.followers = [];
        this.following = [];
        this.isGitHubConnected = false;

        // Update profile to guest
        this.profile = {
            id: 0, // Guest users have ID 0
            login: guestUsername,
            avatar_url: 'https://avatars.githubusercontent.com/u/0?s=200&v=4',
            html_url: ''
        } as GitHubUser;

        // Reconnect WebSocket without token (manual connections preserved)
        this.wsClient.disconnect();
        this.wsClient.connect(guestUsername, undefined);

        // Refresh sidebar
        this.refresh();
    }
}

type TreeNode = Category | UserNode;

class Category extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        private count: number
    ) {
        super(label, collapsibleState);
        this.description = `${count}`;
        this.contextValue = 'category';
    }
}

class UserNode extends vscode.TreeItem {
    constructor(
        public user: UserStatus,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(user.username, collapsibleState);

        // Format description with last seen if offline
        let description = `${user.status} - ${user.activity}`;
        if (user.status === 'Offline' && user.lastSeen) {
            const lastSeenTime = this.formatLastSeen(user.lastSeen);
            description = `Offline - Last seen ${lastSeenTime}`;
        }

        this.tooltip = `${user.username} - ${user.status}\nProject: ${user.project}\nLanguage: ${user.language}`;
        this.description = description;
        this.contextValue = 'user';

        this.setIcon(user.status);
    }

    private formatLastSeen(timestamp: number): string {
        const now = Date.now();
        const diff = now - timestamp;

        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (minutes < 1) {
            return 'just now';
        } else if (minutes < 60) {
            return `${minutes}m ago`;
        } else if (hours < 24) {
            return `${hours}h ago`;
        } else {
            return `${days}d ago`;
        }
    }

    private setIcon(status: string) {
        if (status === 'Online') {
            this.iconPath = new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('testing.iconPassed'));
        } else if (status === 'Away') {
            this.iconPath = new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('testing.iconSkipped'));
        } else {
            this.iconPath = new vscode.ThemeIcon('circle-outline');
        }
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
