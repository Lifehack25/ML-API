import { vi } from 'vitest';

// Mock the global caches object for Cloudflare Workers
const mockCache = {
    match: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).caches = {
    default: mockCache,
    open: vi.fn().mockResolvedValue(mockCache),
};
