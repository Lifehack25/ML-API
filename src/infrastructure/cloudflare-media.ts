import { CloudflareMediaConfig } from '../config/env';

export interface CloudflareUploadResult {
  success: boolean;
  cloudflareId: string | null;
  url: string | null;
  thumbnailUrl: string | null;
  durationSeconds?: number | null;
  error?: string;
}

interface CloudflareImageResponse {
  success: boolean;
  errors?: Array<{ message: string }>;
  result?: {
    id: string;
    variants?: string[];
  };
}

interface CloudflareVideoResponse {
  success: boolean;
  errors?: Array<{ message: string }>;
  result?: {
    uid: string;
    playback?: {
      hls?: string;
    };
    thumbnail?: string;
    duration?: number;
  };
}

/**
 * Client for Cloudflare Images and Stream.
 * Handles uploading and deleting media assets.
 */
export interface CloudflareMediaClient {
  uploadImage(file: File): Promise<CloudflareUploadResult>;
  uploadVideo(file: File): Promise<CloudflareUploadResult>;
  deleteImage(identifier: string): Promise<boolean>;
  deleteVideo(uid: string): Promise<boolean>;
}

const IMAGES_ENDPOINT = (config: CloudflareMediaConfig) =>
  `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/images/v1`;

const STREAM_ENDPOINT = (config: CloudflareMediaConfig) =>
  `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/stream`;

const authHeaders = (config: CloudflareMediaConfig) => ({
  Authorization: `Bearer ${config.uploadToken}`,
});

const extractAccountHash = (variant?: string | null): string | null => {
  if (!variant) return null;
  try {
    const url = new URL(variant);
    const segments = url.pathname.split('/').filter(Boolean);
    return segments.length > 0 ? segments[0] : null;
  } catch {
    return null;
  }
};

const extractImageId = (identifier: string): string | null => {
  if (!identifier) return null;
  if (!identifier.includes('/')) {
    return identifier;
  }

  try {
    const segments = new URL(identifier).pathname.split('/').filter(Boolean);
    return segments.length >= 2 ? segments[segments.length - 2] : null;
  } catch {
    return null;
  }
};

export const createCloudflareMediaClient = (
  config?: CloudflareMediaConfig
): CloudflareMediaClient => {
  if (!config) {
    return {
      uploadImage: async () => ({
        success: false,
        cloudflareId: null,
        url: null,
        thumbnailUrl: null,
        error: 'Cloudflare media not configured',
      }),
      uploadVideo: async () => ({
        success: false,
        cloudflareId: null,
        url: null,
        thumbnailUrl: null,
        error: 'Cloudflare media not configured',
      }),
      deleteImage: async () => false,
      deleteVideo: async () => false,
    };
  }

  const uploadImage = async (file: File): Promise<CloudflareUploadResult> => {
    const form = new FormData();
    form.append('file', file, file.name || 'image.jpg');

    const response = await fetch(IMAGES_ENDPOINT(config), {
      method: 'POST',
      headers: authHeaders(config),
      body: form,
    });

    const payload = await response.json<CloudflareImageResponse>().catch(() => null);

    if (!response.ok || !payload?.success || !payload?.result?.id) {
      const errorMessage = payload?.errors?.[0]?.message || response.statusText || 'Upload failed';
      console.error('Cloudflare image upload failed', errorMessage);
      return {
        success: false,
        cloudflareId: null,
        url: null,
        thumbnailUrl: null,
        error: errorMessage,
      };
    }

    const imageId: string = payload.result.id;
    const accountHash = extractAccountHash(payload.result.variants?.[0]) ?? '';
    const baseUrl = accountHash ? `https://imagedelivery.net/${accountHash}/${imageId}` : null;

    return {
      success: true,
      cloudflareId: imageId,
      url: baseUrl ? `${baseUrl}/standard` : null,
      thumbnailUrl: baseUrl ? `${baseUrl}/thumb` : null,
    };
  };

  const uploadVideo = async (file: File): Promise<CloudflareUploadResult> => {
    const form = new FormData();
    form.append('file', file, file.name || 'video.mp4');

    const response = await fetch(STREAM_ENDPOINT(config), {
      method: 'POST',
      headers: authHeaders(config),
      body: form,
    });

    const payload = await response.json<CloudflareVideoResponse>().catch(() => null);

    if (!response.ok || !payload?.success || !payload?.result?.uid) {
      const errorMessage = payload?.errors?.[0]?.message || response.statusText || 'Upload failed';
      console.error('Cloudflare video upload failed', errorMessage);
      return {
        success: false,
        cloudflareId: null,
        url: null,
        thumbnailUrl: null,
        error: errorMessage,
      };
    }

    const uid: string = payload.result.uid;
    const duration =
      typeof payload.result.duration === 'number' && payload.result.duration > 0
        ? Math.round(payload.result.duration)
        : null;

    return {
      success: true,
      cloudflareId: uid,
      url: `https://videodelivery.net/${uid}/manifest/video.m3u8`,
      thumbnailUrl: `https://videodelivery.net/${uid}/thumbnails/thumbnail.jpg?time=1s&width=300`,
      durationSeconds: duration,
    };
  };

  const deleteImage = async (identifier: string): Promise<boolean> => {
    const imageId = extractImageId(identifier);
    if (!imageId) {
      return false;
    }

    const response = await fetch(`${IMAGES_ENDPOINT(config)}/${imageId}`, {
      method: 'DELETE',
      headers: authHeaders(config),
    });

    if (!response.ok) {
      console.error('Cloudflare image delete failed', response.status, response.statusText);
    }

    return response.ok;
  };

  const deleteVideo = async (uid: string): Promise<boolean> => {
    const response = await fetch(`${STREAM_ENDPOINT(config)}/${uid}`, {
      method: 'DELETE',
      headers: authHeaders(config),
    });

    if (!response.ok) {
      console.error('Cloudflare video delete failed', response.status, response.statusText);
    }

    return response.ok;
  };

  return {
    uploadImage,
    uploadVideo,
    deleteImage,
    deleteVideo,
  };
};
