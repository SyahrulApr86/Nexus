/** API DTOs shared between server and web. */

export interface UserDto {
  id: string;
  email: string;
  displayName: string | null;
  theme: "light" | "dark" | "system";
  idleTimeoutMinutes: number;
}

export interface NoteSummaryDto {
  id: string;
  title: string;
  folderId: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface NoteDto extends NoteSummaryDto {
  content: string;
}

export interface FolderDto {
  id: string;
  name: string;
  parentId: string | null;
  position: number;
  noteCount: number;
  children: FolderDto[];
}

export interface NoteVersionDto {
  id: string;
  noteId: string;
  createdAt: string;
  changeSummary: string | null;
}

export interface TrashedItemDto {
  type: "note" | "folder";
  id: string;
  title: string;
  trashedAt: string;
  originalFolderId: string | null;
}

export interface SearchResultDto {
  id: string;
  title: string;
  snippet: string;
  score: number;
  titleMatch: boolean;
}

export interface TagDto {
  name: string;
  noteCount: number;
  noteIds: string[];
}

export interface GraphNodeDto {
  id: string;
  title: string;
  linkCount: number;
}

export interface GraphEdgeDto {
  sourceId: string;
  targetId: string;
}

export interface GraphDataDto {
  nodes: GraphNodeDto[];
  edges: GraphEdgeDto[];
  orphanCount: number;
}

export type RealtimeEvent =
  | { type: "note:created"; noteId: string }
  | { type: "note:updated"; noteId: string; updatedAt: string }
  | { type: "note:deleted"; noteId: string }
  | { type: "folder:changed" };
