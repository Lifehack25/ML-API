export interface SendCodeRequest {
  isLogin: boolean;
  isEmail: boolean;
  identifier: string;
}

export interface VerifyCodeRequest {
  isEmail: boolean;
  identifier: string;
  name?: string | null;
  verifyCode: string;
}

export interface JwtTokens {
  refreshToken: string;
  accessToken: string;
  userId: number;
}

export interface RefreshTokenRequest {
  refreshToken: string;
  accessToken?: string;
  userId?: number;
}

export interface AppleAuthRequest {
  idToken: string;
  authCode?: string | null;
  givenName?: string | null;
  familyName?: string | null;
}

export interface GoogleAuthRequest {
  idToken: string;
}

export interface UserProfile {
  id: number;
  name: string;
  email: string | null;
  phoneNumber: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  authProvider: string;
  providerId: string | null;
  deviceToken?: string | null;
}

export interface UpdateUserNameRequest {
  name: string;
}

export interface VerifyIdentifierRequest {
  userId: number;
  isEmail: boolean;
  identifier: string;
  verifyCode: string;
}

export interface RemoveIdentifierRequest {
  userId: number;
  isEmail: boolean;
}

export interface UpdateDeviceTokenRequest {
  deviceToken: string;
}

export interface ValidatedIdentifier {
  isEmail: boolean;
  identifier: string;
}

export interface CreateUserRequest {
  name: string;
  email?: string | null;
  phoneNumber?: string | null;
  authProvider?: string | null;
  providerId?: string | null;
  emailVerified?: boolean;
  phoneVerified?: boolean;
}
