import '../load-env.js';
import { db, init } from '../db.js';

const sql = process.argv[2];
if(!sql){
  console.error('Usage: node src/scripts/run-query.js "SQL"');
  process.exit(1);
}

init();

db.all(sql, [], (err, rows)=>{
  if(err){
    console.error('Query failed:', err);
    process.exit(1);
  }
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
});
