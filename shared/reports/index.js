const REPORT_FORMATS = ['excel','pdf'];

const REPORT_DEFINITIONS = [
  {
    key: 'stocks',
    title: 'Stock & Yard Movements',
    description: 'Truck units received or released from the yard, showing sand category and supporting references.',
    columns: [
      { key: 'createdAt', label: 'Timestamp', dataType: 'datetime' },
      { key: 'kind', label: 'Kind', dataType: 'text' },
      { key: 'category', label: 'Category', dataType: 'text' },
      { key: 'trucks', label: 'Truck units', dataType: 'number' },
      { key: 'tonnes', label: 'Tonnes', dataType: 'number' },
      { key: 'reason', label: 'Reason', dataType: 'text' },
      { key: 'orderId', label: 'Order ID', dataType: 'text' },
      { key: 'truckId', label: 'Truck ID', dataType: 'text' },
      { key: 'costPerTonne', label: 'Cost/tonne', dataType: 'currency' },
    ],
    filters: {
      requiresDateRange: true,
      defaultRangeDays: 14,
    },
  },
  {
    key: 'driver-earnings',
    title: 'Driver Earnings',
    description: 'Delivered assignments per driver with total tonnes and estimated revenue.',
    columns: [
      { key: 'driverId', label: 'Driver ID', dataType: 'text' },
      { key: 'driverName', label: 'Driver name', dataType: 'text' },
      { key: 'loads', label: 'Loads', dataType: 'number' },
      { key: 'deliveredLoads', label: 'Delivered', dataType: 'number' },
      { key: 'tonnes', label: 'Tonnes', dataType: 'number' },
      { key: 'revenue', label: 'Revenue', dataType: 'currency' },
    ],
    filters: {
      requiresDateRange: true,
      defaultRangeDays: 30,
      allowDriverId: true,
    },
  },
  {
    key: 'truck-performance',
    title: 'Daily Truck Performance',
    description: 'Loads, tonnes and estimated revenue per truck/plate per day.',
    columns: [
      { key: 'day', label: 'Day', dataType: 'date' },
      { key: 'plate', label: 'Plate', dataType: 'text' },
      { key: 'loads', label: 'Loads', dataType: 'number' },
      { key: 'deliveredLoads', label: 'Delivered', dataType: 'number' },
      { key: 'tonnes', label: 'Tonnes', dataType: 'number' },
      { key: 'revenue', label: 'Revenue', dataType: 'currency' },
    ],
    filters: {
      requiresDateRange: true,
      defaultRangeDays: 14,
      allowTruckId: true,
    },
  },
  {
    key: 'truck-sales-expenses',
    title: 'Truck Sales & Expenses',
    description: 'Per-truck revenue versus expense detail with Excel exports split into one sheet per plate.',
    columns: [
      { key: 'plate', label: 'Plate', dataType: 'text' },
      { key: 'salesTotal', label: 'Total sales', dataType: 'currency' },
      { key: 'expenseTotal', label: 'Total expenses', dataType: 'currency' },
      { key: 'net', label: 'Net', dataType: 'currency' },
      { key: 'salesCount', label: 'Sales rows', dataType: 'number' },
      { key: 'expenseCount', label: 'Expense rows', dataType: 'number' },
    ],
    filters: {
      requiresDateRange: true,
      defaultRangeDays: 30,
    },
  },
  {
    key: 'trip-expected-sales',
    title: 'Trip Expected Sales',
    description: 'Sales legs detected from telemetry dwells with expected revenue per truck.',
    columns: [
      { key: 'truckId', label: 'Truck', dataType: 'text' },
      { key: 'plate', label: 'Plate', dataType: 'text' },
      { key: 'tripType', label: 'Type', dataType: 'text' },
      { key: 'startTime', label: 'Start', dataType: 'text' },
      { key: 'endTime', label: 'End', dataType: 'text' },
      { key: 'distanceKm', label: 'KM', dataType: 'number' },
      { key: 'expectedAmount', label: 'Expected', dataType: 'currency' },
      { key: 'notes', label: 'Route', dataType: 'text' },
    ],
    filters: {
      requiresDateRange: true,
      defaultRangeDays: 1,
    },
  },
  {
    key: 'ai-insights',
    title: 'AI Insights by Truck',
    description: 'Per-truck telemetry observations and AI-style bullet points for messaging.',
    columns: [
      { key: 'truckId', label: 'Truck ID', dataType: 'text' },
      { key: 'plate', label: 'Plate', dataType: 'text' },
      { key: 'insight1', label: 'Insight 1', dataType: 'text' },
      { key: 'insight2', label: 'Insight 2', dataType: 'text' },
      { key: 'insight3', label: 'Insight 3', dataType: 'text' },
      { key: 'alertsCount', label: 'Alerts', dataType: 'number' },
      { key: 'maxSpeed', label: 'Top speed (km/h)', dataType: 'number' },
      { key: 'idleMaxMinutes', label: 'Longest idle (min)', dataType: 'number' },
    ],
    filters: {
      requiresDateRange: true,
      defaultRangeDays: 1,
      allowTruckId: true,
    },
  },
  {
    key: 'speeding-alerts',
    title: 'Speeding Alerts',
    description: 'Speeding incident counts plus gross violations (>80 kph) with locations and driver notes.',
    columns: [
      { key: 'truckId', label: 'Truck ID', dataType: 'text' },
      { key: 'plate', label: 'Plate', dataType: 'text' },
      { key: 'incidentCount', label: 'Incidents (>65 kph)', dataType: 'number' },
      { key: 'grossViolations', label: 'Gross (>80 kph)', dataType: 'number' },
      { key: 'latestSpeed', label: 'Latest speed (kph)', dataType: 'number' },
      { key: 'latestLocation', label: 'Latest location', dataType: 'text' },
      { key: 'latestDriver', label: 'Latest driver', dataType: 'text' },
      { key: 'latestAt', label: 'Latest time', dataType: 'datetime' },
      { key: 'grossDetails', label: 'Gross violation details', dataType: 'text' },
    ],
    filters: {
      requiresDateRange: true,
      defaultRangeDays: 7,
      allowTruckId: true,
    },
  },
];

const REPORT_DEFINITION_MAP = REPORT_DEFINITIONS.reduce((map, def) => {
  map[def.key] = def;
  return map;
}, {});

export function getReportDefinition(key){
  return REPORT_DEFINITION_MAP[key] || null;
}

export { REPORT_DEFINITIONS, REPORT_DEFINITION_MAP, REPORT_FORMATS };
