import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
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
export default function AllChangesView({ status }: { status: GitStatus }) {
  // 全部变更对比默认双栏，每次打开都从双栏开始
  const [layout, setLayout] = useState<DiffLayout>("split");
  const [diffs, setDiffs] = useState<Record<string, FileDiff>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

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

  return (
    <div className="all-changes-view">
      <div className="all-changes-toolbar">
        <span className="all-changes-title">
          所有变更文件
          <span className="all-changes-count">{entries.length}</span>
        </span>
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

      <div className="all-changes-scroll">
        {loading && (
          <div className="all-changes-loading">
            <Loader2 size={20} className="spin" />
            <span>正在加载变更内容…</span>
          </div>
        )}

        {!loading && entries.length === 0 && (
          <div className="all-changes-loading">当前没有变更文件</div>
        )}

        {!loading &&
          entries.map((entry) => {
            const key = entryKey(entry);
            const status = entry.view === "unstaged"
              ? entry.file.unstaged_status ?? entry.file.status
              : entry.file.staged_status ?? entry.file.status;
            const badge = BADGES[status] ?? BADGES.modified;
            return (
              <section className="all-diff-file" key={key}>
                <div className="all-diff-file-header">
                  <span className={`file-badge ${badge.className}`}>{badge.text}</span>
                  <span className="all-diff-file-path" title={entry.file.path}>
                    {entry.file.path}
                  </span>
                  <span className="all-diff-file-stats">
                    {entry.file.additions > 0 && (
                      <span className="stat-additions">+{entry.file.additions}</span>
                    )}
                    {entry.file.deletions > 0 && (
                      <span className="stat-deletions">-{entry.file.deletions}</span>
                    )}
                  </span>
                </div>
                {errors[key] ? (
                  <div className="all-diff-error">获取 Diff 失败：{errors[key]}</div>
                ) : diffs[key] ? (
                  <DiffBody diff={diffs[key]} layout={layout} />
                ) : null}
              </section>
            );
          })}
      </div>
    </div>
  );
}
