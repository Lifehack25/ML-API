export interface SendNotificationRequest {
  userId: number;
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface MilestoneNotificationRequest {
  userId: number;
  lockId: number;
  lockName?: string | null;
  scanCount: number;
  milestone: number;
}
