import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  GitBranch, RefreshCw, FolderSync, Terminal, ChevronDown,
  FileCode2, AlertTriangle, Loader2, GitCommit, Diff, Search, Settings, FolderOpen, X,
} from "lucide-react";
import FileList from "../components/FileList";
import CommitList from "../components/CommitList";
import CommitDetail from "../components/CommitDetail";
import DiffViewer from "../components/DiffViewer";
import AllChangesView from "../components/AllChangesView";
import ConfirmDialog from "../components/ConfirmDialog";
import FolderTree from "../components/FolderTree";
import FilePreview from "../components/FilePreview";
import RepoAvatar from "../components/RepoAvatar";
import type { RepositoryInfo, GitStatus, ChangedFile, DiffView, FileDiff, CommitInfo, CommitFile, RecentRepo, SyncStatus } from "../types";
import { getStatus, getFileDiff, saveCurrentRepo, getCommitLog, getCommitFiles, getCommitFileDiff, openTerminal, revertFile, stageFile, stageAll, discardAllUnstaged, commitChanges, getSyncStatus, syncChanges, getRecentRepos, openRepository, removeRecentRepo } from "../api/tauri";

const PAGE_SIZE = 50;

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

type Tab = "changes" | "history" | "folders";

export default function MainWorkspace({ repo, onCloseRepo, onRepoUpdate, onOpenSettings }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("changes");
  const [filter, setFilter] = useState("");

  // ── Repo switcher dropdown ─────────────────────────────────────────────
  const [repoMenuOpen, setRepoMenuOpen] = useState(false);
  const [recentRepos, setRecentRepos] = useState<RecentRepo[]>(getRecentRepos());
  const repoMenuRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭下拉菜单
  useEffect(() => {
    if (!repoMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (repoMenuRef.current && !repoMenuRef.current.contains(e.target as Node)) {
        setRepoMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [repoMenuOpen]);

  const refreshRecentRepos = useCallback(() => {
    setRecentRepos(getRecentRepos());
  }, []);

  const handleOpenRecentRepo = useCallback(async (path: string) => {
    setRepoMenuOpen(false);
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

  const handleRemoveRecent = useCallback((e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    removeRecentRepo(path);
    refreshRecentRepos();
  }, [refreshRecentRepos]);

  const handleOpenOtherRepo = useCallback(() => {
    setRepoMenuOpen(false);
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

  /** 文件夹 tab 中点击文件：直接在右侧独立预览（不走 Git Diff） */
  const handleFolderFileSelect = useCallback((fullPath: string, relPath: string) => {
    setSelectedFolderFile({ fullPath, relPath });
  }, []);

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
    setSelectedFile(file);
    setRightPanelMode("diff");
  }, []);

  /** 悬停"打开文件"：右侧按文件夹目录的预览方式展示文件内容 */
  const handlePreviewChangedFile = useCallback((file: ChangedFile) => {
    setSelectedFile(file);
    setRightPanelMode("file");
  }, []);

  /** 预览所有变更文件：按文件顺序从上到下连续对比 */
  const handleOpenAllChanges = useCallback(() => {
    setRightPanelMode("all");
  }, []);

  const selectedFileFullPath = useMemo(() => {
    if (!selectedFile) return "";
    const base = repo.path.replace(/\\/g, "/").replace(/\/+$/, "");
    return `${base}/${selectedFile.path.replace(/\\/g, "/")}`;
  }, [repo.path, selectedFile]);

  const handleRefresh = useCallback(() => {
    if (activeTab === "changes") {
      loadStatus();
    } else if (activeTab === "folders") {
      // 文件夹页：同时刷新变更标注和目录树
      loadStatus();
      setFolderRefreshKey((k) => k + 1);
    } else {
      // Reload history
      offsetRef.current = 0;
      hasMoreRef.current = true;
      setCommits([]);
      setHasMore(true);
      setLogError(null);
      commitDiffCache.current.clear();
      setSelectedCommit(null);
      setSelectedCommitFile(null);
      setCommitDiff(null);
      loadMoreCommits();
    }
  }, [activeTab, loadStatus, loadMoreCommits]);

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

  const handleSwitchRepo = useCallback(() => {
    onCloseRepo();
  }, [onCloseRepo]);

  const repoName = repo.name || repo.path.split(/[\\\/]/).pop() || repo.path;
  const changesCount = status ? status.staged.length + status.unstaged.length : 0;
  // 暂存区为空且本地领先远程时，主按钮切换为「同步到远程」
  const showSync = (syncStatus?.ahead ?? 0) > 0 && (status?.staged.length ?? 0) === 0;

  return (
    <div className="app">
      {/* ── Toolbar (clean, global actions only) ──────────────────── */}
      <div className="toolbar">
        {/* 仓库切换器：点击展开最近仓库列表 */}
        <div className="repo-switcher" ref={repoMenuRef}>
          <button
            className={`toolbar-repo-badge ${repoMenuOpen ? "open" : ""}`}
            onClick={() => setRepoMenuOpen((v) => !v)}
            title={repo.path}
          >
            <RepoAvatar repoName={repoName} repoPath={repo.path} size={16} />
            <span className="toolbar-repo-name">{repoName}</span>
            <ChevronDown
              size={13}
              style={{ flexShrink: 0, opacity: 0.6, transition: "transform 0.15s", transform: repoMenuOpen ? "rotate(180deg)" : "none" }}
            />
          </button>

          {repoMenuOpen && (
            <div className="repo-switcher-dropdown">
              <div className="repo-switcher-section-title">最近打开</div>
              {recentRepos.length === 0 ? (
                <div className="repo-switcher-empty">暂无最近仓库</div>
              ) : (
                recentRepos.map((r) => (
                  <div
                    key={r.path}
                    className={`repo-switcher-item ${r.path === repo.path ? "current" : ""}`}
                    onClick={() => r.path !== repo.path && handleOpenRecentRepo(r.path)}
                    title={r.path}
                  >
                    <RepoAvatar repoName={r.name} repoPath={r.path} size={18} />
                    <div className="repo-switcher-item-info">
                      <div className="repo-switcher-item-name">{r.name}</div>
                      <div className="repo-switcher-item-path">{r.path}</div>
                    </div>
                    {r.path === repo.path && (
                      <span className="repo-switcher-current-tag">当前</span>
                    )}
                    <button
                      className="repo-switcher-remove"
                      onClick={(e) => handleRemoveRecent(e, r.path)}
                      title="从最近列表移除"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))
              )}
              <div className="repo-switcher-divider" />
              <button className="repo-switcher-other" onClick={handleOpenOtherRepo}>
                <FolderOpen size={14} />
                <span>打开其他仓库...</span>
              </button>
            </div>
          )}
        </div>

        <div
          className={`toolbar-branch-badge ${repo.is_detached ? "detached" : ""}`}
          title={repo.is_detached ? "Detached HEAD" : `分支: ${repo.branch}`}
        >
          <GitBranch size={13} style={{ flexShrink: 0 }} />
          <span>{repo.is_detached ? "Detached HEAD" : repo.branch}</span>
        </div>

        <div className="toolbar-spacer" />

        <div className="toolbar-actions">
          <button
            className="toolbar-btn"
            onClick={handleRefresh}
            disabled={activeTab === "changes" ? loading : logLoading}
            title={activeTab === "changes" ? "刷新仓库变更状态" : "刷新提交记录"}
          >
            <RefreshCw size={14} className={(activeTab === "changes" ? loading : logLoading) ? "spin" : ""} />
            <span>刷新</span>
          </button>
          <button
            className="toolbar-btn"
            onClick={handleOpenTerminal}
            title="在当前仓库根目录打开 PowerShell"
          >
            <Terminal size={14} />
            <span>终端</span>
          </button>
          <button
            className="toolbar-btn"
            onClick={handleSwitchRepo}
            title="切换或打开其他仓库"
          >
            <FolderSync size={14} />
            <span>切换仓库</span>
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
                <Diff size={14} />
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
                <GitCommit size={14} />
                <span>历史</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "folders"}
                className={`sidebar-tab ${activeTab === "folders" ? "active" : ""}`}
                onClick={() => {
                  setActiveTab("folders");
                  setFilter("");
                }}
              >
                <FolderOpen size={14} />
                <span>文件夹</span>
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
                placeholder={
                  activeTab === "folders" ? "搜索文件或目录..." : "搜索提交记录、作者、哈希..."
                }
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

          {activeTab === "folders" && (
            <FolderTree
              repoPath={repo.path}
              filter={filter}
              status={status}
              refreshKey={folderRefreshKey}
              onSelectFile={handleFolderFileSelect}
              selectedPath={selectedFolderFile?.fullPath ?? null}
            />
          )}
        </div>

        {/* ── Content Area: Changes Mode vs History Mode ─────────── */}
        {activeTab === "changes" && (
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
              />
            )}
          </div>
        )}

        {activeTab === "history" && (
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

        {activeTab === "folders" && (
          <div className="diff-viewer">
            {!selectedFolderFile ? (
              <div className="empty-state">
                <div className="empty-state-icon-wrapper">
                  <FolderOpen size={32} strokeWidth={1.5} />
                </div>
                <div className="empty-state-text">浏览目录结构</div>
                <div className="empty-state-sub">左侧文件夹树支持展开折叠、搜索过滤，点击文件即可预览</div>
              </div>
            ) : (
              <FilePreview
                fullPath={selectedFolderFile.fullPath}
                relPath={selectedFolderFile.relPath}
                change={selectedFolderChange}
              />
            )}
          </div>
        )}
      </div>

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
    </div>
  );
}
