import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { apiRouter } from '../server/routes.js';
import { generateToken } from '../server/auth.js';
import { requestCache } from '../src/utils/requestCache.js';

function startTestServer(): Promise<{ server: http.Server; baseUrl: string }> {
  return new Promise(resolve => {
    const app = express();
    app.use(express.json({ limit: '10mb' }));
    app.use('/api/v1', apiRouter);
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}/api/v1` });
    });
  });
}

describe('Application-Wide Loading System & Independent Widget Endpoints', () => {
  test('Widget endpoints enforce auth, RBAC TMSI checks, 404 for unknown widgets, and match dashboard metrics', async () => {
    const { server, baseUrl } = await startTestServer();
    const adminToken = generateToken({
      id: 1,
      username: 'admin_widget_test',
      email: 'admin@enterprise.local',
      fullName: 'Admin Test',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
    });
    const analystToken = generateToken({
      id: 951,
      username: 'analyst_widget_test',
      email: 'analyst@enterprise.local',
      fullName: 'Analyst Test',
      role: 'DATA_ANALYST',
      status: 'ACTIVE',
    });

    try {
      // 1. Auth required
      const unauthWidget = await fetch(`${baseUrl}/analytics/widget/kpis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      assert.equal(unauthWidget.status, 401);

      const unauthBackups = await fetch(`${baseUrl}/system/backups`);
      assert.equal(unauthBackups.status, 401);

      // 2. Unknown widget -> 404
      const unknownRes = await fetch(`${baseUrl}/analytics/widget/nonExistentWidget`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      assert.equal(unknownRes.status, 404);

      // 3. Analyst filtering by TMSI -> 403
      const tmsiDeniedRes = await fetch(`${baseUrl}/analytics/widget/kpis`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${analystToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tmsi: '00001234' }),
      });
      assert.equal(tmsiDeniedRes.status, 403);

      // 4. Full dashboard vs independent widget consistency
      const dashRes = await fetch(`${baseUrl}/analytics/dashboard`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      assert.equal(dashRes.status, 200);
      const fullDashboard = await dashRes.json();

      const widgetChecks: Array<{ id: string; assertFn: (data: any) => void }> = [
        {
          id: 'kpis',
          assertFn: data => {
            assert.deepEqual(data, fullDashboard.kpis);
          },
        },
        {
          id: 'registrationsByCountry',
          assertFn: data => {
            assert.deepEqual(data, fullDashboard.registrationsByCountry);
          },
        },
        {
          id: 'btsMap',
          assertFn: data => {
            assert.ok(Array.isArray(data.locations));
            assert.equal(data.locations.length, fullDashboard.btsMap.locations.length);
          },
        },
        {
          id: 'networkCellsByMcc',
          assertFn: data => {
            assert.deepEqual(data, fullDashboard.networkCellsByMcc);
          },
        },
        {
          id: 'militaryNetworks',
          assertFn: data => {
            assert.deepEqual(data, fullDashboard.militaryNetworks);
          },
        },
        {
          id: 'civilianNetworks',
          assertFn: data => {
            assert.deepEqual(data, fullDashboard.civilianNetworks);
          },
        },
        {
          id: 'operationalSummary',
          assertFn: data => {
            assert.deepEqual(data.cellsByRat, fullDashboard.cellsByRat);
            assert.deepEqual(data.activityTimeline, fullDashboard.activityTimeline);
            assert.deepEqual(data.qualityStats, fullDashboard.qualityStats);
          },
        },
        {
          id: 'qualityStats',
          assertFn: data => {
            assert.deepEqual(data, fullDashboard.qualityStats);
          },
        },
      ];

      const results = await Promise.all(
        widgetChecks.map(async w => {
          const r = await fetch(`${baseUrl}/analytics/widget/${w.id}`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${adminToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({}),
          });
          assert.equal(r.status, 200, `Widget ${w.id} must return 200`);
          const json = await r.json();
          w.assertFn(json);
          return w.id;
        })
      );
      assert.equal(results.length, 8);

      // 5. Real backups listing endpoint
      const backupsRes = await fetch(`${baseUrl}/system/backups`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.equal(backupsRes.status, 200);
      const backups = await backupsRes.json();
      assert.ok(Array.isArray(backups));
      for (const b of backups) {
        assert.equal(typeof b.name, 'string');
        assert.equal(typeof b.sizeBytes, 'number');
        assert.equal(typeof b.createdAt, 'string');
      }
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  test('requestCache supports TTL expiration, prefix invalidation, and full clear', async () => {
    requestCache.clear();
    requestCache.set('dashboard:kpis:all', { count: 42 });
    requestCache.set('dashboard:btsMap:all', { markers: [] });
    requestCache.set('system:data-dictionary', [{ table: 'missions' }]);

    assert.deepEqual(requestCache.get('dashboard:kpis:all', 10_000), { count: 42 });

    // Prefix invalidation removes only dashboard keys
    requestCache.invalidate('dashboard:');
    assert.equal(requestCache.get('dashboard:kpis:all'), undefined);
    assert.equal(requestCache.get('dashboard:btsMap:all'), undefined);
    assert.deepEqual(requestCache.get('system:data-dictionary'), [{ table: 'missions' }]);

    // Expired TTL returns undefined
    await new Promise(r => setTimeout(r, 15));
    assert.equal(requestCache.get('system:data-dictionary', 5), undefined);

    requestCache.clear();
    assert.equal(requestCache.get('system:data-dictionary', 60_000), undefined);
  });

  test('Frontend loading code does not simulate loading via setTimeout in ExportCenter or ImportCenter', () => {
    const exportCenterSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/ExportCenter.tsx'), 'utf8');
    const importCenterSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/ImportCenter.tsx'), 'utf8');
    const backupSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/BackupRecovery.tsx'), 'utf8');

    assert.ok(!exportCenterSrc.includes('setTimeout'), 'ExportCenter must use real fetch streams, never fake setTimeout');
    assert.ok(!importCenterSrc.includes('setTimeout'), 'ImportCenter must await schema effects cleanly without setTimeout');
    assert.ok(!backupSrc.includes('enterprise_backup_baseline_20261112.sqlite'), 'BackupRecovery must not hardcode fake initial backups');
  });
});
