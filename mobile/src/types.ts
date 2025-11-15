export type Article = {
  id: string;
  title: string;
  summary?: string | null;
  topic?: string | null;
  createdAt?: string | null;
};

export type AuthUser = {
  id: string;
  email: string;
  name?: string | null;
  role: string;
  driverId?: string | null;
};

export type PricingGuide = {
  basePrice: number;
  baseDistanceKm: number;
  incrementKm: number;
  incrementAmount: number;
};

export type Quote = {
  perTruck: number;
  total: number;
  distanceKm: number;
  sandType: string;
  truckCount: number;
  distanceSource?: string | null;
};

export type GuestOrderForm = {
  name: string;
  phone: string;
  email: string;
  site: string;
  sandType: 'coarse' | 'smooth';
  trucks: number;
  distanceKm: string;
  dateNeeded: string;
};

export type GuestOrderSummary = Quote & {
  id: string;
  status: string;
};

export type LandingAccountResponse = {
  token: string;
  user: AuthUser;
} | null;

export type CustomerOrder = {
  id: string;
  site: string;
  sand_type?: string;
  trucks: number;
  per_truck?: number;
  total?: number;
  status: string;
  payment_status?: string;
  distance_km?: number;
  distance_source?: string;
  created_at: string;
  assignments?: {
    id: string;
    truckId: string;
    plate?: string;
    status: string;
    scheduledAt?: string;
    tonnes?: number;
  }[];
};

export type DriverProfile = {
  id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  nationalIdPath?: string | null;
  photoPath?: string | null;
};

export type DriverTelemetry = {
  truckId?: string | null;
  plate?: string | null;
  status?: string | null;
  speed?: number | null;
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
  lastUpdated?: string | null;
  idleMinutes?: number | null;
  driverName?: string | null;
  driverPhone?: string | null;
  driverId?: string | null;
};

export type DriverAssignment = {
  id: string;
  orderId?: string;
  truckId?: string | null;
  plate?: string | null;
  site?: string | null;
  status?: string | null;
  scheduledAt?: string | null;
  deliveredAt?: string | null;
  tonnes?: number | null;
  perTruck?: number | null;
  estimatedRevenue?: number | null;
};

export type DriverLeaderboardEntry = {
  driverId: string;
  name?: string | null;
  revenue: number;
  loads?: number;
  tonnes?: number;
};

export type DriverDashboard = {
  driverId?: string;
  driverName?: string | null;
  rank?: number | null;
  profile?: DriverProfile | null;
  summary?: {
    loadsDelivered: number;
    tonnesDelivered: number;
    earningsDelivered: number;
    averageTonnesPerLoad: number;
    weeklyRevenue: number;
    previousWeekRevenue: number;
    trend: number | null;
  };
  assignments?: DriverAssignment[];
  leaderboard?: DriverLeaderboardEntry[];
  telemetry?: DriverTelemetry[];
};

export type TelemetryItem = {
  truckId: string;
  plate?: string | null;
  lat?: number | null;
  lng?: number | null;
  speed?: number | null;
  status?: string | null;
  address?: string | null;
  lastUpdated?: string | null;
  idleMinutes?: number | null;
  driverId?: string | null;
  driverName?: string | null;
  driverPhone?: string | null;
  capacityT?: number | null;
};

export type FuelLog = {
  id: string;
  truckId: string;
  plate?: string;
  litres: number | null;
  odometer: number | null;
  mileage: number | null;
  cost: number | null;
  driverName?: string | null;
  note?: string | null;
  capturedAt: string;
  photoPath?: string | null;
  createdBy?: string | null;
  duplicateOf?: string | null;
  isDuplicate?: boolean;
};

export type FuelFormState = {
  truckId: string;
  litres: string;
  cost: string;
  odometer: string;
  note: string;
  photoData: string;
  photoPreview: string;
};

export type TruckOption = {
  id: string;
  plate?: string | null;
  capacityT?: number | null;
  primaryDriverId?: string | null;
};

export type AdminAssignment = {
  id: string;
  orderId?: string;
  truckId?: string | null;
  driverId?: string | null;
  status?: string | null;
  scheduledAt?: string | null;
  deliveredAt?: string | null;
  tonnes?: number | null;
};

export type AdminOrder = {
  id: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  site: string;
  sandType?: string | null;
  trucks: number;
  perTruck: number;
  total: number;
  distanceKm?: number | null;
  distanceSource?: string | null;
  status: string;
  paymentStatus?: string | null;
  paymentMethod?: string | null;
  paymentReference?: string | null;
  paymentMessage?: string | null;
  dateNeeded?: string | null;
  createdAt: string;
  assignmentsCount?: number;
};

export type MobileReportDefinition = {
  key: string;
  title: string;
  description: string;
  filters?: {
    requiresDateRange?: boolean;
    allowDriverId?: boolean;
    allowTruckId?: boolean;
  };
};

export type WorkspaceSection = {
  key: string;
  label: string;
  description: string;
  roles: string[];
};
export type StockSummary = {
  yardName: string;
  tonnes: number;
  trucksCoarse: number;
  trucksSmooth: number;
  unitTonnes: number;
  updatedAt?: string | null;
};

export type StockTransaction = {
  id: string;
  kind: string;
  tonnes: number;
  trucks: number;
  category: string;
  reason: string;
  orderId?: string | null;
  truckId?: string | null;
  createdAt: string;
};

export type CostRecord = {
  id: string;
  truckId?: string | null;
  driverId?: string | null;
  orderId?: string | null;
  type: string;
  amount: number;
  description: string;
  incurredAt: string;
  duplicateOf?: string | null;
  isDuplicate?: boolean;
};

export type FinanceSummary = {
  revenue: number;
  orders: number;
  costTotal: number;
  costs: { type: string; total: number }[];
  gross: number;
  margin: number;
};

export type FinanceTimeseriesPoint = {
  date: string;
  revenue: number;
  cost: number;
};

export type FinancePnl = {
  month: string;
  start: string;
  end: string;
  revenue: number;
  costs: number;
  profit: number;
  revenueByDay: { date: string; revenue: number }[];
  costByDay: { date: string; cost: number }[];
  costBreakdown: { type: string; amount: number }[];
};

export type FinanceTruckBreakdown = {
  truckId: string;
  plate?: string | null;
  loads: number;
  revenue: number;
};
