import * as vscode from 'vscode';
import { UserStatus } from './wsClient';
import { GitHubUser } from './githubService';

// Guest avatar URL constant
export const GUEST_AVATAR_URL = 'https://avatars.githubusercontent.com/u/0?s=200&v=4';

/**
 * Create a guest profile object
 */
export function createGuestProfile(username: string): GitHubUser {
    return {
        id: 0,
        login: username,
        avatar_url: GUEST_AVATAR_URL,
        html_url: ''
    } as GitHubUser;
}

/**
 * Format last seen timestamp to human-readable string
 */
export function formatLastSeen(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;

    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
}

/**
 * Build user description string for tree items
 */
export function buildUserDescription(user: UserStatus): string {
    if (user.status === 'Offline') {
        return user.lastSeen ? `Last seen ${formatLastSeen(user.lastSeen)}` : 'Offline';
    }

    const parts: string[] = [];
    if (user.activity) parts.push(user.activity);
    if (user.project && user.project !== 'Hidden') parts.push(user.project);
    if (user.language && user.language !== 'Hidden') parts.push(`(${user.language})`);

    return parts.join(' • ');
}

/**
 * Build user tooltip markdown
 */
export function buildUserTooltip(user: UserStatus): vscode.MarkdownString {
    return new vscode.MarkdownString(
        `**${user.username}**\n\n` +
        `Status: ${user.status}\n` +
        `Activity: ${user.activity}\n` +
        (user.project && user.project !== 'Hidden' ? `Project: ${user.project}\n` : '') +
        (user.language && user.language !== 'Hidden' ? `Language: ${user.language}` : '')
    );
}

/**
 * Get theme icon for user status
 */
export function getUserStatusIcon(status: string): vscode.ThemeIcon {
    if (status === 'Online') {
        return new vscode.ThemeIcon('record', new vscode.ThemeColor('charts.green'));
    } else if (status === 'Away') {
        return new vscode.ThemeIcon('record', new vscode.ThemeColor('charts.yellow'));
    }
    return new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('charts.gray'));
}
