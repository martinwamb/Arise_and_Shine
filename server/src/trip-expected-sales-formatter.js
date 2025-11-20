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
    });
    bucket.totalSales += sale;
  });
  return Array.from(byTruck.values()).map((group)=>{
    const sortedTrips = [...group.trips].sort((a,b)=> String(a.start || '').localeCompare(String(b.start || '')));
    return { ...group, trips: sortedTrips };
  });
}

function buildTripExpectedTelegram(groups, grandTotal){
  if(!groups.length){
    return 'No sales legs detected for the selected period.';
  }
  const lines = [];
  groups.forEach((group, idx)=>{
    if(idx>0) lines.push('');
    lines.push(group.plate);
    lines.push(`Number of trips - ${group.trips.length}`);
    group.trips.forEach((trip, i)=>{
      const rank = String(i+1).padStart(2, '0');
      lines.push(`${rank}. ${trip.route}`);
    });
    lines.push(`Total expected sales - ${toCurrency(group.totalSales)}`);
  });
  if(Number.isFinite(grandTotal) && grandTotal > 0){
    lines.push('');
    lines.push(`Overall expected sales: ${toCurrency(grandTotal)}`);
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
