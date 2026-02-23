module.exports = {
  apps: [
    {
      name: 'ariseandshine',
      script: 'src/index.js',
      interpreter: 'node',
      cwd: '/home/admin/apps/ariseandshine/server',
      max_memory_restart: '512M',
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: '10s',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '/home/admin/logs/arise-error.log',
      out_file: '/home/admin/logs/arise-out.log',
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
