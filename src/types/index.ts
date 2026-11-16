export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'DATA_MANAGER' | 'DATA_ANALYST' | 'VIEWER';

export interface User {
  id: number;
  username: string;
  email: string;
  fullName: string;
  role: Role;
  status: string;
  lastLogin?: string;
  createdAt?: string;
}

export interface MissionItem {
  id: number;
  mission: string;
  mission_name?: string;
  missionName?: string;
  location: string;
  created_at?: string;
  createdAt?: string;
}

export interface ColumnMeta {
  name: string;
  type: string;
  notnull: number;
  pk: number;
}

export interface TableResponse<T = any> {
  table: string;
  columns: ColumnMeta[];
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export type FilterOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'greater_than'
  | 'less_than'
  | 'between'
  | 'is_empty'
  | 'is_not_empty'
  | 'before_date'
  | 'after_date';

export interface FilterCondition {
  column: string;
  operator: FilterOperator;
  value: any;
  value2?: any;
}

export interface DashboardFilterState {
  missionIds: number[];
  // Registration Filters
  country: string[];
  countryCode: string[];
  imsi: string;
  imei: string;
  tmsi: string;
  btsName: string;
  bts: string;
  ueModel: string[];
  lastSeenFrom: string;
  lastSeenTo: string;
  btsAltitudeMin: string;
  btsAltitudeMax: string;
  distanceMinFrom: string;
  distanceMinTo: string;
  distanceMaxFrom: string;
  distanceMaxTo: string;
  hasBtsLocation: 'all' | 'available' | 'unavailable';
  btsLocationOutdated: 'all' | 'true' | 'false';
  hasDeviceLocation: 'all' | 'available' | 'unavailable';
  action: string[];
  update: string[];
  // NetworkCell Filters
  rat: string[];
  mcc: number[];
  mnc: number[];
  lac: string;
  cellId: string;
  channel: string;
  bsic: string;
  pci: string;
  rxLevMin: string;
  rxLevMax: string;
  rxLevDbmMin: string;
  rxLevDbmMax: string;
  downlinkMin: string;
  downlinkMax: string;
  dlBandwidthMin: string;
  dlBandwidthMax: string;
  directionMin: string;
  directionMax: string;
  isNeighbour: 'all' | 'true' | 'false';
  isPcs1900: 'all' | 'true' | 'false';
  hasCoordinates: 'all' | 'available' | 'unavailable';
  // PLMN Lookup
  plmnQuery: string;
}

export const INITIAL_DASHBOARD_FILTERS: DashboardFilterState = {
  missionIds: [],
  country: [],
  countryCode: [],
  imsi: '',
  imei: '',
  tmsi: '',
  btsName: '',
  bts: '',
  ueModel: [],
  lastSeenFrom: '',
  lastSeenTo: '',
  btsAltitudeMin: '',
  btsAltitudeMax: '',
  distanceMinFrom: '',
  distanceMinTo: '',
  distanceMaxFrom: '',
  distanceMaxTo: '',
  hasBtsLocation: 'all',
  btsLocationOutdated: 'all',
  hasDeviceLocation: 'all',
  action: [],
  update: [],
  rat: [],
  mcc: [],
  mnc: [],
  lac: '',
  cellId: '',
  channel: '',
  bsic: '',
  pci: '',
  rxLevMin: '',
  rxLevMax: '',
  rxLevDbmMin: '',
  rxLevDbmMax: '',
  downlinkMin: '',
  downlinkMax: stringEmpty(),
  dlBandwidthMin: '',
  dlBandwidthMax: '',
  directionMin: '',
  directionMax: '',
  isNeighbour: 'all',
  isPcs1900: 'all',
  hasCoordinates: 'all',
  plmnQuery: '',
};

function stringEmpty(): string {
  return '';
}

export interface SqliteInspectedTable {
  tableName: string;
  rowCount: number;
  columns: Array<{ name: string; type: string; pk: number; notnull?: number }>;
  preview: any[];
  suggestedDestination?: string;
  suggestedMapping?: Record<string, string>;
  destColumns?: ColumnMeta[];
  dependencyOrder?: number;
}

export interface ImportInspection {
  filePath: string;
  originalName: string;
  size: number;
  type: 'EXCEL' | 'CSV' | 'SQLITE';
  sheets?: Array<{
    sheetName: string;
    rowCount: number;
    columns: string[];
    preview: any[];
  }>;
  tables?: SqliteInspectedTable[];
  columns?: string[];
  preview?: any[];
  totalSampled?: number;
}

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  timestamp: string;
  read: boolean;
}
