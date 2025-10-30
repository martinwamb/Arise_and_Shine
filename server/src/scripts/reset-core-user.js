import 'dotenv/config';
import { db, init } from '../db.js';
import { hash } from '../auth.js';

function usage(code = 1) {
  console.log('Usage: node src/scripts/reset-core-user.js --role ADMIN --email user@example.com --password "NewPassword123"');
  process.exit(code);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (!current.startsWith('--')) continue;
    const key = current.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const role = (args.role || 'ADMIN').toUpperCase();
  const email = args.email || process.env[`${role}_EMAIL`];
  const password = args.password;
  if (!password) {
    console.error('Missing --password argument.');
    usage();
  }
  if (!email) {
    console.error('Missing --email argument and no fallback from environment variables.');
    usage();
  }

  init();

  const user = await get('SELECT * FROM users WHERE email=?', [email]);
  if (!user) {
    console.error(`No user found with email ${email}.`);
    process.exit(1);
  }
  if (user.role !== role) {
    console.warn(`User role mismatch: expected ${role}, found ${user.role}. Updating password regardless.`);
  }

  await run('UPDATE users SET password_hash=? WHERE id=?', [hash(password), user.id]);
  console.log(`Password updated for ${email}.`);
  console.log('You can now remove plain text ADMIN_* credentials from the environment if desired.');
}

main()
  .catch((err) => {
    console.error('Failed to reset password:', err);
    process.exit(1);
  })
  .finally(() => {
    try {
      db.close();
    } catch {
      // ignore close errors
    }
  });
