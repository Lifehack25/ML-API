import { vi } from 'vitest';

export const mockD1 = {
    prepare: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    batched: async (_: any[]) => [],
    exec: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    batch: vi.fn(),
    dump: vi.fn(),
} as unknown as D1Database;

export const mockKV = {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
} as unknown as KVNamespace;

export const mockR2 = {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
} as unknown as R2Bucket;

export const mockImages = {
    upload: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as unknown as any; // Type is loosely defined for now

export const mockConfig = {
    environment: 'test',
    appleBundleId: 'com.example.app',
    revenueCat: {
        webhookAuth: 'test-auth',
    },
    jwt: {
        secret: 'test-secret-key',
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;
