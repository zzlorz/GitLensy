import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  GitBranch, RotateCw, FolderSync, Terminal, MoreHorizontal, Tag, Archive, ArchiveRestore, Trash2,
  FileCode2, AlertTriangle, Loader2, GitCommit, Diff, Search, Settings, X,
  Download, Upload, ChevronDown, Check, ExternalLink,
} from "lucide-react";
import FileList from "../components/FileList";
import CommitList from "../components/CommitList";
import CommitDetail from "../components/CommitDetail";
import DiffViewer from "../components/DiffViewer";
import AllChangesView from "../components/AllChangesView";
import ConfirmDialog from "../components/ConfirmDialog";
import FilePreview from "../components/FilePreview";
import ProjectSidebar from "../components/ProjectSidebar";
import { WindowControls, WindowResizeHandles } from "../components/WindowControls";
import type { RepositoryInfo, GitStatus, ChangedFile, DiffView, FileDiff, CommitInfo, CommitFile, RecentRepo, SyncStatus, StashEntry, BranchList } from "../types";
import { getStatus, getFileDiff, saveCurrentRepo, getCommitLog, getCommitFiles, getCommitFileDiff, openTerminal, revertFile, stageFile, stageAll, discardAllUnstaged, commitChanges, getSyncStatus, syncChanges, pullChanges, fetchChanges, pushChanges, createBranch, createTag, stashChanges, getStashList, popStash, applyStash, dropStash, clearStashes, getBranches, checkoutBranch, openPath, getRecentRepos, openRepository, removeRecentRepo } from "../api/tauri";
import type { OpenMethod } from "../api/tauri";

const PAGE_SIZE = 50;

/** 打开方式选项与显示名 */
const OPEN_METHODS: { id: OpenMethod; label: string }[] = [
  { id: "editor", label: "VS Code" },
  { id: "explorer", label: "文件资源管理器" },
  { id: "system", label: "默认应用" },
];

/** Adapter so we can reuse DiffViewer for commit files */
function makeChangedFile(file: CommitFile) {
  return {
    path: file.path,
    old_path: file.old_path,
    status: file.status,
    staged_status: undefined,
    unstaged_status: undefined,
    additions: file.additions,
    deletions: file.deletions,
    is_binary: false,
    has_staged_changes: false,
    has_unstaged_changes: false,
  } as const;
}

interface Props {
  repo: RepositoryInfo;
  onCloseRepo: () => void;
  onRepoUpdate: (repo: RepositoryInfo) => void;
  onOpenSettings?: () => void;
}

type Tab = "changes" | "history";

export default function MainWorkspace({ repo, onCloseRepo, onRepoUpdate, onOpenSettings }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("changes");
  const [filter, setFilter] = useState("");

  const [recentRepos, setRecentRepos] = useState<RecentRepo[]>(getRecentRepos());

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

  // ── 打开方式下拉（一次性选择，不记录状态）──────────────────────────
  const [openMenuOpen, setOpenMenuOpen] = useState(false);
  const openMenuRef = useRef<HTMLDivElement>(null);

  // ── Changes tab state ─────────────────────────────────────────────────
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [selectedFile, setSelectedFile] = useState<ChangedFile | null>(null);
  /** 右侧内容区模式：diff = 单文件对比，file = 文件内容预览，all = 所有变更文件连续对比 */
  const [rightPanelMode, setRightPanelMode] = useState<"diff" | "file" | "all">("diff");
  const [diffView, setDiffView] = useState<DiffView>("unstaged");
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const diffRequestId = useRef(0);
  const diffCache = useRef<Map<string, FileDiff>>(new Map());
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
    setRightPanelMode("diff");
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
    setCommitFiles([]);
    setSelectedCommitFile(null);
    setCommitDiff(null);
    commitDiffCache.current.clear();

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

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await getStatus();
      setStatus(s);
      // 同步状态用于决定显示 Commit 还是 Sync Changes，失败时不影响主流程
      try {
        setSyncStatus(await getSyncStatus());
      } catch {
        setSyncStatus(null);
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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
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
      setDiff(null);
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

    // 注意：这里不使用缓存，每次 selectedFile 对象引用变化（刷新后）都重新请求最新 diff
    setDiffLoading(true);

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
  const [commitFiles, setCommitFiles] = useState<CommitFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);

  const [selectedCommitFile, setSelectedCommitFile] = useState<CommitFile | null>(null);
  const [commitDiff, setCommitDiff] = useState<FileDiff | null>(null);
  const [commitDiffLoading, setCommitDiffLoading] = useState(false);
  const [commitDiffError, setCommitDiffError] = useState<string | null>(null);

  const commitDiffRequestId = useRef(0);
  const commitDiffCache = useRef<Map<string, FileDiff>>(new Map());

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

  const handleSelectCommit = useCallback(async (commit: CommitInfo) => {
    if (selectedCommit?.hash === commit.hash) return;
    setSelectedFolderFile(null);
    setSelectedCommit(commit);
    setSelectedCommitFile(null);
    setCommitDiff(null);
    setCommitDiffError(null);
    setFilesLoading(true);
    setFilesError(null);
    try {
      const files = await getCommitFiles(commit.hash);
      setCommitFiles(files);
    } catch (e) {
      setFilesError(e instanceof Error ? e.message : String(e));
      setCommitFiles([]);
    } finally {
      setFilesLoading(false);
    }
  }, [selectedCommit]);

  const handleSelectCommitFile = useCallback(async (file: CommitFile) => {
    if (!selectedCommit) return;
    setSelectedCommitFile(file);
    setCommitDiffError(null);

    const cKey = `${selectedCommit.hash}:${file.path}`;
    const cached = commitDiffCache.current.get(cKey);
    if (cached) {
      setCommitDiff(cached);
      return;
    }

    const requestId = ++commitDiffRequestId.current;
    setCommitDiff(null);
    setCommitDiffLoading(true);
    try {
      const d = await getCommitFileDiff(selectedCommit.hash, file.path, file.old_path);
      if (requestId === commitDiffRequestId.current) {
        commitDiffCache.current.set(cKey, d);
        setCommitDiff(d);
      }
    } catch (e) {
      if (requestId === commitDiffRequestId.current) {
        setCommitDiffError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (requestId === commitDiffRequestId.current) {
        setCommitDiffLoading(false);
      }
    }
  }, [selectedCommit]);

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

  /** 第二步：用户在确认框点击"确认" → 执行实际的 git 撤销 */
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
      setRightPanelMode("diff");
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
      commitDiffCache.current.clear();
      // 同步刷新选中提交（保持选中，即使提交信息已变化）
      setSelectedCommit((prev) => (prev ? page.find((c) => c.hash === prev.hash) ?? prev : prev));
    } catch (e) {
      setLogError(e instanceof Error ? e.message : String(e));
    } finally {
      logLoadingRef.current = false;
      setLogLoading(false);
    }
  }, []);

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
      setToolError(toolAction === "branch" ? "请输入分支名称" : "请输入标签名称");
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
  }, [toolAction, toolBusy, toolInput, repo.path, onRepoUpdate, loadStatus, refreshHistory]);

  /** 提交暂存区内容 */
  const handleCommit = useCallback(async () => {
    const message = commitMessage.trim();
    if (!message || committing) return;
    setCommitting(true);
    setError(null);
    try {
      await commitChanges(message);
      setCommitMessage("");
      setSelectedFile(null);
      setDiff(null);
      setRightPanelMode("diff");
      await loadStatus();
      await refreshHistory();
      setFolderRefreshKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCommitting(false);
    }
  }, [commitMessage, committing, loadStatus, refreshHistory]);

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
  const handleAutoRefreshRef = useRef<() => void>(() => {});
  handleAutoRefreshRef.current = () => {
    const now = Date.now();
    // 短时间内重复触发（如快速切窗）时合并为一次
    if (now - lastAutoRefreshRef.current < 1200) return;
    lastAutoRefreshRef.current = now;

    loadStatusRef.current();
    refreshHistory();
    setFolderRefreshKey((k) => k + 1);
  };

  useEffect(() => {
    const handleFocus = () => handleAutoRefreshRef.current();
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, []);

  const changesCount = status ? status.staged.length + status.unstaged.length : 0;
  // 暂存区为空且本地领先远程时，主按钮切换为「同步到远程」
  const showSync = (syncStatus?.ahead ?? 0) > 0 && (status?.staged.length ?? 0) === 0;

  return (
    <div className="app-shell">
      <WindowResizeHandles />
      <WindowControls />

      <div className="app">
      <ProjectSidebar
        repos={recentRepos}
        currentRepoPath={repo.path}
        status={status}
        selectedPath={selectedFolderFile?.fullPath ?? null}
        refreshKey={folderRefreshKey}
        onSwitchRepo={handleOpenRecentRepo}
        onOpenFile={handleProjectFileClick}
        onOpenOther={handleOpenOtherRepo}
        onRemove={handleRemoveRecentRepo}
      />

      <div className="app-main">
      {/* ── Toolbar (clean, global actions only) ──────────────────── */}
      <div className="toolbar" data-tauri-drag-region>
        <div className="branch-switcher">
          <button
            type="button"
            className={`toolbar-branch-badge ${repo.is_detached ? "detached" : ""}`}
            onClick={toggleBranchMenu}
            disabled={branchBusy}
            title={repo.is_detached ? "Detached HEAD，点击切换分支" : `分支: ${repo.branch}，点击切换`}
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
              <div className="branch-menu-section">本地分支</div>
              {branches === null ? (
                <div className="branch-menu-loading">
                  <Loader2 size={12} className="spin" /> 正在读取分支...
                </div>
              ) : branches.local.length === 0 ? (
                <div className="branch-menu-empty">没有本地分支</div>
              ) : (
                branches.local.map((name) => {
                  const isCurrent = name === branches.current || (!branches.current && name === repo.branch);
                  return (
                    <button
                      key={`local:${name}`}
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
                      {isCurrent && <span className="branch-menu-tag">当前</span>}
                    </button>
                  );
                })
              )}

              <div className="branch-menu-section">远程分支</div>
              {branches === null ? null : branches.remote.length === 0 ? (
                <div className="branch-menu-empty">没有远程分支</div>
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
                      {hasLocal && <span className="branch-menu-tag subtle">本地已有</span>}
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
                ? `拉取远程变更 (Pull) · 落后 ${syncStatus.behind} 个提交`
                : "拉取远程变更 (Pull)"
            }
          >
            {remoteBusy === "pull" ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <Download size={14} />
            )}
            <span>拉取</span>
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
                ? "当前分支未关联远程分支，无法推送"
                : syncStatus && syncStatus.ahead === 0
                  ? "没有待推送的本地提交"
                  : syncStatus && syncStatus.ahead > 0
                    ? `推送本地提交 (Push) · 领先 ${syncStatus.ahead} 个提交`
                    : "推送本地提交 (Push)"
            }
          >
            {remoteBusy === "push" ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <Upload size={14} />
            )}
            <span>推送</span>
          </button>
          <button
            className="toolbar-btn"
            onClick={handleFetch}
            disabled={remoteBusy !== null}
            title="获取远程更新 (Fetch)"
          >
            {remoteBusy === "fetch" ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <RotateCw size={14} />
            )}
            <span>获取</span>
          </button>

          <div className="toolbar-menu-wrap">
            <button
              className="toolbar-btn"
              onClick={() => setToolMenuOpen((v) => !v)}
              title="更多 Git 操作"
              aria-haspopup="menu"
              aria-expanded={toolMenuOpen}
            >
              <MoreHorizontal size={14} />
              <span>更多</span>
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
                  <span>新建分支</span>
                </button>
                <button
                  type="button"
                  className="toolbar-menu-item"
                  role="menuitem"
                  onClick={() => openToolDialog("tag")}
                >
                  <Tag size={13} />
                  <span>新建标签</span>
                </button>
                <button
                  type="button"
                  className="toolbar-menu-item"
                  role="menuitem"
                  disabled={changesCount === 0}
                  title={changesCount === 0 ? "当前没有可贮藏的变更" : "贮藏当前所有变更"}
                  onClick={() => openToolDialog("stash")}
                >
                  <Archive size={13} />
                  <span>贮藏变更</span>
                </button>
                <button
                  type="button"
                  className="toolbar-menu-item"
                  role="menuitem"
                  title="查看并恢复已贮藏的变更"
                  onClick={() => openToolDialog("stashes")}
                >
                  <ArchiveRestore size={13} />
                  <span>贮藏列表 / 恢复</span>
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
              title="用 VS Code 打开当前项目"
            >
              <ExternalLink size={14} />
              <span>VS Code</span>
            </button>
            <button
              className={`toolbar-btn open-with-caret ${openMenuOpen ? "open" : ""}`}
              onClick={() => setOpenMenuOpen((v) => !v)}
              title="选择打开方式"
            >
              <ChevronDown size={12} />
            </button>

            {openMenuOpen && (
              <div className="open-with-menu">
                <div className="open-with-menu-title">打开方式</div>
                {OPEN_METHODS.map((item) => (
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
            title="在当前仓库根目录打开 PowerShell"
          >
            <Terminal size={14} />
            <span>终端</span>
          </button>
          {onOpenSettings && (
            <button
              className="toolbar-btn"
              onClick={onOpenSettings}
              title="应用设置 (修改主题等)"
            >
              <Settings size={14} />
              <span>设置</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Main Layout ─────────────────────────────────────────── */}
      <div className="main-content">
        {/* ── Sidebar (Column 1) ─────────────────────────────────── */}
        <div className="sidebar">
          {/* Top of Sidebar: Mode B (Tabs on top, Search box immediately below) */}
          <div className="sidebar-tabs-container">
            <div className="sidebar-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "changes"}
                className={`sidebar-tab ${activeTab === "changes" ? "active" : ""}`}
                onClick={() => {
                  setActiveTab("changes");
                  setFilter("");
                }}
              >
                <span>变更</span>
                {changesCount > 0 && (
                  <span className="sidebar-tab-badge">{changesCount}</span>
                )}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "history"}
                className={`sidebar-tab ${activeTab === "history" ? "active" : ""}`}
                onClick={() => {
                  setActiveTab("history");
                  setFilter("");
                }}
              >
                <span>历史</span>
              </button>
            </div>
          </div>

          {/* 变更 tab：提交信息输入 + 提交按钮；其他 tab：搜索框 */}
          {activeTab === "changes" ? (
            showSync ? (
              <div className="sidebar-commit">
                <div className="sidebar-commit-hint">
                  {syncStatus && syncStatus.behind > 0
                    ? `本地领先 ${syncStatus.ahead} 个提交，落后 ${syncStatus.behind} 个提交`
                    : `本地领先远程 ${syncStatus?.ahead ?? 0} 个提交`}
                </div>
                <button
                  type="button"
                  className="sidebar-commit-btn"
                  onClick={handleSync}
                  disabled={syncing}
                  title="同步到远程仓库 (Sync Changes)"
                >
                  <FolderSync size={14} />
                  <span>{syncing ? "同步中..." : "Sync Changes 同步"}</span>
                </button>
              </div>
            ) : (
              <div className="sidebar-commit">
                <textarea
                  className="sidebar-commit-input"
                  placeholder="提交信息 (Commit message)"
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  rows={2}
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="sidebar-commit-btn"
                  onClick={handleCommit}
                  disabled={
                    !commitMessage.trim() || committing || (status?.staged.length ?? 0) === 0
                  }
                  title={
                    (status?.staged.length ?? 0) === 0
                      ? "请先暂存变更后再提交"
                      : "提交暂存区内容 (Commit)"
                  }
                >
                  <GitCommit size={14} />
                  <span>{committing ? "提交中..." : "Commit 提交"}</span>
                </button>
              </div>
            )
          ) : (
            <div className="sidebar-search">
              <Search size={14} className="sidebar-search-icon" />
              <input
                type="text"
                className="sidebar-search-input"
                placeholder="搜索提交记录、作者、哈希..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
          )}

          {/* Sidebar Body */}
          {activeTab === "changes" && (
            <>
              {error && <div className="error-message">{error}</div>}
              {loading && !status && (
                <div className="loading" style={{ padding: 24 }}>
                  <div className="loading-spinner" />
                  <span>正在获取仓库状态...</span>
                </div>
              )}
              {status && (
                <FileList
                  status={status}
                  selectedPath={selectedFile?.path || null}
                  onSelect={handleSelectChangedFile}
                  onRevert={handleRevert}
                  onStage={handleStage}
                  onUnstage={handleUnstage}
                  onPreview={handlePreviewChangedFile}
                  onOpenAllChanges={handleOpenAllChanges}
                  onStageAll={handleStageAll}
                  onDiscardAll={() => setConfirmDiscardAll(true)}
                />
              )}
            </>
          )}

          {activeTab === "history" && (
            <>
              {logError && <div className="error-message">{logError}</div>}
              <CommitList
                commits={filteredCommits}
                selectedHash={selectedCommit?.hash ?? null}
                loading={logLoading}
                hasMore={hasMore && !filter.trim()}
                onSelect={handleSelectCommit}
                onLoadMore={loadMoreCommits}
              />
            </>
          )}
        </div>

        {/* ── Content Area: Changes Mode vs History Mode ─────────── */}
        {activeTab === "changes" && !selectedFolderFile && (
          <div className="diff-viewer">
            {rightPanelMode === "all" && status && <AllChangesView status={status} />}

            {!selectedFile && rightPanelMode !== "all" && (
              <div className="empty-state">
                <div className="empty-state-icon-wrapper">
                  <FileCode2 size={32} strokeWidth={1.5} />
                </div>
                <div className="empty-state-text">选择一个变更文件以查看 Diff</div>
                <div className="empty-state-sub">支持工作区与暂存区对比</div>
              </div>
            )}

            {selectedFile && rightPanelMode === "file" && (
              <div className="changes-file-preview">
                <div className="changes-file-preview-bar">
                  <button
                    type="button"
                    className="changes-file-preview-switch"
                    onClick={() => setRightPanelMode("diff")}
                  >
                    <Diff size={13} />
                    <span>查看变更对比</span>
                  </button>
                </div>
                <FilePreview
                  fullPath={selectedFileFullPath}
                  relPath={selectedFile.path}
                  change={selectedFile}
                />
              </div>
            )}

            {selectedFile && rightPanelMode === "diff" && diffLoading && (
              <div className="diff-loading">
                <Loader2 size={13} className="spin" />
                <span>正在读取 Diff...</span>
              </div>
            )}

            {selectedFile && rightPanelMode === "diff" && !diffLoading && diffError && (
              <div className="empty-state">
                <div className="empty-state-icon-wrapper" style={{ color: "var(--error-color)" }}>
                  <AlertTriangle size={32} strokeWidth={1.5} />
                </div>
                <div className="empty-state-text">Diff 加载失败</div>
                <div style={{ fontSize: 12, color: "var(--error-color)", maxWidth: 400, textAlign: "center" }}>
                  {diffError}
                </div>
              </div>
            )}

            {selectedFile && rightPanelMode === "diff" && !diffError && diff && (
              <DiffViewer
                diff={diff}
                file={selectedFile}
                view={diffView}
                onViewChange={setDiffView}
                repoPath={repo.path}
              />
            )}
          </div>
        )}

        {activeTab === "history" && !selectedFolderFile && (
          <div className="history-main-content">
            {/* Column 2 in History Mode: Commit details & changed files */}
            <div className="history-detail-panel">
              {!selectedCommit ? (
                <div className="empty-state">
                  <div className="empty-state-icon-wrapper">
                    <GitCommit size={32} strokeWidth={1.5} />
                  </div>
                  <div className="empty-state-text">选择一条提交记录</div>
                  <div className="empty-state-sub">查看该次提交的变更文件与信息</div>
                </div>
              ) : (
                <CommitDetail
                  commit={selectedCommit}
                  files={commitFiles}
                  filesLoading={filesLoading}
                  filesError={filesError}
                  selectedFilePath={selectedCommitFile?.path ?? null}
                  diff={commitDiff}
                  diffLoading={commitDiffLoading}
                  diffError={commitDiffError}
                  onSelectFile={handleSelectCommitFile}
                />
              )}
            </div>

            {/* Column 3 in History Mode: Diff viewer */}
            <div className="history-diff-panel">
              {!selectedCommitFile ? (
                <div className="empty-state">
                  <div className="empty-state-icon-wrapper">
                    <FileCode2 size={32} strokeWidth={1.5} />
                  </div>
                  <div className="empty-state-text">选择一个文件查看 Diff</div>
                  <div className="empty-state-sub">查看该文件在本次提交中的改动</div>
                </div>
              ) : (
                <>
                  {commitDiffLoading && (
                    <div className="diff-loading">
                      <Loader2 size={13} className="spin" />
                      <span>正在读取 Diff...</span>
                    </div>
                  )}
                  {!commitDiffLoading && commitDiff && (
                    <DiffViewer
                      diff={commitDiff}
                      file={makeChangedFile(selectedCommitFile) as any}
                      view="unstaged"
                      onViewChange={() => {}}
                      contextLabel="本次提交的改动"
                    />
                  )}
                  {!commitDiffLoading && commitDiffError && (
                    <div className="empty-state" style={{ padding: 32 }}>
                      <div style={{ color: "var(--error-color)", fontSize: 13 }}>{commitDiffError}</div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {selectedFolderFile && (
          <div className="diff-viewer">
            <div className="changes-file-preview-bar">
              <span className="preview-file-path" title={selectedFolderFile.relPath}>
                {selectedFolderFile.relPath}
              </span>
              <button
                type="button"
                className="changes-file-preview-switch"
                onClick={() => setSelectedFolderFile(null)}
                title="关闭预览"
              >
                <X size={13} />
                <span>关闭</span>
              </button>
            </div>
            <FilePreview
              fullPath={selectedFolderFile.fullPath}
              relPath={selectedFolderFile.relPath}
              change={selectedFolderChange}
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
                  ? "新建分支"
                  : toolAction === "tag"
                    ? "新建标签"
                    : toolAction === "stash"
                      ? "贮藏变更"
                      : "贮藏列表"}
              </span>
            </div>
            {toolAction === "stashes" ? (
              <div className="confirm-body">
                <div className="dialog-hint">
                  选择一条贮藏记录恢复（pop），恢复后该记录会从列表中移除。
                </div>
                {toolBusy && stashes.length === 0 ? (
                  <div className="stash-empty">
                    <Loader2 size={14} className="spin" /> 正在读取贮藏记录...
                  </div>
                ) : stashes.length === 0 ? (
                  <div className="stash-empty">当前没有贮藏记录</div>
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
                            title="应用贮藏，保留该记录 (git stash apply)"
                            onClick={() => handleApplyStash(entry.index, true)}
                          >
                            应用
                          </button>
                          <button
                            type="button"
                            className="stash-action-btn primary"
                            disabled={toolBusy}
                            title="应用贮藏并删除该记录 (git stash pop)"
                            onClick={() => handleApplyStash(entry.index, false)}
                          >
                            <ArchiveRestore size={11} />
                            恢复
                          </button>
                          <button
                            type="button"
                            className="stash-action-btn danger"
                            disabled={toolBusy}
                            title="删除该贮藏记录，不应用到工作区 (git stash drop)"
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
                    ? "将基于当前提交创建新分支并立即切换过去。"
                    : toolAction === "tag"
                      ? "将在当前提交上创建标签。名称重复或仓库尚无提交时会失败。"
                      : "将贮藏当前所有变更（含未跟踪文件），并清空工作区。"}
                </div>
                <input
                  autoFocus
                  className="dialog-input"
                  type="text"
                  value={toolInput}
                  spellCheck={false}
                  placeholder={
                    toolAction === "branch"
                      ? "分支名称，例如 feature/login"
                      : toolAction === "tag"
                        ? "标签名称，例如 v1.0.0"
                        : "贮藏说明（可选）"
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
                  清空全部
                </button>
              )}
              <button className="confirm-btn confirm-btn-cancel" onClick={closeToolDialog} disabled={toolBusy}>
                {toolAction === "stashes" ? "关闭" : "取消"}
              </button>
              {toolAction !== "stashes" && (
                <button
                  className="confirm-btn confirm-btn-primary"
                  onClick={handleToolSubmit}
                  disabled={toolBusy || (toolAction !== "stash" && !toolInput.trim())}
                >
                  {toolBusy
                    ? "处理中..."
                    : toolAction === "branch"
                      ? "创建并切换"
                      : toolAction === "tag"
                        ? "创建标签"
                        : "贮藏"}
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
          scope === "unstaged" ? "工作区修改"
          : scope === "staged" ? "暂存区修改"
          : "所有修改（暂存区 + 工作区）";
        return (
          <ConfirmDialog
            title="确认撤销"
            message={`确定要撤销以下文件的${scopeLabel}吗？\n\n${file.path}\n\n此操作不可恢复。`}
            confirmText="撤销"
            cancelText="取消"
            onConfirm={handleRevertConfirm}
            onCancel={() => setRevertPending(null)}
          />
        );
      })()}
      {confirmDiscardAll && (
        <ConfirmDialog
          title="确认放弃所有工作区修改"
          message={
            "将把所有已跟踪文件恢复为暂存区内容，并删除所有未跟踪文件（遵循 .gitignore）。\n\n此操作不可恢复。"
          }
          confirmText="全部放弃"
          cancelText="取消"
          onConfirm={handleDiscardAllConfirm}
          onCancel={() => setConfirmDiscardAll(false)}
        />
      )}
      {stashConfirm && (
        <ConfirmDialog
          title={stashConfirm.type === "clear" ? "确认清空全部贮藏" : "确认删除贮藏记录"}
          message={
            stashConfirm.type === "clear"
              ? `将删除全部 ${stashes.length} 条贮藏记录，且不会应用到工作区。\n\n此操作不可恢复。`
              : `将删除 ${stashes.find((s) => s.index === stashConfirm.index)?.ref_name ?? `stash@{${stashConfirm.index}}`}，且不会应用到工作区。\n\n此操作不可恢复。`
          }
          confirmText={stashConfirm.type === "clear" ? "清空全部" : "删除"}
          cancelText="取消"
          onConfirm={handleStashDelete}
          onCancel={() => setStashConfirm(null)}
        />
      )}
      </div>
    </div>
  );
}
