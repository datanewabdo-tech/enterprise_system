import { db } from './db.js';
import { DashboardFilters } from './validators.js';
import { DatabaseSync } from 'node:sqlite';

export interface ParsedPoint {
  lat: number;
  lng: number;
}

/**
 * Parses bts_location strings supporting:
 * - newline-separated pairs ("31.5017 34.4668\n31.5120 34.4780")
 * - semicolon-separated ("30.0444;31.2357")
 * - comma-separated ("31.2519, 34.2510")
 * - space-separated ("30.0444 31.2357")
 * - WKT POINT(lng lat)
 * Rejects nulls, (0, 0), non-numeric strings, and out-of-range coordinates.
 */
export function parseBtsLocationString(raw: string | null | undefined): { points: ParsedPoint[]; invalidCount: number } {
  if (!raw || typeof raw !== 'string') return { points: [], invalidCount: 0 };
  const trimmed = raw.trim();
  if (!trimmed) return { points: [], invalidCount: 0 };

  const points: ParsedPoint[] = [];
  let invalidCount = 0;

  // Split by newlines or pipe characters if multiple coordinates are stacked
  const lines = trimmed.split(/[\r\n|]+/).map(l => l.trim()).filter(Boolean);

  for (const line of lines) {
    // Check WKT POINT(lng lat)
    const wktMatch = line.match(/POINT\s*\(\s*([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s*\)/i);
    if (wktMatch) {
      const lng = Number(wktMatch[1]);
      const lat = Number(wktMatch[2]);
      if (isValidCoord(lat, lng)) {
        points.push({ lat, lng });
      } else {
        invalidCount++;
      }
      continue;
    }

    // Standard pair separated by semicolon, comma, slash, or whitespace
    let tokens: string[] = [];
    if (line.includes(';')) {
      tokens = line.split(';').map(t => t.trim()).filter(Boolean);
    } else if (line.includes(',')) {
      tokens = line.split(',').map(t => t.trim()).filter(Boolean);
    } else if (line.includes('/')) {
      tokens = line.split('/').map(t => t.trim()).filter(Boolean);
    } else {
      tokens = line.split(/\s+/).map(t => t.trim()).filter(Boolean);
    }

    // Handle even-length sequence of coordinates on one line (e.g. "lat1 lng1 lat2 lng2")
    if (tokens.length >= 2 && tokens.length % 2 === 0 && tokens.every(t => /^[+-]?\d+(?:\.\d+)?$/.test(t))) {
      for (let i = 0; i < tokens.length; i += 2) {
        const lat = Number(tokens[i]);
        const lng = Number(tokens[i + 1]);
        if (isValidCoord(lat, lng)) {
          points.push({ lat, lng });
        } else {
          invalidCount++;
        }
      }
    } else if (tokens.length >= 2) {
      const lat = Number(tokens[0]);
      const lng = Number(tokens[1]);
      if (/^[+-]?\d+(?:\.\d+)?$/.test(tokens[0]) && /^[+-]?\d+(?:\.\d+)?$/.test(tokens[1]) && isValidCoord(lat, lng)) {
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

export function isValidCoord(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat === 0 && lng === 0) return false;
  if (lat < -90 || lat > 90) return false;
  if (lng < -180 || lng > 180) return false;
  return true;
}

function stripLeadingZeros(val: unknown): string {
  const s = String(val ?? '').trim();
  if (!s) return '';
  return s.replace(/^0+(?=\d)/, '');
}

const FALLBACK_MCC_COUNTRIES: Record<string, string> = {
  '602': 'Egypt',
  '425': 'Israel / Palestine',
  '424': 'United Arab Emirates',
  '420': 'Saudi Arabia',
  '416': 'Jordan',
  '208': 'France',
  '234': 'United Kingdom',
  '310': 'United States',
};

const MILITARY_NETWORK_MAP: Array<{ mcc: string; mnc: string; operator: string; country: string; color: string }> = [
  { mcc: '602', mnc: '10', operator: 'المحمول العسكري المصري', country: 'Egypt', color: '#3498DB' },
  { mcc: '602', mnc: '11', operator: 'المحمول العسكري المصري', country: 'Egypt', color: '#3498DB' },
  { mcc: '425', mnc: '25', operator: 'المحمول العسكري الإسرائيلي', country: 'Israel', color: '#27AE60' },
];

const CIVILIAN_NETWORK_MAP: Array<{ mcc: string; mnc: string; country: string; operator: string; color: string }> = [
  // Israel (#2980B9)
  { mcc: '425', mnc: '1', country: 'Israel', operator: 'Partner', color: '#2980B9' },
  { mcc: '425', mnc: '2', country: 'Israel', operator: 'Cellcom', color: '#2980B9' },
  { mcc: '425', mnc: '3', country: 'Israel', operator: 'Pelephone', color: '#2980B9' },
  { mcc: '425', mnc: '7', country: 'Israel', operator: 'Hot Mobile', color: '#2980B9' },
  { mcc: '425', mnc: '9', country: 'Israel', operator: 'We4G', color: '#2980B9' },
  { mcc: '425', mnc: '25', country: 'Israel', operator: 'IMOD', color: '#2980B9' },
  { mcc: '425', mnc: '28', country: 'Israel', operator: 'PHI Networks', color: '#2980B9' },
  { mcc: '425', mnc: '29', country: 'Israel', operator: 'CG Networks', color: '#2980B9' },
  // Palestine (#27AE60)
  { mcc: '425', mnc: '5', country: 'Palestine', operator: 'Jawwal', color: '#27AE60' },
  { mcc: '425', mnc: '6', country: 'Palestine', operator: 'Wataniya', color: '#27AE60' },
  // UAE (#E67E22)
  { mcc: '424', mnc: '2', country: 'United Arab Emirates', operator: 'Etisalat UAE (e&)', color: '#E67E22' },
];

const CIVILIAN_EXCLUDED_PAIRS = new Set([
  '602:1', '602:2', '602:3', '602:4', '602:10', '602:11', '425:24',
]);

function resolveMissionWhere(filters: Partial<DashboardFilters>, targetDb: DatabaseSync): { clause: string | null; params: any[] } {
  if (filters.missionIds && filters.missionIds.length > 0) {
    const ph = filters.missionIds.map(() => '?').join(', ');
    return { clause: `mission_id IN (${ph})`, params: [...filters.missionIds] };
  }
  if (filters.mission && filters.mission !== 'ALL') {
    const num = Number(filters.mission);
    if (!Number.isNaN(num) && Number.isInteger(num) && num > 0) {
      return { clause: `mission_id = ?`, params: [num] };
    }
    const matchingMissions = targetDb.prepare(`SELECT id FROM missions WHERE mission = ?`).all(filters.mission) as Array<{ id: number }>;
    if (matchingMissions.length > 0) {
      const ids = matchingMissions.map(m => m.id);
      const ph = ids.map(() => '?').join(', ');
      return { clause: `mission_id IN (${ph})`, params: ids };
    }
    return { clause: `mission = ?`, params: [filters.mission] };
  }
  return { clause: null, params: [] };
}

/**
 * Builds SQL WHERE clause strictly for Registration fields + Mission filter.
 */
export function buildRegistrationWhere(
  filters: Partial<DashboardFilters> = {},
  targetDb: DatabaseSync = db
): { whereSql: string; params: any[] } {
  const clauses: string[] = [];
  const params: any[] = [];

  const missionWhere = resolveMissionWhere(filters, targetDb);
  if (missionWhere.clause) {
    clauses.push(missionWhere.clause);
    params.push(...missionWhere.params);
  }

  if (filters.country && filters.country.length > 0) {
    const ph = filters.country.map(() => '?').join(', ');
    clauses.push(`country IN (${ph})`);
    params.push(...filters.country);
  }
  if (filters.countryCode && filters.countryCode.length > 0) {
    const ph = filters.countryCode.map(() => '?').join(', ');
    clauses.push(`UPPER(country_code) IN (${ph})`);
    params.push(...filters.countryCode.map(c => c.toUpperCase()));
  }
  if (filters.imsi) {
    clauses.push(`imsi LIKE ?`);
    params.push(`%${filters.imsi}%`);
  }
  if (filters.imei) {
    clauses.push(`imei LIKE ?`);
    params.push(`%${filters.imei}%`);
  }
  if (filters.tmsi) {
    clauses.push(`tmsi LIKE ?`);
    params.push(`%${filters.tmsi}%`);
  }
  if (filters.btsName) {
    clauses.push(`bts_name LIKE ?`);
    params.push(`%${filters.btsName}%`);
  }
  if (filters.bts) {
    clauses.push(`bts LIKE ?`);
    params.push(`%${filters.bts}%`);
  }
  if (filters.ueModel && filters.ueModel.length > 0) {
    const ph = filters.ueModel.map(() => '?').join(', ');
    clauses.push(`ue_model IN (${ph})`);
    params.push(...filters.ueModel);
  }
  if (filters.lastSeenFrom) {
    clauses.push(`last_seen >= ?`);
    params.push(filters.lastSeenFrom);
  }
  if (filters.lastSeenTo) {
    const toVal = filters.lastSeenTo.length === 10 ? `${filters.lastSeenTo}T23:59:59.999Z` : filters.lastSeenTo;
    clauses.push(`last_seen <= ?`);
    params.push(toVal);
  }
  if (filters.btsAltitudeMin !== undefined) {
    clauses.push(`bts_altitude >= ?`);
    params.push(filters.btsAltitudeMin);
  }
  if (filters.btsAltitudeMax !== undefined) {
    clauses.push(`bts_altitude <= ?`);
    params.push(filters.btsAltitudeMax);
  }
  if (filters.distanceMinFrom !== undefined) {
    clauses.push(`distance_min >= ?`);
    params.push(filters.distanceMinFrom);
  }
  if (filters.distanceMinTo !== undefined) {
    clauses.push(`distance_min <= ?`);
    params.push(filters.distanceMinTo);
  }
  if (filters.distanceMaxFrom !== undefined) {
    clauses.push(`distance_max >= ?`);
    params.push(filters.distanceMaxFrom);
  }
  if (filters.distanceMaxTo !== undefined) {
    clauses.push(`distance_max <= ?`);
    params.push(filters.distanceMaxTo);
  }
  if (filters.hasBtsLocation === 'available') {
    clauses.push(`(bts_location IS NOT NULL AND TRIM(bts_location) != '')`);
  } else if (filters.hasBtsLocation === 'unavailable') {
    clauses.push(`(bts_location IS NULL OR TRIM(bts_location) = '')`);
  }
  if (filters.btsLocationOutdated === 'true') {
    clauses.push(`bts_location_outdated = 1`);
  } else if (filters.btsLocationOutdated === 'false') {
    clauses.push(`(bts_location_outdated = 0 OR bts_location_outdated IS NULL)`);
  }
  if (filters.hasDeviceLocation === 'available') {
    clauses.push(`(device_location IS NOT NULL AND TRIM(device_location) != '')`);
  } else if (filters.hasDeviceLocation === 'unavailable') {
    clauses.push(`(device_location IS NULL OR TRIM(device_location) = '')`);
  }
  if (filters.action && filters.action.length > 0) {
    const ph = filters.action.map(() => '?').join(', ');
    clauses.push(`action IN (${ph})`);
    params.push(...filters.action);
  }
  if (filters.update && filters.update.length > 0) {
    const ph = filters.update.map(() => '?').join(', ');
    clauses.push(`"update" IN (${ph})`);
    params.push(...filters.update);
  }

  return {
    whereSql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

/**
 * Builds SQL WHERE clause strictly for NetworkCell fields + Mission filter + PLMN lookup.
 * NEVER applies date/createdAt filters to NetworkCell.
 */
export function buildNetworkCellWhere(
  filters: Partial<DashboardFilters> = {},
  targetDb: DatabaseSync = db
): { whereSql: string; params: any[]; clauses: string[] } {
  const clauses: string[] = [];
  const params: any[] = [];

  const missionWhere = resolveMissionWhere(filters, targetDb);
  if (missionWhere.clause) {
    clauses.push(missionWhere.clause);
    params.push(...missionWhere.params);
  }

  if (filters.rat && filters.rat.length > 0) {
    const ph = filters.rat.map(() => '?').join(', ');
    clauses.push(`rat IN (${ph})`);
    params.push(...filters.rat);
  }
  if (filters.mcc && filters.mcc.length > 0) {
    const ph = filters.mcc.map(() => '?').join(', ');
    clauses.push(`TRIM(mcc) IN (${ph})`);
    params.push(...filters.mcc.map(v => String(v).trim()));
  }
  if (filters.mnc && filters.mnc.length > 0) {
    const ph = filters.mnc.map(() => '?').join(', ');
    clauses.push(`TRIM(mnc) IN (${ph})`);
    params.push(...filters.mnc.map(v => String(v).trim()));
  }
  if (filters.lac !== undefined && filters.lac !== '') {
    clauses.push(`TRIM(lac) = ?`);
    params.push(String(filters.lac).trim());
  }
  if (filters.cellId !== undefined && filters.cellId !== '') {
    clauses.push(`TRIM(cell_id) = ?`);
    params.push(String(filters.cellId).trim());
  }
  if (filters.channel !== undefined) {
    clauses.push(`channel = ?`);
    params.push(filters.channel);
  }
  if (filters.bsic !== undefined && filters.bsic !== '') {
    clauses.push(`TRIM(bsic) = ?`);
    params.push(String(filters.bsic).trim());
  }
  if (filters.psc !== undefined && filters.psc !== '') {
    clauses.push(`TRIM(psc) = ?`);
    params.push(String(filters.psc).trim());
  }
  if (filters.pci !== undefined && filters.pci !== '') {
    clauses.push(`TRIM(pci) = ?`);
    params.push(String(filters.pci).trim());
  }
  if (filters.rxLevMin !== undefined) {
    clauses.push(`rx_lev >= ?`);
    params.push(filters.rxLevMin);
  }
  if (filters.rxLevMax !== undefined) {
    clauses.push(`rx_lev <= ?`);
    params.push(filters.rxLevMax);
  }
  if (filters.rxLevDbmMin !== undefined) {
    clauses.push(`rx_lev_dbm >= ?`);
    params.push(filters.rxLevDbmMin);
  }
  if (filters.rxLevDbmMax !== undefined) {
    clauses.push(`rx_lev_dbm <= ?`);
    params.push(filters.rxLevDbmMax);
  }
  if (filters.downlinkMin !== undefined) {
    clauses.push(`downlink >= ?`);
    params.push(filters.downlinkMin);
  }
  if (filters.downlinkMax !== undefined) {
    clauses.push(`downlink <= ?`);
    params.push(filters.downlinkMax);
  }
  if (filters.dlBandwidthMin !== undefined) {
    clauses.push(`dl_bandwidth >= ?`);
    params.push(filters.dlBandwidthMin);
  }
  if (filters.dlBandwidthMax !== undefined) {
    clauses.push(`dl_bandwidth <= ?`);
    params.push(filters.dlBandwidthMax);
  }
  if (filters.directionMin !== undefined) {
    clauses.push(`direction >= ?`);
    params.push(filters.directionMin);
  }
  if (filters.directionMax !== undefined) {
    clauses.push(`direction <= ?`);
    params.push(filters.directionMax);
  }
  if (filters.isNeighbour === 'true') {
    clauses.push(`is_neighbour = 1`);
  } else if (filters.isNeighbour === 'false') {
    clauses.push(`(is_neighbour = 0 OR is_neighbour IS NULL)`);
  }
  if (filters.isPcs1900 === 'true') {
    clauses.push(`is_pcs1900 = 1`);
  } else if (filters.isPcs1900 === 'false') {
    clauses.push(`(is_pcs1900 = 0 OR is_pcs1900 IS NULL)`);
  }

  if (filters.hasCoordinates === 'available' || filters.hasLatitude === 'available' || filters.hasLongitude === 'available') {
    if (filters.hasCoordinates === 'available') {
      clauses.push(`(latitude IS NOT NULL AND longitude IS NOT NULL AND NOT (latitude = 0 AND longitude = 0))`);
    } else {
      if (filters.hasLatitude === 'available') clauses.push(`latitude IS NOT NULL`);
      if (filters.hasLongitude === 'available') clauses.push(`longitude IS NOT NULL`);
    }
  } else if (filters.hasCoordinates === 'unavailable' || filters.hasLatitude === 'unavailable' || filters.hasLongitude === 'unavailable') {
    if (filters.hasCoordinates === 'unavailable') {
      clauses.push(`(latitude IS NULL OR longitude IS NULL)`);
    } else {
      if (filters.hasLatitude === 'unavailable') clauses.push(`latitude IS NULL`);
      if (filters.hasLongitude === 'unavailable') clauses.push(`longitude IS NULL`);
    }
  }

  if (filters.plmnQuery) {
    const term = `%${filters.plmnQuery}%`;
    const matchedPlmns = targetDb.prepare(`
      SELECT mcc, mnc FROM plmn_storage
      WHERE name LIKE ? OR country LIKE ? OR code LIKE ? OR CAST(mcc AS TEXT) LIKE ? OR CAST(mnc AS TEXT) LIKE ?
    `).all(term, term, term, term, term) as Array<{ mcc: string | number; mnc: string | number }>;

    if (matchedPlmns.length > 0) {
      const pairClauses = matchedPlmns
        .map(() => `((TRIM(mcc) = ? AND TRIM(mnc) = ?) OR (LTRIM(TRIM(mcc), '0') = ? AND LTRIM(TRIM(mnc), '0') = ?))`)
        .join(' OR ');
      clauses.push(`(${pairClauses})`);
      for (const p of matchedPlmns) {
        const mccStr = String(p.mcc).trim();
        const mncStr = String(p.mnc).trim();
        params.push(mccStr, mncStr, stripLeadingZeros(mccStr), stripLeadingZeros(mncStr));
      }
    } else {
      clauses.push(`1 = 0`);
    }
  }

  return {
    whereSql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
    clauses,
  };
}

/**
 * 2.1 Registrations by Country (distinct IMSI, excluding null/empty country, zero IMSI, and Egypt)
 */
export function getRegistrationsByCountry(filters: Partial<DashboardFilters> = {}, targetDb: DatabaseSync = db) {
  const { whereSql, params } = buildRegistrationWhere(filters, targetDb);
  const baseClauses = whereSql ? [whereSql.replace(/^WHERE\s+/i, '')] : [];
  baseClauses.push(`country IS NOT NULL AND TRIM(country) != ''`);
  baseClauses.push(`imsi IS NOT NULL AND TRIM(imsi) != '' AND TRIM(imsi) != '0'`);
  baseClauses.push(`UPPER(TRIM(country)) NOT IN ('EG', 'EGY', 'EGYPT')`);
  baseClauses.push(`(country_code IS NULL OR UPPER(TRIM(country_code)) NOT IN ('EG', 'EGY'))`);

  const finalWhere = `WHERE ${baseClauses.join(' AND ')}`;
  const rows = targetDb.prepare(`
    SELECT TRIM(country) as country,
           COUNT(DISTINCT imsi) as distinctImsiCount,
           COUNT(*) as totalRecords
    FROM registrations
    ${finalWhere}
    GROUP BY TRIM(country)
    ORDER BY distinctImsiCount DESC, totalRecords DESC, country ASC
  `).all(...params) as Array<{ country: string; distinctImsiCount: number; totalRecords: number }>;

  const totalDistinct = rows.reduce((sum, r) => sum + Number(r.distinctImsiCount), 0);
  return {
    titleAr: 'أعداد شرائح الاتصال المرصودة لكل دولة',
    titleEn: 'Observed SIM Registrations by Country (Distinct IMSI, Excl. Egypt)',
    totalDistinctImsis: totalDistinct,
    items: rows.map((row, idx) => ({
      rank: idx + 1,
      country: row.country,
      distinctImsiCount: Number(row.distinctImsiCount),
      totalRecords: Number(row.totalRecords),
      percentageShare: totalDistinct > 0 ? Number(((Number(row.distinctImsiCount) / totalDistinct) * 100).toFixed(2)) : 0,
      color: idx < 3 ? '#00B894' : '#3977C3',
    })),
  };
}

/**
 * 2.2 BTS Locations Map (Registrations.bts_location + NetworkCells.latitude/longitude)
 * Strictly excludes IMSI, IMEI, and TMSI from output.
 */
export function getBtsMapData(filters: Partial<DashboardFilters> = {}, targetDb: DatabaseSync = db) {
  const regWhere = buildRegistrationWhere(filters, targetDb);
  const regRows = targetDb.prepare(`
    SELECT id, mission_id, mission, bts, bts_name, country, country_code, bts_location, bts_altitude, bts_location_outdated
    FROM registrations
    ${regWhere.whereSql ? `${regWhere.whereSql} AND` : 'WHERE'} bts_location IS NOT NULL AND TRIM(bts_location) != ''
    LIMIT 10000
  `).all(...regWhere.params) as any[];

  const ncWhere = buildNetworkCellWhere(filters, targetDb);
  const ncRows = targetDb.prepare(`
    SELECT id, mission_id, mission, mcc, mnc, lac, cell_id, rat, rx_lev_dbm, latitude, longitude, direction
    FROM network_cells
    ${ncWhere.whereSql ? `${ncWhere.whereSql} AND` : 'WHERE'} latitude IS NOT NULL AND longitude IS NOT NULL
    LIMIT 10000
  `).all(...ncWhere.params) as any[];

  interface AggLocation {
    key: string;
    lat: number;
    lng: number;
    sources: Set<'registration' | 'network_cell'>;
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
  }

  const mapByCoord = new Map<string, AggLocation>();
  let totalParsedRegistrationCoords = 0;
  let invalidSkippedCount = 0;

  const getOrCreateBucket = (lat: number, lng: number): AggLocation => {
    const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    let bucket = mapByCoord.get(key);
    if (!bucket) {
      bucket = {
        key,
        lat: Number(lat.toFixed(6)),
        lng: Number(lng.toFixed(6)),
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
      };
      mapByCoord.set(key, bucket);
    }
    return bucket;
  };

  for (const r of regRows) {
    const { points, invalidCount } = parseBtsLocationString(r.bts_location);
    invalidSkippedCount += invalidCount;
    for (const pt of points) {
      totalParsedRegistrationCoords++;
      const b = getOrCreateBucket(pt.lat, pt.lng);
      b.sources.add('registration');
      b.registrationCount++;
      if (r.bts_name) b.btsNames.add(String(r.bts_name));
      if (r.bts) b.btsCodes.add(String(r.bts));
      if (r.country) b.countries.add(String(r.country));
      if (r.mission) b.missions.add(String(r.mission));
    }
  }

  for (const nc of ncRows) {
    const lat = Number(nc.latitude);
    const lng = Number(nc.longitude);
    if (!isValidCoord(lat, lng)) {
      invalidSkippedCount++;
      continue;
    }
    const b = getOrCreateBucket(lat, lng);
    b.sources.add('network_cell');
    b.networkCellCount++;
    if (nc.rat) b.rats.add(String(nc.rat));
    if (nc.mcc !== null && nc.mcc !== undefined && String(nc.mcc).trim() !== '') b.mccs.add(String(nc.mcc).trim());
    if (nc.mnc !== null && nc.mnc !== undefined && String(nc.mnc).trim() !== '') b.mncs.add(String(nc.mnc).trim());
    if (nc.cell_id !== null && nc.cell_id !== undefined && String(nc.cell_id).trim() !== '') b.cellIds.add(String(nc.cell_id).trim());
    if (nc.mission) b.missions.add(String(nc.mission));
  }

  const locations = Array.from(mapByCoord.values()).map(b => {
    const source: 'registration' | 'network_cell' | 'both' =
      b.sources.has('registration') && b.sources.has('network_cell')
        ? 'both'
        : b.sources.has('registration')
        ? 'registration'
        : 'network_cell';

    return {
      key: b.key,
      lat: b.lat,
      lng: b.lng,
      source,
      registrationCount: b.registrationCount,
      networkCellCount: b.networkCellCount,
      totalCount: b.registrationCount + b.networkCellCount,
      btsNames: Array.from(b.btsNames),
      btsCodes: Array.from(b.btsCodes),
      countries: Array.from(b.countries),
      rats: Array.from(b.rats),
      mccs: Array.from(b.mccs),
      mncs: Array.from(b.mncs),
      cellIds: Array.from(b.cellIds).slice(0, 20),
      missions: Array.from(b.missions),
    };
  });

  return {
    locations,
    stats: {
      totalParsedRegistrationCoords,
      uniqueLocations: locations.length,
      registrationLocationsCount: locations.filter(l => l.source === 'registration' || l.source === 'both').length,
      networkCellLocationsCount: locations.filter(l => l.source === 'network_cell' || l.source === 'both').length,
      invalidSkippedCount,
    },
  };
}

/**
 * 2.3 Network Cells by MCC (distinct non-null cellId per non-null mcc, preserving leading zeros)
 */
export function getNetworkCellsByMcc(filters: Partial<DashboardFilters> = {}, targetDb: DatabaseSync = db) {
  const { whereSql, params } = buildNetworkCellWhere(filters, targetDb);
  const baseClauses = whereSql ? [whereSql.replace(/^WHERE\s+/i, '')] : [];
  baseClauses.push(`mcc IS NOT NULL AND TRIM(mcc) != ''`);
  baseClauses.push(`cell_id IS NOT NULL AND TRIM(cell_id) != ''`);

  const rows = targetDb.prepare(`
    SELECT TRIM(mcc) as mcc,
           COUNT(DISTINCT TRIM(cell_id)) as distinctCellCount,
           COUNT(*) as totalRecords
    FROM network_cells
    WHERE ${baseClauses.join(' AND ')}
    GROUP BY TRIM(mcc)
    ORDER BY distinctCellCount DESC, totalRecords DESC, mcc ASC
  `).all(...params) as Array<{ mcc: string; distinctCellCount: number; totalRecords: number }>;

  // Resolve MCC -> country via PlmnStorage (supporting exact string & leading-zero-normalized lookup)
  const plmnCountries = targetDb.prepare(`
    SELECT TRIM(mcc) as mcc, GROUP_CONCAT(DISTINCT country) as countries
    FROM plmn_storage
    GROUP BY TRIM(mcc)
  `).all() as Array<{ mcc: string; countries: string }>;
  const countryLookup = new Map<string, string>();
  const normalizedCountryLookup = new Map<string, string>();
  for (const p of plmnCountries) {
    if (p.countries) {
      const list = p.countries.split(',').map(s => s.trim()).filter(Boolean);
      const label = list.join(' / ');
      countryLookup.set(String(p.mcc).trim(), label);
      normalizedCountryLookup.set(stripLeadingZeros(p.mcc), label);
    }
  }

  const totalDistinct = rows.reduce((sum, r) => sum + Number(r.distinctCellCount), 0);
  const bluePalette = ['#1D4ED8', '#2563EB', '#3B82F6', '#0284C7', '#0EA5E9', '#38BDF8', '#60A5FA'];

  return {
    titleAr: 'إجمالي الخلايا المرصودة لكل دولة',
    titleEn: 'Total Observed Network Cells by Country (MCC)',
    totalDistinctCells: totalDistinct,
    items: rows.map((r, idx) => {
      const mccStr = String(r.mcc).trim();
      const mccNorm = stripLeadingZeros(mccStr);
      const country =
        countryLookup.get(mccStr) ||
        normalizedCountryLookup.get(mccNorm) ||
        FALLBACK_MCC_COUNTRIES[mccStr] ||
        FALLBACK_MCC_COUNTRIES[mccNorm] ||
        `MCC ${mccStr}`;
      return {
        rank: idx + 1,
        mcc: mccStr,
        country,
        label: `${country} (${mccStr})`,
        distinctCellCount: Number(r.distinctCellCount),
        totalRecords: Number(r.totalRecords),
        percentageShare: totalDistinct > 0 ? Number(((Number(r.distinctCellCount) / totalDistinct) * 100).toFixed(2)) : 0,
        color: bluePalette[Math.min(idx, bluePalette.length - 1)],
      };
    }),
  };
}

/**
 * 2.4 Military Mobile Networks: ONLY (602,10), (602,11), and (425,25)
 */
export function getMilitaryNetworks(filters: Partial<DashboardFilters> = {}, targetDb: DatabaseSync = db) {
  const { whereSql, params } = buildNetworkCellWhere(filters, targetDb);
  const baseClauses = whereSql ? [whereSql.replace(/^WHERE\s+/i, '')] : [];
  baseClauses.push(`((LTRIM(TRIM(mcc), '0') = '602' AND LTRIM(TRIM(mnc), '0') IN ('10', '11')) OR (LTRIM(TRIM(mcc), '0') = '425' AND LTRIM(TRIM(mnc), '0') = '25'))`);

  const rows = targetDb.prepare(`
    SELECT TRIM(mcc) as mcc, TRIM(mnc) as mnc,
           COUNT(DISTINCT CASE WHEN cell_id IS NOT NULL AND TRIM(cell_id) != '' THEN TRIM(cell_id) END) as distinctCellCount,
           COUNT(*) as totalRecords
    FROM network_cells
    WHERE ${baseClauses.join(' AND ')}
    GROUP BY TRIM(mcc), TRIM(mnc)
    ORDER BY distinctCellCount DESC, totalRecords DESC, mcc ASC, mnc ASC
  `).all(...params) as Array<{ mcc: string; mnc: string; distinctCellCount: number; totalRecords: number }>;

  const items = rows.map((r, idx) => {
    const mccStr = String(r.mcc).trim();
    const mncStr = String(r.mnc).trim();
    const spec = MILITARY_NETWORK_MAP.find(
      m => m.mcc === stripLeadingZeros(mccStr) && m.mnc === stripLeadingZeros(mncStr)
    )!;
    return {
      rank: idx + 1,
      mcc: mccStr,
      mnc: mncStr,
      plmn: `${mccStr}-${mncStr}`,
      operator: spec.operator,
      country: spec.country,
      label: `${spec.operator} (${mccStr}/${mncStr})`,
      distinctCellCount: Number(r.distinctCellCount),
      totalRecords: Number(r.totalRecords),
      color: spec.color,
    };
  });

  return {
    titleAr: 'شبكات الاتصال بالهواتف المحمولة العسكرية (الإسرائيلية والمصرية)',
    titleEn: 'Military Mobile Networks (Israeli & Egyptian)',
    totalDistinctCells: items.reduce((s, i) => s + i.distinctCellCount, 0),
    totalRecords: items.reduce((s, i) => s + i.totalRecords, 0),
    items,
  };
}

/**
 * 2.5 Civilian Mobile Networks (Israel, Palestine, UAE), explicitly excluding 602/1..4,10,11 and 425/24
 */
export function getCivilianNetworks(filters: Partial<DashboardFilters> = {}, targetDb: DatabaseSync = db) {
  const { whereSql, params } = buildNetworkCellWhere(filters, targetDb);
  const baseClauses = whereSql ? [whereSql.replace(/^WHERE\s+/i, '')] : [];
  const validPairClauses = CIVILIAN_NETWORK_MAP.map(
    m => `(LTRIM(TRIM(mcc), '0') = '${m.mcc}' AND LTRIM(TRIM(mnc), '0') = '${m.mnc}')`
  ).join(' OR ');
  baseClauses.push(`(${validPairClauses})`);

  const rows = targetDb.prepare(`
    SELECT TRIM(mcc) as mcc, TRIM(mnc) as mnc,
           COUNT(DISTINCT CASE WHEN cell_id IS NOT NULL AND TRIM(cell_id) != '' THEN TRIM(cell_id) END) as distinctCellCount,
           COUNT(*) as totalRecords
    FROM network_cells
    WHERE ${baseClauses.join(' AND ')}
    GROUP BY TRIM(mcc), TRIM(mnc)
  `).all(...params) as Array<{ mcc: string; mnc: string; distinctCellCount: number; totalRecords: number }>;

  const mapped = rows
    .filter(r => !CIVILIAN_EXCLUDED_PAIRS.has(`${stripLeadingZeros(r.mcc)}:${stripLeadingZeros(r.mnc)}`))
    .map(r => {
      const mccStr = String(r.mcc).trim();
      const mncStr = String(r.mnc).trim();
      const spec = CIVILIAN_NETWORK_MAP.find(
        m => m.mcc === stripLeadingZeros(mccStr) && m.mnc === stripLeadingZeros(mncStr)
      )!;
      return {
        mcc: mccStr,
        mnc: mncStr,
        plmn: `${mccStr}/${mncStr}`,
        country: spec.country,
        operator: spec.operator,
        distinctCellCount: Number(r.distinctCellCount),
        totalRecords: Number(r.totalRecords),
        color: spec.color,
      };
    });

  // Sort by country then distinctCellCount descending, compute per-country rank (1 = largest in country group)
  const countryOrder: Record<string, number> = { Israel: 1, Palestine: 2, 'United Arab Emirates': 3 };
  mapped.sort((a, b) => {
    const ca = countryOrder[a.country] || 99;
    const cb = countryOrder[b.country] || 99;
    if (ca !== cb) return ca - cb;
    if (b.distinctCellCount !== a.distinctCellCount) return b.distinctCellCount - a.distinctCellCount;
    return b.totalRecords - a.totalRecords;
  });

  const rankCounters = new Map<string, number>();
  const items = mapped.map(item => {
    const nextRank = (rankCounters.get(item.country) || 0) + 1;
    rankCounters.set(item.country, nextRank);
    return {
      ...item,
      rank: nextRank,
      label: `${item.operator} (${item.plmn})`,
    };
  });

  return {
    titleAr: 'شبكات اتصالات الهواتف المحمولة المدنية (الإسرائيلية والفلسطينية والإماراتية)',
    titleEn: 'Civilian Mobile Networks (Israeli, Palestinian & UAE)',
    totalDistinctCells: items.reduce((s, i) => s + i.distinctCellCount, 0),
    totalRecords: items.reduce((s, i) => s + i.totalRecords, 0),
    items,
  };
}

export function getDashboardQualityStats(
  filters: Partial<DashboardFilters> = {},
  targetDb: DatabaseSync = db
) {
  const regWhere = buildRegistrationWhere(filters, targetDb);
  const missionWhere = resolveMissionWhere(filters, targetDb);
  const mFilterSql = missionWhere.clause ? `WHERE ${missionWhere.clause}` : '';

  const safeScalar = (sql: string, params: any[] = []): number => {
    try {
      const row = targetDb.prepare(sql).get(...params) as { val?: number } | undefined;
      return row && row.val !== undefined && row.val !== null ? Number(row.val) : 0;
    } catch {
      return 0;
    }
  };

  const totalRegistrations = safeScalar(
    `SELECT COUNT(*) as val FROM registrations ${regWhere.whereSql}`,
    regWhere.params
  );
  const totalGpsHistory = safeScalar(
    `SELECT COUNT(*) as val FROM gps_history ${mFilterSql}`,
    missionWhere.params
  );
  const missingRegIds = safeScalar(
    `SELECT COUNT(*) as val FROM registrations ${regWhere.whereSql ? `${regWhere.whereSql} AND` : 'WHERE'} (reg_id IS NULL OR reg_id = '')`,
    regWhere.params
  );
  const missingImsi = safeScalar(
    `SELECT COUNT(*) as val FROM registrations ${regWhere.whereSql ? `${regWhere.whereSql} AND` : 'WHERE'} (imsi IS NULL OR imsi = '')`,
    regWhere.params
  );
  const invalidGps = safeScalar(
    `SELECT COUNT(*) as val FROM gps_history ${mFilterSql ? `${mFilterSql} AND` : 'WHERE'} (latitude < -90 OR latitude > 90 OR longitude < -180 OR longitude > 180)`,
    missionWhere.params
  );
  const pendingAmbiguities = safeScalar(
    `SELECT COUNT(*) as val FROM migration_ambiguities WHERE status = 'PENDING'`
  );

  return {
    totalChecked: totalRegistrations + totalGpsHistory,
    validRecords: Math.max(0, (totalRegistrations + totalGpsHistory) - (missingRegIds + missingImsi + invalidGps)),
    issuesFound: missingRegIds + missingImsi + invalidGps + pendingAmbiguities,
    pendingAmbiguities,
    breakdown: [
      { issue: 'Missing Device Identifier (IMSI/RegID)', count: missingRegIds + missingImsi },
      { issue: 'Out-of-bound GPS Coordinates', count: invalidGps },
      { issue: 'Ambiguous Mission Links Pending Review', count: pendingAmbiguities },
    ],
  };
}

export function getDashboardKpiSummary(
  filters: Partial<DashboardFilters> = {},
  targetDb: DatabaseSync = db
) {
  const regWhere = buildRegistrationWhere(filters, targetDb);
  const ncWhere = buildNetworkCellWhere(filters, targetDb);
  const missionWhere = resolveMissionWhere(filters, targetDb);

  const safeScalar = (sql: string, params: any[] = []): number => {
    try {
      const row = targetDb.prepare(sql).get(...params) as { val?: number } | undefined;
      return row && row.val !== undefined && row.val !== null ? Number(row.val) : 0;
    } catch {
      return 0;
    }
  };

  const totalRegistrations = safeScalar(`SELECT COUNT(*) as val FROM registrations ${regWhere.whereSql}`, regWhere.params);
  const distinctImsis = safeScalar(
    `SELECT COUNT(DISTINCT imsi) as val FROM registrations ${regWhere.whereSql ? `${regWhere.whereSql} AND` : 'WHERE'} imsi IS NOT NULL AND TRIM(imsi) != '' AND TRIM(imsi) != '0'`,
    regWhere.params
  );
  const distinctImeis = safeScalar(
    `SELECT COUNT(DISTINCT imei) as val FROM registrations ${regWhere.whereSql ? `${regWhere.whereSql} AND` : 'WHERE'} imei IS NOT NULL AND TRIM(imei) != '' AND TRIM(imei) != '0'`,
    regWhere.params
  );
  const countriesRepresented = safeScalar(
    `SELECT COUNT(DISTINCT TRIM(country)) as val FROM registrations ${regWhere.whereSql ? `${regWhere.whereSql} AND` : 'WHERE'} country IS NOT NULL AND TRIM(country) != ''`,
    regWhere.params
  );

  const totalNetworkCells = safeScalar(`SELECT COUNT(*) as val FROM network_cells ${ncWhere.whereSql}`, ncWhere.params);
  const distinctNetworkCells = safeScalar(
    `SELECT COUNT(DISTINCT TRIM(cell_id)) as val FROM network_cells ${ncWhere.whereSql ? `${ncWhere.whereSql} AND` : 'WHERE'} cell_id IS NOT NULL AND TRIM(cell_id) != ''`,
    ncWhere.params
  );
  const networkCellsWithValidCoords = safeScalar(
    `SELECT COUNT(*) as val FROM network_cells ${ncWhere.whereSql ? `${ncWhere.whereSql} AND` : 'WHERE'} latitude IS NOT NULL AND longitude IS NOT NULL AND NOT (latitude = 0 AND longitude = 0) AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180`,
    ncWhere.params
  );

  const totalMissions = filters.missionIds && filters.missionIds.length > 0
    ? safeScalar(
        `SELECT COUNT(*) as val FROM missions WHERE id IN (${filters.missionIds.map(() => '?').join(', ')})`,
        filters.missionIds
      )
    : safeScalar(`SELECT COUNT(*) as val FROM missions`);

  const btsMap = getBtsMapData(filters, targetDb);
  const militaryNetworks = getMilitaryNetworks(filters, targetDb);
  const civilianNetworks = getCivilianNetworks(filters, targetDb);

  const mFilterSql = missionWhere.clause ? `WHERE ${missionWhere.clause}` : '';
  const totalTargets = safeScalar(`SELECT COUNT(*) as val FROM targets ${mFilterSql}`, missionWhere.params);
  const totalGpsHistory = safeScalar(`SELECT COUNT(*) as val FROM gps_history ${mFilterSql}`, missionWhere.params);
  const totalWifiPoints = safeScalar(`SELECT COUNT(*) as val FROM wifi_access_points ${mFilterSql}`, missionWhere.params);
  const totalMapCells = safeScalar(`SELECT COUNT(*) as val FROM map_cells`);
  const totalFiles = safeScalar(`SELECT COUNT(*) as val FROM mission_files`) + safeScalar(`SELECT COUNT(*) as val FROM location_files`) + safeScalar(`SELECT COUNT(*) as val FROM target_files`);
  const totalImports = safeScalar(`SELECT COUNT(*) as val FROM import_history`);
  const totalOperationalRecords = totalRegistrations + totalTargets + totalNetworkCells + totalGpsHistory + totalWifiPoints + totalMapCells;

  return {
    totalRegistrations,
    distinctImsis,
    distinctImeis,
    totalNetworkCells,
    distinctNetworkCells,
    totalMissions,
    countriesRepresented,
    totalBtsLocations: btsMap.stats.registrationLocationsCount,
    networkCellsWithValidCoords,
    militaryNetworkCells: militaryNetworks.totalDistinctCells,
    civilianNetworkCells: civilianNetworks.totalDistinctCells,
    totalTargets,
    totalGpsHistory,
    totalWifiPoints,
    totalMapCells,
    totalFiles,
    totalImports,
    totalOperationalRecords,
  };
}

export function getDashboardOperationalPanels(
  filters: Partial<DashboardFilters> = {},
  targetDb: DatabaseSync = db
) {
  const regWhere = buildRegistrationWhere(filters, targetDb);
  const ncWhere = buildNetworkCellWhere(filters, targetDb);

  let recordsByMission: any[] = [];
  try {
    const mClause = filters.missionIds && filters.missionIds.length > 0
      ? `WHERE m.id IN (${filters.missionIds.map(() => '?').join(', ')})`
      : '';
    const mParams = filters.missionIds && filters.missionIds.length > 0 ? filters.missionIds : [];
    recordsByMission = targetDb.prepare(`
      SELECT m.id as missionId,
             m.mission,
             m.location,
             (SELECT COUNT(*) FROM registrations WHERE mission_id = m.id) as registrations,
             (SELECT COUNT(*) FROM network_cells WHERE mission_id = m.id) as networkCells,
             (SELECT COUNT(*) FROM targets WHERE mission_id = m.id) as targets
      FROM missions m
      ${mClause}
      ORDER BY registrations DESC, m.id ASC
      LIMIT 12
    `).all(...mParams);
  } catch {
    recordsByMission = [];
  }

  let cellsByRat: any[] = [];
  try {
    cellsByRat = targetDb.prepare(`
      SELECT COALESCE(rat, 'Unknown') as rat, COUNT(DISTINCT COALESCE(cell_id, id)) as count, COUNT(*) as totalRecords
      FROM network_cells
      ${ncWhere.whereSql}
      GROUP BY rat
      ORDER BY count DESC
    `).all(...ncWhere.params);
  } catch {
    cellsByRat = [];
  }

  let activityTimeline: any[] = [];
  try {
    activityTimeline = targetDb.prepare(`
      SELECT strftime('%Y-%m-%d %H:00', last_seen) as hour_slot, COUNT(*) as registrations
      FROM registrations
      ${regWhere.whereSql ? `${regWhere.whereSql} AND` : 'WHERE'} last_seen IS NOT NULL
      GROUP BY hour_slot
      ORDER BY hour_slot ASC
      LIMIT 24
    `).all(...regWhere.params);
  } catch {
    activityTimeline = [];
  }

  const qualityStats = getDashboardQualityStats(filters, targetDb);

  return {
    recordsByMission,
    cellsByRat,
    activityTimeline,
    qualityStats,
  };
}

export type DashboardWidgetId =
  | 'kpis'
  | 'registrationsByCountry'
  | 'btsMap'
  | 'networkCellsByMcc'
  | 'militaryNetworks'
  | 'civilianNetworks'
  | 'operationalSummary'
  | 'qualityStats';

export function getDashboardWidget(
  widgetId: DashboardWidgetId,
  filters: Partial<DashboardFilters> = {},
  targetDb: DatabaseSync = db
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
    case 'operationalSummary':
      return getDashboardOperationalPanels(filters, targetDb);
    case 'qualityStats':
      return getDashboardQualityStats(filters, targetDb);
    default:
      throw new Error(`Unknown dashboard widget: ${widgetId}`);
  }
}

/**
 * Computes all 11 enhanced Phase 2 KPIs + legacy compatibility KPIs + 5 analytics sections + BTS map summary.
 */
export function getDashboardKPIs(filters: Partial<DashboardFilters> | string = {}, targetDb: DatabaseSync = db) {
  const normalizedFilters: Partial<DashboardFilters> =
    typeof filters === 'string' ? { mission: filters } : (filters || {});

  const kpis = getDashboardKpiSummary(normalizedFilters, targetDb);
  const registrationsByCountry = getRegistrationsByCountry(normalizedFilters, targetDb);
  const btsMap = getBtsMapData(normalizedFilters, targetDb);
  const networkCellsByMcc = getNetworkCellsByMcc(normalizedFilters, targetDb);
  const militaryNetworks = getMilitaryNetworks(normalizedFilters, targetDb);
  const civilianNetworks = getCivilianNetworks(normalizedFilters, targetDb);
  const operational = getDashboardOperationalPanels(normalizedFilters, targetDb);

  return {
    kpis,
    registrationsByCountry,
    btsMap,
    networkCellsByMcc,
    militaryNetworks,
    civilianNetworks,
    recordsByMission: operational.recordsByMission,
    recordsByCountry: registrationsByCountry.items.map(i => ({ country: i.country, count: i.distinctImsiCount })),
    cellsByRat: operational.cellsByRat,
    activityTimeline: operational.activityTimeline,
    qualityStats: operational.qualityStats,
  };
}

/**
 * Returns searchable filter dropdown options directly from the live database.
 */
export function getDashboardFilterOptions(targetDb: DatabaseSync = db) {
  const distinctStrings = (sql: string): string[] => {
    try {
      return (targetDb.prepare(sql).all() as Array<{ val: string }>).map(r => r.val).filter(Boolean);
    } catch {
      return [];
    }
  };
  const distinctNums = (sql: string): number[] => {
    try {
      return (targetDb.prepare(sql).all() as Array<{ val: number }>).map(r => Number(r.val)).filter(Number.isFinite);
    } catch {
      return [];
    }
  };

  const missions = targetDb
    .prepare(`SELECT id, mission, mission_name as missionName, location, created_at as createdAt FROM missions ORDER BY id ASC`)
    .all();

  return {
    missions,
    registrations: {
      countries: distinctStrings(`SELECT DISTINCT TRIM(country) as val FROM registrations WHERE country IS NOT NULL AND TRIM(country) != '' ORDER BY val`),
      countryCodes: distinctStrings(`SELECT DISTINCT UPPER(TRIM(country_code)) as val FROM registrations WHERE country_code IS NOT NULL AND TRIM(country_code) != '' ORDER BY val`),
      ueModels: distinctStrings(`SELECT DISTINCT ue_model as val FROM registrations WHERE ue_model IS NOT NULL AND TRIM(ue_model) != '' ORDER BY val`),
      btsNames: distinctStrings(`SELECT DISTINCT bts_name as val FROM registrations WHERE bts_name IS NOT NULL AND TRIM(bts_name) != '' ORDER BY val`),
      actions: distinctStrings(`SELECT DISTINCT action as val FROM registrations WHERE action IS NOT NULL AND TRIM(action) != '' ORDER BY val`),
      updates: distinctStrings(`SELECT DISTINCT "update" as val FROM registrations WHERE "update" IS NOT NULL AND TRIM("update") != '' ORDER BY val`),
    },
    networkCells: {
      rats: distinctStrings(`SELECT DISTINCT rat as val FROM network_cells WHERE rat IS NOT NULL AND TRIM(rat) != '' ORDER BY val`),
      mccs: distinctStrings(`SELECT DISTINCT TRIM(mcc) as val FROM network_cells WHERE mcc IS NOT NULL AND TRIM(mcc) != '' ORDER BY val`),
      mncs: distinctStrings(`SELECT DISTINCT TRIM(mnc) as val FROM network_cells WHERE mnc IS NOT NULL AND TRIM(mnc) != '' ORDER BY val`),
    },
    plmnEntries: targetDb.prepare(`SELECT mcc, mnc, country, code, name FROM plmn_storage ORDER BY mcc, mnc`).all(),
  };
}

// Dynamic Custom Analytics Query Builder (preserves Phase 1 /api/v1/analytics/query)
export function executeDynamicAnalytics(options: {
  table: string;
  dimensionCol: string;
  metricCol?: string;
  aggregation: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX';
  mission?: string;
  missionIds?: number[];
  limit?: number;
}) {
  const limit = Math.min(100, Math.max(5, options.limit || 20));
  const whereClauses: string[] = [];
  const params: any[] = [];

  if (options.missionIds && options.missionIds.length > 0) {
    whereClauses.push(`mission_id IN (${options.missionIds.map(() => '?').join(', ')})`);
    params.push(...options.missionIds);
  } else if (options.mission && options.mission !== 'ALL') {
    const asId = Number(options.mission);
    if (!Number.isNaN(asId) && Number.isInteger(asId) && asId > 0) {
      whereClauses.push('mission_id = ?');
      params.push(asId);
    } else {
      whereClauses.push('mission = ?');
      params.push(options.mission);
    }
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  let aggExpr = 'COUNT(*)';
  if (options.metricCol && options.aggregation !== 'COUNT') {
    aggExpr = `${options.aggregation}("${options.metricCol}")`;
  }

  const sql = `
    SELECT "${options.dimensionCol}" as dimension, ${aggExpr} as value
    FROM "${options.table}"
    ${whereSql}
    GROUP BY "${options.dimensionCol}"
    ORDER BY value DESC
    LIMIT ?
  `;

  try {
    const stmt = db.prepare(sql);
    return stmt.all(...params, limit);
  } catch (err: any) {
    throw new Error(`Analytics Query Error: ${err.message}`);
  }
}
