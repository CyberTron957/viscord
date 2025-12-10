# Viscord Monitoring Guide

## 📊 Available Monitoring Tools

### 1. **Database Monitor** (Historical Data)
Shows all-time statistics, user data, chat history, and connections.

```bash
cd server
node ../monitor_users.js
```

**What it shows:**
- Total users (GitHub vs Guest)
- Active users (last 24 hours)
- All registered users with join dates
- Manual connections (invite codes)
- Chat statistics and recent messages
- Active invite codes
- User preferences

---

### 2. **Real-Time Monitor** (Live Data)
Shows currently online users and their real-time status.

```bash
cd server
node ../monitor_realtime.js
```

**What it shows:**
- Currently online users
- Real-time coding status (coding/debugging/reading/idle)
- Current project and language
- Active sessions
- Rate-limited users/IPs

**Note:** Updates every 5 seconds. Press Ctrl+C to stop.

---

### 3. **Quick Database Inspection**
For quick queries:

```bash
cd server
node ../inspect_db.js
```

---

## 🔍 Manual Database Queries

### Connect to SQLite Database
```bash
cd server
sqlite3 database.sqlite
```

### Useful Queries

**Count users:**
```sql
SELECT COUNT(*) FROM users;
```

**See all users:**
```sql
SELECT username, github_id, datetime(created_at/1000, 'unixepoch') as joined 
FROM users 
ORDER BY created_at DESC;
```

**Chat activity:**
```sql
SELECT from_username, to_username, message, datetime(created_at/1000, 'unixepoch') 
FROM chat_messages 
ORDER BY created_at DESC 
LIMIT 20;
```

**Active invite codes:**
```sql
SELECT code, creator_username, uses_remaining, datetime(expires_at/1000, 'unixepoch') 
FROM invite_codes 
WHERE expires_at > strftime('%s', 'now') * 1000;
```

**Manual connections:**
```sql
SELECT user1, user2, datetime(created_at/1000, 'unixepoch') 
FROM manual_connections;
```

---

## 📈 Redis Monitoring

### Connect to Redis CLI
```bash
redis-cli
```

### Useful Commands

**See online users:**
```
SMEMBERS online_users
```

**Get user presence:**
```
GET presence:username
```

**Count active sessions:**
```
KEYS session:*
```

**See all keys:**
```
KEYS *
```

**Monitor real-time commands:**
```
MONITOR
```

---

## 🚨 Server Logs

### View Live Logs
```bash
cd server
node index.js
```

**What logs show:**
- User connections/disconnections
- Chat messages sent
- GitHub authentication
- Rate limiting events
- Errors and warnings

---

## 📊 Production Monitoring (Recommended)

For production, consider setting up:

1. **PM2** - Process manager with logs
   ```bash
   npm install -g pm2
   pm2 start server/index.js --name viscord
   pm2 logs viscord
   pm2 monit
   ```

2. **Redis Commander** - Web UI for Redis
   ```bash
   npm install -g redis-commander
   redis-commander
   # Open http://localhost:8081
   ```

3. **SQLite Browser** - GUI for database
   - Download: https://sqlitebrowser.org/
   - Open: `server/database.sqlite`

---

## 🔔 Alerts & Notifications

You can extend the monitoring scripts to send alerts:

- Email notifications for errors
- Slack/Discord webhooks for user milestones
- Prometheus metrics export
- Grafana dashboards

---

## 📝 Example Monitoring Workflow

```bash
# Terminal 1: Run server
cd server
node index.js

# Terminal 2: Real-time monitor
cd server
node ../monitor_realtime.js

# Terminal 3: Check stats periodically
cd server
node ../monitor_users.js
```

---

## 🛠️ Troubleshooting

**Database locked error:**
- Stop the server before running inspect scripts
- Or use `PRAGMA busy_timeout = 5000;` in SQLite

**Redis connection error:**
- Ensure Redis is running: `redis-cli ping`
- Start Redis: `redis-server` or `brew services start redis`

**No data showing:**
- Check if server is running
- Verify database file exists: `ls server/database.sqlite`
- Check Redis: `redis-cli KEYS *`
