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
    // Preprocess the JSON to handle improperly escaped control characters
    // Common issue: private_key field may contain literal newlines instead of \n
    let jsonString = config.serviceAccountJson;

    // If the JSON string contains unescaped newlines, tabs, or other control characters,
    // they need to be properly escaped before parsing
    // This is a common issue when copy-pasting from Google Cloud Console
    if (jsonString.includes('\n') || jsonString.includes('\t') || jsonString.includes('\r')) {
      // Only escape control characters that appear within string values (private_key)
      // We need to be careful not to break the JSON structure itself
      console.warn("Firebase service account JSON contains unescaped control characters, attempting to fix");

      // Replace actual newlines/tabs/carriage returns with their escape sequences
      // but only within quoted strings (this is a heuristic approach)
      jsonString = jsonString
        .replace(/\r\n/g, '\\n')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t');
    }

    const parsed = JSON.parse(jsonString) as ServiceAccount;
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
      console.warn("Firebase service account JSON missing required fields");
      return null;
    }
    return parsed;
  } catch (error) {
    console.error(
      "Failed to parse Firebase service account JSON. " +
      "Ensure the private_key field uses escaped newlines (\\n) not literal newlines. " +
      "The JSON should be valid JSON format.",
      error
    );
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

