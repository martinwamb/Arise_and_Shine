const path = require('path');

const rootDir = __dirname;

module.exports = {
  apps: [
    {
      name: 'ariseandshine',
      cwd: path.resolve(rootDir, 'server'),
      script: 'src/index.js',
      node_args: '--max-old-space-size=900',
      // Startup does a one-time telemetry prune that transiently spikes memory
      // well above steady-state (~150-270MB) — observed peaks above 3GB. No
      // memory ceiling here; the underlying prune-memory-usage issue in
      // analyzeTelemetrySnapshots/telemetry pruning should be fixed separately.
      max_memory_restart: 0,
      env: {
        NODE_ENV: process.env.NODE_ENV || 'production',
        DB_FILE: process.env.DB_FILE || path.resolve(rootDir, 'server', 'data.db'),
      },
    },
  ],
};
