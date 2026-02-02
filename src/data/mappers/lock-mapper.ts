import type { Lock } from "../schema";
import type { LockSummary, DateOnlyString } from "../../services/dtos/locks";
import type { HashIdHelper } from "../../common/hashids";

const bool = (value: number | boolean): boolean =>
  typeof value === "boolean" ? value : value !== 0;

const parseGeoLocation = (geoLocationText: string | null): { lat: number; lng: number } | null => {
  if (!geoLocationText) return null;

  try {
    const parsed = JSON.parse(geoLocationText);
    // Validate structure
    if (typeof parsed.lat === 'number' && typeof parsed.lng === 'number') {
      return { lat: parsed.lat, lng: parsed.lng };
    }
    return null;
  } catch {
    return null; // Invalid JSON gracefully returns null
  }
};

export const mapLockRowToSummary = (row: Lock, hashids: HashIdHelper): LockSummary => ({
  lockId: row.id,
  hashedLockId: hashids.encode(row.id),
  lockName: row.lock_name,
  sealDate: (row.seal_date ?? null) as DateOnlyString | null,
  scanCount: row.scan_count,
  upgradedStorage: bool(row.upgraded_storage),
  geoLocation: parseGeoLocation(row.geo_location),
  image: row.image ?? null,
});
