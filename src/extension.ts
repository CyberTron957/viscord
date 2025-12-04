import * as vscode from 'vscode';
import { SidebarProvider, GitHubViewProvider } from './sidebarProvider';
import { ExplorerPresenceProvider } from './explorerPresenceProvider';
import { ActivityTracker } from './activityTracker';
import { GitHubService } from './githubService';

export async function activate(context: vscode.ExtensionContext) {
    console.log('VS Code Social Presence extension is activating');

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
            profile = {
                login: username,
                avatar_url: 'https://avatars.githubusercontent.com/u/0?s=200&v=4',
                html_url: ''
            };
            isGitHubConnected = false;
        } else {
            // Invalid guest state, reset
            authState = null;
        }
    }

    // If no valid auth state, profile is null.
    if (!profile) {
        profile = { login: '', avatar_url: '', html_url: '' };
    }

    // Set context keys
    vscode.commands.executeCommand('setContext', 'vscode-social-presence:githubConnected', isGitHubConnected);
    vscode.commands.executeCommand('setContext', 'vscode-social-presence:authenticated', authState !== null);

    // Create Status Bar Item
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    if (authState) {
        statusBarItem.text = isGitHubConnected
            ? `$(account) ${profile.login}`
            : `$(account) ${profile.login} (Guest)`;
        statusBarItem.tooltip = 'Click to copy username';
        statusBarItem.command = 'vscode-social-presence.copyUsername';
        statusBarItem.show();
    }
    context.subscriptions.push(statusBarItem);

    // Initialize Providers
    const sidebarProvider = new SidebarProvider(context, profile, followers, following, githubService, isGitHubConnected, authState !== null);
    const githubViewProvider = new GitHubViewProvider(sidebarProvider);

    // Register Views
    // 1. Close Friends & Guests View
    const friendsTreeView = vscode.window.createTreeView('social-presence-friends', {
        treeDataProvider: sidebarProvider,
        showCollapseAll: true
    });
    context.subscriptions.push(friendsTreeView);

    // 2. GitHub Network View
    const githubTreeView = vscode.window.createTreeView('social-presence-github', {
        treeDataProvider: githubViewProvider,
        showCollapseAll: true
    });
    context.subscriptions.push(githubTreeView);

    // ... (rest of code)

    // Reset Extension - Full reset to fresh install state
    vscode.commands.registerCommand('vscode-social-presence.resetExtension', async () => {
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
            vscode.commands.executeCommand('setContext', 'vscode-social-presence:authenticated', false);
            vscode.commands.executeCommand('setContext', 'vscode-social-presence:githubConnected', false);

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
    const config = vscode.workspace.getConfiguration('vscode-social-presence');
    const explorerProvider = new ExplorerPresenceProvider();

    if (config.get('showInExplorer', true)) {
        vscode.window.registerTreeDataProvider('social-presence-explorer', explorerProvider);
    }

    // Create status bar item for online friends count
    const onlineFriendsStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
    onlineFriendsStatusBar.command = 'workbench.view.extension.social-presence-sidebar';
    onlineFriendsStatusBar.tooltip = 'Click to view Social Presence';
    context.subscriptions.push(onlineFriendsStatusBar);

    // Sync updates
    sidebarProvider.onUsersUpdated((users: any[]) => {
        const onlineUsers = users.filter(u => u.status !== 'Offline');
        const onlineCount = onlineUsers.length;

        // Update explorer provider
        explorerProvider.updateUsers(users);

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
        if (e.affectsConfiguration('vscode-social-presence')) {
            const config = vscode.workspace.getConfiguration('vscode-social-presence');

            // Handle visibility mode changes
            if (e.affectsConfiguration('vscode-social-presence.visibilityMode')) {
                const visibilityMode = config.get<string>('visibilityMode', 'followers');
                sidebarProvider.sendMessage({
                    type: 'updatePreferences',
                    preferences: { visibility_mode: visibilityMode }
                });
            }

            // Handle UI visibility changes
            if (e.affectsConfiguration('vscode-social-presence.showInStatusBar')) {
                const showStatusBar = config.get('showInStatusBar', true);
                if (!showStatusBar) onlineFriendsStatusBar.hide();
            }

            if (e.affectsConfiguration('vscode-social-presence.showBadge') &&
                !config.get('showBadge', true)) {
                friendsTreeView.badge = undefined;
            }
        }
    });
    context.subscriptions.push(configWatcher);

    // --- Commands ---

    // Continue as Guest
    vscode.commands.registerCommand('vscode-social-presence.continueAsGuest', async () => {
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
        vscode.commands.executeCommand('setContext', 'vscode-social-presence:authenticated', true);
        vscode.commands.executeCommand('setContext', 'vscode-social-presence:githubConnected', false);

        // Update profile and reconnect
        const guestProfile = {
            login: username,
            avatar_url: 'https://avatars.githubusercontent.com/u/0?s=200&v=4',
            html_url: ''
        };

        statusBarItem.text = `$(account) ${username} (Guest)`;
        statusBarItem.show();

        sidebarProvider.setAuthenticated(true);
        sidebarProvider.reconnectAsGuest(username);
        vscode.window.showInformationMessage(`Connected as guest: ${username}`);
    });

    // Connect GitHub
    vscode.commands.registerCommand('vscode-social-presence.connectGitHub', async () => {
        try {
            const session = await githubService.authenticate();
            const newProfile = await githubService.getProfile();
            const newFollowers = await githubService.getFollowers();
            const newFollowing = await githubService.getFollowing();
            const guestUsername = context.globalState.get<string>('guestUsername');

            await context.globalState.update('authState', 'github');
            vscode.commands.executeCommand('setContext', 'vscode-social-presence:authenticated', true);
            vscode.commands.executeCommand('setContext', 'vscode-social-presence:githubConnected', true);

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
    });

    vscode.commands.registerCommand('vscode-social-presence.refresh', () => {
        // Refresh views and retry connection
        sidebarProvider.reconnect();
        sidebarProvider.refresh();
        githubViewProvider.refresh();
    });

    vscode.commands.registerCommand('vscode-social-presence.pinCloseFriend', async (item: any) => {
        if (item && item.user) {
            sidebarProvider.addCloseFriend(item.user.username);
            vscode.window.showInformationMessage(`Pinned ${item.user.username} to Close Friends`);
        }
    });

    vscode.commands.registerCommand('vscode-social-presence.unpinCloseFriend', (item: any) => {
        if (item && item.user) {
            sidebarProvider.removeCloseFriend(item.user.username);
            vscode.window.showInformationMessage(`Unpinned ${item.user.username} from Close Friends`);
        }
    });

    vscode.commands.registerCommand('vscode-social-presence.copyUsername', () => {
        const currentProfile = sidebarProvider.getProfile();
        if (currentProfile && currentProfile.login) {
            vscode.env.clipboard.writeText(currentProfile.login);
            vscode.window.showInformationMessage(`Username copied: ${currentProfile.login}`);
        }
    });

    vscode.commands.registerCommand('vscode-social-presence.logout', async () => {
        await githubService.signOut();
        await context.globalState.update('authState', 'guest');
        vscode.commands.executeCommand('setContext', 'vscode-social-presence:githubConnected', false);

        const guestUsername = context.globalState.get<string>('guestUsername') || 'Guest';
        statusBarItem.text = `$(account) ${guestUsername} (Guest)`;

        sidebarProvider.disconnectGitHub(guestUsername);
        githubViewProvider.refresh();

        vscode.window.showInformationMessage(`Logged out of GitHub. Manual connections preserved.`);
    });

    vscode.commands.registerCommand('vscode-social-presence.openSettings', () => {
        vscode.commands.executeCommand('workbench.action.openSettings', 'vscode-social-presence');
    });

    vscode.commands.registerCommand('vscode-social-presence.createInvite', () => {
        sidebarProvider.sendMessage({ type: 'createInvite' });
    });

    vscode.commands.registerCommand('vscode-social-presence.acceptInvite', async () => {
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

    vscode.commands.registerCommand('vscode-social-presence.removeConnection', async (item: any) => {
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

    vscode.commands.registerCommand('vscode-social-presence.reset', async () => {
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
    vscode.commands.registerCommand('vscode-social-presence.clearCache', async () => {
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

    // Reset Extension - Full reset to fresh install state


    // Sign Out of GitHub (but keep guest data)
    vscode.commands.registerCommand('vscode-social-presence.signOutGitHub', async () => {
        const confirm = await vscode.window.showWarningMessage(
            'Sign out of GitHub? You will switch to guest mode.',
            'Sign Out',
            'Cancel'
        );

        if (confirm === 'Sign Out') {
            await githubService.signOut();
            await context.globalState.update('authState', 'guest');
            vscode.commands.executeCommand('setContext', 'vscode-social-presence:githubConnected', false);

            const guestUsername = context.globalState.get<string>('guestUsername') || 'Guest';
            statusBarItem.text = `$(account) ${guestUsername} (Guest)`;

            sidebarProvider.disconnectGitHub(guestUsername);
            githubViewProvider.refresh();

            vscode.window.showInformationMessage('Signed out of GitHub. Your manual connections are preserved.');
        }
    });
}

export function deactivate() { }
