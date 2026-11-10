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
  StashEntry,
  BranchList,
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

/** 指定仓库的变更文件数量（去重后），用于项目侧边栏的计数徽标 */
export async function getRepoChangeCount(repoPath: string): Promise<number> {
  return invoke<number>("get_repo_change_count", { path: repoPath });
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

// 外部编辑器设置（默认 VS Code: code）
const EDITOR_KEY = "gitlensy:editor";

/** 读取用户配置的外部编辑器命令，未配置时为 code */
export function getPreferredEditor(): string {
  try {
    const saved = localStorage.getItem(EDITOR_KEY);
    return saved && saved.trim() ? saved.trim() : "code";
  } catch {
    return "code";
  }
}

/** 保存外部编辑器命令 */
export function setPreferredEditor(editor: string): void {
  const value = editor.trim() || "code";
  localStorage.setItem(EDITOR_KEY, value);
}

/** 用外部编辑器打开目录或文件（不传 editor 时使用设置中的默认值） */
export async function openInEditor(path: string, editor?: string): Promise<void> {
  return invoke<void>("open_in_editor", { path, editor: editor ?? getPreferredEditor() });
}

/** 「打开方式」：editor（VS Code 等外部编辑器）/ explorer（资源管理器）/ system（系统「打开方式」对话框） */
export type OpenMethod = "editor" | "explorer" | "system";

/** 按指定方式打开项目或文件 */
export async function openPath(path: string, method: OpenMethod): Promise<void> {
  return invoke<void>("open_with_method", {
    path,
    method,
    editor: getPreferredEditor(),
  });
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

/** 拉取远程变更（仅快进） */
export async function pullChanges(): Promise<void> {
  return invoke<void>("pull_changes");
}

/** 获取远程更新（git fetch，不合并到本地） */
export async function fetchChanges(): Promise<void> {
  return invoke<void>("fetch_changes");
}

/** 推送本地提交到远程 */
export async function pushChanges(): Promise<void> {
  return invoke<void>("push_changes");
}

/** 新建分支；checkout 为 true 时创建并切换 */
export async function createBranch(name: string, checkout: boolean): Promise<void> {
  return invoke<void>("create_branch", { name, checkout });
}

/** 新建标签；message 非空时创建附注标签 */
export async function createTag(name: string, message?: string): Promise<void> {
  return invoke<void>("create_tag", { name, message: message ?? null });
}

/** 贮藏当前工作区变更（含未跟踪文件） */
export async function stashChanges(message?: string): Promise<void> {
  return invoke<void>("stash_changes", { message: message ?? null });
}

/** 列出当前仓库的贮藏记录 */
export async function getStashList(): Promise<StashEntry[]> {
  return invoke<StashEntry[]>("get_stash_list");
}

/** 恢复指定序号的贮藏（pop） */
export async function popStash(index: number): Promise<void> {
  return invoke<void>("pop_stash", { index });
}

/** 应用指定序号的贮藏（apply），保留记录 */
export async function applyStash(index: number): Promise<void> {
  return invoke<void>("apply_stash", { index });
}

/** 删除指定序号的贮藏记录 */
export async function dropStash(index: number): Promise<void> {
  return invoke<void>("drop_stash", { index });
}

/** 清空全部贮藏记录 */
export async function clearStashes(): Promise<void> {
  return invoke<void>("clear_stashes");
}

/** 列出本地与远程分支 */
export async function getBranches(): Promise<BranchList> {
  return invoke<BranchList>("get_branches");
}

/** 切换分支；远程分支会自动创建同名本地分支并跟踪 */
export async function checkoutBranch(name: string, isRemote: boolean): Promise<void> {
  return invoke<void>("checkout_branch", { name, isRemote });
}

// ── 合并冲突可视化解决 ──────────────────────────────────────────────

/** 读取冲突文件内容（通常仍带冲突标记） */
export async function getConflictFile(filePath: string): Promise<string> {
  return invoke<string>("get_conflict_file", { filePath });
}

/** 写入解决后的内容并标记为已解决（git add） */
export async function resolveConflict(filePath: string, content: string): Promise<void> {
  return invoke<void>("resolve_conflict", { filePath, content });
}

/** 不修改内容，直接把文件标记为已解决（git add） */
export async function markConflictResolved(filePath: string): Promise<void> {
  return invoke<void>("mark_conflict_resolved", { filePath });
}

// ── 更多分支操作 ────────────────────────────────────────────────────

/** 删除分支；force 为 true 时可删除未合并分支 */
export async function deleteBranch(name: string, force = false): Promise<void> {
  return invoke<void>("delete_branch", { name, force });
}

/** 重命名本地分支 */
export async function renameBranch(oldName: string, newName: string): Promise<void> {
  return invoke<void>("rename_branch", { oldName, newName });
}

/** 把指定分支合并到当前分支 */
export async function mergeBranch(name: string): Promise<void> {
  return invoke<void>("merge_branch", { name });
}

/** 把当前分支 rebase 到指定分支 */
export async function rebaseBranch(onto: string): Promise<void> {
  return invoke<void>("rebase_branch", { onto });
}

/** 把指定提交 cherry-pick 到当前分支 */
export async function cherryPickCommit(hash: string): Promise<void> {
  return invoke<void>("cherry_pick_commit", { hash });
}

// ── 提交增强 ────────────────────────────────────────────────────────

/** 修正上一次提交；message 为空时沿用原提交信息 */
export async function amendCommit(message?: string): Promise<void> {
  return invoke<void>("amend_commit", { message: message ?? null });
}

/** 撤销上一次提交（soft reset，内容保留在暂存区） */
export async function undoLastCommit(): Promise<void> {
  return invoke<void>("undo_last_commit");
}

/** 两个提交之间的文件列表 */
export async function getCompareFiles(fromHash: string, toHash: string): Promise<CommitFile[]> {
  return invoke<CommitFile[]>("get_compare_files", { fromHash, toHash });
}

/** 两个提交之间单个文件的 diff */
export async function getCompareFileDiff(
  fromHash: string,
  toHash: string,
  filePath: string,
  oldPath?: string,
): Promise<FileDiff> {
  return invoke<FileDiff>("get_compare_file_diff", {
    fromHash,
    toHash,
    filePath,
    oldPath: oldPath ?? null,
  });
}

/** 动态同步更新原生窗口标题栏主题（暗色 / 亮色） */
export async function setWindowTheme(theme: string): Promise<void> {
  return invoke<void>("set_window_theme", { theme });
}
