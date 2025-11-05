import { MediaObjectRow } from "../models/media-object";
import { CreatedMedia } from "../../business/dtos/locks";
import { AlbumMedia } from "../../business/dtos/albums";

const bool = (value: number | boolean): boolean =>
  typeof value === "boolean" ? value : value !== 0;

export const mapMediaRowToAlbum = (row: MediaObjectRow): AlbumMedia => ({
  id: row.id,
  cloudflareId: row.cloudflare_id,
  isImage: bool(row.is_image),
  url: row.url,
  thumbnailUrl: row.thumbnail_url,
  isMainImage: bool(row.is_main_picture),
  displayOrder: row.display_order,
  durationSeconds: row.duration_seconds ?? null,
});

export const mapMediaRowToCreated = (row: MediaObjectRow): CreatedMedia => ({
  id: row.id,
  cloudflareId: row.cloudflare_id,
  isImage: bool(row.is_image),
  url: row.url,
  thumbnailUrl: row.thumbnail_url,
  isMainImage: bool(row.is_main_picture),
  displayOrder: row.display_order,
  durationSeconds: row.duration_seconds ?? null,
});
