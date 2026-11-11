import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FolderGit2,
  FolderOpen,
  GitBranch,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  X,
  ExternalLink,
  Copy,
  Trash2,
} from "lucide-react";
import FolderTree from "./FolderTree";
import RepoAvatar from "./RepoAvatar";
import { getRepoChangeCount, openPath } from "../api/tauri";
import type { GitStatus, RecentRepo } from "../types";

/** 单个项目节点：标题行可切换仓库，箭头展开复用「文件夹」tab 的目录树 */
function ProjectNode({
  repo,
  active,
  currentBranch,
  filter,
  status,
  selectedPath,
  refreshKey,
  changeCount,
  onSwitchRepo,
  onOpenFile,
  onRemove,
  onContextMenu,
}: {
  repo: RecentRepo;
  active: boolean;
  currentBranch?: string;
  filter: string;
  status: GitStatus | null;
  selectedPath: string | null;
  refreshKey: number;
  changeCount: number | null;
  onSwitchRepo: (path: string) => void;
  onOpenFile: (repoPath: string, fullPath: string, relPath: string) => void;
  onRemove: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, repo: RecentRepo) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // 当有搜索词且当前项目为激活项目时，自动展开以便显示搜索结果
  const isExpanded = expanded || (Boolean(filter.trim()) && active);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded((v) => !v);
  };

  return (
    <div className="project-node">
      <div
        className={`project-node-row ${active ? "active" : ""}`}
        onClick={() => onSwitchRepo(repo.path)}
        onContextMenu={(e) => onContextMenu(e, repo)}
        title={repo.path}
      >
        <button
          type="button"
          className="project-node-toggle"
          onClick={toggle}
          title={isExpanded ? "收起目录" : "展开目录"}
        >
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <FolderGit2
          size={14}
          className={`project-node-icon ${active ? "active-repo" : ""}`}
        />
        <span className="project-node-name">{repo.name}</span>
        {active && currentBranch && (
          <span className="project-node-branch" title={`当前分支: ${currentBranch}`}>
            <GitBranch size={10} />
            <span>{currentBranch}</span>
          </span>
        )}
        {changeCount !== null && changeCount > 0 && (
          <span className="project-node-count" title={`${changeCount} 处变更`}>
            {changeCount}
          </span>
        )}
        <button
          type="button"
          className="project-node-remove"
          title="从项目列表移除"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(repo.path);
          }}
        >
          <X size={12} />
        </button>
      </div>

      {isExpanded && (
        <div className="project-node-children">
          <FolderTree
            repoPath={repo.path}
            filter={filter}
            status={active ? status : null}
            refreshKey={refreshKey}
            onSelectFile={(fullPath, relPath) => onOpenFile(repo.path, fullPath, relPath)}
            selectedPath={active ? selectedPath : null}
          />
        </div>
      )}
    </div>
  );
}

export default function ProjectSidebar({
  repos,
  currentRepoPath,
  currentBranch,
  status,
  selectedPath,
  refreshKey,
  onSwitchRepo,
  onOpenFile,
  onOpenOther,
  onRemove,
  width,
  onCollapsedChange,
}: {
  repos: RecentRepo[];
  currentRepoPath: string;
  currentBranch?: string;
  status: GitStatus | null;
  selectedPath: string | null;
  refreshKey: number;
  onSwitchRepo: (path: string) => void;
  onOpenFile: (repoPath: string, fullPath: string, relPath: string) => void;
  onOpenOther: () => void;
  onRemove: (path: string) => void;
  /** 展开状态下的宽度（px），由父组件持久化 */
  width?: number;
  /** 折叠状态变化时通知父组件（用于隐藏拖拽手柄） */
  onCollapsedChange?: (collapsed: boolean) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    repo: RecentRepo;
  } | null>(null);

  useEffect(() => {
    onCollapsedChange?.(collapsed);
  }, [collapsed, onCollapsedChange]);

  // 全局点击或 ESC 关闭右键菜单
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

  const handleContextMenu = (e: React.MouseEvent, repo: RecentRepo) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: Math.min(e.clientX, window.innerWidth - 240),
      y: Math.min(e.clientY, window.innerHeight - 200),
      repo,
    });
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.path.toLowerCase().includes(q) ||
        // 保持当前激活仓库始终可见，以便子文件树可根据 query 匹配并高亮展示文件
        r.path === currentRepoPath
    );
  }, [repos, query, currentRepoPath]);

  const list = useMemo(() => {
    // 当前项目尚未写入最近列表时也显示出来
    if (!currentRepoPath || filtered.some((r) => r.path === currentRepoPath)) return filtered;
    const name = currentRepoPath.split(/[\\/]/).filter(Boolean).pop() ?? currentRepoPath;
    return [{ path: currentRepoPath, name, last_opened: Date.now() }, ...filtered];
  }, [filtered, currentRepoPath]);

  // 按名称固定排序，避免切换仓库后（最近打开时间变化）顺序跳动
  const orderedList = useMemo(
    () => [...list].sort((a, b) => a.name.localeCompare(b.name, "zh-Hans")),
    [list]
  );

  const listKey = orderedList.map((r) => r.path).join("|");

  /** 全部项目（不受搜索过滤影响），按名称排序，用于计算稳定的头像编号 */
  const allOrderedList = useMemo(() => {
    const all = [...repos];
    if (currentRepoPath && !all.some((r) => r.path === currentRepoPath)) {
      const name = currentRepoPath.split(/[\\/]/).filter(Boolean).pop() ?? currentRepoPath;
      all.push({ path: currentRepoPath, name, last_opened: Date.now() });
    }
    return all.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans"));
  }, [repos, currentRepoPath]);

  /**
   * 折叠态头像编号：按项目名首字母分组，组内按项目名称顺序编号 0、1、2……
   * 首字母唯一的项目不显示数字，避免无意义的「A0」。
   */
  const avatarIndexByPath = useMemo(() => {
    const groups = new Map<string, RecentRepo[]>();
    for (const repo of allOrderedList) {
      const letter = (repo.name.trim()[0] || "?").toUpperCase();
      const group = groups.get(letter);
      if (group) {
        group.push(repo);
      } else {
        groups.set(letter, [repo]);
      }
    }

    const result = new Map<string, number | null>();
    for (const group of groups.values()) {
      group.forEach((repo, index) => {
        result.set(repo.path, group.length > 1 ? index : null);
      });
    }
    return result;
  }, [allOrderedList]);

  // 当前项目的计数直接来自变更状态，其余项目按路径查询
  const currentCount = useMemo(() => {
    if (!status) return null;
    const paths = new Set<string>();
    status.staged.forEach((f) => paths.add(f.path));
    status.unstaged.forEach((f) => paths.add(f.path));
    return paths.size;
  }, [status]);

  useEffect(() => {
    let cancelled = false;
    const others = orderedList.filter((r) => r.path !== currentRepoPath);

    Promise.all(
      others.map(async (repo) => {
        try {
          return [repo.path, await getRepoChangeCount(repo.path)] as const;
        } catch {
          return [repo.path, 0] as const;
        }
      })
    ).then((entries) => {
      if (!cancelled) setCounts(Object.fromEntries(entries));
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey, currentRepoPath, refreshKey]);

  if (collapsed) {
    return (
      <div className="project-sidebar collapsed">
        <div className="project-sidebar-header" data-tauri-drag-region>
          <button
            type="button"
            className="project-sidebar-collapse"
            onClick={() => setCollapsed(false)}
            title="展开项目侧边栏"
          >
            <PanelLeftOpen size={14} />
          </button>
        </div>
        <div className="project-rail">
          {orderedList.map((repo) => {
            const count =
              repo.path === currentRepoPath
                ? currentCount ?? counts[repo.path] ?? null
                : counts[repo.path] ?? null;
            const tooltip =
              count && count > 0
                ? `${repo.name} (${count} 处变更)\n${repo.path}`
                : `${repo.name}\n${repo.path}`;

            return (
              <div
                key={repo.path}
                className="project-rail-item-wrap"
                onContextMenu={(e) => handleContextMenu(e, repo)}
              >
                <button
                  type="button"
                  className={`project-rail-item ${repo.path === currentRepoPath ? "active" : ""}`}
                  title={tooltip}
                  onClick={() => onSwitchRepo(repo.path)}
                >
                  <RepoAvatar
                    repoName={repo.name}
                    index={avatarIndexByPath.get(repo.path) ?? null}
                    size={24}
                  />
                  {count !== null && count > 0 && (
                    <span className="project-rail-badge">
                      {count > 99 ? "99+" : count}
                    </span>
                  )}
                </button>
              </div>
            );
          })}

          <button
            type="button"
            className="project-rail-add"
            title="打开其他仓库..."
            onClick={onOpenOther}
          >
            <Plus size={13} />
          </button>
        </div>

        {contextMenu && (
          <div
            className="context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="context-menu-title" title={contextMenu.repo.path}>
              {contextMenu.repo.name}
            </div>
            <button
              type="button"
              className="context-menu-item"
              onClick={() => {
                openPath(contextMenu.repo.path, "explorer").catch(() => {});
                setContextMenu(null);
              }}
            >
              <FolderOpen size={13} />
              <span>在文件资源管理器中打开</span>
            </button>
            <button
              type="button"
              className="context-menu-item"
              onClick={() => {
                openPath(contextMenu.repo.path, "editor").catch(() => {});
                setContextMenu(null);
              }}
            >
              <ExternalLink size={13} />
              <span>用外部编辑器打开</span>
            </button>
            <button
              type="button"
              className="context-menu-item"
              onClick={() => {
                navigator.clipboard?.writeText(contextMenu.repo.path);
                setContextMenu(null);
              }}
            >
              <Copy size={13} />
              <span>复制仓库绝对路径</span>
            </button>
            <div className="context-menu-hint" />
            <button
              type="button"
              className="context-menu-item"
              style={{ color: "var(--error-color)" }}
              onClick={() => {
                onRemove(contextMenu.repo.path);
                setContextMenu(null);
              }}
            >
              <Trash2 size={13} />
              <span>从最近列表移除</span>
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="project-sidebar" style={width !== undefined ? { width } : undefined}>
      <div className="project-sidebar-header" data-tauri-drag-region>
        <img className="project-sidebar-logo" src="/app-icon.png" alt="GitLensy" draggable={false} />
        <span className="project-sidebar-title">GitLensy</span>
        <button
          type="button"
          className="project-sidebar-collapse"
          onClick={() => setCollapsed(true)}
          title="收起项目侧边栏"
        >
          <PanelLeftClose size={14} />
        </button>
      </div>

      <div className="project-sidebar-search">
        <Search size={12} className="project-sidebar-search-icon" />
        <input
          type="text"
          className="project-sidebar-search-input"
          placeholder="搜索项目或文件..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button
            type="button"
            className="project-sidebar-search-clear"
            onClick={() => setQuery("")}
            title="清空搜索"
          >
            <X size={12} />
          </button>
        )}
      </div>

      <div className="project-sidebar-list">
        {orderedList.map((repo) => (
          <ProjectNode
            key={repo.path}
            repo={repo}
            active={repo.path === currentRepoPath}
            currentBranch={repo.path === currentRepoPath ? currentBranch : undefined}
            filter={query}
            status={status}
            selectedPath={selectedPath}
            refreshKey={refreshKey}
            changeCount={
              repo.path === currentRepoPath ? currentCount ?? counts[repo.path] ?? null : counts[repo.path] ?? null
            }
            onSwitchRepo={onSwitchRepo}
            onOpenFile={onOpenFile}
            onRemove={onRemove}
            onContextMenu={handleContextMenu}
          />
        ))}
        {orderedList.length === 0 && <div className="project-tree-loading">没有匹配的项目</div>}
      </div>

      <button type="button" className="project-sidebar-add" onClick={onOpenOther}>
        <Plus size={13} />
        <span>打开其他仓库...</span>
      </button>

      {contextMenu && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="context-menu-title" title={contextMenu.repo.path}>
            {contextMenu.repo.name}
          </div>
          <button
            type="button"
            className="context-menu-item"
            onClick={() => {
              openPath(contextMenu.repo.path, "explorer").catch(() => {});
              setContextMenu(null);
            }}
          >
            <FolderOpen size={13} />
            <span>在文件资源管理器中打开</span>
          </button>
          <button
            type="button"
            className="context-menu-item"
            onClick={() => {
              openPath(contextMenu.repo.path, "editor").catch(() => {});
              setContextMenu(null);
            }}
          >
            <ExternalLink size={13} />
            <span>用外部编辑器打开</span>
          </button>
          <button
            type="button"
            className="context-menu-item"
            onClick={() => {
              navigator.clipboard?.writeText(contextMenu.repo.path);
              setContextMenu(null);
            }}
          >
            <Copy size={13} />
            <span>复制仓库绝对路径</span>
          </button>
          <div className="context-menu-hint" />
          <button
            type="button"
            className="context-menu-item"
            style={{ color: "var(--error-color)" }}
            onClick={() => {
              onRemove(contextMenu.repo.path);
              setContextMenu(null);
            }}
          >
            <Trash2 size={13} />
            <span>从最近列表移除</span>
          </button>
        </div>
      )}
    </div>
  );
}
