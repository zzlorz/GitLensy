// Shared type definitions for GitLensy frontend

export interface RepositoryInfo {
  path: string;
  name: string;
  branch: string;
  is_detached: boolean;
}

/** 当前分支与上游远程的同步状态 */
export interface SyncStatus {
  branch: string;
  has_upstream: boolean;
  ahead: number;
  behind: number;
}

/** 一条贮藏记录 */
export interface StashEntry {
  index: number;
  ref_name: string;
  message: string;
  date: string;
}

/** 本地 / 远程分支列表 */
export interface BranchList {
  current: string;
  local: string[];
  remote: string[];
}

export type FileStatus =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "copied"
  | "conflict"
  | "untracked"
  | "ignored"
  | "unchanged";

export interface ChangedFile {
  path: string;
  old_path?: string;
  status: FileStatus;
  staged_status?: FileStatus;
  unstaged_status?: FileStatus;
  additions: number;
  deletions: number;
  is_binary: boolean;
  has_staged_changes: boolean;
  has_unstaged_changes: boolean;
}

export interface GitStatus {
  staged: ChangedFile[];
  unstaged: ChangedFile[];
  branch: string;
  is_detached: boolean;
}

export interface DiffLine {
  type: "add" | "remove" | "context" | "hunk";
  content: string;
  old_line_number: number;
  new_line_number: number;
}

export interface DiffHunk {
  old_start: number;
  old_lines: number;
  new_start: number;
  new_lines: number;
  lines: DiffLine[];
}

export interface FileDiff {
  old_path: string;
  new_path: string;
  old_mode?: string;
  new_mode?: string;
  is_binary: boolean;
  is_new: boolean;
  is_deleted: boolean;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  error?: string;
}

export type DiffView = "staged" | "unstaged";

export type ThemeMode = "dark" | "light" | "system";

export interface RecentRepo {
  path: string;
  name: string;
  last_opened: number;
}

export interface CommitInfo {
  hash: string;
  short_hash: string;
  subject: string;
  body: string;
  author_name: string;
  author_email: string;
  /** ISO-8601 date string */
  date: string;
  /** Human-readable relative time, e.g. "3 days ago" */
  date_relative: string;
  /** 0 = root commit, 2+ = merge commit */
  parent_count: number;
  /** Full parent SHAs, first parent first */
  parents: string[];
}

export interface CommitFile {
  path: string;
  old_path?: string;
  status: FileStatus;
  additions: number;
  deletions: number;
}
