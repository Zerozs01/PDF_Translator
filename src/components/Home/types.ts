export interface TagItem {
  id: number;
  name: string;
  color: string;
  icon?: string;
}

export interface ProjectItem {
  id: number;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  parent_id?: number | null;
  documentCount?: number;
}

export interface DocumentItem {
  id: number;
  filepath: string;
  filename: string;
  file_type: string;
  file_size: number;
  total_pages: number;
  thumbnail_path?: string;
  project_id?: number | null;
  is_favorite: boolean;
  rating: number;
  last_page: number;
  last_accessed?: number;
  created_at: number;
  tags?: TagItem[];
}
