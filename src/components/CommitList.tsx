import { useEffect, useRef, useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  GitCommit,
  GitCompare,
  GitBranch,
  Tag,
  GitPullRequest,
  CheckCircle2,
  Copy,
  Loader2,
} from "lucide-react";
import type { CommitInfo } from "../types";

interface Props {
  commits: CommitInfo[];
  selectedHash: string | null;
  loading: boolean;
  hasMore: boolean;
  onSelect: (commit: CommitInfo) => void;
  onLoadMore: () => void;
  /** 当前未提交变更涉及的文件数 */
  uncommittedCount: number;
  /** 是否选中并展开「未提交的变更」 */
  uncommittedSelected: boolean;
  onSelectUncommitted: () => void;
  /** 展开后显示在记录下方的变更文件操作列表 */
  uncommittedContent?: ReactNode;
  /** 当前选中的「提交间对比」基准提交 */
  compareBaseHash?: string | null;
  /** 设置 / 取消对比基准 */
  onToggleCompareBase?: (commit: CommitInfo) => void;
  /** 遴选当前提交到 HEAD */
  onCherryPick?: (commit: CommitInfo) => void;
  /** 检出当前提交 */
  onCheckout?: (commit: CommitInfo) => void;
  /** 基于此提交新建分支 */
  onCreateBranch?: (commit: CommitInfo) => void;
  /** 为此提交新建标签 */
  onCreateTag?: (commit: CommitInfo) => void;
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
  compareBase,
  onClick,
  onToggleCompareBase,
  onContextMenu,
}: {
  commit: CommitInfo;
  row: GraphRow;
  graphWidth: number;
  selected: boolean;
  compareBase: boolean;
  onClick: () => void;
  onToggleCompareBase: (commit: CommitInfo) => void;
  onContextMenu: (e: React.MouseEvent, commit: CommitInfo) => void;
}) {
  const isMerge = commit.parent_count >= 2;
  const nodeX = laneX(row.lane);
  const nodeY = ROW_HEIGHT / 2;
  const color = laneColor(row.lane);

  const handleCopyHash = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(commit.hash);
  };

  return (
    <div
      className={`commit-item ${selected ? "selected" : ""} ${compareBase ? "compare-base" : ""}`}
      onClick={onClick}
      onContextMenu={(e) => onContextMenu(e, commit)}
      title={`${commit.subject}\n作者: ${commit.author_name}\n哈希: ${commit.hash}`}
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
          <span
            className="commit-hash"
            title={`完整 SHA: ${commit.hash}\n点击复制`}
            onClick={handleCopyHash}
          >
            {commit.short_hash}
          </span>
          <span
            className="commit-author"
            title={`作者: ${commit.author_name} <${commit.author_email}>`}
          >
            {commit.author_name}
          </span>
          <span className="commit-date" title={formatDate(commit.date)}>
            {commit.date_relative}
          </span>
        </div>
      </div>

      <button
        type="button"
        className={`commit-compare-btn ${compareBase ? "active" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          onToggleCompareBase(commit);
        }}
        title={compareBase ? "取消对比基准" : "设为对比基准，再点击另一条提交进行对比"}
      >
        <GitCompare size={13} />
      </button>
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
  uncommittedCount,
  uncommittedSelected,
  onSelectUncommitted,
  uncommittedContent,
  compareBaseHash,
  onToggleCompareBase,
  onCherryPick,
  onCheckout,
  onCreateBranch,
  onCreateTag,
}: Props) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    commit: CommitInfo;
  } | null>(null);

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

  const handleContextMenu = useCallback((e: React.MouseEvent, commit: CommitInfo) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: Math.min(e.clientX, window.innerWidth - 240),
      y: Math.min(e.clientY, window.innerHeight - 260),
      commit,
    });
  }, []);

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
    return Math.min(maxLane + 1, MAX_LANES) * LANE_WIDTH + 4;
  }, [rows]);

  return (
    <div className="commit-list">
      {/* 未提交的变更：始终作为最新一条记录显示在历史最上方 */}
      <div
        className={`commit-item uncommitted-item ${uncommittedSelected ? "selected" : ""} ${
          uncommittedCount > 0 ? "has-changes" : "is-clean"
        }`}
        onClick={onSelectUncommitted}
        title={
          uncommittedCount > 0
            ? `工作区存在 ${uncommittedCount} 处未提交变更`
            : "工作区干净，无未提交变更"
        }
      >
        <div className="commit-item-graph commit-uncommitted-graph" style={{ width: graphWidth }}>
          {uncommittedCount > 0 ? (
            <FileCode2 size={15} className="uncommitted-icon-dirty" />
          ) : (
            <CheckCircle2 size={15} className="uncommitted-icon-clean" />
          )}
        </div>
        <div className="commit-item-content">
          <div className="commit-subject uncommitted-subject">
            <span>未提交的变更</span>
            {uncommittedCount > 0 && <span className="uncommitted-badge">{uncommittedCount}</span>}
          </div>
          <div className="commit-meta">
            <span className={`commit-uncommitted-count ${uncommittedCount > 0 ? "dirty" : "clean"}`}>
              {uncommittedCount > 0 ? `${uncommittedCount} 个文件修改` : "工作区干净 (Clean)"}
            </span>
            <span className="commit-uncommitted-hint">工作区 / 暂存区</span>
          </div>
        </div>
        <span className="commit-uncommitted-chevron">
          {uncommittedSelected ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </div>

      {/* 对比模式提示横条 */}
      {compareBaseHash && (
        <div className="commit-compare-banner">
          <div className="commit-compare-banner-left">
            <GitCompare size={13} className="commit-compare-banner-icon" />
            <span>
              对比基准：<code>{compareBaseHash.slice(0, 7)}</code>
            </span>
          </div>
          <button
            type="button"
            className="commit-compare-banner-clear"
            onClick={() => {
              const base = commits.find((c) => c.hash === compareBaseHash);
              if (base && onToggleCompareBase) onToggleCompareBase(base);
            }}
            title="退出对比模式"
          >
            取消
          </button>
        </div>
      )}

      {/* 折叠在「未提交的变更」记录下方：变更文件列表与文件操作 */}
      {uncommittedSelected && uncommittedContent && (
        <div className="commit-uncommitted-expand">{uncommittedContent}</div>
      )}

      {commits.map((commit, index) => (
        <CommitItem
          key={commit.hash}
          commit={commit}
          row={rows[index]}
          graphWidth={graphWidth}
          selected={selectedHash === commit.hash}
          compareBase={compareBaseHash === commit.hash}
          onClick={() => onSelect(commit)}
          onToggleCompareBase={onToggleCompareBase ?? (() => {})}
          onContextMenu={handleContextMenu}
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

      {!loading && commits.length === 0 && (
        <div className="commit-list-empty-inline">
          <GitCommit size={22} strokeWidth={1.5} style={{ opacity: 0.3 }} />
          <span>暂无提交记录</span>
        </div>
      )}

      {!loading && !hasMore && commits.length > 0 && (
        <div className="commit-list-end">— 已显示全部提交 —</div>
      )}

      {/* 提交右键上下文菜单 */}
      {contextMenu && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="context-menu-title" title={contextMenu.commit.subject}>
            {contextMenu.commit.short_hash} · {contextMenu.commit.subject || "(no message)"}
          </div>
          <button
            type="button"
            className="context-menu-item"
            onClick={() => {
              navigator.clipboard?.writeText(contextMenu.commit.short_hash);
              setContextMenu(null);
            }}
          >
            <Copy size={13} />
            <span>复制短哈希 ({contextMenu.commit.short_hash})</span>
          </button>
          <button
            type="button"
            className="context-menu-item"
            onClick={() => {
              navigator.clipboard?.writeText(contextMenu.commit.hash);
              setContextMenu(null);
            }}
          >
            <Copy size={13} />
            <span>复制完整 SHA</span>
          </button>
          <button
            type="button"
            className="context-menu-item"
            onClick={() => {
              navigator.clipboard?.writeText(contextMenu.commit.subject);
              setContextMenu(null);
            }}
          >
            <Copy size={13} />
            <span>复制提交说明</span>
          </button>
          <div className="toolbar-menu-divider" />
          <button
            type="button"
            className="context-menu-item"
            onClick={() => {
              onToggleCompareBase?.(contextMenu.commit);
              setContextMenu(null);
            }}
          >
            <GitCompare size={13} />
            <span>
              {compareBaseHash === contextMenu.commit.hash ? "取消对比基准" : "设为对比基准"}
            </span>
          </button>
          {onCherryPick && (
            <button
              type="button"
              className="context-menu-item"
              onClick={() => {
                onCherryPick(contextMenu.commit);
                setContextMenu(null);
              }}
            >
              <GitPullRequest size={13} />
              <span>遴选到当前分支 (Cherry-pick)</span>
            </button>
          )}
          {onCheckout && (
            <button
              type="button"
              className="context-menu-item"
              onClick={() => {
                onCheckout(contextMenu.commit);
                setContextMenu(null);
              }}
            >
              <GitCommit size={13} />
              <span>检出此提交 (Checkout)</span>
            </button>
          )}
          {onCreateBranch && (
            <button
              type="button"
              className="context-menu-item"
              onClick={() => {
                onCreateBranch(contextMenu.commit);
                setContextMenu(null);
              }}
            >
              <GitBranch size={13} />
              <span>基于此提交新建分支...</span>
            </button>
          )}
          {onCreateTag && (
            <button
              type="button"
              className="context-menu-item"
              onClick={() => {
                onCreateTag(contextMenu.commit);
                setContextMenu(null);
              }}
            >
              <Tag size={13} />
              <span>为此提交新建标签...</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
