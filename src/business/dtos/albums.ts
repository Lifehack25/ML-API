export interface AlbumMedia {
  id: number;
  cloudflareId: string;
  isImage: boolean;
  url: string;
  thumbnailUrl: string | null;
  isMainImage: boolean;
  displayOrder: number;
  durationSeconds: number | null;
}

export interface AlbumResponse {
  albumTitle: string;
  sealDate: string | null;
  media: AlbumMedia[];
}

