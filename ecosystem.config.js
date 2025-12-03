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
        },
        error_file: './logs/err.log',
        out_file: './logs/out.log',
        time: true
    }]
};
