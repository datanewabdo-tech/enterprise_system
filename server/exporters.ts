import ExcelJS from 'exceljs';
import { db, queryTable, getTableColumns } from './db.js';
import { maskSensitiveRecord } from './auth.js';

const IDENTIFIER_TEXT_COLUMNS = new Set([
  'reg_id', 'imsi', 'imei', 'tmsi',
  'mcc', 'mnc', 'lac', 'cell_id',
  'cid', 'bsic', 'psc', 'pci',
  'tac', 'tac_id', 'bssid', 'mac',
  'cid_lac_mnc',
]);

interface ExportOptions {
  tableName: string;
  format: 'xlsx' | 'csv' | 'json' | 'geojson';
  mission?: string;
  search?: string;
  filters?: any[];
  username?: string;
  userId?: number;
  ipAddress?: string;
  canUnmask?: boolean;
}

interface ExportResult {
  contentType: string;
  filename: string;
  content: Buffer;
}

// PostgreSQL BigInt serialization support
function serializeJSON(data: any): string {
  return JSON.stringify(
    data,
    (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    2
  );
}

// Safe CSV escaping
function escapeCSV(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  let str = String(value);

  // Prevent spreadsheet formula injection, but leave real numbers alone
  // (otherwise negative values such as -12.5 become text).
  const isNumeric =
    typeof value === 'number' || typeof value === 'bigint' ||
    /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(str.trim());

  if (!isNumeric && /^[\s]*[=+\-@]/.test(str)) {
    str = "'" + str;
  }

  return `"${str.replace(/"/g, '""')}"`;
}

// Parse BTS coordinates
function parseCoordinates(record: Record<string, any>): {
  lat: number;
  lng: number;
} | null {
  let lat = record.latitude ?? record.lat;
  let lng = record.longitude ?? record.lng;

  // Support both Prisma camelCase and SQLite-style column names
  const btsLocation = record.bts_location ?? record.btsLocation;

  if (
    (lat === null || lat === undefined || lat === '') ||
    (lng === null || lng === undefined || lng === '')
  ) {
    if (btsLocation) {
      const parts = String(btsLocation)
        .trim()
        .split(/[\r\n;,]+/)
        .map((part: string) => part.trim())
        .filter(Boolean);

      if (parts.length >= 2) {
        lat = parts[0];
        lng = parts[1];
      }
    }
  }

  lat = Number(lat);
  lng = Number(lng);

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return null;
  }

  return { lat, lng };
}

function safeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

// Main export function
export async function exportDataset(
  options: ExportOptions
): Promise<ExportResult> {

  const {
    tableName,
    format,
    mission,
    search,
    filters,
    username = 'system',
    userId,
    ipAddress,
    canUnmask = false,
  } = options;

  const timestamp = Date.now();
  const filenameBase = `${safeFilename(tableName)}_export_${timestamp}`;

  // 1. Retrieve ALL matching records (queryTable caps a page at 10,000 rows,
  //    so page through instead of silently truncating the export).
  const PAGE_SIZE = 10000;
  const MAX_EXPORT_ROWS = 500000;
  const fetchedRows: Record<string, any>[] = [];

  for (let page = 1; fetchedRows.length < MAX_EXPORT_ROWS; page++) {
    const chunk = await queryTable(tableName, {
      page,
      pageSize: PAGE_SIZE,
      mission,
      search,
      filters,
      sortOrder: 'ASC',
    });

    fetchedRows.push(...chunk.rows);

    if (chunk.rows.length < PAGE_SIZE || fetchedRows.length >= chunk.total) break;
  }

  const result = { rows: fetchedRows };

  const allowUnmask = Boolean(canUnmask);

  const records = (
    result.rows as Record<string, any>[]
  ).map(record =>
    maskSensitiveRecord(record, allowUnmask)
  );

  // 2. Retrieve database column metadata
  const columnMetadata = await getTableColumns(tableName);
  const columns = columnMetadata.map(column => column.name);

  let exportResult: ExportResult;

  // 3. JSON Export
  if (format === 'json') {
    exportResult = {
      contentType: 'application/json; charset=utf-8',
      filename: `${filenameBase}.json`,
      content: Buffer.from(serializeJSON(records), 'utf8'),
    };
  }

  // 4. GeoJSON Export
  else if (format === 'geojson') {
    const features: any[] = [];
    let invalidCoordinates = 0;

    for (const record of records) {
      const coordinates = parseCoordinates(record);

      if (!coordinates) {
        invalidCoordinates++;
        continue;
      }

      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [
            coordinates.lng,
            coordinates.lat,
          ],
        },
        properties: record,
      });
    }

    const geojson = {
      type: 'FeatureCollection',
      name: `${tableName}_layer`,
      crs: {
        type: 'name',
        properties: {
          name: 'EPSG:4326',
        },
      },
      features,
    };

    exportResult = {
      contentType: 'application/geo+json',
      filename: `${filenameBase}.geojson`,
      content: Buffer.from(serializeJSON(geojson), 'utf8'),
    };

    console.info(
      `GeoJSON export: ${features.length} valid coordinates, ${invalidCoordinates} invalid coordinates`
    );
  }

  // 5. CSV Export
  else if (format === 'csv') {
    const headerRow = columns.map(escapeCSV).join(',');

    const rows = records.map(record =>
      columns.map(column =>
        escapeCSV(record[column])
      ).join(',')
    );

    const csvContent =
      '\uFEFF' +
      [headerRow, ...rows].join('\r\n');

    exportResult = {
      contentType: 'text/csv; charset=utf-8',
      filename: `${filenameBase}.csv`,
      content: Buffer.from(csvContent, 'utf8'),
    };
  }

  // 6. Excel Export
  else {
    const workbook = new ExcelJS.Workbook();

    workbook.creator = 'Enterprise Data Management Dashboard';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet(
      safeFilename(tableName).substring(0, 31)
    );

    worksheet.columns = columnMetadata.map(column => ({
      header: column.name,
      key: column.name,
      width: Math.max(14, column.name.length + 4),
    }));

    // Header styling
    worksheet.getRow(1).font = {
      bold: true,
      color: { argb: 'FFFFFFFF' },
    };

    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E293B' },
    };

    worksheet.getRow(1).alignment = {
      vertical: 'middle',
      horizontal: 'center',
    };

    worksheet.views = [
      { state: 'frozen', ySplit: 1 },
    ];

    // Add data
    for (const record of records) {
      const rowObject: Record<string, any> = {};

      for (const column of columnMetadata) {
        const name = column.name;
        const value = record[name];

        if (value === null || value === undefined) {
          rowObject[name] = null;
        } else if (IDENTIFIER_TEXT_COLUMNS.has(name)) {
          rowObject[name] = String(value);
        } else if (typeof value === 'bigint') {
          rowObject[name] = value.toString();
        } else {
          rowObject[name] = value;
        }
      }

      const row = worksheet.addRow(rowObject);

      columnMetadata.forEach((column, index) => {
        if (IDENTIFIER_TEXT_COLUMNS.has(column.name)) {
          row.getCell(index + 1).numFmt = '@';
        }
      });
    }

    worksheet.autoFilter = {
      from: {
        row: 1,
        column: 1,
      },
      to: {
        row: 1,
        column: Math.max(columns.length, 1),
      },
    };

    const buffer = await workbook.xlsx.writeBuffer();

    exportResult = {
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: `${filenameBase}.xlsx`,
      content: Buffer.from(buffer),
    };
  }

  // 7. Record export history in PostgreSQL
  try {
    const historyData = {
      username,
      format: format.toUpperCase(),
      scope: tableName,
      selectedMissions: mission ?? null,
      appliedFilters: JSON.stringify({
        search: search ?? null,
        filters: filters ?? [],
      }),
      status: 'COMPLETED',
      fileName: exportResult.filename,
      fileSize: exportResult.content.length,
      ...(userId !== undefined ? { userId } : {}),
    };

    await db.$transaction([
      db.exportHistory.create({
        data: historyData,
      }),

      db.auditLog.create({
        data: {
          ...(userId !== undefined ? { userId } : {}),
          username,
          action: 'DATA_EXPORT',
          module: tableName,
          recordId: format.toUpperCase(),
          ipAddress: ipAddress ?? null,
          result: 'SUCCESS',
          details:
            `Exported ${records.length} records in ${format.toUpperCase()} format. Unmasked=${allowUnmask}`,
        },
      }),
    ]);
  } catch (error) {
    // Do not lose a completed export because of an audit failure.
    console.error('Export audit logging failed:', error);
  }

  return exportResult;
}