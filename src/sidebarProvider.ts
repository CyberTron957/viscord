import * as vscode from 'vscode';
import { WsClient, UserStatus, ConnectionStatus } from './wsClient';
import { GitHubService, GitHubUser } from './githubService';

export class SidebarProvider implements vscode.TreeDataProvider<TreeNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<TreeNode | undefined | null | void> = new vscode.EventEmitter<TreeNode | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<TreeNode | undefined | null | void> = this._onDidChangeTreeData.event;

    private _onUsersUpdated: vscode.EventEmitter<UserStatus[]> = new vscode.EventEmitter<UserStatus[]>();
    readonly onUsersUpdated: vscode.Event<UserStatus[]> = this._onUsersUpdated.event;

    private _onConnectionStatusChanged: vscode.EventEmitter<ConnectionStatus> = new vscode.EventEmitter<ConnectionStatus>();
    readonly onConnectionStatusChanged: vscode.Event<ConnectionStatus> = this._onConnectionStatusChanged.event;

    private context: vscode.ExtensionContext;
    private profile: GitHubUser;
    private allUsers: UserStatus[] = [];
    private wsClient: WsClient;
    private followers: GitHubUser[];
    private following: GitHubUser[];
    private githubService: GitHubService;
    private closeFriends: string[] = [];
    public isGitHubConnected: boolean;
    private isAuthenticated: boolean;
    private _connectionStatus: ConnectionStatus = 'disconnected';

    constructor(
        context: vscode.ExtensionContext,
        profile: GitHubUser,
        followers: GitHubUser[],
        following: GitHubUser[],
        githubService: GitHubService,
        isGitHubConnected: boolean,
        isAuthenticated: boolean
    ) {
        this.context = context;
        this.profile = profile;
        this.followers = followers;
        this.following = following;
        this.githubService = githubService;
        this.isGitHubConnected = isGitHubConnected;
        this.isAuthenticated = isAuthenticated;
        this.closeFriends = this.context.globalState.get<string[]>('closeFriends', []);

        this.wsClient = new WsClient(
            (users) => {
                this.allUsers = users;
                this._onUsersUpdated.fire(users);
                this.refresh();
            },
            (status) => {
                this._connectionStatus = status;
                this._onConnectionStatusChanged.fire(status);
                this.refresh();
            }
        );

        // Connect with username and optional token
        const token = this.isGitHubConnected ? githubService.getToken() : undefined;
        if (this.isAuthenticated && profile.login) {
            this.wsClient.connect(profile.login, token);
        }
    }

    setAuthenticated(value: boolean) {
        this.isAuthenticated = value;
        this.refresh();
    }

    get connectionStatus(): ConnectionStatus {
        return this._connectionStatus;
    }

    reconnect() {
        if (this.isAuthenticated) {
            this.wsClient.reconnect();
        }
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

    // Public getters for GitHubViewProvider
    public getFollowersList(): GitHubUser[] {
        return this.followers;
    }

    public getFollowingList(): GitHubUser[] {
        return this.following;
    }

    public getAllUsers(): UserStatus[] {
        return this.allUsers;
    }

    public getProfile(): GitHubUser {
        return this.profile;
    }

    getChildren(element?: TreeNode): Thenable<TreeNode[]> {
        // If not authenticated, return empty array to show Welcome View
        if (!this.isAuthenticated) {
            return Promise.resolve([]);
        }

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

    private getCategories(): TreeNode[] {
        const closeFriendsCount = this.getCloseFriendsUsers().length;
        const categories: TreeNode[] = [
            new Category('Close Friends', vscode.TreeItemCollapsibleState.Expanded, closeFriendsCount)
        ];


        // Status indicator moved to separate "Connection Status" view
        return categories;
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

        return users.map(u => {
            // Determine if manual connection
            // Manual connections are:
            // 1. If not connected to GitHub, everyone is manual
            // 2. If connected to GitHub, users NOT in followers/following (invite code connections)
            // 3. Pinned close friends are NOT necessarily manual (they might be GitHub followers too)

            let isManual = false;

            if (!this.isGitHubConnected) {
                // Guest mode: all connections are manual
                isManual = true;
            } else {
                // GitHub mode: manual only if NOT in followers/following
                const isFollower = this.followers.some(f => f.login.toLowerCase() === u.username.toLowerCase());
                const isFollowing = this.following.some(f => f.login.toLowerCase() === u.username.toLowerCase());
                isManual = !isFollower && !isFollowing;
            }

            return new UserNode(u, vscode.TreeItemCollapsibleState.None, isManual);
        });
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

        return this.allUsers.filter(u => {
            // Include if pinned as close friend
            if (closeFriendsLower.includes(u.username.toLowerCase())) {
                return true;
            }

            // Include if manual connection (not in followers/following)
            // This includes users connected via invite codes
            if (this.isGitHubConnected) {
                const isFollower = this.followers.some(f => f.login.toLowerCase() === u.username.toLowerCase());
                const isFollowing = this.following.some(f => f.login.toLowerCase() === u.username.toLowerCase());
                const isManual = !isFollower && !isFollowing;
                return isManual;
            } else {
                // If not connected to GitHub, all connections are manual
                return true;
            }
        });
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

export class GitHubViewProvider implements vscode.TreeDataProvider<TreeNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<TreeNode | undefined | null | void> = new vscode.EventEmitter<TreeNode | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<TreeNode | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private sidebarProvider: SidebarProvider) {
        // Listen for updates from the main provider
        sidebarProvider.onUsersUpdated(() => {
            this.refresh();
        });
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TreeNode): vscode.TreeItem {
        return element;
    }

    getChildren(element?: TreeNode): Thenable<TreeNode[]> {
        // If not connected to GitHub, return empty to show Welcome View
        if (!this.sidebarProvider.isGitHubConnected) {
            return Promise.resolve([]);
        }

        if (element) {
            if (element instanceof Category) {
                return Promise.resolve(this.getUsersForCategory(element.label));
            }
            return Promise.resolve([]);
        }

        // Root: Categories
        return Promise.resolve(this.getCategories());
    }

    private getCategories(): Category[] {
        const followingCount = this.getFollowingUsers().length;
        const followersCount = this.getFollowersUsers().length;
        const allUsersCount = this.sidebarProvider.getAllUsers().filter(u => u.username !== this.sidebarProvider.getProfile().login).length;

        return [
            new Category('Following', vscode.TreeItemCollapsibleState.Collapsed, followingCount),
            new Category('Followers', vscode.TreeItemCollapsibleState.Collapsed, followersCount),
            new Category('All Users', vscode.TreeItemCollapsibleState.Collapsed, allUsersCount),
        ];
    }

    private getUsersForCategory(category: string): UserNode[] {
        let users: UserStatus[] = [];

        switch (category) {
            case 'Following':
                users = this.getFollowingUsers();
                break;
            case 'Followers':
                users = this.getFollowersUsers();
                break;
            case 'All Users':
                users = this.sidebarProvider.getAllUsers().filter(u => u.username !== this.sidebarProvider.getProfile().login);
                break;
        }

        return users.map(u => new UserNode(u, vscode.TreeItemCollapsibleState.None));
    }

    private getFollowingUsers(): UserStatus[] {
        const followingLogins = this.sidebarProvider.getFollowingList().map(f => f.login.toLowerCase());
        return this.sidebarProvider.getAllUsers().filter(u => followingLogins.includes(u.username.toLowerCase()));
    }

    private getFollowersUsers(): UserStatus[] {
        const followerLogins = this.sidebarProvider.getFollowersList().map(f => f.login.toLowerCase());
        return this.sidebarProvider.getAllUsers().filter(u => followerLogins.includes(u.username.toLowerCase()));
    }
}

type TreeNode = Category | UserNode | StatusIndicatorNode;

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
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        isManualConnection: boolean = false
    ) {
        super(user.username, collapsibleState);

        // Richer description: Activity • Project (Language)
        let description = '';

        if (user.status === 'Offline') {
            if (user.lastSeen) {
                const lastSeenTime = this.formatLastSeen(user.lastSeen);
                description = `Last seen ${lastSeenTime}`;
            } else {
                description = 'Offline';
            }
        } else {
            // Online/Away
            const parts = [];
            if (user.activity) parts.push(user.activity);

            // Only show project/lang if not Hidden
            if (user.project && user.project !== 'Hidden') parts.push(user.project);
            if (user.language && user.language !== 'Hidden') parts.push(`(${user.language})`);

            description = parts.join(' • ');
        }

        this.tooltip = new vscode.MarkdownString(
            `**${user.username}**\n\n` +
            `Status: ${user.status}\n` +
            `Activity: ${user.activity}\n` +
            (user.project && user.project !== 'Hidden' ? `Project: ${user.project}\n` : '') +
            (user.language && user.language !== 'Hidden' ? `Language: ${user.language}` : '')
        );

        this.description = description;

        // Set context value for commands
        // 'user' is the base context. We add 'manual' if it's a manual connection.
        this.contextValue = isManualConnection ? 'user-manual' : 'user';

        this.setIcon(user.status);
    }

    private formatLastSeen(timestamp: number): string {
        const now = Date.now();
        const diff = now - timestamp;

        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (minutes < 1) return 'just now';
        if (minutes < 60) return `${minutes}m ago`;
        if (hours < 24) return `${hours}h ago`;
        return `${days}d ago`;
    }

    private setIcon(status: string) {
        if (status === 'Online') {
            // Vibrant Green Dot
            this.iconPath = new vscode.ThemeIcon('record', new vscode.ThemeColor('charts.green'));
        } else if (status === 'Away') {
            // Vibrant Yellow Dot
            this.iconPath = new vscode.ThemeIcon('record', new vscode.ThemeColor('charts.yellow'));
        } else {
            // Grey Outline
            this.iconPath = new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('charts.gray'));
        }
    }
}

class StatusIndicatorNode extends vscode.TreeItem {
    constructor(status: ConnectionStatus) {
        let label: string;
        let icon: vscode.ThemeIcon;
        let tooltip: string;

        switch (status) {
            case 'connected':
                label = 'Connected';
                icon = new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
                tooltip = 'Connected to server';
                break;
            case 'connecting':
                label = 'Connecting...';
                icon = new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.yellow'));
                tooltip = 'Connecting to server...';
                break;
            case 'error':
                label = 'Connection Error';
                icon = new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
                tooltip = 'Failed to connect. Click refresh to retry.';
                break;
            case 'disconnected':
            default:
                label = 'Disconnected';
                icon = new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('charts.gray'));
                tooltip = 'Not connected to server';
                break;
        }

        super(label, vscode.TreeItemCollapsibleState.None);
        this.iconPath = icon;
        this.tooltip = tooltip;
        this.contextValue = 'statusIndicator';
        this.description = '';
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
