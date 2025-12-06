import * as vscode from 'vscode';
import { Octokit } from '@octokit/rest';

export interface GitHubUser {
    id: number;
    login: string;
    avatar_url: string;
    html_url?: string;
    name?: string;
}

export class GitHubService {
    private session: vscode.AuthenticationSession | undefined;
    private octokit: Octokit | undefined;
    private cache: {
        followers?: GitHubUser[];
        following?: GitHubUser[];
        lastSync?: number;
    } = {};
    private readonly CACHE_TTL = 1000 * 60 * 15; // 15 minutes

    async authenticate(): Promise<vscode.AuthenticationSession> {
        this.session = await vscode.authentication.getSession('github', ['user:email', 'read:user'], { createIfNone: true });

        // Initialize Octokit with the token
        this.octokit = new Octokit({
            auth: this.session.accessToken
        });

        return this.session;
    }

    async getProfile(): Promise<GitHubUser> {
        if (!this.octokit) {
            throw new Error('Not authenticated');
        }

        const { data } = await this.octokit.users.getAuthenticated();

        return {
            id: data.id,
            login: data.login,
            avatar_url: data.avatar_url,
            name: data.name || undefined
        };
    }

    /**
     * Fetch paginated GitHub users (followers or following)
     */
    private async fetchPaginatedUsers(
        type: 'followers' | 'following'
    ): Promise<GitHubUser[]> {
        // Check cache
        if (this.cache[type] && this.cache.lastSync &&
            Date.now() - this.cache.lastSync < this.CACHE_TTL) {
            return this.cache[type]!;
        }

        if (!this.octokit) {
            throw new Error('Not authenticated');
        }

        const users: GitHubUser[] = [];
        let page = 1;
        const perPage = 100;

        while (true) {
            const { data } = type === 'followers'
                ? await this.octokit.users.listFollowersForAuthenticatedUser({ per_page: perPage, page })
                : await this.octokit.users.listFollowedByAuthenticatedUser({ per_page: perPage, page });

            if (data.length === 0) break;

            users.push(...data.map(user => ({
                id: user.id,
                login: user.login,
                avatar_url: user.avatar_url,
                name: user.name || undefined
            })));

            if (data.length < perPage) break;
            page++;
        }

        this.cache[type] = users;
        this.cache.lastSync = Date.now();
        return users;
    }

    async getFollowers(): Promise<GitHubUser[]> {
        return this.fetchPaginatedUsers('followers');
    }

    async getFollowing(): Promise<GitHubUser[]> {
        return this.fetchPaginatedUsers('following');
    }

    getToken(): string | undefined {
        return this.session?.accessToken;
    }

    async signOut(): Promise<void> {
        this.session = undefined;
        this.octokit = undefined;
        this.cache = {};
    }
}
