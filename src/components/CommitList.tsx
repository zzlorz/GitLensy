import { useEffect, useRef, useCallback } from "react";
import { GitCommit, GitMerge, Loader2 } from "lucide-react";
import type { CommitInfo } from "../types";

interface Props {
  commits: CommitInfo[];
  selectedHash: string | null;
  loading: boolean;
  hasMore: boolean;
  onSelect: (commit: CommitInfo) => void;
  onLoadMore: () => void;
}

/** Format an ISO-8601 date string to a readable local date. */
function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function CommitItem({
  commit,
  selected,
  onClick,
}: {
  commit: CommitInfo;
  selected: boolean;
  onClick: () => void;
}) {
  const isMerge = commit.parent_count >= 2;

  return (
    <div
      className={`commit-item ${selected ? "selected" : ""}`}
      onClick={onClick}
      title={commit.hash}
    >
      <div className="commit-item-graph">
        <div className="commit-graph-line top" />
        <div className="commit-graph-dot">
          {isMerge ? (
            <GitMerge size={11} style={{ color: "var(--renamed-color)" }} />
          ) : (
            <GitCommit size={11} />
          )}
        </div>
        <div className="commit-graph-line bottom" />
      </div>

      <div className="commit-item-content">
        <div className="commit-subject" title={commit.subject}>
          {commit.subject || "(no message)"}
        </div>
        <div className="commit-meta">
          <span className="commit-hash">{commit.short_hash}</span>
          <span className="commit-author">{commit.author_name}</span>
          <span
            className="commit-date"
            title={formatDate(commit.date)}
          >
            {commit.date_relative}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function CommitList({
  commits,
  selectedHash,
  loading,
  hasMore,
  onSelect,
  onLoadMore,
}: Props) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Intersection observer for infinite scroll
  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0].isIntersecting && hasMore && !loading) {
        onLoadMore();
      }
    },
    [hasMore, loading, onLoadMore]
  );

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(handleObserver, { threshold: 0.1 });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [handleObserver]);

  if (!loading && commits.length === 0) {
    return (
      <div className="commit-list-empty">
        <GitCommit size={32} strokeWidth={1.5} style={{ opacity: 0.3 }} />
        <span>暂无匹配的提交记录</span>
      </div>
    );
  }

  return (
    <div className="commit-list">
      {commits.map((commit) => (
        <CommitItem
          key={commit.hash}
          commit={commit}
          selected={selectedHash === commit.hash}
          onClick={() => onSelect(commit)}
        />
      ))}

      {/* Sentinel element for infinite scroll trigger */}
      <div ref={sentinelRef} style={{ height: 1 }} />

      {loading && (
        <div className="commit-list-loading">
          <Loader2 size={14} className="spin" />
          <span>加载中...</span>
        </div>
      )}

      {!loading && !hasMore && commits.length > 0 && (
        <div className="commit-list-end">— 已显示全部提交 —</div>
      )}
    </div>
  );
}
