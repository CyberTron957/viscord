import * as vscode from 'vscode';
import { SidebarProvider } from './sidebarProvider';
import { ActivityTracker } from './activityTracker';
import { GitHubService } from './githubService';

export async function activate(context: vscode.ExtensionContext) {
    console.log('VS Code Social Presence extension is activating');

    const githubService = new GitHubService();
    let profile: any = null;
    let followers: any[] = [];
    let following: any[] = [];
    let isGitHubConnected = false;

    // Check if we have a stored auth state
    let authState = context.globalState.get<'github' | 'guest' | null>('authState', null);

    // Show choice dialog only on first activation
    if (authState === null) {
        const choice = await vscode.window.showInformationMessage(
            'Welcome to Social Presence! How would you like to connect?',
            'Connect GitHub',
            'Continue without sign-in'
        );

        if (!choice) {
            // User cancelled - default to guest
            authState = 'guest';
        } else if (choice === 'Connect GitHub') {
            authState = 'github';
        } else {
            authState = 'guest';
        }

        await context.globalState.update('authState', authState);
    }

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
            // Fall back to guest mode
            authState = 'guest';
            await context.globalState.update('authState', 'guest');
        }
    }

    // Guest mode setup
    if (authState === 'guest' || !isGitHubConnected) {
        let username = context.globalState.get<string>('guestUsername') || '';

        if (!username) {
            const input = await vscode.window.showInputBox({
                prompt: 'Enter your username',
                placeHolder: 'GuestUser123',
                validateInput: (value) => {
                    if (!value || value.length < 3) {
                        return 'Username must be at least 3 characters';
                    }
                    if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
                        return 'Username can only contain letters, numbers, hyphens, and underscores';
                    }
                    return null;
                }
            });

            if (!input) {
                vscode.window.showErrorMessage('Username is required to use Social Presence');
                return;
            }

            username = input;
            await context.globalState.update('guestUsername', username);
        }

        profile = {
            login: username,
            avatar_url: 'https://avatars.githubusercontent.com/u/0?s=200&v=4',
            html_url: ''
        };
        isGitHubConnected = false;
        console.log(`Guest mode: ${username}`);
    }

    // Set context for conditional UI visibility
    vscode.commands.executeCommand('setContext', 'vscode-social-presence:githubConnected', isGitHubConnected);

    // Create Status Bar Item
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.text = isGitHubConnected
        ? `$(account) ${profile.login}`
        : `$(account) ${profile.login} (Guest)`;
    statusBarItem.tooltip = 'Click to copy username';
    statusBarItem.command = 'vscode-social-presence.copyUsername';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    const sidebarProvider = new SidebarProvider(context, profile, followers, following, githubService, isGitHubConnected);
    vscode.window.registerTreeDataProvider('social-presence-view', sidebarProvider);

    const activityTracker = new ActivityTracker((status) => {
        if (sidebarProvider) {
            sidebarProvider.updateStatus(status);
        }
    });
    context.subscriptions.push({ dispose: () => activityTracker.dispose() });

    // Watch for configuration changes and apply them in real-time
    const configWatcher = vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('vscode-social-presence')) {
            const config = vscode.workspace.getConfiguration('vscode-social-presence');
            const visibilityMode = config.get<string>('visibilityMode', 'followers');

            // Send updated preferences to server
            sidebarProvider.sendMessage({
                type: 'updatePreferences',
                preferences: {
                    visibility_mode: visibilityMode
                }
            });

            vscode.window.showInformationMessage('Social Presence settings updated');
        }
    });
    context.subscriptions.push(configWatcher);

    // Connect GitHub command (only visible when not connected)
    vscode.commands.registerCommand('vscode-social-presence.connectGitHub', async () => {
        try {
            const session = await githubService.authenticate();
            console.log('GitHub authenticated:', session.account.label);

            const newProfile = await githubService.getProfile();
            const newFollowers = await githubService.getFollowers();
            const newFollowing = await githubService.getFollowing();

            // Get current guest username if any
            const guestUsername = context.globalState.get<string>('guestUsername');

            // Update state
            await context.globalState.update('authState', 'github');
            vscode.commands.executeCommand('setContext', 'vscode-social-presence:githubConnected', true);

            // Update status bar
            statusBarItem.text = `$(account) ${newProfile.login}`;

            // Reconnect sidebar with GitHub data (and create alias)
            sidebarProvider.connectGitHub(newProfile, newFollowers, newFollowing, guestUsername);

            vscode.window.showInformationMessage(`Connected to GitHub as ${newProfile.login}${guestUsername ? ` (was ${guestUsername})` : ''}`);
        } catch (error) {
            vscode.window.showErrorMessage('Failed to connect to GitHub');
            console.error('GitHub connection failed:', error);
        }
    });

    vscode.commands.registerCommand('vscode-social-presence.refresh', () => {
        sidebarProvider.refresh();
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
        vscode.env.clipboard.writeText(profile.login);
        vscode.window.showInformationMessage(`Username copied to clipboard: ${profile.login}`);
    });

    vscode.commands.registerCommand('vscode-social-presence.logout', async () => {
        // Sign out of GitHub
        await githubService.signOut();

        // Update auth state to guest
        await context.globalState.update('authState', 'guest');
        vscode.commands.executeCommand('setContext', 'vscode-social-presence:githubConnected', false);

        // Keep guest username
        const guestUsername = context.globalState.get<string>('guestUsername') || profile.login;

        // Update status bar
        statusBarItem.text = `$(account) ${guestUsername} (Guest)`;

        // Clear GitHub data but keep manual connections
        sidebarProvider.disconnectGitHub(guestUsername);

        vscode.window.showInformationMessage(`Logged out of GitHub. Manual connections preserved.`);
    });

    vscode.commands.registerCommand('vscode-social-presence.openSettings', () => {
        vscode.commands.executeCommand('workbench.action.openSettings', 'vscode-social-presence');
    });

    // Create Invite Link command
    vscode.commands.registerCommand('vscode-social-presence.createInvite', () => {
        sidebarProvider.sendMessage({ type: 'createInvite' });
    });

    // Accept Invite Code command
    vscode.commands.registerCommand('vscode-social-presence.acceptInvite', async () => {
        const code = await vscode.window.showInputBox({
            prompt: 'Enter invite code',
            placeHolder: 'ABC123',
            validateInput: (value) => {
                if (!value || value.length !== 6) {
                    return 'Invite code must be 6 characters';
                }
                return null;
            }
        });

        if (code) {
            sidebarProvider.sendMessage({ type: 'acceptInvite', code: code.toUpperCase() });
        }
    });

    // All commands are already registered, no need for disposable    });

    // Remove Connection command (for manual connections)
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

    // Reset command (for development/testing)
    vscode.commands.registerCommand('vscode-social-presence.reset', async () => {
        const confirm = await vscode.window.showWarningMessage(
            'This will clear all local data (auth state, guest username, close friends). Continue?',
            'Yes, Reset',
            'Cancel'
        );

        if (confirm === 'Yes, Reset') {
            await context.globalState.update('authState', undefined);
            await context.globalState.update('guestUsername', undefined);
            await context.globalState.update('closeFriends', undefined);

            vscode.window.showInformationMessage('All local data cleared. Please reload window (Cmd+R).');
        }
    });
}

export function deactivate() {
    // Cleanup will happen automatically via context.subscriptions
}
