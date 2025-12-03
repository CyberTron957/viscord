# Production Deployment Guide

This guide describes how to deploy the VS Code Social Presence server to production using **Caddy** as a reverse proxy.

You can deploy using a **Domain Name** (recommended for automatic SSL) or directly via **Server IP** with a custom port.

## Prerequisites

- A server (VPS) running Linux (Ubuntu/Debian recommended)
- Node.js (v18+) and npm installed
- Caddy installed

## 1. Server Setup

1.  **Clone the repository** to your server:
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
    *(Note: Ensure you have `typescript` installed or run `npm install` without `--production` first, then prune)*

4.  **Configure Environment Variables**:
    Create a `.env` file in the project root:
    ```bash
    # Internal Node.js app port (hidden behind Caddy)
    PORT=8080

    # Public IP and Port for Caddy to listen on
    SERVER_IP=1.2.3.4       # Replace with your server's public IP
    EXTERNAL_PORT=3000      # Replace with your desired public port

    NODE_ENV=production
    DB_PATH=/var/data/social-presence.sqlite
    ```

5.  **Set File Permissions**:
    Secure the database file:
    ```bash
    mkdir -p /var/data
    touch /var/data/social-presence.sqlite
    chmod 600 /var/data/social-presence.sqlite
    # chown user:group /var/data/social-presence.sqlite
    ```

## 2. Process Management (PM2)

Use PM2 to keep the Node.js application running.

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

## 3. Caddy Configuration (Reverse Proxy)

We use Caddy to handle external connections and proxy them to our Node.js app.

1.  **Install Caddy**:
    Follow instructions at [caddyserver.com](https://caddyserver.com/docs/install).

2.  **Prepare Caddyfile**:
    The repository includes a `Caddyfile` that uses environment variables. You can use it directly.

3.  **Run Caddy**:
    Since we are using environment variables (`SERVER_IP`, `EXTERNAL_PORT`) in the Caddyfile, we need to load them when running Caddy.

    **Option A: Running manually (for testing)**
    ```bash
    # Load .env vars and run caddy
    export $(grep -v '^#' .env | xargs)
    caddy run --config Caddyfile --adapter caddyfile
    ```

    **Option B: Running as a service (Recommended)**
    If running Caddy as a systemd service, you need to add the environment variables to the service unit.
    
    Edit the service file:
    ```bash
    sudo systemctl edit caddy
    ```
    Add the following:
    ```ini
    [Service]
    EnvironmentFile=/path/to/your/vscode-social-presence/.env
    ```
    Then restart Caddy:
    ```bash
    sudo systemctl restart caddy
    ```

### Important Note on SSL with IP Addresses
If you use an **IP Address** instead of a domain name, Caddy will likely generate a **self-signed certificate** (Internal CA).
- **VS Code will reject this certificate** by default.
- To make it work, you have two options:
    1.  **Disable Strict SSL in VS Code** (Easiest, less secure):
        - Open Settings (`Cmd+,`)
        - Search for `http.proxyStrictSSL`
        - Uncheck it (set to `false`).
    2.  **Use HTTP instead** (No encryption):
        - Change your `Caddyfile` to listen on `http://{$SERVER_IP}:{$EXTERNAL_PORT}` explicitly.
        - Update client setting to `ws://...` instead of `wss://`.

## 4. Client Configuration

Once your server is running:

1.  Open VS Code Settings.
2.  Search for `Social Presence`.
3.  Set **Server Url**:
    - If using SSL (default): `wss://1.2.3.4:3000` (Replace with your IP:Port)
    - If using HTTP: `ws://1.2.3.4:3000`
4.  Reload VS Code.

## Security Notes

- **Message Size Limit**: The server enforces a 16KB limit per message.
- **Rate Limiting**: Connections are limited to 5/min per IP.
- **Database**: Ensure `database.sqlite` is not accessible via the web server.

## Troubleshooting

- **Check Logs**:
    - PM2: `pm2 logs social-presence`
    - Caddy: `/var/log/caddy/social-presence.log` (if configured) or `journalctl -u caddy`
- **Connection Refused**: Ensure the Node.js server is running on port 8080 (internal) and Caddy is running on the external port.
- **SSL Error**: If connecting via IP, check the "Important Note on SSL" above.
