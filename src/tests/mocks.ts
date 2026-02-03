import { vi } from 'vitest';
import type { AppConfig } from '../config/env';

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
    list: vi.fn(),
} as unknown as R2Bucket;

// Mocking Cloudflare Images binding
export const mockImages = {
    upload: vi.fn(),
} as unknown as ImagesBinding;

export const mockConfig: AppConfig = {
    environment: 'test',
    createLockApiKey: 'mock-api-key-for-testing',
    pushNotificationKey: 'mock-push-key-for-testing',
    jwt: {
        secret: 'mock-jwt-secret-for-testing-only',
        issuer: 'test-issuer',
        audience: 'test-audience',
        accessTokenExpiryHours: 1,
        refreshTokenExpiryDays: 1,
    },
    hashids: {
        salt: 'mock-salt-for-testing',
        minLength: 8,
    },
    google: {
        androidClientId: 'mock-android-client-id',
        iosClientId: 'mock-ios-client-id',
    },
    storageLimits: {
        tier1ImageLimit: 50,
        tier1VideoSeconds: 60,
        tier2ImageLimit: 100,
        tier2VideoSeconds: 120,
        maxVideoSizeMB: 100,
    },
    apple: {
        bundleId: 'com.memorylocks.mlmobileapp',
        teamId: 'mock-team-id',
        keyId: 'mock-key-id',
        authKeyPem: 'mock-auth-key-pem',
    },
    revenueCat: {
        webhookAuthKey: 'mock-rc-webhook-key',
    },
    sightengine: {
        user: 'mock-sightengine-user',
        secret: 'mock-sightengine-secret',
    },
    twilio: {
        accountSid: 'mock-twilio-sid',
        authToken: 'mock-twilio-token',
        verifyServiceSid: 'mock-verify-sid',
    },
    cloudflareMedia: {
        accountId: 'mock-cf-account-id',
        uploadToken: 'mock-cf-token',
    },
    firebase: {
        serviceAccountJson: '{}',
    },
};
