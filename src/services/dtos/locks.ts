export type DateOnlyString = `${number}-${number}-${number}`;

export interface LockSummary {
  lockId: number;
  hashedLockId: string;
  lockName: string;
  sealDate: DateOnlyString | null;
  scanCount: number;
  upgradedStorage: boolean;
  geoLocation: { lat: number; lng: number } | null;
  image: string | null;
}

export interface LockConnectUserRequest {
  hashedLockId: string;
}

export interface UpdateLockNameRequest {
  lockId: number;
  newName: string;
}

export interface PublishMetadataRequest {
  lockId: number;
  albumTitle?: string | null;
  changes: MetadataChange[];
}

export enum MetadataChangeType {
  Delete = 'delete',
  Reorder = 'reorder',
  UpdateMainImage = 'updateMainImage',
}

export interface MetadataChange {
  changeType: MetadataChangeType;
  mediaId?: number | null;
  newDisplayOrder?: number | null;
  isMainImage?: boolean | null;
}

export interface UploadMediaPayload {
  lockId: number;
  file: File;
  displayOrder: number;
  isMainImage: boolean;
  durationSeconds?: number | null;
}

export interface CreatedMedia {
  id: number;
  cloudflareId: string;
  isImage: boolean;
  url: string;
  thumbnailUrl: string | null;
  isMainImage: boolean;
  displayOrder: number;
  durationSeconds: number | null;
}

export interface PublishResult {
  success: boolean;
  message: string;
  createdMedia: CreatedMedia[] | null;
}

export interface ValidationMedia {
  id: number;
  isImage: boolean;
  isMainImage: boolean;
  durationSeconds: number | null;
}

export interface ValidationData {
  lock: {
    id: number;
    upgradedStorage: boolean;
  };
  media: ValidationMedia[];
}
