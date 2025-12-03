# Azure VM Deployment Guide

## Prerequisites
- Azure VM with Ubuntu 20.04+ or Windows Server
- Node.js 18+ installed
- Domain name (optional, for SSL)

## Features Included in This Deployment
- ✅ GitHub OAuth authentication
- ✅ SQLite persistent storage
- ✅ Privacy settings (5 visibility modes)
- ✅ Rate limiting & anti-abuse
- ✅ Multiple windows support (session aggregation)
- ✅ Offline users with "last seen" timestamps
- ✅ Performance optimizations (80% traffic reduction)

## Step 1: Prepare Server Files

1. **Compile TypeScript:**
   ```bash
   npm run compile
   npx tsc server/database.ts --esModuleInterop --skipLibCheck --target es2015 --module commonjs
   npx tsc server/rateLimiter.ts --esModuleInterop --skipLibCheck --target es2015 --module commonjs
   npx tsc server/index.ts --esModuleInterop --skipLibCheck --target es2015 --module commonjs
   ```

2. **Test locally:**
   ```bash
   node server/index.js
   ```

## Step 2: Transfer to Azure VM

```bash
# From your local machine
scp -r server/ package.json package-lock.json azureuser@YOUR_VM_IP:~/vscode-social-presence/
```

## Step 3: Install Dependencies on VM

```bash
ssh azureuser@YOUR_VM_IP
cd ~/vscode-social-presence
npm install --production
```

## Step 4: Install PM2 (Process Manager)

```bash
sudo npm install -g pm2
```

## Step 5: Create Ecosystem File

Create `ecosystem.config.js`:
```javascript
module.exports = {
  apps: [{
    name: 'vscode-social-presence',
    script: './server/index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
      PORT: 8080,
      DB_PATH: './database.sqlite'
    }
  }]
};
```

## Step 6: Start with PM2

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup  # Follow the instructions to enable auto-start on boot
```

## Step 7: Configure Firewall

### Ubuntu:
```bash
sudo ufw allow 8080/tcp
sudo ufw allow 22/tcp  # SSH
sudo ufw enable
```

### Azure Network Security Group:
1. Go to Azure Portal → Your VM → Networking
2. Add inbound port rule:
   - Port: 8080
   - Protocol: TCP
   - Name: WebSocket

## Step 8: (Optional) Setup SSL with Nginx Reverse Proxy

### Install Nginx:
```bash
sudo apt update
sudo apt install nginx certbot python3-certbot-nginx
```

### Configure Nginx (`/etc/nginx/sites-available/vscode-social`):
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Enable site:
```bash
sudo ln -s /etc/nginx/sites-available/vscode-social /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Get SSL Certificate:
```bash
sudo certbot --nginx -d your-domain.com
```

## Step 9: Update Extension Configuration

In `src/wsClient.ts`, change the WebSocket URL:

```typescript
// For direct connection
this.ws = new WebSocket('ws://YOUR_VM_IP:8080');

// For SSL with domain
this.ws = new WebSocket('wss://your-domain.com');
```

## Step 10: Monitor Application

```bash
# View logs
pm2 logs vscode-social-presence

# View status
pm2 status

# Restart
pm2 restart vscode-social-presence

# Stop
pm2 stop vscode-social-presence
```

## Environment Variables

Create `.env` file (optional):
```bash
PORT=8080
NODE_ENV=production
DB_PATH=./database.sqlite
```

## Backup Database

```bash
# Backup
cp database.sqlite database.backup.sqlite

# Schedule daily backups with cron
crontab -e
# Add: 0 2 * * * cp ~/vscode-social-presence/database.sqlite ~/backups/db-$(date +\%Y\%m\%d).sqlite
```

## Troubleshooting

### Check if running:
```bash
pm2 status
netstat -tlnp | grep 8080
```

### Check logs:
```bash
pm2 logs --lines 100
```

### Restart server:
```bash
pm2 restart vscode-social-presence
```

### Connection issues:
- Ensure firewall allows port 8080
- Check Azure NSG rules
- Verify server is running: `pm2 status`

## Performance Tuning

For 100+ concurrent users:
```bash
# Increase file descriptors
ulimit -n 10000

# Monitor resources
pm2 monit
```
