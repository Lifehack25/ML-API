export interface MediaObjectRow {
  id: number;
  lock_id: number;
  cloudflare_id: string;
  url: string;
  thumbnail_url: string | null;
  file_name: string | null;
  is_image: number | boolean;
  is_main_picture: number | boolean;
  created_at: string;
  display_order: number;
  duration_seconds: number | null;
}

