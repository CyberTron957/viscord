import Database from 'better-sqlite3';
import path from 'path';

const dbPath = process.env.DB_PATH || path.join(__dirname, '../database.sqlite');
const db = new Database(dbPath);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    github_id INTEGER PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    avatar TEXT,
    created_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_relationships (
    user_github_id INTEGER NOT NULL,
    related_github_id INTEGER NOT NULL,
    relationship_type TEXT NOT NULL, -- 'follower' or 'following'
    PRIMARY KEY (user_github_id, related_github_id, relationship_type),
    FOREIGN KEY (user_github_id) REFERENCES users(github_id)
  );

  CREATE TABLE IF NOT EXISTS close_friends (
    user_github_id INTEGER NOT NULL,
    friend_github_id INTEGER NOT NULL,
    added_at INTEGER NOT NULL,
    PRIMARY KEY (user_github_id, friend_github_id),
    FOREIGN KEY (user_github_id) REFERENCES users(github_id)
  );

  CREATE TABLE IF NOT EXISTS user_preferences (
    github_id INTEGER PRIMARY KEY,
    visibility_mode TEXT DEFAULT 'everyone', -- 'everyone', 'followers', 'following', 'close-friends', 'invisible'
    share_project BOOLEAN DEFAULT 1,
    share_language BOOLEAN DEFAULT 1,
    share_activity BOOLEAN DEFAULT 1,
    FOREIGN KEY (github_id) REFERENCES users(github_id)
  );

  CREATE INDEX IF NOT EXISTS idx_user_relationships ON user_relationships(user_github_id, relationship_type);
  CREATE INDEX IF NOT EXISTS idx_close_friends ON close_friends(user_github_id);
`);

export interface UserRecord {
    github_id: number;
    username: string;
    avatar?: string;
    created_at: number;
    last_seen: number;
}

export interface UserPreferences {
    github_id: number;
    visibility_mode: 'everyone' | 'followers' | 'following' | 'close-friends' | 'invisible';
    share_project: boolean;
    share_language: boolean;
    share_activity: boolean;
}

export class DatabaseService {
    // User operations
    upsertUser(githubId: number, username: string, avatar?: string): void {
        const stmt = db.prepare(`
      INSERT INTO users (github_id, username, avatar, created_at, last_seen)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(github_id) DO UPDATE SET
        username = excluded.username,
        avatar = excluded.avatar,
        last_seen = excluded.last_seen
    `);
        const now = Date.now();
        stmt.run(githubId, username, avatar, now, now);
    }

    updateLastSeen(githubId: number): void {
        const stmt = db.prepare('UPDATE users SET last_seen = ? WHERE github_id = ?');
        stmt.run(Date.now(), githubId);
    }

    getUser(githubId: number): UserRecord | undefined {
        const stmt = db.prepare('SELECT * FROM users WHERE github_id = ?');
        return stmt.get(githubId) as UserRecord | undefined;
    }

    getUserByUsername(username: string): UserRecord | undefined {
        const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
        return stmt.get(username) as UserRecord | undefined;
    }

    // Relationships
    upsertRelationships(userGithubId: number, relationships: { id: number; type: 'follower' | 'following' }[]): void {
        const deleteStmt = db.prepare('DELETE FROM user_relationships WHERE user_github_id = ?');
        const insertStmt = db.prepare(`
      INSERT INTO user_relationships (user_github_id, related_github_id, relationship_type)
      VALUES (?, ?, ?)
      ON CONFLICT DO NOTHING
    `);

        const transaction = db.transaction(() => {
            deleteStmt.run(userGithubId);
            for (const rel of relationships) {
                insertStmt.run(userGithubId, rel.id, rel.type);
            }
        });

        transaction();
    }

    getFollowers(githubId: number): number[] {
        const stmt = db.prepare(`
      SELECT related_github_id FROM user_relationships
      WHERE user_github_id = ? AND relationship_type = 'follower'
    `);
        return stmt.all(githubId).map((row: any) => row.related_github_id);
    }

    getFollowing(githubId: number): number[] {
        const stmt = db.prepare(`
      SELECT related_github_id FROM user_relationships
      WHERE user_github_id = ? AND relationship_type = 'following'
    `);
        return stmt.all(githubId).map((row: any) => row.related_github_id);
    }

    // Close Friends
    addCloseFriend(userGithubId: number, friendGithubId: number): void {
        const stmt = db.prepare(`
      INSERT INTO close_friends (user_github_id, friend_github_id, added_at)
      VALUES (?, ?, ?)
      ON CONFLICT DO NOTHING
    `);
        stmt.run(userGithubId, friendGithubId, Date.now());
    }

    removeCloseFriend(userGithubId: number, friendGithubId: number): void {
        const stmt = db.prepare('DELETE FROM close_friends WHERE user_github_id = ? AND friend_github_id = ?');
        stmt.run(userGithubId, friendGithubId);
    }

    getCloseFriends(githubId: number): number[] {
        const stmt = db.prepare('SELECT friend_github_id FROM close_friends WHERE user_github_id = ?');
        return stmt.all(githubId).map((row: any) => row.friend_github_id);
    }

    // User Preferences
    getUserPreferences(githubId: number): UserPreferences {
        const stmt = db.prepare('SELECT * FROM user_preferences WHERE github_id = ?');
        let prefs = stmt.get(githubId) as UserPreferences | undefined;

        if (!prefs) {
            // Create default preferences
            const insertStmt = db.prepare(`
        INSERT INTO user_preferences (github_id, visibility_mode, share_project, share_language, share_activity)
        VALUES (?, 'everyone', 1, 1, 1)
      `);
            insertStmt.run(githubId);
            prefs = {
                github_id: githubId,
                visibility_mode: 'everyone',
                share_project: true,
                share_language: true,
                share_activity: true
            };
        }

        return prefs;
    }

    updateUserPreferences(githubId: number, preferences: Partial<UserPreferences>): void {
        const fields: string[] = [];
        const values: any[] = [];

        if (preferences.visibility_mode !== undefined) {
            fields.push('visibility_mode = ?');
            values.push(preferences.visibility_mode);
        }
        if (preferences.share_project !== undefined) {
            fields.push('share_project = ?');
            values.push(preferences.share_project ? 1 : 0);
        }
        if (preferences.share_language !== undefined) {
            fields.push('share_language = ?');
            values.push(preferences.share_language ? 1 : 0);
        }
        if (preferences.share_activity !== undefined) {
            fields.push('share_activity = ?');
            values.push(preferences.share_activity ? 1 : 0);
        }

        if (fields.length > 0) {
            values.push(githubId);
            const stmt = db.prepare(`UPDATE user_preferences SET ${fields.join(', ')} WHERE github_id = ?`);
            stmt.run(...values);
        }
    }

    // Cleanup old offline users (optional - run periodically)
    cleanupOldUsers(olderThanDays: number = 30): void {
        const cutoff = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
        const stmt = db.prepare('DELETE FROM users WHERE last_seen < ?');
        const result = stmt.run(cutoff);
        console.log(`Cleaned up ${result.changes} old users`);
    }

    close(): void {
        db.close();
    }
}

export const dbService = new DatabaseService();
