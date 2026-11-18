import { Prisma, PrismaClient } from '@prisma/client';
import { db } from './db.js';
import { MCC_COUNTRIES } from './mcc-countries.js';

type SqlDatabase = PrismaClient | Prisma.TransactionClient;

function extractMccFromImsi(
  imsi: string | number | bigint | null | undefined,
): string | null {
  if (imsi === null || imsi === undefined) return null;

  const normalized = String(imsi).trim();

  // An IMSI must contain at least its three-digit MCC.
  if (!/^\d{3,}$/.test(normalized)) return null;

  return normalized.slice(0, 3);
}

export function detectCountryFromImsi(
  imsi: string | number | bigint | null | undefined,
): string | null {
  const mcc = extractMccFromImsi(imsi);
  return mcc ? MCC_COUNTRIES[mcc] ?? null : null;
}

export function isCountryMissing(value: unknown): boolean {
  return value === null ||
    value === undefined ||
    String(value).trim() === '';
}

export function fillCountryOnRecord(
  record: Record<string, any>,
): boolean {
  if (!isCountryMissing(record.country)) return false;

  const detected = detectCountryFromImsi(record.imsi);
  if (!detected) return false;

  record.country = detected;
  return true;
}

export interface BackfillPreview {
  totalMissing: number;
  validMatches: number;
  unknownMcc: number;
  invalidImsi: number;
  unknownMccValues: string[];
}

interface RegistrationCountryRow {
  id: number;
  imsi: string | null;
  country: string | null;
}

async function loadMissingCountryRows(
  database: SqlDatabase,
): Promise<RegistrationCountryRow[]> {
  return database.$queryRaw<RegistrationCountryRow[]>`
    SELECT id, imsi, country
    FROM registrations
    WHERE country IS NULL OR BTRIM(country) = ''
    ORDER BY id
  `;
}

export async function previewBackfillCountries(
  targetDb: SqlDatabase = db,
): Promise<BackfillPreview> {
  const rows = await loadMissingCountryRows(targetDb);

  let validMatches = 0;
  let unknownMcc = 0;
  let invalidImsi = 0;

  const unknownSet = new Set<string>();

  for (const row of rows) {
    const mcc = extractMccFromImsi(row.imsi);

    if (!mcc) {
      invalidImsi++;
      continue;
    }

    if (MCC_COUNTRIES[mcc]) {
      validMatches++;
    } else {
      unknownMcc++;
      unknownSet.add(mcc);
    }
  }

  return {
    totalMissing: rows.length,
    validMatches,
    unknownMcc,
    invalidImsi,
    unknownMccValues: [...unknownSet].sort(),
  };
}

export async function backfillCountries(
  _userId?: number,
  targetDb: SqlDatabase = db,
): Promise<{ updated: number }> {
  // Prisma.TransactionClient has no $transaction(), so only open one when the
  // caller passed the root client.
  const run = async (tx: SqlDatabase): Promise<{ updated: number }> => {
    const rows = await loadMissingCountryRows(tx);

    // One UPDATE per country instead of one per row.
    const idsByCountry = new Map<string, number[]>();

    for (const row of rows) {
      const country = detectCountryFromImsi(row.imsi);
      if (!country) continue;

      const ids = idsByCountry.get(country) ?? [];
      ids.push(row.id);
      idsByCountry.set(country, ids);
    }

    let updated = 0;

    for (const [country, ids] of idsByCountry) {
      for (let i = 0; i < ids.length; i += 5000) {
        const chunk = ids.slice(i, i + 5000);

        updated += await tx.$executeRaw`
          UPDATE registrations
          SET country = ${country}
          WHERE id = ANY(${chunk}::int[])
            AND (country IS NULL OR BTRIM(country) = '')
        `;
      }
    }

    return { updated };
  };

  return '$transaction' in targetDb
    ? (targetDb as PrismaClient).$transaction(run, { timeout: 120_000 })
    : run(targetDb);
}