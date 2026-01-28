export interface RevenueCatWebhookPayload {
  api_version: string;
  event: RevenueCatEvent;
}

export interface RevenueCatEvent {
  type: RevenueCatEventType;
  id: string;
  app_id: string;
  app_user_id: string;
  original_app_user_id: string;
  event_timestamp_ms: number;
  product_id: string;
  entitlement_ids: string[] | null;
  purchased_at_ms: number;
  store: RevenueCatStore;
  environment: "SANDBOX" | "PRODUCTION";
  price: number | null;
  currency: string;
  price_in_purchased_currency: number;
  subscriber_attributes: Record<string, RevenueCatAttribute>;
  transaction_id: string;
  original_transaction_id: string;
  is_family_share: boolean;
  country_code: string;
}

export interface RevenueCatAttribute {
  value: string;
  updated_at_ms: number;
}

export type RevenueCatEventType =
  | "INITIAL_PURCHASE"
  | "NON_RENEWING_PURCHASE"
  | "RENEWAL"
  | "CANCELLATION"
  | "EXPIRATION"
  | "BILLING_ISSUE"
  | "PRODUCT_CHANGE";

export type RevenueCatStore = "APP_STORE" | "PLAY_STORE" | "STRIPE" | "PROMOTIONAL";

// Product IDs (must match MAUI app)
export const UNSEAL_PRODUCT_ID = "prod97978575cd";
export const STORAGE_UPGRADE_PRODUCT_ID = "prod81a0ffc5ab";
