import * as vscode from 'vscode';
import { SidebarProvider } from './sidebarProvider';
import { ActivityTracker } from './activityTracker';
import { GitHubService } from './githubService';

export async function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "vscode-social-presence" is now active!');

    // Try GitHub authentication (optional)
    const githubService = new GitHubService();
    let profile: any = null;
    let followers: any[] = [];
    let following: any[] = [];
    let useGitHub = false;

    try {
        // Ask user if they want to use GitHub
        const choice = await vscode.window.showInformationMessage(
            'How would you like to use VS Code Social Presence?',
            'Login with GitHub',
            'Continue without GitHub'
        );

        if (choice === 'Login with GitHub') {
            const session = await githubService.authenticate();
            console.log('GitHub authenticated:', session.account.label);

            // Fetch GitHub profile and followers/following
            profile = await githubService.getProfile();
            followers = await githubService.getFollowers();
            following = await githubService.getFollowing();
            useGitHub = true;

            console.log(`GitHub user: ${profile.login}, Followers: ${followers.length}, Following: ${following.length}`);
        } else {
            // Use username-only mode
            const username = await vscode.window.showInputBox({
                prompt: 'Enter a username for Social Presence',
                placeHolder: 'your-username',
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

            if (!username) {
                vscode.window.showErrorMessage('Username is required to use Social Presence');
                return;
            }

            profile = { login: username };
            useGitHub = false;
            console.log(`Username-only mode: ${username}`);
        }
    } catch (error) {
        vscode.window.showErrorMessage('Failed to initialize Social Presence');
        console.error('Initialization error:', error);
        return;
    }

    // Create Status Bar Item
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.text = `$(account) ${profile.login}`;
    statusBarItem.tooltip = 'Click to copy username';
    statusBarItem.command = 'vscode-social-presence.copyUsername';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    const sidebarProvider = new SidebarProvider(context, profile, followers, following, useGitHub ? githubService : null);
    vscode.window.registerTreeDataProvider('social-presence-view', sidebarProvider);

    const activityTracker = new ActivityTracker((status) => {
        sidebarProvider.updateStatus(status);
    });
    context.subscriptions.push({ dispose: () => activityTracker.dispose() });

    let disposable = vscode.commands.registerCommand('vscode-social-presence.helloWorld', () => {
        vscode.window.showInformationMessage('Hello World from VS Code Social Presence!');
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
        await githubService.signOut();
        vscode.window.showInformationMessage('Logged out of GitHub. Please reload to log in again.');
    });

    vscode.commands.registerCommand('vscode-social-presence.openSettings', () => {
        vscode.commands.executeCommand('workbench.action.openSettings', 'vscode-social-presence');
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {
    // Cleanup will happen automatically via context.subscriptions
}
