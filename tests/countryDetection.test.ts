import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { initDatabase } from '../server/db.js';
import {
  detectCountryFromImsi,
  fillCountryOnRecord,
  previewBackfillCountries,
  backfillCountries,
} from '../server/countryDetection.js';
import { MCC_COUNTRIES } from '../server/mcc-countries.js';

const tempFiles: string[] = [];

function createTempDbPath(prefix: string): string {
  const p = path.join(os.tmpdir(), `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}.sqlite`);
  tempFiles.push(p);
  return p;
}

after(() => {
  for (const f of tempFiles) {
    try {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch {
      // ignore cleanup failures
    }
  }
});

describe('MCC Country Detection (static mapping)', () => {
  test('detects country from the 3-digit MCC prefix of an IMSI', () => {
    assert.equal(detectCountryFromImsi('602xxxxxxxxxxx'), 'Egypt');
    assert.equal(detectCountryFromImsi('425xxxxxxxxxxx'), 'Israel');
    assert.equal(detectCountryFromImsi('416xxxxxxxxxxx'), 'Jordan');
    assert.equal(detectCountryFromImsi('604xxxxxxxxxxx'), 'Morocco');
  });

  test('returns null for unknown MCCs, invalid or missing IMSIs', () => {
    assert.equal(detectCountryFromImsi('999xxxxxxxxxxx'), null);
    assert.equal(detectCountryFromImsi(''), null);
    assert.equal(detectCountryFromImsi('   '), null);
    assert.equal(detectCountryFromImsi('abc1234567890'), null);
    assert.equal(detectCountryFromImsi('60'), null);
    assert.equal(detectCountryFromImsi(null), null);
    assert.equal(detectCountryFromImsi(undefined), null);
  });

  test('accepts numeric IMSI values and trims surrounding whitespace', () => {
    assert.equal(detectCountryFromImsi(602123456789012 as number), 'Egypt');
    assert.equal(detectCountryFromImsi('  602123456789012  '), 'Egypt');
  });
});

describe('fillCountryOnRecord', () => {
  test('fills missing country from IMSI and never overwrites existing values', () => {
    const rec: Record<string, any> = { imsi: '602019948271044', country: null };
    assert.equal(fillCountryOnRecord(rec), true);
    assert.equal(rec.country, 'Egypt');

    const existing: Record<string, any> = { imsi: '602019948271044', country: 'Saudi Arabia' };
    assert.equal(fillCountryOnRecord(existing), false);
    assert.equal(existing.country, 'Saudi Arabia');
  });
});

describe('Backfill preview & backfill via static MCC mapping', () => {
  const dbPath = createTempDbPath('mcc_backfill_test');
  const testDb = new DatabaseSync(dbPath);

  after(() => {
    testDb.close();
  });

  test('preview counts missing / valid / unknown / invalid IMSIs and backfill fills only recognized missing values', async () => {
    await initDatabase();
    testDb.prepare(`INSERT INTO missions (id, mission, mission_name, location) VALUES (1, 'MCC_OP', 'MCC Op', 'Sector A')`).run();
    testDb.prepare(`INSERT INTO registrations (reg_id, mission_id, mission, country, imsi) VALUES ('R-MCC-1', 1, 'MCC_OP', NULL, '602019948271044')`).run();
    testDb.prepare(`INSERT INTO registrations (reg_id, mission_id, mission, country, imsi) VALUES ('R-MCC-2', 1, 'MCC_OP', NULL, '9991234567890')`).run();
    testDb.prepare(`INSERT INTO registrations (reg_id, mission_id, mission, country, imsi) VALUES ('R-MCC-3', 1, 'MCC_OP', NULL, 'invalid-imsi')`).run();
    testDb.prepare(`INSERT INTO registrations (reg_id, mission_id, mission, country, imsi) VALUES ('R-MCC-4', 1, 'MCC_OP', 'Jordan', '4160111223344')`).run();

    const preview = await previewBackfillCountries();
    assert.equal(preview.totalMissing, 3, 'Only rows with missing countries are counted');
    assert.equal(preview.validMatches, 1, 'MCC 602 must resolve to Egypt');
    assert.equal(preview.unknownMcc, 1, 'MCC 999 must be reported as unknown');
    assert.equal(preview.invalidImsi, 1, 'Invalid IMSI must be reported');
    assert.deepEqual(preview.unknownMccValues, ['999']);

    const res = await backfillCountries();
    assert.equal(res.updated, 1, 'Backfill must update only the recognized missing record');

    const row = testDb.prepare(`SELECT country FROM registrations WHERE imsi = '602019948271044'`).get() as any;
    assert.equal(row.country, 'Egypt');

    const jordan = testDb.prepare(`SELECT country FROM registrations WHERE imsi = '4160111223344'`).get() as any;
    assert.equal(jordan.country, 'Jordan', 'Existing country values must never be overwritten');
  });
});
