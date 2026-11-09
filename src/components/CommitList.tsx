import { useEffect, useRef, useCallback, useMemo } from "react";
import { GitCommit, Loader2 } from "lucide-react";
import type { CommitInfo } from "../types";

interface Props {
  commits: CommitInfo[];
  selectedHash: string | null;
  loading: boolean;
  hasMore: boolean;
  onSelect: (commit: CommitInfo) => void;
  onLoadMore: () => void;
}

/** 每一行提交固定的高度，用于绘制拓扑图的坐标计算 */
const ROW_HEIGHT = 52;
/** 单条分支车道宽度 */
const LANE_WIDTH = 13;
/** 最多绘制多少条车道（超出部分重叠绘制，避免列表被挤压） */
const MAX_LANES = 7;

const LANE_COLORS = [
  "#4f9cf7",
  "#e0a458",
  "#7bc47f",
  "#c586c0",
  "#e06c75",
  "#56b6c2",
  "#d7ba7d",
  "#9d7bd8",
];

/** 一行提交在拓扑图中的绘制信息 */
interface GraphRow {
  /** 提交自身所在车道 */
  lane: number;
  /** 顶部到底部竖直贯通的车道（其他分支经过本行） */
  pass: number[];
  /** 从顶部汇入本提交节点的车道（这些分支的下一个提交就是它） */
  incoming: number[];
  /** 从节点向下连到各父提交所在的车道 */
  outgoing: number[];
}

/**
 * 按提交顺序模拟 git log --graph 的车道分配。
 * lanes[i] 保存第 i 条车道正在等待（即将到达）的提交哈希。
 */
function computeGraph(commits: CommitInfo[]): GraphRow[] {
  const lanes: (string | null)[] = [];
  const rows: GraphRow[] = [];

  for (const commit of commits) {
    // 找到当前提交所在车道：已有车道在等它，否则复用空车道或新增
    let lane = lanes.findIndex((h) => h === commit.hash);
    if (lane === -1) {
      const free = lanes.findIndex((h) => h === null);
      if (free === -1) {
        lane = lanes.length;
        lanes.push(null);
      } else {
        lane = free;
      }
    }

    const before = lanes.slice();
    const incoming: number[] = [];
    for (let i = 0; i < before.length; i++) {
      if (i !== lane && before[i] === commit.hash) incoming.push(i);
    }

    // 等待本提交的车道都被消费，释放出来给父提交使用
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === commit.hash) lanes[i] = null;
    }

    // 依次为每个父提交分配车道：已有车道直接复用，否则占用空车道
    const outgoing: number[] = [];
    for (const parent of commit.parents) {
      const existing = lanes.findIndex((h) => h === parent);
      if (existing !== -1) {
        outgoing.push(existing);
        continue;
      }
      let target = lanes.findIndex((h) => h === null);
      if (target === -1) {
        target = lanes.length;
        lanes.push(null);
      }
      lanes[target] = parent;
      outgoing.push(target);
    }

    // 去掉尾部空车道，避免图形过宽
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();

    const pass: number[] = [];
    for (let i = 0; i < before.length; i++) {
      if (i === lane) continue;
      if (before[i] !== null && before[i] !== commit.hash) pass.push(i);
    }

    rows.push({ lane, pass, incoming, outgoing });
  }

  return rows;
}

const laneX = (lane: number) =>
  Math.min(lane, MAX_LANES - 1) * LANE_WIDTH + LANE_WIDTH / 2;

const laneColor = (lane: number) => LANE_COLORS[lane % LANE_COLORS.length];

function CommitItem({
  commit,
  row,
  graphWidth,
  selected,
  onClick,
}: {
  commit: CommitInfo;
  row: GraphRow;
  graphWidth: number;
  selected: boolean;
  onClick: () => void;
}) {
  const isMerge = commit.parent_count >= 2;
  const nodeX = laneX(row.lane);
  const nodeY = ROW_HEIGHT / 2;
  const color = laneColor(row.lane);

  return (
    <div
      className={`commit-item ${selected ? "selected" : ""}`}
      onClick={onClick}
      title={commit.hash}
    >
      <div className="commit-item-graph" style={{ width: graphWidth }}>
        <svg width={graphWidth} height={ROW_HEIGHT} className="commit-graph-svg">
          {/* 经过本行的其他分支 */}
          {row.pass.map((lane) => (
            <line
              key={`pass-${lane}`}
              x1={laneX(lane)}
              y1={0}
              x2={laneX(lane)}
              y2={ROW_HEIGHT}
              stroke={laneColor(lane)}
              strokeWidth={1.6}
              opacity={0.5}
            />
          ))}

          {/* 本提交自身车道的上半段 */}
          <line x1={nodeX} y1={0} x2={nodeX} y2={nodeY} stroke={color} strokeWidth={1.6} />

          {/* 汇入本提交的其他分支 */}
          {row.incoming.map((lane) => (
            <path
              key={`in-${lane}`}
              d={`M ${laneX(lane)} 0 Q ${laneX(lane)} ${nodeY} ${nodeX} ${nodeY}`}
              fill="none"
              stroke={laneColor(lane)}
              strokeWidth={1.6}
              opacity={0.85}
            />
          ))}

          {/* 节点向下连接各父提交 */}
          {row.outgoing.map((lane, index) =>
            lane === row.lane ? (
              <line
                key={`out-${lane}-${index}`}
                x1={nodeX}
                y1={nodeY}
                x2={nodeX}
                y2={ROW_HEIGHT}
                stroke={color}
                strokeWidth={1.6}
              />
            ) : (
              <path
                key={`out-${lane}-${index}`}
                d={`M ${nodeX} ${nodeY} Q ${laneX(lane)} ${nodeY} ${laneX(lane)} ${ROW_HEIGHT}`}
                fill="none"
                stroke={laneColor(lane)}
                strokeWidth={1.6}
              />
            )
          )}

          {/* 合并提交用空心圆，普通提交用实心圆 */}
          <circle
            cx={nodeX}
            cy={nodeY}
            r={isMerge ? 3.5 : 4}
            fill={isMerge ? "var(--bg-primary)" : color}
            stroke={color}
            strokeWidth={isMerge ? 2 : 0}
          />
        </svg>
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

  const rows = useMemo(() => computeGraph(commits), [commits]);
  const graphWidth = useMemo(() => {
    let maxLane = 0;
    for (const row of rows) {
      maxLane = Math.max(maxLane, row.lane, ...row.pass, ...row.incoming, ...row.outgoing);
    }
    return (Math.min(maxLane + 1, MAX_LANES)) * LANE_WIDTH + 4;
  }, [rows]);

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
      {commits.map((commit, index) => (
        <CommitItem
          key={commit.hash}
          commit={commit}
          row={rows[index]}
          graphWidth={graphWidth}
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
