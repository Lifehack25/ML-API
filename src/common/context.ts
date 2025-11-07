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
import { ManageMediaService } from "../business/services/manage-media-service";
import { LockService } from "../business/services/lock-service";
import { SessionTokenService } from "../business/services/session-token-service";
import { OAuthUserLinkService } from "../business/services/oauth-user-link-service";
import { NotificationService } from "../business/services/notification-service";
import { ViewAlbumService } from "../business/services/view-album-service";
import { UserAuthFlowService } from "../business/services/user-auth-flow-service";
import { UserService } from "../business/services/user-service";
import { ScanCounterService } from "../business/services/scan-counter-service";
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
    auth: UserAuthFlowService;
    users: UserService;
    locks: LockService;
    albums: ViewAlbumService;
    notifications: NotificationService;
    scanCounter: ScanCounterService;
  };
}

export interface AppVariables {
  container: ServiceContainer;
  userId?: number;
  requestId?: string;
  executionCtx?: ExecutionContext;
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
  const idempotencyService = new IdempotencyService(env.IDEMPOTENCY_KEYS);

  const mediaService = new ManageMediaService(
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

  const scanCounterService = new ScanCounterService(
    lockRepository,
    notificationService,
    logger
  );

  const albumService = new ViewAlbumService(
    lockRepository,
    mediaRepository,
    lockService,
    hashHelper,
    logger
  );

  const sessionTokenService = new SessionTokenService(jwtService, userRepository, logger);
  const oauthUserLinkService = new OAuthUserLinkService(env.DB, userRepository, logger);

  const authService = new UserAuthFlowService(
    env.DB,
    userRepository,
    twilioClient,
    jwtService,
    sessionTokenService,
    oauthUserLinkService,
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
      scanCounter: scanCounterService,
    },
  };
};
