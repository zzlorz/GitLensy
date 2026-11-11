import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { readDir, type DirEntry } from "@tauri-apps/plugin-fs";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  FileText,
  FileCode,
  FileCode2,
  FileJson,
  FileSpreadsheet,
  FileCog,
  FileTerminal,
  FileArchive,
  Image as FileImageIcon,
  ExternalLink,
  Copy,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { openPath } from "../api/tauri";
import type { GitStatus, ChangedFile, FileStatus } from "../types";
import { useI18n } from "../i18n";

interface TreeNode {
  name: string;
  path: string;            // 相对于仓库根目录的路径 (正斜杠)
  fullPath: string;        // 绝对路径 (正斜杠)
  isDirectory: boolean;
  children?: TreeNode[];
}

interface Props {
  repoPath: string;
  filter: string;
  status: GitStatus | null;
  /** 数值递增时重新扫描目录树（保留当前展开状态） */
  refreshKey?: number;
  onSelectFile: (fullPath: string, relPath: string) => void;
  selectedPath: string | null;
}

const EXCLUDED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "target",
  ".next",
  ".cache",
  ".idea",
  ".vscode",
  "__pycache__",
  ".turbo",
]);

/** 统一路径分隔符为 `/` */
function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

/** 安全拼接路径 */
function joinPath(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  return `${a}/${b}`;
}

/** 依扩展名映射专属图标与色彩，极大提升文件列表可读性 */
function getFileIconInfo(fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  switch (ext) {
    case "ts":
    case "tsx":
      return { Icon: FileCode, color: "#3178c6" }; // TS Blue
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return { Icon: FileCode, color: "#e5a524" }; // JS Yellow
    case "json":
      return { Icon: FileJson, color: "#e06c75" }; // JSON Coral
    case "css":
    case "scss":
    case "sass":
    case "less":
      return { Icon: FileCode2, color: "#c586c0" }; // CSS Purple
    case "html":
    case "htm":
    case "xml":
    case "svg":
      return { Icon: FileCode, color: "#e34c26" }; // HTML Orange
    case "md":
    case "markdown":
    case "txt":
      return { Icon: FileText, color: "#58a6ff" }; // Doc Cyan
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
    case "ico":
    case "bmp":
      return { Icon: FileImageIcon, color: "#a371f7" }; // Image Violet
    case "sh":
    case "bash":
    case "zsh":
    case "bat":
    case "cmd":
    case "ps1":
      return { Icon: FileTerminal, color: "#3fb950" }; // Terminal Green
    case "zip":
    case "tar":
    case "gz":
    case "7z":
    case "rar":
      return { Icon: FileArchive, color: "#d7ba7d" }; // Archive Brown
    case "env":
    case "gitignore":
    case "gitattributes":
    case "yaml":
    case "yml":
    case "toml":
    case "ini":
    case "cfg":
    case "conf":
    case "lock":
      return { Icon: FileCog, color: "#8b949e" }; // Config Gray
    case "csv":
    case "xlsx":
    case "xls":
      return { Icon: FileSpreadsheet, color: "#238636" };
    default:
      return { Icon: FileText, color: "var(--text-muted)" };
  }
}

/** 递归构建目录树 —— 单个子目录扫描失败不会中断整棵树 */
async function buildTree(absPath: string, basePath: string, depth: number = 0): Promise<TreeNode[]> {
  // 防止过深递归
  if (depth > 20) return [];

  let entries: DirEntry[];
  try {
    entries = await readDir(absPath);
  } catch {
    // 权限或其他错误，跳过该目录
    return [];
  }

  const dirNodes: TreeNode[] = [];
  const fileNodes: TreeNode[] = [];

  for (const entry of entries) {
    const name = entry.name;
    if (EXCLUDED_DIRS.has(name)) continue;

    const entryRelPath = basePath ? joinPath(basePath, name) : name;
    const entryAbsPath = joinPath(absPath, name);

    if (entry.isDirectory) {
      const children = await buildTree(entryAbsPath, entryRelPath, depth + 1);
      dirNodes.push({
        name,
        path: entryRelPath,
        fullPath: entryAbsPath,
        isDirectory: true,
        children,
      });
    } else if (entry.isFile) {
      fileNodes.push({
        name,
        path: entryRelPath,
        fullPath: entryAbsPath,
        isDirectory: false,
      });
    }
  }

  // 目录在前，文件在后，各自按名称排序
  dirNodes.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  fileNodes.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  return [...dirNodes, ...fileNodes];
}

/** 从 GitStatus 构建 path -> ChangedFile 的映射 (key 为相对路径) */
function buildStatusMap(status: GitStatus | null): Map<string, ChangedFile> {
  const map = new Map<string, ChangedFile>();
  if (!status) return map;
  // staged 优先
  for (const f of status.staged) map.set(f.path, f);
  for (const f of status.unstaged) {
    if (!map.has(f.path)) map.set(f.path, f);
  }
  return map;
}

/** 递归检查节点或其后代是否匹配过滤条件 */
function nodeMatchesRecursive(node: TreeNode, q: string): boolean {
  if (node.path.toLowerCase().includes(q)) return true;
  if (node.isDirectory && node.children) {
    return node.children.some((c) => nodeMatchesRecursive(c, q));
  }
  return false;
}

function FileStatusBadge({ statusInfo }: { statusInfo: ChangedFile }) {
  const displayStatus: FileStatus = statusInfo.staged_status || statusInfo.unstaged_status || statusInfo.status;
  const badgeMap: Record<FileStatus, { text: string; className: string }> = {
    modified: { text: "M", className: "badge-modified" },
    added: { text: "A", className: "badge-added" },
    deleted: { text: "D", className: "badge-deleted" },
    renamed: { text: "R", className: "badge-renamed" },
    copied: { text: "C", className: "badge-renamed" },
    conflict: { text: "!", className: "badge-conflict" },
    untracked: { text: "U", className: "badge-untracked" },
    ignored: { text: "I", className: "badge-modified" },
    unchanged: { text: "•", className: "badge-modified" },
  };
  const info = badgeMap[displayStatus] || badgeMap.modified;
  return (
    <span className={`file-badge ${info.className} folder-tree-badge`}>
      {info.text}
    </span>
  );
}

function TreeNodeView({
  node,
  depth,
  expanded,
  onToggle,
  statusMap,
  filter,
  selectedPath,
  onSelectFile,
  onContextMenu,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  statusMap: Map<string, ChangedFile>;
  filter: string;
  selectedPath: string | null;
  onSelectFile: (fullPath: string, relPath: string) => void;
  onContextMenu: (e: React.MouseEvent, node: TreeNode) => void;
}) {
  const isExpanded = expanded.has(node.path);
  const statusInfo = node.isDirectory ? null : statusMap.get(node.path);

  const q = filter.trim().toLowerCase();
  if (q && !nodeMatchesRecursive(node, q)) return null;

  const indent = { paddingLeft: `${depth * 14 + 6}px` };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (node.isDirectory) {
      onToggle(node.path);
    } else {
      onSelectFile(node.fullPath, node.path);
    }
  };

  const isSelected = selectedPath === node.fullPath;
  const { Icon: FileIconComponent, color: fileIconColor } = getFileIconInfo(node.name);

  // 文件变更状态对应的文本颜色类名
  const labelStatusClass = statusInfo
    ? `status-${statusInfo.staged_status || statusInfo.unstaged_status || statusInfo.status}`
    : "";

  return (
    <>
      <div
        className={`folder-tree-node ${isSelected ? "selected" : ""} ${node.isDirectory ? "dir" : "file"}`}
        style={indent}
        onClick={handleClick}
        onContextMenu={(e) => onContextMenu(e, node)}
        title={node.path}
      >
        {/* 层级对齐指引虚线 */}
        {depth > 0 &&
          Array.from({ length: depth }).map((_, i) => (
            <span
              key={i}
              className="folder-tree-indent-guide"
              style={{ left: `${i * 14 + 11}px` }}
            />
          ))}

        {node.isDirectory ? (
          isExpanded ? (
            <ChevronDown size={13} className="folder-tree-arrow" />
          ) : (
            <ChevronRight size={13} className="folder-tree-arrow" />
          )
        ) : (
          <span className="folder-tree-arrow-placeholder" />
        )}

        {node.isDirectory ? (
          isExpanded ? (
            <FolderOpen size={14} className="folder-tree-icon folder-icon" />
          ) : (
            <Folder size={14} className="folder-tree-icon folder-icon" />
          )
        ) : (
          <FileIconComponent
            size={14}
            className="folder-tree-icon file-icon"
            style={{ color: fileIconColor }}
          />
        )}

        <span className={`folder-tree-label ${labelStatusClass}`}>{node.name}</span>

        {!node.isDirectory && statusInfo && <FileStatusBadge statusInfo={statusInfo} />}
      </div>

      {node.isDirectory && isExpanded && node.children && (
        <div className="folder-tree-children">
          {node.children.map((child) => (
            <TreeNodeView
              key={child.path}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              statusMap={statusMap}
              filter={filter}
              selectedPath={selectedPath}
              onSelectFile={onSelectFile}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </>
  );
}

export default function FolderTree({
  repoPath,
  filter,
  status,
  refreshKey = 0,
  onSelectFile,
  selectedPath,
}: Props) {
  const { t } = useI18n();
  const [tree, setTree] = useState<TreeNode[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    node: TreeNode;
  } | null>(null);
  const loadedRepoRef = useRef<string | null>(null);

  const statusMap = useMemo(() => buildStatusMap(status), [status]);

  const loadTree = useCallback(async (force: boolean) => {
    if (!force && loadedRepoRef.current === repoPath && tree) return;

    setLoading(true);
    setError(null);
    try {
      const normalizedPath = normalizePath(repoPath);
      if (!normalizedPath) {
        setError(t("projectSidebar.repoPathEmpty"));
        setTree([]);
        return;
      }
      const nodes = await buildTree(normalizedPath, "");
      setTree(nodes);
      loadedRepoRef.current = repoPath;
      // 首次加载默认全部折叠；强制刷新时保留用户已有的展开状态
      if (!force) setExpanded(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setTree([]);
    } finally {
      setLoading(false);
    }
  }, [repoPath, tree]);

  useEffect(() => {
    loadTree(false);
  }, [loadTree]);

  // 外部触发（窗口回到顶层 / 主动刷新）时重新扫描目录
  const lastRefreshKeyRef = useRef(refreshKey);
  useEffect(() => {
    if (lastRefreshKeyRef.current === refreshKey) return;
    lastRefreshKeyRef.current = refreshKey;
    loadTree(true);
  }, [refreshKey, loadTree]);

  // 全局关闭右键菜单
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("click", handleClick);
    window.addEventListener("contextmenu", handleClick);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("click", handleClick);
      window.removeEventListener("contextmenu", handleClick);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  const handleContextMenu = useCallback((e: React.MouseEvent, node: TreeNode) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: Math.min(e.clientX, window.innerWidth - 240),
      y: Math.min(e.clientY, window.innerHeight - 200),
      node,
    });
  }, []);

  const handleToggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  // 搜索时自动展开匹配节点的父链
  useEffect(() => {
    if (!filter.trim() || !tree) return;
    const q = filter.toLowerCase();
    const newExpanded = new Set<string>();

    function collectPaths(nodes: TreeNode[] | undefined) {
      if (!nodes) return;
      for (const node of nodes) {
        if (node.isDirectory) {
          const selfMatch = node.path.toLowerCase().includes(q);
          const childMatch = node.children && node.children.some((c) => nodeMatchesRecursive(c, q));
          if (selfMatch || childMatch) {
            newExpanded.add(node.path);
          }
          collectPaths(node.children);
        }
      }
    }
    collectPaths(tree);
    setExpanded((prev) => {
      const merged = new Set(prev);
      for (const p of newExpanded) merged.add(p);
      return merged;
    });
  }, [filter, tree]);

  if (loading && !tree) {
    return (
      <div className="folder-tree-loading">
        <Loader2 size={13} className="spin" />
        <span>{t("projectSidebar.scanningTree")}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="folder-tree-error">
        <AlertCircle size={14} />
        <span>{error}</span>
      </div>
    );
  }

  const q = filter.trim().toLowerCase();
  const hasFilter = q.length > 0;
  const anyMatch = hasFilter && tree ? tree.some((n) => nodeMatchesRecursive(n, q)) : true;

  if (hasFilter && !anyMatch) {
    return (
      <div className="folder-tree-empty">
        <span>{t("projectSidebar.noMatchingFiles")}</span>
      </div>
    );
  }

  return (
    <div className="folder-tree">
      {tree &&
        tree.map((node) => (
          <TreeNodeView
            key={node.path}
            node={node}
            depth={0}
            expanded={expanded}
            onToggle={handleToggle}
            statusMap={statusMap}
            filter={filter}
            selectedPath={selectedPath}
            onSelectFile={onSelectFile}
            onContextMenu={handleContextMenu}
          />
        ))}
      {tree && tree.length === 0 && !hasFilter && (
        <div className="folder-tree-empty">
          <span>{t("projectSidebar.directoryEmpty")}</span>
        </div>
      )}

      {contextMenu && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="context-menu-title" title={contextMenu.node.path}>
            {contextMenu.node.name}
          </div>
          <button
            type="button"
            className="context-menu-item"
            onClick={() => {
              openPath(contextMenu.node.fullPath, "editor").catch(() => {});
              setContextMenu(null);
            }}
          >
            <ExternalLink size={13} />
            <span>{t("projectSidebar.openInEditor")}</span>
          </button>
          <button
            type="button"
            className="context-menu-item"
            onClick={() => {
              openPath(contextMenu.node.fullPath, "explorer").catch(() => {});
              setContextMenu(null);
            }}
          >
            <FolderOpen size={13} />
            <span>{t("projectSidebar.revealInExplorer")}</span>
          </button>
          <button
            type="button"
            className="context-menu-item"
            onClick={() => {
              navigator.clipboard?.writeText(contextMenu.node.path);
              setContextMenu(null);
            }}
          >
            <Copy size={13} />
            <span>{t("projectSidebar.copyRelativePath")}</span>
          </button>
          <button
            type="button"
            className="context-menu-item"
            onClick={() => {
              navigator.clipboard?.writeText(contextMenu.node.fullPath);
              setContextMenu(null);
            }}
          >
            <Copy size={13} />
            <span>{t("projectSidebar.copyAbsolutePath")}</span>
          </button>
        </div>
      )}
    </div>
  );
}
