import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { readFile } from "@tauri-apps/plugin-fs";
import {
  FileCode2,
  ArrowRight,
  Copy,
  Check,
  CheckCircle2,
  AlertTriangle,
  Binary,
  ChevronDown,
  ExternalLink,
  Hash,
  WrapText,
  Image as ImageIcon,
  Maximize2,
  Minimize2,
} from "lucide-react";
import type { FileDiff, ChangedFile, DiffView, DiffHunk, DiffLine } from "../types";
import { openPath } from "../api/tauri";
import type { OpenMethod } from "../api/tauri";
import { highlightLine, languageForPath, getExtension } from "../lib/highlight";

const IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "tiff", "tif", "avif"
]);

/** 预览页「打开方式」下拉选项 */
const OPEN_METHODS: { id: OpenMethod; label: string }[] = [
  { id: "editor", label: "VS Code" },
  { id: "explorer", label: "文件资源管理器" },
  { id: "system", label: "默认应用" },
];

interface Props {
  diff: FileDiff;
  file: ChangedFile;
  view: DiffView;
  onViewChange: (view: DiffView) => void;
  /** 覆盖右上角的 diff 来源说明（例如历史视图里显示「本次提交」） */
  contextLabel?: string;
  /** 仓库根目录；提供时在头部显示「打开方式」（历史提交视图不传） */
  repoPath?: string;
  /** 切换到完整文件内容预览（单文件视图提供） */
  onSwitchToFile?: () => void;
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    modified: "已修改 (Modified)",
    added: "新添加 (Added)",
    deleted: "已删除 (Deleted)",
    renamed: "重命名 (Renamed)",
    copied: "已复制 (Copied)",
    conflict: "存在冲突 (Conflict)",
    untracked: "未跟踪 (Untracked)",
  };
  return labels[status] || status;
}

export type DiffLayout = "unified" | "split";
const LAYOUT_KEY = "gitlensy:diffLayout";

/** 读取用户上次选择的 diff 布局 */
export function getSavedDiffLayout(): DiffLayout {
  return localStorage.getItem(LAYOUT_KEY) === "split" ? "split" : "unified";
}

/** 记住 diff 布局选择 */
export function saveDiffLayout(layout: DiffLayout): void {
  localStorage.setItem(LAYOUT_KEY, layout);
}

interface SplitRow {
  left?: DiffLine;
  right?: DiffLine;
}

/** 把 hunk 内的删除行与新增行按下标配对，供左右双栏渲染 */
function buildSplitRows(hunk: DiffHunk): SplitRow[] {
  const rows: SplitRow[] = [];
  const lines = hunk.lines;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.type === "context") {
      rows.push({ left: line, right: line });
      i += 1;
      continue;
    }
    const removes: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (i < lines.length && lines[i].type === "remove") {
      removes.push(lines[i]);
      i += 1;
    }
    while (i < lines.length && lines[i].type === "add") {
      adds.push(lines[i]);
      i += 1;
    }
    if (removes.length === 0 && adds.length === 0) {
      i += 1;
      continue;
    }
    const count = Math.max(removes.length, adds.length);
    for (let k = 0; k < count; k += 1) {
      rows.push({ left: removes[k], right: adds[k] });
    }
  }
  return rows;
}

export default function DiffViewer({
  diff,
  file,
  view,
  onViewChange,
  contextLabel,
  repoPath,
  onSwitchToFile,
}: Props) {
  const [copied, setCopied] = useState(false);
  // 单文件视图默认统一单栏，不再沿用上次的双栏选择
  const [layout, setLayout] = useState<DiffLayout>("unified");
  const [openMenuOpen, setOpenMenuOpen] = useState(false);
  const [wrap, setWrap] = useState(false);
  const openMenuRef = useRef<HTMLDivElement>(null);
  const changeLayout = (next: DiffLayout) => {
    setLayout(next);
    saveDiffLayout(next);
  };

  // 每次点击（切换）文件都回到统一单栏视图
  useEffect(() => {
    setLayout("unified");
    setOpenMenuOpen(false);
  }, [file.path]);

  // 点击外部关闭「打开方式」下拉
  useEffect(() => {
    if (!openMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (openMenuRef.current && !openMenuRef.current.contains(e.target as Node)) {
        setOpenMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [openMenuOpen]);

  const displayPath = diff.new_path !== "/dev/null" ? diff.new_path : diff.old_path;
  const displayStatus = file.staged_status || file.unstaged_status || file.status || "modified";
  const hasBoth = file.has_staged_changes && file.has_unstaged_changes;
  const isDeleted = file.staged_status === "deleted" || file.unstaged_status === "deleted";

  const handleOpenWith = async (method: OpenMethod) => {
    if (!repoPath) return;
    setOpenMenuOpen(false);
    const root = repoPath.replace(/[\\/]+$/, "");
    try {
      await openPath(`${root}/${file.path}`, method);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    }
  };

  const handleCopyPath = () => {
    navigator.clipboard.writeText(displayPath);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      <div className="diff-header">
        <div className="diff-header-top">
          <div className="diff-path" title={displayPath}>
            <FileCode2 size={16} className="diff-path-icon" />
            {diff.old_path !== diff.new_path &&
              diff.old_path !== "/dev/null" &&
              diff.new_path !== "/dev/null" && (
                <>
                  <span style={{ color: "var(--text-muted)" }}>{diff.old_path}</span>
                  <ArrowRight size={13} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                </>
              )}
            <span>{displayPath}</span>
            <button
              className="diff-copy-btn"
              onClick={handleCopyPath}
              title={copied ? "已复制！" : "复制文件路径"}
            >
              {copied ? <Check size={13} style={{ color: "var(--added-color)" }} /> : <Copy size={13} />}
            </button>
          </div>

          {/* 差异对比 ↔ 完整文件切换 */}
          {onSwitchToFile && (
            <div className="diff-view-toggle">
              <button
                type="button"
                className="diff-view-btn active"
                title="当前为变更对比视图"
              >
                差异对比
              </button>
              <button
                type="button"
                className="diff-view-btn"
                onClick={onSwitchToFile}
                title="查看该文件的完整源码内容"
              >
                完整文件
              </button>
            </div>
          )}

          {hasBoth && (
            <div className="diff-view-toggle">
              <button
                className={`diff-view-btn ${view === "unstaged" ? "active" : ""}`}
                onClick={() => onViewChange("unstaged")}
              >
                工作区 (Working)
              </button>
              <button
                className={`diff-view-btn ${view === "staged" ? "active" : ""}`}
                onClick={() => onViewChange("staged")}
              >
                暂存区 (Index)
              </button>
            </div>
          )}

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

        <div className="diff-info">
          <div className="diff-status-pill">
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                backgroundColor: `var(--${displayStatus}-color, var(--text-secondary))`,
              }}
            />
            <span>{statusLabel(displayStatus)}</span>
          </div>

          {!diff.is_binary && (
            <>
              {diff.additions > 0 && (
                <span className="diff-stat-pill add">+{diff.additions}</span>
              )}
              {diff.deletions > 0 && (
                <span className="diff-stat-pill del">-{diff.deletions}</span>
              )}
            </>
          )}

          <button
            type="button"
            className={`diff-toolbar-btn ${wrap ? "active" : ""}`}
            onClick={() => setWrap((w) => !w)}
            title={wrap ? "取消自动换行（单行横向滚动）" : "开启自动换行（防止超长代码被遮挡）"}
          >
            <WrapText size={12} />
            <span>换行</span>
          </button>

          {repoPath && !isDeleted && (
            <div className="diff-open-with" ref={openMenuRef}>
              <button
                type="button"
                className={`diff-open-with-btn ${openMenuOpen ? "open" : ""}`}
                onClick={() => setOpenMenuOpen((v) => !v)}
                title="选择打开方式"
              >
                <ExternalLink size={11} />
                <span>打开方式</span>
                <ChevronDown size={11} />
              </button>
              {openMenuOpen && (
                <div className="diff-open-with-menu">
                  {OPEN_METHODS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="diff-open-with-item"
                      onClick={() => handleOpenWith(item.id)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {!hasBoth && (
            <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-muted)" }}>
              {contextLabel ?? (view === "staged" ? "暂存区变更 (Staged)" : "工作区未暂存 (Unstaged)")}
            </span>
          )}
        </div>
      </div>

      <DiffBody
        diff={diff}
        layout={layout}
        filePath={displayPath}
        wrap={wrap}
        repoPath={repoPath}
      />
    </>
  );
}

/** 图片文件在 Diff 区域内的展示 */
function ImageDiffBody({
  repoPath,
  filePath,
}: {
  repoPath?: string;
  filePath?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [dim, setDim] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState<"fit" | "original">("fit");
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!repoPath || !filePath) return;
    let cancelled = false;
    const full = `${repoPath.replace(/[\\/]+$/, "")}/${filePath}`;
    const ext = getExtension(filePath);

    readFile(full)
      .then((bytes) => {
        if (cancelled) return;
        const mime =
          ext === "svg" ? "image/svg+xml" : `image/${ext === "jpg" ? "jpeg" : ext}`;
        const blob = new Blob([bytes], { type: mime });
        const objUrl = URL.createObjectURL(blob);
        urlRef.current = objUrl;
        setUrl(objUrl);
      })
      .catch((e) => {
        if (!cancelled) setLoadErr(e instanceof Error ? e.message : String(e));
      });

    return () => {
      cancelled = true;
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, [repoPath, filePath]);

  if (loadErr || !url) {
    return (
      <div className="binary-notice">
        <ImageIcon size={36} strokeWidth={1.5} />
        <div>图片文件：{filePath}</div>
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {loadErr || "正在读取图片数据..."}
        </div>
      </div>
    );
  }

  return (
    <div className={`diff-image-preview-wrap ${zoom === "original" ? "original-size" : "fit-size"}`}>
      <div className="diff-image-toolbar">
        <span className="diff-image-info">
          图片预览 {dim ? `(${dim.w} × ${dim.h} px)` : ""}
        </span>
        <button
          type="button"
          className={`diff-toolbar-btn ${zoom === "original" ? "active" : ""}`}
          onClick={() => setZoom((z) => (z === "fit" ? "original" : "fit"))}
          title={zoom === "fit" ? "自适应窗口，点击切换至 1:1 原始尺寸" : "原始尺寸，点击切换至自适应窗口"}
        >
          {zoom === "fit" ? <Maximize2 size={12} /> : <Minimize2 size={12} />}
          <span>{zoom === "fit" ? "自适应" : "1:1"}</span>
        </button>
      </div>
      <div className="diff-image-canvas">
        <img
          src={url}
          alt={filePath}
          className="diff-image"
          onLoad={(e) => {
            const img = e.currentTarget;
            setDim({ w: img.naturalWidth, h: img.naturalHeight });
          }}
        />
      </div>
    </div>
  );
}

/** 单行 Diff 内容：有可用语言时渲染 highlight.js 的高亮 HTML，否则纯文本 */
function DiffLineContent({
  content,
  language,
}: {
  content: string;
  language: string | null;
}) {
  const html = highlightLine(content, language);
  if (html === null) {
    return (
      <span className="diff-line-content" title={content}>
        {content || " "}
      </span>
    );
  }
  return (
    <span
      className="diff-line-content diff-line-highlighted"
      title={content}
      dangerouslySetInnerHTML={{ __html: html || " " }}
    />
  );
}

/** 文件 diff 内容区（供单文件视图与全部变更视图复用） */
export function DiffBody({
  diff,
  layout,
  filePath,
  wrap = false,
  repoPath,
}: {
  diff: FileDiff;
  layout: DiffLayout;
  /** 用于推断语法高亮语言的文件路径 */
  filePath?: string;
  wrap?: boolean;
  repoPath?: string;
}) {
  const language = useMemo(
    () => (filePath ? languageForPath(filePath) : null),
    [filePath],
  );

  const isImageFile = filePath ? IMAGE_EXTENSIONS.has(getExtension(filePath)) : false;

  return (
    <div className={`diff-content ${wrap ? "diff-wrap-lines" : ""}`}>
      {diff.is_binary && isImageFile && (
        <ImageDiffBody repoPath={repoPath} filePath={filePath} />
      )}

      {diff.is_binary && !isImageFile && (
        <div className="binary-notice">
          <Binary size={36} strokeWidth={1.5} />
          <div>二进制文件，无法展示文本 Diff</div>
        </div>
      )}

      {!diff.is_binary && diff.hunks.length === 0 && !diff.error && (
        <div className="empty-state" style={{ height: "auto", padding: 48 }}>
          <div className="empty-state-icon-wrapper" style={{ color: "var(--added-color)" }}>
            <CheckCircle2 size={32} strokeWidth={1.5} />
          </div>
          <div className="empty-state-text">无内容变动</div>
          <div className="empty-state-sub">文件内容与基准版本一致</div>
        </div>
      )}

      {diff.error && (
        <div className="empty-state" style={{ height: "auto", padding: 48 }}>
          <div className="empty-state-icon-wrapper" style={{ color: "var(--error-color)" }}>
            <AlertTriangle size={32} strokeWidth={1.5} />
          </div>
          <div className="empty-state-text">获取 Diff 失败</div>
          <div style={{ fontSize: 12, color: "var(--error-color)", maxWidth: 440, textAlign: "center", marginTop: 4 }}>
            {diff.error}
          </div>
        </div>
      )}

      {!diff.is_binary && layout === "unified" && (
        <div className="diff-table">
          {diff.hunks.map((hunk, hunkIndex) => (
            <div key={hunkIndex} className="diff-hunk">
              <div className="diff-hunk-header">
                <Hash size={12} style={{ color: "var(--text-muted)" }} />
                <span>
                  @@ -{hunk.old_start},{hunk.old_lines} +{hunk.new_start},{hunk.new_lines} @@
                </span>
              </div>
              {hunk.lines.map((line, lineIndex) => (
                <div key={lineIndex} className={`diff-line ${line.type}`}>
                  <span className="diff-line-num">
                    {line.type === "add" ? "" : line.old_line_number > 0 ? line.old_line_number : ""}
                  </span>
                  <span className="diff-line-num">
                    {line.type === "remove" ? "" : line.new_line_number > 0 ? line.new_line_number : ""}
                  </span>
                  <DiffLineContent content={line.content} language={language} />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {!diff.is_binary && layout === "split" && (
        <div className="diff-split">
          {diff.hunks.map((hunk, hunkIndex) => {
            const rows = buildSplitRows(hunk);
            return (
              <Fragment key={hunkIndex}>
                <div className="diff-hunk-header diff-split-header">
                  <Hash size={12} style={{ color: "var(--text-muted)" }} />
                  <span>
                    @@ -{hunk.old_start},{hunk.old_lines} +{hunk.new_start},{hunk.new_lines} @@
                  </span>
                </div>
                {rows.map((row, rowIndex) => (
                  <Fragment key={rowIndex}>
                    <div
                      className={`diff-split-cell diff-split-left ${row.left ? row.left.type : "empty"}`}
                    >
                      <span className="diff-line-num">
                        {row.left && row.left.old_line_number > 0 ? row.left.old_line_number : ""}
                      </span>
                      <DiffLineContent
                        content={row.left ? row.left.content : ""}
                        language={language}
                      />
                    </div>
                    <div
                      className={`diff-split-cell diff-split-right ${row.right ? row.right.type : "empty"}`}
                    >
                      <span className="diff-line-num">
                        {row.right && row.right.new_line_number > 0 ? row.right.new_line_number : ""}
                      </span>
                      <DiffLineContent
                        content={row.right ? row.right.content : ""}
                        language={language}
                      />
                    </div>
                  </Fragment>
                ))}
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
