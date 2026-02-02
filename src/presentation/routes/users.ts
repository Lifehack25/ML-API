import { Hono } from "hono";
import type { Context } from "hono";
import { jwt } from "hono/jwt";
import { z } from "zod";
import type { EnvBindings } from "../../common/bindings";
import type { AppVariables, ServiceContainer } from "../../common/context";
import type { AppConfig } from "../../config/env";
import type { ApiError } from "../http/responses";
import { getContainer, getUserId } from "../http/context";
import { setUserContext, idempotencyMiddleware } from "../http/middleware";
import { booleanQuery, requireNumericParam, validateJson } from "../http/validation";
import type {
  AppleAuthRequest,
  RefreshTokenRequest,
  SendCodeRequest,
  UpdateDeviceTokenRequest,
  UpdateUserNameRequest,
  VerifyCodeRequest,
  VerifyIdentifierRequest,
} from "../../services/dtos/users";

const createJwtMiddleware = (config: AppConfig) =>
  jwt({
    secret: config.jwt.secret,
    alg: "HS256",
  });

//---------------------------------------------- Validation ----------------------------------------------

const getService = (c: Context<{ Bindings: EnvBindings; Variables: AppVariables }>): ServiceContainer => getContainer(c);

const sendCodeSchema = z.object({
  isLogin: z.boolean(),
  isEmail: z.boolean(),
  identifier: z.string().trim().min(3),
});

const resendCodeSchema = z.object({
  isEmail: z.boolean(),
  identifier: z.string().trim().min(3),
});

const verifyCodeSchema = z.object({
  isEmail: z.boolean(),
  identifier: z.string().trim().min(3),
  name: z.string().trim().max(120).optional().nullable(),
  verifyCode: z.string().trim().min(3),
});

const refreshSchema = z.object({
  refreshToken: z.string().trim().min(10),
});

const appleSchema = z.object({
  idToken: z.string().trim().min(10),
  authCode: z.string().trim().optional().nullable(),
  givenName: z.string().trim().optional().nullable(),
  familyName: z.string().trim().optional().nullable(),
});

const googleSchema = z.object({
  idToken: z.string().trim().min(10),
});

const verifyIdentifierSchema = z.object({
  isEmail: z.boolean(),
  identifier: z.string().trim().min(3),
  verifyCode: z.string().trim().min(3),
});

const adminVerifyIdentifierSchema = z.object({
  userId: z.number().int().positive(),
  isEmail: z.boolean(),
  identifier: z.string().trim().min(3),
});

const updateNameSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

const deviceTokenSchema = z.object({
  deviceToken: z.string().trim().min(1),
});

//---------------------------------------------- Endpoints ----------------------------------------------

export const createUserRoutes = (config: AppConfig) => {
  const router = new Hono<{ Bindings: EnvBindings; Variables: AppVariables }>();
  const jwtMiddleware = createJwtMiddleware(config);

  // Send a Twilio verification code for login or registration.
  router.post(
    "/verify/send-code",
    validateJson(sendCodeSchema),
    async (c) => {
      const payload = c.req.valid("json") as SendCodeRequest;
      const result = await getService(c).services.auth.sendVerificationCode(payload);
      if (result.ok) {
        return c.json(result.data, result.status ?? 200);
      }
      const errorResponse: ApiError = {
        error: result.error.message,
        code: result.error.code,
        details: result.error.details,
      };
      return c.json(errorResponse, result.status ?? 400);
    }
  );

  // Resend a Twilio verification code to email or SMS.
  router.post(
    "/verify/resend-code",
    validateJson(resendCodeSchema),
    async (c) => {
      const payload = c.req.valid("json") as { isEmail: boolean; identifier: string };
      const result = await getService(c).services.users.resendTwilioCode(payload.isEmail, payload.identifier);
      if (result.ok) {
        return c.json(result.data, result.status ?? 200);
      }
      const errorResponse: ApiError = {
        error: result.error.message,
        code: result.error.code,
        details: result.error.details,
      };
      return c.json(errorResponse, result.status ?? 400);
    }
  );

  // Verify the submitted Twilio code and issue tokens.
  router.post(
    "/verify/verify-code",
    idempotencyMiddleware,
    validateJson(verifyCodeSchema),
    async (c) => {
      const payload = c.req.valid("json") as VerifyCodeRequest;
      const result = await getService(c).services.auth.verifyCode(payload);
      if (result.ok) {
        return c.json(result.data, result.status ?? 200);
      }
      const errorResponse: ApiError = {
        error: result.error.message,
        code: result.error.code,
        details: result.error.details,
      };
      return c.json(errorResponse, result.status ?? 400);
    }
  );

  // Refresh access and refresh tokens using the refresh token.
  router.post(
    "/auth/refresh",
    validateJson(refreshSchema),
    async (c) => {
      const payload = c.req.valid("json") as RefreshTokenRequest;
      const result = await getService(c).services.auth.refreshTokens(payload);
      if (result.ok) {
        return c.json(result.data, result.status ?? 200);
      }
      const errorResponse: ApiError = {
        error: result.error.message,
        code: result.error.code,
        details: result.error.details,
      };
      return c.json(errorResponse, result.status ?? 400);
    }
  );

  // Complete Apple Sign-In and issue JWT tokens.
  router.post(
    "/oauth/apple/verify",
    idempotencyMiddleware,
    validateJson(appleSchema),
    async (c) => {
      const payload = c.req.valid("json") as AppleAuthRequest;
      const result = await getService(c).services.auth.verifyApple(payload);
      if (result.ok) {
        return c.json(result.data, result.status ?? 200);
      }
      const errorResponse: ApiError = {
        error: result.error.message,
        code: result.error.code,
        details: result.error.details,
      };
      return c.json(errorResponse, result.status ?? 400);
    }
  );

  // Complete Google Sign-In and issue JWT tokens.
  router.post(
    "/oauth/google/verify",
    idempotencyMiddleware,
    validateJson(googleSchema),
    async (c) => {
      const payload = c.req.valid("json") as { idToken: string };
      const result = await getService(c).services.auth.verifyGoogle(payload);
      if (result.ok) {
        return c.json(result.data, result.status ?? 200);
      }
      const errorResponse: ApiError = {
        error: result.error.message,
        code: result.error.code,
        details: result.error.details,
      };
      return c.json(errorResponse, result.status ?? 400);
    }
  );

  router.use("/me/*", jwtMiddleware, setUserContext());

  // Retrieve the authenticated user's profile.
  router.get("/me", async (c) => {
    const userId = getUserId(c);
    const result = await getService(c).services.users.getProfile(userId);
      if (result.ok) {
        return c.json(result.data, result.status ?? 200);
      }
      const errorResponse: ApiError = {
        error: result.error.message,
        code: result.error.code,
        details: result.error.details,
      };
      return c.json(errorResponse, result.status ?? 400);
  });

  // Remove an identifier (email or phone) from the authenticated user's account.
  router.delete(
    "/me/identifier",
    jwtMiddleware,
    setUserContext(),
    booleanQuery("isEmail"),
    async (c) => {
      const userId = getUserId(c);
      const { isEmail } = c.req.valid("query") as { isEmail: boolean };
      const result = await getService(c).services.users.removeIdentifier({ userId, isEmail });
      if (result.ok) {
        return c.json(result.data, result.status ?? 200);
      }
      const errorResponse: ApiError = {
        error: result.error.message,
        code: result.error.code,
        details: result.error.details,
      };
      return c.json(errorResponse, result.status ?? 400);
    }
  );

  // Update the authenticated user's display name.
  router.patch(
    "/me/name",
    validateJson(updateNameSchema),
    async (c) => {
      const userId = getUserId(c);
      const payload = c.req.valid("json") as UpdateUserNameRequest;
      const result = await getService(c).services.users.updateName(userId, payload);
      if (result.ok) {
        return c.json(result.data, result.status ?? 200);
      }
      const errorResponse: ApiError = {
        error: result.error.message,
        code: result.error.code,
        details: result.error.details,
      };
      return c.json(errorResponse, result.status ?? 400);
    }
  );

  // Verify email or phone for the authenticated user.
  router.post(
    "/verify/identifier",
    jwtMiddleware,
    setUserContext(),
    idempotencyMiddleware,
    validateJson(verifyIdentifierSchema),
    async (c) => {
      const userId = getUserId(c);
      const payload = c.req.valid("json") as Omit<VerifyIdentifierRequest, "userId">;
      const result = await getService(c).services.users.verifyIdentifier({ ...payload, userId });
      if (result.ok) {
        return c.json(result.data, result.status ?? 200);
      }
      const errorResponse: ApiError = {
        error: result.error.message,
        code: result.error.code,
        details: result.error.details,
      };
      return c.json(errorResponse, result.status ?? 400);
    }
  );

  // Save the device token used for push notifications.
  router.put(
    "/me/device-token",
    validateJson(deviceTokenSchema),
    async (c) => {
      const userId = getUserId(c);
      const payload = c.req.valid("json") as UpdateDeviceTokenRequest;
      const result = await getService(c).services.users.updateDeviceToken(userId, payload);
      if (result.ok) {
        return c.json(result.data, result.status ?? 200);
      }
      const errorResponse: ApiError = {
        error: result.error.message,
        code: result.error.code,
        details: result.error.details,
      };
      return c.json(errorResponse, result.status ?? 400);
    }
  );

  // Delete the authenticated user's account (with optional media removal).
  router.delete(
    "/me",
    idempotencyMiddleware,
    booleanQuery("deleteMedia", { defaultValue: false }),
    async (c) => {
      const userId = getUserId(c);
      const { deleteMedia } = c.req.valid("query") as { deleteMedia: boolean };
      const result = await getService(c).services.users.deleteAccount(userId, deleteMedia);
      if (result.ok) {
        return c.json(result.data, result.status ?? 200);
      }
      const errorResponse: ApiError = {
        error: result.error.message,
        code: result.error.code,
        details: result.error.details,
      };
      return c.json(errorResponse, result.status ?? 400);
    }
  );

  return router;
};
