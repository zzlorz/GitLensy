import { useState, useMemo, useEffect, useRef } from "react";
import { ChevronDown, ChevronRight, RotateCcw, Undo2 } from "lucide-react";
import type { GitStatus, ChangedFile, FileStatus } from "../types";

interface Props {
  status: GitStatus;
  selectedPath: string | null;
  onSelect: (file: ChangedFile) => void;
  filter: string;
  onFilterChange: (val: string) => void;
  /** 撤销变更：由父组件调用 revertFile 后端命令后刷新状态 */
  onRevert: (file: ChangedFile, scope: "unstaged" | "staged" | "all") => void;
}

function StatusBadge({ status }: { status: FileStatus }) {
  const badgeMap: Record<FileStatus, { text: string; className: string; label: string }> = {
    modified: { text: "M", className: "badge-modified", label: "已修改 (Modified)" },
    added: { text: "A", className: "badge-added", label: "新添加 (Added)" },
    deleted: { text: "D", className: "badge-deleted", label: "已删除 (Deleted)" },
    renamed: { text: "R", className: "badge-renamed", label: "重命名 (Renamed)" },
    copied: { text: "C", className: "badge-renamed", label: "已复制 (Copied)" },
    conflict: { text: "!", className: "badge-conflict", label: "存在冲突 (Conflict)" },
    untracked: { text: "U", className: "badge-untracked", label: "未跟踪 (Untracked)" },
    ignored: { text: "I", className: "badge-modified", label: "已忽略 (Ignored)" },
    unchanged: { text: "•", className: "badge-modified", label: "未变更 (Unchanged)" },
  };

  const info = badgeMap[status] || { text: "M", className: "badge-modified", label: status };

  return (
    <span className={`file-badge ${info.className}`} title={info.label}>
      {info.text}
    </span>
  );
}

interface ContextMenuState {
  file: ChangedFile;
  scope: "unstaged" | "staged";
  x: number;
  y: number;
}

function FileItem({
  file,
  selected,
  onClick,
  onContextMenu,
}: {
  file: ChangedFile;
  selected: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const displayStatus = file.staged_status || file.unstaged_status || "modified";
  const normalizedPath = file.path.replace(/\\/g, "/");
  const lastSlashIndex = normalizedPath.lastIndexOf("/");
  const dirPathWithoutSlash = lastSlashIndex !== -1 ? normalizedPath.slice(0, lastSlashIndex) : "";
  const fileName = lastSlashIndex !== -1 ? normalizedPath.slice(lastSlashIndex + 1) : normalizedPath;

  return (
    <div
      className={`file-item ${selected ? "selected" : ""}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={file.path}
    >
      <StatusBadge status={displayStatus} />
      <div className="file-name">
        {dirPathWithoutSlash && (
          <span className="file-dir">{dirPathWithoutSlash}</span>
        )}
        <span className="file-base">{fileName}</span>
      </div>
      <div className="file-stats">
        {file.additions > 0 && (
          <span className="stat-additions">+{file.additions}</span>
        )}
        {file.deletions > 0 && (
          <span className="stat-deletions">-{file.deletions}</span>
        )}
      </div>
    </div>
  );
}

function FileSection({
  title,
  files,
  selectedPath,
  onSelect,
  onItemContextMenu,
  scope,
  defaultCollapsed = false,
  grow = false,
}: {
  title: string;
  files: ChangedFile[];
  selectedPath: string | null;
  onSelect: (file: ChangedFile) => void;
  onItemContextMenu: (file: ChangedFile, scope: "unstaged" | "staged", e: React.MouseEvent) => void;
  scope: "unstaged" | "staged";
  defaultCollapsed?: boolean;
  grow?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <div className={`file-section ${grow ? "file-section-grow" : ""}`}>
      <div className="file-section-header" onClick={() => setCollapsed(!collapsed)}>
        {collapsed ? (
          <ChevronRight size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
        ) : (
          <ChevronDown size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
        )}
        <span>{title}</span>
        <span className="file-section-count">{files.length}</span>
      </div>

      {!collapsed && (
        <div className="file-list">
          {files.length === 0 ? (
            <div style={{ padding: "16px 12px", color: "var(--text-muted)", fontSize: "12px", textAlign: "center" }}>
              无变更文件
            </div>
          ) : (
            files.map((file) => (
              <FileItem
                key={file.path}
                file={file}
                selected={selectedPath === file.path}
                onClick={() => onSelect(file)}
                onContextMenu={(e) => onItemContextMenu(file, scope, e)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function FileList({
  status,
  selectedPath,
  onSelect,
  filter,
  onFilterChange: _onFilterChange,
  onRevert,
}: Props) {
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 点击其他地方关闭右键菜单
  useEffect(() => {
    if (!ctxMenu) return;
    const closeMenu = () => setCtxMenu(null);
    // 用 setTimeout 延迟注册，避免右键事件本身冒泡到 window 立即触发关闭
    const timerId = window.setTimeout(() => {
      window.addEventListener("click", closeMenu);
      window.addEventListener("contextmenu", closeMenu);
    }, 0);
    return () => {
      window.clearTimeout(timerId);
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("contextmenu", closeMenu);
    };
  }, [ctxMenu]);

  const handleItemContextMenu = (
    file: ChangedFile,
    scope: "unstaged" | "staged",
    e: React.MouseEvent,
  ) => {
    e.preventDefault();
    // 算出相对于容器的坐标，避免超出屏幕
    const container = containerRef.current;
    let x = e.clientX;
    let y = e.clientY;
    if (container) {
      const rect = container.getBoundingClientRect();
      const menuW = 200;
      const menuH = 130;
      x = Math.min(x, rect.right - menuW - 4);
      y = Math.min(y, rect.bottom - menuH - 4);
      x = Math.max(x, rect.left + 2);
      y = Math.max(y, rect.top + 2);
    }
    setCtxMenu({ file, scope, x, y });
  };

  const filteredUnstaged = useMemo(() => {
    if (!filter.trim()) return status.unstaged;
    const q = filter.toLowerCase();
    return status.unstaged.filter((f) => f.path.toLowerCase().includes(q));
  }, [status.unstaged, filter]);

  const filteredStaged = useMemo(() => {
    if (!filter.trim()) return status.staged;
    const q = filter.toLowerCase();
    return status.staged.filter((f) => f.path.toLowerCase().includes(q));
  }, [status.staged, filter]);

  const handleMenuAction = (action: "scope" | "all") => {
    if (!ctxMenu) return;
    const scope = action === "all" ? "all" : ctxMenu.scope;
    onRevert(ctxMenu.file, scope as "unstaged" | "staged" | "all");
    setCtxMenu(null);
  };

  // 判断菜单项是否需要显示 "全部丢弃"：文件同时有 staged 和 unstaged 变化时才有意义
  const hasBothChanges = ctxMenu
    ? ctxMenu.file.has_staged_changes && ctxMenu.file.has_unstaged_changes
    : false;

  // 菜单项的主标签根据右键位置决定
  const primaryLabel = ctxMenu?.scope === "unstaged" ? "撤销工作区修改" : "取消暂存";

  return (
    <div ref={containerRef} className="file-list-container">
      <FileSection
        title="工作区变更 (Unstaged)"
        files={filteredUnstaged}
        selectedPath={selectedPath}
        onSelect={onSelect}
        onItemContextMenu={handleItemContextMenu}
        scope="unstaged"
        grow={true}
      />

      <FileSection
        title="暂存区变更 (Staged)"
        files={filteredStaged}
        selectedPath={selectedPath}
        onSelect={onSelect}
        onItemContextMenu={handleItemContextMenu}
        scope="staged"
        defaultCollapsed={status.staged.length === 0}
      />

      {ctxMenu && (
        <div
          className="context-menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
        >
          <div className="context-menu-title">{ctxMenu.file.path}</div>
          <button
            className="context-menu-item"
            onClick={() => handleMenuAction("scope")}
          >
            {ctxMenu.scope === "unstaged" ? (
              <><RotateCcw size={12} /> <span>撤销工作区修改</span></>
            ) : (
              <><Undo2 size={12} /> <span>取消暂存</span></>
            )}
          </button>
          {hasBothChanges && (
            <button
              className="context-menu-item"
              onClick={() => handleMenuAction("all")}
            >
              <Undo2 size={12} /> <span>全部丢弃</span>
            </button>
          )}
          <div className="context-menu-hint">{primaryLabel}（破坏性操作）</div>
        </div>
      )}
    </div>
  );
}
