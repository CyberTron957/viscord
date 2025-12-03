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

    constructor(
        context: vscode.ExtensionContext,
        profile: GitHubUser,
        followers: GitHubUser[],
        following: GitHubUser[],
        githubService: GitHubService
    ) {
        this.context = context;
        this.profile = profile;
        this.followers = followers;
        this.following = following;
        this.githubService = githubService;
        this.closeFriends = this.context.globalState.get<string[]>('closeFriends', []);

        this.wsClient = new WsClient((users) => {
            this.allUsers = users;
            this.refresh();
        });

        // Connect with GitHub username and token
        const token = githubService.getToken();
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
        const followingLogins = this.following.map(f => f.login);
        return this.allUsers.filter(u => followingLogins.includes(u.username));
    }

    private getFollowersUsers(): UserStatus[] {
        const followerLogins = this.followers.map(f => f.login);
        return this.allUsers.filter(u => followerLogins.includes(u.username));
    }

    private getCloseFriendsUsers(): UserStatus[] {
        return this.allUsers.filter(u => this.closeFriends.includes(u.username));
    }

    public updateStatus(status: Partial<UserStatus>) {
        this.wsClient.updateStatus(status);
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
        this.tooltip = `${user.username} - ${user.status}\nProject: ${user.project}\nLanguage: ${user.language}`;
        this.description = `${user.status} - ${user.activity}`;
        this.contextValue = 'user';

        this.setIcon(user.status);
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
