#!/usr/bin/env node
const Redis = require('ioredis');

const redis = new Redis({
    host: 'localhost',
    port: 6379
});

// Color codes
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
    blue: '\x1b[34m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    red: '\x1b[31m'
};

console.log(`${colors.bright}${colors.cyan}==============================================`);
console.log(`  🔴 VISCORD REAL-TIME MONITOR`);
console.log(`==============================================${colors.reset}\n`);

async function monitor() {
    try {
        // Get all online users
        const onlineUsers = await redis.smembers('online_users');

        console.log(`${colors.green}📊 Online Users: ${onlineUsers.length}${colors.reset}\n`);

        if (onlineUsers.length > 0) {
            console.log(`${colors.bright}Currently Online:${colors.reset}`);

            for (const username of onlineUsers) {
                // Get user presence data
                const presenceData = await redis.get(`presence:${username}`);

                if (presenceData) {
                    const presence = JSON.parse(presenceData);
                    const statusEmoji = {
                        'coding': '💻',
                        'debugging': '🐛',
                        'reading': '📖',
                        'idle': '💤'
                    }[presence.status] || '❓';

                    console.log(`\n  ${statusEmoji} ${colors.yellow}${username}${colors.reset}`);
                    console.log(`     Status: ${presence.status}`);
                    if (presence.project) console.log(`     Project: ${presence.project}`);
                    if (presence.language) console.log(`     Language: ${presence.language}`);
                    if (presence.file) console.log(`     File: ${presence.file}`);

                    const lastUpdate = new Date(presence.lastUpdate);
                    console.log(`     Last Update: ${lastUpdate.toLocaleTimeString()}`);
                }
            }
        } else {
            console.log(`${colors.red}  No users currently online${colors.reset}`);
        }

        // Get session count
        const sessionKeys = await redis.keys('session:*');
        console.log(`\n${colors.blue}🔑 Active Sessions: ${sessionKeys.length}${colors.reset}`);

        // Get rate limit info
        const rateLimitKeys = await redis.keys('ratelimit:*');
        if (rateLimitKeys.length > 0) {
            console.log(`\n${colors.yellow}⚠️  Rate Limited IPs/Users: ${rateLimitKeys.length}${colors.reset}`);
        }

    } catch (error) {
        console.error(`${colors.red}Error:${colors.reset}`, error.message);
    }
}

// Run monitor every 5 seconds
console.log(`${colors.cyan}Monitoring... (Press Ctrl+C to stop)${colors.reset}\n`);

monitor();
setInterval(async () => {
    console.clear();
    console.log(`${colors.bright}${colors.cyan}==============================================`);
    console.log(`  🔴 VISCORD REAL-TIME MONITOR`);
    console.log(`  ${new Date().toLocaleString()}`);
    console.log(`==============================================${colors.reset}\n`);
    await monitor();
}, 5000);

// Graceful shutdown
process.on('SIGINT', () => {
    console.log(`\n\n${colors.yellow}Stopping monitor...${colors.reset}`);
    redis.disconnect();
    process.exit(0);
});
