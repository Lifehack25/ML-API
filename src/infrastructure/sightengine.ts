import { SightengineConfig } from '../config/env';
import { compressImage } from './image-compressor';

// Hard-coded moderation thresholds
const NUDITY_THRESHOLD = 0.9;
const VIOLENCE_THRESHOLD = 0.9;
const BASE_URL = 'https://api.sightengine.com/1.0';
const IMAGE_TOO_LARGE_ERROR_CODE = 14;

export interface ModerationResult {
  approved: boolean;
  rejectionReason?: string;
  scores?: Record<string, number>;
  compressedImage?: File; // If compression was used for moderation
}

/**
 * Client for the Sightengine content moderation API.
 * Supports image and video moderation to detect nudity, violence, and other unsafe content.
 */
export interface SightengineClient {
  /**
   * Moderate an image file.
   * If the image is too large, it automatically attempts to compress and retry.
   */
  moderateImage(file: File): Promise<ModerationResult>;
  moderateVideo(file: File): Promise<ModerationResult>;
}

const buildForm = (config: SightengineConfig, file: File, extra: Record<string, string> = {}) => {
  const form = new FormData();
  form.append(
    'media',
    file,
    file.name || 'upload' + (file.type.includes('video') ? '.mp4' : '.jpg')
  );
  form.append('api_user', config.user);
  form.append('api_secret', config.secret);
  for (const [key, value] of Object.entries(extra)) {
    form.append(key, value);
  }
  return form;
};

interface SightengineResponse {
  nudity?: {
    sexual?: number;
  };
  weapon?: number;
  gore?: {
    prob?: number;
  };
}

const evaluateResponse = (payload: SightengineResponse): ModerationResult => {
  const scores: Record<string, number> = {};
  const reasons: string[] = [];

  const nudityScore: number | undefined = payload?.nudity?.sexual;
  if (typeof nudityScore === 'number') {
    scores['nudity'] = nudityScore;
    if (nudityScore > NUDITY_THRESHOLD) {
      reasons.push(`Explicit content detected (score: ${nudityScore.toFixed(2)})`);
    }
  }

  const goreScore: number | undefined = payload?.gore?.prob;
  if (typeof goreScore === 'number') {
    scores['gore'] = goreScore;
    if (goreScore > VIOLENCE_THRESHOLD) {
      reasons.push(`Violent content detected (score: ${goreScore.toFixed(2)})`);
    }
  }

  if (reasons.length > 0) {
    return {
      approved: false,
      rejectionReason: reasons.join('; '),
      scores,
    };
  }

  return {
    approved: true,
    scores,
  };
};

export const createSightengineClient = (
  config?: SightengineConfig,
  imagesBinding?: ImagesBinding
): SightengineClient => {
  // If Sightengine is not configured, allow all content through
  if (!config) {
    return {
      moderateImage: async () => ({ approved: true }),
      moderateVideo: async () => ({ approved: true }),
    };
  }

  const checkImage = async (file: File): Promise<ModerationResult> => {
    let retriedWithCompression = false;
    let compressedFile: File | null = null;
    let fileToModerate = file;

    while (true) {
      try {
        const form = buildForm(config, fileToModerate, {
          models: 'nudity-2.0,wad,gore',
        });

        const response = await fetch(`${BASE_URL}/check.json`, {
          method: 'POST',
          body: form,
        });

        const payload = await response.json<any>();

        // Check for error code 14 (image too large) in response
        if (payload?.error?.code === IMAGE_TOO_LARGE_ERROR_CODE && !retriedWithCompression) {
          console.warn(
            'Sightengine rejected image as too large (code 14). Compressing and retrying.',
            `Original size: ${file.size} bytes`
          );

          // Fail fast if Images binding is not available
          if (!imagesBinding) {
            console.error('Cannot compress image: Images binding not available');
            return {
              approved: false,
              rejectionReason: 'Image compression unavailable (server configuration error)',
            };
          }

          const compressionStartTime = performance.now();
          const compressionResult = await compressImage(file, imagesBinding, 90);
          const compressionEndTime = performance.now();
          const compressionDurationMs = compressionEndTime - compressionStartTime;

          if (!compressionResult.success) {
            console.error('Failed to compress image:', compressionResult.error);
            return {
              approved: false,
              rejectionReason: 'Unable to compress image for moderation retry',
            };
          }

          compressedFile = compressionResult.compressed;
          fileToModerate = compressedFile;

          console.log(
            'Retrying Sightengine moderation with compressed image.',
            `Original: ${file.size} bytes, Compressed: ${compressedFile.size} bytes, CPU time: ${compressionDurationMs.toFixed(2)}ms`
          );

          retriedWithCompression = true;
          continue; // Retry with compressed image
        }

        if (!response.ok) {
          console.error(
            'Sightengine image moderation failed',
            response.status,
            response.statusText
          );
          return { approved: false, rejectionReason: 'Moderation service error' };
        }

        const result = evaluateResponse(payload);

        // Include compressed image in result if we used compression
        if (retriedWithCompression && compressedFile) {
          return {
            ...result,
            compressedImage: compressedFile,
          };
        }

        return result;
      } catch (error) {
        console.error('Sightengine image moderation error', error);
        return { approved: false, rejectionReason: 'Moderation service error' };
      }
    }
  };

  const checkVideo = async (file: File): Promise<ModerationResult> => {
    try {
      const form = buildForm(config, file, {
        models: 'nudity-2.0,wad,gore',
        mode: 'sync',
      });

      const response = await fetch(`${BASE_URL}/video/check-sync.json`, {
        method: 'POST',
        body: form,
      });

      if (!response.ok) {
        console.error('Sightengine video moderation failed', response.status, response.statusText);
        return { approved: false, rejectionReason: 'Moderation service error' };
      }

      const payload = await response.json<any>();
      const result = Array.isArray(payload?.results) ? payload.results[0] : payload;
      return evaluateResponse(result);
    } catch (error) {
      console.error('Sightengine video moderation error', error);
      return { approved: false, rejectionReason: 'Moderation service error' };
    }
  };

  return {
    moderateImage: checkImage,
    moderateVideo: checkVideo,
  };
};
