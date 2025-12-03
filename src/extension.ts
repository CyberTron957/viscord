import * as vscode from 'vscode';
import { SidebarProvider } from './sidebarProvider';
import { ActivityTracker } from './activityTracker';
import { GitHubService } from './githubService';

export async function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "vscode-social-presence" is now active!');

    // Initialize GitHub Service
    const githubService = new GitHubService();

    try {
        const session = await githubService.authenticate();
        console.log('GitHub authenticated:', session.account.label);
    } catch (error) {
        vscode.window.showErrorMessage('Failed to authenticate with GitHub. Please try again.');
        console.error('GitHub auth error:', error);
        return;
    }

    // Fetch GitHub profile and followers/following
    const profile = await githubService.getProfile();
    const followers = await githubService.getFollowers();
    const following = await githubService.getFollowing();

    console.log(`GitHub user: ${profile.login}, Followers: ${followers.length}, Following: ${following.length}`);

    // Create Status Bar Item
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    statusBarItem.text = `$(account) ${profile.login}`;
    statusBarItem.tooltip = `VS Code Social Presence: ${profile.login}\nClick to copy username`;
    statusBarItem.command = 'vscode-social-presence.copyUsername';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    const sidebarProvider = new SidebarProvider(context, profile, followers, following, githubService);
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
