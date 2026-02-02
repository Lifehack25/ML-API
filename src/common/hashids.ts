import Hashids from 'hashids';
import { HashIdsConfig } from '../config/env';

/**
 * Utility for hashing numeric IDs into short, URL-safe strings.
 * Used for public-facing resource identifiers (e.g., lock IDs).
 */
export interface HashIdHelper {
  encode(id: number): string;
  decode(input: string): number | null;
  isHash(input: string): boolean;
}

export const createHashIdHelper = (config: HashIdsConfig): HashIdHelper => {
  const hashids = new Hashids(config.salt, config.minLength);

  return {
    encode: (id: number) => hashids.encode(id),
    decode: (input: string) => {
      const [decoded] = hashids.decode(input);
      return typeof decoded === 'number' ? decoded : null;
    },
    isHash: (input: string) => {
      if (!input) return false;
      const decoded = hashids.decode(input);
      return decoded.length === 1 && typeof decoded[0] === 'number';
    },
  };
};
