import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../../index';
import { mockConfig } from '../../mocks';
import { success } from '../../../common/result';
import { createLogger } from '../../../common/logger';

const mockAlbumService = {
  getAlbumData: vi.fn(),
  decodeLockId: vi.fn(),
};

const mockScanCounter = {
  incrementScanAndNotify: vi.fn().mockResolvedValue(undefined),
};

const mockContainer = {
  logger: createLogger('test-req-id'),
  services: {
    albums: mockAlbumService,
    scanCounter: mockScanCounter,
  },
};

vi.mock('../../../common/context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../common/context')>();
  return {
    ...actual,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createRequestContext: vi.fn().mockImplementation(() => mockContainer as any),
  };
});

describe('Web Album Routes Integration', () => {
  let app: ReturnType<typeof buildApp>;
  const assetFetch = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const executionCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as any;
  const env = {
    ASSETS: {
      fetch: assetFetch,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp(mockConfig);

    assetFetch.mockImplementation(async (request: Request) => {
      const url = new URL(request.url);
      if (url.pathname === '/index.html') {
        return new Response(
          '<!DOCTYPE html><html><head><title>Memory Locks Album</title></head><body></body></html>',
          {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          }
        );
      }

      if (url.pathname === '/style.css') {
        return new Response('body { color: #000; }', {
          status: 200,
          headers: { 'Content-Type': 'text/css; charset=utf-8' },
        });
      }

      return new Response('Not found', { status: 404 });
    });
  });

  it('serves album HTML from a hashed path URL', async () => {
    mockAlbumService.getAlbumData.mockResolvedValue(
      success({
        AlbumTitle: 'Romeo & Juliet',
        SealDate: '2026-03-04',
        Media: [],
      })
    );
    mockAlbumService.decodeLockId.mockReturnValue(123);

    const response = await app.request(
      '/NqxePD',
      {
        method: 'GET',
        headers: { host: 'album.memorylocks.com' },
      },
      env,
      executionCtx
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('https://album.memorylocks.com/NqxePD');
    expect(mockAlbumService.getAlbumData).toHaveBeenCalledWith('NqxePD');
    expect(mockScanCounter.incrementScanAndNotify).toHaveBeenCalledWith(123);
  });

  it('does not increment scans for owner views', async () => {
    mockAlbumService.getAlbumData.mockResolvedValue(
      success({
        AlbumTitle: 'Owner Preview',
        SealDate: null,
        Media: [],
      })
    );

    const response = await app.request(
      '/NqxePD?isOwner=true',
      {
        method: 'GET',
        headers: { host: 'album.memorylocks.com' },
      },
      env,
      executionCtx
    );

    expect(response.status).toBe(200);
    expect(mockScanCounter.incrementScanAndNotify).not.toHaveBeenCalled();
  });

  it('rejects the legacy query-style album entrypoint', async () => {
    const response = await app.request(
      '/?id=NqxePD',
      {
        method: 'GET',
        headers: { host: 'album.memorylocks.com' },
      },
      env,
      executionCtx
    );

    expect(response.status).toBe(404);
    expect(mockAlbumService.getAlbumData).not.toHaveBeenCalled();
  });

  it('still serves static assets from the album host', async () => {
    const response = await app.request(
      '/style.css',
      {
        method: 'GET',
        headers: { host: 'album.memorylocks.com' },
      },
      env,
      executionCtx
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('color: #000');
  });
});
