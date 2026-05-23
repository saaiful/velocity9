module.exports = {
  apps: [
    {
      name: 'velocity9',
      script: 'server/server.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '256M',

      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },

      env_development: {
        NODE_ENV: 'development',
        PORT: 3000,
      },

      out_file: './logs/out.log',
      error_file: './logs/error.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      autorestart: true,
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: '10s',
    },
  ],
};
