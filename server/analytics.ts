import { Prisma, PrismaClient } from '@prisma/client';
import { db } from './db.js';
import { DashboardFilters } from './validators.js';
import { MCC_COUNTRIES } from './mcc-countries.js';

/**
 * PostgreSQL / Prisma dashboard analytics.
 *
 * All exported database-backed functions are asynchronous.
 * The database argument supports both PrismaClient and transaction clients.
 */

type Db = PrismaClient | Prisma.TransactionClient;
type Params = any[];

export interface ParsedPoint {
  lat: number;
  lng: number;
}

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

async function rows<T = any>(
  targetDb: Db,
  sql: string,
  params: Params = [],
): Promise<T[]> {
  return targetDb.$queryRawUnsafe<T[]>(sql, ...params);
}

async function first<T = any>(
  targetDb: Db,
  sql: string,
  params: Params = [],
): Promise<T | undefined> {
  const result = await rows<T>(targetDb, sql, params);
  return result[0];
}

async function scalar(
  targetDb: Db,
  sql: string,
  params: Params = [],
): Promise<number> {
  const result = await first<any>(targetDb, sql, params);
  return Number(result?.val ?? 0);
}

function add(
  clauses: string[],
  params: Params,
  sql: string,
  values: Params = [],
): void {
  const start = params.length;
  clauses.push(
    sql.replace(/\$(\d+)/g, (_match, number) => `$${Number(number) + start}`),
  );
  params.push(...values);
}

function inClause(
  column: string,
  values: unknown[],
  params: Params,
  transform?: (value: any) => any,
): string {
  if (!values.length) return 'FALSE';

  const placeholders = values.map((value) => {
    params.push(transform ? transform(value) : value);
    return `$${params.length}`;
  });

  return `${column} IN (${placeholders.join(', ')})`;
}

function stripLeadingZeros(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.replace(/^0+(?=\d)/, '') : '';
}

function uniqueStrings(values: Iterable<unknown>): string[] {
  return [...new Set(
    [...values]
      .map((value) => String(value ?? '').trim())
      .filter(Boolean),
  )];
}

function safeNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function isValidCoord(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    !(lat === 0 && lng === 0) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/**
 * Parse BTS coordinates without silently swapping latitude and longitude.
 *
 * Supported formats:
 * - Latitude and longitude on separate lines.
 * - Multiple newline-separated coordinate pairs.
 * - Latitude,longitude pairs separated by commas.
 * - WKT POINT(longitude latitude).
 * - Pipe, semicolon, slash, or whitespace-separated numeric pairs.
 */
export function parseBtsLocationString(
  raw: string | null | undefined,
): { points: ParsedPoint[]; invalidCount: number } {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { points: [], invalidCount: 0 };
  }

  const points: ParsedPoint[] = [];
  let invalidCount = 0;

  const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
  const lines = raw
    .trim()
    .split(/[\r\n|]+/)
    .map((value) => value.trim())
    .filter(Boolean);

  // Common source format: latitude on one line, longitude on the next.
  if (lines.length >= 2 && lines.every((value) => numeric.test(value))) {
    for (let index = 0; index < lines.length; index += 2) {
      if (index + 1 >= lines.length) {
        invalidCount++;
        continue;
      }

      const lat = Number(lines[index]);
      const lng = Number(lines[index + 1]);

      if (isValidCoord(lat, lng)) {
        points.push({ lat, lng });
      } else {
        invalidCount++;
      }
    }

    return { points, invalidCount };
  }

  for (const line of lines) {
    const wkt = line.match(
      /POINT\s*\(\s*([+-]?[\d.]+)\s+([+-]?[\d.]+)\s*\)/i,
    );

    if (wkt) {
      // WKT order is longitude, latitude.
      const lng = Number(wkt[1]);
      const lat = Number(wkt[2]);

      if (isValidCoord(lat, lng)) {
        points.push({ lat, lng });
      } else {
        invalidCount++;
      }

      continue;
    }

    const tokens = line
      .split(/[;,/\s]+/)
      .map((value) => value.trim())
      .filter(Boolean);

    if (
      tokens.length >= 2 &&
      tokens.length % 2 === 0 &&
      tokens.every((value) => numeric.test(value))
    ) {
      for (let index = 0; index < tokens.length; index += 2) {
        const lat = Number(tokens[index]);
        const lng = Number(tokens[index + 1]);

        if (isValidCoord(lat, lng)) {
          points.push({ lat, lng });
        } else {
          invalidCount++;
        }
      }
    } else if (
      tokens.length >= 2 &&
      numeric.test(tokens[0]) &&
      numeric.test(tokens[1])
    ) {
      const lat = Number(tokens[0]);
      const lng = Number(tokens[1]);

      if (isValidCoord(lat, lng)) {
        points.push({ lat, lng });
      } else {
        invalidCount++;
      }
    } else {
      invalidCount++;
    }
  }

  return { points, invalidCount };
}

// -----------------------------------------------------------------------------
// Operator mappings
// -----------------------------------------------------------------------------

const MILITARY = [
  {
    mcc: '602',
    mnc: '10',
    operator: 'الناقل العسكري المصري',
    country: 'Egypt',
    color: '#3498DB',
  },
  {
    mcc: '602',
    mnc: '11',
    operator: 'الناقل العسكري المصري',
    country: 'Egypt',
    color: '#3498DB',
  },
  {
    mcc: '425',
    mnc: '25',
    operator: 'الناقل العسكري الإسرائيلي',
    country: 'Israel',
    color: '#27AE60',
  },
];

const CIVILIAN = [
  { mcc: '425', mnc: '1', country: 'Israel', operator: 'Partner', color: '#2980B9' },
  { mcc: '425', mnc: '2', country: 'Israel', operator: 'Cellcom', color: '#2980B9' },
  { mcc: '425', mnc: '3', country: 'Israel', operator: 'Pelephone', color: '#2980B9' },
  { mcc: '425', mnc: '7', country: 'Israel', operator: 'Hot Mobile', color: '#2980B9' },
  { mcc: '425', mnc: '9', country: 'Israel', operator: 'We4G', color: '#2980B9' },
  { mcc: '425', mnc: '28', country: 'Israel', operator: 'PHI Networks', color: '#2980B9' },
  { mcc: '425', mnc: '29', country: 'Israel', operator: 'CG Networks', color: '#2980B9' },
  { mcc: '425', mnc: '5', country: 'Palestine', operator: 'Jawwal', color: '#27AE60' },
  { mcc: '425', mnc: '6', country: 'Palestine', operator: 'Wataniya', color: '#27AE60' },
  {
    mcc: '424',
    mnc: '2',
    country: 'United Arab Emirates',
    operator: 'Etisalat UAE (e&)',
    color: '#E67E22',
  },
];

const EGYPT = [
  { mcc: '602', mnc: '1', country: 'Egypt', operator: 'Orange Egypt', color: '#8E44AD' },
  { mcc: '602', mnc: '2', country: 'Egypt', operator: 'Vodafone Egypt', color: '#8E44AD' },
  { mcc: '602', mnc: '3', country: 'Egypt', operator: 'Etisalat Egypt (e&)', color: '#8E44AD' },
  { mcc: '602', mnc: '4', country: 'Egypt', operator: 'WE (Telecom Egypt)', color: '#8E44AD' },
];

// -----------------------------------------------------------------------------
// Mission filtering
// -----------------------------------------------------------------------------

/**
 * Resolve mission filtering using the authoritative mission IDs.
 *
 * A textual label may match multiple missions because mission labels are not
 * unique. Legacy records that only contain the mission label are also included.
 */
async function resolveMissionWhere(
  filters: Partial<DashboardFilters>,
  targetDb: Db,
): Promise<{ sql: string | null; params: Params }> {
  if (filters.missionIds?.length) {
    const params: Params = [];

    return {
      sql: inClause('mission_id', filters.missionIds, params),
      params,
    };
  }

  if (filters.mission && filters.mission !== 'ALL') {
    const missionValue = String(filters.mission);
    const numericMission = Number(missionValue);

    if (Number.isInteger(numericMission) && numericMission > 0) {
      return {
        sql: 'mission_id = $1',
        params: [numericMission],
      };
    }

    const matches = await rows<{ id: number }>(
      targetDb,
      'SELECT id FROM missions WHERE mission = $1 ORDER BY id',
      [missionValue],
    );

    const params: Params = [];
    const idCondition = matches.length
      ? inClause('mission_id', matches.map((item) => item.id), params)
      : 'FALSE';

    params.push(missionValue);

    return {
      sql: `(${idCondition} OR mission = $${params.length})`,
      params,
    };
  }

  return { sql: null, params: [] };
}

function appendFilter(
  clauses: string[],
  params: Params,
  sql: string,
  value?: unknown,
): void {
  params.push(value);
  clauses.push(sql.replace('?', `$${params.length}`));
}

async function buildWhere(
  filters: Partial<DashboardFilters>,
  targetDb: Db,
  kind: 'registrations' | 'network_cells',
) {
  const clauses: string[] = [];
  const params: Params = [];

  const mission = await resolveMissionWhere(filters, targetDb);

  if (mission.sql) {
    add(clauses, params, mission.sql, mission.params);
  }

  const f: any = filters;

  if (kind === 'registrations') {
    if (f.country?.length) {
      clauses.push(inClause('country', f.country, params));
    }

    if (f.countryCode?.length) {
      clauses.push(
        inClause(
          'UPPER(country_code)',
          f.countryCode,
          params,
          (value) => String(value).toUpperCase(),
        ),
      );
    }

    for (const [key, column] of [
      ['imsi', 'imsi'],
      ['imei', 'imei'],
      ['tmsi', 'tmsi'],
      ['btsName', 'bts_name'],
      ['bts', 'bts'],
    ] as const) {
      if (f[key]) {
        appendFilter(
          clauses,
          params,
          `${column} ILIKE ?`,
          `%${f[key]}%`,
        );
      }
    }

    if (f.ueModel?.length) {
      clauses.push(inClause('ue_model', f.ueModel, params));
    }

    if (f.lastSeenFrom) {
      appendFilter(
        clauses,
        params,
        'last_seen >= ?::text::timestamptz',
        f.lastSeenFrom,
      );
    }

    if (f.lastSeenTo) {
      appendFilter(
        clauses,
        params,
        'last_seen <= ?::text::timestamptz',
        f.lastSeenTo.length === 10
          ? `${f.lastSeenTo}T23:59:59.999Z`
          : f.lastSeenTo,
      );
    }

    for (const [key, column, operator] of [
      ['btsAltitudeMin', 'bts_altitude', '>='],
      ['btsAltitudeMax', 'bts_altitude', '<='],
      ['distanceMinFrom', 'distance_min', '>='],
      ['distanceMinTo', 'distance_min', '<='],
      ['distanceMaxFrom', 'distance_max', '>='],
      ['distanceMaxTo', 'distance_max', '<='],
    ] as const) {
      if (f[key] !== undefined) {
        appendFilter(
          clauses,
          params,
          `${column} ${operator} ?`,
          f[key],
        );
      }
    }

    if (f.hasBtsLocation === 'available') {
      clauses.push(`NULLIF(BTRIM(bts_location), '') IS NOT NULL`);
    }

    if (f.hasBtsLocation === 'unavailable') {
      clauses.push(`NULLIF(BTRIM(bts_location), '') IS NULL`);
    }

    if (f.btsLocationOutdated === 'true') {
      clauses.push('bts_location_outdated IS TRUE');
    }

    if (f.btsLocationOutdated === 'false') {
      clauses.push(
        '(bts_location_outdated IS FALSE OR bts_location_outdated IS NULL)',
      );
    }

    if (f.hasDeviceLocation === 'available') {
      clauses.push(`NULLIF(BTRIM(device_location), '') IS NOT NULL`);
    }

    if (f.hasDeviceLocation === 'unavailable') {
      clauses.push(`NULLIF(BTRIM(device_location), '') IS NULL`);
    }

    if (f.action?.length) {
      clauses.push(inClause('action', f.action, params));
    }

    if (f.update?.length) {
      clauses.push(inClause('"update"', f.update, params));
    }
  } else {
    if (f.rat?.length) {
      clauses.push(inClause('rat', f.rat.map(String), params));
    }

    if (f.mcc?.length) {
      clauses.push(
        inClause('BTRIM(mcc)', f.mcc.map((value: any) => String(value).trim()), params),
      );
    }

    if (f.mnc?.length) {
      clauses.push(
        inClause('BTRIM(mnc)', f.mnc.map((value: any) => String(value).trim()), params),
      );
    }

    for (const [key, column] of [
      ['lac', 'lac'],
      ['cellId', 'cell_id'],
      ['bsic', 'bsic'],
      ['psc', 'psc'],
      ['pci', 'pci'],
    ] as const) {
      if (f[key] !== undefined && f[key] !== '') {
        appendFilter(
          clauses,
          params,
          `BTRIM(${column}) = ?`,
          String(f[key]).trim(),
        );
      }
    }

    for (const [key, column, operator] of [
      ['channel', 'channel', '='],
      ['rxLevMin', 'rx_lev', '>='],
      ['rxLevMax', 'rx_lev', '<='],
      ['rxLevDbmMin', 'rx_lev_dbm', '>='],
      ['rxLevDbmMax', 'rx_lev_dbm', '<='],
      ['downlinkMin', 'downlink', '>='],
      ['downlinkMax', 'downlink', '<='],
      ['dlBandwidthMin', 'dl_bandwidth', '>='],
      ['dlBandwidthMax', 'dl_bandwidth', '<='],
      ['directionMin', 'direction', '>='],
      ['directionMax', 'direction', '<='],
    ] as const) {
      if (f[key] !== undefined) {
        appendFilter(
          clauses,
          params,
          `${column} ${operator} ?`,
          f[key],
        );
      }
    }

    if (f.isNeighbour === 'true') {
      clauses.push('is_neighbour IS TRUE');
    }

    if (f.isNeighbour === 'false') {
      clauses.push('(is_neighbour IS FALSE OR is_neighbour IS NULL)');
    }

    if (f.isPcs1900 === 'true') {
      clauses.push('is_pcs1900 IS TRUE');
    }

    if (f.isPcs1900 === 'false') {
      clauses.push('(is_pcs1900 IS FALSE OR is_pcs1900 IS NULL)');
    }

    if (f.hasCoordinates === 'available') {
      clauses.push(`
        latitude IS NOT NULL
        AND longitude IS NOT NULL
        AND latitude BETWEEN -90 AND 90
        AND longitude BETWEEN -180 AND 180
        AND NOT (latitude = 0 AND longitude = 0)
      `);
    } else if (f.hasCoordinates === 'unavailable') {
      clauses.push('(latitude IS NULL OR longitude IS NULL)');
    } else {
      if (f.hasLatitude === 'available') {
        clauses.push('latitude IS NOT NULL');
      }

      if (f.hasLatitude === 'unavailable') {
        clauses.push('latitude IS NULL');
      }

      if (f.hasLongitude === 'available') {
        clauses.push('longitude IS NOT NULL');
      }

      if (f.hasLongitude === 'unavailable') {
        clauses.push('longitude IS NULL');
      }
    }

    if (f.plmnQuery) {
      const term = `%${f.plmnQuery}%`;

      const plmns = await rows<any>(
        targetDb,
        `
          SELECT mcc, mnc
          FROM plmn_storage
          WHERE name ILIKE $1
             OR country ILIKE $1
             OR code ILIKE $1
             OR mcc ILIKE $1
             OR mnc ILIKE $1
        `,
        [term],
      );

      if (!plmns.length) {
        clauses.push('FALSE');
      } else {
        const pairs = plmns.map((item: any) => {
          params.push(
            String(item.mcc).trim(),
            String(item.mnc).trim(),
            stripLeadingZeros(item.mcc),
            stripLeadingZeros(item.mnc),
          );

          const index = params.length;

          return `
            (
              BTRIM(mcc) = $${index - 3}
              AND BTRIM(mnc) = $${index - 2}
            )
            OR
            (
              REGEXP_REPLACE(BTRIM(mcc), '^0+', '') = $${index - 1}
              AND REGEXP_REPLACE(BTRIM(mnc), '^0+', '') = $${index}
            )
          `;
        });

        clauses.push(`(${pairs.map((pair) => `(${pair})`).join(' OR ')})`);
      }
    }
  }

  return {
    whereSql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
    clauses,
  };
}

// -----------------------------------------------------------------------------
// Filter builders
// -----------------------------------------------------------------------------

export async function buildRegistrationWhere(
  filters: Partial<DashboardFilters> = {},
  targetDb: Db = db,
) {
  const result = await buildWhere(filters, targetDb, 'registrations');

  return {
    whereSql: result.whereSql,
    params: result.params,
  };
}

export async function buildNetworkCellWhere(
  filters: Partial<DashboardFilters> = {},
  targetDb: Db = db,
) {
  return buildWhere(filters, targetDb, 'network_cells');
}

// -----------------------------------------------------------------------------
// Registrations by country
// -----------------------------------------------------------------------------

export async function getRegistrationsByCountry(
  filters: Partial<DashboardFilters> = {},
  targetDb: Db = db,
) {
  const where = await buildRegistrationWhere(filters, targetDb);

  const conditions = [
    where.whereSql.replace(/^WHERE\s+/i, ''),
    `country IS NOT NULL AND BTRIM(country) <> ''`,
    `imsi IS NOT NULL AND BTRIM(imsi) NOT IN ('', '0')`,
    `UPPER(BTRIM(country)) NOT IN ('EG', 'EGY', 'EGYPT')`,
    `(country_code IS NULL OR UPPER(BTRIM(country_code)) NOT IN ('EG', 'EGY'))`,
  ].filter(Boolean);

  const data = await rows<any>(
    targetDb,
    `
      SELECT
        BTRIM(country) AS country,
        COUNT(DISTINCT imsi)::bigint AS "distinctImsiCount",
        COUNT(*)::bigint AS "totalRecords"
      FROM registrations
      WHERE ${conditions.join(' AND ')}
      GROUP BY BTRIM(country)
      ORDER BY
        COUNT(DISTINCT imsi) DESC,
        COUNT(*) DESC,
        country ASC
    `,
    where.params,
  );

  const total = data.reduce(
    (sum, item) => sum + safeNumber(item.distinctImsiCount),
    0,
  );

  return {
    titleAr: 'أعداد شرائح الاتصال المرصودة لكل دولة',
    titleEn: 'Observed SIM Registrations by Country (Distinct IMSI, Excl. Egypt)',
    totalDistinctImsis: total,
    items: data.map((item, index) => ({
      rank: index + 1,
      country: item.country,
      distinctImsiCount: safeNumber(item.distinctImsiCount),
      totalRecords: safeNumber(item.totalRecords),
      percentageShare: total
        ? Number((safeNumber(item.distinctImsiCount) / total * 100).toFixed(2))
        : 0,
      color: index < 3 ? '#00B894' : '#3977C3',
    })),
  };
}

// -----------------------------------------------------------------------------
// BTS and network-cell map
// -----------------------------------------------------------------------------

export async function getBtsMapData(
  filters: Partial<DashboardFilters> = {},
  targetDb: Db = db,
) {
  const registrationWhere = await buildRegistrationWhere(filters, targetDb);

  const counts = await first<any>(
    targetDb,
    `
      SELECT
        COUNT(*)::bigint AS total,
        COUNT(*) FILTER (
          WHERE NULLIF(BTRIM(bts_location), '') IS NOT NULL
        )::bigint AS with_location
      FROM registrations
      ${registrationWhere.whereSql}
    `,
    registrationWhere.params,
  );

  const registrationSql = registrationWhere.whereSql
    ? `${registrationWhere.whereSql} AND NULLIF(BTRIM(bts_location), '') IS NOT NULL`
    : `WHERE NULLIF(BTRIM(bts_location), '') IS NOT NULL`;

  const registrations = await rows<any>(
    targetDb,
    `
      SELECT
        id,
        mission_id,
        mission,
        bts,
        bts_name,
        country,
        country_code,
        mcc,
        mnc,
        bts_location
      FROM registrations
      ${registrationSql}
      ORDER BY id
    `,
    registrationWhere.params,
  );

  const networkWhere = await buildNetworkCellWhere(filters, targetDb);

  const networkSql = networkWhere.whereSql
    ? `${networkWhere.whereSql} AND latitude IS NOT NULL AND longitude IS NOT NULL`
    : 'WHERE latitude IS NOT NULL AND longitude IS NOT NULL';

  const cells = await rows<any>(
    targetDb,
    `
      SELECT
        id,
        mission_id,
        mission,
        mcc,
        mnc,
        lac,
        cell_id,
        rat,
        rx_lev_dbm,
        latitude,
        longitude,
        direction
      FROM network_cells
      ${networkSql}
      ORDER BY id
      LIMIT 50000
    `,
    networkWhere.params,
  );

  type Bucket = {
    key: string;
    lat: number;
    lng: number;
    sources: Set<string>;
    registrationCount: number;
    networkCellCount: number;
    btsNames: Set<string>;
    btsCodes: Set<string>;
    countries: Set<string>;
    rats: Set<string>;
    mccs: Set<string>;
    mncs: Set<string>;
    cellIds: Set<string>;
    missions: Set<string>;
    countryCodes: Set<string>;
    registrationIds: Set<number>;
  };

  const map = new Map<string, Bucket>();

  const getBucket = (lat: number, lng: number): Bucket => {
    const key = `${lat.toFixed(6)},${lng.toFixed(6)}`;

    let bucket = map.get(key);

    if (!bucket) {
      bucket = {
        key,
        lat,
        lng,
        sources: new Set(),
        registrationCount: 0,
        networkCellCount: 0,
        btsNames: new Set(),
        btsCodes: new Set(),
        countries: new Set(),
        rats: new Set(),
        mccs: new Set(),
        mncs: new Set(),
        cellIds: new Set(),
        missions: new Set(),
        countryCodes: new Set(),
        registrationIds: new Set(),
      };

      map.set(key, bucket);
    }

    return bucket;
  };

  let parsed = 0;
  let invalidRegistration = 0;
  let invalidSkipped = 0;

  for (const registration of registrations) {
    const parsedLocation = parseBtsLocationString(registration.bts_location);

    invalidRegistration += parsedLocation.invalidCount;
    invalidSkipped += parsedLocation.invalidCount;

    for (const point of parsedLocation.points) {
      parsed++;

      const bucket = getBucket(point.lat, point.lng);

      bucket.sources.add('registration');
      bucket.registrationCount++;
      bucket.registrationIds.add(Number(registration.id));

      if (registration.bts_name) bucket.btsNames.add(String(registration.bts_name));
      if (registration.bts) bucket.btsCodes.add(String(registration.bts));
      if (registration.country) bucket.countries.add(String(registration.country));
      if (registration.country_code) bucket.countryCodes.add(String(registration.country_code));
      if (registration.mcc) bucket.mccs.add(String(registration.mcc).trim());
      if (registration.mnc) bucket.mncs.add(String(registration.mnc).trim());

      if (registration.mission) {
        bucket.missions.add(String(registration.mission));
      }
    }
  }

  for (const cell of cells) {
    const lat = Number(cell.latitude);
    const lng = Number(cell.longitude);

    if (!isValidCoord(lat, lng)) {
      invalidSkipped++;
      continue;
    }

    const bucket = getBucket(lat, lng);

    bucket.sources.add('network_cell');
    bucket.networkCellCount++;

    if (cell.rat) bucket.rats.add(String(cell.rat));
    if (cell.mcc) bucket.mccs.add(String(cell.mcc).trim());
    if (cell.mnc) bucket.mncs.add(String(cell.mnc).trim());
    if (cell.cell_id) bucket.cellIds.add(String(cell.cell_id).trim());
    if (cell.mission) bucket.missions.add(String(cell.mission));
  }

  const locations = [...map.values()].map((bucket) => ({
    key: bucket.key,
    lat: bucket.lat,
    lng: bucket.lng,
    source: bucket.sources.size > 1
      ? 'both'
      : [...bucket.sources][0],
    registrationCount: bucket.registrationCount,
    networkCellCount: bucket.networkCellCount,
    totalCount: bucket.registrationCount + bucket.networkCellCount,
    btsNames: [...bucket.btsNames],
    btsCodes: [...bucket.btsCodes],
    countries: [...bucket.countries],
    countryCodes: [...bucket.countryCodes],
    rats: [...bucket.rats],
    mccs: [...bucket.mccs],
    mncs: [...bucket.mncs],
    cellIds: [...bucket.cellIds].slice(0, 20),
    missions: [...bucket.missions],
    registrationIds: [...bucket.registrationIds].sort((a, b) => a - b),
  }));

  return {
    locations,
    stats: {
      totalRegistrationRecords: safeNumber(counts?.total),
      registrationRecordsWithLocation: safeNumber(counts?.with_location),
      totalParsedRegistrationCoords: parsed,
      invalidRegistrationCoords: invalidRegistration,
      uniqueLocations: locations.length,
      registrationLocationsCount: locations.filter(
        (item) => item.source === 'registration' || item.source === 'both',
      ).length,
      networkCellLocationsCount: locations.filter(
        (item) => item.source === 'network_cell' || item.source === 'both',
      ).length,
      invalidSkippedCount: invalidSkipped,
    },
  };
}

// -----------------------------------------------------------------------------
// Network cells grouped by MCC
// -----------------------------------------------------------------------------

export async function getNetworkCellsByMcc(
  filters: Partial<DashboardFilters> = {},
  targetDb: Db = db,
) {
  const where = await buildNetworkCellWhere(filters, targetDb);

  const conditions = [
    where.whereSql.replace(/^WHERE\s+/i, ''),
    `mcc IS NOT NULL AND BTRIM(mcc) <> ''`,
    `cell_id IS NOT NULL AND BTRIM(cell_id) <> ''`,
  ].filter(Boolean);

  const data = await rows<any>(
    targetDb,
    `
      SELECT
        BTRIM(mcc) AS mcc,
        COUNT(DISTINCT BTRIM(cell_id))::bigint AS "distinctCellCount",
        COUNT(*)::bigint AS "totalRecords"
      FROM network_cells
      WHERE ${conditions.join(' AND ')}
      GROUP BY BTRIM(mcc)
      ORDER BY
        COUNT(DISTINCT BTRIM(cell_id)) DESC,
        COUNT(*) DESC,
        mcc
    `,
    where.params,
  );

  const total = data.reduce(
    (sum, item) => sum + safeNumber(item.distinctCellCount),
    0,
  );

  const palette = [
    '#1D4ED8',
    '#2563EB',
    '#3B82F6',
    '#0284C7',
    '#0EA5E9',
    '#38BDF8',
    '#60A5FA',
  ];

  return {
    titleAr: 'إجمالي الخلايا المرصودة لكل دولة',
    titleEn: 'Total Observed Network Cells by Country (MCC)',
    totalDistinctCells: total,
    items: data.map((item, index) => {
      const mcc = String(item.mcc).trim();
      const country =
        MCC_COUNTRIES[mcc] ||
        MCC_COUNTRIES[stripLeadingZeros(mcc)] ||
        `MCC ${mcc}`;

      return {
        rank: index + 1,
        mcc,
        country,
        label: `${country} (${mcc})`,
        distinctCellCount: safeNumber(item.distinctCellCount),
        totalRecords: safeNumber(item.totalRecords),
        percentageShare: total
          ? Number((safeNumber(item.distinctCellCount) / total * 100).toFixed(2))
          : 0,
        color: palette[Math.min(index, palette.length - 1)],
      };
    }),
  };
}

// -----------------------------------------------------------------------------
// MCC/MNC pair analytics
// -----------------------------------------------------------------------------

async function getNetworkPairRows(
  filters: Partial<DashboardFilters>,
  targetDb: Db,
) {
  const where = await buildNetworkCellWhere(filters, targetDb);

  const conditions = [
    where.whereSql.replace(/^WHERE\s+/i, ''),
    `mcc IS NOT NULL AND BTRIM(mcc) <> ''`,
    `mnc IS NOT NULL AND BTRIM(mnc) <> ''`,
  ].filter(Boolean);

  return rows<any>(
    targetDb,
    `
      SELECT
        BTRIM(mcc) AS mcc,
        BTRIM(mnc) AS mnc,
        COUNT(DISTINCT NULLIF(BTRIM(cell_id), ''))::bigint AS "distinctCellCount",
        COUNT(*)::bigint AS "totalRecords"
      FROM network_cells
      WHERE ${conditions.join(' AND ')}
      GROUP BY BTRIM(mcc), BTRIM(mnc)
      ORDER BY
        COUNT(DISTINCT NULLIF(BTRIM(cell_id), '')) DESC,
        COUNT(*) DESC,
        mcc,
        mnc
    `,
    where.params,
  );
}

export async function getMilitaryNetworks(
  filters: Partial<DashboardFilters> = {},
  targetDb: Db = db,
) {
  const data = await getNetworkPairRows(filters, targetDb);

  const selected = data.filter((item) => {
    const mcc = stripLeadingZeros(item.mcc);
    const mnc = stripLeadingZeros(item.mnc);

    return (
      (mcc === '602' && ['10', '11'].includes(mnc)) ||
      (mcc === '425' && mnc === '25')
    );
  });

  const items = selected.map((item, index) => {
    const spec = MILITARY.find(
      (entry) =>
        entry.mcc === stripLeadingZeros(item.mcc) &&
        entry.mnc === stripLeadingZeros(item.mnc),
    )!;

    return {
      rank: index + 1,
      mcc: item.mcc,
      mnc: item.mnc,
      plmn: `${item.mcc}-${item.mnc}`,
      operator: spec.operator,
      country: spec.country,
      label: `${spec.operator} (${item.mcc}/${item.mnc})`,
      distinctCellCount: safeNumber(item.distinctCellCount),
      totalRecords: safeNumber(item.totalRecords),
      color: spec.color,
    };
  });

  return {
    titleAr: 'شبكات الاتصالات بالهواتف المحمولة العسكرية',
    titleEn: 'Military Mobile Networks',
    totalDistinctCells: items.reduce((sum, item) => sum + item.distinctCellCount, 0),
    totalRecords: items.reduce((sum, item) => sum + item.totalRecords, 0),
    items,
  };
}

export async function getCivilianNetworks(
  filters: Partial<DashboardFilters> = {},
  targetDb: Db = db,
) {
  const data = await getNetworkPairRows(filters, targetDb);

  const mapped = data.flatMap((item) => {
    const spec = CIVILIAN.find(
      (entry) =>
        entry.mcc === stripLeadingZeros(item.mcc) &&
        entry.mnc === stripLeadingZeros(item.mnc),
    );

    return spec
      ? [{
          mcc: item.mcc,
          mnc: item.mnc,
          plmn: `${item.mcc}/${item.mnc}`,
          country: spec.country,
          operator: spec.operator,
          distinctCellCount: safeNumber(item.distinctCellCount),
          totalRecords: safeNumber(item.totalRecords),
          color: spec.color,
        }]
      : [];
  });

  const order: Record<string, number> = {
    Israel: 1,
    Palestine: 2,
    'United Arab Emirates': 3,
  };

  mapped.sort(
    (a, b) =>
      (order[a.country] || 99) - (order[b.country] || 99) ||
      b.distinctCellCount - a.distinctCellCount ||
      b.totalRecords - a.totalRecords,
  );

  const ranks = new Map<string, number>();

  const items = mapped.map((item) => {
    const rank = (ranks.get(item.country) || 0) + 1;
    ranks.set(item.country, rank);

    return {
      ...item,
      rank,
      label: `${item.operator} (${item.plmn})`,
    };
  });

  return {
    titleAr: 'شبكات اتصالات الهواتف المحمولة المدنية',
    titleEn: 'Civilian Mobile Networks',
    totalDistinctCells: items.reduce((sum, item) => sum + item.distinctCellCount, 0),
    totalRecords: items.reduce((sum, item) => sum + item.totalRecords, 0),
    items,
  };
}

/**
 * Unified mobile-network chart.
 *
 * The supplied Prisma schema does not define an editable operator-mapping
 * table. Therefore, this implementation uses the static mappings above.
 */
export async function getMobileNetworks(
  filters: Partial<DashboardFilters> = {},
  targetDb: Db = db,
) {
  const data = await getNetworkPairRows(filters, targetDb);

  const palette = ['#64748B', '#7C8798', '#94A3B8', '#A8B3C4', '#B8C2D0'];
  const identifiedOperators = new Set<string>();

  const items = data.map((item, index) => {
    const mcc = String(item.mcc).trim();
    const mnc = String(item.mnc).trim();

    const normalizedMcc = stripLeadingZeros(mcc);
    const normalizedMnc = stripLeadingZeros(mnc);

    const military = MILITARY.find(
      (entry) => entry.mcc === normalizedMcc && entry.mnc === normalizedMnc,
    );

    const civilian = CIVILIAN.find(
      (entry) => entry.mcc === normalizedMcc && entry.mnc === normalizedMnc,
    );

    const egyptian = EGYPT.find(
      (entry) => entry.mcc === normalizedMcc && entry.mnc === normalizedMnc,
    );

    const known = military || civilian || egyptian;
    const identified = Boolean(known);

    const operator = known?.operator || 'Unknown Operator';

    const country =
      known?.country ||
      MCC_COUNTRIES[mcc] ||
      MCC_COUNTRIES[normalizedMcc] ||
      `MCC ${mcc}`;

    const isMilitary = Boolean(military);

    if (identified) {
      identifiedOperators.add(operator);
    }

    return {
      rank: index + 1,
      mcc,
      mnc,
      plmn: `${mcc}/${mnc}`,
      operator,
      operatorLabel: identified
        ? `${operator} (${mcc}/${mnc})`
        : `Unknown (${mcc}/${mnc})`,
      country,
      networkCategory: isMilitary
        ? 'military'
        : identified
          ? 'civilian'
          : 'unknown',
      isMilitary,
      identified,
      distinctCellCount: safeNumber(item.distinctCellCount),
      totalRecords: safeNumber(item.totalRecords),
      color: isMilitary
        ? '#DC2626'
        : civilian?.color ||
          egyptian?.color ||
          (identified ? '#2563EB' : palette[Math.min(index, palette.length - 1)]),
    };
  });

  return {
    titleAr: 'تحليل شبكات المحمول حسب MCC وMNC',
    titleEn: 'Mobile Networks — MCC/MNC Analysis',
    totalDistinctCells: items.reduce((sum, item) => sum + item.distinctCellCount, 0),
    totalRecords: items.reduce((sum, item) => sum + item.totalRecords, 0),
    totalMccGroups: new Set(items.map((item) => item.mcc)).size,
    totalMccMncCombinations: items.length,
    totalIdentifiedOperators: identifiedOperators.size,
    items,
  };
}

// -----------------------------------------------------------------------------
// Data quality statistics
// -----------------------------------------------------------------------------

export async function getDashboardQualityStats(
  filters: Partial<DashboardFilters> = {},
  targetDb: Db = db,
) {
  const registrationWhere = await buildRegistrationWhere(filters, targetDb);
  const mission = await resolveMissionWhere(filters, targetDb);

  const registrationAnd = (condition: string) =>
    `${registrationWhere.whereSql ? `${registrationWhere.whereSql} AND` : 'WHERE'} ${condition}`;

  const missionWhere = mission.sql ? `WHERE ${mission.sql}` : '';

  const totalRegistrations = await scalar(
    targetDb,
    `SELECT COUNT(*)::bigint AS val FROM registrations ${registrationWhere.whereSql}`,
    registrationWhere.params,
  );

  const gps = await scalar(
    targetDb,
    `SELECT COUNT(*)::bigint AS val FROM gps_history ${missionWhere}`,
    mission.params,
  );

  const missingRegistrationId = await scalar(
    targetDb,
    `
      SELECT COUNT(*)::bigint AS val
      FROM registrations
      ${registrationAnd(`(reg_id IS NULL OR BTRIM(reg_id) = '')`)}
    `,
    registrationWhere.params,
  );

  const missingImsi = await scalar(
    targetDb,
    `
      SELECT COUNT(*)::bigint AS val
      FROM registrations
      ${registrationAnd(`(imsi IS NULL OR BTRIM(imsi) = '')`)}
    `,
    registrationWhere.params,
  );

  const invalidGps = await scalar(
    targetDb,
    `
      SELECT COUNT(*)::bigint AS val
      FROM gps_history
      ${mission.sql ? `WHERE ${mission.sql} AND` : 'WHERE'}
      (
        latitude < -90 OR latitude > 90
        OR longitude < -180 OR longitude > 180
      )
    `,
    mission.params,
  );

  const ambiguities = await scalar(
    targetDb,
    `
      SELECT COUNT(*)::bigint AS val
      FROM migration_ambiguities
      WHERE status = 'PENDING'
    `,
  );

  return {
    totalChecked: totalRegistrations + gps,
    validRecords: Math.max(
      0,
      totalRegistrations + gps - missingRegistrationId - missingImsi - invalidGps,
    ),
    issuesFound: missingRegistrationId + missingImsi + invalidGps + ambiguities,
    pendingAmbiguities: ambiguities,
    breakdown: [
      {
        issue: 'Missing Device Identifier (IMSI/RegID)',
        count: missingRegistrationId + missingImsi,
      },
      {
        issue: 'Out-of-bound GPS Coordinates',
        count: invalidGps,
      },
      {
        issue: 'Ambiguous Mission Links Pending Review',
        count: ambiguities,
      },
    ],
  };
}

// -----------------------------------------------------------------------------
// Dashboard KPIs
// -----------------------------------------------------------------------------

export async function getDashboardKpiSummary(
  filters: Partial<DashboardFilters> = {},
  targetDb: Db = db,
) {
  const registrationWhere = await buildRegistrationWhere(filters, targetDb);
  const networkWhere = await buildNetworkCellWhere(filters, targetDb);
  const mission = await resolveMissionWhere(filters, targetDb);

  const registrationAnd = (condition: string) =>
    `${registrationWhere.whereSql ? `${registrationWhere.whereSql} AND` : 'WHERE'} ${condition}`;

  const networkAnd = (condition: string) =>
    `${networkWhere.whereSql ? `${networkWhere.whereSql} AND` : 'WHERE'} ${condition}`;

  const totalRegistrations = await scalar(
    targetDb,
    `SELECT COUNT(*)::bigint AS val FROM registrations ${registrationWhere.whereSql}`,
    registrationWhere.params,
  );

  const distinctImsis = await scalar(
    targetDb,
    `
      SELECT COUNT(DISTINCT imsi)::bigint AS val
      FROM registrations
      ${registrationAnd(`imsi IS NOT NULL AND BTRIM(imsi) NOT IN ('', '0')`)}
    `,
    registrationWhere.params,
  );

  const distinctImeis = await scalar(
    targetDb,
    `
      SELECT COUNT(DISTINCT imei)::bigint AS val
      FROM registrations
      ${registrationAnd(`imei IS NOT NULL AND BTRIM(imei) NOT IN ('', '0')`)}
    `,
    registrationWhere.params,
  );

  const countriesRepresented = await scalar(
    targetDb,
    `
      SELECT COUNT(DISTINCT BTRIM(country))::bigint AS val
      FROM registrations
      ${registrationAnd(`country IS NOT NULL AND BTRIM(country) <> ''`)}
    `,
    registrationWhere.params,
  );

  const totalNetworkCells = await scalar(
    targetDb,
    `SELECT COUNT(*)::bigint AS val FROM network_cells ${networkWhere.whereSql}`,
    networkWhere.params,
  );

  const distinctNetworkCells = await scalar(
    targetDb,
    `
      SELECT COUNT(DISTINCT BTRIM(cell_id))::bigint AS val
      FROM network_cells
      ${networkAnd(`cell_id IS NOT NULL AND BTRIM(cell_id) <> ''`)}
    `,
    networkWhere.params,
  );

  const networkCellsWithValidCoords = await scalar(
    targetDb,
    `
      SELECT COUNT(*)::bigint AS val
      FROM network_cells
      ${networkAnd(`
        latitude BETWEEN -90 AND 90
        AND longitude BETWEEN -180 AND 180
        AND NOT (latitude = 0 AND longitude = 0)
      `)}
    `,
    networkWhere.params,
  );

  let totalMissions: number;

  if (filters.missionIds?.length) {
    const params: Params = [];
    const condition = inClause('id', filters.missionIds, params);

    totalMissions = await scalar(
      targetDb,
      `SELECT COUNT(*)::bigint AS val FROM missions WHERE ${condition}`,
      params,
    );
  } else if (filters.mission && filters.mission !== 'ALL') {
    const numericMission = Number(filters.mission);

    if (Number.isInteger(numericMission) && numericMission > 0) {
      totalMissions = await scalar(
        targetDb,
        'SELECT COUNT(*)::bigint AS val FROM missions WHERE id = $1',
        [numericMission],
      );
    } else {
      totalMissions = await scalar(
        targetDb,
        'SELECT COUNT(*)::bigint AS val FROM missions WHERE mission = $1',
        [filters.mission],
      );
    }
  } else {
    totalMissions = await scalar(
      targetDb,
      'SELECT COUNT(*)::bigint AS val FROM missions',
    );
  }

  const [bts, military, civilian] = await Promise.all([
    getBtsMapData(filters, targetDb),
    getMilitaryNetworks(filters, targetDb),
    getCivilianNetworks(filters, targetDb),
  ]);

  const missionWhere = mission.sql ? `WHERE ${mission.sql}` : '';

  const countMissionTable = (table: string) =>
    scalar(
      targetDb,
      `SELECT COUNT(*)::bigint AS val FROM ${q(table)} ${missionWhere}`,
      mission.params,
    );

  // File tables do not have mission_id. Filter through their parent records.
  const missionFiles = scalar(
    targetDb,
    `
      SELECT COUNT(*)::bigint AS val
      FROM mission_files mf
      INNER JOIN mission_extras me ON me.id = mf.mission_extra_id
      ${mission.sql ? `WHERE ${mission.sql.replace(/\bmission_id\b/g, 'me.mission_id').replace(/\bmission\b/g, 'me.mission')}` : ''}
    `,
    mission.params,
  );

  const locationFiles = scalar(
    targetDb,
    `
      SELECT COUNT(*)::bigint AS val
      FROM location_files lf
      INNER JOIN location_extras le ON le.id = lf.location_extra_id
      ${mission.sql ? `WHERE ${mission.sql.replace(/\bmission_id\b/g, 'le.mission_id').replace(/\bmission\b/g, 'le.mission')}` : ''}
    `,
    mission.params,
  );

  const targetFiles = scalar(
    targetDb,
    `
      SELECT COUNT(*)::bigint AS val
      FROM target_files tf
      INNER JOIN targets t ON t.id = tf.target_id
      ${mission.sql ? `WHERE ${mission.sql.replace(/\bmission_id\b/g, 't.mission_id').replace(/\bmission\b/g, 't.mission')}` : ''}
    `,
    mission.params,
  );

  const mapCells = scalar(
    targetDb,
    `
      SELECT COUNT(*)::bigint AS val
      FROM map_cells mc
      INNER JOIN map_cell_databases mcd ON mcd.id = mc.db_id
      ${mission.sql ? `WHERE ${mission.sql.replace(/\bmission_id\b/g, 'mcd.mission_id').replace(/\bmission\b/g, 'mcd.mission')}` : ''}
    `,
    mission.params,
  );

  const [
    targets,
    gps,
    wifi,
    missionFileCount,
    locationFileCount,
    targetFileCount,
    mapCellCount,
    imports,
  ] = await Promise.all([
    countMissionTable('targets'),
    countMissionTable('gps_history'),
    countMissionTable('wifi_access_points'),
    missionFiles,
    locationFiles,
    targetFiles,
    mapCells,
    scalar(
      targetDb,
      'SELECT COUNT(*)::bigint AS val FROM import_history',
    ),
  ]);

  const totalFiles =
    missionFileCount + locationFileCount + targetFileCount;

  return {
    totalRegistrations,
    distinctImsis,
    distinctImeis,
    totalNetworkCells,
    distinctNetworkCells,
    totalMissions,
    countriesRepresented,
    totalBtsLocations: bts.stats.registrationLocationsCount,
    networkCellsWithValidCoords,
    militaryNetworkCells: military.totalDistinctCells,
    civilianNetworkCells: civilian.totalDistinctCells,
    totalTargets: targets,
    totalGpsHistory: gps,
    totalWifiPoints: wifi,
    totalMapCells: mapCellCount,
    totalFiles,
    totalImports: imports,
    totalOperationalRecords:
      totalRegistrations +
      targets +
      totalNetworkCells +
      gps +
      wifi +
      mapCellCount,
  };
}

// -----------------------------------------------------------------------------
// Operational dashboard panels
// -----------------------------------------------------------------------------

export async function getDashboardOperationalPanels(
  filters: Partial<DashboardFilters> = {},
  targetDb: Db = db,
) {
  const registrationWhere = await buildRegistrationWhere(filters, targetDb);
  const networkWhere = await buildNetworkCellWhere(filters, targetDb);
  const mission = await resolveMissionWhere(filters, targetDb);

  let recordsByMission: any[] = [];

  try {
    const missionConditions: string[] = [];
    const missionParams: Params = [];

    if (filters.missionIds?.length) {
      missionConditions.push(inClause('m.id', filters.missionIds, missionParams));
    } else if (filters.mission && filters.mission !== 'ALL') {
      const numericMission = Number(filters.mission);

      if (Number.isInteger(numericMission) && numericMission > 0) {
        missionParams.push(numericMission);
        missionConditions.push(`m.id = $${missionParams.length}`);
      } else {
        missionParams.push(filters.mission);
        missionConditions.push(`m.mission = $${missionParams.length}`);
      }
    }

    recordsByMission = await rows<any>(
      targetDb,
      `
        SELECT
          m.id AS "missionId",
          m.mission,
          m.location,
          (
            SELECT COUNT(*)::int
            FROM registrations r
            WHERE r.mission_id = m.id
          ) AS registrations,
          (
            SELECT COUNT(*)::int
            FROM network_cells n
            WHERE n.mission_id = m.id
          ) AS "networkCells",
          (
            SELECT COUNT(*)::int
            FROM targets t
            WHERE t.mission_id = m.id
          ) AS targets
        FROM missions m
        ${missionConditions.length ? `WHERE ${missionConditions.join(' AND ')}` : ''}
        ORDER BY registrations DESC, m.id ASC
        LIMIT 12
      `,
      missionParams,
    );
  } catch {
    recordsByMission = [];
  }

  let cellsByRat: any[] = [];

  try {
    cellsByRat = await rows<any>(
      targetDb,
      `
        SELECT
          COALESCE(rat, 'Unknown') AS rat,
          COUNT(DISTINCT COALESCE(NULLIF(BTRIM(cell_id), ''), id::text))::int AS count,
          COUNT(*)::int AS "totalRecords"
        FROM network_cells
        ${networkWhere.whereSql}
        GROUP BY rat
        ORDER BY count DESC
      `,
      networkWhere.params,
    );
  } catch {
    cellsByRat = [];
  }

  let activityTimeline: any[] = [];

  try {
    activityTimeline = await rows<any>(
      targetDb,
      `
        SELECT
          TO_CHAR(DATE_TRUNC('hour', last_seen), 'YYYY-MM-DD HH24:00') AS hour_slot,
          COUNT(*)::int AS registrations
        FROM registrations
        ${registrationWhere.whereSql
          ? `${registrationWhere.whereSql} AND`
          : 'WHERE'}
          last_seen IS NOT NULL
        GROUP BY DATE_TRUNC('hour', last_seen)
        ORDER BY DATE_TRUNC('hour', last_seen) ASC
        LIMIT 24
      `,
      registrationWhere.params,
    );
  } catch {
    activityTimeline = [];
  }

  return {
    recordsByMission,
    cellsByRat,
    activityTimeline,
    qualityStats: await getDashboardQualityStats(filters, targetDb),
  };
}

// -----------------------------------------------------------------------------
// Dashboard widget dispatcher
// -----------------------------------------------------------------------------

export type DashboardWidgetId =
  | 'kpis'
  | 'registrationsByCountry'
  | 'btsMap'
  | 'networkCellsByMcc'
  | 'militaryNetworks'
  | 'civilianNetworks'
  | 'mobileNetworksMccMnc'
  | 'operationalSummary'
  | 'qualityStats';

export async function getDashboardWidget(
  widgetId: DashboardWidgetId,
  filters: Partial<DashboardFilters> = {},
  targetDb: Db = db,
) {
  switch (widgetId) {
    case 'kpis':
      return getDashboardKpiSummary(filters, targetDb);

    case 'registrationsByCountry':
      return getRegistrationsByCountry(filters, targetDb);

    case 'btsMap':
      return getBtsMapData(filters, targetDb);

    case 'networkCellsByMcc':
      return getNetworkCellsByMcc(filters, targetDb);

    case 'militaryNetworks':
      return getMilitaryNetworks(filters, targetDb);

    case 'civilianNetworks':
      return getCivilianNetworks(filters, targetDb);

    case 'mobileNetworksMccMnc':
      return getMobileNetworks(filters, targetDb);

    case 'operationalSummary':
      return getDashboardOperationalPanels(filters, targetDb);

    case 'qualityStats':
      return getDashboardQualityStats(filters, targetDb);

    default:
      throw new Error(`Unknown dashboard widget: ${widgetId}`);
  }
}

export async function getDashboardKPIs(
  filters: Partial<DashboardFilters> | string = {},
  targetDb: Db = db,
) {
  const normalizedFilters: Partial<DashboardFilters> =
    typeof filters === 'string'
      ? { mission: filters }
      : filters || {};

  const [
    kpis,
    registrationsByCountry,
    btsMap,
    networkCellsByMcc,
    militaryNetworks,
    civilianNetworks,
    mobileNetworksMccMnc,
    operational,
  ] = await Promise.all([
    getDashboardKpiSummary(normalizedFilters, targetDb),
    getRegistrationsByCountry(normalizedFilters, targetDb),
    getBtsMapData(normalizedFilters, targetDb),
    getNetworkCellsByMcc(normalizedFilters, targetDb),
    getMilitaryNetworks(normalizedFilters, targetDb),
    getCivilianNetworks(normalizedFilters, targetDb),
    getMobileNetworks(normalizedFilters, targetDb),
    getDashboardOperationalPanels(normalizedFilters, targetDb),
  ]);

  return {
    kpis,
    registrationsByCountry,
    btsMap,
    networkCellsByMcc,
    militaryNetworks,
    civilianNetworks,
    mobileNetworksMccMnc,
    recordsByMission: operational.recordsByMission,
    recordsByCountry: registrationsByCountry.items.map((item: any) => ({
      country: item.country,
      count: item.distinctImsiCount,
    })),
    cellsByRat: operational.cellsByRat,
    activityTimeline: operational.activityTimeline,
    qualityStats: operational.qualityStats,
  };
}

// -----------------------------------------------------------------------------
// Dashboard filter options
// -----------------------------------------------------------------------------

export async function getDashboardFilterOptions(targetDb: Db = db) {
  const distinct = async (sql: string) => {
    const result = await rows<any>(targetDb, sql);

    return result
      .map((item) => item.val)
      .filter(Boolean);
  };

  const [
    missions,
    countries,
    countryCodes,
    ueModels,
    btsNames,
    actions,
    updates,
    rats,
    mccs,
    mncs,
    plmnEntries,
  ] = await Promise.all([
    rows<any>(
      targetDb,
      `
        SELECT
          id,
          mission,
          mission_name AS "missionName",
          location,
          created_at AS "createdAt"
        FROM missions
        ORDER BY id
      `,
    ),

    distinct(`
      SELECT DISTINCT BTRIM(country) AS val
      FROM registrations
      WHERE country IS NOT NULL AND BTRIM(country) <> ''
      ORDER BY val
    `),

    distinct(`
      SELECT DISTINCT UPPER(BTRIM(country_code)) AS val
      FROM registrations
      WHERE country_code IS NOT NULL AND BTRIM(country_code) <> ''
      ORDER BY val
    `),

    distinct(`
      SELECT DISTINCT ue_model AS val
      FROM registrations
      WHERE ue_model IS NOT NULL AND BTRIM(ue_model) <> ''
      ORDER BY val
    `),

    distinct(`
      SELECT DISTINCT bts_name AS val
      FROM registrations
      WHERE bts_name IS NOT NULL AND BTRIM(bts_name) <> ''
      ORDER BY val
    `),

    distinct(`
      SELECT DISTINCT action AS val
      FROM registrations
      WHERE action IS NOT NULL AND BTRIM(action) <> ''
      ORDER BY val
    `),

    distinct(`
      SELECT DISTINCT "update" AS val
      FROM registrations
      WHERE "update" IS NOT NULL AND BTRIM("update") <> ''
      ORDER BY val
    `),

    distinct(`
      SELECT DISTINCT rat AS val
      FROM network_cells
      WHERE rat IS NOT NULL AND BTRIM(rat) <> ''
      ORDER BY val
    `),

    distinct(`
      SELECT DISTINCT BTRIM(mcc) AS val
      FROM network_cells
      WHERE mcc IS NOT NULL AND BTRIM(mcc) <> ''
      ORDER BY val
    `),

    distinct(`
      SELECT DISTINCT BTRIM(mnc) AS val
      FROM network_cells
      WHERE mnc IS NOT NULL AND BTRIM(mnc) <> ''
      ORDER BY val
    `),

    rows<any>(
      targetDb,
      `
        SELECT mcc, mnc, country, code, name
        FROM plmn_storage
        ORDER BY mcc, mnc
      `,
    ),
  ]);

  return {
    missions,
    registrations: {
      countries,
      countryCodes,
      ueModels,
      btsNames,
      actions,
      updates,
    },
    networkCells: {
      rats,
      mccs,
      mncs,
    },
    plmnEntries,
  };
}

// -----------------------------------------------------------------------------
// Generic table statistics
// -----------------------------------------------------------------------------

const ANALYTICS_TABLES = new Set([
  'missions',
  'registrations',
  'targets',
  'mission_extras',
  'location_extras',
  'mission_files',
  'location_files',
  'target_files',
  'network_cells',
  'map_cell_databases',
  'map_cells',
  'plmn_storage',
  'wifi_access_points',
  'wifi_access_point_clients',
  'gps_history',
  'sms_calls',
  'map_user_markers',
  'map_user_polygons',
  'map_user_circles',
  'scheduled_tasks',
  'map_layers',
  'whitelist_targets',
  'tac_numbers',
]);

async function getColumnNames(targetDb: Db, table: string): Promise<Set<string>> {
  const result = await rows<{ name: string }>(
    targetDb,
    `
      SELECT column_name AS name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
    `,
    [table],
  );

  return new Set(result.map((item) => item.name));
}

export async function getTableStats(
  options: {
    table: string;
    search?: string;
    mission?: string;
    missionIds?: number[];
    filters?: any[];
  },
  targetDb: Db = db,
): Promise<Record<string, any>> {
  const table = String(options.table || '').trim();

  if (!ANALYTICS_TABLES.has(table)) {
    throw new Error(`Unsupported analytics table: ${table}`);
  }

  const columns = await getColumnNames(targetDb, table);
  const clauses: string[] = [];
  const params: Params = [];

  if (options.missionIds?.length) {
    if (table === 'missions' && columns.has('id')) {
      clauses.push(inClause('id', options.missionIds, params));
    } else if (columns.has('mission_id')) {
      clauses.push(inClause('mission_id', options.missionIds, params));
    }
  } else if (options.mission && options.mission !== 'ALL') {
    const numericMission = Number(options.mission);

    if (table === 'missions') {
      if (Number.isInteger(numericMission) && numericMission > 0) {
        params.push(numericMission);
        clauses.push(`id = $${params.length}`);
      } else {
        params.push(options.mission);
        clauses.push(`mission = $${params.length}`);
      }
    } else if (
      Number.isInteger(numericMission) &&
      numericMission > 0 &&
      columns.has('mission_id')
    ) {
      params.push(numericMission);
      clauses.push(`mission_id = $${params.length}`);
    } else if (columns.has('mission')) {
      params.push(options.mission);
      clauses.push(`mission = $${params.length}`);
    } else if (columns.has('mission_id')) {
      const missions = await rows<{ id: number }>(
        targetDb,
        'SELECT id FROM missions WHERE mission = $1',
        [options.mission],
      );

      if (missions.length) {
        clauses.push(
          inClause('mission_id', missions.map((item) => item.id), params),
        );
      } else {
        clauses.push('FALSE');
      }
    }
  }

  if (options.search?.trim()) {
    const searchableColumns = [
      'mission',
      'name',
      'country',
      'imsi',
      'imei',
      'bts',
      'bts_name',
      'mcc',
      'mnc',
      'cell_id',
    ].filter((column) => columns.has(column));

    if (searchableColumns.length) {
      params.push(`%${options.search.trim()}%`);
      const placeholder = `$${params.length}`;

      clauses.push(
        `(${searchableColumns
          .map((column) => `CAST(${q(column)} AS TEXT) ILIKE ${placeholder}`)
          .join(' OR ')})`,
      );
    }
  }

  const result = await first<any>(
    targetDb,
    `
      SELECT COUNT(*)::bigint AS total
      FROM ${q(table)}
      ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    `,
    params,
  );

  return {
    table,
    totalRecords: safeNumber(result?.total),
  };
}

// -----------------------------------------------------------------------------
// Dynamic grouped analytics
// -----------------------------------------------------------------------------

type DynamicMetric = {
  id?: string;
  label?: string;
  aggregation: string;
  column?: string;
};

export async function executeDynamicAnalytics(
  options: {
    table: string;
    dimensionCol?: string;
    dimensions?: string[];
    dimension?: string[];
    metrics?: DynamicMetric[];
    metricCol?: string;
    aggregation?: string;
    mission?: string;
    missionIds?: number[];
    limit?: number;
    offset?: number;
    sortBy?: string;
    sortOrder?: 'ASC' | 'DESC';
    filters?: any;
  },
  targetDb: Db = db,
): Promise<{
  rows: any[];
  dimensions: string[];
  metrics: any[];
}> {
  const table = String(options.table || '').trim();

  if (!ANALYTICS_TABLES.has(table)) {
    throw new Error(`Unsupported analytics table: ${table}`);
  }

  const columnSet = await getColumnNames(targetDb, table);

  let dimensions = Array.isArray(options.dimensions)
    ? options.dimensions.filter(Boolean).map(String)
    : Array.isArray(options.dimension)
      ? options.dimension.filter(Boolean).map(String)
      : [];

  if (!dimensions.length && options.dimensionCol) {
    dimensions = [String(options.dimensionCol)];
  }

  dimensions = [...new Set(dimensions.filter((column) => columnSet.has(column)))];

  if (!dimensions.length) {
    throw new Error(
      'Analytics Query Error: no valid grouping dimension columns',
    );
  }

  const requestedMetrics =
    Array.isArray(options.metrics) && options.metrics.length
      ? options.metrics
      : [{
          id: 'value',
          label: options.aggregation || 'Count',
          aggregation: options.aggregation || 'COUNT',
          column: options.metricCol,
        }];

  const allowedAggregations = new Set([
    'COUNT',
    'DISTINCT_COUNT',
    'SUM',
    'AVG',
    'MIN',
    'MAX',
    'MEDIAN',
  ]);

  const metrics = requestedMetrics.map((metric, index) => {
    const aggregation = String(metric.aggregation || 'COUNT').toUpperCase();

    let id = String(metric.id || `m${index + 1}`);

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(id)) {
      id = `m${index + 1}`;
    }

    const column = metric.column
      ? String(metric.column)
      : undefined;

    if (!allowedAggregations.has(aggregation)) {
      throw new Error(`Unsupported aggregation: ${aggregation}`);
    }

    if (aggregation !== 'COUNT' && (!column || !columnSet.has(column))) {
      throw new Error(
        `Analytics Query Error: invalid metric column: ${column || '(missing)'}`,
      );
    }

    return {
      id,
      label: metric.label || `${aggregation}${column ? ` ${column}` : ''}`,
      aggregation,
      column,
    };
  });

  const params: Params = [];
  const clauses: string[] = [];

  // Mission IDs are authoritative.
  if (options.missionIds?.length && columnSet.has('mission_id')) {
    clauses.push(inClause('mission_id', options.missionIds, params));
  } else if (options.mission && options.mission !== 'ALL') {
    const numericMission = Number(options.mission);

    if (
      Number.isInteger(numericMission) &&
      numericMission > 0 &&
      columnSet.has('mission_id')
    ) {
      params.push(numericMission);
      clauses.push(`mission_id = $${params.length}`);
    } else if (columnSet.has('mission')) {
      params.push(options.mission);
      clauses.push(`mission = $${params.length}`);
    } else if (columnSet.has('mission_id')) {
      const missions = await rows<{ id: number }>(
        targetDb,
        'SELECT id FROM missions WHERE mission = $1',
        [options.mission],
      );

      if (missions.length) {
        clauses.push(
          inClause('mission_id', missions.map((item) => item.id), params),
        );
      } else {
        clauses.push('FALSE');
      }
    }
  }

  const filters = Array.isArray(options.filters)
    ? options.filters
    : [];

  for (const filter of filters) {
    if (!filter?.column) continue;

    const column = String(filter.column);

    if (!columnSet.has(column)) continue;

    const operator = String(filter.operator || '').toLowerCase();
    const identifier = q(column);

    if (operator === 'is_empty') {
      clauses.push(
        `(${identifier} IS NULL OR BTRIM(${identifier}::text) = '')`,
      );
      continue;
    }

    if (operator === 'is_not_empty') {
      clauses.push(
        `(${identifier} IS NOT NULL AND BTRIM(${identifier}::text) <> '')`,
      );
      continue;
    }

    if (filter.value === undefined || filter.value === null) {
      continue;
    }

    if (
      typeof filter.value === 'string' &&
      filter.value.trim() === '' &&
      operator !== 'equals'
    ) {
      continue;
    }

    const bind = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };

    switch (operator) {
      case 'contains':
        clauses.push(
          `${identifier}::text ILIKE ${bind(`%${filter.value}%`)}`,
        );
        break;

      case 'equals':
        clauses.push(`${identifier} = ${bind(filter.value)}`);
        break;

      case 'not_equals':
        clauses.push(`${identifier} <> ${bind(filter.value)}`);
        break;

      case 'starts_with':
        clauses.push(
          `${identifier}::text ILIKE ${bind(`${filter.value}%`)}`,
        );
        break;

      case 'ends_with':
        clauses.push(
          `${identifier}::text ILIKE ${bind(`%${filter.value}`)}`,
        );
        break;

      case 'greater_than':
        clauses.push(`${identifier} > ${bind(filter.value)}`);
        break;

      case 'less_than':
        clauses.push(`${identifier} < ${bind(filter.value)}`);
        break;

      case 'between': {
        if (filter.value2 === undefined || filter.value2 === null) {
          throw new Error(
            `Analytics Query Error: second value required for BETWEEN on ${column}`,
          );
        }

        const firstValue = bind(filter.value);
        const secondValue = bind(filter.value2);

        clauses.push(
          `${identifier} BETWEEN ${firstValue} AND ${secondValue}`,
        );
        break;
      }

      case 'before_date':
        clauses.push(`${identifier} <= ${bind(filter.value)}`);
        break;

      case 'after_date':
        clauses.push(`${identifier} >= ${bind(filter.value)}`);
        break;

      default:
        // Ignore unknown filter operators to preserve the existing behavior.
        break;
    }
  }

  const expressions = metrics.map((metric) => {
    const column = metric.column ? q(metric.column) : '*';
    const alias = q(metric.id);

    switch (metric.aggregation) {
      case 'SUM':
        return `SUM(${column}) AS ${alias}`;

      case 'AVG':
        return `AVG(${column}) AS ${alias}`;

      case 'MIN':
        return `MIN(${column}) AS ${alias}`;

      case 'MAX':
        return `MAX(${column}) AS ${alias}`;

      case 'DISTINCT_COUNT':
        return `COUNT(DISTINCT ${column}) AS ${alias}`;

      case 'MEDIAN':
        return `PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${column}) AS ${alias}`;

      default:
        return `COUNT(*) AS ${alias}`;
    }
  });

  const sortColumn =
    options.sortBy &&
    (
      dimensions.includes(options.sortBy) ||
      metrics.some((metric) => metric.id === options.sortBy)
    )
      ? q(options.sortBy)
      : q(metrics[0].id);

  const limit = Math.min(
    100,
    Math.max(5, Math.trunc(Number(options.limit) || 20)),
  );

  const offset = Math.max(
    0,
    Math.trunc(Number(options.offset) || 0),
  );

  params.push(limit, offset);

  const sql = `
    SELECT
      ${dimensions.map(q).join(', ')},
      ${expressions.join(', ')}
    FROM ${q(table)}
    ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    GROUP BY ${dimensions.map(q).join(', ')}
    ORDER BY ${sortColumn} ${options.sortOrder === 'ASC' ? 'ASC' : 'DESC'}
    LIMIT $${params.length - 1}
    OFFSET $${params.length}
  `;


try {
  const resultRows = await rows<any>(targetDb, sql, params);

  // Convert BigInt values into JSON-safe values without losing precision.
  const normalizedRows = resultRows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => {
        if (typeof value !== 'bigint') {
          return [key, value];
        }

        const max = BigInt(Number.MAX_SAFE_INTEGER);
        const min = BigInt(Number.MIN_SAFE_INTEGER);

        return [
          key,
          value >= min && value <= max
            ? Number(value)
            : value.toString(),
        ];
      }),
    ),
  );

  return {
    rows: normalizedRows,
    dimensions,
    metrics,
  };
} catch (error: any) {
  throw new Error(`Analytics Query Error: ${error.message}`);
}

}