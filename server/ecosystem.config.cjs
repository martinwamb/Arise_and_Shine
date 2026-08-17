module.exports = {
  apps: [
    {
      name: 'ariseandshine',
      script: 'src/index.js',
      interpreter: 'node',
      cwd: '/home/admin/apps/ariseandshine/server',
      // Matches how the process has actually been started in production. Kept here so a
      // restart from this file reproduces the running config instead of silently changing it.
      node_args: '--max-old-space-size=900',
      // RSS, not heap. The JS heap stays ~40MB; what grows is native memory behind
      // node-sqlite3, so this is the only limit that can catch a runaway. Sits well above
      // normal steady-state (~150MB) and far below the 6.9GB this reached when unbounded.
      max_memory_restart: '1500M',
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: '10s',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
        // node-sqlite3 runs queries on the libuv threadpool, and glibc hands each thread its
        // own malloc arena. Large result sets fragment those arenas, and glibc never returns
        // them to the OS: production accumulated 47+ fully-resident 128MB regions (6.0GB of
        // [anon]) against a 36MB JS heap. Capping the arena count bounds that retention.
        MALLOC_ARENA_MAX: '2',
      },
    },
  ],
};
