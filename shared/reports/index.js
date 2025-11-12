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
];

const REPORT_DEFINITION_MAP = REPORT_DEFINITIONS.reduce((map, def) => {
  map[def.key] = def;
  return map;
}, {});

export function getReportDefinition(key){
  return REPORT_DEFINITION_MAP[key] || null;
}

export { REPORT_DEFINITIONS, REPORT_DEFINITION_MAP, REPORT_FORMATS };
