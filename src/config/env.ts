import { EnvBindings } from "../common/bindings";

export interface JwtConfig {
  secret: string;
  issuer: string;
  audience: string;
  accessTokenExpiryHours: number;
  refreshTokenExpiryDays: number;
}

export interface HashIdsConfig {
  salt: string;
  minLength: number;
}

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  verifyServiceSid: string;
}

export interface SightengineConfig {
  user: string;
  secret: string;
}

export interface CloudflareMediaConfig {
  accountId: string;
  uploadToken: string;
}

export interface FirebaseConfig {
  serviceAccountJson?: string;
}

export interface AppleConfig {
  bundleId: string;
  teamId: string;
  keyId: string;
  authKeyPem: string;
}

export interface GoogleConfig {
  androidClientId?: string;
  iosClientId?: string;
}

export interface StorageLimits {
  tier1ImageLimit: number;
  tier1VideoSeconds: number;
  tier2ImageLimit: number;
  tier2VideoSeconds: number;
  maxVideoSizeMB: number;
}

export interface AppConfig {
  jwt: JwtConfig;
  hashids: HashIdsConfig;
  twilio?: TwilioConfig;
  sightengine?: SightengineConfig;
  cloudflareMedia?: CloudflareMediaConfig;
  firebase?: FirebaseConfig;
  apple?: AppleConfig;
  google: GoogleConfig;
  createLockApiKey: string;
  pushNotificationKey: string;
  environment: string;
  storageLimits: StorageLimits;
}

const parseNumber = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const loadConfig = (env: EnvBindings): AppConfig => {
  if (!env.JWT_SECRET) {
    throw new Error("JWT_SECRET is required");
  }

  const createLockApiKey = env.CREATE_LOCK_API_KEY?.trim();
  if (!createLockApiKey) {
    throw new Error("CREATE_LOCK_API_KEY is required");
  }

  const pushNotificationKey = env.PUSH_NOTIFICATION_KEY?.trim();
  if (!pushNotificationKey) {
    throw new Error("PUSH_NOTIFICATION_KEY is required");
  }

  const hashSalt = env.HASHIDS_SALT;
  if (!hashSalt) {
    throw new Error("HASHIDS_SALT is required");
  }

  const twilioConfigured = !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_VERIFY_SERVICE_SID);
  const sightengineConfigured = !!(env.SIGHTENGINE_USER && env.SIGHTENGINE_SECRET);
  const cloudflareConfigured = !!(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_UPLOAD_TOKEN);
  const appleConfigured = !!(env.APPLE_BUNDLE_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_AUTH_KEY_PEM);

  return {
    jwt: {
      secret: env.JWT_SECRET,
      issuer: "ML-API",
      audience: "ML-MobileApp",
      accessTokenExpiryHours: 2,
      refreshTokenExpiryDays: 30,
    },
    hashids: {
      salt: hashSalt,
      minLength: 6,
    },
    twilio: twilioConfigured
      ? {
          accountSid: env.TWILIO_ACCOUNT_SID!,
          authToken: env.TWILIO_AUTH_TOKEN!,
          verifyServiceSid: env.TWILIO_VERIFY_SERVICE_SID!,
        }
      : undefined,
    sightengine: sightengineConfigured
      ? {
          user: env.SIGHTENGINE_USER!,
          secret: env.SIGHTENGINE_SECRET!,
        }
      : undefined,
    cloudflareMedia: cloudflareConfigured
      ? {
          accountId: env.CLOUDFLARE_ACCOUNT_ID!,
          uploadToken: env.CLOUDFLARE_UPLOAD_TOKEN!,
        }
      : undefined,
    firebase: {
      serviceAccountJson: env.FIREBASE_SERVICE_ACCOUNT_JSON,
    },
    apple: appleConfigured
      ? {
          bundleId: env.APPLE_BUNDLE_ID!,
          teamId: env.APPLE_TEAM_ID!,
          keyId: env.APPLE_KEY_ID!,
          authKeyPem: env.APPLE_AUTH_KEY_PEM!,
        }
      : undefined,
    google: {
      androidClientId: env.GOOGLE_ANDROID_CLIENT_ID,
      iosClientId: env.GOOGLE_IOS_CLIENT_ID,
    },
    storageLimits: {
      tier1ImageLimit: 50,
      tier1VideoSeconds: 60,
      tier2ImageLimit: 100,
      tier2VideoSeconds: 120,
      maxVideoSizeMB: 100,
    },
    createLockApiKey,
    pushNotificationKey,
    environment: env.ENVIRONMENT || "development",
  };
};
