const path = require('path');

const rootDir = __dirname;

module.exports = {
  apps: [
    {
      name: 'ariseandshine',
      cwd: path.resolve(rootDir, 'server'),
      script: 'npm',
      args: 'start',
      env: {
        NODE_ENV: process.env.NODE_ENV || 'production',
        DB_FILE: process.env.DB_FILE || path.resolve(rootDir, 'server', 'data.db'),
      },
    },
  ],
};
