// 共享的 highlight.js 配置与工具函数。
// FilePreview（文件预览）与 DiffViewer（Diff 语法高亮）共用同一套语言注册和主题。
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
import toml from "highlight.js/lib/languages/ini";
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
hljs.registerLanguage("toml", toml);
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
  toml: "ini",
  sh: "bash", bash: "bash", zsh: "bash", fish: "bash",
  ps1: "bash", psm1: "bash", cmd: "bash", bat: "bash",
  sql: "sql",
  md: "markdown", markdown: "markdown",
  dockerfile: "dockerfile",
  nginx: "nginx",
};

/** 取小写扩展名 */
export function getExtension(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  const fileName = lastSlash !== -1 ? normalized.slice(lastSlash + 1) : normalized;
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex === -1) return "";
  return fileName.slice(dotIndex + 1).toLowerCase();
}

/** 根据文件路径推断 highlight.js 语言名 */
export function languageForPath(path: string): string | null {
  const lang = EXT_TO_LANG[getExtension(path)];
  return lang && hljs.getLanguage(lang) ? lang : null;
}

/** 用 highlight.js 生成整段高亮 HTML；失败则返回转义后的纯文本 HTML */
export function highlightCode(code: string, ext: string): { html: string; language: string | null } {
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

// Diff 逐行高亮有大量重复行（尤其是上下文行），用缓存避免重复计算。
const lineCache = new Map<string, string>();
const LINE_CACHE_LIMIT = 20000;

/**
 * 单行语法高亮。没有可用语言时返回 null，调用方回退为纯文本渲染。
 *
 * Diff 的每一行都是独立片段，调用 highlight.js 时可能缺少上一行的上下文，
 * 但常见关键字/字符串/注释仍能正确着色，且对超大 Diff 也不会明显卡顿。
 */
export function highlightLine(line: string, language: string | null): string | null {
  if (!language || !line || !line.trim() || !hljs.getLanguage(language)) return null;

  const key = `${language}\u0000${line}`;
  const cached = lineCache.get(key);
  if (cached !== undefined) return cached;

  let html: string;
  try {
    html = hljs.highlight(line, { language, ignoreIllegals: true }).value;
  } catch {
    return null;
  }

  if (lineCache.size >= LINE_CACHE_LIMIT) lineCache.clear();
  lineCache.set(key, html);
  return html;
}

let themeInstalled = false;

/** 注入 highlight.js 主题样式，并跟随应用主题（data-theme）自动切换 */
export function ensureHighlightTheme(): void {
  if (typeof document === "undefined") return;

  let style = document.getElementById("hljs-theme") as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = "hljs-theme";
    document.head.appendChild(style);
  }

  const sync = () => {
    if (!style) return;
    style.textContent =
      document.documentElement.getAttribute("data-theme") === "light"
        ? githubLight
        : githubDark;
  };

  sync();

  if (!themeInstalled) {
    themeInstalled = true;
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
  }
}
