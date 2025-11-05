import { createLogger } from "./logger";
import type { EnvBindings } from "./bindings";
import { createHashIdHelper } from "./hashids";
import { loadConfig, type AppConfig } from "../config/env";
import { createTwilioVerifyClient } from "../infrastructure/Auth/twilio";
import { createSightengineClient } from "../infrastructure/sightengine";
import { createCloudflareMediaClient } from "../infrastructure/cloudflare";
import { createFirebaseMessagingClient } from "../infrastructure/firebase";
import { createAppleVerifier } from "../infrastructure/Auth/oauth-apple";
import { createGoogleVerifier } from "../infrastructure/Auth/oauth-google";
import { createJwtService } from "../infrastructure/Auth/jwt";
import { IdempotencyService } from "../infrastructure/idempotency";
import { UserRepository } from "../data/repositories/user-repository";
import { LockRepository } from "../data/repositories/lock-repository";
import { MediaObjectRepository } from "../data/repositories/media-object-repository";
import { CleanupJobRepository } from "../data/repositories/cleanup-job-repository";
import { MediaService } from "../business/services/media-service";
import { LockService } from "../business/services/lock-service";
import { UserSessionService } from "../business/services/user-session-service";
import { ExternalUserLinkService } from "../business/services/external-user-link-service";
import { NotificationService } from "../business/services/notification-service";
import { AlbumService } from "../business/services/album-service";
import { AuthService } from "../business/services/auth-service";
import { UserService } from "../business/services/user-service";
import type { Logger } from "./logger";

export interface ServiceContainer {
  config: AppConfig;
  logger: Logger;
  db: D1Database;
  hashids: ReturnType<typeof createHashIdHelper>;
  idempotencyService: IdempotencyService;
  repositories: {
    users: UserRepository;
    locks: LockRepository;
    media: MediaObjectRepository;
    cleanupJobs: CleanupJobRepository;
  };
  services: {
    auth: AuthService;
    users: UserService;
    locks: LockService;
    albums: AlbumService;
    notifications: NotificationService;
  };
}

export interface AppVariables {
  container: ServiceContainer;
  userId?: number;
  requestId?: string;
}

export const createRequestContext = (
  env: EnvBindings,
  requestId?: string,
  existingConfig?: AppConfig
): ServiceContainer => {
  const config = existingConfig ?? loadConfig(env);
  const logger = createLogger(requestId);

  const twilioClient = config.twilio ? createTwilioVerifyClient(config.twilio) : null;
  const sightengineClient = createSightengineClient(config.sightengine);
  const cloudflareClient = createCloudflareMediaClient(config.cloudflareMedia);
  const firebaseClient = createFirebaseMessagingClient(config.firebase);
  const appleVerifier = createAppleVerifier(config.apple);
  const googleVerifier = createGoogleVerifier(config.google);
  const jwtService = createJwtService(config.jwt);

  const userRepository = new UserRepository(env.DB);
  const lockRepository = new LockRepository(env.DB);
  const mediaRepository = new MediaObjectRepository(env.DB);
  const cleanupJobRepository = new CleanupJobRepository(env.DB);

  const hashHelper = createHashIdHelper(config.hashids);
  const idempotencyService = new IdempotencyService(env.DB);

  const mediaService = new MediaService(
    mediaRepository,
    lockRepository,
    cleanupJobRepository,
    cloudflareClient,
    sightengineClient,
    logger,
    config.storageLimits
  );

  const lockService = new LockService(
    lockRepository,
    mediaRepository,
    mediaService,
    hashHelper,
    logger
  );

  const notificationService = new NotificationService(
    userRepository,
    firebaseClient,
    logger
  );

  const albumService = new AlbumService(
    lockRepository,
    mediaRepository,
    lockService,
    notificationService,
    hashHelper,
    logger
  );

  const userSessionService = new UserSessionService(jwtService, userRepository, logger);
  const externalUserLinkService = new ExternalUserLinkService(env.DB, userRepository, logger);

  const authService = new AuthService(
    env.DB,
    userRepository,
    twilioClient,
    jwtService,
    userSessionService,
    externalUserLinkService,
    appleVerifier,
    googleVerifier,
    logger
  );

  const userService = new UserService(
    env.DB,
    userRepository,
    lockRepository,
    mediaRepository,
    cleanupJobRepository,
    twilioClient,
    logger
  );

  return {
    config,
    logger,
    db: env.DB,
    hashids: hashHelper,
    idempotencyService,
    repositories: {
      users: userRepository,
      locks: lockRepository,
      media: mediaRepository,
      cleanupJobs: cleanupJobRepository,
    },
    services: {
      auth: authService,
      users: userService,
      locks: lockService,
      albums: albumService,
      notifications: notificationService,
    },
  };
};
