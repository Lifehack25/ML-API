import type { MediaObject } from "../schema";
import type { CreatedMedia } from "../../services/dtos/locks";
import type { AlbumMedia } from "../../services/dtos/albums";

const bool = (value: number | boolean): boolean =>
  typeof value === "boolean" ? value : value !== 0;

export const mapMediaRowToAlbum = (row: MediaObject): AlbumMedia => ({
  Id: row.id,
  IsImage: bool(row.is_image),
  Url: row.url,
  ThumbnailUrl: row.thumbnail_url,
  IsMainImage: bool(row.is_main_picture),
  DisplayOrder: row.display_order,
  DurationSeconds: row.duration_seconds ?? null,
});

export const mapMediaRowToCreated = (row: MediaObject): CreatedMedia => ({
  id: row.id,
  cloudflareId: row.cloudflare_id,
  isImage: bool(row.is_image),
  url: row.url,
  thumbnailUrl: row.thumbnail_url,
  isMainImage: bool(row.is_main_picture),
  displayOrder: row.display_order,
  durationSeconds: row.duration_seconds ?? null,
});
