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
import { useI18n } from "../i18n";

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
  title,
}: {
  status: GitStatus;
  title?: string;
}) {
  const { t } = useI18n();
  // 全部变更对比默认双栏，每次打开都从双栏开始
  const [layout, setLayout] = useState<DiffLayout>("split");
  const [diffs, setDiffs] = useState<Record<string, FileDiff>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(new Set());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [wrap, setWrap] = useState(false);

  const displayTitle = title ?? t("allChanges.allChangesTitle");

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
          {displayTitle}
          <span className="all-changes-count">{entries.length}</span>
        </span>

        <div className="all-changes-toolbar-actions">
          {entries.length > 0 && (
            <button
              type="button"
              className="all-changes-tool-btn"
              onClick={toggleAllCollapse}
              title={allCollapsed ? t("allChanges.expandAllTooltip") : t("allChanges.collapseAllTooltip")}
            >
              {allCollapsed ? <ChevronsUpDown size={13} /> : <ChevronsDownUp size={13} />}
              <span>{allCollapsed ? t("allChanges.expandAll") : t("allChanges.collapseAll")}</span>
            </button>
          )}

          <button
            type="button"
            className={`all-changes-tool-btn ${wrap ? "active" : ""}`}
            onClick={() => setWrap((w) => !w)}
            title={wrap ? t("diff.wrapLinesOff") : t("diff.wrapLinesOn")}
          >
            <WrapText size={13} />
            <span>{t("diff.wrapLines")}</span>
          </button>

          <div className="diff-view-toggle">
            <button
              className={`diff-view-btn ${layout === "unified" ? "active" : ""}`}
              onClick={() => changeLayout("unified")}
              title={t("diff.unifiedTooltip")}
            >
              {t("diff.unified")}
            </button>
            <button
              className={`diff-view-btn ${layout === "split" ? "active" : ""}`}
              onClick={() => changeLayout("split")}
              title={t("diff.splitTooltip")}
            >
              {t("diff.split")}
            </button>
          </div>
        </div>
      </div>

      <div className="all-changes-scroll">
        {showInitialLoading && (
          <div className="all-changes-loading">
            <Loader2 size={20} className="spin" />
            <span>{t("allChanges.loadingChanges")}</span>
          </div>
        )}

        {!showInitialLoading && entries.length === 0 && (
          <div className="all-changes-loading">{t("allChanges.noChangedFiles")}</div>
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
                  title={t("allChanges.toggleFileCollapseTooltip")}
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
                    title={copiedKey === key ? t("common.copied") : t("diff.copyFilePath")}
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
                    <div className="all-diff-error">{t("allChanges.getDiffFailed")}{errors[key]}</div>
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
