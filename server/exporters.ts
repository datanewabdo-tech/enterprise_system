import ExcelJS from 'exceljs';
import { db, queryTable, getTableColumns } from './db.js';

export async function exportDataset(options: {
  tableName: string;
  format: 'xlsx' | 'csv' | 'json' | 'geojson';
  mission?: string;
  search?: string;
  filters?: any[];
  username?: string;
}) {
  // Query data (up to 10,000 records for export)
  const result = queryTable(options.tableName, {
    page: 1,
    pageSize: 10000,
    mission: options.mission,
    search: options.search,
    filters: options.filters,
  });

  const records = result.data as Record<string, any>[];

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
    `Exported ${records.length} records in ${options.format.toUpperCase()} format`
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
    const csvContent = [headerRow, ...rows].join('\n');

    return {
      contentType: 'text/csv',
      filename: `${options.tableName}_export_${Date.now()}.csv`,
      content: Buffer.from(csvContent),
    };
  }

  // Excel (.xlsx)
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(options.tableName);
  const columns = getTableColumns(options.tableName).map(c => ({
    header: c.name,
    key: c.name,
    width: Math.max(12, c.name.length + 3),
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
    worksheet.addRow(r);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    filename: `${options.tableName}_export_${Date.now()}.xlsx`,
    content: Buffer.from(buffer),
  };
}
