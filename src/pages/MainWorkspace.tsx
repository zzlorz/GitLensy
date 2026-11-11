import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  GitBranch, RotateCw, FolderSync, Terminal, MoreHorizontal, Tag, Archive, ArchiveRestore, Trash2,
  FileCode2, AlertTriangle, Loader2, GitCommit, Search, Settings, X,
  Download, Upload, ChevronDown, Check, ExternalLink, Plus, Undo2,
  Pencil, GitMerge, GitCompare, RotateCcw, Copy,
} from "lucide-react";
import CommitList from "../components/CommitList";
import CommitChangesView from "../components/CommitChangesView";
import FileList from "../components/FileList";
import DiffViewer from "../components/DiffViewer";
import AllChangesView from "../components/AllChangesView";
import ConfirmDialog from "../components/ConfirmDialog";
import ConflictResolver from "../components/ConflictResolver";
import SidebarResizeHandle from "../components/SidebarResizeHandle";
import FilePreview from "../components/FilePreview";
import ProjectSidebar from "../components/ProjectSidebar";
import { WindowControls, WindowResizeHandles } from "../components/WindowControls";
import type { RepositoryInfo, GitStatus, ChangedFile, DiffView, FileDiff, CommitInfo, RecentRepo, SyncStatus, StashEntry, BranchList, OperationState } from "../types";
import { getStatus, getFileDiff, saveCurrentRepo, getCommitLog, openTerminal, revertFile, stageFile, stageAll, discardAllUnstaged, commitChanges, getSyncStatus, syncChanges, pullChanges, fetchChanges, pushChanges, createBranch, createTag, stashChanges, getStashList, popStash, applyStash, dropStash, clearStashes, getBranches, checkoutBranch, openPath, getRecentRepos, openRepository, removeRecentRepo, deleteBranch, renameBranch, mergeBranch, rebaseBranch, cherryPickCommit, amendCommit, undoLastCommit, getOperationState, continueRebase, abortRebase, continueCherryPick, abortCherryPick } from "../api/tauri";
import type { OpenMethod } from "../api/tauri";
import { useI18n } from "../i18n";

const PAGE_SIZE = 50;

/** 状态中是否存在未解决的合并冲突 */
function statusHasConflicts(status: GitStatus | null | undefined): boolean {
  if (!status) return false;
  return [...status.unstaged, ...status.staged].some(
    (file) =>
      file.status === "conflict" ||
      file.staged_status === "conflict" ||
      file.unstaged_status === "conflict",
  );
}

// 侧边栏宽度持久化
const PROJECT_SIDEBAR_WIDTH_KEY = "gitlensy:projectSidebarWidth";
const PROJECT_SIDEBAR_DEFAULT_WIDTH = 200;
const PROJECT_SIDEBAR_MIN_WIDTH = 160;
const PROJECT_SIDEBAR_MAX_WIDTH = 420;

const COMMIT_SIDEBAR_WIDTH_KEY = "gitlensy:commitSidebarWidth";
const COMMIT_SIDEBAR_DEFAULT_WIDTH = 320;
const COMMIT_SIDEBAR_MIN_WIDTH = 240;
const COMMIT_SIDEBAR_MAX_WIDTH = 600;

function loadStoredWidth(key: string, fallback: number, min: number, max: number): number {
  try {
    const raw = localStorage.getItem(key);
    const value = raw ? Number.parseInt(raw, 10) : Number.NaN;
    if (Number.isFinite(value)) return Math.min(max, Math.max(min, value));
  } catch {
    // localStorage 不可用时使用默认值
  }
  return fallback;
}

function persistWidth(key: string, width: number): void {
  try {
    localStorage.setItem(key, String(Math.round(width)));
  } catch {
    // ignore
  }
}

interface Props {
  repo: RepositoryInfo;
  onCloseRepo: () => void;
  onRepoUpdate: (repo: RepositoryInfo) => void;
  onOpenSettings?: () => void;
}

type Tab = "changes" | "history";

export default function MainWorkspace({ repo, onCloseRepo, onRepoUpdate, onOpenSettings }: Props) {
  const { t } = useI18n();
  // 变更 tab 暂时隐藏，只保留提交记录
  const [activeTab] = useState<Tab>("history");
  const [filter, setFilter] = useState("");

  const openMethods: { id: OpenMethod; label: string }[] = useMemo(
    () => [
      { id: "editor", label: t("openMethods.editor") },
      { id: "explorer", label: t("openMethods.explorer") },
      { id: "system", label: t("openMethods.system") },
    ],
    [t],
  );

  const [recentRepos, setRecentRepos] = useState<RecentRepo[]>(getRecentRepos());

  // ── 侧边栏宽度（可拖拽，持久化到 localStorage）─────────────────────
  const [projectSidebarWidth, setProjectSidebarWidth] = useState(() =>
    loadStoredWidth(
      PROJECT_SIDEBAR_WIDTH_KEY,
      PROJECT_SIDEBAR_DEFAULT_WIDTH,
      PROJECT_SIDEBAR_MIN_WIDTH,
      PROJECT_SIDEBAR_MAX_WIDTH,
    ),
  );
  const [projectSidebarCollapsed, setProjectSidebarCollapsed] = useState(false);
  const [commitSidebarWidth, setCommitSidebarWidth] = useState(() =>
    loadStoredWidth(
      COMMIT_SIDEBAR_WIDTH_KEY,
      COMMIT_SIDEBAR_DEFAULT_WIDTH,
      COMMIT_SIDEBAR_MIN_WIDTH,
      COMMIT_SIDEBAR_MAX_WIDTH,
    ),
  );

  const refreshRecentRepos = useCallback(() => {
    setRecentRepos(getRecentRepos());
  }, []);

  const handleOpenRecentRepo = useCallback(async (path: string) => {
    try {
      const info = await openRepository(path);
      saveCurrentRepo(info);
      onRepoUpdate(info);
      refreshRecentRepos();
    } catch (e) {
      // open_repository 失败时回到欢迎页让用户重新选择
      onCloseRepo();
    }
  }, [onRepoUpdate, onCloseRepo, refreshRecentRepos]);

  const handleOpenOtherRepo = useCallback(() => {
    onCloseRepo();
  }, [onCloseRepo]);

  // ── Folders tab state ─────────────────────────────────────────────────
  const [selectedFolderFile, setSelectedFolderFile] = useState<{ fullPath: string; relPath: string } | null>(null);
  /** 递增触发文件夹树重新扫描 */
  const [folderRefreshKey, setFolderRefreshKey] = useState(0);

  // ── Confirm dialog state ───────────────────────────────────────────────
  interface RevertPending { file: ChangedFile; scope: "unstaged" | "staged" | "all" }
  const [revertPending, setRevertPending] = useState<RevertPending | null>(null);
  /** 放弃所有工作区变更的确认框 */
  const [confirmDiscardAll, setConfirmDiscardAll] = useState(false);
  /** 变更 tab 的提交信息与提交状态 */
  const [commitMessage, setCommitMessage] = useState("");
  const [committing, setCommitting] = useState(false);
  /** 当前分支与远程的同步状态 */
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  /** 工具栏拉取/获取/推送的进行中标记 */
  const [remoteBusy, setRemoteBusy] = useState<"pull" | "fetch" | "push" | null>(null);
  /** 更多操作菜单与输入弹窗 */
  const [toolMenuOpen, setToolMenuOpen] = useState(false);
  const [toolAction, setToolAction] = useState<"branch" | "tag" | "stash" | "stashes" | null>(null);
  const [toolInput, setToolInput] = useState("");
  const [toolBusy, setToolBusy] = useState(false);
  const [toolError, setToolError] = useState<string | null>(null);
  /** 贮藏列表弹窗的数据 */
  const [stashes, setStashes] = useState<StashEntry[]>([]);
  /** 贮藏删除的二次确认 */
  const [stashConfirm, setStashConfirm] = useState<{ type: "drop"; index: number } | { type: "clear" } | null>(null);
  /** 分支切换下拉 */
  const [branches, setBranches] = useState<BranchList | null>(null);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [branchBusy, setBranchBusy] = useState(false);
  /** 分支操作：合并 / 变基 / 删除 / 重命名 */
  type BranchActionType = "merge" | "rebase" | "delete" | "rename";
  const [branchAction, setBranchAction] = useState<{ type: BranchActionType; name: string } | null>(null);
  const [branchActionInput, setBranchActionInput] = useState("");
  const [branchActionBusy, setBranchActionBusy] = useState(false);
  const [branchActionError, setBranchActionError] = useState<string | null>(null);
  /** 提交间对比的基准提交 */
  const [compareFrom, setCompareFrom] = useState<CommitInfo | null>(null);
  /** 是否进入 Amend（修正上一次提交）模式 */
  const [amendMode, setAmendMode] = useState(false);
  /** 撤销上次提交、cherry-pick 等 Git 操作的进行中标记 */
  const [gitBusy, setGitBusy] = useState(false);
  const [confirmUndoCommit, setConfirmUndoCommit] = useState(false);
  const [cherryPickTarget, setCherryPickTarget] = useState<CommitInfo | null>(null);
  /** 当前是否处于 rebase / cherry-pick 中 */
  const [operationState, setOperationState] = useState<OperationState | null>(null);
  const [operationBusy, setOperationBusy] = useState(false);
  const [confirmAbortOperation, setConfirmAbortOperation] = useState(false);

  // ── 打开方式下拉（一次性选择，不记录状态）──────────────────────────
  const [openMenuOpen, setOpenMenuOpen] = useState(false);
  const openMenuRef = useRef<HTMLDivElement>(null);

  // ── Changes tab state ─────────────────────────────────────────────────
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [selectedFile, setSelectedFile] = useState<ChangedFile | null>(null);
  /** 右侧内容区模式：diff = 单文件对比，file = 文件内容预览，all = 所有变更文件连续对比 */
  const [rightPanelMode, setRightPanelMode] = useState<"diff" | "file" | "all">("all");
  const [diffView, setDiffView] = useState<DiffView>("unstaged");
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const diffRequestId = useRef(0);
  const diffCache = useRef<Map<string, FileDiff>>(new Map());
  /** 最近一次加载 Diff 的目标（文件 + 视图），用于区分文件切换与后台刷新 */
  const lastDiffViewKeyRef = useRef<string | null>(null);
  /** 最近一次状态刷新的时间，用于抑制文件监听引起的重复刷新 */
  const lastStatusLoadRef = useRef(0);
  const selectedFileRef = useRef<ChangedFile | null>(null);
  selectedFileRef.current = selectedFile;

  const cacheKey = (path: string, view: DiffView) => `${view}:${path}`;

  const onRepoUpdateRef = useRef(onRepoUpdate);
  onRepoUpdateRef.current = onRepoUpdate;
  const repoRef = useRef(repo);
  repoRef.current = repo;

  const handleRemoveRecentRepo = useCallback((path: string) => {
    removeRecentRepo(path);
    refreshRecentRepos();
  }, [refreshRecentRepos]);

  /** 跨项目打开文件：等仓库切换后的重置 effect 执行完再应用目标文件 */
  const pendingProjectFileRef = useRef<{ fullPath: string; relPath: string } | null>(null);

  const handleProjectFileClick = useCallback(
    async (repoPath: string, fullPath: string, relPath: string) => {
      if (repoRef.current?.path === repoPath) {
        setSelectedFolderFile({ fullPath, relPath });
        return;
      }
      pendingProjectFileRef.current = { fullPath, relPath };
      try {
        const info = await openRepository(repoPath);
        saveCurrentRepo(info);
        onRepoUpdateRef.current(info);
        refreshRecentRepos();
      } catch (e) {
        pendingProjectFileRef.current = null;
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [refreshRecentRepos]
  );

  // ── 仓库切换时重置所有状态并重新加载 ────────────────────────────────
  useEffect(() => {
    // 重置变更列表状态
    setStatus(null);
    setSelectedFile(null);
    setRightPanelMode("all");
    setDiff(null);
    setDiffLoading(false);
    setError(null);
    diffCache.current.clear();

    // 重置历史记录状态
    setCommits([]);
    setHasMore(true);
    setLogError(null);
    hasMoreRef.current = true;
    offsetRef.current = 0;
    setSelectedCommit(null);
    setShowUncommitted(false);
    setCompareFrom(null);
    setAmendMode(false);
    setBranchAction(null);
    setBranchActionError(null);
    setConfirmUndoCommit(false);
    setCherryPickTarget(null);
    setOperationState(null);
    setConfirmAbortOperation(false);

    // 重置文件夹 tab 状态
    setSelectedFolderFile(null);

    // 从最左侧项目侧边栏跨项目打开文件：重置完成后再应用目标文件
    if (pendingProjectFileRef.current) {
      const target = pendingProjectFileRef.current;
      pendingProjectFileRef.current = null;
      setSelectedFolderFile(target);
    }

    // 重新加载变更列表
    loadStatus();

    // 如果当前在历史 tab，重新加载提交记录
    if (activeTab === "history") {
      loadMoreCommits();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo.path]);

  const loadStatus = useCallback(async (silent = false) => {
    lastStatusLoadRef.current = Date.now();
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const s = await getStatus();
      setStatus(s);
      // 同步状态用于决定显示 Commit 还是 Sync Changes，失败时不影响主流程
      try {
        setSyncStatus(await getSyncStatus());
      } catch {
        setSyncStatus(null);
      }
      // rebase / cherry-pick 是否仍在进行中
      try {
        setOperationState(await getOperationState());
      } catch {
        setOperationState(null);
      }
      diffCache.current.clear();
      const currentRepo = repoRef.current;
      if (currentRepo.branch !== s.branch || currentRepo.is_detached !== s.is_detached) {
        const updatedRepo = { ...currentRepo, branch: s.branch, is_detached: s.is_detached };
        onRepoUpdateRef.current(updatedRepo);
        saveCurrentRepo(updatedRepo);
      }
      // 刷新后检查当前选中文件是否还存在，不存在则清除选中状态和预览
      setSelectedFile((prev) => {
        if (!prev) return null;
        const allFiles = [...s.unstaged, ...s.staged];
        const stillExists = allFiles.some((f) => f.path === prev.path);
        if (!stillExists) {
          setDiff(null);
          return null;
        }
        // 文件还存在，但需要更新为最新的文件对象（以刷新 diff）
        const updated = allFiles.find((f) => f.path === prev.path) ?? null;
        return updated;
      });
      return s;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // ── 窗口获得焦点时自动刷新变更列表 ────────────────────────────────────
  const loadStatusRef = useRef(loadStatus);
  loadStatusRef.current = loadStatus;

  // 焦点自动刷新统一放在历史记录相关回调之后定义（见下方 handleAutoRefresh）

  const selectedFilePath = selectedFile?.path ?? null;

  /** 文件夹 tab 当前预览文件对应的 Git 变更信息（用于标注变更行） */
  const selectedFolderChange = useMemo(() => {
    if (!selectedFolderFile || !status) return null;
    const path = selectedFolderFile.relPath;
    return [...status.staged, ...status.unstaged].find((f) => f.path === path) ?? null;
  }, [selectedFolderFile, status]);

  useEffect(() => {
    const file = selectedFileRef.current;
    if (!file || !selectedFilePath) {
      lastDiffViewKeyRef.current = null;
      setDiff(null);
      setDiffLoading(false);
      return;
    }

    let view = diffView;
    if (view === "staged" && !file.has_staged_changes) {
      view = "unstaged";
      setDiffView("unstaged");
    } else if (view === "unstaged" && !file.has_unstaged_changes) {
      view = "staged";
      setDiffView("staged");
    }

    const requestId = ++diffRequestId.current;
    setDiffError(null);

    // 同一文件 / 视图的后台刷新不显示加载态，避免自动刷新时预览区闪动
    const viewKey = `${selectedFilePath}\u0000${view}`;
    const sameTarget = lastDiffViewKeyRef.current === viewKey;
    lastDiffViewKeyRef.current = viewKey;
    if (!sameTarget) setDiffLoading(true);

    getFileDiff(selectedFilePath, view)
      .then((d) => {
        if (requestId === diffRequestId.current) {
          diffCache.current.set(cacheKey(selectedFilePath, view), d);
          setDiff(d);
        }
      })
      .catch((e) => {
        if (requestId === diffRequestId.current) {
          setDiffError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (requestId === diffRequestId.current) {
          setDiffLoading(false);
        }
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFile, diffView]);

  // ── History tab state ─────────────────────────────────────────────────
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const offsetRef = useRef(0);
  // 用 ref 保存分页状态，避免回调闭包拿到过期的 state（例如刷新时 hasMore 刚被重置）
  const hasMoreRef = useRef(true);
  const logLoadingRef = useRef(false);

  const [selectedCommit, setSelectedCommit] = useState<CommitInfo | null>(null);
  /** 历史列表最上方的「未提交的变更」是否被选中 */
  const [showUncommitted, setShowUncommitted] = useState(false);

  const loadMoreCommits = useCallback(async () => {
    if (logLoadingRef.current || !hasMoreRef.current) return;
    logLoadingRef.current = true;
    setLogLoading(true);
    setLogError(null);
    try {
      const page = await getCommitLog(PAGE_SIZE, offsetRef.current);
      if (page.length < PAGE_SIZE) {
        hasMoreRef.current = false;
        setHasMore(false);
      }
      setCommits((prev) => [...prev, ...page]);
      offsetRef.current += page.length;
    } catch (e) {
      setLogError(e instanceof Error ? e.message : String(e));
      hasMoreRef.current = false;
      setHasMore(false);
    } finally {
      logLoadingRef.current = false;
      setLogLoading(false);
    }
  }, []);

  // Load commits when user switches to History tab for the first time
  useEffect(() => {
    if (activeTab === "history" && commits.length === 0) {
      loadMoreCommits();
    }
  }, [activeTab, commits.length, loadMoreCommits]);

  const handleSelectCommit = useCallback((commit: CommitInfo) => {
    setShowUncommitted(false);
    setSelectedFolderFile(null);
    setSelectedCommit(commit);
    // 点击的正好是当前对比基准时，退出对比模式
    setCompareFrom((prev) => (prev?.hash === commit.hash ? null : prev));
  }, []);

  const handleSelectUncommitted = useCallback(() => {
    if (showUncommitted) {
      setShowUncommitted(false);
      return;
    }
    setSelectedCommit(null);
    setSelectedFolderFile(null);
    setCompareFrom(null);
    // 存在冲突时直接打开第一个冲突文件，进入可视化解决界面
    const conflictFile = status
      ? [...status.unstaged, ...status.staged].find(
          (f) =>
            f.status === "conflict" ||
            f.staged_status === "conflict" ||
            f.unstaged_status === "conflict",
        )
      : undefined;
    if (conflictFile) {
      setSelectedFile(conflictFile);
      setRightPanelMode("diff");
    } else {
      setSelectedFile(null);
      setRightPanelMode("all");
    }
    setShowUncommitted(true);
  }, [showUncommitted, status]);

  /** 设置 / 取消提交间对比基准 */
  const handleToggleCompareBase = useCallback((commit: CommitInfo) => {
    setShowUncommitted(false);
    setSelectedFolderFile(null);
    setCompareFrom((prev) => {
      if (prev?.hash === commit.hash) return null;
      return commit;
    });
    setSelectedCommit((prev) => (prev?.hash === commit.hash ? null : prev));
  }, []);

  // Client-side filter for commit list
  const filteredCommits = useMemo(() => {
    if (!filter.trim()) return commits;
    const q = filter.toLowerCase();
    return commits.filter(
      (c) =>
        c.subject.toLowerCase().includes(q) ||
        c.short_hash.toLowerCase().includes(q) ||
        c.author_name.toLowerCase().includes(q)
    );
  }, [commits, filter]);

  const handleOpenTerminal = useCallback(async () => {
    try {
      await openTerminal();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  /** 用 VS Code（设置中的编辑器命令）打开当前项目 */
  const handleOpenProject = useCallback(async () => {
    try {
      await openPath(repo.path, "editor");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [repo.path]);

  /** 一次性选择打开方式：按所选方式打开后关闭下拉，不记录选择 */
  const handleOpenOnce = useCallback(
    async (method: OpenMethod) => {
      setOpenMenuOpen(false);
      try {
        await openPath(repo.path, method);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [repo.path],
  );

  // 点外部关闭打开方式下拉
  useEffect(() => {
    if (!openMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (openMenuRef.current && !openMenuRef.current.contains(e.target as Node)) {
        setOpenMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [openMenuOpen]);

  /** 第一步：右键菜单点击撤销 → 仅弹出确认框，不执行任何 git 操作 */
  const handleRevert = useCallback(
    (file: ChangedFile, scope: "unstaged" | "staged" | "all") => {
      setRevertPending({ file, scope });
    },
    [],
  );

  /** 用户在确认框点击"确认" → 执行实际的 git 撤销 */
  const handleRevertConfirm = useCallback(async () => {
    if (!revertPending) return;
    const { file, scope } = revertPending;
    setRevertPending(null);
    try {
      await revertFile(file.path, scope);
      // 如果撤销的是当前选中的文件，先清掉，避免 Diff 面板显示陈旧内容
      if (selectedFilePath === file.path) {
        setSelectedFile(null);
        setDiff(null);
      }
      await loadStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [revertPending, loadStatus, selectedFilePath]);

  /** 暂存单个文件（悬停加号） */
  const handleStage = useCallback(async (file: ChangedFile) => {
    try {
      await stageFile(file.path);
      await loadStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [loadStatus]);

  /** 取消暂存（保留工作区修改） */
  const handleUnstage = useCallback(async (file: ChangedFile) => {
    try {
      await revertFile(file.path, "staged");
      await loadStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [loadStatus]);

  /** 暂存所有变更（git add -A） */
  const handleStageAll = useCallback(async () => {
    try {
      await stageAll();
      await loadStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [loadStatus]);

  /** 确认放弃所有工作区变更 */
  const handleDiscardAllConfirm = useCallback(async () => {
    setConfirmDiscardAll(false);
    try {
      await discardAllUnstaged();
      setSelectedFile(null);
      setDiff(null);
      setRightPanelMode("all");
      await loadStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [loadStatus]);

  /** 点击文件条目：右侧展示变更对比 */
  const handleSelectChangedFile = useCallback((file: ChangedFile) => {
    setSelectedFolderFile(null);
    setSelectedFile(file);
    setRightPanelMode("diff");
  }, []);

  /** 悬停"打开文件"：右侧按文件夹目录的预览方式展示文件内容 */
  const handlePreviewChangedFile = useCallback((file: ChangedFile) => {
    setSelectedFolderFile(null);
    setSelectedFile(file);
    setRightPanelMode("file");
  }, []);

  /** 预览所有变更文件：按文件顺序从上到下连续对比 */
  const handleOpenAllChanges = useCallback(() => {
    setSelectedFolderFile(null);
    setRightPanelMode("all");
  }, []);

  const selectedFileFullPath = useMemo(() => {
    if (!selectedFile) return "";
    const base = repo.path.replace(/\\/g, "/").replace(/\/+$/, "");
    return `${base}/${selectedFile.path.replace(/\\/g, "/")}`;
  }, [repo.path, selectedFile]);

  /** 已加载的提交数量（用 ref 避免焦点回调拿到过期闭包） */
  const commitsLenRef = useRef(0);
  commitsLenRef.current = commits.length;

  /** 刷新已加载范围内的提交记录，保持分页深度与当前选中项 */
  const refreshHistory = useCallback(async () => {
    if (logLoadingRef.current) return;
    const loaded = commitsLenRef.current;
    // 从未加载过历史记录时不做额外请求，等用户切到历史页再加载
    if (loaded === 0) return;

    const limit = Math.max(loaded, PAGE_SIZE);
    logLoadingRef.current = true;
    setLogLoading(true);
    setLogError(null);
    try {
      const page = await getCommitLog(limit, 0);
      offsetRef.current = page.length;
      hasMoreRef.current = page.length >= limit;
      setHasMore(hasMoreRef.current);
      setCommits(page);
      // 同步刷新选中提交（保持选中，即使提交信息已变化）
      setSelectedCommit((prev) => (prev ? page.find((c) => c.hash === prev.hash) ?? prev : prev));
      setCompareFrom((prev) => (prev ? page.find((c) => c.hash === prev.hash) ?? prev : prev));
    } catch (e) {
      setLogError(e instanceof Error ? e.message : String(e));
    } finally {
      logLoadingRef.current = false;
      setLogLoading(false);
    }
  }, []);

  /** 检出指定提交 (git checkout <hash>) */
  const handleCheckoutCommit = useCallback(
    async (commit: CommitInfo) => {
      if (gitBusy) return;
      setGitBusy(true);
      setError(null);
      try {
        await checkoutBranch(commit.hash, false);
        const info = await openRepository(repo.path);
        saveCurrentRepo(info);
        onRepoUpdate(info);
        await loadStatus();
        await refreshHistory();
        setFolderRefreshKey((k) => k + 1);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setGitBusy(false);
      }
    },
    [gitBusy, repo.path, onRepoUpdate, loadStatus, refreshHistory]
  );

  /** 工具栏：获取远程更新（git fetch）并刷新本地状态 */
  const handleFetch = useCallback(async () => {
    if (remoteBusy) return;
    setRemoteBusy("fetch");
    setError(null);
    try {
      await fetchChanges();
      await loadStatus();
      await refreshHistory();
      setFolderRefreshKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRemoteBusy(null);
    }
  }, [remoteBusy, loadStatus, refreshHistory]);

  /** 关闭下拉菜单：点击菜单外面时收起 */
  useEffect(() => {
    if (!toolMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if ((e.target as HTMLElement | null)?.closest(".toolbar-menu-wrap")) return;
      setToolMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [toolMenuOpen]);

  const openToolDialog = useCallback((action: "branch" | "tag" | "stash" | "stashes") => {
    setToolMenuOpen(false);
    setToolAction(action);
    setToolInput("");
    setToolError(null);

    // 贮藏列表：打开时即时拉取
    if (action === "stashes") {
      setStashes([]);
      setToolBusy(true);
      getStashList()
        .then((entries) => setStashes(entries))
        .catch((e) => setToolError(e instanceof Error ? e.message : String(e)))
        .finally(() => setToolBusy(false));
    }
  }, []);

  /** 应用 / 恢复贮藏：keepRecord 为 true 时用 apply（保留记录），否则用 pop（成功后删除） */
  const handleApplyStash = useCallback(
    async (index: number, keepRecord: boolean) => {
      if (toolBusy) return;
      setToolBusy(true);
      setToolError(null);
      try {
        if (keepRecord) {
          await applyStash(index);
        } else {
          await popStash(index);
        }
        setSelectedFile(null);
        setDiff(null);
        setRightPanelMode("diff");
        await loadStatus();
        setFolderRefreshKey((k) => k + 1);
        setStashes(await getStashList());
      } catch (e) {
        setToolError(e instanceof Error ? e.message : String(e));
      } finally {
        setToolBusy(false);
      }
    },
    [toolBusy, loadStatus],
  );

  /** 删除单条贮藏 / 清空全部（二次确认后执行） */
  const handleStashDelete = useCallback(async () => {
    if (!stashConfirm || toolBusy) return;
    setToolBusy(true);
    setToolError(null);
    try {
      if (stashConfirm.type === "drop") {
        await dropStash(stashConfirm.index);
      } else {
        await clearStashes();
      }
      setStashConfirm(null);
      setStashes(await getStashList());
    } catch (e) {
      setStashConfirm(null);
      setToolError(e instanceof Error ? e.message : String(e));
    } finally {
      setToolBusy(false);
    }
  }, [stashConfirm, toolBusy]);

  /** 打开/关闭分支下拉，打开时拉取分支列表 */
  const toggleBranchMenu = useCallback(() => {
    if (branchMenuOpen) {
      setBranchMenuOpen(false);
      return;
    }
    setBranchMenuOpen(true);
    getBranches()
      .then((list) => setBranches(list))
      .catch(() => setBranches(null));
  }, [branchMenuOpen]);

  useEffect(() => {
    if (!branchMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if ((e.target as HTMLElement | null)?.closest(".branch-switcher")) return;
      setBranchMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [branchMenuOpen]);

  /** 切换本地/远程分支 */
  const handleCheckoutBranch = useCallback(
    async (name: string, isRemote: boolean) => {
      if (branchBusy || name === repo.branch) {
        setBranchMenuOpen(false);
        return;
      }
      setBranchMenuOpen(false);
      setBranchBusy(true);
      setError(null);
      try {
        await checkoutBranch(name, isRemote);
        setSelectedFile(null);
        setDiff(null);
        setRightPanelMode("diff");
        await loadStatus();
        await refreshHistory();
        setFolderRefreshKey((k) => k + 1);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBranchBusy(false);
      }
    },
    [branchBusy, repo.branch, loadStatus, refreshHistory],
  );

  /** 刷新分支下拉列表 */
  const refreshBranches = useCallback(() => {
    getBranches()
      .then((list) => setBranches(list))
      .catch(() => setBranches(null));
  }, []);

  /** 打开分支操作弹窗（合并 / 变基 / 删除 / 重命名） */
  const openBranchAction = useCallback(
    (type: "merge" | "rebase" | "delete" | "rename", name: string) => {
      setBranchMenuOpen(false);
      setBranchActionError(null);
      setBranchActionInput(name);
      setBranchAction({ type, name });
    },
    [],
  );

  const closeBranchAction = useCallback(() => {
    if (branchActionBusy) return;
    setBranchAction(null);
    setBranchActionError(null);
  }, [branchActionBusy]);

  /** 执行分支操作 */
  const handleBranchActionSubmit = useCallback(async () => {
    if (!branchAction || branchActionBusy) return;
    const { type, name } = branchAction;
    const value = branchActionInput.trim();

    if (type === "rename" && !value) {
      setBranchActionError(t("dialogs.inputNewBranchNameError"));
      return;
    }

    setBranchActionBusy(true);
    setBranchActionError(null);
    setError(null);
    try {
      if (type === "rename") {
        await renameBranch(name, value);
        if (name === repo.branch) {
          // 当前分支改名后重新读取仓库信息，同步顶部徽标
          const info = await openRepository(repo.path);
          saveCurrentRepo(info);
          onRepoUpdate(info);
        }
      } else if (type === "merge") {
        await mergeBranch(name);
      } else if (type === "rebase") {
        await rebaseBranch(name);
      } else {
        await deleteBranch(name, false);
      }

      setBranchAction(null);
      refreshBranches();
      await loadStatus();
      await refreshHistory();
      setFolderRefreshKey((k) => k + 1);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (type === "rename") {
        setBranchActionError(message);
      } else {
        setBranchAction(null);
        // 合并 / 变基失败通常是产生了冲突，需要刷新状态让冲突文件出现在列表中
        const latest = await loadStatus();
        refreshBranches();
        setError(message);
        if (statusHasConflicts(latest)) {
          setShowUncommitted(true);
          setSelectedCommit(null);
          setCompareFrom(null);
          setSelectedFile(null);
          setRightPanelMode("all");
        }
      }
    } finally {
      setBranchActionBusy(false);
    }
  }, [
    branchAction,
    branchActionBusy,
    branchActionInput,
    repo.branch,
    repo.path,
    onRepoUpdate,
    refreshBranches,
    loadStatus,
    refreshHistory,
    t,
  ]);

  /** 冲突文件保存 / 标记已解决后刷新状态，并自动跳到下一个冲突 */
  const handleConflictResolved = useCallback(async () => {
    setDiff(null);
    const latest = await loadStatus();
    const nextConflict = latest
      ? [...latest.unstaged, ...latest.staged].find(
          (f) =>
            f.status === "conflict" ||
            f.staged_status === "conflict" ||
            f.unstaged_status === "conflict",
        )
      : undefined;
    if (nextConflict) {
      setSelectedFile(nextConflict);
      setRightPanelMode("diff");
    } else {
      setSelectedFile(null);
      setRightPanelMode("all");
    }
    await refreshHistory();
    setFolderRefreshKey((k) => k + 1);
  }, [loadStatus, refreshHistory]);

  /** 撤销最近一次提交（soft reset，内容保留在暂存区） */
  const handleUndoCommit = useCallback(async () => {
    if (gitBusy) return;
    setConfirmUndoCommit(false);
    setGitBusy(true);
    setError(null);
    try {
      await undoLastCommit();
      setSelectedCommit(null);
      setCompareFrom(null);
      await loadStatus();
      await refreshHistory();
      setFolderRefreshKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGitBusy(false);
    }
  }, [gitBusy, loadStatus, refreshHistory]);

  /** 确认 cherry-pick 选中的提交 */
  const handleCherryPickConfirm = useCallback(async () => {
    if (!cherryPickTarget || gitBusy) return;
    const target = cherryPickTarget;
    setCherryPickTarget(null);
    setGitBusy(true);
    setError(null);
    try {
      await cherryPickCommit(target.hash);
      await loadStatus();
      await refreshHistory();
      setFolderRefreshKey((k) => k + 1);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const latest = await loadStatus();
      setError(message);
      if (statusHasConflicts(latest)) {
        setShowUncommitted(true);
        setSelectedCommit(null);
        setCompareFrom(null);
        setSelectedFile(null);
        setRightPanelMode("all");
      }
    } finally {
      setGitBusy(false);
    }
  }, [cherryPickTarget, gitBusy, loadStatus, refreshHistory]);

  /** 继续当前 rebase / cherry-pick */
  const handleContinueOperation = useCallback(async () => {
    if (!operationState?.in_progress || operationBusy) return;
    const kind = operationState.kind;
    setOperationBusy(true);
    setError(null);
    try {
      if (kind === "rebase") {
        await continueRebase();
      } else if (kind === "cherry-pick") {
        await continueCherryPick();
      }
      await loadStatus();
      await refreshHistory();
      setFolderRefreshKey((k) => k + 1);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // 继续后可能又在下一个提交处产生新冲突，刷新后自动打开冲突列表
      const latest = await loadStatus();
      setError(message);
      if (statusHasConflicts(latest)) {
        setShowUncommitted(true);
        setSelectedCommit(null);
        setCompareFrom(null);
        setSelectedFile(null);
        setRightPanelMode("all");
      }
    } finally {
      setOperationBusy(false);
    }
  }, [operationState, operationBusy, loadStatus, refreshHistory]);

  /** 中止当前 rebase / cherry-pick，恢复到操作前 */
  const handleAbortOperation = useCallback(async () => {
    if (!operationState?.in_progress || operationBusy) return;
    const kind = operationState.kind;
    setConfirmAbortOperation(false);
    setOperationBusy(true);
    setError(null);
    try {
      if (kind === "rebase") {
        await abortRebase();
      } else if (kind === "cherry-pick") {
        await abortCherryPick();
      }
      setSelectedFile(null);
      setDiff(null);
      setRightPanelMode("all");
      await loadStatus();
      await refreshHistory();
      setFolderRefreshKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await loadStatus();
    } finally {
      setOperationBusy(false);
    }
  }, [operationState, operationBusy, loadStatus, refreshHistory]);

  const closeToolDialog = useCallback(() => {
    if (toolBusy) return;
    setToolAction(null);
    setToolError(null);
  }, [toolBusy]);

  /** 新建分支 / 新建标签 / 贮藏的提交入口 */
  const handleToolSubmit = useCallback(async () => {
    if (!toolAction || toolBusy) return;
    const value = toolInput.trim();
    if ((toolAction === "branch" || toolAction === "tag") && !value) {
      setToolError(toolAction === "branch" ? t("dialogs.inputBranchNameError") : t("dialogs.inputTagNameError"));
      return;
    }

    setToolBusy(true);
    setToolError(null);
    try {
      if (toolAction === "branch") {
        await createBranch(value, true);
        // 切换分支后当前分支信息会变化，重新打开仓库以同步徽标与文件
        const info = await openRepository(repo.path);
        saveCurrentRepo(info);
        onRepoUpdate(info);
        await loadStatus();
        await refreshHistory();
        setFolderRefreshKey((k) => k + 1);
      } else if (toolAction === "tag") {
        await createTag(value);
      } else if (toolAction === "stash") {
        await stashChanges(value || undefined);
        setSelectedFile(null);
        setDiff(null);
        setRightPanelMode("diff");
        await loadStatus();
        setFolderRefreshKey((k) => k + 1);
      }
      setToolAction(null);
    } catch (e) {
      setToolError(e instanceof Error ? e.message : String(e));
    } finally {
      setToolBusy(false);
    }
  }, [toolAction, toolBusy, toolInput, repo.path, onRepoUpdate, loadStatus, refreshHistory, t]);

  /** 提交暂存区内容；Amend 模式下修正上一次提交 */
  const handleCommit = useCallback(async () => {
    const message = commitMessage.trim();
    const stagedCount = status?.staged.length ?? 0;
    if (committing) return;
    if (amendMode) {
      // Amend 允许只改提交信息，也允许只追加暂存内容（沿用原信息）
      if (!message && stagedCount === 0) return;
    } else if (!message) {
      return;
    }
    setCommitting(true);
    setError(null);
    try {
      if (amendMode) {
        await amendCommit(message || undefined);
      } else {
        await commitChanges(message);
      }
      setCommitMessage("");
      setAmendMode(false);
      setSelectedFile(null);
      setDiff(null);
      setRightPanelMode("all");
      await loadStatus();
      await refreshHistory();
      setFolderRefreshKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCommitting(false);
    }
  }, [amendMode, commitMessage, committing, status?.staged.length, loadStatus, refreshHistory]);

  const isMac = useMemo(() => {
    return typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
  }, []);

  /** 在提交信息框按 Ctrl+Enter (Mac 为 ⌘+Enter) 快捷提交 */
  const handleCommitKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        const stagedCount = status?.staged.length ?? 0;
        const canSubmit = amendMode
          ? commitMessage.trim().length > 0 || stagedCount > 0
          : commitMessage.trim().length > 0 && stagedCount > 0;
        if (!committing && canSubmit) {
          handleCommit();
        }
      }
    },
    [amendMode, commitMessage, committing, status?.staged.length, handleCommit]
  );

  /** 同步到远程仓库（落后时先快进拉取，再推送本地提交） */
  const handleSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    setError(null);
    try {
      await syncChanges();
      await loadStatus();
      await refreshHistory();
      setFolderRefreshKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }, [syncing, loadStatus, refreshHistory]);

  /** 工具栏：拉取远程变更 */
  const handlePull = useCallback(async () => {
    if (remoteBusy) return;
    setRemoteBusy("pull");
    setError(null);
    try {
      await pullChanges();
      await loadStatus();
      await refreshHistory();
      setFolderRefreshKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRemoteBusy(null);
    }
  }, [remoteBusy, loadStatus, refreshHistory]);

  /** 工具栏：推送本地提交 */
  const handlePush = useCallback(async () => {
    if (remoteBusy) return;
    setRemoteBusy("push");
    setError(null);
    try {
      await pushChanges();
      await loadStatus();
      await refreshHistory();
      setFolderRefreshKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRemoteBusy(null);
    }
  }, [remoteBusy, loadStatus, refreshHistory]);

  // ── 窗口回到顶层时自动刷新：变更文件 + 历史记录 + 文件夹目录 ─────────
  const lastAutoRefreshRef = useRef(0);
  /** 窗口真正失去焦点的时间，用于忽略点击窗口引起的 focus 事件 */
  const windowBlurredAtRef = useRef(0);
  const handleAutoRefreshRef = useRef<() => void>(() => {});
  handleAutoRefreshRef.current = () => {
    const now = Date.now();
    // 短时间内重复触发（如快速切窗）时合并为一次
    if (now - lastAutoRefreshRef.current < 1200) return;
    lastAutoRefreshRef.current = now;

    // 自动刷新使用静默模式：不显示整页加载态，保留当前预览内容
    loadStatusRef.current(true);
    refreshHistory();
    setFolderRefreshKey((k) => k + 1);
  };

  useEffect(() => {
    const handleBlur = () => {
      windowBlurredAtRef.current = Date.now();
    };
    const handleFocus = () => {
      const blurredAt = windowBlurredAtRef.current;
      windowBlurredAtRef.current = 0;
      // 点击窗口 / 工具栏时也可能收到 focus；只有真正离开过窗口才刷新
      if (!blurredAt || Date.now() - blurredAt < 2000) return;
      handleAutoRefreshRef.current();
    };

    window.addEventListener("blur", handleBlur);
    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  // ── 文件系统监听：工作区文件变化时自动刷新变更 / 历史 / 目录树 ─────
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    listen("repo-changed", () => {
      // 应用自身的 Git 操作刚刷新过状态时，忽略紧随其后的文件事件
      if (Date.now() - lastStatusLoadRef.current < 1200) return;
      handleAutoRefreshRef.current();
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {
        // 监听注册失败时退化为窗口焦点刷新
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const changesCount = status
    ? new Set([...status.staged, ...status.unstaged].map((f) => f.path)).size
    : 0;
  /** 未解决冲突的文件数（去重） */
  const conflictCount = status
    ? new Set(
        [...status.staged, ...status.unstaged]
          .filter(
            (f) =>
              f.status === "conflict" ||
              f.staged_status === "conflict" ||
              f.unstaged_status === "conflict",
          )
          .map((f) => f.path),
      ).size
    : 0;
  // 暂存区为空且本地领先远程时，主按钮切换为「同步到远程」
  const showSync = (syncStatus?.ahead ?? 0) > 0 && (status?.staged.length ?? 0) === 0;

  /** 当前选中的文件是否处于合并冲突状态 */
  const selectedFileIsConflict = selectedFile
    ? selectedFile.status === "conflict" ||
      selectedFile.staged_status === "conflict" ||
      selectedFile.unstaged_status === "conflict"
    : false;

  return (
    <div className="app-shell">
      <WindowResizeHandles />
      <WindowControls />

      <div className="app">
      <ProjectSidebar
        repos={recentRepos}
        currentRepoPath={repo.path}
        currentBranch={repo.branch}
        status={status}
        selectedPath={selectedFolderFile?.fullPath ?? null}
        refreshKey={folderRefreshKey}
        onSwitchRepo={handleOpenRecentRepo}
        onOpenFile={handleProjectFileClick}
        onOpenOther={handleOpenOtherRepo}
        onRemove={handleRemoveRecentRepo}
        width={projectSidebarWidth}
        onCollapsedChange={setProjectSidebarCollapsed}
      />
      {!projectSidebarCollapsed && (
        <SidebarResizeHandle
          width={projectSidebarWidth}
          min={PROJECT_SIDEBAR_MIN_WIDTH}
          max={PROJECT_SIDEBAR_MAX_WIDTH}
          onWidthChange={setProjectSidebarWidth}
          onResizeEnd={(width) => persistWidth(PROJECT_SIDEBAR_WIDTH_KEY, width)}
          onReset={() => {
            setProjectSidebarWidth(PROJECT_SIDEBAR_DEFAULT_WIDTH);
            persistWidth(PROJECT_SIDEBAR_WIDTH_KEY, PROJECT_SIDEBAR_DEFAULT_WIDTH);
          }}
          showLine={false}
          title={t("projectSidebar.resizeTooltip")}
        />
      )}

      <div className="app-main">
      {/* ── Toolbar (clean, global actions only) ──────────────────── */}
      <div className="toolbar" data-tauri-drag-region>
        <div className="branch-switcher">
          <button
            type="button"
            className={`toolbar-branch-badge ${repo.is_detached ? "detached" : ""}`}
            onClick={toggleBranchMenu}
            disabled={branchBusy}
            title={repo.is_detached ? t("toolbar.branchDetached") : t("toolbar.branchTooltip", { branch: repo.branch })}
          >
            {branchBusy ? (
              <Loader2 size={13} className="spin" style={{ flexShrink: 0 }} />
            ) : (
              <GitBranch size={13} style={{ flexShrink: 0 }} />
            )}
            <span>{repo.is_detached ? "Detached HEAD" : repo.branch}</span>
            <ChevronDown size={12} style={{ flexShrink: 0, opacity: 0.75 }} />
          </button>

          {branchMenuOpen && (
            <div className="branch-menu">
              <div className="branch-menu-section">{t("toolbar.localBranches")}</div>
              {branches === null ? (
                <div className="branch-menu-loading">
                  <Loader2 size={12} className="spin" /> {t("toolbar.readingBranches")}
                </div>
              ) : branches.local.length === 0 ? (
                <div className="branch-menu-empty">{t("toolbar.noLocalBranches")}</div>
              ) : (
                branches.local.map((name) => {
                  const isCurrent = name === branches.current || (!branches.current && name === repo.branch);
                  return (
                    <div
                      key={`local:${name}`}
                      className={`branch-menu-row ${isCurrent ? "current" : ""}`}
                    >
                      <button
                        type="button"
                        className={`branch-menu-item ${isCurrent ? "current" : ""}`}
                        onClick={() => handleCheckoutBranch(name, false)}
                      >
                        {isCurrent ? (
                          <Check size={12} style={{ flexShrink: 0 }} />
                        ) : (
                          <GitBranch size={12} style={{ flexShrink: 0, opacity: 0.6 }} />
                        )}
                        <span className="branch-menu-name">{name}</span>
                        {isCurrent && <span className="branch-menu-tag">{t("toolbar.currentTag")}</span>}
                      </button>
                      <div className="branch-menu-actions">
                        <button
                          type="button"
                          className="branch-menu-action"
                          disabled={branchBusy || isCurrent}
                          title={isCurrent ? t("toolbar.cannotMergeCurrent") : t("toolbar.mergeBranchTitle", { name })}
                          onClick={() => openBranchAction("merge", name)}
                        >
                          <GitMerge size={12} />
                        </button>
                        <button
                          type="button"
                          className="branch-menu-action"
                          disabled={branchBusy || isCurrent}
                          title={isCurrent ? t("toolbar.cannotRebaseCurrent") : t("toolbar.rebaseBranchTitle", { name })}
                          onClick={() => openBranchAction("rebase", name)}
                        >
                          <RotateCw size={12} />
                        </button>
                        <button
                          type="button"
                          className="branch-menu-action"
                          disabled={branchBusy}
                          title={t("toolbar.renameBranchTitle", { name })}
                          onClick={() => openBranchAction("rename", name)}
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          type="button"
                          className="branch-menu-action danger"
                          disabled={branchBusy || isCurrent}
                          title={isCurrent ? t("toolbar.cannotDeleteCurrent") : t("toolbar.deleteBranchTitle", { name })}
                          onClick={() => openBranchAction("delete", name)}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}

              <div className="branch-menu-section">{t("toolbar.remoteBranches")}</div>
              {branches === null ? null : branches.remote.length === 0 ? (
                <div className="branch-menu-empty">{t("toolbar.noRemoteBranches")}</div>
              ) : (
                branches.remote.map((name) => {
                  const shortName = name.split("/").slice(1).join("/");
                  const hasLocal = branches.local.includes(shortName);
                  return (
                    <button
                      key={`remote:${name}`}
                      type="button"
                      className="branch-menu-item remote"
                      onClick={() => handleCheckoutBranch(name, true)}
                    >
                      <GitBranch size={12} style={{ flexShrink: 0, opacity: 0.6 }} />
                      <span className="branch-menu-name">{name}</span>
                      {hasLocal && <span className="branch-menu-tag subtle">{t("toolbar.hasLocalTag")}</span>}
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>

        <div className="toolbar-branch-actions">
          <button
            className="toolbar-btn"
            onClick={handlePull}
            disabled={remoteBusy !== null}
            title={
              syncStatus && syncStatus.behind > 0
                ? t("toolbar.pullBehindTooltip", { count: syncStatus.behind })
                : t("toolbar.pullTooltip")
            }
          >
            {remoteBusy === "pull" ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <Download size={14} />
            )}
            <span>{t("toolbar.pull")}</span>
            {syncStatus && syncStatus.behind > 0 && (
              <span className="toolbar-badge" title={t("toolbar.pendingPullBadge", { count: syncStatus.behind })}>
                {syncStatus.behind}
              </span>
            )}
          </button>
          <button
            className="toolbar-btn"
            onClick={handlePush}
            disabled={
              remoteBusy !== null ||
              (syncStatus !== null && (!syncStatus.has_upstream || syncStatus.ahead === 0))
            }
            title={
              syncStatus && !syncStatus.has_upstream
                ? t("toolbar.pushNoUpstream")
                : syncStatus && syncStatus.ahead === 0
                  ? t("toolbar.pushNoAhead")
                  : syncStatus && syncStatus.ahead > 0
                    ? t("toolbar.pushAheadTooltip", { count: syncStatus.ahead })
                    : t("toolbar.pushTooltip")
            }
          >
            {remoteBusy === "push" ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <Upload size={14} />
            )}
            <span>{t("toolbar.push")}</span>
            {syncStatus && syncStatus.ahead > 0 && (
              <span className="toolbar-badge" title={t("toolbar.pendingPushBadge", { count: syncStatus.ahead })}>
                {syncStatus.ahead}
              </span>
            )}
          </button>
          <button
            className="toolbar-btn"
            onClick={handleFetch}
            disabled={remoteBusy !== null}
            title={t("toolbar.fetchTooltip")}
          >
            {remoteBusy === "fetch" ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <RotateCw size={14} />
            )}
            <span>{t("toolbar.fetch")}</span>
          </button>

          <div className="toolbar-menu-wrap">
            <button
              className="toolbar-btn"
              onClick={() => setToolMenuOpen((v) => !v)}
              title={t("toolbar.moreTooltip")}
              aria-haspopup="menu"
              aria-expanded={toolMenuOpen}
            >
              <MoreHorizontal size={14} />
              <span>{t("toolbar.more")}</span>
            </button>
            {toolMenuOpen && (
              <div className="toolbar-menu" role="menu">
                <button
                  type="button"
                  className="toolbar-menu-item"
                  role="menuitem"
                  onClick={() => openToolDialog("branch")}
                >
                  <GitBranch size={13} />
                  <span>{t("toolbar.newBranch")}</span>
                </button>
                <button
                  type="button"
                  className="toolbar-menu-item"
                  role="menuitem"
                  onClick={() => openToolDialog("tag")}
                >
                  <Tag size={13} />
                  <span>{t("toolbar.newTag")}</span>
                </button>
                <button
                  type="button"
                  className="toolbar-menu-item"
                  role="menuitem"
                  disabled={changesCount === 0}
                  title={changesCount === 0 ? t("toolbar.noStashableChanges") : t("toolbar.stashChanges")}
                  onClick={() => openToolDialog("stash")}
                >
                  <Archive size={13} />
                  <span>{t("toolbar.stashChanges")}</span>
                </button>
                <button
                  type="button"
                  className="toolbar-menu-item"
                  role="menuitem"
                  title={t("toolbar.stashList")}
                  onClick={() => openToolDialog("stashes")}
                >
                  <ArchiveRestore size={13} />
                  <span>{t("toolbar.stashList")}</span>
                </button>
                <div className="toolbar-menu-divider" />
                <button
                  type="button"
                  className="toolbar-menu-item"
                  role="menuitem"
                  disabled={gitBusy || commits.length === 0}
                  title={
                    commits.length === 0
                      ? t("toolbar.noCommitsInRepo")
                      : t("toolbar.undoLastCommitTooltip")
                  }
                  onClick={() => {
                    setToolMenuOpen(false);
                    setConfirmUndoCommit(true);
                  }}
                >
                  <RotateCcw size={13} />
                  <span>{t("toolbar.undoLastCommit")}</span>
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="toolbar-spacer" data-tauri-drag-region />

        <div className="toolbar-actions">
          <div className="open-with-switcher vscode-accent" ref={openMenuRef}>
            <button
              className="toolbar-btn open-with-main"
              onClick={handleOpenProject}
              title={t("toolbar.openWithVsCode")}
            >
              <ExternalLink size={14} />
              <span>VS Code</span>
            </button>
            <button
              className={`toolbar-btn open-with-caret ${openMenuOpen ? "open" : ""}`}
              onClick={() => setOpenMenuOpen((v) => !v)}
              title={t("toolbar.chooseOpenMethod")}
            >
              <ChevronDown size={12} />
            </button>

            {openMenuOpen && (
              <div className="open-with-menu">
                <div className="open-with-menu-title">{t("toolbar.openMethodTitle")}</div>
                {openMethods.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="open-with-menu-item"
                    onClick={() => handleOpenOnce(item.id)}
                  >
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            className="toolbar-btn"
            onClick={handleOpenTerminal}
            title={t("toolbar.openTerminalTooltip")}
          >
            <Terminal size={14} />
            <span>{t("toolbar.openTerminal")}</span>
          </button>
          {onOpenSettings && (
            <button
              className="toolbar-btn"
              onClick={onOpenSettings}
              title={t("toolbar.settingsTooltip")}
            >
              <Settings size={14} />
              <span>{t("toolbar.settings")}</span>
            </button>
          )}
        </div>
      </div>

      {operationState?.in_progress && (
        <div className={`git-operation-bar ${operationState.kind}`}>
          <GitMerge size={14} className="git-operation-icon" />
          <span className="git-operation-text">
            {operationState.kind === "rebase" ? t("operationBar.rebaseInProgress") : t("operationBar.cherryPickInProgress")}
            {conflictCount > 0
              ? t("operationBar.hasConflictsDesc", { count: conflictCount })
              : t("operationBar.resolvedDesc")}
          </span>
          <button
            type="button"
            className="git-operation-btn primary"
            onClick={handleContinueOperation}
            disabled={operationBusy || conflictCount > 0}
            title={
              conflictCount > 0
                ? t("operationBar.hasConflictsTooltip")
                : t("operationBar.continueTooltip")
            }
          >
            {operationBusy ? (
              <Loader2 size={12} className="spin" />
            ) : (
              <Check size={12} />
            )}
            <span>{t("common.continue")}</span>
          </button>
          <button
            type="button"
            className="git-operation-btn danger"
            onClick={() => setConfirmAbortOperation(true)}
            disabled={operationBusy}
            title={t("operationBar.abortTooltip")}
          >
            <X size={12} />
            <span>{t("common.abort")}</span>
          </button>
        </div>
      )}

      {error && !showUncommitted && (
        <div className="global-error-bar">
          <AlertTriangle size={13} />
          <span>{error}</span>
          <button
            type="button"
            className="error-copy-btn"
            title={t("operationBar.copyErrorTooltip")}
            onClick={() => {
              navigator.clipboard.writeText(error).catch(() => {});
            }}
          >
            <Copy size={12} />
            <span>{t("common.copy")}</span>
          </button>
          <button
            type="button"
            className="global-error-close"
            onClick={() => setError(null)}
            title={t("common.close")}
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* ── Main Layout ─────────────────────────────────────────── */}
      <div className="main-content">
        {/* ── Sidebar (Column 1) ─────────────────────────────────── */}
        <div className="sidebar" style={{ width: commitSidebarWidth }}>
          {/* Top of Sidebar: 提交记录与统计 */}
          <div className="sidebar-tabs-container">
            <div className="sidebar-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected
                className="sidebar-tab active"
              >
                <GitCommit size={14} />
                <span>{t("commitList.tabCommits")}</span>
              </button>
            </div>
            <div className="sidebar-tabs-meta">
              <span className="sidebar-commits-count" title={t("commitList.loadedCommitsTooltip")}>
                {filter.trim()
                  ? t("commitList.commitsMatchCount", { filtered: filteredCommits.length, total: commits.length })
                  : t("commitList.commitsCount", { count: commits.length })}
              </span>
              <button
                type="button"
                className="sidebar-refresh-btn"
                title={t("commitList.refreshTooltip")}
                onClick={() => {
                  refreshHistory();
                  loadStatus();
                }}
                disabled={gitBusy || logLoading}
              >
                <RotateCw size={12} className={logLoading ? "spin" : ""} />
              </button>
            </div>
          </div>

          <div className="sidebar-search">
            <Search size={13} className="sidebar-search-icon" />
            <input
              type="text"
              className="sidebar-search-input"
              placeholder={t("commitList.searchPlaceholder")}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            {filter && (
              <button
                type="button"
                className="sidebar-search-clear"
                onClick={() => setFilter("")}
                title={t("commitList.clearSearchTooltip")}
              >
                <X size={12} />
              </button>
            )}
          </div>

          {logError && <div className="error-message">{logError}</div>}
          <CommitList
            commits={filteredCommits}
            selectedHash={selectedCommit?.hash ?? null}
            loading={logLoading}
            hasMore={hasMore && !filter.trim()}
            onSelect={handleSelectCommit}
            onLoadMore={loadMoreCommits}
            uncommittedCount={changesCount}
            stagedCount={status?.staged.length ?? 0}
            unstagedCount={status?.unstaged.length ?? 0}
            uncommittedSelected={showUncommitted}
            onSelectUncommitted={handleSelectUncommitted}
            compareBaseHash={compareFrom?.hash ?? null}
            onToggleCompareBase={handleToggleCompareBase}
            onCherryPick={setCherryPickTarget}
            onCheckout={handleCheckoutCommit}
            onCreateBranch={() => openToolDialog("branch")}
            onCreateTag={() => openToolDialog("tag")}
            uncommittedContent={
              status ? (
                <FileList
                  status={status}
                  selectedPath={selectedFile?.path ?? null}
                  onSelect={handleSelectChangedFile}
                  onRevert={handleRevert}
                  onStage={handleStage}
                  onUnstage={handleUnstage}
                  onPreview={handlePreviewChangedFile}
                  onOpenAllChanges={handleOpenAllChanges}
                  onStageAll={handleStageAll}
                  onDiscardAll={() => setConfirmDiscardAll(true)}
                />
              ) : undefined
            }
          />
        </div>

        <SidebarResizeHandle
          width={commitSidebarWidth}
          min={COMMIT_SIDEBAR_MIN_WIDTH}
          max={COMMIT_SIDEBAR_MAX_WIDTH}
          onWidthChange={setCommitSidebarWidth}
          onResizeEnd={(width) => persistWidth(COMMIT_SIDEBAR_WIDTH_KEY, width)}
          onReset={() => {
            setCommitSidebarWidth(COMMIT_SIDEBAR_DEFAULT_WIDTH);
            persistWidth(COMMIT_SIDEBAR_WIDTH_KEY, COMMIT_SIDEBAR_DEFAULT_WIDTH);
          }}
          title={t("projectSidebar.resizeCommitTooltip")}
        />

        {activeTab === "history" && !selectedFolderFile && (
          <div className="history-main-content">
            {showUncommitted ? (
              <div className="uncommitted-changes-panel">
                <div className="uncommitted-commit-bar">
                  <div className="uncommitted-header">
                    <div className="uncommitted-header-left">
                      <span className="uncommitted-header-title">
                        <FileCode2 size={14} />
                        <span>{t("uncommittedPanel.title")}</span>
                        <span className="uncommitted-header-count" title={t("uncommittedPanel.totalChangesTooltip")}>
                          {changesCount}
                        </span>
                      </span>
                      {status && (
                        <div className="uncommitted-header-tags">
                          <span
                            className={`uncommitted-tag staged ${status.staged.length > 0 ? "has-items" : ""}`}
                            title={t("uncommittedPanel.stagedBadgeTooltip", { count: status.staged.length })}
                          >
                            {t("uncommittedPanel.stagedBadge", { count: status.staged.length })}
                          </span>
                          <span
                            className={`uncommitted-tag unstaged ${status.unstaged.length > 0 ? "has-items" : ""}`}
                            title={t("uncommittedPanel.unstagedBadgeTooltip", { count: status.unstaged.length })}
                          >
                            {t("uncommittedPanel.unstagedBadge", { count: status.unstaged.length })}
                          </span>
                          {conflictCount > 0 && (
                            <span
                              className="uncommitted-tag conflict has-items"
                              title={t("uncommittedPanel.conflictBadgeTooltip")}
                            >
                              {t("uncommittedPanel.conflictBadge", { count: conflictCount })}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="uncommitted-header-actions">
                      <button
                        type="button"
                        className="uncommitted-toolbar-btn"
                        onClick={handleStageAll}
                        disabled={changesCount === 0 || (status?.unstaged.length ?? 0) === 0}
                        title={t("uncommittedPanel.stageAllTooltip")}
                      >
                        <Plus size={13} />
                        <span>{t("uncommittedPanel.stageAll")}</span>
                      </button>

                      <button
                        type="button"
                        className="uncommitted-toolbar-btn danger"
                        onClick={() => setConfirmDiscardAll(true)}
                        disabled={changesCount === 0 || (status?.unstaged.length ?? 0) === 0}
                        title={t("uncommittedPanel.discardAllTooltip")}
                      >
                        <Undo2 size={13} />
                        <span>{t("uncommittedPanel.discardAll")}</span>
                      </button>

                      {showSync && (
                        <>
                          <div className="uncommitted-header-divider" />
                          <button
                            type="button"
                            className="uncommitted-sync-btn"
                            onClick={handleSync}
                            disabled={syncing}
                            title={t("uncommittedPanel.syncTooltip")}
                          >
                            <FolderSync size={13} />
                            <span>{syncing ? t("uncommittedPanel.syncing") : t("uncommittedPanel.syncChanges")}</span>
                            {syncStatus && syncStatus.ahead > 0 && (
                              <span className="uncommitted-sync-count" title={t("uncommittedPanel.syncAheadTooltip", { count: syncStatus.ahead })}>
                                {syncStatus.ahead}
                              </span>
                            )}
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="uncommitted-commit-row">
                    <div className="uncommitted-commit-input-wrap">
                      <textarea
                        className="uncommitted-commit-input"
                        placeholder={
                          amendMode
                            ? t("uncommittedPanel.amendPlaceholder")
                            : (status?.staged.length ?? 0) === 0
                              ? t("uncommittedPanel.commitPlaceholderEmpty", { key: isMac ? "⌘+Enter" : "Ctrl+Enter" })
                              : t("uncommittedPanel.commitPlaceholder", { key: isMac ? "⌘+Enter" : "Ctrl+Enter" })
                        }
                        value={commitMessage}
                        onChange={(e) => setCommitMessage(e.target.value)}
                        onKeyDown={handleCommitKeyDown}
                        rows={2}
                        spellCheck={false}
                      />
                    </div>

                    <button
                      type="button"
                      className={`uncommitted-amend-toggle ${amendMode ? "active" : ""}`}
                      onClick={() => setAmendMode((v) => !v)}
                      disabled={committing || commits.length === 0}
                      title={
                        commits.length === 0
                          ? t("uncommittedPanel.amendDisabledNoCommit")
                          : amendMode
                            ? t("uncommittedPanel.amendExitTooltip")
                            : t("uncommittedPanel.amendTooltip")
                      }
                    >
                      <Pencil size={13} />
                      <span>{t("uncommittedPanel.amendBtn")}</span>
                    </button>

                    <button
                      type="button"
                      className="uncommitted-commit-btn"
                      onClick={handleCommit}
                      disabled={
                        committing ||
                        (amendMode
                          ? !commitMessage.trim() && (status?.staged.length ?? 0) === 0
                          : !commitMessage.trim() || (status?.staged.length ?? 0) === 0)
                      }
                      title={
                        amendMode
                          ? (status?.staged.length ?? 0) === 0
                            ? t("uncommittedPanel.commitBtnAmendMsgOnlyTooltip")
                            : t("uncommittedPanel.commitBtnAmendTooltip", { count: status?.staged.length, shortcut: isMac ? "⌘+Enter" : "Ctrl+Enter" })
                          : (status?.staged.length ?? 0) === 0
                            ? t("uncommittedPanel.commitBtnEmptyStageTooltip")
                            : !commitMessage.trim()
                              ? t("uncommittedPanel.commitBtnInputPrompt")
                              : t("uncommittedPanel.commitBtnNormalTooltip", { count: status?.staged.length, shortcut: isMac ? "⌘+Enter" : "Ctrl+Enter" })
                      }
                    >
                      <div className="uncommitted-commit-btn-content">
                        {committing ? (
                          <Loader2 size={14} className="spin" />
                        ) : amendMode ? (
                          <Pencil size={15} />
                        ) : (
                          <GitCommit size={15} />
                        )}
                        <span>
                          {committing
                            ? t("uncommittedPanel.committing")
                            : amendMode
                              ? t("uncommittedPanel.commitAmendBtn")
                              : t("uncommittedPanel.commitBtn")}
                        </span>
                      </div>
                      {(status?.staged.length ?? 0) > 0 ? (
                        <span className="uncommitted-commit-btn-badge">
                          {t("uncommittedPanel.filesStagedBadge", {
                            count: status?.staged.length,
                            shortcut: amendMode ? (isMac ? "⌘↵" : "Ctrl+↵") : (isMac ? "⌘↵" : "Ctrl+↵"),
                          })}
                        </span>
                      ) : (
                        <span className="uncommitted-commit-btn-badge muted">
                          {amendMode ? t("uncommittedPanel.amendReuseBadge") : t("uncommittedPanel.stageEmptyBadge")}
                        </span>
                      )}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="error-message" style={{ margin: "10px 12px 0" }}>
                    <span className="error-message-text">{error}</span>
                    <button
                      type="button"
                      className="error-copy-btn"
                      title={t("operationBar.copyErrorTooltip")}
                      onClick={() => {
                        navigator.clipboard.writeText(error).catch(() => {});
                      }}
                    >
                      <Copy size={12} />
                      <span>{t("common.copy")}</span>
                    </button>
                  </div>
                )}

                <div className="uncommitted-body">
                  {status ? (
                    <div className="uncommitted-diff-area">
                        {rightPanelMode === "all" && (
                          <AllChangesView status={status} />
                        )}

                        {!selectedFile && rightPanelMode !== "all" && (
                          <div className="empty-state">
                            <div className="empty-state-icon-wrapper">
                              <FileCode2 size={32} strokeWidth={1.5} />
                            </div>
                            <div className="empty-state-text">{t("uncommittedPanel.selectFileDiffPrompt")}</div>
                            <div className="empty-state-sub">{t("uncommittedPanel.selectFileDiffSub")}</div>
                          </div>
                        )}

                        {selectedFile && rightPanelMode === "file" && (
                          <div className="changes-file-preview">
                            <FilePreview
                              fullPath={selectedFileFullPath}
                              relPath={selectedFile.path}
                              change={selectedFile}
                              onSwitchToDiff={() => setRightPanelMode("diff")}
                            />
                          </div>
                        )}

                        {selectedFile && rightPanelMode === "diff" && selectedFileIsConflict && (
                          <ConflictResolver
                            filePath={selectedFile.path}
                            onResolved={handleConflictResolved}
                          />
                        )}

                        {selectedFile &&
                          rightPanelMode === "diff" &&
                          !selectedFileIsConflict &&
                          diffLoading && (
                          <div className="diff-loading">
                            <Loader2 size={13} className="spin" />
                            <span>{t("uncommittedPanel.diffLoading")}</span>
                          </div>
                        )}

                        {selectedFile &&
                          rightPanelMode === "diff" &&
                          !selectedFileIsConflict &&
                          !diffLoading &&
                          diffError && (
                            <div className="empty-state">
                              <div
                                className="empty-state-icon-wrapper"
                                style={{ color: "var(--error-color)" }}
                              >
                                <AlertTriangle size={32} strokeWidth={1.5} />
                              </div>
                              <div className="empty-state-text">{t("uncommittedPanel.diffLoadError")}</div>
                              <div
                                style={{
                                  fontSize: 12,
                                  color: "var(--error-color)",
                                  maxWidth: 400,
                                  textAlign: "center",
                                }}
                              >
                                {diffError}
                              </div>
                            </div>
                          )}

                        {selectedFile &&
                          rightPanelMode === "diff" &&
                          !selectedFileIsConflict &&
                          !diffError &&
                          diff && (
                            <DiffViewer
                              diff={diff}
                              file={selectedFile}
                              view={diffView}
                              onViewChange={setDiffView}
                              repoPath={repo.path}
                              onSwitchToFile={() => setRightPanelMode("file")}
                            />
                          )}
                      </div>
                  ) : (
                    <div className="empty-state">
                      <div className="empty-state-icon-wrapper">
                        <Loader2 size={28} className="spin" />
                      </div>
                      <div className="empty-state-text">
                        {loading ? t("uncommittedPanel.gettingStatus") : t("uncommittedPanel.noChanges")}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : selectedCommit ? (
              <CommitChangesView
                commit={selectedCommit}
                compareFrom={
                  compareFrom && compareFrom.hash !== selectedCommit.hash
                    ? compareFrom
                    : undefined
                }
                onClearCompare={() => setCompareFrom(null)}
                onCherryPick={setCherryPickTarget}
              />
            ) : compareFrom ? (
              <div className="empty-state compare-empty-state">
                <div className="empty-state-icon-wrapper">
                  <GitCompare size={32} strokeWidth={1.5} />
                </div>
                <div className="empty-state-text">
                  {t("uncommittedPanel.compareEmptyTitle", { hash: compareFrom.short_hash })}
                </div>
                <div className="empty-state-sub">
                  {t("uncommittedPanel.compareEmptySub")}
                </div>
                <button
                  type="button"
                  className="compare-empty-cancel"
                  onClick={() => setCompareFrom(null)}
                >
                  {t("uncommittedPanel.cancelCompare")}
                </button>
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-state-icon-wrapper">
                  <GitCommit size={32} strokeWidth={1.5} />
                </div>
                <div className="empty-state-text">{t("uncommittedPanel.selectCommitPrompt")}</div>
                <div className="empty-state-sub">{t("uncommittedPanel.selectCommitSub")}</div>
              </div>
            )}
          </div>
        )}

        {selectedFolderFile && (
          <div className="diff-viewer">
            <FilePreview
              fullPath={selectedFolderFile.fullPath}
              relPath={selectedFolderFile.relPath}
              change={selectedFolderChange}
              onClose={() => setSelectedFolderFile(null)}
              onSwitchToDiff={
                selectedFolderChange
                  ? () => {
                      setSelectedFile(selectedFolderChange);
                      setSelectedFolderFile(null);
                      setRightPanelMode("diff");
                    }
                  : undefined
              }
            />
          </div>
        )}
      </div>
      </div>

      {/* ── 新建分支 / 新建标签 / 贮藏 输入弹窗 ───────────────────── */}
      {toolAction && (
        <div className="confirm-overlay" onClick={closeToolDialog}>
          <div
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="confirm-header">
              {toolAction === "branch" ? (
                <GitBranch size={16} className="confirm-icon" style={{ color: "var(--accent-color)" }} />
              ) : toolAction === "tag" ? (
                <Tag size={16} className="confirm-icon" style={{ color: "var(--accent-color)" }} />
              ) : toolAction === "stash" ? (
                <Archive size={16} className="confirm-icon" style={{ color: "var(--accent-color)" }} />
              ) : (
                <ArchiveRestore size={16} className="confirm-icon" style={{ color: "var(--accent-color)" }} />
              )}
              <span className="confirm-title">
                {toolAction === "branch"
                  ? t("dialogs.newBranchDialogTitle")
                  : toolAction === "tag"
                    ? t("dialogs.newTagDialogTitle")
                    : toolAction === "stash"
                      ? t("dialogs.stashDialogTitle")
                      : t("dialogs.stashesDialogTitle")}
              </span>
            </div>
            {toolAction === "stashes" ? (
              <div className="confirm-body">
                <div className="dialog-hint">
                  {t("dialogs.stashesHint")}
                </div>
                {toolBusy && stashes.length === 0 ? (
                  <div className="stash-empty">
                    <Loader2 size={14} className="spin" /> {t("dialogs.loadingStashes")}
                  </div>
                ) : stashes.length === 0 ? (
                  <div className="stash-empty">{t("dialogs.noStashEntries")}</div>
                ) : (
                  <div className="stash-list">
                    {stashes.map((entry) => (
                      <div className="stash-item" key={entry.ref_name}>
                        <div className="stash-item-info">
                          <div className="stash-item-message">{entry.message || entry.ref_name}</div>
                          <div className="stash-item-meta">
                            {entry.ref_name} · {entry.date}
                          </div>
                        </div>
                        <div className="stash-item-actions">
                          <button
                            type="button"
                            className="stash-action-btn"
                            disabled={toolBusy}
                            title={t("dialogs.applyStashKeepTooltip")}
                            onClick={() => handleApplyStash(entry.index, true)}
                          >
                            {t("common.apply")}
                          </button>
                          <button
                            type="button"
                            className="stash-action-btn primary"
                            disabled={toolBusy}
                            title={t("dialogs.applyStashPopTooltip")}
                            onClick={() => handleApplyStash(entry.index, false)}
                          >
                            <ArchiveRestore size={11} />
                            {t("common.restore")}
                          </button>
                          <button
                            type="button"
                            className="stash-action-btn danger"
                            disabled={toolBusy}
                            title={t("dialogs.dropStashTooltip")}
                            onClick={() => setStashConfirm({ type: "drop", index: entry.index })}
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {toolError && <div className="dialog-error">{toolError}</div>}
              </div>
            ) : (
              <div className="confirm-body">
                <div className="dialog-hint">
                  {toolAction === "branch"
                    ? t("dialogs.newBranchHint")
                    : toolAction === "tag"
                      ? t("dialogs.newTagHint")
                      : t("dialogs.stashHint")}
                </div>
                <input
                  autoFocus
                  className="dialog-input"
                  type="text"
                  value={toolInput}
                  spellCheck={false}
                  placeholder={
                    toolAction === "branch"
                      ? t("dialogs.newBranchPlaceholder")
                      : toolAction === "tag"
                        ? t("dialogs.newTagPlaceholder")
                        : t("dialogs.stashPlaceholder")
                  }
                  onChange={(e) => setToolInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleToolSubmit();
                    if (e.key === "Escape") closeToolDialog();
                  }}
                />
                {toolError && <div className="dialog-error">{toolError}</div>}
              </div>
            )}
            <div className="confirm-actions">
              {toolAction === "stashes" && stashes.length > 0 && (
                <button
                  className="confirm-btn confirm-btn-danger stash-clear-btn"
                  onClick={() => setStashConfirm({ type: "clear" })}
                  disabled={toolBusy}
                >
                  {t("dialogs.clearAllBtn")}
                </button>
              )}
              <button className="confirm-btn confirm-btn-cancel" onClick={closeToolDialog} disabled={toolBusy}>
                {toolAction === "stashes" ? t("common.close") : t("common.cancel")}
              </button>
              {toolAction !== "stashes" && (
                <button
                  className="confirm-btn confirm-btn-primary"
                  onClick={handleToolSubmit}
                  disabled={toolBusy || (toolAction !== "stash" && !toolInput.trim())}
                >
                  {toolBusy
                    ? t("common.processing")
                    : toolAction === "branch"
                      ? t("dialogs.createAndSwitchBtn")
                      : toolAction === "tag"
                        ? t("dialogs.createTagBtn")
                        : t("dialogs.stashBtn")}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm Dialog ───────────────────────────────────────── */}
      {revertPending && (() => {
        const { file, scope } = revertPending;
        const scopeLabel =
          scope === "unstaged" ? t("dialogs.scopeUnstaged")
          : scope === "staged" ? t("dialogs.scopeStaged")
          : t("dialogs.scopeAll");
        return (
          <ConfirmDialog
            title={t("dialogs.confirmRevertTitle")}
            message={t("dialogs.confirmRevertMsg", { scope: scopeLabel, path: file.path })}
            confirmText={t("common.revert")}
            cancelText={t("common.cancel")}
            onConfirm={handleRevertConfirm}
            onCancel={() => setRevertPending(null)}
          />
        );
      })()}
      {confirmDiscardAll && (
        <ConfirmDialog
          title={t("dialogs.confirmDiscardAllTitle")}
          message={t("dialogs.confirmDiscardAllMsg", { count: status?.unstaged.length ?? 0 })}
          confirmText={t("dialogs.discardAllBtn")}
          cancelText={t("common.cancel")}
          onConfirm={handleDiscardAllConfirm}
          onCancel={() => setConfirmDiscardAll(false)}
        />
      )}
      {stashConfirm && (
        <ConfirmDialog
          title={stashConfirm.type === "clear" ? t("dialogs.clearStashTitle") : t("dialogs.dropStashTitle")}
          message={
            stashConfirm.type === "clear"
              ? t("dialogs.clearStashMsg", { count: stashes.length })
              : t("dialogs.dropStashMsg", { name: stashes.find((s) => s.index === stashConfirm.index)?.ref_name ?? `stash@{${stashConfirm.index}}` })
          }
          confirmText={stashConfirm.type === "clear" ? t("dialogs.clearAllBtn") : t("common.delete")}
          cancelText={t("common.cancel")}
          onConfirm={handleStashDelete}
          onCancel={() => setStashConfirm(null)}
        />
      )}

      {/* ── 分支操作：重命名输入弹窗 ─────────────────────────────── */}
      {branchAction && branchAction.type === "rename" && (
        <div className="confirm-overlay" onClick={closeBranchAction}>
          <div
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="confirm-header">
              <Pencil size={16} className="confirm-icon" style={{ color: "var(--accent-color)" }} />
              <span className="confirm-title">{t("dialogs.renameBranchTitle")}</span>
            </div>
            <div className="confirm-body">
              <div className="dialog-hint">
                {t("dialogs.renameBranchHint", { name: branchAction.name })}
              </div>
              <input
                autoFocus
                className="dialog-input"
                type="text"
                value={branchActionInput}
                spellCheck={false}
                placeholder={t("dialogs.renameBranchPlaceholder")}
                onChange={(e) => setBranchActionInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleBranchActionSubmit();
                  if (e.key === "Escape") closeBranchAction();
                }}
              />
              {branchActionError && <div className="dialog-error">{branchActionError}</div>}
            </div>
            <div className="confirm-actions">
              <button
                className="confirm-btn confirm-btn-cancel"
                onClick={closeBranchAction}
                disabled={branchActionBusy}
              >
                {t("common.cancel")}
              </button>
              <button
                className="confirm-btn confirm-btn-primary"
                onClick={handleBranchActionSubmit}
                disabled={branchActionBusy || !branchActionInput.trim()}
              >
                {branchActionBusy ? t("common.processing") : t("dialogs.renameBtn")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 分支操作：合并 / 变基 / 删除 确认 ───────────────────── */}
      {branchAction && branchAction.type !== "rename" && (
        <ConfirmDialog
          title={
            branchAction.type === "merge"
              ? t("dialogs.mergeBranchTitle")
              : branchAction.type === "rebase"
                ? t("dialogs.rebaseBranchTitle")
                : t("dialogs.deleteBranchTitle")
          }
          message={
            branchAction.type === "merge"
              ? t("dialogs.mergeBranchMsg", { source: branchAction.name, target: repo.branch })
              : branchAction.type === "rebase"
                ? t("dialogs.rebaseBranchMsg", { source: repo.branch, target: branchAction.name })
                : t("dialogs.deleteBranchMsg", { name: branchAction.name })
          }
          confirmText={
            branchAction.type === "merge"
              ? t("common.merge")
              : branchAction.type === "rebase"
                ? t("common.rebase")
                : t("common.delete")
          }
          cancelText={t("common.cancel")}
          onConfirm={handleBranchActionSubmit}
          onCancel={closeBranchAction}
        />
      )}

      {/* ── 撤销上次提交确认 ─────────────────────────────────────── */}
      {confirmUndoCommit && (
        <ConfirmDialog
          title={t("dialogs.undoCommitTitle")}
          message={t("dialogs.undoCommitMsg")}
          confirmText={t("dialogs.undoCommitBtn")}
          cancelText={t("common.cancel")}
          onConfirm={handleUndoCommit}
          onCancel={() => setConfirmUndoCommit(false)}
        />
      )}

      {/* ── Cherry-pick 确认 ────────────────────────────────────── */}
      {cherryPickTarget && (
        <ConfirmDialog
          title={t("dialogs.cherryPickTitle")}
          message={t("dialogs.cherryPickMsg", {
            hash: cherryPickTarget.short_hash,
            subject: cherryPickTarget.subject || t("allChanges.noMessage"),
            branch: repo.branch,
          })}
          confirmText="Cherry-pick"
          cancelText={t("common.cancel")}
          onConfirm={handleCherryPickConfirm}
          onCancel={() => setCherryPickTarget(null)}
        />
      )}

      {/* ── 中止 Rebase / Cherry-pick 确认 ──────────────────────── */}
      {confirmAbortOperation && operationState?.in_progress && (
        <ConfirmDialog
          title={
            operationState.kind === "rebase"
              ? t("dialogs.abortRebaseTitle")
              : t("dialogs.abortCherryPickTitle")
          }
          message={t("dialogs.abortOperationMsg", {
            op: operationState.kind === "rebase" ? "Rebase" : "Cherry-pick",
          })}
          confirmText={t("dialogs.abortBtn")}
          cancelText={t("dialogs.continueResolveBtn")}
          onConfirm={handleAbortOperation}
          onCancel={() => setConfirmAbortOperation(false)}
        />
      )}
      </div>
    </div>
  );
}
