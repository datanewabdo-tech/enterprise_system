
import { z } from 'zod';

/**
 * Optional numeric value.
 * Converts form values to numbers and treats empty values as undefined.
 */
const optionalNumber = z.preprocess(
  val =>
    val === '' || val === null || val === undefined
      ? undefined
      : Number(val),
  z.number().finite().optional()
);

/**
 * Optional safe integer.
 * Suitable for PostgreSQL Prisma Int fields.
 */
const optionalInt = z.preprocess(
  val =>
    val === '' || val === null || val === undefined
      ? undefined
      : Number(val),
  z.number().int().safe().optional()
);

/**
 * Converts arrays or comma-separated strings into string arrays.
 */
const stringArray = z.preprocess(
  val => {
    if (Array.isArray(val)) {
      const values = val
        .map(String)
        .map(value => value.trim())
        .filter(Boolean);

      return values.length > 0 ? values : undefined;
    }

    if (typeof val === 'string' && val.trim() !== '') {
      const values = val
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);

      return values.length > 0 ? values : undefined;
    }

    return undefined;
  },
  z.array(z.string()).optional()
);

/**
 * Converts arrays or comma-separated strings into safe integer arrays.
 * Invalid and decimal values are excluded.
 */
const numberArray = z.preprocess(
  val => {
    const values =
      Array.isArray(val)
        ? val
        : typeof val === 'string' &&
            val.trim() !== '' &&
            val.trim().toUpperCase() !== 'ALL'
          ? val.split(',')
          : [];

    const numbers = values
      .map(value => {
        if (typeof value === 'string' && value.trim() === '') {
          return NaN;
        }

        return Number(value);
      })
      .filter(value => Number.isSafeInteger(value));

    return numbers.length > 0 ? numbers : undefined;
  },
  z.array(z.number().int().safe()).optional()
);

/**
 * Common filter enums.
 */
const triStateEnum = z
  .enum(['all', 'true', 'false'])
  .optional()
  .default('all');

const availabilityEnum = z
  .enum(['all', 'available', 'unavailable'])
  .optional()
  .default('all');

/**
 * Default values for dashboard filters.
 */
const defaultFiltersObj = {
  hasBtsLocation: 'all' as const,
  btsLocationOutdated: 'all' as const,
  hasDeviceLocation: 'all' as const,
  isNeighbour: 'all' as const,
  isPcs1900: 'all' as const,
  hasCoordinates: 'all' as const,
  hasLatitude: 'all' as const,
  hasLongitude: 'all' as const,
};

/**
 * Dashboard filters.
 *
 * Mission IDs are authoritative.
 * The legacy mission string remains available for backward compatibility.
 */
export const DashboardFilterSchema = z.object({
  // Mission Scope
  missionIds: numberArray,
  mission: z.string().optional(),

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

  // NetworkCell-only Filters
  // No timestamp or createdAt filters.
  rat: stringArray,
  mcc: stringArray,
  mnc: stringArray,
  lac: z.string().trim().optional(),
  cellId: z.string().trim().optional(),
  channel: optionalInt,
  bsic: z.string().trim().optional(),
  psc: z.string().trim().optional(),
  pci: z.string().trim().optional(),
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
  operator: stringArray,
  networkCategory: stringArray,
});

export type DashboardFilters = z.infer<typeof DashboardFilterSchema>;

/**
 * SQLite source table -> PostgreSQL destination table import schema.
 *
 * This schema validates the import request only.
 * Actual database writes must use Prisma/PostgreSQL-compatible operations.
 */
export const MultiSqliteImportTableSchema = z.object({
  sourceTable: z.string().trim().min(1),
  destinationTable: z.string().trim().min(1),
  columnMapping: z.record(z.string(), z.string()),
  conflictMode: z.enum(['skip', 'update', 'replace']).default('skip'),
  matchKey: z.string().trim().optional(),
});

export const MultiSqliteImportRequestSchema = z.object({
  filePath: z.string().trim().min(1),
  originalName: z.string().trim().min(1),
  tables: z.array(MultiSqliteImportTableSchema).min(1),
});

/**
 * Dashboard export scope.
 */
export const DashboardExportScopeSchema = z.object({
  kpis: z.boolean().default(true),
  appliedFilters: z.boolean().default(true),
  registrationsByCountry: z.boolean().default(true),
  btsMap: z.boolean().default(true),
  networkCellsByMcc: z.boolean().default(true),
  militaryNetworks: z.boolean().default(true),
  civilianNetworks: z.boolean().default(true),
  mobileNetworksMccMnc: z.boolean().default(true),
  includeDetailedRecords: z.boolean().default(false),
  includeSensitiveIdentifiers: z.boolean().default(false),
});

/**
 * Dashboard export request.
 */
export const DashboardExportRequestSchema = z.object({
  format: z.enum(['pdf', 'xlsx', 'docx']),

  language: z.enum(['en', 'ar']).default('en'),

  filters: DashboardFilterSchema
    .optional()
    .default(defaultFiltersObj),

  scope: DashboardExportScopeSchema
    .optional()
    .default({
      kpis: true,
      appliedFilters: true,
      registrationsByCountry: true,
      btsMap: true,
      networkCellsByMcc: true,
      militaryNetworks: true,
      civilianNetworks: true,
      mobileNetworksMccMnc: true,
      includeDetailedRecords: false,
      includeSensitiveIdentifiers: false,
    }),

  chartImages: z.record(z.string(), z.string()).optional(),
});

/**
 * Individual chart export request.
 */
export const ChartExportRequestSchema = z.object({
  chartId: z.enum([
    'registrationsByCountry',
    'networkCellsByMcc',
    'militaryNetworks',
    'civilianNetworks',
    'mobileNetworksMccMnc',
    'btsMap',
  ]),

  format: z.enum(['png', 'pdf', 'xlsx', 'csv', 'geojson']),

  language: z.enum(['en', 'ar']).default('en'),

  filters: DashboardFilterSchema
    .optional()
    .default(defaultFiltersObj),

  chartImage: z.string().optional(),
});

/**
 * Inferred TypeScript types.
 */
export type MultiSqliteImportTable = z.infer<
  typeof MultiSqliteImportTableSchema
>;

export type MultiSqliteImportRequest = z.infer<
  typeof MultiSqliteImportRequestSchema
>;

export type DashboardExportScope = z.infer<
  typeof DashboardExportScopeSchema
>;

export type DashboardExportRequest = z.infer<
  typeof DashboardExportRequestSchema
>;

export type ChartExportRequest = z.infer<
  typeof ChartExportRequestSchema
>;
