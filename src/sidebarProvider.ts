import * as vscode from 'vscode';
import { WsClient, UserStatus, ConnectionStatus, ChatMessage } from './wsClient';
import { GitHubService, GitHubUser } from './githubService';
import { createGuestProfile, buildUserDescription, buildUserTooltip, getUserStatusIcon, formatLastSeen } from './utils';

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
    private onChatMessage: ((message: ChatMessage) => void) | null = null;
    private unreadCounts: Map<string, number> = new Map();  // username -> unread count

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
            },
            (message) => {
                // Forward chat messages to registered callback
                if (this.onChatMessage) {
                    this.onChatMessage(message);
                }
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

    getWsClient(): WsClient {
        return this.wsClient;
    }

    setOnChatMessage(callback: (message: ChatMessage) => void) {
        this.onChatMessage = callback;
    }

    // Unread message tracking
    incrementUnread(username: string) {
        const current = this.unreadCounts.get(username) || 0;
        this.unreadCounts.set(username, current + 1);
        this.refresh();
    }

    clearUnread(username: string) {
        if (this.unreadCounts.has(username)) {
            this.unreadCounts.delete(username);
            this.refresh();
        }
    }

    getUnreadCount(username: string): number {
        return this.unreadCounts.get(username) || 0;
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

        return users.map(u => new UserNode(u, vscode.TreeItemCollapsibleState.None, this.isManualConnection(u.username), this.getUnreadCount(u.username)));
    }

    private getFollowingUsers(): UserStatus[] {
        const followingLogins = this.following.map(f => f.login.toLowerCase());
        return this.allUsers.filter(u => followingLogins.includes(u.username.toLowerCase()));
    }

    private getFollowersUsers(): UserStatus[] {
        const followerLogins = this.followers.map(f => f.login.toLowerCase());
        return this.allUsers.filter(u => followerLogins.includes(u.username.toLowerCase()));
    }

    /**
     * Check if a user is a manual connection (not in followers/following)
     */
    private isManualConnection(username: string): boolean {
        if (!this.isGitHubConnected) {
            return true; // Guest mode: all connections are manual
        }
        const usernameLower = username.toLowerCase();
        const isFollower = this.followers.some(f => f.login.toLowerCase() === usernameLower);
        const isFollowing = this.following.some(f => f.login.toLowerCase() === usernameLower);
        return !isFollower && !isFollowing;
    }

    private getCloseFriendsUsers(): UserStatus[] {
        const closeFriendsLower = this.closeFriends.map(f => f.toLowerCase());

        return this.allUsers.filter(u => {
            // Include if pinned as close friend
            if (closeFriendsLower.includes(u.username.toLowerCase())) {
                return true;
            }
            // Include if manual connection (not in followers/following)
            return this.isManualConnection(u.username);
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
        this.profile = createGuestProfile(guestUsername);

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
        this.profile = createGuestProfile(guestUsername);

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

        return users.map(u => new UserNode(u, vscode.TreeItemCollapsibleState.None, false, this.sidebarProvider.getUnreadCount(u.username)));
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
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        isManualConnection: boolean = false,
        unreadCount: number = 0
    ) {
        super(user.username, collapsibleState);

        // Show unread indicator if there are unread messages
        if (unreadCount > 0) {
            this.description = `🔵 ${buildUserDescription(user)}`;
        } else {
            this.description = buildUserDescription(user);
        }

        this.tooltip = buildUserTooltip(user);
        this.iconPath = getUserStatusIcon(user.status);

        // Set context value for commands
        // 'user' is the base context. We add 'manual' if it's a manual connection.
        this.contextValue = isManualConnection ? 'user-manual' : 'user';
    }
}
