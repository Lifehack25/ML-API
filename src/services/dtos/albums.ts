export interface AlbumMedia {
  Id: number;
  IsImage: boolean;
  Url: string;
  ThumbnailUrl: string | null;
  IsMainImage: boolean;
  DisplayOrder: number;
  DurationSeconds: number | null;
}

export interface AlbumResponse {
  AlbumTitle: string;
  SealDate: string | null;
  Media: AlbumMedia[];
}
