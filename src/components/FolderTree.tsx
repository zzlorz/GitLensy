import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { readDir, type DirEntry } from "@tauri-apps/plugin-fs";
import { ChevronDown, ChevronRight, Folder, FolderOpen, FileText, Loader2, AlertCircle } from "lucide-react";
import type { GitStatus, ChangedFile, FileStatus } from "../types";

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

const EXCLUDED_DIRS = new Set([".git", "node_modules", "dist", "build", "target", ".next", ".cache", ".idea", ".vscode", "__pycache__", ".turbo"]);

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
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  statusMap: Map<string, ChangedFile>;
  filter: string;
  selectedPath: string | null;
  onSelectFile: (fullPath: string, relPath: string) => void;
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

  return (
    <>
      <div
        className={`folder-tree-node ${isSelected ? "selected" : ""} ${node.isDirectory ? "dir" : "file"}`}
        style={indent}
        onClick={handleClick}
        title={node.path}
      >
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
          <>
            <FileText size={14} className="folder-tree-icon file-icon" />
            {statusInfo && <FileStatusBadge statusInfo={statusInfo} />}
          </>
        )}

        <span className="folder-tree-label">{node.name}</span>
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
  const [tree, setTree] = useState<TreeNode[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const loadedRepoRef = useRef<string | null>(null);

  const statusMap = useMemo(() => buildStatusMap(status), [status]);

  const loadTree = useCallback(async (force: boolean) => {
    if (!force && loadedRepoRef.current === repoPath && tree) return;

    setLoading(true);
    setError(null);
    try {
      const normalizedPath = normalizePath(repoPath);
      if (!normalizedPath) {
        setError("仓库路径为空");
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
        <span>正在扫描目录结构...</span>
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
        <span>没有匹配的文件或目录</span>
      </div>
    );
  }

  return (
    <div className="folder-tree">
      {tree && tree.map((node) => (
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
        />
      ))}
      {tree && tree.length === 0 && !hasFilter && (
        <div className="folder-tree-empty">
          <span>目录为空</span>
        </div>
      )}
    </div>
  );
}
