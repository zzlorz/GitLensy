import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  Check,
  WrapText,
} from "lucide-react";
import { getFileDiff } from "../api/tauri";
import { DiffBody, saveDiffLayout } from "./DiffViewer";
import type { DiffLayout } from "./DiffViewer";
import type { ChangedFile, DiffView, FileDiff, FileStatus, GitStatus } from "../types";

interface Entry {
  file: ChangedFile;
  view: DiffView;
}

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

function entryKey(entry: Entry): string {
  return `${entry.view}:${entry.file.path}`;
}

/** 全部变更文件的左右对比视图：文件按顺序从上到下连续滚动 */
export default function AllChangesView({
  status,
  title = "所有变更文件",
}: {
  status: GitStatus;
  title?: string;
}) {
  // 全部变更对比默认双栏，每次打开都从双栏开始
  const [layout, setLayout] = useState<DiffLayout>("split");
  const [diffs, setDiffs] = useState<Record<string, FileDiff>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(new Set());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [wrap, setWrap] = useState(false);

  const entries = useMemo<Entry[]>(() => {
    const list: Entry[] = [];
    const seen = new Set<string>();
    for (const file of status.unstaged) {
      seen.add(file.path);
      list.push({ file, view: "unstaged" });
    }
    for (const file of status.staged) {
      if (seen.has(file.path)) continue;
      seen.add(file.path);
      list.push({ file, view: "staged" });
    }
    return list;
  }, [status]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const load = async () => {
      const diffMap: Record<string, FileDiff> = {};
      const errorMap: Record<string, string> = {};
      await Promise.all(
        entries.map(async (entry) => {
          const key = entryKey(entry);
          try {
            diffMap[key] = await getFileDiff(entry.file.path, entry.view);
          } catch (e) {
            errorMap[key] = e instanceof Error ? e.message : String(e);
          }
        }),
      );
      if (cancelled) return;
      setDiffs(diffMap);
      setErrors(errorMap);
      setLoading(false);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [entries]);

  const changeLayout = (next: DiffLayout) => {
    setLayout(next);
    saveDiffLayout(next);
  };

  const toggleCollapse = (key: string) => {
    setCollapsedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const allCollapsed = entries.length > 0 && collapsedKeys.size === entries.length;

  const toggleAllCollapse = () => {
    if (allCollapsed) {
      setCollapsedKeys(new Set());
    } else {
      setCollapsedKeys(new Set(entries.map((e) => entryKey(e))));
    }
  };

  const handleCopyPath = (e: React.MouseEvent, path: string, key: string) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(path);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const hasLoadedDiffs = Object.keys(diffs).length > 0;
  const showInitialLoading = loading && !hasLoadedDiffs;

  return (
    <div className="all-changes-view">
      <div className="all-changes-toolbar">
        <span className="all-changes-title">
          {title}
          <span className="all-changes-count">{entries.length}</span>
        </span>

        <div className="all-changes-toolbar-actions">
          {entries.length > 0 && (
            <button
              type="button"
              className="all-changes-tool-btn"
              onClick={toggleAllCollapse}
              title={allCollapsed ? "展开所有文件 Diff" : "折叠所有文件 Diff"}
            >
              {allCollapsed ? <ChevronsUpDown size={13} /> : <ChevronsDownUp size={13} />}
              <span>{allCollapsed ? "全部展开" : "全部折叠"}</span>
            </button>
          )}

          <button
            type="button"
            className={`all-changes-tool-btn ${wrap ? "active" : ""}`}
            onClick={() => setWrap((w) => !w)}
            title={wrap ? "取消自动换行" : "开启自动换行"}
          >
            <WrapText size={13} />
            <span>换行</span>
          </button>

          <div className="diff-view-toggle">
            <button
              className={`diff-view-btn ${layout === "unified" ? "active" : ""}`}
              onClick={() => changeLayout("unified")}
              title="统一视图：增删行上下排列"
            >
              统一
            </button>
            <button
              className={`diff-view-btn ${layout === "split" ? "active" : ""}`}
              onClick={() => changeLayout("split")}
              title="双栏视图：原版本与新版本左右对比"
            >
              双栏
            </button>
          </div>
        </div>
      </div>

      <div className="all-changes-scroll">
        {showInitialLoading && (
          <div className="all-changes-loading">
            <Loader2 size={20} className="spin" />
            <span>正在加载变更内容…</span>
          </div>
        )}

        {!showInitialLoading && entries.length === 0 && (
          <div className="all-changes-loading">当前没有变更文件</div>
        )}

        {!showInitialLoading &&
          entries.map((entry) => {
            const key = entryKey(entry);
            const status =
              entry.view === "unstaged"
                ? entry.file.unstaged_status ?? entry.file.status
                : entry.file.staged_status ?? entry.file.status;
            const badge = BADGES[status] ?? BADGES.modified;
            const isCollapsed = collapsedKeys.has(key);

            return (
              <section className="all-diff-file" key={key}>
                <div
                  className={`all-diff-file-header ${isCollapsed ? "collapsed" : ""}`}
                  onClick={() => toggleCollapse(key)}
                  title="点击折叠 / 展开此文件 Diff"
                >
                  <ChevronDown
                    size={14}
                    className={`all-diff-file-chevron ${isCollapsed ? "collapsed" : ""}`}
                  />
                  <span className={`file-badge ${badge.className}`}>{badge.text}</span>
                  <span className="all-diff-file-path" title={entry.file.path}>
                    {entry.file.path}
                  </span>
                  <button
                    type="button"
                    className="all-diff-copy-btn"
                    onClick={(e) => handleCopyPath(e, entry.file.path, key)}
                    title={copiedKey === key ? "已复制！" : "复制文件路径"}
                  >
                    {copiedKey === key ? (
                      <Check size={11} style={{ color: "var(--added-color)" }} />
                    ) : (
                      <Copy size={11} />
                    )}
                  </button>
                  <span className="all-diff-file-stats">
                    {entry.file.additions > 0 && (
                      <span className="stat-additions">+{entry.file.additions}</span>
                    )}
                    {entry.file.deletions > 0 && (
                      <span className="stat-deletions">-{entry.file.deletions}</span>
                    )}
                  </span>
                </div>

                {!isCollapsed &&
                  (errors[key] ? (
                    <div className="all-diff-error">获取 Diff 失败：{errors[key]}</div>
                  ) : diffs[key] ? (
                    <DiffBody
                      diff={diffs[key]}
                      layout={layout}
                      filePath={entry.file.path}
                      wrap={wrap}
                    />
                  ) : null)}
              </section>
            );
          })}
      </div>
    </div>
  );
}
