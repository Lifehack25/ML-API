import { importPKCS8, SignJWT } from "jose";
import { FirebaseConfig } from "../config/env";

export interface FirebaseMessagingClient {
  sendToToken(
    token: string,
    title: string,
    body: string,
    data?: Record<string, string>
  ): Promise<boolean>;
}

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

interface TokenCache {
  accessToken: string;
  expiresAt: number; // epoch seconds
}

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

const parseServiceAccount = (config?: FirebaseConfig): ServiceAccount | null => {
  if (!config?.serviceAccountJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(config.serviceAccountJson) as ServiceAccount;
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
      console.warn("Firebase service account JSON missing required fields");
      return null;
    }
    return parsed;
  } catch (error) {
    console.error("Failed to parse Firebase service account JSON", error);
    return null;
  }
};

export const createFirebaseMessagingClient = (config?: FirebaseConfig): FirebaseMessagingClient => {
  const serviceAccount = parseServiceAccount(config);
  if (!serviceAccount) {
    return {
      sendToToken: async () => false,
    };
  }

  let tokenCache: TokenCache | null = null;
  let signingKeyPromise: Promise<CryptoKey> | null = null;

  const getSigningKey = () => {
    if (!signingKeyPromise) {
      signingKeyPromise = importPKCS8(serviceAccount.private_key, "RS256");
    }
    return signingKeyPromise;
  };

  const fetchAccessToken = async (): Promise<string> => {
    const now = Math.floor(Date.now() / 1000);
    if (tokenCache && tokenCache.expiresAt - 60 > now) {
      return tokenCache.accessToken;
    }

    const key = await getSigningKey();
    const jwt = await new SignJWT({
      iss: serviceAccount.client_email,
      scope: FCM_SCOPE,
      aud: TOKEN_ENDPOINT,
      iat: now,
      exp: now + 3600,
    })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .sign(key);

    const response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });

    if (!response.ok) {
      console.error("Failed to obtain Firebase access token", response.status, response.statusText);
      throw new Error("Firebase authentication failed");
    }

    const payload = await response.json<{ access_token: string; expires_in: number }>();
    tokenCache = {
      accessToken: payload.access_token,
      expiresAt: now + payload.expires_in,
    };

    return tokenCache.accessToken;
  };

  const projectPath = `projects/${serviceAccount.project_id}`;

  return {
    sendToToken: async (token, title, body, data) => {
      try {
        const accessToken = await fetchAccessToken();
        const message = {
          message: {
            token,
            notification: {
              title,
              body,
            },
            data: data ?? {},
            android: {
              priority: "HIGH",
            },
            apns: {
              payload: {
                aps: {
                  sound: "default",
                  badge: 1,
                },
              },
            },
          },
        };

        const response = await fetch(`https://fcm.googleapis.com/v1/${projectPath}/messages:send`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(message),
        });

        if (!response.ok) {
          const text = await response.text();
          console.error("Firebase send message failed", response.status, text);
          return false;
        }

        return true;
      } catch (error) {
        console.error("Firebase send message error", error);
        return false;
      }
    },
  };
};

