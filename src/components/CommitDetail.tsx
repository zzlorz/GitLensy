import { useState, useCallback } from "react";
import {
  User,
  Clock,
  Hash,
  GitCommit,
  ChevronDown,
  ChevronRight,
  ArrowRight,
  Loader2,
} from "lucide-react";
import type { CommitInfo, CommitFile, FileDiff } from "../types";

/** Git-style letter badge identical to FileList */
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { text: string; cls: string }> = {
    modified:  { text: "M", cls: "badge-modified" },
    added:     { text: "A", cls: "badge-added" },
    deleted:   { text: "D", cls: "badge-deleted" },
    renamed:   { text: "R", cls: "badge-renamed" },
    copied:    { text: "C", cls: "badge-renamed" },
    conflict:  { text: "!", cls: "badge-conflict" },
    untracked: { text: "U", cls: "badge-untracked" },
  };
  const info = map[status] ?? { text: "M", cls: "badge-modified" };
  return <span className={`file-badge ${info.cls}`}>{info.text}</span>;
}

interface CommitDetailProps {
  commit: CommitInfo;
  files: CommitFile[];
  filesLoading: boolean;
  filesError?: string | null;
  selectedFilePath: string | null;
  diff: FileDiff | null;
  diffLoading: boolean;
  diffError: string | null;
  onSelectFile: (file: CommitFile) => void;
}

export default function CommitDetail({
  commit,
  files,
  filesLoading,
  filesError,
  selectedFilePath,
  diff: _diff,   // diff 由 HistoryWorkspace 的 DiffViewer 区域渲染，这里不使用
  diffLoading: _diffLoading,
  diffError: _diffError,
  onSelectFile,
}: CommitDetailProps) {
  const [bodyExpanded, setBodyExpanded] = useState(false);
  const [filter, setFilter] = useState("");

  const filteredFiles = filter.trim()
    ? files.filter((f) => f.path.toLowerCase().includes(filter.toLowerCase()))
    : files;

  const handleFileClick = useCallback(
    (file: CommitFile) => onSelectFile(file),
    [onSelectFile]
  );

  return (
    <div className="commit-detail">
      {/* Commit metadata header */}
      <div className="commit-detail-header">
        <div className="commit-detail-subject">{commit.subject || "(no message)"}</div>

        {commit.body && (
          <button
            className="commit-body-toggle"
            onClick={() => setBodyExpanded((v) => !v)}
          >
            {bodyExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            {bodyExpanded ? "收起详情" : "展开详情"}
          </button>
        )}
        {commit.body && bodyExpanded && (
          <pre className="commit-body">{commit.body}</pre>
        )}

        <div className="commit-detail-meta">
          <span className="commit-detail-meta-item" title="提交哈希">
            <GitCommit size={13} />
            <code>{commit.hash.slice(0, 16)}…</code>
          </span>
          <span className="commit-detail-meta-item" title="作者">
            <User size={13} />
            {commit.author_name}
            {commit.author_email && (
              <span style={{ color: "var(--text-muted)" }}>
                &lt;{commit.author_email}&gt;
              </span>
            )}
          </span>
          <span className="commit-detail-meta-item" title={new Date(commit.date).toLocaleString()}>
            <Clock size={13} />
            {commit.date_relative}
          </span>
          {commit.parent_count >= 2 && (
            <span className="commit-merge-badge">Merge</span>
          )}
        </div>
      </div>

      {/* File list */}
      <div className="commit-detail-files-header">
        <Hash size={13} style={{ color: "var(--text-muted)" }} />
        <span>变更文件</span>
        <span className="file-section-count" style={{ marginLeft: 6 }}>
          {files.length}
        </span>
        {files.length > 8 && (
          <input
            type="text"
            className="sidebar-search-input"
            placeholder="过滤..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ marginLeft: "auto", width: 140, padding: "3px 8px", fontSize: 11 }}
          />
        )}
      </div>

      <div className="commit-detail-files">
        {filesLoading && (
          <div className="loading" style={{ padding: 20 }}>
            <Loader2 size={14} className="spin" />
            <span>加载文件列表...</span>
          </div>
        )}

        {!filesLoading && filesError && (
          <div style={{ padding: "16px 12px", color: "var(--error-color)", fontSize: 12, textAlign: "center" }}>
            {filesError}
          </div>
        )}

        {!filesLoading && !filesError && filteredFiles.length === 0 && (
          <div style={{ padding: "16px 12px", color: "var(--text-muted)", fontSize: 12, textAlign: "center" }}>
            无变更文件
          </div>
        )}

        {!filesLoading &&
          !filesError &&
          filteredFiles.map((file) => {
            const normalizedPath = file.path.replace(/\\/g, "/");
            const lastSlash = normalizedPath.lastIndexOf("/");
            // 目录部分不带末尾的 "/"，由 CSS 伪元素补上
            const dirWithoutSlash = lastSlash !== -1 ? normalizedPath.slice(0, lastSlash) : "";
            const name = lastSlash !== -1 ? normalizedPath.slice(lastSlash + 1) : normalizedPath;

            return (
              <div
                key={file.path}
                className={`file-item ${selectedFilePath === file.path ? "selected" : ""}`}
                onClick={() => handleFileClick(file)}
                title={file.path}
              >
                <StatusBadge status={file.status} />
                <div className="file-name">
                  {file.old_path && (
                    <>
                      <span className="file-old-rename" title={file.old_path}>
                        {file.old_path}
                      </span>
                      <ArrowRight size={11} className="rename-arrow" />
                    </>
                  )}
                  {dirWithoutSlash && (
                    <span className="file-dir">{dirWithoutSlash}</span>
                  )}
                  <span className="file-base">{name}</span>
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
          })}
      </div>
    </div>
  );
}
