import { useState, useEffect, useRef, useMemo } from "react";
import { readTextFile, readFile, stat } from "@tauri-apps/plugin-fs";
import {
  FileText,
  Image as ImageIcon,
  Loader2,
  AlertTriangle,
  FileQuestion,
  X,
  ExternalLink,
  Copy,
  Check,
  Diff,
  WrapText,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { getFileDiff, openInEditor } from "../api/tauri";
import type { ChangedFile, DiffView, FileDiff } from "../types";
import { ensureHighlightTheme, getExtension, highlightCode } from "../lib/highlight";

interface Props {
  fullPath: string;
  relPath: string;
  /** 该文件在 Git 中的变更信息；为 null 表示没有变更，不标注 */
  change?: ChangedFile | null;
  /** 关闭预览回调（在文件夹树文件预览时提供） */
  onClose?: () => void;
  /** 切换到变更对比模式（当文件存在 Git 变更时提供） */
  onSwitchToDiff?: () => void;
}

// 文本文件扩展名（有高亮或需要纯文本展示）
const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "log", "json", "yaml", "yml", "toml", "ini", "cfg", "conf", "properties",
  "xml", "html", "htm", "css", "scss", "sass", "less",
  "js", "jsx", "ts", "tsx", "mjs", "cjs",
  "py", "pyw", "rb", "php", "java", "c", "h", "cpp", "cc", "hpp", "cs", "go", "rs", "swift", "kt", "kts",
  "sh", "bash", "zsh", "fish", "bat", "cmd", "ps1", "psm1",
  "sql", "graphql", "gql",
  "vue", "svelte",
  "env", "gitignore", "gitattributes", "editorconfig",
  "cmake", "gradle",
  "lock", "svg", "dockerfile", "nginx",
]);

// 图片扩展名
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "tiff", "tif", "avif"]);

const MAX_TEXT_SIZE = 512 * 1024;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface BlockLine {
  num: number;
  text: string;
}

/** 连续的删除 + 新增构成一个变更块 */
interface ChangeBlock {
  oldLines: BlockLine[];
  newLines: BlockLine[];
  hasOld: boolean;
}

interface ChangeMap {
  blocks: ChangeBlock[];
  /** 新文件行号 -> 变更块下标 */
  lineToBlock: Map<number, number>;
}

/** 把 Git Diff 的 hunk 拆成变更块，并建立新文件行号索引 */
function buildChangeMap(diff: FileDiff): ChangeMap {
  const blocks: ChangeBlock[] = [];
  const lineToBlock = new Map<number, number>();

  for (const hunk of diff.hunks) {
    let oldLines: BlockLine[] = [];
    let newLines: BlockLine[] = [];

    const flush = () => {
      if (oldLines.length === 0 && newLines.length === 0) return;
      const blockIndex = blocks.length;
      blocks.push({ oldLines, newLines, hasOld: oldLines.length > 0 });
      for (const line of newLines) lineToBlock.set(line.num, blockIndex);
      oldLines = [];
      newLines = [];
    };

    for (const line of hunk.lines) {
      if (line.type === "context") {
        // 上下文行说明一个变更块结束
        flush();
      } else if (line.type === "remove") {
        if (newLines.length > 0) flush();
        oldLines.push({ num: line.old_line_number, text: line.content });
      } else if (line.type === "add") {
        newLines.push({ num: line.new_line_number, text: line.content });
      }
    }
    flush();
  }

  return { blocks, lineToBlock };
}

/**
 * 把整段高亮 HTML 按行切分。
 * 跨行的 <span> 会在行尾闭合、在下一行开头重新打开，保证每行结构完整。
 */
function splitHighlightedLines(html: string): string[] {
  const parts = html.split("\n");
  const lines: string[] = [];
  const openStack: string[] = [];
  const tagRe = /<span[^>]*>|<\/span>/g;

  for (const part of parts) {
    const carried = openStack.join("");
    tagRe.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = tagRe.exec(part)) !== null) {
      if (match[0] === "</span>") {
        openStack.pop();
      } else {
        openStack.push(match[0]);
      }
    }
    lines.push(carried + part + "</span>".repeat(openStack.length));
  }

  return lines;
}

export default function FilePreview({
  fullPath,
  relPath,
  change,
  onClose,
  onSwitchToDiff,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<number>(0);
  const [content, setContent] = useState<string | null>(null);       // 原始文本
  const [highlighted, setHighlighted] = useState<string | null>(null); // 高亮后 HTML
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageDimensions, setImageDimensions] = useState<{ w: number; h: number } | null>(null);
  const [imageZoom, setImageZoom] = useState<"fit" | "original">("fit");
  const [isTruncated, setIsTruncated] = useState(false);
  const [highlightLang, setHighlightLang] = useState<string | null>(null);
  const [fileType, setFileType] = useState<"text" | "image" | "binary" | "unknown">("unknown");
  const [changeMap, setChangeMap] = useState<ChangeMap>({ blocks: [], lineToBlock: new Map() });
  const [popover, setPopover] = useState<{ block: ChangeBlock; x: number; y: number } | null>(null);
  const [copiedPath, setCopiedPath] = useState(false);
  const [copiedContent, setCopiedContent] = useState(false);
  const [wrapLines, setWrapLines] = useState(false);
  const objectUrlRef = useRef<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // 高亮主题由共享模块统一注入并跟随 data-theme 切换
  useEffect(() => {
    ensureHighlightTheme();
  }, []);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, []);

  // 文本内容变化时做高亮
  useEffect(() => {
    if (content === null) {
      setHighlighted(null);
      setHighlightLang(null);
      return;
    }
    const ext = getExtension(fullPath);
    const { html, language } = highlightCode(content, ext);
    setHighlighted(html);
    setHighlightLang(language);
  }, [content, fullPath]);

  // 加载该文件相对索引/工作区的变更，用于标注变更行
  useEffect(() => {
    setChangeMap({ blocks: [], lineToBlock: new Map() });
    setPopover(null);
    if (!change || fileType !== "text" || change.status === "conflict") return;

    // 工作区内容对应 unstaged diff；只有暂存区变更时，索引内容即磁盘内容
    const view: DiffView = change.has_unstaged_changes
      ? "unstaged"
      : change.has_staged_changes
        ? "staged"
        : "unstaged";

    let cancelled = false;
    getFileDiff(relPath.replace(/\\/g, "/"), view)
      .then((diff) => {
        if (!cancelled) setChangeMap(buildChangeMap(diff));
      })
      .catch(() => {
        // 取不到 diff 时保持无标注，不影响预览本身
      });

    return () => { cancelled = true; };
  }, [change, fileType, relPath]);

  // 点击变更行后的浮窗：点击外部或按 Esc 关闭
  useEffect(() => {
    if (!popover) return;

    const onMouseDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopover(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPopover(null);
    };

    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [popover]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setContent(null);
      setImageUrl(null);
      setImageDimensions(null);
      setImageZoom("fit");
      setIsTruncated(false);

      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }

      try {
        const ext = getExtension(fullPath);

        let info;
        try {
          info = await stat(fullPath);
          if (cancelled) return;
          setFileSize(info.size || 0);
        } catch {
          if (cancelled) return;
        }

        const size = info?.size || 0;

        if (IMAGE_EXTENSIONS.has(ext)) {
          if (size > MAX_IMAGE_SIZE) {
            if (cancelled) return;
            setFileType("image");
            setError(`文件过大 (${formatSize(size)})，超过 ${formatSize(MAX_IMAGE_SIZE)}，无法预览`);
            setLoading(false);
            return;
          }
          setFileType("image");
          const bytes = await readFile(fullPath);
          if (cancelled) return;
          const mimeType = ext === "svg" ? "image/svg+xml" : `image/${ext === "jpg" ? "jpeg" : ext}`;
          const blob = new Blob([bytes], { type: mimeType });
          const url = URL.createObjectURL(blob);
          objectUrlRef.current = url;
          setImageUrl(url);
        } else if (TEXT_EXTENSIONS.has(ext) || ext === "") {
          setFileType("text");
          const text = await readTextFile(fullPath);
          if (cancelled) return;
          if (text.length > MAX_TEXT_SIZE) {
            setContent(text.slice(0, MAX_TEXT_SIZE));
            setIsTruncated(true);
          } else {
            setContent(text);
          }
        } else {
          setFileType("binary");
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [fullPath]);

  const highlightedLines = useMemo(
    () => (highlighted !== null ? splitHighlightedLines(highlighted) : []),
    [highlighted],
  );
  const hasChanges = changeMap.lineToBlock.size > 0;

  /** 点击变更行：在鼠标位置弹出变更前/变更后对比浮窗 */
  const handleLineClick = (e: React.MouseEvent, blockIndex: number) => {
    const block = changeMap.blocks[blockIndex];
    if (!block) return;
    setPopover({ block, x: e.clientX, y: e.clientY });
  };

  const handleCopyPath = () => {
    navigator.clipboard?.writeText(relPath);
    setCopiedPath(true);
    setTimeout(() => setCopiedPath(false), 1500);
  };

  const handleCopyContent = () => {
    if (content === null) return;
    navigator.clipboard?.writeText(content);
    setCopiedContent(true);
    setTimeout(() => setCopiedContent(false), 1500);
  };

  if (loading) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon-wrapper">
          <Loader2 size={32} className="spin" />
        </div>
        <div className="empty-state-text">正在读取文件...</div>
        <div className="empty-state-sub">{relPath}</div>
      </div>
    );
  }

  if (error && fileType === "unknown") {
    return (
      <div className="file-preview-error">
        <div className="empty-state-icon-wrapper" style={{ color: "var(--error-color)" }}>
          <AlertTriangle size={28} strokeWidth={1.5} />
        </div>
        <div className="empty-state-text">无法读取文件</div>
        <div style={{ fontSize: 12, color: "var(--error-color)", textAlign: "center", maxWidth: 500 }}>
          {error}
        </div>
        <div className="empty-state-sub" style={{ fontFamily: "var(--font-mono)", fontSize: 11, wordBreak: "break-all" }}>
          {fullPath}
        </div>
      </div>
    );
  }

  return (
    <div className="file-preview">
      {/* 统一单层文件头 */}
      <div className="file-preview-header">
        <div className="file-preview-header-path" title={relPath}>
          {fileType === "image" ? (
            <ImageIcon size={14} className="file-preview-type-icon" />
          ) : fileType === "text" ? (
            <FileText size={14} className="file-preview-type-icon" />
          ) : (
            <FileQuestion size={14} className="file-preview-type-icon" />
          )}
          <span className="file-preview-path-text">{relPath}</span>
          <button
            type="button"
            className="file-preview-copy-btn"
            onClick={handleCopyPath}
            title={copiedPath ? "已复制文件路径！" : "复制相对路径"}
          >
            {copiedPath ? <Check size={12} style={{ color: "var(--added-color)" }} /> : <Copy size={12} />}
          </button>
        </div>

        <div className="file-preview-header-meta">
          {onSwitchToDiff && (
            <button
              type="button"
              className="file-preview-switch-btn"
              onClick={onSwitchToDiff}
              title="切换到变更对比视图"
            >
              <Diff size={12} />
              <span>变更对比</span>
            </button>
          )}

          {highlightLang && fileType === "text" && (
            <span className="file-preview-meta-item">
              {highlightLang}
            </span>
          )}

          {fileType === "image" && imageDimensions && (
            <span className="file-preview-meta-item">
              {imageDimensions.w} × {imageDimensions.h} px
            </span>
          )}

          {fileType === "image" && (
            <button
              type="button"
              className={`file-preview-action ${imageZoom === "original" ? "active" : ""}`}
              onClick={() => setImageZoom((z) => (z === "fit" ? "original" : "fit"))}
              title={imageZoom === "fit" ? "当前自适应窗口，点击切换至 1:1 原始尺寸" : "当前原始尺寸，点击自适应窗口"}
            >
              {imageZoom === "fit" ? <Maximize2 size={13} /> : <Minimize2 size={13} />}
            </button>
          )}

          {fileSize > 0 && <span className="file-preview-meta-item">{formatSize(fileSize)}</span>}

          {hasChanges && (
            <span className="file-preview-meta-item file-preview-change-count" title="该文件在工作区或暂存区中有变更">
              {changeMap.lineToBlock.size} 行变更
            </span>
          )}

          {isTruncated && <span className="file-preview-truncated-badge">已截断 (仅前 512KB)</span>}

          {fileType === "text" && (
            <>
              <button
                type="button"
                className={`file-preview-action ${wrapLines ? "active" : ""}`}
                onClick={() => setWrapLines((w) => !w)}
                title={wrapLines ? "取消换行（单行横向滚动）" : "自动换行"}
              >
                <WrapText size={13} />
              </button>
              <button
                type="button"
                className="file-preview-action"
                onClick={handleCopyContent}
                title={copiedContent ? "已复制全文！" : "复制代码全文"}
              >
                {copiedContent ? <Check size={13} style={{ color: "var(--added-color)" }} /> : <Copy size={13} />}
              </button>
            </>
          )}

          <button
            type="button"
            className="file-preview-action"
            title="在外部编辑器中打开文件"
            onClick={() =>
              openInEditor(fullPath).catch((err) =>
                window.alert(err instanceof Error ? err.message : String(err))
              )
            }
          >
            <ExternalLink size={13} />
          </button>

          {onClose && (
            <button
              type="button"
              className="file-preview-close-btn"
              onClick={onClose}
              title="关闭预览"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* 内容主体 */}
      <div className="file-preview-body">
        {error && fileType !== "unknown" && (
          <div className="file-preview-read-error">
            <AlertTriangle size={14} />
            <span>{error}</span>
          </div>
        )}

        {fileType === "text" && highlighted !== null && (
          <pre
            className={`file-preview-text file-preview-text-lines hljs ${wrapLines ? "wrap-lines" : ""}`}
            style={{ margin: 0, padding: 0 }}
            onScroll={() => setPopover(null)}
          >
            <code>
              {highlightedLines.map((lineHtml, i) => {
                const lineNo = i + 1;
                const blockIndex = changeMap.lineToBlock.get(lineNo);
                const isChanged = blockIndex !== undefined;
                const isModified = isChanged && changeMap.blocks[blockIndex].hasOld;
                const className = isChanged
                  ? `file-preview-line changed ${isModified ? "modified" : "added"}`
                  : "file-preview-line";
                return (
                  <div
                    key={lineNo}
                    className={className}
                    onClick={isChanged ? (e) => handleLineClick(e, blockIndex) : undefined}
                    title={isChanged ? "点击查看变更前后的代码" : undefined}
                  >
                    <span className="file-preview-line-num">{lineNo}</span>
                    <span
                      className="file-preview-line-content"
                      dangerouslySetInnerHTML={{ __html: lineHtml || "\u200b" }}
                    />
                  </div>
                );
              })}
            </code>
          </pre>
        )}

        {fileType === "image" && imageUrl && (
          <div className={`file-preview-image-wrap ${imageZoom === "original" ? "original-size" : "fit-size"}`}>
            <img
              src={imageUrl}
              alt={relPath}
              className="file-preview-image"
              onLoad={(e) => {
                const img = e.currentTarget;
                setImageDimensions({ w: img.naturalWidth, h: img.naturalHeight });
              }}
            />
          </div>
        )}

        {fileType === "binary" && !error && (
          <div className="empty-state">
            <div className="empty-state-icon-wrapper">
              <FileQuestion size={28} strokeWidth={1.5} />
            </div>
            <div className="empty-state-text">二进制文件</div>
            <div className="empty-state-sub">
              该文件类型暂不支持预览 ({getExtension(fullPath) || "无扩展名"})<br />
              {fileSize > 0 && formatSize(fileSize)}
            </div>
          </div>
        )}
      </div>

      {/* 变更行对比浮窗 */}
      {popover && (() => {
        const CARD_WIDTH = 460;
        const CARD_MAX_HEIGHT = 340;
        const GAP = 12;

        let left = popover.x + GAP;
        if (left + CARD_WIDTH > window.innerWidth - 8) left = popover.x - CARD_WIDTH - GAP;
        if (left < 8) left = 8;

        let top = popover.y + GAP;
        if (top + CARD_MAX_HEIGHT > window.innerHeight - 8) {
          top = Math.max(8, popover.y - CARD_MAX_HEIGHT - GAP);
        }

        return (
          <div className="file-preview-diff-popover" ref={popoverRef} style={{ left, top }}>
            <div className="file-preview-popover-header">
              <span>变更对比</span>
              <button
                type="button"
                className="file-preview-popover-close"
                onClick={() => setPopover(null)}
                title="关闭 (Esc)"
              >
                <X size={13} />
              </button>
            </div>
            <div className="file-preview-popover-body">
              {popover.block.oldLines.map((line) => (
                <div key={`old-${line.num}`} className="file-preview-popover-line removed">
                  <span className="file-preview-popover-num">{line.num}</span>
                  <span className="file-preview-popover-code">{line.text || "\u200b"}</span>
                </div>
              ))}
              {popover.block.newLines.map((line) => (
                <div key={`new-${line.num}`} className="file-preview-popover-line added">
                  <span className="file-preview-popover-num">{line.num}</span>
                  <span className="file-preview-popover-code">{line.text || "\u200b"}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
