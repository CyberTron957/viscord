import * as vscode from 'vscode';
import { UserStatus } from './wsClient';

export class ActivityTracker {
    private statusUpdateCallback: (status: Partial<UserStatus>) => void;
    private idleTimer: NodeJS.Timeout | null = null;
    private readonly IDLE_THRESHOLD = 60000; // 1 minute

    constructor(statusUpdateCallback: (status: Partial<UserStatus>) => void) {
        this.statusUpdateCallback = statusUpdateCallback;
        this.initialize();
    }

    private initialize() {
        // Detect active editor changes
        vscode.window.onDidChangeActiveTextEditor(editor => {
            this.updateActivity(editor);
        });

        // Detect typing
        vscode.workspace.onDidChangeTextDocument(e => {
            this.resetIdleTimer();
            this.updateActivity(vscode.window.activeTextEditor, 'Coding');
        });

        // Detect debugging
        vscode.debug.onDidStartDebugSession(() => {
            this.statusUpdateCallback({ activity: 'Debugging', status: 'Do Not Disturb' });
        });

        vscode.debug.onDidTerminateDebugSession(() => {
            this.updateActivity(vscode.window.activeTextEditor);
        });

        // Initial check
        this.updateActivity(vscode.window.activeTextEditor);
    }

    private updateActivity(editor: vscode.TextEditor | undefined, activityOverride?: string) {
        const config = vscode.workspace.getConfiguration('vscode-social-presence');
        const shareProject = config.get<boolean>('shareProjectName', true);
        const shareLanguage = config.get<boolean>('shareLanguage', true);
        const shareActivity = config.get<boolean>('shareActivity', true);

        if (editor) {
            const project = shareProject ? (vscode.workspace.name || 'No Project') : 'Hidden';
            const language = shareLanguage ? editor.document.languageId : 'Hidden';
            const activity = shareActivity ? (activityOverride || 'Reading') : 'Hidden';

            this.statusUpdateCallback({
                project: project,
                language: language,
                activity: activity,
                status: 'Online'
            });
        } else {
            this.statusUpdateCallback({
                activity: shareActivity ? 'Idle' : 'Hidden',
                status: 'Online'
            });
        }
        this.resetIdleTimer();
    }

    private resetIdleTimer() {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
        }
        this.idleTimer = setTimeout(() => {
            this.statusUpdateCallback({
                activity: 'Idle',
                status: 'Away'
            });
        }, this.IDLE_THRESHOLD);
    }

    public dispose() {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
        }
    }
}
