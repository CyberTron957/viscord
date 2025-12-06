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
    private currentActivity: string = 'Idle'; // Track current activity state
    private isWindowFocused: boolean = true; // Track if this VS Code window is focused
    private focusLostTimer: NodeJS.Timeout | null = null; // Delay before sending Idle on blur
    private readonly FOCUS_LOST_DELAY = 5000; // 5 seconds before marking as Idle on blur

    constructor(statusUpdateCallback: (status: Partial<UserStatus>) => void) {
        this.statusUpdateCallback = statusUpdateCallback;
        this.initialize();
    }

    private initialize() {
        // Track window focus state
        this.isWindowFocused = vscode.window.state.focused;

        // Detect window focus changes
        vscode.window.onDidChangeWindowState((state) => {
            const wasFocused = this.isWindowFocused;
            this.isWindowFocused = state.focused;

            console.log(`Window focus changed: ${wasFocused} -> ${this.isWindowFocused}`);

            if (this.isWindowFocused && !wasFocused) {
                // Window just gained focus - cancel any pending Idle and restore status
                if (this.focusLostTimer) {
                    clearTimeout(this.focusLostTimer);
                    this.focusLostTimer = null;
                    console.log('Window regained focus - cancelled Idle timer');
                }
                // Immediately update with current state
                console.log('Window gained focus - sending current status');
                this.updateActivity(this.currentActivity, true); // Force immediate update
            } else if (!this.isWindowFocused && wasFocused) {
                // Window just lost focus - delay before sending Idle
                // This prevents status flapping when quickly switching windows
                console.log('Window lost focus - starting Idle timer');

                if (this.focusLostTimer) {
                    clearTimeout(this.focusLostTimer);
                }

                this.focusLostTimer = setTimeout(() => {
                    this.focusLostTimer = null;
                    // Only send Idle if still unfocused
                    if (!this.isWindowFocused) {
                        console.log('Idle timer expired - sending Idle status');
                        this.currentActivity = 'Idle';
                        // Don't clear project/language - let the server aggregate 
                        // from other windows. Just report this window as Idle.
                        this.statusUpdateCallback({
                            activity: 'Idle',
                            status: 'Away'
                            // Keep project/language so server can still use them
                            // if this is the user's only active window
                        });
                    }
                }, this.FOCUS_LOST_DELAY);
            }
        });

        // Detect active editor changes
        vscode.window.onDidChangeActiveTextEditor(() => {
            if (this.isWindowFocused) {
                this.updateActivity();
            }
        });

        // Detect typing - immediately set to Coding
        vscode.workspace.onDidChangeTextDocument((e) => {
            // Ignore changes from files that are not user-editable
            if (e.document.uri.scheme === 'file' && this.isWindowFocused) {
                this.currentActivity = 'Coding';
                this.resetIdleTimer();
                this.updateActivity('Coding');
            }
        });

        // Detect debugging
        vscode.debug.onDidStartDebugSession(() => {
            if (this.isWindowFocused) {
                this.currentActivity = 'Debugging';
                // Force an immediate full status update
                this.updateActivity('Debugging', true);
            }
        });

        vscode.debug.onDidTerminateDebugSession(() => {
            if (this.isWindowFocused) {
                this.currentActivity = 'Reading';
                this.updateActivity();
            }
        });

        // Initial check
        if (this.isWindowFocused) {
            this.updateActivity();
        } else {
            // If starting unfocused, send Idle but don't clear project/language
            // Another window might be active with valid data
            this.statusUpdateCallback({
                activity: 'Idle',
                status: 'Away'
            });
        }
    }

    private updateActivityInternal(activityOverride?: string) {
        // If window is not focused, don't send updates (already sent Idle on blur)
        if (!this.isWindowFocused) {
            return;
        }

        const config = vscode.workspace.getConfiguration('vscode-viscord');
        const shareProject = config.get<boolean>('shareProjectName', true);
        const shareLanguage = config.get<boolean>('shareLanguage', true);
        const shareActivity = config.get<boolean>('shareActivity', true);

        const editor = vscode.window.activeTextEditor;

        let newStatus: Partial<UserStatus> = {};

        if (editor) {
            const project = shareProject ? (vscode.workspace.name || 'No Project') : 'Hidden';
            const language = shareLanguage ? editor.document.languageId : 'Hidden';

            // Use override if provided, otherwise use current activity state
            let activity = activityOverride || this.currentActivity;

            // If no override and no explicit activity, default to Reading
            if (!activityOverride && this.currentActivity === 'Idle') {
                activity = 'Reading';
            }

            const finalActivity = shareActivity ? activity : 'Hidden';

            newStatus = {
                project: project,
                language: language,
                activity: finalActivity,
                status: 'Online'
            };
        } else {
            newStatus = {
                activity: shareActivity ? 'Idle' : 'Hidden',
                status: 'Online',
                project: '',
                language: ''
            };
            this.currentActivity = 'Idle';
        }

        // Only send if something actually changed
        const statusChanged = JSON.stringify(newStatus) !== JSON.stringify(this.lastSentStatus);

        if (statusChanged) {
            console.log('Status changed, sending update:', newStatus);
            this.lastSentStatus = newStatus;
            this.statusUpdateCallback(newStatus);
        }

        this.resetIdleTimer();
    }

    private updateActivity(activityOverride?: string, forceImmediate: boolean = false) {
        const now = Date.now();

        // For high-priority status changes (Coding, Debugging) or forced updates, send immediately
        const isHighPriority = activityOverride === 'Coding' || activityOverride === 'Debugging' || forceImmediate;

        // Throttle: Only allow updates every 5 seconds (except for high priority)
        if (!isHighPriority && now - this.lastUpdateTime < this.updateThrottleMs) {
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

        // Only set idle timer if window is focused
        if (this.isWindowFocused) {
            this.idleTimer = setTimeout(() => {
                this.currentActivity = 'Idle';
                this.statusUpdateCallback({
                    activity: 'Idle',
                    status: 'Away'
                });
            }, this.idleTimeout);
        }
    }

    public dispose() {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
        }
        if (this.pendingUpdate) {
            clearTimeout(this.pendingUpdate);
        }
        if (this.focusLostTimer) {
            clearTimeout(this.focusLostTimer);
        }
    }
}
