
import './load-env.js';
import { db, init } from './db.js';
import { hash } from './auth.js';

init();
function run(sql, p=[]) { return new Promise((resolve,reject)=> db.run(sql,p,function(e){e?reject(e):resolve(this)})); }
(async()=>{
  try{
    await run('INSERT OR IGNORE INTO users (id,email,name,phone,role,password_hash,created_at) VALUES (1,?,?,?,?,?,?)',[ 'admin@arise.local', 'Admin', '', 'ADMIN', hash('admin123'), new Date().toISOString() ]);
    await run('INSERT OR IGNORE INTO users (id,email,name,phone,role,password_hash,created_at) VALUES (2,?,?,?,?,?,?)',[ 'ops@arise.local', 'Ops', '', 'OPS', hash('ops123'), new Date().toISOString() ]);
    await run('INSERT OR IGNORE INTO drivers (id,name) VALUES (?,?)',[ 'D1','Peter Otieno' ]);
    await run('INSERT OR IGNORE INTO drivers (id,name) VALUES (?,?)',[ 'D2','Mary Njeri' ]);
    await run('INSERT OR IGNORE INTO drivers (id,name) VALUES (?,?)',[ 'D3','Daniel Kip' ]);
    await run('INSERT OR IGNORE INTO trucks (id,plate,capacity_t) VALUES (?,?,?)',[ 'T1','KDC 112A', 15 ]);
    await run('INSERT OR IGNORE INTO trucks (id,plate,capacity_t) VALUES (?,?,?)',[ 'T2','KDD 987B', 15 ]);
    await run('INSERT OR IGNORE INTO trucks (id,plate,capacity_t) VALUES (?,?,?)',[ 'T3','KDE 305C', 20 ]);
    await run('INSERT OR IGNORE INTO stock (id,yard_name,tonnes) VALUES (1,?,?)',[ 'Main Yard', 200 ]);
    await run('INSERT OR IGNORE INTO users (id,email,name,phone,role,password_hash,driver_id,created_at) VALUES (3,?,?,?,?,?,?,?)',[ 'driver@arise.local', 'Lead Driver', '', 'DRIVER', hash('driver123'), 'D1', new Date().toISOString() ]);
    await run('INSERT OR IGNORE INTO users (id,email,name,phone,role,password_hash,created_at) VALUES (4,?,?,?,?,?,?)',[ 'fuel@arise.local', 'Fuel Monitor', '', 'FUEL', hash('fuel123'), new Date().toISOString() ]);
    await run('INSERT OR IGNORE INTO users (id,email,name,phone,role,password_hash,created_at) VALUES (5,?,?,?,?,?,?)',[ 'customer@arise.local', 'Construction Client', '0722000111', 'CUSTOMER', hash('customer123'), new Date().toISOString() ]);
    console.log('Seeded. Admin admin@arise.local/admin123; Ops ops@arise.local/ops123');
    process.exit(0);
  }catch(e){ console.error(e); process.exit(1); }
})();
