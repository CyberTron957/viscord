# Production Deployment Guide

This guide describes how to deploy the VS Code Social Presence server to production using **Caddy** with your domain.

## Prerequisites

- A server (VPS) running Linux
- **Domain Name** (`yourdomain.com`) pointing to your server's IP (A Record)
- Node.js (v18+) and npm installed
- Caddy installed

## 1. Server Setup

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/yourusername/vscode-social-presence.git
    cd vscode-social-presence
    ```

2.  **Install dependencies**:
    ```bash
    npm install --production
    ```

3.  **Compile the server**:
    ```bash
    npm run compile:server
    ```

4.  **Configure Environment Variables**:
    Create a `.env` file:
    ```bash
    # Internal port (Matches your Caddyfile)
    PORT=8080
    
    NODE_ENV=production
    DB_PATH=/var/data/social-presence.sqlite
    ```

5.  **Set File Permissions**:
    ```bash
    mkdir -p /var/data
    touch /var/data/social-presence.sqlite
    chmod 600 /var/data/social-presence.sqlite
    ```

## 2. Process Management (PM2)

1.  **Install PM2**:
    ```bash
    npm install -g pm2
    ```

2.  **Start the server**:
    ```bash
    pm2 start server/index.js --name social-presence
    pm2 save
    pm2 startup
    ```

## 3. Caddy Configuration

1.  **Verify Caddyfile**:
    Ensure `/etc/caddy/Caddyfile` looks like this:
    ```caddyfile
    yourdomain.com {
        reverse_proxy localhost:8080
        
        header {
            Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
            X-Content-Type-Options "nosniff"
            X-Frame-Options "DENY"
        }
        
        log {
            output file /var/log/caddy/social-presence.log
        }
    }
    ```

2.  **Reload Caddy**:
    ```bash
    sudo systemctl reload caddy
    ```
    Caddy will automatically generate SSL certificates for your domain.

## 4. Client Configuration

1.  Open VS Code Settings.
2.  Search for `Social Presence`.
3.  Set **Server Url** to:
    ```
    wss://yourdomain.com
    ```
4.  Reload VS Code.
