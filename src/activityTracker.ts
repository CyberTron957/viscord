import * as vscode from 'vscode';
import { UserStatus } from './wsClient';

export class ActivityTracker {
    private statusUpdateCallback: (status: Partial<UserStatus>) => void;
    private idleTimer: NodeJS.Timeout | null = null;
    private idleTimeout = 60000; // 1 minute
    private lastUpdateTime = 0;
    private updateThrottleMs = 5000; // 5 seconds - only send updates max once per 5 seconds
    private lastSentStatus: Partial<UserStatus> = {};
    private pendingUpdate: NodeJS.Timeout | null = null;

    constructor(statusUpdateCallback: (status: Partial<UserStatus>) => void) {
        this.statusUpdateCallback = statusUpdateCallback;
        this.initialize();
    }

    private initialize() {
        // Detect active editor changes
        vscode.window.onDidChangeActiveTextEditor(() => {
            this.updateActivity();
        });

        // Detect typing
        vscode.workspace.onDidChangeTextDocument(() => {
            this.resetIdleTimer();
            this.updateActivity('Coding');
        });

        // Detect debugging
        vscode.debug.onDidStartDebugSession(() => {
            this.statusUpdateCallback({ activity: 'Debugging', status: 'Do Not Disturb' });
        });

        vscode.debug.onDidTerminateDebugSession(() => {
            this.updateActivity();
        });

        // Initial check
        this.updateActivity();
    }

    private updateActivityInternal(activityOverride?: string) {
        const config = vscode.workspace.getConfiguration('vscode-social-presence');
        const shareProject = config.get<boolean>('shareProjectName', true);
        const shareLanguage = config.get<boolean>('shareLanguage', true);
        const shareActivity = config.get<boolean>('shareActivity', true);

        const editor = vscode.window.activeTextEditor;

        let newStatus: Partial<UserStatus> = {};

        if (editor) {
            const project = shareProject ? (vscode.workspace.name || 'No Project') : 'Hidden';
            const language = shareLanguage ? editor.document.languageId : 'Hidden';
            const activity = shareActivity ? (activityOverride || 'Reading') : 'Hidden';

            newStatus = {
                project: project,
                language: language,
                activity: activity,
                status: 'Online'
            };
        } else {
            newStatus = {
                activity: shareActivity ? 'Idle' : 'Hidden',
                status: 'Online'
            };
        }

        // Only send if something actually changed
        const statusChanged = JSON.stringify(newStatus) !== JSON.stringify(this.lastSentStatus);

        if (statusChanged) {
            this.lastSentStatus = newStatus;
            this.statusUpdateCallback(newStatus);
        }

        this.resetIdleTimer();
    }

    private updateActivity(activityOverride?: string) {
        const now = Date.now();

        // Throttle: Only allow updates every 5 seconds
        if (now - this.lastUpdateTime < this.updateThrottleMs) {
            // Schedule a delayed update if one isn't already pending
            if (!this.pendingUpdate) {
                this.pendingUpdate = setTimeout(() => {
                    this.pendingUpdate = null;
                    this.updateActivity(activityOverride);
                }, this.updateThrottleMs - (now - this.lastUpdateTime));
            }
            return;
        }

        this.lastUpdateTime = now;
        this.updateActivityInternal(activityOverride);
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
        }, this.idleTimeout);
    }

    public dispose() {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
        }
    }
}
