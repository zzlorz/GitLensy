import { useState, useEffect, useRef, useMemo } from "react";
import { readTextFile, readFile, stat } from "@tauri-apps/plugin-fs";
import { FileText, Image, Loader2, AlertTriangle, FileQuestion, X } from "lucide-react";
import { getFileDiff } from "../api/tauri";
import type { ChangedFile, DiffView, FileDiff } from "../types";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import php from "highlight.js/lib/languages/php";
import ruby from "highlight.js/lib/languages/ruby";
import swift from "highlight.js/lib/languages/swift";
import kotlin from "highlight.js/lib/languages/kotlin";
import html from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import scss from "highlight.js/lib/languages/scss";
import json from "highlight.js/lib/languages/json";
import yaml from "highlight.js/lib/languages/yaml";
import ini from "highlight.js/lib/languages/ini";
import bash from "highlight.js/lib/languages/bash";
import sql from "highlight.js/lib/languages/sql";
import markdown from "highlight.js/lib/languages/markdown";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import nginx from "highlight.js/lib/languages/nginx";
import gradle from "highlight.js/lib/languages/gradle";
import cmake from "highlight.js/lib/languages/cmake";
import less from "highlight.js/lib/languages/less";
import githubDark from "highlight.js/styles/github-dark.css?inline";
import githubLight from "highlight.js/styles/github.css?inline";

// 注册高亮语言
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("jsx", javascript);
hljs.registerLanguage("mjs", javascript);
hljs.registerLanguage("cjs", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("tsx", typescript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("py", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("rs", rust);
hljs.registerLanguage("go", go);
hljs.registerLanguage("java", java);
hljs.registerLanguage("c", c);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("hpp", cpp);
hljs.registerLanguage("csharp", csharp);
hljs.registerLanguage("cs", csharp);
hljs.registerLanguage("php", php);
hljs.registerLanguage("ruby", ruby);
hljs.registerLanguage("rb", ruby);
hljs.registerLanguage("swift", swift);
hljs.registerLanguage("kotlin", kotlin);
hljs.registerLanguage("kt", kotlin);
hljs.registerLanguage("kts", kotlin);
hljs.registerLanguage("html", html);
hljs.registerLanguage("htm", html);
hljs.registerLanguage("xml", html);
hljs.registerLanguage("svg", html);
hljs.registerLanguage("vue", html); // vue 文件用 xml/html 语法高亮近似
hljs.registerLanguage("css", css);
hljs.registerLanguage("scss", scss);
hljs.registerLanguage("less", less);
hljs.registerLanguage("json", json);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("yml", yaml);
hljs.registerLanguage("ini", ini);
hljs.registerLanguage("cfg", ini);
hljs.registerLanguage("conf", ini);
hljs.registerLanguage("properties", ini);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("sh", bash);
hljs.registerLanguage("zsh", bash);
hljs.registerLanguage("fish", bash);
hljs.registerLanguage("cmd", bash);
hljs.registerLanguage("bat", bash);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("md", markdown);
hljs.registerLanguage("dockerfile", dockerfile);
hljs.registerLanguage("nginx", nginx);
hljs.registerLanguage("gradle", gradle);
hljs.registerLanguage("cmake", cmake);

interface Props {
  fullPath: string;
  relPath: string;
  /** 该文件在 Git 中的变更信息；为 null 表示没有变更，不标注 */
  change?: ChangedFile | null;
}

// 扩展名 → 高亮语言名的映射（没有注册的返回 null → 自动检测 / 纯文本）
const EXT_TO_LANG: Record<string, string> = {
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  ts: "typescript", tsx: "typescript",
  py: "python", pyw: "python",
  rs: "rust",
  go: "go",
  java: "java",
  c: "c", h: "c",
  cpp: "cpp", cc: "cpp", hpp: "cpp",
  cs: "csharp",
  php: "php",
  rb: "ruby",
  swift: "swift",
  kt: "kotlin", kts: "kotlin",
  html: "html", htm: "html",
  xml: "xml", svg: "xml",
  vue: "html",
  css: "css",
  scss: "scss", sass: "scss", less: "css",
  json: "json",
  yaml: "yaml", yml: "yaml",
  ini: "ini", cfg: "ini", conf: "ini", properties: "ini",
  toml: "toml",
  sh: "bash", bash: "bash", zsh: "bash", fish: "bash",
  ps1: "bash", psm1: "bash", cmd: "bash", bat: "bash",
  sql: "sql",
  md: "markdown", markdown: "markdown",
  dockerfile: "dockerfile",
  nginx: "nginx",
};

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

function getExtension(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  const fileName = lastSlash !== -1 ? normalized.slice(lastSlash + 1) : normalized;
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex === -1) return "";
  return fileName.slice(dotIndex + 1).toLowerCase();
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 用 highlight.js 生成高亮 HTML；失败则返回纯文本 HTML */
function highlightCode(code: string, ext: string): { html: string; language: string | null } {
  const lang = EXT_TO_LANG[ext] ?? null;
  try {
    if (lang && hljs.getLanguage(lang)) {
      const result = hljs.highlight(code, { language: lang, ignoreIllegals: true });
      return { html: result.value, language: lang };
    }
    // 自动检测
    const result = hljs.highlightAuto(code);
    return { html: result.value, language: result.language ?? null };
  } catch {
    // 兜底：转义后直接展示
    return { html: code.replace(/[<>]/g, (c) => (c === "<" ? "&lt;" : "&gt;")), language: null };
  }
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

  // 根据应用主题动态切换 highlight.js 主题
  useEffect(() => {
    const styleId = "hljs-theme";
    const getThemeStyle = () => {
      const t = document.documentElement.getAttribute("data-theme");
      return t === "light" ? githubLight : githubDark;
    };

    let style = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = styleId;
      document.head.appendChild(style);
    }
    style.textContent = getThemeStyle();

    // 监听 data-theme 属性变化（系统主题变化也会触发 App.tsx 里的 applyTheme → 写 data-theme）
    const observer = new MutationObserver(() => {
      if (style) style.textContent = getThemeStyle();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    return () => {
      observer.disconnect();
      // 不删除 style —— 其他 FilePreview 实例可能还在用
    };
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
