module.exports = {
    apps: [{
        name: 'vscode-social-presence',
        script: './server/index.js',
        instances: 1,
        exec_mode: 'fork',  // ← Should be 'fork', not 'cluster'
        autorestart: true,
        watch: false,
        max_memory_restart: '500M',
        env: {
            NODE_ENV: 'production',
            PORT: 8080,
            DB_PATH: './database.sqlite',
            BACKUP_DIR: './backups'
        },
        error_file: './logs/err.log',
        out_file: './logs/out.log',
        time: true
    }]
};