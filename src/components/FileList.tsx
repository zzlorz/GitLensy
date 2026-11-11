import { useState } from "react";
import { ChevronDown, ChevronRight, Undo2, Plus, Minus, FileText, FileStack } from "lucide-react";
import type { GitStatus, ChangedFile, FileStatus } from "../types";
import { useI18n } from "../i18n";

interface Props {
  status: GitStatus;
  selectedPath: string | null;
  onSelect: (file: ChangedFile) => void;
  /** 撤销变更：由父组件调用 revertFile 后端命令后刷新状态 */
  onRevert: (file: ChangedFile, scope: "unstaged" | "staged" | "all") => void;
  /** 暂存单个文件（git add） */
  onStage: (file: ChangedFile) => void;
  /** 取消暂存（保留工作区修改） */
  onUnstage: (file: ChangedFile) => void;
  /** 以文件预览方式打开（类似文件夹目录里的预览） */
  onPreview: (file: ChangedFile) => void;
  /** 打开所有变更文件的连续对比 */
  onOpenAllChanges: () => void;
  /** 暂存所有变更 */
  onStageAll: () => void;
  /** 放弃所有工作区变更 */
  onDiscardAll: () => void;
}

function StatusBadge({ status }: { status: FileStatus }) {
  const { t } = useI18n();
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

  const info = badgeMap[status] || { text: "M", className: "badge-modified" };
  const label = t(`statusLabels.${status}`) || status;

  return (
    <span className={`file-badge ${info.className}`} title={label}>
      {info.text}
    </span>
  );
}

function FileItem({
  file,
  selected,
  scope,
  onClick,
  onRevert,
  onStage,
  onUnstage,
  onPreview,
}: {
  file: ChangedFile;
  selected: boolean;
  scope: "unstaged" | "staged";
  onClick: () => void;
  onRevert: (file: ChangedFile, scope: "unstaged" | "staged" | "all") => void;
  onStage: (file: ChangedFile) => void;
  onUnstage: (file: ChangedFile) => void;
  onPreview: (file: ChangedFile) => void;
}) {
  const { t } = useI18n();
  const displayStatus = file.staged_status || file.unstaged_status || "modified";
  const isDeleted = file.staged_status === "deleted" || file.unstaged_status === "deleted";
  const normalizedPath = file.path.replace(/\\/g, "/");
  const lastSlashIndex = normalizedPath.lastIndexOf("/");
  const dirPathWithoutSlash = lastSlashIndex !== -1 ? normalizedPath.slice(0, lastSlashIndex) : "";
  const fileName = lastSlashIndex !== -1 ? normalizedPath.slice(lastSlashIndex + 1) : normalizedPath;

  const handleAction = (e: React.MouseEvent, action: () => void) => {
    e.stopPropagation();
    action();
  };

  return (
    <div
      className={`file-item ${selected ? "selected" : ""}`}
      onClick={onClick}
      title={file.path}
    >
      <StatusBadge status={displayStatus} />
      <div className="file-name">
        <span className="file-base">{fileName}</span>
        {dirPathWithoutSlash && (
          <span className="file-dir">{dirPathWithoutSlash}</span>
        )}
      </div>
      <div className="file-stats">
        {file.additions > 0 && (
          <span className="stat-additions">+{file.additions}</span>
        )}
        {file.deletions > 0 && (
          <span className="stat-deletions">-{file.deletions}</span>
        )}
      </div>
      <div className="file-actions">
        {!isDeleted && (
          <button
            type="button"
            className="file-action-btn"
            title={t("fileList.openFilePreview")}
            onClick={(e) => handleAction(e, () => onPreview(file))}
          >
            <FileText size={13} />
          </button>
        )}
        {scope === "unstaged" ? (
          <>
            <button
              type="button"
              className="file-action-btn danger"
              title={t("fileList.discardFile")}
              onClick={(e) => handleAction(e, () => onRevert(file, "unstaged"))}
            >
              <Undo2 size={13} />
            </button>
            <button
              type="button"
              className="file-action-btn"
              title={t("fileList.stageFile")}
              onClick={(e) => handleAction(e, () => onStage(file))}
            >
              <Plus size={13} />
            </button>
          </>
        ) : (
          <button
            type="button"
            className="file-action-btn"
            title={t("fileList.unstageFile")}
            onClick={(e) => handleAction(e, () => onUnstage(file))}
          >
            <Minus size={13} />
          </button>
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
  onRevert,
  onStage,
  onUnstage,
  onPreview,
  headerActions,
  scope,
  defaultCollapsed = false,
  grow = false,
}: {
  title: string;
  files: ChangedFile[];
  selectedPath: string | null;
  onSelect: (file: ChangedFile) => void;
  onRevert: (file: ChangedFile, scope: "unstaged" | "staged" | "all") => void;
  onStage: (file: ChangedFile) => void;
  onUnstage: (file: ChangedFile) => void;
  onPreview: (file: ChangedFile) => void;
  /** 标题栏右侧的整段操作按钮 */
  headerActions?: React.ReactNode;
  scope: "unstaged" | "staged";
  defaultCollapsed?: boolean;
  grow?: boolean;
}) {
  const { t } = useI18n();
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
        {headerActions && files.length > 0 && (
          <div className="file-section-actions" onClick={(e) => e.stopPropagation()}>
            {headerActions}
          </div>
        )}
      </div>

      {!collapsed && (
        <div className="file-list">
          {files.length === 0 ? (
            <div style={{ padding: "16px 12px", color: "var(--text-muted)", fontSize: "12px", textAlign: "center" }}>
              {t("fileList.noChangedFiles")}
            </div>
          ) : (
            files.map((file) => (
              <FileItem
                key={file.path}
                file={file}
                selected={selectedPath === file.path}
                scope={scope}
                onClick={() => onSelect(file)}
                onRevert={onRevert}
                onStage={onStage}
                onUnstage={onUnstage}
                onPreview={onPreview}
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
  onRevert,
  onStage,
  onUnstage,
  onPreview,
  onOpenAllChanges,
  onStageAll,
  onDiscardAll,
}: Props) {
  const { t } = useI18n();

  return (
    <div className="file-list-container">
      <FileSection
        title={t("fileList.unstagedSection")}
        files={status.unstaged}
        selectedPath={selectedPath}
        onSelect={onSelect}
        onRevert={onRevert}
        onStage={onStage}
        onUnstage={onUnstage}
        onPreview={onPreview}
        headerActions={
          <>
            <button
              type="button"
              className="file-action-btn"
              title={t("fileList.openAllChanges")}
              onClick={onOpenAllChanges}
            >
              <FileStack size={13} />
            </button>
            <button
              type="button"
              className="file-action-btn danger"
              title={t("fileList.discardAllTooltip")}
              onClick={onDiscardAll}
            >
              <Undo2 size={13} />
            </button>
            <button
              type="button"
              className="file-action-btn"
              title={t("fileList.stageAllTooltip")}
              onClick={onStageAll}
            >
              <Plus size={13} />
            </button>
          </>
        }
        scope="unstaged"
        grow={true}
      />

      <FileSection
        title={t("fileList.stagedSection")}
        files={status.staged}
        selectedPath={selectedPath}
        onSelect={onSelect}
        onRevert={onRevert}
        onStage={onStage}
        onUnstage={onUnstage}
        onPreview={onPreview}
        scope="staged"
        defaultCollapsed={false}
      />
    </div>
  );
}
