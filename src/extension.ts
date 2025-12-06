import * as vscode from 'vscode';
import { SidebarProvider, GitHubViewProvider } from './sidebarProvider';
import { ExplorerPresenceProvider } from './explorerPresenceProvider';
import { ActivityTracker } from './activityTracker';
import { GitHubService } from './githubService';
import { createGuestProfile, GUEST_AVATAR_URL } from './utils';

export async function activate(context: vscode.ExtensionContext) {
    console.log('VS Code viscord extension is activating');

    const githubService = new GitHubService();
    let profile: any = null;
    let followers: any[] = [];
    let following: any[] = [];
    let isGitHubConnected = false;

    // Check auth state
    let authState = context.globalState.get<'github' | 'guest' | null>('authState', null);

    // Authenticate based on stored state  
    if (authState === 'github') {
        try {
            const session = await githubService.authenticate();
            console.log('GitHub authenticated:', session.account.label);

            profile = await githubService.getProfile();
            followers = await githubService.getFollowers();
            following = await githubService.getFollowing();
            isGitHubConnected = true;

            console.log(`GitHub user: ${profile.login}, Followers: ${followers.length}, Following: ${following.length}`);
        } catch (error) {
            console.error('GitHub auth failed:', error);
            // Fall back to guest mode if possible, or just reset
            authState = 'guest';
            await context.globalState.update('authState', 'guest');
        }
    }

    // Guest mode setup
    if (authState === 'guest') {
        let username = context.globalState.get<string>('guestUsername') || '';
        if (username) {
            profile = createGuestProfile(username);
            isGitHubConnected = false;
        } else {
            // Invalid guest state, reset
            authState = null;
        }
    }

    // If no valid auth state, profile is null.
    if (!profile) {
        profile = { id: 0, login: '', avatar_url: '', html_url: '' };
    }

    // Set context keys
    vscode.commands.executeCommand('setContext', 'vscode-viscord:githubConnected', isGitHubConnected);
    vscode.commands.executeCommand('setContext', 'vscode-viscord:authenticated', authState !== null);

    // Create Status Bar Item
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    if (authState) {
        statusBarItem.text = isGitHubConnected
            ? `$(account) ${profile.login}`
            : `$(account) ${profile.login} (Guest)`;
        statusBarItem.tooltip = 'Click to copy username';
        statusBarItem.command = 'vscode-viscord.copyUsername';
        statusBarItem.show();
    }
    context.subscriptions.push(statusBarItem);

    // Initialize Providers
    const sidebarProvider = new SidebarProvider(context, profile, followers, following, githubService, isGitHubConnected, authState !== null);
    const githubViewProvider = new GitHubViewProvider(sidebarProvider);

    // *** CRITICAL: Register welcome view commands IMMEDIATELY after providers are initialized ***
    // This ensures the commands are available when the welcome view buttons render in packed extensions
    // Continue as Guest Command
    context.subscriptions.push(vscode.commands.registerCommand('vscode-viscord.continueAsGuest', async () => {
        let username = context.globalState.get<string>('guestUsername') || '';

        if (!username) {
            const input = await vscode.window.showInputBox({
                prompt: 'Enter a username to continue as guest',
                placeHolder: 'GuestUser123',
                validateInput: (value) => {
                    if (!value || value.length < 3) return 'Username must be at least 3 characters';
                    if (!/^[a-zA-Z0-9_-]+$/.test(value)) return 'Username can only contain letters, numbers, hyphens, and underscores';
                    return null;
                }
            });

            if (!input) return;
            username = input;
            await context.globalState.update('guestUsername', username);
        }

        // Update state
        await context.globalState.update('authState', 'guest');
        vscode.commands.executeCommand('setContext', 'vscode-viscord:authenticated', true);
        vscode.commands.executeCommand('setContext', 'vscode-viscord:githubConnected', false);

        // Update profile and reconnect
        const guestProfile = createGuestProfile(username);

        statusBarItem.text = `$(account) ${username} (Guest)`;
        statusBarItem.show();

        sidebarProvider.setAuthenticated(true);
        sidebarProvider.reconnectAsGuest(username);
        vscode.window.showInformationMessage(`Connected as guest: ${username}`);
    }));

    // Connect GitHub Command
    context.subscriptions.push(vscode.commands.registerCommand('vscode-viscord.connectGitHub', async () => {
        try {
            const session = await githubService.authenticate();
            const newProfile = await githubService.getProfile();
            const newFollowers = await githubService.getFollowers();
            const newFollowing = await githubService.getFollowing();
            const guestUsername = context.globalState.get<string>('guestUsername');

            await context.globalState.update('authState', 'github');
            vscode.commands.executeCommand('setContext', 'vscode-viscord:authenticated', true);
            vscode.commands.executeCommand('setContext', 'vscode-viscord:githubConnected', true);

            statusBarItem.text = `$(account) ${newProfile.login}`;
            statusBarItem.show();

            sidebarProvider.setAuthenticated(true);
            sidebarProvider.connectGitHub(newProfile, newFollowers, newFollowing, guestUsername);

            // Refresh GitHub view
            githubViewProvider.refresh();

            vscode.window.showInformationMessage(`Connected to GitHub as ${newProfile.login}`);
        } catch (error) {
            vscode.window.showErrorMessage('Failed to connect to GitHub');
            console.error('GitHub connection failed:', error);
        }
    }));


    // Register Views
    // 1. Close Friends & Guests View
    const friendsTreeView = vscode.window.createTreeView('viscord-friends', {
        treeDataProvider: sidebarProvider,
        showCollapseAll: true
    });
    context.subscriptions.push(friendsTreeView);

    // 2. GitHub Network View
    const githubTreeView = vscode.window.createTreeView('viscord-github', {
        treeDataProvider: githubViewProvider,
        showCollapseAll: true
    });
    context.subscriptions.push(githubTreeView);

    // 3. Connection Status View
    const statusChangeEmitter = new vscode.EventEmitter<void>();
    const statusProvider: vscode.TreeDataProvider<vscode.TreeItem> = {
        onDidChangeTreeData: statusChangeEmitter.event,
        getTreeItem: (element: vscode.TreeItem) => element,
        getChildren: () => {
            const status = sidebarProvider.connectionStatus;
            const statusNode = new (class extends vscode.TreeItem {
                constructor() {
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
                }
            })();
            return Promise.resolve([statusNode]);
        }
    };

    const statusTreeView = vscode.window.createTreeView('viscord-status', {
        treeDataProvider: statusProvider
    });
    context.subscriptions.push(statusTreeView);
    context.subscriptions.push(statusChangeEmitter);

    // Listen to connection status changes and refresh status view
    sidebarProvider.onConnectionStatusChanged(() => {
        statusChangeEmitter.fire();
    });

    // ... (rest of code)

    // Reset Extension - Full reset to fresh install state
    vscode.commands.registerCommand('vscode-viscord.resetExtension', async () => {
        const confirm = await vscode.window.showWarningMessage(
            'This will sign you out of GitHub, clear all local data, and return the extension to its initial state. Continue?',
            { modal: true },
            'Yes, Reset Everything'
        );

        if (confirm === 'Yes, Reset Everything') {
            // Sign out of GitHub
            await githubService.signOut();

            // Clear all stored state
            await context.globalState.update('authState', undefined);
            await context.globalState.update('guestUsername', undefined);
            await context.globalState.update('closeFriends', undefined);

            // Reset context keys
            vscode.commands.executeCommand('setContext', 'vscode-viscord:authenticated', false);
            vscode.commands.executeCommand('setContext', 'vscode-viscord:githubConnected', false);

            // Disconnect WebSocket and update auth state
            sidebarProvider.disconnect();
            sidebarProvider.setAuthenticated(false);

            // Hide status bar
            statusBarItem.hide();

            vscode.window.showInformationMessage(
                'Extension reset complete. Please reload the window.',
                'Reload Window'
            ).then(selection => {
                if (selection === 'Reload Window') {
                    vscode.commands.executeCommand('workbench.action.reloadWindow');
                }
            });
        }
    });

    // 3. Explorer View
    const config = vscode.workspace.getConfiguration('vscode-viscord');
    const explorerProvider = new ExplorerPresenceProvider();

    if (config.get('showInExplorer', true)) {
        vscode.window.registerTreeDataProvider('viscord-explorer', explorerProvider);
    }

    // Create status bar item for online friends count
    const onlineFriendsStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
    onlineFriendsStatusBar.command = 'workbench.view.extension.viscord-sidebar';
    onlineFriendsStatusBar.tooltip = 'Click to view viscord';
    context.subscriptions.push(onlineFriendsStatusBar);

    // Sync updates
    sidebarProvider.onUsersUpdated((users: any[]) => {
        const onlineUsers = users.filter(u => u.status !== 'Offline');
        const onlineCount = onlineUsers.length;

        // Update explorer provider with pinned friends only
        const pinnedFriends = context.globalState.get<string[]>('closeFriends', []);
        explorerProvider.updateUsers(users, pinnedFriends);

        // Update status bar if enabled
        if (config.get('showInStatusBar', true)) {
            if (onlineCount > 0) {
                onlineFriendsStatusBar.text = `$(account) ${onlineCount} online`;
                onlineFriendsStatusBar.show();
            } else {
                onlineFriendsStatusBar.hide();
            }
        } else {
            onlineFriendsStatusBar.hide();
        }

        // Update badge on friends view
        if (config.get('showBadge', true)) {
            if (onlineCount > 0) {
                friendsTreeView.badge = {
                    tooltip: `${onlineCount} friend${onlineCount === 1 ? '' : 's'} online`,
                    value: onlineCount
                };
            } else {
                friendsTreeView.badge = undefined;
            }
        } else {
            friendsTreeView.badge = undefined;
        }
    });

    const activityTracker = new ActivityTracker((status) => {
        if (sidebarProvider && authState) {
            sidebarProvider.updateStatus(status);
        }
    });
    context.subscriptions.push({ dispose: () => activityTracker.dispose() });

    // Watch for configuration changes
    const configWatcher = vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('vscode-viscord')) {
            const config = vscode.workspace.getConfiguration('vscode-viscord');

            // Handle visibility mode changes
            if (e.affectsConfiguration('vscode-viscord.visibilityMode')) {
                const visibilityMode = config.get<string>('visibilityMode', 'followers');
                sidebarProvider.sendMessage({
                    type: 'updatePreferences',
                    preferences: { visibility_mode: visibilityMode }
                });
            }

            // Handle UI visibility changes
            if (e.affectsConfiguration('vscode-viscord.showInStatusBar')) {
                const showStatusBar = config.get('showInStatusBar', true);
                if (!showStatusBar) onlineFriendsStatusBar.hide();
            }

            if (e.affectsConfiguration('vscode-viscord.showBadge') &&
                !config.get('showBadge', true)) {
                friendsTreeView.badge = undefined;
            }
        }
    });
    context.subscriptions.push(configWatcher);

    // --- Commands ---

    // Continue as Guest - ALREADY REGISTERED ABOVE (near line 83)



    // Connect GitHub - ALREADY REGISTERED ABOVE (near line 123)

    vscode.commands.registerCommand('vscode-viscord.refresh', () => {
        // Refresh views and retry connection
        sidebarProvider.reconnect();
        sidebarProvider.refresh();
        githubViewProvider.refresh();
    });

    vscode.commands.registerCommand('vscode-viscord.pinCloseFriend', async (item: any) => {
        if (item && item.user) {
            sidebarProvider.addCloseFriend(item.user.username);
            vscode.window.showInformationMessage(`Pinned ${item.user.username} to Close Friends`);
        }
    });

    vscode.commands.registerCommand('vscode-viscord.unpinCloseFriend', (item: any) => {
        if (item && item.user) {
            sidebarProvider.removeCloseFriend(item.user.username);
            vscode.window.showInformationMessage(`Unpinned ${item.user.username} from Close Friends`);
        }
    });

    vscode.commands.registerCommand('vscode-viscord.copyUsername', () => {
        const currentProfile = sidebarProvider.getProfile();
        if (currentProfile && currentProfile.login) {
            vscode.env.clipboard.writeText(currentProfile.login);
            vscode.window.showInformationMessage(`Username copied: ${currentProfile.login}`);
        }
    });

    // Helper function for signing out of GitHub
    const signOutOfGitHub = async (message: string) => {
        await githubService.signOut();
        await context.globalState.update('authState', 'guest');
        vscode.commands.executeCommand('setContext', 'vscode-viscord:githubConnected', false);

        const guestUsername = context.globalState.get<string>('guestUsername') || 'Guest';
        statusBarItem.text = `$(account) ${guestUsername} (Guest)`;

        sidebarProvider.disconnectGitHub(guestUsername);
        githubViewProvider.refresh();

        vscode.window.showInformationMessage(message);
    };

    vscode.commands.registerCommand('vscode-viscord.logout', async () => {
        await signOutOfGitHub('Logged out of GitHub. Manual connections preserved.');
    });

    vscode.commands.registerCommand('vscode-viscord.openSettings', () => {
        vscode.commands.executeCommand('workbench.action.openSettings', 'vscode-viscord');
    });

    vscode.commands.registerCommand('vscode-viscord.createInvite', () => {
        sidebarProvider.sendMessage({ type: 'createInvite' });
    });

    vscode.commands.registerCommand('vscode-viscord.acceptInvite', async () => {
        const code = await vscode.window.showInputBox({
            prompt: 'Enter invite code',
            placeHolder: 'ABC123',
            validateInput: (value) => {
                if (!value || value.length !== 6) return 'Invite code must be 6 characters';
                return null;
            }
        });

        if (code) {
            sidebarProvider.sendMessage({ type: 'acceptInvite', code: code.toUpperCase() });
        }
    });

    vscode.commands.registerCommand('vscode-viscord.removeConnection', async (item: any) => {
        if (!item || !item.user) {
            vscode.window.showErrorMessage('No user selected');
            return;
        }

        const confirm = await vscode.window.showWarningMessage(
            `Remove connection with ${item.user.username}?`,
            'Yes, Remove',
            'Cancel'
        );

        if (confirm === 'Yes, Remove') {
            sidebarProvider.sendMessage({
                type: 'removeConnection',
                username: item.user.username
            });
            vscode.window.showInformationMessage(`Removed connection with ${item.user.username}`);
        }
    });

    vscode.commands.registerCommand('vscode-viscord.reset', async () => {
        const confirm = await vscode.window.showWarningMessage(
            'This will clear all local data. Continue?',
            'Yes, Reset',
            'Cancel'
        );

        if (confirm === 'Yes, Reset') {
            await context.globalState.update('authState', undefined);
            await context.globalState.update('guestUsername', undefined);
            await context.globalState.update('closeFriends', undefined);
            vscode.window.showInformationMessage('Data cleared. Reload window.');
        }
    });

    // Clear Cache - Refresh data without signing out
    vscode.commands.registerCommand('vscode-viscord.clearCache', async () => {
        const confirm = await vscode.window.showInformationMessage(
            'Clear cached data and refresh? Your authentication will be preserved.',
            'Clear Cache',
            'Cancel'
        );

        if (confirm === 'Clear Cache') {
            // Clear close friends list (but keep auth)
            await context.globalState.update('closeFriends', []);

            // Reconnect WebSocket to get fresh data
            sidebarProvider.reconnect();
            sidebarProvider.refresh();
            githubViewProvider.refresh();

            vscode.window.showInformationMessage('Cache cleared and refreshed!');
        }
    });

    // Sign Out of GitHub (but keep guest data)
    vscode.commands.registerCommand('vscode-viscord.signOutGitHub', async () => {
        const confirm = await vscode.window.showWarningMessage(
            'Sign out of GitHub? You will switch to guest mode.',
            'Sign Out',
            'Cancel'
        );

        if (confirm === 'Sign Out') {
            await signOutOfGitHub('Signed out of GitHub. Your manual connections are preserved.');
        }
    });
}

export function deactivate() { }
