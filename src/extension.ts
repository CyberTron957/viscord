import * as vscode from 'vscode';
import { SidebarProvider } from './sidebarProvider';
import { ActivityTracker } from './activityTracker';

export async function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "vscode-social-presence" is now active!');

    // Get or set username
    const config = vscode.workspace.getConfiguration('vscode-social-presence');
    let username = config.get<string>('username');

    if (!username) {
        username = await vscode.window.showInputBox({
            prompt: 'Enter a username for VS Code Social Presence',
            placeHolder: 'e.g. DevWizard'
        });

        if (!username) {
            // Fallback to random if user cancels
            username = 'User_' + Math.floor(Math.random() * 1000);
        }
        await config.update('username', username, vscode.ConfigurationTarget.Global);
    }

    // Create Status Bar Item
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    statusBarItem.text = `$(account) ${username}`;
    statusBarItem.tooltip = 'VS Code Social Presence: Click to copy username';
    statusBarItem.command = 'vscode-social-presence.copyUsername';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    const sidebarProvider = new SidebarProvider(context, username);
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

    vscode.commands.registerCommand('vscode-social-presence.addFriend', async () => {
        const friendName = await vscode.window.showInputBox({ prompt: 'Enter friend username' });
        if (friendName) {
            sidebarProvider.addFriend(friendName);
            vscode.window.showInformationMessage(`Added friend: ${friendName}`);
        }
    });

    vscode.commands.registerCommand('vscode-social-presence.removeFriend', (item: any) => {
        if (item && item.label) {
            sidebarProvider.removeFriend(item.label as string);
            vscode.window.showInformationMessage(`Removed friend: ${item.label}`);
        }
    });

    vscode.commands.registerCommand('vscode-social-presence.copyUsername', () => {
        vscode.env.clipboard.writeText(username!);
        vscode.window.showInformationMessage(`Username copied to clipboard: ${username}`);
    });

    vscode.commands.registerCommand('vscode-social-presence.openSettings', () => {
        vscode.commands.executeCommand('workbench.action.openSettings', 'vscode-social-presence');
    });

    context.subscriptions.push(disposable);
}

export function deactivate() { }
