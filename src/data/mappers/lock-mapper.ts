import type { Lock } from "../schema";
import type { LockSummary, DateOnlyString } from "../../business/dtos/locks";
import type { HashIdHelper } from "../../common/hashids";

const bool = (value: number | boolean): boolean =>
  typeof value === "boolean" ? value : value !== 0;

export const mapLockRowToSummary = (row: Lock, hashids: HashIdHelper): LockSummary => ({
  lockId: row.id,
  hashedLockId: hashids.encode(row.id),
  lockName: row.lock_name,
  sealDate: (row.seal_date ?? null) as DateOnlyString | null,
  scanCount: row.scan_count,
  upgradedStorage: bool(row.upgraded_storage),
});
