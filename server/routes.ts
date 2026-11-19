
import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  db,
  queryTable,
  getRecord,
  insertRecord,
  updateRecord,
  deleteRecord,
  getTableColumns,
  getTableStats,
} from './db.js';

import {
  authenticateUser,
  generateToken,
  verifyToken,
  ROLE_PERMISSIONS,
  maskSensitiveRecord,
  AuthUser,
  UserRole,
} from './auth.js';

import {
  getDashboardKPIs,
  getDashboardWidget,
  DashboardWidgetId,
  executeDynamicAnalytics,
  getDashboardFilterOptions,
  getBtsMapData,
} from './analytics.js';

import { generateAnalyticsExport } from './analyticsExporter.js';
import {
  previewBackfillCountries,
  backfillCountries,
} from './countryDetection.js';

import {
  DashboardFilterSchema,
  MultiSqliteImportRequestSchema,
  DashboardExportRequestSchema,
  ChartExportRequestSchema,
} from './validators.js';

export const apiRouter = Router();

const execFileAsync = promisify(execFile);

const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');
const BACKUPS_DIR = path.resolve(process.cwd(), 'backups');
const EXPORTS_DIR = path.resolve(process.cwd(), 'exports');
const TILE_CACHE_DIR = path.resolve(process.cwd(), 'data', 'tile-cache');

for (const dir of [
  UPLOADS_DIR,
  BACKUPS_DIR,
  EXPORTS_DIR,
  TILE_CACHE_DIR,
]) {
  fs.mkdirSync(dir, { recursive: true });
}

function assertUploadPathSafe(inputPath: string): string {
  const resolved = path.resolve(String(inputPath || ''));

  if (!resolved.startsWith(UPLOADS_DIR + path.sep)) {
    throw new Error(
      'Path traversal rejected: file path must reside within uploads directory',
    );
  }

  return resolved;
}

function isSafeIdentifier(value: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value);
}

function quoteIdentifier(value: string): string {
  if (!isSafeIdentifier(value)) {
    throw new Error(`Invalid database identifier: ${value}`);
  }

  return `"${value}"`;
}

async function pgQuery<T = any>(
  sql: string,
  ...params: any[]
): Promise<T[]> {
  return db.$queryRawUnsafe<T[]>(sql, ...params);
}

async function pgExecute(
  sql: string,
  ...params: any[]
): Promise<number> {
  return db.$executeRawUnsafe(sql, ...params);
}

async function writeAuditLog(data: {
  userId?: number | null;
  username?: string | null;
  action: string;
  module: string;
  recordId?: string | null;
  ipAddress?: string | null;
  result?: string;
  details?: string | null;
}): Promise<void> {
  await db.auditLog.create({
    data: {
      userId: data.userId ?? null,
      username: data.username?.trim() || 'system',
      action: data.action,
      module: data.module,
      recordId: data.recordId ?? null,
      ipAddress: data.ipAddress ?? '',
      result: data.result ?? 'SUCCESS',
      details: data.details ?? null,
    },
  });
}
let cachedOfflineTilePng: Buffer | null = null;

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;

  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];

    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);

  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);

  crcBuf.writeUInt32BE(
    crc32(Buffer.concat([typeBuf, data])),
    0,
  );

  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function getOfflineFallbackTilePng(): Buffer {
  if (cachedOfflineTilePng) return cachedOfflineTilePng;

  const size = 256;
  const raw = Buffer.alloc(size * (1 + size * 3));

  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 3);
    raw[rowStart] = 0;

    for (let x = 0; x < size; x++) {
      const idx = rowStart + 1 + x * 3;
      const isGrid = x % 64 === 0 || y % 64 === 0;

      raw[idx] = isGrid ? 30 : 15;
      raw[idx + 1] = isGrid ? 41 : 23;
      raw[idx + 2] = isGrid ? 59 : 42;
    }
  }

  const ihdr = Buffer.alloc(13);

  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;

  const idat = zlib.deflateSync(raw);

  cachedOfflineTilePng = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);

  return cachedOfflineTilePng;
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) =>
    cb(
      null,
      `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`,
    ),
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
});

export function authMiddleware(
  req: Request,
  _res: Response,
  next: () => void,
) {
  const authHeader = req.headers.authorization;
  const queryToken =
    typeof req.query.token === 'string' ? req.query.token : null;

  const token =
    authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.substring(7)
      : queryToken;

  if (token) {
    const user = verifyToken(token);

    if (user) {
      (req as any).user = user;
    } else {
      (req as any).invalidToken = true;
    }
  }

  next();
}

apiRouter.use(authMiddleware);

function getUserPerms(req: Request) {
  const user = (req as any).user as AuthUser | undefined;

  if (!user) return null;

  return {
    user,
    perms: ROLE_PERMISSIONS[user.role as UserRole],
  };
}

function requireAuth(req: Request, res: Response) {
  const auth = getUserPerms(req);

  if (!auth) {
    res.status(401).json({ error: 'Authentication required' });
    return null;
  }

  return auth;
}

function parseMissionIds(value: unknown): number[] | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;

  const ids = value
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);

  return ids.length ? ids : undefined;
}

function parseFilters(value: unknown): any[] {
  if (typeof value !== 'string') return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const TABLE_MAP: Record<string, string> = {
  missions: 'missions',
  registrations: 'registrations',
  targets: 'targets',
  'mission-extras': 'mission_extras',
  'location-extras': 'location_extras',
  'mission-files': 'mission_files',
  'location-files': 'location_files',
  'network-cells': 'network_cells',
  'wifi-access-points': 'wifi_access_points',
  'wifi-access-point-clients': 'wifi_access_point_clients',
  'gps-history': 'gps_history',
  'map-cell-databases': 'map_cell_databases',
  'map-cells': 'map_cells',
  'plmn-storage': 'plmn_storage',
  'sms-calls': 'sms_calls',
  'map-user-markers': 'map_user_markers',
  'map-user-polygons': 'map_user_polygons',
  'map-user-circles': 'map_user_circles',
  'target-files': 'target_files',
  'whitelist-targets': 'whitelist_targets',
  'tac-numbers': 'tac_numbers',
  'scheduled-tasks': 'scheduled_tasks',
  'map-layers': 'map_layers',
};

function resolveTableName(urlTable: string): string {
  const table = TABLE_MAP[urlTable] || urlTable.replace(/-/g, '_');

  if (!Object.values(TABLE_MAP).includes(table)) {
    throw new Error(`Table is not allowed: ${urlTable}`);
  }

  return table;
}

const ALLOWED_WIDGET_IDS = new Set<DashboardWidgetId>([
  'kpis',
  'registrationsByCountry',
  'btsMap',
  'networkCellsByMcc',
  'militaryNetworks',
  'civilianNetworks',
  'mobileNetworksMccMnc',
  'operationalSummary',
  'qualityStats',
]);

// -----------------------------------------------------------------------------
// Map tile proxy
// -----------------------------------------------------------------------------

apiRouter.get(
  '/map/tiles/:z/:x/:y.png',
  async (req: Request, res: Response) => {
    const z = Number(req.params.z);
    const x = Number(req.params.x);
    const y = Number(req.params.y);

    if (
      !Number.isInteger(z) ||
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      z < 0 ||
      z > 19
    ) {
      return res.status(400).json({ error: 'Invalid tile coordinates' });
    }

    const maxCoord = Math.pow(2, z);

    if (x < 0 || x >= maxCoord || y < 0 || y >= maxCoord) {
      return res.status(400).json({
        error: 'Tile coordinates out of zoom bounds',
      });
    }

    const tilePath = path.resolve(
      TILE_CACHE_DIR,
      String(z),
      String(x),
      `${y}.png`,
    );

    if (!tilePath.startsWith(TILE_CACHE_DIR + path.sep)) {
      return res.status(400).json({ error: 'Invalid tile path' });
    }

    const setTileHeaders = (cacheState: string) => {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('X-Tile-Cache', cacheState);
    };

    try {
      if (fs.existsSync(tilePath)) {
        const stat = fs.statSync(tilePath);
        const ageMs = Date.now() - stat.mtimeMs;

        if (ageMs < 7 * 24 * 60 * 60 * 1000 && stat.size > 100) {
          setTileHeaders('HIT');
          return res.sendFile(tilePath);
        }
      }
    } catch {
      // Continue to upstream request.
    }

    try {
      const upstream = await fetch(
        `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
        {
          headers: {
            'User-Agent':
              'Enterprise-Mission-Mapping-Platform/3.0 (tile-proxy)',
            Accept: 'image/png,image/*;q=0.8',
          },
          signal: AbortSignal.timeout(6000),
        },
      );

      if (upstream.ok) {
        const contentType = upstream.headers.get('content-type') || '';
        const buffer = Buffer.from(await upstream.arrayBuffer());

        if (contentType.includes('image') && buffer.length > 64) {
          fs.mkdirSync(path.dirname(tilePath), { recursive: true });
          fs.writeFileSync(tilePath, buffer);
          setTileHeaders('MISS');
          return res.send(buffer);
        }
      }
    } catch {
      // Continue to stale cache or fallback.
    }

    if (fs.existsSync(tilePath)) {
      setTileHeaders('STALE');
      return res.sendFile(tilePath);
    }

    setTileHeaders('FALLBACK');
    res.setHeader('X-Tile-Fallback', 'offline');

    return res.send(getOfflineFallbackTilePng());
  },
);

// -----------------------------------------------------------------------------
// Authentication
// -----------------------------------------------------------------------------

apiRouter.post('/auth/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        error: 'Username and password are required',
      });
    }

    const result = await authenticateUser(username, password);

    if (!result) {
      try {
        await writeAuditLog({
          username,
          action: 'AUTH_FAILED',
          module: 'Authentication',
          ipAddress: req.ip || '127.0.0.1',
          result: 'DENIED',
          details: 'Invalid credentials provided',
        });
      } catch {
        // Do not expose audit logging errors to the login response.
      }

      return res.status(401).json({
        error: 'Invalid credentials or inactive account',
      });
    }

    try {
      await writeAuditLog({
        username: result.user.username,
        userId: result.user.id,
        action: 'AUTH_LOGIN',
        module: 'Authentication',
        recordId: String(result.user.id),
        ipAddress: req.ip || '127.0.0.1',
        result: 'SUCCESS',
        details: 'User logged in successfully',
      });
    } catch {
      // Login remains successful if audit logging fails.
    }

    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/auth/session', async (req: Request, res: Response) => {
  try {
    const requestedRole = req.body?.role as UserRole | undefined;

    const usernameMap: Record<string, string> = {
      SUPER_ADMIN: 'admin',
      DATA_MANAGER: 'manager',
      DATA_ANALYST: 'analyst',
      VIEWER: 'viewer',
    };

    const targetUsername =
      requestedRole && usernameMap[requestedRole]
        ? usernameMap[requestedRole]
        : 'admin';

    const row = await db.user.findFirst({
      where: {
        username: targetUsername,
        status: 'ACTIVE',
      },
    });

    if (!row) {
      return res.status(404).json({ error: 'Session user not found' });
    }

    const user: AuthUser = {
      id: row.id,
      username: row.username,
      email: row.email,
      fullName: row.fullName,
      role: row.role as UserRole,
      status: row.status,
    };

    return res.json({
      user,
      token: generateToken(user),
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/auth/me', (req: Request, res: Response) => {
  const user = (req as any).user as AuthUser | undefined;

  if (!user) {
    return res.status(401).json({ error: 'Unauthenticated' });
  }

  return res.json(user);
});

apiRouter.post('/auth/logout', async (req: Request, res: Response) => {
  const user = (req as any).user as AuthUser | undefined;

  if (user) {
    try {
      await writeAuditLog({
        userId: user.id,
        username: user.username,
        action: 'AUTH_LOGOUT',
        module: 'Authentication',
        recordId: String(user.id),
        ipAddress: req.ip || '127.0.0.1',
        result: 'SUCCESS',
        details: 'User logged out',
      });
    } catch {
      // Preserve logout response.
    }
  }

  return res.json({ success: true });
});

// -----------------------------------------------------------------------------
// Generic table CRUD
// -----------------------------------------------------------------------------

apiRouter.get('/tables/:table', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;

  try {
    const dbTable = resolveTableName(req.params.table);

    const {
      page,
      pageSize,
      search,
      sortBy,
      sortOrder,
      mission,
      missionIds,
      filters,
    } = req.query;

    const parsedFilters = parseFilters(filters);
    const parsedMissionIds = parseMissionIds(missionIds);

    const result = await queryTable(dbTable, {
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 25,
      search: search as string,
      sortBy: sortBy as string,
      sortOrder: sortOrder as any,
      mission: mission as string,
      missionIds: parsedMissionIds,
      filters: parsedFilters,
    });

    const visibleData = (result.rows as any[]).map((row) =>
      maskSensitiveRecord(row, auth.perms.canViewUnmaskedData),
    );

    return res.json({
      table: dbTable,
      columns: await getTableColumns(dbTable),
      data: visibleData,
      pagination: {
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        totalPages: Math.ceil(result.total / result.pageSize),
      },
    });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

apiRouter.get(
  '/registrations/backfill-countries/preview',
  async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;

    if (!auth.perms.canImport) {
      return res.status(403).json({
        error: 'Insufficient permissions',
      });
    }

    try {
      return res.json(await previewBackfillCountries());
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
  },
);

apiRouter.post(
  '/registrations/backfill-countries',
  async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;

    if (!auth.perms.canImport) {
      return res.status(403).json({
        error: 'Insufficient permissions',
      });
    }

    try {
      const result = await backfillCountries(auth.user.id);

      try {
        await writeAuditLog({
          userId: auth.user.id,
          username: auth.user.username,
          action: 'BACKFILL_COUNTRIES',
          module: 'Registrations',
          details: `Filled ${result.updated} missing country values from IMSI`,
          ipAddress: req.ip || '',
        });
      } catch {
        // Preserve the successful backfill result.
      }

      return res.json({ success: true, ...result });
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
  },
);

apiRouter.get(
  '/tables/:table/stats',
  async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;

    try {
      const dbTable = resolveTableName(req.params.table);

      const stats = await getTableStats({
        table: dbTable,
        search:
          typeof req.query.search === 'string'
            ? req.query.search
            : undefined,
        mission:
          typeof req.query.mission === 'string'
            ? req.query.mission
            : undefined,
        missionIds: parseMissionIds(req.query.missionIds),
        filters: parseFilters(req.query.filters),
      });

      return res.json(stats);
    } catch (err: any) {
      return res.status(400).json({
        error: err.message || 'Failed to compute table statistics',
      });
    }
  },
);

/**
 * Export the exact same table statistics shown in the UI to PDF / Word / CSV.
 * Uses the shared statistics service and the shared report exporters, so
 * filters, mission selection and all numbers match the frontend.
 */
apiRouter.get(
  '/tables/:table/stats/export',
  async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;

    if (!auth.perms.canExport) {
      return res.status(403).json({
        error: 'Insufficient permissions to export table statistics',
      });
    }

    try {
      const dbTable = resolveTableName(req.params.table);
      const format = String(req.query.format || 'csv').toLowerCase();
      if (!['pdf', 'docx', 'csv'].includes(format)) {
        return res.status(400).json({
          error: 'Unsupported statistics export format. Use pdf, docx or csv.',
        });
      }

      const stats = await getTableStats({
        table: dbTable,
        search:
          typeof req.query.search === 'string' ? req.query.search : undefined,
        mission:
          typeof req.query.mission === 'string' ? req.query.mission : undefined,
        missionIds: parseMissionIds(req.query.missionIds),
        filters: parseFilters(req.query.filters),
      });

      const pageName =
        typeof req.query.pageName === 'string' && req.query.pageName.trim()
          ? req.query.pageName.trim()
          : dbTable;

      const { exportTableStatistics } = await import('./tableStats.js');
      const exported = await exportTableStatistics({
        format: format as 'pdf' | 'docx' | 'csv',
        language: req.query.lang === 'ar' ? 'ar' : 'en',
        stats,
        pageName,
      });

      res.setHeader('Content-Type', exported.contentType);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${exported.filename}"`,
      );
      res.setHeader('X-Export-Filename', exported.filename);
      return res.send(exported.content);
    } catch (err: any) {
      return res.status(500).json({
        error: err.message || 'Failed to export table statistics',
      });
    }
  },
);

apiRouter.get(
  '/tables/:table/:id',
  async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;

    try {
      const dbTable = resolveTableName(req.params.table);
      const record = await getRecord(dbTable, req.params.id);

      if (!record) {
        return res.status(404).json({ error: 'Record not found' });
      }

      return res.json(
        maskSensitiveRecord(
          record as any,
          auth.perms.canViewUnmaskedData,
        ),
      );
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
  },
);

apiRouter.post('/tables/:table', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;

  if (!auth.perms.canEditRecords) {
    return res.status(403).json({
      error: 'Insufficient permissions to create records',
    });
  }

  try {
    const dbTable = resolveTableName(req.params.table);
    const created = await insertRecord(dbTable, req.body);

    await writeAuditLog({
      userId: auth.user.id,
      username: auth.user.username,
      action: 'CREATE_RECORD',
      module: dbTable,
      recordId: String((created as any).id || ''),
      ipAddress: req.ip || '127.0.0.1',
      details: 'New record created',
    });

    return res.status(201).json(created);
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

apiRouter.put(
  '/tables/:table/:id',
  async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;

    if (!auth.perms.canEditRecords) {
      return res.status(403).json({
        error: 'Insufficient permissions to update records',
      });
    }

    try {
      const dbTable = resolveTableName(req.params.table);
      const updated = await updateRecord(
        dbTable,
        req.params.id,
        req.body,
      );

      await writeAuditLog({
        userId: auth.user.id,
        username: auth.user.username,
        action: 'UPDATE_RECORD',
        module: dbTable,
        recordId: String(req.params.id),
        ipAddress: req.ip || '127.0.0.1',
        details: 'Record modified',
      });

      return res.json(updated);
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
  },
);

apiRouter.delete(
  '/tables/:table/:id',
  async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;

    if (!auth.perms.canDeleteRecords) {
      return res.status(403).json({
        error: 'Insufficient permissions to delete records',
      });
    }

    try {
      const dbTable = resolveTableName(req.params.table);

      await deleteRecord(dbTable, req.params.id);

      await writeAuditLog({
        userId: auth.user.id,
        username: auth.user.username,
        action: 'DELETE_RECORD',
        module: dbTable,
        recordId: String(req.params.id),
        ipAddress: req.ip || '127.0.0.1',
        details: 'Record removed',
      });

      return res.json({ success: true });
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
  },
);

// -----------------------------------------------------------------------------
// Mission ambiguity resolution
// -----------------------------------------------------------------------------

apiRouter.get(
  '/missions/ambiguities',
  async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;

    try {
      const rows = await pgQuery(
        `SELECT * FROM migration_ambiguities
         WHERE status = $1
         ORDER BY id ASC`,
        'PENDING',
      );

      return res.json(rows);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  },
);

apiRouter.post(
  '/missions/ambiguities/:id/resolve',
  async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;

    if (!auth.perms.canEditRecords) {
      return res.status(403).json({
        error: 'Insufficient permissions to resolve migration ambiguities',
      });
    }

    const ambId = Number(req.params.id);
    const missionId = Number(req.body.missionId);

    if (
      !Number.isInteger(ambId) ||
      ambId <= 0 ||
      !Number.isInteger(missionId) ||
      missionId <= 0
    ) {
      return res.status(400).json({
        error: 'Valid ambiguity id and missionId are required',
      });
    }

    try {
      const result = await db.$transaction(async (tx) => {
        const ambiguityRows = await tx.$queryRawUnsafe<any[]>(
          `SELECT * FROM migration_ambiguities
           WHERE id = $1
           FOR UPDATE`,
          ambId,
        );

        const ambiguity = ambiguityRows[0];

        if (!ambiguity) {
          throw new Error('AMBIGUITY_NOT_FOUND');
        }

        const missionRows = await tx.$queryRawUnsafe<any[]>(
          `SELECT id, mission FROM missions WHERE id = $1`,
          missionId,
        );

        if (!missionRows.length) {
          throw new Error('MISSION_NOT_FOUND');
        }

        const tableName = String(ambiguity.table_name || '');
        const allowedTables = new Set([
          'registrations',
          'targets',
          'network_cells',
          'wifi_access_points',
          'gps_history',
          'sms_calls',
          'mission_extras',
          'location_extras',
          'mission_files',
          'location_files',
          'map_user_markers',
          'map_user_polygons',
          'map_user_circles',
        ]);

        if (!allowedTables.has(tableName)) {
          throw new Error('INVALID_AMBIGUITY_TABLE');
        }

        const recordId = Number(ambiguity.record_id);

        if (!Number.isInteger(recordId) || recordId <= 0) {
          throw new Error('INVALID_AMBIGUITY_RECORD');
        }

        await tx.$executeRawUnsafe(
          `UPDATE ${quoteIdentifier(tableName)}
           SET mission_id = $1
           WHERE id = $2`,
          missionId,
          recordId,
        );

        await tx.$executeRawUnsafe(
          `UPDATE migration_ambiguities
           SET resolved_mission_id = $1,
               status = 'RESOLVED'
           WHERE id = $2`,
          missionId,
          ambId,
        );

        return { success: true, resolvedMissionId: missionId };
      });

      return res.json(result);
    } catch (err: any) {
      if (err.message === 'AMBIGUITY_NOT_FOUND') {
        return res.status(404).json({
          error: 'Ambiguity record not found',
        });
      }

      if (err.message === 'MISSION_NOT_FOUND') {
        return res.status(404).json({
          error: 'Selected mission not found',
        });
      }

      return res.status(400).json({ error: err.message });
    }
  },
);

// -----------------------------------------------------------------------------
// Unified map endpoint
// -----------------------------------------------------------------------------

apiRouter.get(
  '/map/all-layers',
  async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;

    try {
      const mission = req.query.mission as string | undefined;
      const missionIds = parseMissionIds(req.query.missionIds);

      let whereSql = '';
      let params: any[] = [];

      if (missionIds?.length) {
        const placeholders = missionIds
          .map((_, i) => `$${i + 1}`)
          .join(', ');

        whereSql = `WHERE mission_id IN (${placeholders})`;
        params = missionIds;
      } else if (mission && mission !== 'ALL') {
        const missionNumber = Number(mission);

        if (
          Number.isInteger(missionNumber) &&
          missionNumber > 0
        ) {
          whereSql = 'WHERE mission_id = $1';
          params = [missionNumber];
        } else {
          whereSql = 'WHERE mission = $1';
          params = [mission];
        }
      }

      const andPrefix = whereSql ? `${whereSql} AND` : 'WHERE';

      const [
        mapCells,
        netCells,
        gpsPoints,
        markers,
        polygons,
        circles,
      ] = await Promise.all([
         await pgQuery(
  `
  SELECT mc.*
  FROM map_cells mc
  INNER JOIN map_cell_databases mdb
    ON mdb.id = mc.db_id
  WHERE (
    $1::int[] IS NULL
    OR mdb.mission_id = ANY($1::int[])
  )
  ORDER BY mc.id
  LIMIT 1000
  `,
  missionIds && missionIds.length > 0
  ? missionIds
  : null
),
        pgQuery(
          `SELECT * FROM network_cells
           ${andPrefix}
           latitude IS NOT NULL
           AND longitude IS NOT NULL
           LIMIT 1000`,
          ...params,
        ),
        pgQuery(
          `SELECT * FROM gps_history
           ${andPrefix}
           latitude IS NOT NULL
           AND longitude IS NOT NULL
           ORDER BY timestamp ASC
           LIMIT 2000`,
          ...params,
        ),
        pgQuery(
          `SELECT * FROM map_user_markers ${whereSql}`,
          ...params,
        ),
        pgQuery(
          `SELECT * FROM map_user_polygons ${whereSql}`,
          ...params,
        ),
        pgQuery(
          `SELECT * FROM map_user_circles ${whereSql}`,
          ...params,
        ),
      ]);

      return res.json({
        mapCells,
        netCells,
        gpsPoints,
        markers,
        polygons,
        circles,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  },
);

// -----------------------------------------------------------------------------
// Imports
// -----------------------------------------------------------------------------

apiRouter.post(
  '/imports/inspect',
  upload.single('file'),
  async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;

    if (!auth.perms.canImport) {
      return res.status(403).json({
        error: 'Role does not have permission to import datasets',
      });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
      const { inspectFile } = await import('./importers.js');

      const inspection = await inspectFile(
        req.file.path,
        req.file.originalname,
      );

      return res.json({
        filePath: req.file.path,
        originalName: req.file.originalname,
        size: req.file.size,
        ...inspection,
      });
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
  },
);

apiRouter.post('/imports/execute', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;

  if (!auth.perms.canImport) {
    return res.status(403).json({
      error: 'Role does not have permission to execute imports',
    });
  }

  const {
    filePath,
    originalName,
    destinationTable,
    sheetOrTable,
    columnMapping,
    importMode,
    matchKey,
    coordinateConfig,
  } = req.body;

  if (!filePath || !originalName || !destinationTable || !columnMapping) {
    return res.status(400).json({
      error: 'Missing required import parameters',
    });
  }

  let safePath: string;

  try {
    safePath = assertUploadPathSafe(filePath);
  } catch (err: any) {
    return res.status(403).json({ error: err.message });
  }

  try {
    const { executeImport } = await import('./importers.js');

    const result = await executeImport({
      filePath: safePath,
      originalName,
      destinationTable,
      sheetOrTable,
      columnMapping,
      importMode: importMode || 'INSERT_OR_UPDATE',
      matchKey: matchKey || 'id',
      userId: auth.user.id,
      username: auth.user.username,
      coordinateConfig,
    });

    return res.json({ success: true, result });
  } catch (err: any) {
    const msg = String(err?.message || err);
    let description = msg;

    if (/FOREIGN KEY/i.test(msg)) {
      description =
        'Foreign key constraint failed. A referenced record does not exist. ' +
        msg;
    } else if (/UNIQUE/i.test(msg)) {
      description = 'Duplicate/unique constraint failed: ' + msg;
    } else if (/NOT NULL/i.test(msg)) {
      description = 'Required field missing: ' + msg;
    }

    return res.status(500).json({ error: description });
  }
});

apiRouter.post(
  '/imports/sqlite/estimate',
  async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;

    if (!auth.perms.canImport) {
      return res.status(403).json({
        error: 'Role does not have permission to inspect/import SQLite files',
      });
    }

    const parsed = MultiSqliteImportRequestSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid multi-table import request',
        details: parsed.error.flatten(),
      });
    }

    let safePath: string;

    try {
      safePath = assertUploadPathSafe(parsed.data.filePath);
    } catch (err: any) {
      return res.status(403).json({ error: err.message });
    }

    try {
      const { estimateMultiSqliteImport } =
        await import('./importers.js');

      const result = await estimateMultiSqliteImport(
        safePath,
        parsed.data.tables,
      );

      return res.json({ success: true, ...result });
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
  },
);

apiRouter.post(
  '/imports/sqlite/multi-execute',
  async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;

    if (!auth.perms.canImport) {
      return res.status(403).json({
        error: 'Insufficient role privileges to execute SQLite multi-table import',
      });
    }

    const parsed = MultiSqliteImportRequestSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid multi-table import payload',
        details: parsed.error.flatten(),
      });
    }

    let safePath: string;

    try {
      safePath = assertUploadPathSafe(parsed.data.filePath);
    } catch (err: any) {
      return res.status(403).json({ error: err.message });
    }

    try {
      const { executeMultiSqliteImport } =
        await import('./importers.js');

      const requestedJobId =
        typeof req.body.jobId === 'string' &&
        /^job_[a-zA-Z0-9_-]{4,40}$/.test(req.body.jobId)
          ? req.body.jobId
          : `job_${Date.now()}`;

      const result = await executeMultiSqliteImport({
        filePath: safePath,
        originalName: parsed.data.originalName,
        tables: parsed.data.tables,
        userId: auth.user.id,
        username: auth.user.username,
        jobId: requestedJobId,
      });

      return res.json(result);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  },
);

apiRouter.get(
  '/imports/sqlite/progress/:jobId',
  async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const { getMultiImportProgress } =
      await import('./importers.js');

    const progress = getMultiImportProgress(req.params.jobId);

    if (!progress) {
      return res.status(404).json({ error: 'Import job not found' });
    }

    return res.json(progress);
  },
);

apiRouter.post(
  '/imports/sqlite/cancel/:jobId',
  async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;

    if (!auth.perms.canImport) {
      return res.status(403).json({
        error: 'Insufficient permissions to cancel import jobs',
      });
    }

    const { cancelMultiSqliteImport } =
      await import('./importers.js');

    const cancelled = cancelMultiSqliteImport(req.params.jobId);

    if (!cancelled) {
      return res.status(404).json({
        error: 'Import job not found or already completed',
      });
    }

    return res.json({
      success: true,
      jobId: req.params.jobId,
      status: 'CANCELLED',
    });
  },
);

apiRouter.get(
  '/imports/history',
  async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;

    try {
      const rows = await pgQuery(`
        SELECT
          h.*,
          u.username AS user_name
        FROM import_history h
        LEFT JOIN users u ON h.user_id = u.id
        ORDER BY h.created_at DESC
        LIMIT 100
      `);

      return res.json(rows);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  },
);

apiRouter.get(
  '/imports/batches',
  async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;

    try {
      const tableName =
        typeof req.query.tableName === 'string'
          ? req.query.tableName
          : undefined;

      const status =
        typeof req.query.status === 'string'
          ? req.query.status
          : undefined;

      const user =
        typeof req.query.user === 'string'
          ? req.query.user
          : undefined;

      const conditions: string[] = [];
      const params: any[] = [];

      if (tableName) {
        params.push(tableName);
        conditions.push(`b.destination_table = $${params.length}`);
      }

      if (status) {
        params.push(status);
        conditions.push(`b.status = $${params.length}`);
      }

      if (user) {
        params.push(user);
        const usernameParam = params.length;

        params.push(Number(user) || -1);
        const userIdParam = params.length;

        conditions.push(
          `(u.username = $${usernameParam} OR b.user_id = $${userIdParam})`,
        );
      }

      const where = conditions.length
        ? `WHERE ${conditions.join(' AND ')}`
        : '';

      const rows = await pgQuery(
        `SELECT
           b.*,
           u.username AS user_name
         FROM import_batches b
         LEFT JOIN users u ON b.user_id = u.id
         ${where}
         ORDER BY b.created_at DESC
         LIMIT 200`,
        ...params,
      );

      return res.json(rows);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  },
);

apiRouter.post(
  '/imports/:batchId/undo',
  async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;

    if (!auth.perms.canImport) {
      return res.status(403).json({
        error: 'Insufficient permissions to undo imports',
      });
    }

    try {
      const { undoBatch } = await import('./db.js');

      const result = await undoBatch(
        req.params.batchId,
        auth.user.id,
      );

      try {
        await writeAuditLog({
          userId: auth.user.id,
          username: auth.user.username,
          action: 'IMPORT_UNDO',
          module: 'ImportCenter',
          details:
            `Undo batch ${req.params.batchId}: ` +
            `deleted ${result.deleted}, restored ${result.restored}`,
          ipAddress: req.ip || '',
        });
      } catch {
        // Preserve undo result.
      }

      return res.json(result);
    } catch (err: any) {
      return res.status(400).json({
        error: err.message || 'Undo failed',
      });
    }
  },
);

// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------

apiRouter.get(
  '/exports/download',
  async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;

    if (!auth.perms.canExport) {
      return res.status(403).json({
        error: 'Insufficient permissions to export data',
      });
    }

    const { table, format, mission, search, filters } = req.query;

    if (!table) {
      return res.status(400).json({ error: 'Table is required' });
    }

    try {
      const { exportDataset } = await import('./exporters.js');

      const exported = await exportDataset({
        tableName: String(table),
        format: (format as any) || 'csv',
        mission: mission as string,
        search: search as string,
        filters: parseFilters(filters),
        username: auth.user.username,
        canUnmask: auth.perms.canViewUnmaskedData,
      });

      res.setHeader('Content-Type', exported.contentType);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${exported.filename}"`,
      );

      return res.send(exported.content);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  },
);

apiRouter.post('/exports/chart', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;

  if (!auth.perms.canExport) {
    return res.status(403).json({
      error: 'Insufficient role permissions to export charts or map views',
    });
  }

  const parsed = ChartExportRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid chart export request',
      details: parsed.error.flatten(),
    });
  }

  const { chartId, format, language, filters, chartImage } = parsed.data;

  if (filters.tmsi && !auth.perms.canViewUnmaskedData) {
    return res.status(403).json({
      error: 'Role is not authorized to filter or export by TMSI',
    });
  }

  if (format === 'geojson' && chartId !== 'btsMap') {
    return res.status(400).json({
      error: 'GeoJSON format is only supported for the BTS geographic map',
    });
  }

  try {
    const { generateChartExport } =
      await import('./dashboardExporter.js');

    const result = await generateChartExport({
      chartId,
      format,
      language,
      filters,
      chartImage,
      userId: auth.user.id,
      username: auth.user.username,
    });

    if (req.query.stream === 'false') {
      return res.status(201).json({
        success: true,
        exportId: result.exportId,
        fileName: result.fileName,
        downloadUrl:
          `/api/v1/exports/dashboard/${result.exportId}/download`,
      });
    }

    res.setHeader('Content-Type', result.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.fileName}"`,
    );
    res.setHeader('X-Export-Id', String(result.exportId));
    res.setHeader('X-Export-Filename', result.fileName);

    return res.send(result.buffer);
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

apiRouter.post(
  '/exports/dashboard',
  async (req: Request, res: Response) => {
    const auth = getUserPerms(req);

    if (!auth) {
      return res.status(401).json({
        error: 'Authentication required to export dashboard reports',
      });
    }

    if (!auth.perms.canExport) {
      return res.status(403).json({
        error: 'Insufficient role permissions to export dashboard reports',
      });
    }

    const parsed = DashboardExportRequestSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid export parameters',
        details: parsed.error.flatten(),
      });
    }

    const { format, language, filters, scope, chartImages } = parsed.data;

    if (filters.tmsi && !auth.perms.canViewUnmaskedData) {
      return res.status(403).json({
        error: 'Role is not authorized to filter or export by TMSI',
      });
    }

    if (
      scope.includeSensitiveIdentifiers &&
      !auth.perms.canViewUnmaskedData
    ) {
      return res.status(403).json({
        error:
          'Role is not authorized to export unmasked IMSI/IMEI/TMSI identifiers',
      });
    }

    try {
      const { generateDashboardExport } =
        await import('./dashboardExporter.js');

      const result = await generateDashboardExport({
        format,
        language,
        filters,
        scope,
        chartImages,
        userId: auth.user.id,
        username: auth.user.username,
        canUnmask: auth.perms.canViewUnmaskedData,
      });

      if (req.query.stream === 'true') {
        res.setHeader('Content-Type', result.contentType);
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${result.fileName}"`,
        );

        return res.send(result.buffer);
      }

      return res.status(201).json({
        success: true,
        exportId: result.exportId,
        fileName: result.fileName,
        downloadUrl:
          `/api/v1/exports/dashboard/${result.exportId}/download`,
      });
    } catch (err: any) {
      try {
        await pgExecute(
          `INSERT INTO export_history
             (user_id, username, format, scope, status, error_details)
           VALUES ($1, $2, $3, 'dashboard', 'FAILED', $4)`,
          auth.user.id,
          auth.user.username,
          String(format).toUpperCase(),
          err.message,
        );
      } catch {
        // Preserve original export error.
      }

      return res.status(500).json({ error: err.message });
    }
  },
);

apiRouter.get(
  '/exports/dashboard/:id/download',
  async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;

    if (!auth.perms.canExport) {
      return res.status(403).json({
        error: 'Insufficient role permissions',
      });
    }

    try {
      const id = Number(req.params.id);

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid export id' });
      }

      const rows = await pgQuery<any>(
        `SELECT * FROM export_history WHERE id = $1`,
        id,
      );

      const row = rows[0];

      if (!row || !row.file_path || !fs.existsSync(row.file_path)) {
        return res.status(404).json({
          error: 'Export file not found or expired',
        });
      }

      const resolved = path.resolve(row.file_path);

      if (!resolved.startsWith(EXPORTS_DIR + path.sep)) {
        return res.status(403).json({
          error: 'Invalid export file path',
        });
      }

      const ext = path
        .extname(row.file_name || row.file_path)
        .toLowerCase();

      const mime =
        ext === '.pdf'
          ? 'application/pdf'
          : ext === '.docx'
            ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            : ext === '.png'
              ? 'image/png'
              : ext === '.csv'
                ? 'text/csv; charset=utf-8'
                : ext === '.geojson'
                  ? 'application/geo+json; charset=utf-8'
                  : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

      res.setHeader('Content-Type', mime);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${path.basename(row.file_name || resolved)}"`,
      );

      return res.sendFile(resolved);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  },
);

apiRouter.get(
  '/exports/history',
  async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;

    if (!auth.perms.canExport) {
      return res.status(403).json({
        error: 'Insufficient role permissions',
      });
    }

    try {
      const rows = await pgQuery(`
        SELECT
          id,
          user_id,
          username,
          format,
          scope,
          selected_missions,
          applied_filters,
          status,
          file_name,
          file_size,
          error_details,
          created_at
        FROM export_history
        ORDER BY created_at DESC
        LIMIT 100
      `);

      return res.json(rows);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  },
);

// -----------------------------------------------------------------------------
// Analytics, dashboard, BTS map
// -----------------------------------------------------------------------------

apiRouter.get(
  '/analytics/filter-options',
  async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;

    try {
      return res.json(await getDashboardFilterOptions());
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  },
);

apiRouter.get(
  '/analytics/dashboard',
  async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const parsed = DashboardFilterSchema.safeParse(req.query);

    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid filter query parameters',
        details: parsed.error.flatten(),
      });
    }

    if (
      parsed.data.tmsi &&
      !auth.perms.canViewUnmaskedData
    ) {
      return res.status(403).json({
        error: 'Insufficient permissions to filter by TMSI',
      });
    }

    try {
      return res.json(await getDashboardKPIs(parsed.data));
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  },
);

apiRouter.post(
  '/analytics/dashboard',
  async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const parsed = DashboardFilterSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid filter payload',
        details: parsed.error.flatten(),
      });
    }

    if (
      parsed.data.tmsi &&
      !auth.perms.canViewUnmaskedData
    ) {
      return res.status(403).json({
        error: 'Insufficient permissions to filter by TMSI',
      });
    }

    try {
      return res.json(await getDashboardKPIs(parsed.data));
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  },
);

apiRouter.get(
  '/analytics/bts-map',
  async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const parsed = DashboardFilterSchema.safeParse(req.query);

    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid map filter parameters',
        details: parsed.error.flatten(),
      });
    }

    if (
      parsed.data.tmsi &&
      !auth.perms.canViewUnmaskedData
    ) {
      return res.status(403).json({
        error: 'Insufficient permissions to filter map by TMSI',
      });
    }

    try {
      return res.json(await getBtsMapData(parsed.data));
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  },
);

apiRouter.post(
  '/analytics/widget/:widgetId',
  async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const widgetId = req.params.widgetId as DashboardWidgetId;

    if (!ALLOWED_WIDGET_IDS.has(widgetId)) {
      return res.status(404).json({
        error: `Unknown dashboard widget: ${widgetId}`,
      });
    }

    const parsed = DashboardFilterSchema.safeParse(req.body || {});

    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid filter payload',
        details: parsed.error.flatten(),
      });
    }

    if (
      parsed.data.tmsi &&
      !auth.perms.canViewUnmaskedData
    ) {
      return res.status(403).json({
        error: 'Insufficient permissions to filter by TMSI',
      });
    }

    try {
      return res.json(await getDashboardWidget(widgetId, parsed.data));
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  },
);

// -----------------------------------------------------------------------------
// MCC/MNC operator mappings
// -----------------------------------------------------------------------------

apiRouter.get(
  '/analytics/mcc-mnc-operators',
  async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;

    try {
      const rows = await pgQuery(`
        SELECT
          id,
          mcc,
          mnc,
          operator_name,
          country,
          network_category,
          is_military,
          is_active,
          created_at,
          updated_at
        FROM mcc_mnc_operator_mappings
        ORDER BY mcc, mnc
      `);

      return res.json(rows);
    } catch (err: any) {
      return res.status(500).json({
        error: err.message || 'Failed to load operator mappings',
      });
    }
  },
);

apiRouter.post(
  '/analytics/mcc-mnc-operators',
  async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;

    if (
      !['SUPER_ADMIN', 'ADMIN', 'DATA_MANAGER'].includes(
        auth.user.role,
      )
    ) {
      return res.status(403).json({
        error: 'Insufficient role privileges to manage MCC/MNC mappings',
      });
    }

    const {
      mcc,
      mnc,
      operatorName,
      country,
      networkCategory,
      isMilitary,
    } = req.body || {};

    if (!mcc || !mnc || !operatorName) {
      return res.status(400).json({
        error: 'mcc, mnc and operatorName are required',
      });
    }

    try {
      const rows = await pgQuery<any>(
        `INSERT INTO mcc_mnc_operator_mappings
           (mcc, mnc, operator_name, country, network_category,
            is_military, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, TRUE)
         RETURNING id`,
        String(mcc).trim(),
        String(mnc).trim(),
        String(operatorName).trim(),
        String(country || 'Unknown').trim(),
        networkCategory || null,
        Boolean(isMilitary),
      );

      return res.status(201).json({
        id: rows[0].id,
        mcc,
        mnc,
        operatorName,
        country: country || 'Unknown',
        networkCategory: networkCategory || null,
        isMilitary: Boolean(isMilitary),
      });
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
  },
);

apiRouter.put(
  '/analytics/mcc-mnc-operators/:id',
  async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;

    if (
      !['SUPER_ADMIN', 'ADMIN', 'DATA_MANAGER'].includes(
        auth.user.role,
      )
    ) {
      return res.status(403).json({
        error: 'Insufficient role privileges to update MCC/MNC mappings',
      });
    }

    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid mapping id' });
    }

    const {
      mcc,
      mnc,
      operatorName,
      country,
      networkCategory,
      isMilitary,
      isActive,
    } = req.body || {};

    try {
      const rows = await pgQuery<any>(
        `UPDATE mcc_mnc_operator_mappings
         SET mcc = $1,
             mnc = $2,
             operator_name = $3,
             country = $4,
             network_category = $5,
             is_military = $6,
             is_active = $7,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $8
         RETURNING id`,
        String(mcc || '').trim(),
        String(mnc || '').trim(),
        String(operatorName || '').trim(),
        String(country || 'Unknown').trim(),
        networkCategory || null,
        Boolean(isMilitary),
        isActive !== false,
        id,
      );

      if (!rows.length) {
        return res.status(404).json({ error: 'Mapping not found' });
      }

      return res.json({ updated: true, id });
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
  },
);

apiRouter.delete(
  '/analytics/mcc-mnc-operators/:id',
  async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;

    if (
      !['SUPER_ADMIN', 'ADMIN', 'DATA_MANAGER'].includes(
        auth.user.role,
      )
    ) {
      return res.status(403).json({
        error: 'Insufficient role privileges to remove MCC/MNC mappings',
      });
    }

    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid mapping id' });
    }

    try {
      const rows = await pgQuery<any>(
        `DELETE FROM mcc_mnc_operator_mappings
         WHERE id = $1
         RETURNING id`,
        id,
      );

      if (!rows.length) {
        return res.status(404).json({ error: 'Mapping not found' });
      }

      return res.json({ deleted: true, id });
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
  },
);

// -----------------------------------------------------------------------------
// PLMN lookup
// -----------------------------------------------------------------------------

apiRouter.get(
  '/plmn/search',
  async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;

    try {
      const q =
        typeof req.query.q === 'string'
          ? req.query.q.trim()
          : '';

      if (!q) {
        const rows = await pgQuery(`
          SELECT mcc, mnc, country, code, name
          FROM plmn_storage
          ORDER BY mcc, mnc
          LIMIT 100
        `);

        return res.json(rows);
      }

      const term = `%${q}%`;

      const rows = await pgQuery(
        `SELECT mcc, mnc, country, code, name
         FROM plmn_storage
         WHERE name ILIKE $1
            OR country ILIKE $2
            OR code ILIKE $3
            OR CAST(mcc AS TEXT) ILIKE $4
            OR CAST(mnc AS TEXT) ILIKE $5
         ORDER BY mcc, mnc
         LIMIT 100`,
        term,
        term,
        term,
        term,
        term,
      );

      return res.json(rows);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  },
);

// -----------------------------------------------------------------------------
// Saved views
// -----------------------------------------------------------------------------

apiRouter.get(
  '/saved-views',
  async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;

    try {
      const tableName =
        typeof req.query.tableName === 'string'
          ? req.query.tableName
          : 'dashboard';

      const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(
        auth.user.role,
      );

      const rows = isAdmin
        ? await pgQuery(
            `SELECT id, user_id, table_name, view_name,
                    filters_json, is_default, created_at
             FROM saved_views
             WHERE table_name = $1
             ORDER BY created_at DESC`,
            tableName,
          )
        : await pgQuery(
            `SELECT id, user_id, table_name, view_name,
                    filters_json, is_default, created_at
             FROM saved_views
             WHERE table_name = $1
               AND (user_id = $2 OR user_id IS NULL)
             ORDER BY created_at DESC`,
            tableName,
            auth.user.id,
          );

      return res.json(rows);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  },
);

apiRouter.post(
  '/saved-views',
  async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const { tableName, viewName, filters } = req.body || {};

    if (!viewName || filters === undefined || filters === null) {
      return res.status(400).json({
        error: 'viewName and filters are required',
      });
    }

    try {
      const resolvedTable = tableName || 'dashboard';
      const resolvedName = String(viewName).trim();
      const filtersJson = JSON.stringify(filters);

      const rows = await pgQuery<any>(
        `INSERT INTO saved_views
           (user_id, table_name, view_name, filters_json)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        auth.user.id,
        resolvedTable,
        resolvedName,
        filtersJson,
      );

      return res.status(201).json({
        id: rows[0].id,
        user_id: auth.user.id,
        table_name: resolvedTable,
        view_name: resolvedName,
        filters_json: filtersJson,
      });
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
  },
);

apiRouter.put(
  '/saved-views/:id',
  async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const viewId = Number(req.params.id);

    if (!Number.isInteger(viewId) || viewId <= 0) {
      return res.status(400).json({ error: 'Invalid saved view id' });
    }

    try {
      const rows = await pgQuery<any>(
        `SELECT id, user_id
         FROM saved_views
         WHERE id = $1`,
        viewId,
      );

      const existing = rows[0];

      if (!existing) {
        return res.status(404).json({
          error: 'Saved view not found',
        });
      }

      const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(
        auth.user.role,
      );

      if (!isAdmin && existing.user_id !== auth.user.id) {
        return res.status(403).json({
          error: 'You do not have permission to update another user saved view',
        });
      }

      const { viewName, filters } = req.body || {};
      const updates: string[] = [];
      const params: any[] = [];

      if (viewName !== undefined) {
        params.push(String(viewName).trim());
        updates.push(`view_name = $${params.length}`);
      }

      if (filters !== undefined) {
        params.push(JSON.stringify(filters));
        updates.push(`filters_json = $${params.length}`);
      }

      if (updates.length) {
        params.push(viewId);

        await pgExecute(
          `UPDATE saved_views
           SET ${updates.join(', ')}
           WHERE id = $${params.length}`,
          ...params,
        );
      }

      return res.json({ success: true, id: viewId });
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
  },
);

apiRouter.delete(
  '/saved-views/:id',
  async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const viewId = Number(req.params.id);

    if (!Number.isInteger(viewId) || viewId <= 0) {
      return res.status(400).json({ error: 'Invalid saved view id' });
    }

    try {
      const rows = await pgQuery<any>(
        `SELECT id, user_id FROM saved_views WHERE id = $1`,
        viewId,
      );

      const existing = rows[0];

      if (!existing) {
        return res.status(404).json({
          error: 'Saved view not found',
        });
      }

      const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(
        auth.user.role,
      );

      if (!isAdmin && existing.user_id !== auth.user.id) {
        return res.status(403).json({
          error: 'You do not have permission to delete another user saved view',
        });
      }

      await pgExecute(
        `DELETE FROM saved_views WHERE id = $1`,
        viewId,
      );

      return res.json({ success: true });
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
  },
);

// -----------------------------------------------------------------------------
// Dynamic analytics
// -----------------------------------------------------------------------------

apiRouter.post(
  '/analytics/query',
  async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const body = req.body || {};
    const table = body.table;

    const dimensions = Array.isArray(body.dimensions)
      ? body.dimensions
      : body.dimensionCol
        ? [body.dimensionCol]
        : [];

    if (!table || dimensions.length === 0) {
      return res.status(400).json({
        error:
          'Table and at least one grouping dimension are required',
      });
    }

    try {
      const data = await executeDynamicAnalytics({
        table,
        dimensionCol: body.dimensionCol,
        dimensions,
        metricCol: body.metricCol,
        metrics: body.metrics,
        aggregation: body.aggregation || 'COUNT',
        mission: body.mission,
        missionIds: body.missionIds,
        filters: body.filters,
        limit: body.limit,
        offset: body.offset,
        sortBy: body.sortBy,
        sortOrder: body.sortOrder,
      });

      return res.json(data);
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
  },
);

apiRouter.post(
  '/exports/analytics',
  async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;

    if (!auth.perms.canExport) {
      return res.status(403).json({
        error: 'Insufficient permissions to export data',
      });
    }

    const body = req.body || {};
    const format = String(body.format || 'xlsx').toLowerCase();

    if (!['csv', 'xlsx', 'pdf', 'docx', 'zip'].includes(format)) {
      return res.status(400).json({
        error: 'Unsupported export format',
      });
    }

    const analyses = Array.isArray(body.analyses)
      ? body.analyses
      : [];

    if (!analyses.length) {
      return res.status(400).json({
        error: 'At least one analysis is required',
      });
    }

    try {
      const { buffer, filename, mime } =
        await generateAnalyticsExport({
          format: format as any,
          language: body.language === 'ar' ? 'ar' : 'en',
          analyses,
        });

      try {
        await writeAuditLog({
          userId: auth.user.id,
          username: auth.user.username,
          action: 'EXPORT',
          module: 'Analytics',
          details:
            `Exported ${analyses.length} analysis(es) as ${format.toUpperCase()}`,
          ipAddress: req.ip || '',
        });
      } catch {
        // Preserve export result.
      }

      try {
   await pgExecute(
  `INSERT INTO export_history
     (user_id, username, format, scope, file_path, file_name, status)
   VALUES ($1, $2, $3, $4, $5, $6, $7)`,
  auth.user.id,
  auth.user.username,
  format.toUpperCase(),
  'analytics',
  path.resolve(EXPORTS_DIR, filename),
  filename,
  'COMPLETED',
);
      } catch {
        // Preserve export result.
      }

      res.setHeader('Content-Type', mime);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}"`,
      );
      res.setHeader('X-Export-Filename', filename);

      return res.send(buffer);
    } catch (err: any) {
      try {
        await writeAuditLog({
          userId: auth.user.id,
          username: auth.user.username,
          action: 'EXPORT_FAILED',
          module: 'Analytics',
          details: err?.message || 'Export failed',
          ipAddress: req.ip || '',
          result: 'FAILED',
        });
      } catch {
        // Preserve original error.
      }

      return res.status(400).json({
        error: err?.message || 'Export failed',
      });
    }
  },
);

// -----------------------------------------------------------------------------
// Users
// -----------------------------------------------------------------------------

apiRouter.get('/users', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;

  if (!auth.perms.canManageUsers) {
    return res.status(403).json({
      error: 'Insufficient permissions to view user accounts',
    });
  }

  try {
    const rows = await pgQuery(`
      SELECT
        id,
        username,
        email,
        full_name,
        role,
        status,
        created_at,
        last_login
      FROM users
      ORDER BY id ASC
    `);

    return res.json(rows);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/users', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;

  if (!auth.perms.canManageUsers) {
    return res.status(403).json({
      error: 'Insufficient permissions to manage users',
    });
  }

  const {
    username,
    email,
    password,
    full_name,
    role,
  } = req.body || {};

  if (!username || !email || !password) {
    return res.status(400).json({
      error: 'Username, email and password are required',
    });
  }

  const validRoles: UserRole[] = [
    'SUPER_ADMIN',
    'ADMIN',
    'DATA_MANAGER',
    'DATA_ANALYST',
    'VIEWER',
  ];

  const assignedRole: UserRole = validRoles.includes(role)
    ? role
    : 'VIEWER';

  try {
    const hash = await bcrypt.hash(String(password), 10);

    const rows = await pgQuery<any>(
      `INSERT INTO users
         (username, email, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4, $5::"Role")
       RETURNING id`,
      String(username).trim(),
      String(email).trim(),
      hash,
      full_name || username,
      assignedRole,
    );

    return res.status(201).json({
      id: rows[0].id,
      username,
      email,
      role: assignedRole,
    });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// Audit logs
// -----------------------------------------------------------------------------

apiRouter.get(
  '/audit-logs',
  async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const p = Math.max(1, Number(req.query.page) || 1);
    const ps = Math.min(
      100,
      Math.max(1, Number(req.query.pageSize) || 30),
    );
    const offset = (p - 1) * ps;

    const moduleName =
      typeof req.query.module === 'string'
        ? req.query.module
        : undefined;

    const search =
      typeof req.query.search === 'string'
        ? req.query.search.trim()
        : '';

    const conditions: string[] = [];
    const params: any[] = [];

    if (moduleName && moduleName !== 'ALL') {
      params.push(moduleName);
      conditions.push(`module = $${params.length}`);
    }

    if (search) {
      params.push(`%${search}%`);
      const n = params.length;

      conditions.push(
        `(username ILIKE $${n}
          OR action ILIKE $${n}
          OR details ILIKE $${n})`,
      );
    }

    const where = conditions.length
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    try {
      const countRows = await pgQuery<any>(
        `SELECT COUNT(*)::int AS total
         FROM audit_logs
         ${where}`,
        ...params,
      );

      const total = Number(countRows[0]?.total || 0);

      const logs = await pgQuery(
        `SELECT *
         FROM audit_logs
         ${where}
         ORDER BY timestamp DESC
         LIMIT $${params.length + 1}
         OFFSET $${params.length + 2}`,
        ...params,
        ps,
        offset,
      );

      return res.json({
        logs,
        pagination: {
          page: p,
          pageSize: ps,
          total,
          totalPages: Math.ceil(total / ps),
        },
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  },
);

// -----------------------------------------------------------------------------
// System health
// -----------------------------------------------------------------------------

apiRouter.get(
  '/system/health',
  async (_req: Request, res: Response) => {
    const mem = process.memoryUsage();

    try {
      await db.$queryRaw`SELECT 1`;

      return res.json({
        status: 'HEALTHY',
        uptimeSeconds: Math.floor(process.uptime()),
        database: {
          connected: true,
          engine: 'PostgreSQL',
          foreignKeys: true,
        },
        system: {
          nodeVersion: process.version,
          platform: process.platform,
          memoryRssMb: Math.round(mem.rss / 1024 / 1024),
          memoryHeapUsedMb: Math.round(
            mem.heapUsed / 1024 / 1024,
          ),
        },
        version: '3.0.0-enterprise',
      });
    } catch (err: any) {
      return res.status(503).json({
        status: 'DEGRADED',
        uptimeSeconds: Math.floor(process.uptime()),
        database: {
          connected: false,
          engine: 'PostgreSQL',
          error: err.message,
        },
        system: {
          nodeVersion: process.version,
          platform: process.platform,
          memoryRssMb: Math.round(mem.rss / 1024 / 1024),
          memoryHeapUsedMb: Math.round(
            mem.heapUsed / 1024 / 1024,
          ),
        },
        version: '3.0.0-enterprise',
      });
    }
  },
);

// -----------------------------------------------------------------------------
// Data dictionary
// -----------------------------------------------------------------------------

apiRouter.get(
  '/system/data-dictionary',
  async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;

    try {
      const tables = Object.values(TABLE_MAP);

      const dict = await Promise.all(
        tables.map(async (table) => {
          const cols = await getTableColumns(table);

          const countRows = await pgQuery<any>(
            `SELECT COUNT(*)::int AS count
             FROM ${quoteIdentifier(table)}`,
          );

          return {
            table,
            rowCount: Number(countRows[0]?.count || 0),
            columns: cols.map((column: any) => ({
              name: column.name,
              type: column.type,
              primaryKey: column.pk === 1,
              nullable: column.notnull === 0,
            })),
          };
        }),
      );

      return res.json(dict);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  },
);

// -----------------------------------------------------------------------------
// PostgreSQL backups
// -----------------------------------------------------------------------------

apiRouter.get(
  '/system/backups',
  async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;

    try {
      const entries = fs.existsSync(BACKUPS_DIR)
        ? fs.readdirSync(BACKUPS_DIR)
        : [];

      const files = entries
        .filter((name) => /\.sql$/i.test(name))
        .map((name) => {
          const fullPath = path.join(BACKUPS_DIR, name);
          const stat = fs.statSync(fullPath);

          return {
            name,
            created: stat.mtime.toISOString(),
            sizeBytes: stat.size,
            type: 'PG_DUMP',
            status: stat.size > 0 ? 'AVAILABLE' : 'EMPTY',
          };
        })
        .sort(
          (a, b) =>
            new Date(b.created).getTime() -
            new Date(a.created).getTime(),
        );

      return res.json(files);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  },
);

apiRouter.post(
  '/system/backups/create',
  async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;

    if (
      !['SUPER_ADMIN', 'ADMIN', 'DATA_MANAGER'].includes(
        auth.user.role,
      )
    ) {
      return res.status(403).json({
        error: 'Insufficient role privileges to create system backups',
      });
    }

    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      return res.status(500).json({
        error: 'DATABASE_URL is not configured',
      });
    }

    const backupName =
      `postgres_backup_${new Date()
        .toISOString()
        .replace(/[:.]/g, '-')}.sql`;

    const backupPath = path.resolve(BACKUPS_DIR, backupName);

    if (!backupPath.startsWith(BACKUPS_DIR + path.sep)) {
      return res.status(400).json({
        error: 'Invalid backup path',
      });
    }

    try {
      // Requires PostgreSQL client tools (pg_dump) to be installed
      // and available on the server PATH.
      await execFileAsync(
        'pg_dump',
        [
          '--dbname',
          databaseUrl,
          '--no-owner',
          '--no-acl',
          '--format=plain',
          '--file',
          backupPath,
        ],
        {
          windowsHide: true,
          maxBuffer: 10 * 1024 * 1024,
        },
      );

      const stat = fs.statSync(backupPath);

      if (!stat.size) {
        throw new Error('pg_dump produced an empty backup file');
      }

      try {
        await writeAuditLog({
          userId: auth.user.id,
          username: auth.user.username,
          action: 'SYSTEM_BACKUP',
          module: 'System',
          recordId: backupName,
          ipAddress: req.ip || '127.0.0.1',
          result: 'SUCCESS',
          details: 'Created PostgreSQL database backup',
        });
      } catch {
        // Backup itself remains successful.
      }

      return res.json({
        success: true,
        backupName,
        created: stat.mtime.toISOString(),
        sizeBytes: stat.size,
      });
    } catch (err: any) {
      try {
        if (fs.existsSync(backupPath)) {
          fs.unlinkSync(backupPath);
        }
      } catch {
        // Ignore cleanup errors.
      }

      return res.status(500).json({
        error:
          err.code === 'ENOENT'
            ? 'pg_dump was not found. Install PostgreSQL client tools and add pg_dump to PATH.'
            : err.message,
      });
    }
  },
);

// -----------------------------------------------------------------------------
// Cronologs
// -----------------------------------------------------------------------------

apiRouter.get('/cronologs/statistics', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!auth.perms.canViewTables) {
    return res.status(403).json({ error: 'Insufficient permissions to view cronologs' });
  }

  try {
    const { getCronologStatistics } = await import('./cronologs.js');
    const stats = await getCronologStatistics();
    return res.json(stats);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to load cronolog statistics' });
  }
});

apiRouter.post(
  '/cronologs/import/preview',
  upload.single('file'),
  async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!auth.perms.canImport) {
      return res.status(403).json({ error: 'Insufficient permissions to import cronologs' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
      const safePath = assertUploadPathSafe(req.file.path);
      const { previewCronologFile } = await import('./cronologs.js');
      const preview = await previewCronologFile({
        filePath: safePath,
        filename: req.file.originalname,
        size: req.file.size,
      });

      try {
        await writeAuditLog({
          userId: auth.user.id,
          username: auth.user.username,
          action: 'CRONOLOGS_IMPORT_PREVIEW',
          module: 'Cronologs',
          recordId: req.file.originalname,
          ipAddress: req.ip || '127.0.0.1',
          details: `Previewed cronolog file: ${preview.totalRecords} records (${preview.validRecords} valid, ${preview.invalidRecords} invalid)`,
        });
      } catch {
        // ignore
      }

      return res.json({
        ...preview,
        filePath: safePath,
        originalName: req.file.originalname,
      });
    } catch (err: any) {
      return res.status(400).json({ error: err.message || 'Failed to preview cronolog file' });
    }
  },
);

apiRouter.post('/cronologs/import/confirm', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!auth.perms.canImport) {
    return res.status(403).json({ error: 'Insufficient permissions to import cronologs' });
  }

  const { filePath, originalName, forceDuplicate } = req.body || {};
  if (!filePath || typeof filePath !== 'string') {
    return res.status(400).json({ error: 'filePath is required' });
  }

  let safePath: string;
  try {
    safePath = assertUploadPathSafe(filePath);
  } catch (err: any) {
    return res.status(403).json({ error: err.message });
  }

  if (!fs.existsSync(safePath)) {
    return res.status(400).json({ error: 'Uploaded file not found. Please preview/upload again.' });
  }

  try {
    const { startCronologImport } = await import('./cronologs.js');
    const result = await startCronologImport({
      filePath: safePath,
      filename: typeof originalName === 'string' && originalName.trim() ? originalName.trim() : path.basename(safePath),
      userId: auth.user.id,
      username: auth.user.username,
      forceDuplicate: Boolean(forceDuplicate),
    });

    try {
      await writeAuditLog({
        userId: auth.user.id,
        username: auth.user.username,
        action: 'CRONOLOGS_IMPORT_START',
        module: 'Cronologs',
        recordId: String(result.batchId),
        ipAddress: req.ip || '127.0.0.1',
        details: `Started cronolog import batch #${result.batchId}`,
      });
    } catch {
      // ignore
    }

    return res.status(202).json({
      success: true,
      jobId: result.jobId,
      batchId: result.batchId,
      status: 'PROCESSING',
    });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to start cronolog import' });
  }
});

apiRouter.get('/cronologs/imports', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!auth.perms.canViewTables && !auth.perms.canImport) {
    return res.status(403).json({ error: 'Insufficient permissions to view cronolog import history' });
  }

  try {
    const { listCronologImportBatches } = await import('./cronologs.js');
    const batches = await listCronologImportBatches();
    return res.json(batches);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to load cronolog import history' });
  }
});

apiRouter.get('/cronologs/imports/:batchId', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!auth.perms.canViewTables && !auth.perms.canImport) {
    return res.status(403).json({ error: 'Insufficient permissions to view cronolog import batch' });
  }

  const batchId = Number(req.params.batchId);
  if (!Number.isInteger(batchId) || batchId <= 0) {
    return res.status(400).json({ error: 'Invalid batch id' });
  }

  try {
    const { getCronologImportBatch } = await import('./cronologs.js');
    const batch = await getCronologImportBatch(batchId);
    if (!batch) return res.status(404).json({ error: 'Cronolog import batch not found' });
    return res.json(batch);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to load cronolog import batch' });
  }
});

apiRouter.delete('/cronologs/imports/:batchId', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!auth.perms.canImport) {
    return res.status(403).json({ error: 'Insufficient permissions to undo cronolog imports' });
  }

  const batchId = Number(req.params.batchId);
  if (!Number.isInteger(batchId) || batchId <= 0) {
    return res.status(400).json({ error: 'Invalid batch id' });
  }

  try {
    const { undoCronologImportBatch } = await import('./cronologs.js');
    const result = await undoCronologImportBatch(batchId, auth.user.username);
    return res.json({ success: true, ...result });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to undo cronolog import batch' });
  }
});

apiRouter.get('/cronologs/export', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!auth.perms.canExport) {
    return res.status(403).json({ error: 'Insufficient permissions to export cronologs' });
  }

  try {
    const formatRaw = String(req.query.format || 'csv').toLowerCase();
    if (!['csv', 'xlsx', 'pdf', 'docx'].includes(formatRaw)) {
      return res.status(400).json({ error: 'Unsupported export format. Use csv, xlsx, pdf, or docx.' });
    }
    const format = formatRaw as 'csv' | 'xlsx' | 'pdf' | 'docx';
    const language = req.query.lang === 'ar' ? 'ar' : 'en';

    let selectedColumns: string[] | undefined;
    if (typeof req.query.columns === 'string' && req.query.columns.trim()) {
      selectedColumns = req.query.columns.split(',').map((s) => s.trim()).filter(Boolean);
    }

    const { parseCronologListQuery, exportCronologs } = await import('./cronologs.js');
    const params = parseCronologListQuery(req.query);
    const exported = await exportCronologs({ format, params, selectedColumns, language });

    try {
      await writeAuditLog({
        userId: auth.user.id,
        username: auth.user.username,
        action: 'CRONOLOGS_EXPORT',
        module: 'Cronologs',
        recordId: format.toUpperCase(),
        ipAddress: req.ip || '127.0.0.1',
        details: `Exported cronologs as ${format.toUpperCase()} (${selectedColumns?.length ? selectedColumns.length + ' selected columns' : 'all columns'})`,
      });
    } catch {
      // ignore
    }

    res.setHeader('Content-Type', exported.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
    res.setHeader('X-Export-Filename', exported.filename);
    return res.send(exported.content);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to export cronologs' });
  }
});

apiRouter.get('/cronologs', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!auth.perms.canViewTables) {
    return res.status(403).json({ error: 'Insufficient permissions to view cronologs' });
  }

  try {
    const { parseCronologListQuery, listCronologs } = await import('./cronologs.js');
    const params = parseCronologListQuery(req.query);
    const result = await listCronologs(params);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to load cronologs' });
  }
});

apiRouter.get('/cronologs/:id', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!auth.perms.canViewTables) {
    return res.status(403).json({ error: 'Insufficient permissions to view cronologs' });
  }

  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid cronolog id' });
  }

  try {
    const { getCronologById } = await import('./cronologs.js');
    const row = await getCronologById(id);
    if (!row) return res.status(404).json({ error: 'Cronolog record not found' });
    return res.json(row);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to load cronolog record' });
  }
});

apiRouter.get('/activity-logs/statistics', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!auth.perms.canViewTables) {
    return res.status(403).json({ error: 'Insufficient permissions to view activity logs' });
  }

  try {
    const { parseActivityLogListQuery, getActivityLogsStatistics } = await import('./activityLogs.js');
    const params = parseActivityLogListQuery(req.query);
    const stats = await getActivityLogsStatistics({
      search: params.search,
      recordType: params.recordType,
      sourceFile: params.sourceFile,
      lineNumber: params.lineNumber,
      importBatchId: params.importBatchId,
    });
    return res.json(stats);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to load activity logs statistics' });
  }
});

apiRouter.post(
  '/activity-logs/import/preview',
  upload.single('file'),
  async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!auth.perms.canImport) {
      return res.status(403).json({ error: 'Insufficient permissions to import activity logs' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
      const safePath = assertUploadPathSafe(req.file.path);
      const ext = path.extname(req.file.originalname || '').toLowerCase();
      if (!['.log', '.txt'].includes(ext)) {
        return res.status(400).json({ error: 'Only .log and .txt files are supported' });
      }
      const { previewActivityLogsFile } = await import('./activityLogs.js');
      const preview = await previewActivityLogsFile({
        filePath: safePath,
        filename: req.file.originalname,
        size: req.file.size,
      });

      try {
        await writeAuditLog({
          userId: auth.user.id,
          username: auth.user.username,
          action: 'ACTIVITY_LOGS_IMPORT_PREVIEW',
          module: 'Activity Logs',
          recordId: req.file.originalname,
          ipAddress: req.ip || '127.0.0.1',
          details: `Previewed activity logs file: ${preview.totalRecords} records (${preview.validRecords} valid, ${preview.invalidRecords} invalid)`,
        });
      } catch {
        // ignore
      }

      return res.json({
        ...preview,
        filePath: safePath,
        originalName: req.file.originalname,
      });
    } catch (err: any) {
      return res.status(400).json({ error: err.message || 'Failed to preview activity logs file' });
    }
  },
);

apiRouter.post('/activity-logs/import/confirm', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!auth.perms.canImport) {
    return res.status(403).json({ error: 'Insufficient permissions to import activity logs' });
  }

  const { filePath, originalName, forceDuplicate } = req.body || {};
  if (!filePath || typeof filePath !== 'string') {
    return res.status(400).json({ error: 'filePath is required' });
  }

  let safePath: string;
  try {
    safePath = assertUploadPathSafe(filePath);
  } catch (err: any) {
    return res.status(403).json({ error: err.message });
  }

  if (!fs.existsSync(safePath)) {
    return res.status(400).json({ error: 'Uploaded file not found. Please preview/upload again.' });
  }

  const ext = path.extname(String(originalName || safePath)).toLowerCase();
  if (ext && !['.log', '.txt'].includes(ext)) {
    return res.status(400).json({ error: 'Only .log and .txt files are supported' });
  }

  try {
    const { startActivityLogsImport } = await import('./activityLogs.js');
    const result = await startActivityLogsImport({
      filePath: safePath,
      filename: typeof originalName === 'string' && originalName.trim() ? originalName.trim() : path.basename(safePath),
      userId: auth.user.id,
      forceDuplicate: Boolean(forceDuplicate),
    });

    try {
      await writeAuditLog({
        userId: auth.user.id,
        username: auth.user.username,
        action: 'ACTIVITY_LOGS_IMPORT_START',
        module: 'Activity Logs',
        recordId: String(result.batchId),
        ipAddress: req.ip || '127.0.0.1',
        details: `Started activity logs import batch #${result.batchId}`,
      });
    } catch {
      // ignore
    }

    return res.status(202).json({
      success: true,
      jobId: result.jobId,
      batchId: result.batchId,
      status: 'PROCESSING',
    });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to start activity logs import' });
  }
});

apiRouter.get('/activity-logs/imports', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!auth.perms.canViewTables && !auth.perms.canImport) {
    return res.status(403).json({ error: 'Insufficient permissions to view activity logs import history' });
  }

  try {
    const { listActivityLogsImportBatches } = await import('./activityLogs.js');
    const batches = await listActivityLogsImportBatches();
    return res.json(batches);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to load activity logs import history' });
  }
});

apiRouter.get('/activity-logs/imports/:batchId', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!auth.perms.canViewTables && !auth.perms.canImport) {
    return res.status(403).json({ error: 'Insufficient permissions to view activity logs import batch' });
  }

  let batchId: bigint;
  try {
    batchId = BigInt(String(req.params.batchId));
  } catch {
    return res.status(400).json({ error: 'Invalid batch id' });
  }

  try {
    const { getActivityLogsImportBatch } = await import('./activityLogs.js');
    const batch = await getActivityLogsImportBatch(batchId);
    if (!batch) return res.status(404).json({ error: 'Activity logs import batch not found' });
    return res.json(batch);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to load activity logs import batch' });
  }
});

apiRouter.get('/activity-logs/imports/:batchId/errors', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!auth.perms.canViewTables && !auth.perms.canImport) {
    return res.status(403).json({ error: 'Insufficient permissions to view activity logs import errors' });
  }

  let batchId: bigint;
  try {
    batchId = BigInt(String(req.params.batchId));
  } catch {
    return res.status(400).json({ error: 'Invalid batch id' });
  }

  try {
    const { buildImportErrorReport } = await import('./activityLogs.js');
    const report = await buildImportErrorReport(batchId);
    if (!report) return res.status(404).json({ error: 'Activity logs import batch not found' });
    res.setHeader('Content-Type', report.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${report.filename}"`);
    res.setHeader('X-Export-Filename', report.filename);
    return res.send(report.content);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to generate import error report' });
  }
});

apiRouter.delete('/activity-logs/imports/:batchId', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!auth.perms.canImport) {
    return res.status(403).json({ error: 'Insufficient permissions to undo activity logs imports' });
  }

  let batchId: bigint;
  try {
    batchId = BigInt(String(req.params.batchId));
  } catch {
    return res.status(400).json({ error: 'Invalid batch id' });
  }

  try {
    const { undoActivityLogsImportBatch } = await import('./activityLogs.js');
    const result = await undoActivityLogsImportBatch({
      batchId,
      userId: auth.user.id,
      username: auth.user.username,
      ipAddress: req.ip || '127.0.0.1',
    });
    return res.json({ success: true, ...result });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to undo activity logs import batch' });
  }
});

apiRouter.get('/activity-logs/export', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!auth.perms.canExport) {
    return res.status(403).json({ error: 'Insufficient permissions to export activity logs' });
  }

  try {
    const formatRaw = String(req.query.format || 'csv').toLowerCase();
    if (!['csv', 'xlsx', 'pdf'].includes(formatRaw)) {
      return res.status(400).json({ error: 'Unsupported export format. Use csv, xlsx, or pdf.' });
    }
    const format = formatRaw as 'csv' | 'xlsx' | 'pdf';
    const language = req.query.lang === 'ar' ? 'ar' : 'en';

    let selectedColumns: string[] | undefined;
    if (typeof req.query.columns === 'string' && req.query.columns.trim()) {
      selectedColumns = req.query.columns.split(',').map((s) => s.trim()).filter(Boolean);
    }

    const { parseActivityLogListQuery, exportActivityLogs } = await import('./activityLogs.js');
    const params = parseActivityLogListQuery(req.query);
    const exported = await exportActivityLogs({ format, params, selectedColumns, language });

    try {
      await writeAuditLog({
        userId: auth.user.id,
        username: auth.user.username,
        action: 'ACTIVITY_LOGS_EXPORT',
        module: 'Activity Logs',
        recordId: format.toUpperCase(),
        ipAddress: req.ip || '127.0.0.1',
        details: `Exported activity logs as ${format.toUpperCase()} (${selectedColumns?.length ? selectedColumns.length + ' selected columns' : 'all columns'})`,
      });
    } catch {
      // ignore
    }

    res.setHeader('Content-Type', exported.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
    res.setHeader('X-Export-Filename', exported.filename);
    return res.send(exported.content);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to export activity logs' });
  }
});

apiRouter.get('/activity-logs', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!auth.perms.canViewTables) {
    return res.status(403).json({ error: 'Insufficient permissions to view activity logs' });
  }

  try {
    const { parseActivityLogListQuery, listActivityLogs } = await import('./activityLogs.js');
    const params = parseActivityLogListQuery(req.query);
    const result = await listActivityLogs(params);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to load activity logs' });
  }
});

apiRouter.get('/activity-logs/:id', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!auth.perms.canViewTables) {
    return res.status(403).json({ error: 'Insufficient permissions to view activity logs' });
  }

  let id: bigint;
  try {
    id = BigInt(String(req.params.id));
  } catch {
    return res.status(400).json({ error: 'Invalid activity log id' });
  }

  try {
    const { getActivityLogById } = await import('./activityLogs.js');
    const row = await getActivityLogById(id);
    if (!row) return res.status(404).json({ error: 'Activity log record not found' });
    return res.json(row);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to load activity log record' });
  }
});

// -----------------------------------------------------------------------------
// Global Search
// -----------------------------------------------------------------------------

const GlobalSearchTypeSchema = z.enum([
  'IMSI',
  'IMEI',
  'TMSI',
  'PSTN',
  'UNIQUE_CALL_ID',
  'SYSTEM_ID',
  'MAC_ADDRESS',
  'BSSID',
  'GENERAL_TEXT',
  'MISSION',
  'MCC',
  'MNC',
  'LAC',
  'CELL_ID',
]);

const GlobalSearchRequestSchema = z.object({
  searchType: GlobalSearchTypeSchema,
  searchValue: z.string().min(1, 'Search value is required'),
  matchMode: z.enum(['exact', 'partial']).optional().default('exact'),
  missionSearchField: z.enum(['id', 'label', 'name', 'location', 'mission', 'missionId', 'missionName']).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).optional().default(25),
  sortBy: z.string().trim().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional().default('asc'),
  filters: z.record(z.string(), z.any()).optional().default({}),
  selectedMissionIds: z.array(z.union([z.string(), z.number()])).optional().default([]),
  requestedTables: z.array(z.string()).optional().default([]),
});

const GlobalMissionSearchSchema = z.object({
  searchValue: z.string().min(1, 'Search value is required'),
  matchMode: z.enum(['exact', 'partial']).optional().default('exact'),
  missionSearchField: z.enum(['id', 'label', 'name', 'location', 'mission', 'missionId', 'missionName']).optional(),
});

function normalizeGlobalSearchInput(body: any) {
  const parsed = GlobalSearchRequestSchema.parse(body || {});
  const missionSearchField = parsed.missionSearchField === 'mission' ? 'label'
    : parsed.missionSearchField === 'missionId' ? 'id'
    : parsed.missionSearchField === 'missionName' ? 'name'
    : parsed.missionSearchField;
  return { ...parsed, missionSearchField } as any;
}

apiRouter.get('/global-search/sources', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!auth.perms.canViewTables) {
    return res.status(403).json({ error: 'Insufficient permissions to access global search sources' });
  }
  try {
    const { getRegistry, GLOBAL_SEARCH_TYPES } = await import('./globalSearch.js');
    const registry = getRegistry();
    return res.json({ searchTypes: GLOBAL_SEARCH_TYPES, sources: registry });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to load global search sources' });
  }
});

apiRouter.post('/global-search', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!auth.perms.canViewTables) {
    return res.status(403).json({ error: 'Insufficient permissions to use global search' });
  }
  try {
    const payload = normalizeGlobalSearchInput(req.body);
    const { executeGlobalSearch } = await import('./globalSearch.js');
    const result = await executeGlobalSearch(payload, auth.perms);
    try {
      await writeAuditLog({
        userId: auth.user.id,
        username: auth.user.username,
        action: 'GLOBAL_SEARCH',
        module: 'GlobalSearch',
        recordId: payload.searchType,
        ipAddress: req.ip || '127.0.0.1',
        result: 'SUCCESS',
        details: `Global search (${payload.searchType}, ${payload.matchMode}) executed`,
      });
    } catch {}
    return res.json(result);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      const zerr = err as any;
      return res.status(400).json({ error: zerr.issues?.[0]?.message || zerr.errors?.[0]?.message || 'Invalid global search request', issues: zerr.issues || zerr.errors });
    }
    return res.status(400).json({ error: err.message || 'Failed to execute global search' });
  }
});

apiRouter.get('/global-search/statistics', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!auth.perms.canViewTables) {
    return res.status(403).json({ error: 'Insufficient permissions to view global search statistics' });
  }
  try {
    let filters: any = {};
    if (typeof req.query.filters === 'string' && req.query.filters.trim()) {
      try { filters = JSON.parse(req.query.filters); } catch { filters = {}; }
    }
    const selectedMissionIds = typeof req.query.selectedMissionIds === 'string' && req.query.selectedMissionIds
      ? req.query.selectedMissionIds.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    const requestedTables = typeof req.query.requestedTables === 'string' && req.query.requestedTables
      ? req.query.requestedTables.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    const payload = normalizeGlobalSearchInput({
      searchType: req.query.searchType,
      searchValue: req.query.searchValue,
      matchMode: req.query.matchMode,
      missionSearchField: req.query.missionSearchField,
      filters,
      selectedMissionIds,
      requestedTables,
      page: 1,
      pageSize: 1,
    });
    const { getGlobalSearchStatistics } = await import('./globalSearch.js');
    const result = await getGlobalSearchStatistics(payload, auth.perms);
    return res.json(result);
  } catch (err: any) {
    if (err instanceof z.ZodError) { const zerr = err as any; return res.status(400).json({ error: (zerr.issues?.[0]?.message || zerr.errors?.[0]?.message || 'Invalid request'), issues: zerr.issues || zerr.errors }); }
    return res.status(400).json({ error: err.message || 'Failed to load global search statistics' });
  }
});

apiRouter.post('/global-search/missions', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!auth.perms.canViewTables) {
    return res.status(403).json({ error: 'Insufficient permissions to search missions' });
  }
  try {
    const parsed = GlobalMissionSearchSchema.parse(req.body || {});
    const missionSearchField = parsed.missionSearchField === 'mission' ? 'label'
      : parsed.missionSearchField === 'missionId' ? 'id'
      : parsed.missionSearchField === 'missionName' ? 'name'
      : parsed.missionSearchField;
    const { searchMissions } = await import('./globalSearch.js');
    const result = await searchMissions({ ...parsed, missionSearchField } as any);
    return res.json(result);
  } catch (err: any) {
    if (err instanceof z.ZodError) { const zerr = err as any; return res.status(400).json({ error: (zerr.issues?.[0]?.message || zerr.errors?.[0]?.message || 'Invalid mission search request'), issues: zerr.issues || zerr.errors }); }
    return res.status(400).json({ error: err.message || 'Failed to search missions' });
  }
});

apiRouter.get('/global-search/missions/:missionId/records', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!auth.perms.canViewTables) {
    return res.status(403).json({ error: 'Insufficient permissions to view mission records' });
  }
  const missionId = Number(req.params.missionId);
  if (!Number.isInteger(missionId) || missionId <= 0) {
    return res.status(400).json({ error: 'Invalid mission id' });
  }
  try {
    const { getMissionAssociatedRecords } = await import('./globalSearch.js');
    const result = await getMissionAssociatedRecords(missionId, {
      page: req.query.page ? Number(req.query.page) : undefined,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
      sortBy: typeof req.query.sortBy === 'string' ? req.query.sortBy : undefined,
      sortOrder: req.query.sortOrder === 'desc' ? 'desc' : 'asc',
      sourceTable: typeof req.query.sourceTable === 'string' ? req.query.sourceTable : undefined,
      dateFrom: typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined,
      dateTo: typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined,
    }, auth.perms);
    return res.json(result);
  } catch (err: any) {
    if (String(err?.message || '').includes('Mission not found')) {
      return res.status(404).json({ error: 'Mission not found' });
    }
    return res.status(400).json({ error: err.message || 'Failed to load mission records' });
  }
});

apiRouter.get('/global-search/record/:tableName/:recordId', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!auth.perms.canViewTables) {
    return res.status(403).json({ error: 'Insufficient permissions to view records' });
  }
  const { tableName, recordId } = req.params;
  if (!tableName || !recordId) return res.status(400).json({ error: 'tableName and recordId are required' });
  try {
    const { getGlobalSearchRecord } = await import('./globalSearch.js');
    const record = await getGlobalSearchRecord(tableName, recordId, auth.perms);
    if (!record) return res.status(404).json({ error: 'Record not found' });
    try {
      await writeAuditLog({
        userId: auth.user.id,
        username: auth.user.username,
        action: 'GLOBAL_SEARCH_RECORD_VIEW',
        module: 'GlobalSearch',
        recordId: `${tableName}:${recordId}`,
        ipAddress: req.ip || '127.0.0.1',
        result: 'SUCCESS',
      });
    } catch {}
    return res.json(record);
  } catch (err: any) {
    if (String(err?.message || '').includes('Access denied') || String(err?.message || '').includes('not allowed')) {
      return res.status(403).json({ error: err.message });
    }
    return res.status(400).json({ error: err.message || 'Failed to load record' });
  }
});

async function handleGlobalSearchExport(req: Request, res: Response) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!auth.perms.canExport) {
    return res.status(403).json({ error: 'Insufficient permissions to export global search results' });
  }
  try {
    const source = req.method === 'GET' ? req.query : req.body;
    let filters: any = {};
    if (typeof source.filters === 'string' && source.filters.trim()) {
      try { filters = JSON.parse(source.filters); } catch { filters = {}; }
    } else if (source.filters && typeof source.filters === 'object') {
      filters = source.filters;
    }
    const payload = normalizeGlobalSearchInput({
      searchType: source.searchType,
      searchValue: source.searchValue,
      matchMode: source.matchMode,
      missionSearchField: source.missionSearchField,
      filters,
      selectedMissionIds: typeof source.selectedMissionIds === 'string' ? source.selectedMissionIds.split(',').filter(Boolean) : (source.selectedMissionIds || []),
      requestedTables: typeof source.requestedTables === 'string' ? source.requestedTables.split(',').filter(Boolean) : (source.requestedTables || []),
      page: 1,
      pageSize: 1000000,
      sortBy: source.sortBy,
      sortOrder: source.sortOrder,
    });
    const format = String(source.format || 'csv').toLowerCase();
    if (!['csv', 'xlsx', 'pdf'].includes(format)) {
      return res.status(400).json({ error: 'Unsupported export format. Use csv, xlsx, or pdf.' });
    }
    const { exportGlobalSearch } = await import('./globalSearch.js');
    const exported = await exportGlobalSearch({
      ...payload,
      format: format as 'csv' | 'xlsx' | 'pdf',
      scope: (source.scope as any) || 'all',
      selectedTable: typeof source.selectedTable === 'string' ? source.selectedTable : undefined,
      selectedRecordKeys: Array.isArray(source.selectedRecordKeys) ? source.selectedRecordKeys : (typeof source.selectedRecordKeys === 'string' ? source.selectedRecordKeys.split(',').filter(Boolean) : undefined),
      selectedMissionIds: typeof source.selectedMissionIds === 'string' ? source.selectedMissionIds.split(',').filter(Boolean) : (source.selectedMissionIds || []),
      includeMissionSummary: String(source.includeMissionSummary || '').toLowerCase() === 'true' || source.includeMissionSummary === true,
    }, auth.perms);
    try {
      await writeAuditLog({
        userId: auth.user.id,
        username: auth.user.username,
        action: 'GLOBAL_SEARCH_EXPORT',
        module: 'GlobalSearch',
        recordId: String(format).toUpperCase(),
        ipAddress: req.ip || '127.0.0.1',
        result: 'SUCCESS',
        details: `Exported global search results as ${String(format).toUpperCase()}`,
      });
    } catch {}
    res.setHeader('Content-Type', exported.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
    res.setHeader('X-Export-Filename', exported.filename);
    return res.send(exported.content);
  } catch (err: any) {
    if (err instanceof z.ZodError) { const zerr = err as any; return res.status(400).json({ error: (zerr.issues?.[0]?.message || zerr.errors?.[0]?.message || 'Invalid export request'), issues: zerr.issues || zerr.errors }); }
    return res.status(400).json({ error: err.message || 'Failed to export global search results' });
  }
}

apiRouter.post('/global-search/export', handleGlobalSearchExport);
apiRouter.get('/global-search/export', handleGlobalSearchExport);


