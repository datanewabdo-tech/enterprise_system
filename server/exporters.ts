import ExcelJS from 'exceljs';
import { db, queryTable, getTableColumns } from './db.js';
import { maskSensitiveRecord } from './auth.js';

const IDENTIFIER_TEXT_COLUMNS = new Set([
  'reg_id',
  'imsi',
  'imei',
  'tmsi',
  'mcc',
  'mnc',
  'lac',
  'cell_id',
  'cid',
  'bsic',
  'psc',
  'pci',
  'tac',
  'tac_id',
  'bssid',
  'mac',
  'cid_lac_mnc',
]);

export async function exportDataset(options: {
  tableName: string;
  format: 'xlsx' | 'csv' | 'json' | 'geojson';
  mission?: string;
  search?: string;
  filters?: any[];
  username?: string;
  canUnmask?: boolean;
}) {
  // Query data (up to 10,000 records for export)
  const result = queryTable(options.tableName, {
    page: 1,
    pageSize: 10000,
    mission: options.mission,
    search: options.search,
    filters: options.filters,
  });

  const allowUnmask = Boolean(options.canUnmask);
  const records = (result.data as Record<string, any>[]).map(r => maskSensitiveRecord(r, allowUnmask));

  // Audit Log
  db.prepare(`
    INSERT INTO audit_logs (username, action, module, record_id, ip_address, result, details)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    options.username || 'admin',
    'DATA_EXPORT',
    options.tableName,
    options.format.toUpperCase(),
    '127.0.0.1',
    'SUCCESS',
    `Exported ${records.length} records in ${options.format.toUpperCase()} format (unmasked=${allowUnmask})`
  );

  if (options.format === 'json') {
    return {
      contentType: 'application/json',
      filename: `${options.tableName}_export_${Date.now()}.json`,
      content: Buffer.from(JSON.stringify(records, null, 2)),
    };
  }

  if (options.format === 'geojson') {
    const features: any[] = [];
    for (const r of records) {
      let lat = r.latitude ?? r.lat;
      let lng = r.longitude ?? r.lng;

      if ((lat === undefined || lng === undefined) && r.bts_location) {
        const parts = String(r.bts_location).split(/[;,]/);
        if (parts.length >= 2) {
          lat = parseFloat(parts[0]);
          lng = parseFloat(parts[1]);
        }
      }

      if (lat !== undefined && lng !== undefined && !isNaN(lat) && !isNaN(lng)) {
        features.push({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [lng, lat],
          },
          properties: r,
        });
      }
    }

    const geojson = {
      type: 'FeatureCollection',
      name: `${options.tableName}_layer`,
      crs: { type: 'name', properties: { name: 'EPSG:4326' } },
      features,
    };

    return {
      contentType: 'application/geo+json',
      filename: `${options.tableName}_export_${Date.now()}.geojson`,
      content: Buffer.from(JSON.stringify(geojson, null, 2)),
    };
  }

  if (options.format === 'csv') {
    const columns = getTableColumns(options.tableName).map(c => c.name);
    const headerRow = columns.join(',');
    const rows = records.map(rec => {
      return columns.map(c => {
        let val = rec[c];
        if (val === null || val === undefined) return '';
        val = String(val).replace(/"/g, '""');
        return `"${val}"`;
      }).join(',');
    });
    const csvContent = '\uFEFF' + [headerRow, ...rows].join('\n');

    return {
      contentType: 'text/csv; charset=utf-8',
      filename: `${options.tableName}_export_${Date.now()}.csv`,
      content: Buffer.from(csvContent, 'utf8'),
    };
  }

  // Excel (.xlsx)
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(options.tableName);
  const colMetas = getTableColumns(options.tableName);
  const columns = colMetas.map(c => ({
    header: c.name,
    key: c.name,
    width: Math.max(14, c.name.length + 4),
  }));
  worksheet.columns = columns;

  // Add stylish header styling
  worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  worksheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E293B' },
  };

  for (const r of records) {
    const rowObj: Record<string, any> = {};
    for (const cm of colMetas) {
      const val = r[cm.name];
      if (val !== null && val !== undefined && IDENTIFIER_TEXT_COLUMNS.has(cm.name)) {
        rowObj[cm.name] = String(val);
      } else {
        rowObj[cm.name] = val;
      }
    }
    const row = worksheet.addRow(rowObj);
    colMetas.forEach((cm, idx) => {
      if (IDENTIFIER_TEXT_COLUMNS.has(cm.name)) {
        row.getCell(idx + 1).numFmt = '@';
      }
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    filename: `${options.tableName}_export_${Date.now()}.xlsx`,
    content: Buffer.from(buffer),
  };
}
