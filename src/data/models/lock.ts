export interface LockRow {
  id: number;
  lock_name: string;
  album_title: string;
  seal_date: string | null;
  scan_count: number;
  last_scan_milestone: number;
  created_at: string;
  user_id: number | null;
  upgraded_storage: number | boolean;
}

