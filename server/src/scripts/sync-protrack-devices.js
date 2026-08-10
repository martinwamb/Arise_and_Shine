import '../load-env.js';
import { db, init } from '../db.js';
import {
  classifyProtrackDevices,
  listProtrackDevices,
  planProtrackTruckSync,
} from '../protrack-devices.js';

// Previews (or applies) what the running server's Protrack device sync would do.
//   node src/scripts/sync-protrack-devices.js --dry-run
//   node src/scripts/sync-protrack-devices.js --apply
const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
if(!apply && !args.has('--dry-run')){
  console.error('Usage: node src/scripts/sync-protrack-devices.js [--dry-run|--apply]');
  process.exit(1);
}

const q = (sql, params=[])=> new Promise((resolve, reject)=> db.all(sql, params, (e, rows)=> e?reject(e):resolve(rows)));
const run = (sql, params=[])=> new Promise((resolve, reject)=> db.run(sql, params, function(e){ e?reject(e):resolve(this); }));

function defaultCapacity(){
  return Number(
    process.env.PROTRACK_DEFAULT_CAPACITY_T ||
    process.env.CARTRACK_DEFAULT_CAPACITY_T ||
    process.env.TRUCK_UNIT_TONNES ||
    20
  ) || 0;
}

async function main(){
  init();
  const trucks = await q('SELECT id, plate, protrack_imei AS protrackImei FROM trucks ORDER BY id');
  const devices = await listProtrackDevices();
  const { trucks: candidates, skipped } = classifyProtrackDevices(devices);
  const { created, backfilled, unchanged } = planProtrackTruckSync(trucks, candidates);

  console.log(`Mode:              ${apply ? 'APPLY' : 'DRY RUN (no writes)'}`);
  console.log(`Trucks in DB:      ${trucks.length}`);
  console.log(`Devices on account:${String(devices.length).padStart(3)}`);
  console.log(`  -> new trucks:   ${created.length}`);
  console.log(`  -> tracker links:${String(backfilled.length).padStart(3)}`);
  console.log(`  -> already linked:${String(unchanged.length).padStart(2)}`);
  console.log(`  -> skipped:      ${skipped.length}`);

  if(created.length){
    console.log('\nWOULD CREATE:');
    for(const item of created) console.log(`  ${item.truckId.padEnd(10)} ${item.plate.padEnd(10)} imei ${item.imei}`);
  }
  if(backfilled.length){
    console.log('\nWOULD LINK TRACKER TO EXISTING TRUCK:');
    for(const item of backfilled){
      const from = item.previousImei ? ` (was ${item.previousImei})` : '';
      console.log(`  ${String(item.truckId).padEnd(10)} ${String(item.plate).padEnd(10)} imei ${item.imei}${from}`);
    }
  }
  if(skipped.length){
    console.log('\nSKIPPED (not a truck plate — trailers and spare units live here):');
    for(const item of skipped) console.log(`  ${String(item.deviceName).padEnd(28)} ${String(item.imei || '-').padEnd(16)} ${item.reason}`);
  }

  if(!apply){
    console.log('\nNothing was written. Re-run with --apply to commit these changes.');
    return;
  }

  const now = new Date().toISOString();
  const capacity = defaultCapacity();
  for(const item of backfilled){
    await run('UPDATE trucks SET protrack_imei=?, updated_at=? WHERE id=?', [item.imei, now, item.truckId]);
  }
  for(const item of created){
    await run(
      `INSERT OR IGNORE INTO trucks (
        id, plate, capacity_t, primary_driver_id, protrack_imei, created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?)`,
      [item.truckId, item.plate, capacity, null, item.imei, now, now]
    );
  }
  console.log(`\nApplied: ${created.length} truck(s) created, ${backfilled.length} tracker link(s) written.`);
}

main()
  .then(()=> process.exit(0))
  .catch((err)=>{
    console.error('Protrack device sync failed:', err);
    process.exit(1);
  });
