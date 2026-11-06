import { invoke } from "@tauri-apps/api/core";
import type {
  RepositoryInfo,
  GitStatus,
  FileDiff,
  DiffView,
  RecentRepo,
  CommitInfo,
  CommitFile,
  SyncStatus,
} from "../types";

// Repository commands
export async function openRepository(path: string): Promise<RepositoryInfo> {
  return invoke<RepositoryInfo>("open_repository", { path });
}

export async function closeRepository(): Promise<void> {
  localStorage.removeItem("gitlensy:currentRepo");
  return invoke<void>("close_repository");
}

export async function getStatus(): Promise<GitStatus> {
  const status = await invoke<GitStatus>("get_status");
  const saved = localStorage.getItem("gitlensy:currentRepo");
  if (saved) {
    try {
      const info = JSON.parse(saved) as RepositoryInfo;
      info.branch = status.branch;
      info.is_detached = status.is_detached;
      localStorage.setItem("gitlensy:currentRepo", JSON.stringify(info));
    } catch {
      // ignore
    }
  }
  return status;
}

export async function getFileDiff(
  filePath: string,
  view: DiffView,
): Promise<FileDiff> {
  return invoke<FileDiff>("get_file_diff", { filePath, view });
}

// Recent repos
const RECENT_KEY = "gitlensy:recentRepos";

export function getRecentRepos(): RecentRepo[] {
  try {
    const saved = localStorage.getItem(RECENT_KEY);
    return saved ? (JSON.parse(saved) as RecentRepo[]) : [];
  } catch {
    return [];
  }
}

export function addRecentRepo(path: string, name: string): void {
  const repos = getRecentRepos().filter((r) => r.path !== path);
  repos.unshift({ path, name, last_opened: Date.now() });
  const trimmed = repos.slice(0, 10);
  localStorage.setItem(RECENT_KEY, JSON.stringify(trimmed));
}

export function removeRecentRepo(path: string): void {
  const repos = getRecentRepos().filter((r) => r.path !== path);
  localStorage.setItem(RECENT_KEY, JSON.stringify(repos));
}

export function saveCurrentRepo(info: RepositoryInfo): void {
  localStorage.setItem("gitlensy:currentRepo", JSON.stringify(info));
  addRecentRepo(info.path, info.name);
}

export function getSavedRepo(): RepositoryInfo | null {
  try {
    const saved = localStorage.getItem("gitlensy:currentRepo");
    return saved ? (JSON.parse(saved) as RepositoryInfo) : null;
  } catch {
    return null;
  }
}

// History commands
export async function getCommitLog(
  limit: number,
  offset: number,
): Promise<CommitInfo[]> {
  return invoke<CommitInfo[]>("get_commit_log", { limit, offset });
}

export async function getCommitFiles(hash: string): Promise<CommitFile[]> {
  return invoke<CommitFile[]>("get_commit_files", { hash });
}

export async function getCommitFileDiff(
  hash: string,
  filePath: string,
  oldPath?: string,
): Promise<FileDiff> {
  return invoke<FileDiff>("get_commit_file_diff", {
    hash,
    filePath,
    oldPath: oldPath ?? null,
  });
}

/** 在仓库根目录打开一个新的 PowerShell 窗口 */
export async function openTerminal(): Promise<void> {
  return invoke<void>("open_terminal");
}

/** 撤销单个文件的变更。scope: "unstaged" | "staged" | "all" */
export async function revertFile(filePath: string, scope: string): Promise<void> {
  return invoke<void>("revert_file", { filePath, scope });
}

/** 暂存单个文件（git add） */
export async function stageFile(filePath: string): Promise<void> {
  return invoke<void>("stage_file", { filePath });
}

/** 暂存所有变更（git add -A） */
export async function stageAll(): Promise<void> {
  return invoke<void>("stage_all");
}

/** 放弃所有工作区变更（已跟踪恢复、未跟踪删除） */
export async function discardAllUnstaged(): Promise<void> {
  return invoke<void>("discard_all_unstaged");
}

/** 提交暂存区内容 */
export async function commitChanges(message: string): Promise<void> {
  return invoke<void>("commit_changes", { message });
}

/** 查询当前分支与上游远程的领先/落后提交数 */
export async function getSyncStatus(): Promise<SyncStatus> {
  return invoke<SyncStatus>("get_sync_status");
}

/** 同步到远程仓库（落后时先快进拉取，再推送） */
export async function syncChanges(): Promise<void> {
  return invoke<void>("sync_changes");
}

/** 动态同步更新原生窗口标题栏主题（暗色 / 亮色） */
export async function setWindowTheme(theme: string): Promise<void> {
  return invoke<void>("set_window_theme", { theme });
}
