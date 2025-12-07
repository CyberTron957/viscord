"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dbService = exports.DatabaseService = void 0;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const dbPath = process.env.DB_PATH || path_1.default.join(__dirname, '../database.sqlite');
const backupDir = process.env.BACKUP_DIR || path_1.default.join(__dirname, '../backups');
const db = new better_sqlite3_1.default(dbPath);
// Ensure backup directory exists
if (!fs_1.default.existsSync(backupDir)) {
    fs_1.default.mkdirSync(backupDir, { recursive: true });
}
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

  CREATE TABLE IF NOT EXISTS invite_codes (
    code TEXT PRIMARY KEY,
    creator_username TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_by TEXT,
    used_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS manual_connections (
    user1_username TEXT NOT NULL,
    user2_username TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user1_username, user2_username)
  );

  CREATE TABLE IF NOT EXISTS username_aliases (
    github_username TEXT PRIMARY KEY,
    guest_username TEXT NOT NULL,
    github_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(guest_username)
  );

  CREATE INDEX IF NOT EXISTS idx_user_relationships ON user_relationships(user_github_id, relationship_type);
  CREATE INDEX IF NOT EXISTS idx_close_friends ON close_friends(user_github_id);
  CREATE INDEX IF NOT EXISTS idx_invite_codes_creator ON invite_codes(creator_username);
  CREATE INDEX IF NOT EXISTS idx_manual_connections ON manual_connections(user1_username);
  CREATE INDEX IF NOT EXISTS idx_username_aliases_guest ON username_aliases(guest_username);

  -- Chat messages for 1-on-1 DMs
  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_username TEXT NOT NULL,
    to_username TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    read_at INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages(from_username, to_username, created_at);
  CREATE INDEX IF NOT EXISTS idx_chat_messages_unread ON chat_messages(to_username, read_at);
`);
class DatabaseService {
    // User operations
    upsertUser(githubId, username, avatar) {
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
    updateLastSeen(githubId) {
        const stmt = db.prepare('UPDATE users SET last_seen = ? WHERE github_id = ?');
        stmt.run(Date.now(), githubId);
    }
    getUser(githubId) {
        const stmt = db.prepare('SELECT * FROM users WHERE github_id = ?');
        return stmt.get(githubId);
    }
    getAllUsers() {
        const stmt = db.prepare('SELECT * FROM users ORDER BY last_seen DESC');
        return stmt.all();
    }
    getUserByUsername(username) {
        const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
        return stmt.get(username);
    }
    // Relationships
    upsertRelationships(userGithubId, relationships) {
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
    getFollowers(githubId) {
        const stmt = db.prepare(`
      SELECT related_github_id FROM user_relationships
      WHERE user_github_id = ? AND relationship_type = 'follower'
    `);
        return stmt.all(githubId).map((row) => row.related_github_id);
    }
    getFollowing(githubId) {
        const stmt = db.prepare(`
      SELECT related_github_id FROM user_relationships
      WHERE user_github_id = ? AND relationship_type = 'following'
    `);
        return stmt.all(githubId).map((row) => row.related_github_id);
    }
    // Close Friends
    addCloseFriend(userGithubId, friendGithubId) {
        const stmt = db.prepare(`
      INSERT INTO close_friends (user_github_id, friend_github_id, added_at)
      VALUES (?, ?, ?)
      ON CONFLICT DO NOTHING
    `);
        stmt.run(userGithubId, friendGithubId, Date.now());
    }
    removeCloseFriend(userGithubId, friendGithubId) {
        const stmt = db.prepare('DELETE FROM close_friends WHERE user_github_id = ? AND friend_github_id = ?');
        stmt.run(userGithubId, friendGithubId);
    }
    getCloseFriends(githubId) {
        const stmt = db.prepare('SELECT friend_github_id FROM close_friends WHERE user_github_id = ?');
        return stmt.all(githubId).map((row) => row.friend_github_id);
    }
    // User Preferences
    getUserPreferences(githubId) {
        const stmt = db.prepare('SELECT * FROM user_preferences WHERE github_id = ?');
        let prefs = stmt.get(githubId);
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
    updateUserPreferences(githubId, preferences) {
        const fields = [];
        const values = [];
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
    cleanupOldUsers(olderThanDays = 30) {
        const cutoff = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
        const stmt = db.prepare('DELETE FROM users WHERE last_seen < ?');
        const result = stmt.run(cutoff);
        console.log(`Cleaned up ${result.changes} old users`);
    }
    // Invite Codes
    createInviteCode(creatorUsername, expiresInHours = 48) {
        // Generate unique code (6 chars: letters + numbers)
        const code = Math.random().toString(36).substring(2, 8).toUpperCase();
        const now = Date.now();
        const expiresAt = now + (expiresInHours * 60 * 60 * 1000);
        const stmt = db.prepare(`
      INSERT INTO invite_codes (code, creator_username, created_at, expires_at)
      VALUES (?, ?, ?, ?)
    `);
        stmt.run(code, creatorUsername, now, expiresAt);
        return code;
    }
    getInviteCode(code) {
        const stmt = db.prepare('SELECT * FROM invite_codes WHERE code = ?');
        return stmt.get(code);
    }
    acceptInviteCode(code, acceptorUsername) {
        const invite = this.getInviteCode(code);
        if (!invite) {
            return false; // Code doesn't exist
        }
        if (invite.used_by) {
            return false; // Already used
        }
        if (Date.now() > invite.expires_at) {
            return false; // Expired
        }
        if (invite.creator_username === acceptorUsername) {
            return false; // Can't accept your own invite
        }
        // Mark invite as used
        const updateStmt = db.prepare('UPDATE invite_codes SET used_by = ?, used_at = ? WHERE code = ?');
        updateStmt.run(acceptorUsername, Date.now(), code);
        // Create bidirectional connection
        this.addManualConnection(invite.creator_username, acceptorUsername);
        return true;
    }
    // Manual Connections (non-GitHub friends)
    addManualConnection(user1, user2) {
        const stmt = db.prepare(`
      INSERT INTO manual_connections (user1_username, user2_username, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT DO NOTHING
    `);
        const now = Date.now();
        // Add both directions
        stmt.run(user1, user2, now);
        stmt.run(user2, user1, now);
    }
    removeManualConnection(user1, user2) {
        const stmt = db.prepare('DELETE FROM manual_connections WHERE user1_username = ? AND user2_username = ?');
        // Remove both directions
        stmt.run(user1, user2);
        stmt.run(user2, user1);
    }
    getManualConnections(username) {
        const stmt = db.prepare('SELECT user2_username FROM manual_connections WHERE user1_username = ?');
        return stmt.all(username).map((row) => row.user2_username);
    }
    isManuallyConnected(user1, user2) {
        const stmt = db.prepare('SELECT 1 FROM manual_connections WHERE user1_username = ? AND user2_username = ?');
        return !!stmt.get(user1, user2);
    }
    // Username Aliases (Guest -> GitHub mapping)
    createAlias(githubUsername, guestUsername, githubId) {
        const stmt = db.prepare(`
            INSERT INTO username_aliases (github_username, guest_username, github_id, created_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(github_username) DO UPDATE SET
                guest_username = excluded.guest_username,
                github_id = excluded.github_id
        `);
        stmt.run(githubUsername, guestUsername, githubId, Date.now());
    }
    getGitHubUsername(guestUsername) {
        const stmt = db.prepare('SELECT github_username FROM username_aliases WHERE guest_username = ?');
        const result = stmt.get(guestUsername);
        return (result === null || result === void 0 ? void 0 : result.github_username) || null;
    }
    getGuestUsername(githubUsername) {
        const stmt = db.prepare('SELECT guest_username FROM username_aliases WHERE github_username = ?');
        const result = stmt.get(githubUsername);
        return (result === null || result === void 0 ? void 0 : result.guest_username) || null;
    }
    // Resolve username - returns GitHub username if alias exists, otherwise returns input
    resolveUsername(username) {
        // First check if this is a guest username with an alias
        const githubUsername = this.getGitHubUsername(username);
        if (githubUsername) {
            return githubUsername;
        }
        return username;
    }
    // --- Chat Messages ---
    // Save a new chat message
    saveMessage(fromUsername, toUsername, message) {
        const stmt = db.prepare(`
            INSERT INTO chat_messages (from_username, to_username, message, created_at)
            VALUES (?, ?, ?, ?)
        `);
        const now = Date.now();
        const result = stmt.run(fromUsername, toUsername, message, now);
        return {
            id: result.lastInsertRowid,
            from_username: fromUsername,
            to_username: toUsername,
            message,
            created_at: now,
            read_at: null
        };
    }
    // Get conversation history between two users (last N messages)
    getConversationHistory(user1, user2, limit = 50) {
        const stmt = db.prepare(`
            SELECT * FROM chat_messages
            WHERE (from_username = ? AND to_username = ?)
               OR (from_username = ? AND to_username = ?)
            ORDER BY created_at DESC
            LIMIT ?
        `);
        const messages = stmt.all(user1, user2, user2, user1, limit);
        // Return in chronological order
        return messages.reverse();
    }
    // Get unread message count from a specific user
    getUnreadCount(fromUsername, toUsername) {
        const stmt = db.prepare(`
            SELECT COUNT(*) as count FROM chat_messages
            WHERE from_username = ? AND to_username = ? AND read_at IS NULL
        `);
        const result = stmt.get(fromUsername, toUsername);
        return result.count;
    }
    // Get all unread counts for a user (sender -> count)
    getUnreadCounts(username) {
        const stmt = db.prepare(`
            SELECT from_username, COUNT(*) as count FROM chat_messages
            WHERE to_username = ? AND read_at IS NULL
            GROUP BY from_username
        `);
        const results = stmt.all(username);
        const counts = new Map();
        for (const row of results) {
            counts.set(row.from_username, row.count);
        }
        return counts;
    }
    // Mark messages as read
    markMessagesAsRead(fromUsername, toUsername) {
        const stmt = db.prepare(`
            UPDATE chat_messages
            SET read_at = ?
            WHERE from_username = ? AND to_username = ? AND read_at IS NULL
        `);
        stmt.run(Date.now(), fromUsername, toUsername);
    }
    // --- Backup System ---
    // Create a backup of the database
    backup() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path_1.default.join(backupDir, `database-${timestamp}.sqlite`);
        try {
            // Use better-sqlite3's backup API for safe backup
            db.backup(backupPath);
            console.log(`Database backed up to: ${backupPath}`);
            // Clean up old backups (keep last 5)
            this.cleanupOldBackups(5);
            return backupPath;
        }
        catch (error) {
            console.error('Backup failed:', error);
            throw error;
        }
    }
    // Clean up old backups, keeping the most recent N
    cleanupOldBackups(keepCount) {
        try {
            const files = fs_1.default.readdirSync(backupDir)
                .filter(f => f.startsWith('database-') && f.endsWith('.sqlite'))
                .map(f => ({
                name: f,
                path: path_1.default.join(backupDir, f),
                mtime: fs_1.default.statSync(path_1.default.join(backupDir, f)).mtime
            }))
                .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
            // Remove files beyond keepCount
            for (let i = keepCount; i < files.length; i++) {
                fs_1.default.unlinkSync(files[i].path);
                console.log(`Removed old backup: ${files[i].name}`);
            }
        }
        catch (error) {
            console.error('Backup cleanup failed:', error);
        }
    }
    // Restore from a backup (returns true if successful)
    restore(backupPath) {
        try {
            if (!fs_1.default.existsSync(backupPath)) {
                console.error(`Backup file not found: ${backupPath}`);
                return false;
            }
            // Close current connection
            db.close();
            // Copy backup over current database
            fs_1.default.copyFileSync(backupPath, dbPath);
            console.log(`Database restored from: ${backupPath}`);
            return true;
        }
        catch (error) {
            console.error('Restore failed:', error);
            return false;
        }
    }
    // List available backups
    listBackups() {
        try {
            return fs_1.default.readdirSync(backupDir)
                .filter(f => f.startsWith('database-') && f.endsWith('.sqlite'))
                .map(f => ({
                name: f,
                path: path_1.default.join(backupDir, f),
                date: fs_1.default.statSync(path_1.default.join(backupDir, f)).mtime
            }))
                .sort((a, b) => b.date.getTime() - a.date.getTime());
        }
        catch (error) {
            console.error('Failed to list backups:', error);
            return [];
        }
    }
    close() {
        db.close();
    }
}
exports.DatabaseService = DatabaseService;
exports.dbService = new DatabaseService();
// --- Auto-Backup System ---
// Backup every 6 hours in production
const BACKUP_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours
if (process.env.NODE_ENV === 'production') {
    // Initial backup on startup
    setTimeout(() => {
        try {
            exports.dbService.backup();
            console.log('Startup backup complete');
        }
        catch (error) {
            console.error('Startup backup failed:', error);
        }
    }, 5000); // Wait 5 seconds after startup
    // Schedule periodic backups
    setInterval(() => {
        try {
            exports.dbService.backup();
            console.log('Scheduled backup complete');
        }
        catch (error) {
            console.error('Scheduled backup failed:', error);
        }
    }, BACKUP_INTERVAL);
}
