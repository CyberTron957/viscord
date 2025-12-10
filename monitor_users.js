#!/usr/bin/env node
const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, 'server', 'database.sqlite');
const db = new Database(dbPath);

// Color codes for terminal
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
    blue: '\x1b[34m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m'
};

function header(text) {
    console.log(`\n${colors.bright}${colors.cyan}${'='.repeat(60)}${colors.reset}`);
    console.log(`${colors.bright}${colors.cyan}  ${text}${colors.reset}`);
    console.log(`${colors.bright}${colors.cyan}${'='.repeat(60)}${colors.reset}\n`);
}

function section(text) {
    console.log(`\n${colors.bright}${colors.blue}${text}${colors.reset}`);
    console.log(`${colors.blue}${'-'.repeat(text.length)}${colors.reset}`);
}

// 1. User Statistics
header('📊 VISCORD USER STATISTICS');

const stats = db.prepare(`
    SELECT 
        COUNT(*) as total_users,
        SUM(CASE WHEN github_id IS NOT NULL THEN 1 ELSE 0 END) as github_users,
        SUM(CASE WHEN github_id IS NULL THEN 1 ELSE 0 END) as guest_users
    FROM users
`).get();

console.log(`${colors.green}Total Users:${colors.reset} ${stats.total_users}`);
console.log(`${colors.green}GitHub Users:${colors.reset} ${stats.github_users}`);
console.log(`${colors.green}Guest Users:${colors.reset} ${stats.guest_users}`);

// 2. Active Users (last 24 hours)
section('👥 Active Users (Last 24 Hours)');

const activeUsers = db.prepare(`
    SELECT username, last_seen, 
           datetime(last_seen/1000, 'unixepoch') as last_seen_readable
    FROM users 
    WHERE last_seen > ?
    ORDER BY last_seen DESC
`).all(Date.now() - 24 * 60 * 60 * 1000);

if (activeUsers.length > 0) {
    activeUsers.forEach(user => {
        console.log(`  ${colors.yellow}${user.username}${colors.reset} - ${user.last_seen_readable}`);
    });
} else {
    console.log('  No active users in the last 24 hours');
}

// 3. All Users
section('📋 All Users');

const allUsers = db.prepare(`
    SELECT 
        username, 
        github_id,
        avatar_url,
        datetime(created_at/1000, 'unixepoch') as joined_date,
        datetime(last_seen/1000, 'unixepoch') as last_seen_date
    FROM users 
    ORDER BY created_at DESC
`).all();

allUsers.forEach(user => {
    const type = user.github_id ? `GitHub (${user.github_id})` : 'Guest';
    console.log(`\n  ${colors.bright}${user.username}${colors.reset}`);
    console.log(`    Type: ${type}`);
    console.log(`    Joined: ${user.joined_date}`);
    console.log(`    Last Seen: ${user.last_seen_date || 'Never'}`);
});

// 4. Manual Connections
section('🔗 Manual Connections (Invite Codes)');

const connections = db.prepare(`
    SELECT user1, user2, 
           datetime(created_at/1000, 'unixepoch') as connected_date
    FROM manual_connections
    ORDER BY created_at DESC
`).all();

if (connections.length > 0) {
    connections.forEach(conn => {
        console.log(`  ${colors.magenta}${conn.user1}${colors.reset} ↔ ${colors.magenta}${conn.user2}${colors.reset} (${conn.connected_date})`);
    });
} else {
    console.log('  No manual connections');
}

// 5. Chat Statistics
section('💬 Chat Statistics');

const chatStats = db.prepare(`
    SELECT 
        COUNT(*) as total_messages,
        COUNT(DISTINCT from_username) as unique_senders,
        COUNT(DISTINCT to_username) as unique_recipients,
        SUM(CASE WHEN read_at IS NULL THEN 1 ELSE 0 END) as unread_messages
    FROM chat_messages
`).get();

console.log(`${colors.green}Total Messages:${colors.reset} ${chatStats.total_messages}`);
console.log(`${colors.green}Unique Senders:${colors.reset} ${chatStats.unique_senders}`);
console.log(`${colors.green}Unique Recipients:${colors.reset} ${chatStats.unique_recipients}`);
console.log(`${colors.green}Unread Messages:${colors.reset} ${chatStats.unread_messages}`);

// 6. Recent Chat Activity
section('💬 Recent Chat Activity (Last 10 Messages)');

const recentChats = db.prepare(`
    SELECT 
        from_username, 
        to_username, 
        message,
        datetime(created_at/1000, 'unixepoch') as sent_at,
        CASE WHEN read_at IS NULL THEN 'Unread' ELSE 'Read' END as status
    FROM chat_messages
    ORDER BY created_at DESC
    LIMIT 10
`).all();

if (recentChats.length > 0) {
    recentChats.forEach(chat => {
        const preview = chat.message.length > 50 ? chat.message.substring(0, 50) + '...' : chat.message;
        console.log(`\n  ${colors.yellow}${chat.from_username}${colors.reset} → ${colors.yellow}${chat.to_username}${colors.reset}`);
        console.log(`    "${preview}"`);
        console.log(`    ${chat.sent_at} [${chat.status}]`);
    });
} else {
    console.log('  No chat messages yet');
}

// 7. Invite Codes
section('🎫 Active Invite Codes');

const invites = db.prepare(`
    SELECT 
        code, 
        creator_username,
        uses_remaining,
        datetime(created_at/1000, 'unixepoch') as created_date,
        datetime(expires_at/1000, 'unixepoch') as expires_date
    FROM invite_codes
    WHERE expires_at > ? AND (uses_remaining > 0 OR uses_remaining = -1)
    ORDER BY created_at DESC
`).all(Date.now());

if (invites.length > 0) {
    invites.forEach(invite => {
        const uses = invite.uses_remaining === -1 ? 'Unlimited' : invite.uses_remaining;
        console.log(`\n  ${colors.bright}${invite.code}${colors.reset}`);
        console.log(`    Creator: ${invite.creator_username}`);
        console.log(`    Uses Remaining: ${uses}`);
        console.log(`    Expires: ${invite.expires_date}`);
    });
} else {
    console.log('  No active invite codes');
}

// 8. User Preferences
section('⚙️  User Preferences');

const prefs = db.prepare(`
    SELECT 
        u.username,
        p.visibility_mode,
        p.share_project_name,
        p.share_language
    FROM user_preferences p
    JOIN users u ON p.user_id = u.id
`).all();

if (prefs.length > 0) {
    prefs.forEach(pref => {
        console.log(`\n  ${colors.bright}${pref.username}${colors.reset}`);
        console.log(`    Visibility: ${pref.visibility_mode}`);
        console.log(`    Share Project: ${pref.share_project_name ? 'Yes' : 'No'}`);
        console.log(`    Share Language: ${pref.share_language ? 'Yes' : 'No'}`);
    });
} else {
    console.log('  No preferences set');
}

console.log('\n');
db.close();
