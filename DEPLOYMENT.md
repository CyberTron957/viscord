# Production Deployment Guide

This guide explains how to deploy the VS Code Social Presence server securely using Caddy as a reverse proxy.

## Prerequisites

- A Linux server (Ubuntu 20.04/22.04 recommended)
- Node.js 18+ installed
- A domain name pointing to your server IP
- Root or sudo access

## 1. Server Setup

### Install Dependencies
```bash
# Install Node.js (if not already installed)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 (Process Manager)
sudo npm install -g pm2
```

### Setup Application
```bash
# Clone repository (or upload files)
git clone <your-repo-url> /var/www/social-presence
cd /var/www/social-presence

# Install dependencies
npm ci --production

# Create database directory
mkdir -p data
```

### Configure Environment
Create a `.env` file:
```bash
PORT=8080
NODE_ENV=production
DB_PATH=./data/database.sqlite
# Optional: Add any other required env vars
```

## 2. Secure Reverse Proxy with Caddy

We use Caddy because it automatically manages SSL certificates (HTTPS/WSS) and is easy to configure.

### Install Caddy
```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy
```

### Configure Caddy
1. Copy the `Caddyfile` to `/etc/caddy/Caddyfile`:
   ```bash
   sudo cp Caddyfile /etc/caddy/Caddyfile
   ```

2. Edit the file to set your domain and email:
   ```bash
   sudo nano /etc/caddy/Caddyfile
   ```
   *Replace `yourdomain.com` and `your-email@example.com`.*

3. Reload Caddy:
   ```bash
   sudo systemctl reload caddy
   ```

## 3. Start the Application

Use PM2 with the ecosystem file for best practices:

```bash
# Recommended: Start using ecosystem file (sets NODE_ENV=production automatically)
pm2 start ecosystem.config.js

# Alternative: Manual start with environment variable
NODE_ENV=production pm2 start server/index.js --name social-presence

# Save the process list to restart on reboot
pm2 save
pm2 startup
```

**Important**: Always use `ecosystem.config.js` or set `NODE_ENV=production` to enable:
- Automatic database backups every 6 hours
- Production-optimized logging
- Performance optimizations

## 4. Security Verification

- **SSL/TLS**: Visit `https://yourdomain.com` (it should show a 404 or upgrade required, but with a valid lock icon).
- **WSS**: Configure your VS Code extension to connect to `wss://yourdomain.com`.
- **Firewall**: Ensure only ports 22 (SSH), 80 (HTTP), and 443 (HTTPS) are open.
  ```bash
  sudo ufw allow 22
  sudo ufw allow 80
  sudo ufw allow 443
  sudo ufw enable
  ```

## 5. Maintenance

- **Logs**:
  - App logs: `pm2 logs social-presence`
  - Caddy logs: `/var/log/caddy/social-presence.log` (if configured) or `journalctl -u caddy`

- **Updates**:
  ```bash
  git pull
  npm ci --production
  pm2 restart social-presence
  ```

## 6. Database Backups

The server automatically backs up the database every 6 hours when running in production (`NODE_ENV=production`).

### Backup Location
Backups are stored in the `backups/` directory (or `BACKUP_DIR` env var):
```
backups/
├── database-2024-12-04T12-00-00-000Z.sqlite
├── database-2024-12-04T06-00-00-000Z.sqlite
└── ...
```

### Key Features
- **Automatic backups** every 6 hours in production
- **Startup backup** taken 5 seconds after server starts
- **Automatic cleanup** keeps only the last 5 backups
- **Safe backup** using better-sqlite3's backup API (no data corruption)

### Manual Backup
If needed, you can trigger a backup manually:
```bash
# From Node.js console or script
const { dbService } = require('./server/database');
dbService.backup();
```

### Restore from Backup
To restore from a backup:
```bash
# Stop the server
pm2 stop social-presence

# Copy backup over database
cp backups/database-TIMESTAMP.sqlite data/database.sqlite

# Restart the server
pm2 start social-presence
```

### Configure Backup Directory
Set `BACKUP_DIR` in your `.env` file:
```bash
BACKUP_DIR=/var/backups/social-presence
```
