import { z } from 'zod';

const optionalNumber = z.preprocess(
  val => (val === '' || val === null || val === undefined ? undefined : Number(val)),
  z.number().finite().optional()
);

const optionalInt = z.preprocess(
  val => (val === '' || val === null || val === undefined ? undefined : Number(val)),
  z.number().int().optional()
);

const stringArray = z.preprocess(
  val => {
    if (Array.isArray(val)) return val.map(String).filter(Boolean);
    if (typeof val === 'string' && val.trim() !== '') {
      return val.split(',').map(s => s.trim()).filter(Boolean);
    }
    return undefined;
  },
  z.array(z.string()).optional()
);

const numberArray = z.preprocess(
  val => {
    if (Array.isArray(val)) return val.map(Number).filter(n => Number.isFinite(n));
    if (typeof val === 'string' && val.trim() !== '' && val !== 'ALL') {
      return val.split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n));
    }
    return undefined;
  },
  z.array(z.number().int()).optional()
);

const triStateEnum = z.enum(['all', 'true', 'false']).optional().default('all');
const availabilityEnum = z.enum(['all', 'available', 'unavailable']).optional().default('all');

export const DashboardFilterSchema = z.object({
  // Mission Scope (authoritative Mission.id list)
  missionIds: numberArray,
  mission: z.string().optional(), // legacy compatibility fallback

  // Registration-only Filters
  country: stringArray,
  countryCode: stringArray,
  imsi: z.string().trim().optional(),
  imei: z.string().trim().optional(),
  tmsi: z.string().trim().optional(),
  btsName: z.string().trim().optional(),
  bts: z.string().trim().optional(),
  ueModel: stringArray,
  lastSeenFrom: z.string().trim().optional(),
  lastSeenTo: z.string().trim().optional(),
  btsAltitudeMin: optionalNumber,
  btsAltitudeMax: optionalNumber,
  distanceMinFrom: optionalNumber,
  distanceMinTo: optionalNumber,
  distanceMaxFrom: optionalNumber,
  distanceMaxTo: optionalNumber,
  hasBtsLocation: availabilityEnum,
  btsLocationOutdated: triStateEnum,
  hasDeviceLocation: availabilityEnum,
  action: stringArray,
  update: stringArray,

  // NetworkCell-only Filters (strictly no timestamp/createdAt filters)
  rat: stringArray,
  mcc: numberArray,
  mnc: numberArray,
  lac: optionalInt,
  cellId: optionalInt,
  channel: optionalInt,
  bsic: optionalInt,
  pci: optionalInt,
  rxLevMin: optionalNumber,
  rxLevMax: optionalNumber,
  rxLevDbmMin: optionalNumber,
  rxLevDbmMax: optionalNumber,
  downlinkMin: optionalNumber,
  downlinkMax: optionalNumber,
  dlBandwidthMin: optionalNumber,
  dlBandwidthMax: optionalNumber,
  directionMin: optionalNumber,
  directionMax: optionalNumber,
  isNeighbour: triStateEnum,
  isPcs1900: triStateEnum,
  hasCoordinates: availabilityEnum,
  hasLatitude: availabilityEnum,
  hasLongitude: availabilityEnum,

  // PLMN Lookup Filter
  plmnQuery: z.string().trim().optional(),
});

export type DashboardFilters = z.infer<typeof DashboardFilterSchema>;

export const MultiSqliteImportTableSchema = z.object({
  sourceTable: z.string().min(1),
  destinationTable: z.string().min(1),
  columnMapping: z.record(z.string(), z.string()),
  conflictMode: z.enum(['skip', 'update', 'replace']).default('skip'),
  matchKey: z.string().optional(),
});

export const MultiSqliteImportRequestSchema = z.object({
  filePath: z.string().min(1),
  originalName: z.string().min(1),
  tables: z.array(MultiSqliteImportTableSchema).min(1),
});

export const DashboardExportScopeSchema = z.object({
  kpis: z.boolean().default(true),
  appliedFilters: z.boolean().default(true),
  registrationsByCountry: z.boolean().default(true),
  btsMap: z.boolean().default(true),
  networkCellsByMcc: z.boolean().default(true),
  militaryNetworks: z.boolean().default(true),
  civilianNetworks: z.boolean().default(true),
  includeDetailedRecords: z.boolean().default(false),
  includeSensitiveIdentifiers: z.boolean().default(false),
});

export const DashboardExportRequestSchema = z.object({
  format: z.enum(['pdf', 'xlsx', 'docx']),
  language: z.enum(['en', 'ar']).default('en'),
  filters: DashboardFilterSchema.optional().default({
    hasBtsLocation: 'all',
    btsLocationOutdated: 'all',
    hasDeviceLocation: 'all',
    isNeighbour: 'all',
    isPcs1900: 'all',
    hasCoordinates: 'all',
    hasLatitude: 'all',
    hasLongitude: 'all',
  }),
  scope: DashboardExportScopeSchema.optional().default({
    kpis: true,
    appliedFilters: true,
    registrationsByCountry: true,
    btsMap: true,
    networkCellsByMcc: true,
    militaryNetworks: true,
    civilianNetworks: true,
    includeDetailedRecords: false,
    includeSensitiveIdentifiers: false,
  }),
  chartImages: z.record(z.string(), z.string()).optional(),
});
