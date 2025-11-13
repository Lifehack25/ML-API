export interface EnvBindings {
  DB: D1Database;
  IDEMPOTENCY_KEYS: KVNamespace;
  ASSETS: Fetcher;
  IMAGES: ImagesBinding;
  CREATE_LOCK_API_KEY: string;
  PUSH_NOTIFICATION_KEY: string;
  HASHIDS_SALT: string;

  // Twilio
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_VERIFY_SERVICE_SID?: string;

  // Sightengine
  SIGHTENGINE_USER?: string;
  SIGHTENGINE_SECRET?: string;

  // Cloudflare media
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_UPLOAD_TOKEN?: string;

  // Cloudflare cache purge
  CLOUDFLARE_ZONE_ID?: string;
  CLOUDFLARE_PURGE_TOKEN?: string;

  // Firebase
  FIREBASE_SERVICE_ACCOUNT_JSON?: string;

  // JWT
  JWT_SECRET?: string;

  // OAuth
  APPLE_BUNDLE_ID?: string;
  APPLE_TEAM_ID?: string;
  APPLE_KEY_ID?: string;
  APPLE_AUTH_KEY_PEM?: string;

  GOOGLE_ANDROID_CLIENT_ID?: string;
  GOOGLE_IOS_CLIENT_ID?: string;

  // Environment
  ENVIRONMENT?: string;
}

export type AppContext = {
  Bindings: EnvBindings;
};
