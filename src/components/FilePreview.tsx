import { useState, useEffect, useRef, useMemo } from "react";
import { readTextFile, readFile, stat } from "@tauri-apps/plugin-fs";
import { FileText, Image, Loader2, AlertTriangle, FileQuestion, X, ExternalLink } from "lucide-react";
import { getFileDiff, openInEditor } from "../api/tauri";
import type { ChangedFile, DiffView, FileDiff } from "../types";
import { ensureHighlightTheme, getExtension, highlightCode } from "../lib/highlight";

interface Props {
  fullPath: string;
  relPath: string;
  /** 该文件在 Git 中的变更信息；为 null 表示没有变更，不标注 */
  change?: ChangedFile | null;
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

export default function FilePreview({ fullPath, relPath, change }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<number>(0);
  const [content, setContent] = useState<string | null>(null);       // 原始文本
  const [highlighted, setHighlighted] = useState<string | null>(null); // 高亮后 HTML
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isTruncated, setIsTruncated] = useState(false);
  const [highlightLang, setHighlightLang] = useState<string | null>(null);
  const [fileType, setFileType] = useState<"text" | "image" | "binary" | "unknown">("unknown");
  const [changeMap, setChangeMap] = useState<ChangeMap>({ blocks: [], lineToBlock: new Map() });
  const [popover, setPopover] = useState<{ block: ChangeBlock; x: number; y: number } | null>(null);
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
      {/* 文件头 */}
      <div className="file-preview-header">
        <div className="file-preview-header-path" title={relPath}>
          {fileType === "image" ? (
            <Image size={14} />
          ) : fileType === "text" ? (
            <FileText size={14} />
          ) : (
            <FileQuestion size={14} />
          )}
          <span>{relPath}</span>
        </div>
        <div className="file-preview-header-meta">
          {highlightLang && fileType === "text" && (
            <span className="file-preview-meta-item">
              {highlightLang}
            </span>
          )}
          {fileSize > 0 && <span className="file-preview-meta-item">{formatSize(fileSize)}</span>}
          {hasChanges && (
            <span className="file-preview-meta-item file-preview-change-count">
              {changeMap.lineToBlock.size} 行变更
            </span>
          )}
          {isTruncated && <span className="file-preview-truncated-badge">已截断 (仅前 512KB)</span>}
          <button
            type="button"
            className="file-preview-action"
            title="在编辑器中打开文件"
            onClick={() =>
              openInEditor(fullPath).catch((err) =>
                window.alert(err instanceof Error ? err.message : String(err))
              )
            }
          >
            <ExternalLink size={13} />
          </button>
        </div>
      </div>

      {/* 内容 */}
      <div className="file-preview-body">
        {error && fileType !== "unknown" && (
          <div className="file-preview-read-error">
            <AlertTriangle size={14} />
            <span>{error}</span>
          </div>
        )}

        {fileType === "text" && highlighted !== null && (
          hasChanges ? (
            <pre className="file-preview-text file-preview-text-lines hljs" style={{ margin: 0, padding: "16px" }} onScroll={() => setPopover(null)}>
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
                      dangerouslySetInnerHTML={{ __html: lineHtml || "\u200b" }}
                    />
                  );
                })}
              </code>
            </pre>
          ) : (
            <pre className="file-preview-text hljs" style={{ margin: 0, padding: "16px" }}>
              <code dangerouslySetInnerHTML={{ __html: highlighted }} />
            </pre>
          )
        )}

        {fileType === "image" && imageUrl && (
          <div className="file-preview-image-wrap">
            <img src={imageUrl} alt={relPath} className="file-preview-image" />
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
