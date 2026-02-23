// Format a UTC ISO timestamp as Nairobi time (UTC+3): "7am", "7:15am", "10:43am", "12pm"
function formatTripTime(isoString){
  if(!isoString) return '';
  const d = new Date(isoString);
  if(Number.isNaN(d.getTime())) return '';
  const nairobi = new Date(d.getTime() + 3 * 60 * 60 * 1000);
  let h = nairobi.getUTCHours();
  const m = nairobi.getUTCMinutes();
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return m === 0 ? `${h}${ampm}` : `${h}:${String(m).padStart(2, '0')}${ampm}`;
}

// Format a date string (YYYY-MM-DD or ISO) as "14-Jan-26"
function formatTripDate(isoString){
  if(!isoString) return '';
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const d = new Date(isoString);
  if(Number.isNaN(d.getTime())) return '';
  // Use Nairobi date (UTC+3)
  const nairobi = new Date(d.getTime() + 3 * 60 * 60 * 1000);
  const dd = String(nairobi.getUTCDate()).padStart(2, '0');
  const mon = MONTHS[nairobi.getUTCMonth()];
  const yy = String(nairobi.getUTCFullYear()).slice(-2);
  return `${dd}-${mon}-${yy}`;
}

// Returns the Nairobi date string (YYYY-MM-DD) for grouping
function nairobiDateKey(isoString){
  if(!isoString) return '';
  const d = new Date(isoString);
  if(Number.isNaN(d.getTime())) return '';
  const nairobi = new Date(d.getTime() + 3 * 60 * 60 * 1000);
  return `${nairobi.getUTCFullYear()}-${String(nairobi.getUTCMonth()+1).padStart(2,'0')}-${String(nairobi.getUTCDate()).padStart(2,'0')}`;
}

function toCurrency(value){
  const num = Number(value) || 0;
  return `KES ${Math.round(num).toLocaleString()}`;
}

function summariseTripExpectedSales(rows=[]){
  const byTruck = new Map();
  rows.forEach((row)=>{
    const plate = (row?.plate || row?.truckId || 'Truck').trim() || 'Truck';
    const sale = Math.max(0, Number(row?.expectedAmount) || 0);
    if(!byTruck.has(plate)){
      byTruck.set(plate, { plate, trips: [], totalSales: 0 });
    }
    const bucket = byTruck.get(plate);
    bucket.trips.push({
      route: row?.notes || row?.route || 'Route',
      expected: sale,
      start: row?.rawStart || row?.startTime || '',
      rawStart: row?.rawStart || '',
      rawEnd: row?.rawEnd || '',
      rawFromStart: row?.rawFromStart || '',
      distanceKm: Number(row?.distanceKm) || 0,
    });
    bucket.totalSales += sale;
  });
  return Array.from(byTruck.values()).map((group)=>{
    const sortedTrips = [...group.trips].sort((a,b)=> String(a.rawStart || a.start || '').localeCompare(String(b.rawStart || b.start || '')));
    return { ...group, trips: sortedTrips };
  });
}

function buildTripExpectedTelegram(groups, grandTotal){
  if(!groups.length){
    return 'No trips detected for the selected period.';
  }
  const lines = [];
  groups.forEach((group, idx)=>{
    if(idx > 0) lines.push('');
    lines.push(group.plate);

    // Group trips by Nairobi calendar date
    const byDate = new Map();
    group.trips.forEach((trip)=>{
      const dateKey = nairobiDateKey(trip.rawStart || trip.start);
      if(!byDate.has(dateKey)) byDate.set(dateKey, []);
      byDate.get(dateKey).push(trip);
    });

    byDate.forEach((dayTrips, dateKey)=>{
      lines.push(formatTripDate(dayTrips[0].rawStart || dayTrips[0].start));

      // First arrival: when the truck was at the origin before the first trip
      const first = dayTrips[0];
      const originLabel = first.route ? first.route.split(' > ')[0].trim() : '';
      const arrivalTime = first.rawFromStart ? formatTripTime(first.rawFromStart) : '';
      if(arrivalTime && originLabel){
        lines.push(`${arrivalTime} > ${originLabel} arrival`);
      }

      // Each driving segment
      dayTrips.forEach((trip)=>{
        const dest = trip.route ? trip.route.split(' > ').pop().trim() : 'Unknown';
        const startT = trip.rawStart ? formatTripTime(trip.rawStart) : '';
        const endT = trip.rawEnd ? formatTripTime(trip.rawEnd) : '';
        const dist = trip.distanceKm > 0 ? ` ${trip.distanceKm}km` : '';
        if(startT && endT){
          lines.push(`${startT}-${endT} > Drove to ${dest}${dist}`);
        } else if(startT){
          lines.push(`${startT} > Driving to ${dest}${dist}`);
        }
      });
    });
  });
  if(Number.isFinite(grandTotal) && grandTotal > 0){
    lines.push('');
    lines.push(`Overall expected: ${toCurrency(grandTotal)}`);
  }
  return lines.join('\n').trim();
}

function buildTripExpectedEmailBody(groups, grandTotal, meta){
  const rangeLabel = meta?.fromDate && meta?.toDate
    ? `${meta.fromDate} to ${meta.toDate}`
    : 'Selected period';
  const lines = [`Trip Expected Sales (${rangeLabel})`];
  lines.push(`Total expected sales: ${toCurrency(grandTotal || 0)}`);
  if(!groups.length){
    lines.push('No sales legs detected for this window.');
    return lines;
  }
  groups.forEach((group)=>{
    lines.push('');
    lines.push(`${group.plate} — ${group.trips.length} trip(s)`);
    group.trips.forEach((trip, i)=>{
      const rank = String(i+1).padStart(2, '0');
      lines.push(`${rank}. ${trip.route} (${toCurrency(trip.expected)})`);
    });
    lines.push(`Subtotal: ${toCurrency(group.totalSales)}`);
  });
  return lines;
}

export {
  summariseTripExpectedSales,
  buildTripExpectedTelegram,
  buildTripExpectedEmailBody,
};
