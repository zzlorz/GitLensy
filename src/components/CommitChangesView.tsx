import { useEffect, useState } from "react";
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Clock,
  GitCommit,
  GitCommitHorizontal,
  GitCompare,
  Loader2,
  User,
  X,
} from "lucide-react";
import {
  getCommitFileDiff,
  getCommitFiles,
  getCompareFileDiff,
  getCompareFiles,
} from "../api/tauri";
import { DiffBody, saveDiffLayout } from "./DiffViewer";
import type { DiffLayout } from "./DiffViewer";
import type { CommitFile, CommitInfo, FileDiff, FileStatus } from "../types";

const BADGES: Record<FileStatus, { text: string; className: string }> = {
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

interface Props {
  commit: CommitInfo;
  /** 提交间对比的基准提交；提供时展示 compareFrom..commit 的差异 */
  compareFrom?: CommitInfo;
  /** 退出提交间对比 */
  onClearCompare?: () => void;
  /** 把该提交 cherry-pick 到当前分支 */
  onCherryPick?: (commit: CommitInfo) => void;
}

/** 单次提交的连续 Diff：不再单独占用文件列表栏，所有文件按顺序向下展示 */
export default function CommitChangesView({
  commit,
  compareFrom,
  onClearCompare,
  onCherryPick,
}: Props) {
  const [layout, setLayout] = useState<DiffLayout>("split");
  const [bodyExpanded, setBodyExpanded] = useState(false);
  const [files, setFiles] = useState<CommitFile[]>([]);
  const [diffs, setDiffs] = useState<Record<string, FileDiff>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setFiles([]);
    setDiffs({});
    setErrors({});
    setBodyExpanded(false);

    const load = async () => {
      try {
        const list = compareFrom
          ? await getCompareFiles(compareFrom.hash, commit.hash)
          : await getCommitFiles(commit.hash);
        if (cancelled) return;
        setFiles(list);

        const diffMap: Record<string, FileDiff> = {};
        const errorMap: Record<string, string> = {};
        await Promise.all(
          list.map(async (file) => {
            try {
              diffMap[file.path] = compareFrom
                ? await getCompareFileDiff(
                    compareFrom.hash,
                    commit.hash,
                    file.path,
                    file.old_path,
                  )
                : await getCommitFileDiff(
                    commit.hash,
                    file.path,
                    file.old_path,
                  );
            } catch (e) {
              errorMap[file.path] = e instanceof Error ? e.message : String(e);
            }
          }),
        );

        if (cancelled) return;
        setDiffs(diffMap);
        setErrors(errorMap);
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [commit.hash, compareFrom]);

  const changeLayout = (next: DiffLayout) => {
    setLayout(next);
    saveDiffLayout(next);
  };

  return (
    <div className="all-changes-view commit-changes-view">
      {compareFrom && (
        <div className="commit-compare-banner">
          <GitCompare size={14} className="commit-compare-banner-icon" />
          <span className="commit-compare-banner-title">提交间对比</span>
          <code title={compareFrom.hash}>{compareFrom.short_hash}</code>
          <ArrowRight size={12} className="commit-compare-banner-arrow" />
          <code title={commit.hash}>{commit.short_hash}</code>
          <span className="commit-compare-banner-subject" title={commit.subject}>
            {commit.subject}
          </span>
          {onClearCompare && (
            <button
              type="button"
              className="commit-compare-exit"
              onClick={onClearCompare}
              title="退出提交间对比"
            >
              <X size={12} />
              <span>退出对比</span>
            </button>
          )}
        </div>
      )}

      <div className="commit-changes-summary">
        <div className="commit-changes-subject">
          {commit.subject || "(no message)"}
        </div>

        {commit.body && (
          <button
            type="button"
            className="commit-changes-body-toggle"
            onClick={() => setBodyExpanded((v) => !v)}
          >
            {bodyExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {bodyExpanded ? "收起详情" : "展开详情"}
          </button>
        )}

        {commit.body && bodyExpanded && (
          <pre className="commit-changes-body">{commit.body}</pre>
        )}

        <div className="commit-changes-meta">
          <span className="commit-changes-meta-item" title="提交哈希">
            <GitCommit size={12} />
            <code>{commit.short_hash}</code>
          </span>
          <span className="commit-changes-meta-item" title="作者">
            <User size={12} />
            <span>{commit.author_name}</span>
            {commit.author_email && (
              <span className="commit-changes-muted">&lt;{commit.author_email}&gt;</span>
            )}
          </span>
          <span
            className="commit-changes-meta-item"
            title={new Date(commit.date).toLocaleString()}
          >
            <Clock size={12} />
            <span>{commit.date_relative}</span>
          </span>
          {commit.parent_count >= 2 && (
            <span className="commit-merge-badge">Merge</span>
          )}
          {!compareFrom && onCherryPick && (
            <button
              type="button"
              className="commit-cherry-pick-btn"
              onClick={() => onCherryPick(commit)}
              title="把该提交的改动应用到当前分支 (git cherry-pick)"
            >
              <GitCommitHorizontal size={12} />
              <span>Cherry-pick</span>
            </button>
          )}
        </div>
      </div>

      <div className="all-changes-toolbar">
        <span className="all-changes-title">
          {compareFrom ? "两个提交之间的变更" : "本次提交的变更"}
          <span className="all-changes-count">{files.length}</span>
        </span>
        <div className="diff-view-toggle">
          <button
            type="button"
            className={`diff-view-btn ${layout === "unified" ? "active" : ""}`}
            onClick={() => changeLayout("unified")}
            title="统一视图：增删行上下排列"
          >
            统一
          </button>
          <button
            type="button"
            className={`diff-view-btn ${layout === "split" ? "active" : ""}`}
            onClick={() => changeLayout("split")}
            title="双栏视图：原版本与新版本左右对比"
          >
            双栏
          </button>
        </div>
      </div>

      <div className="all-changes-scroll">
        {loading && (
          <div className="all-changes-loading">
            <Loader2 size={20} className="spin" />
            <span>正在加载提交内容…</span>
          </div>
        )}

        {!loading && loadError && (
          <div className="all-changes-loading" style={{ color: "var(--error-color)" }}>
            获取提交内容失败：{loadError}
          </div>
        )}

        {!loading && !loadError && files.length === 0 && (
          <div className="all-changes-loading">该提交没有变更文件</div>
        )}

        {!loading &&
          !loadError &&
          files.map((file) => {
            const badge = BADGES[file.status] ?? BADGES.modified;
            return (
              <section className="all-diff-file" key={file.path}>
                <div className="all-diff-file-header">
                  <span className={`file-badge ${badge.className}`}>{badge.text}</span>
                  {file.old_path && file.old_path !== file.path && (
                    <>
                      <span className="all-diff-file-old-path" title={file.old_path}>
                        {file.old_path}
                      </span>
                      <ArrowRight size={11} className="rename-arrow" />
                    </>
                  )}
                  <span className="all-diff-file-path" title={file.path}>
                    {file.path}
                  </span>
                  <span className="all-diff-file-stats">
                    {file.additions > 0 && (
                      <span className="stat-additions">+{file.additions}</span>
                    )}
                    {file.deletions > 0 && (
                      <span className="stat-deletions">-{file.deletions}</span>
                    )}
                  </span>
                </div>

                {errors[file.path] ? (
                  <div className="all-diff-error">获取 Diff 失败：{errors[file.path]}</div>
                ) : diffs[file.path] ? (
                  <DiffBody diff={diffs[file.path]} layout={layout} filePath={file.path} />
                ) : null}
              </section>
            );
          })}
      </div>
    </div>
  );
}
