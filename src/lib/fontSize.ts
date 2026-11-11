// 预览区域（Diff / 文件预览）字号偏好
export const PREVIEW_FONT_SIZE_KEY = "gitlensy:previewFontSize";
export const PREVIEW_FONT_SIZE_MIN = 10;
export const PREVIEW_FONT_SIZE_MAX = 20;
export const PREVIEW_FONT_SIZE_DEFAULT = 12;

export function clampPreviewFontSize(size: number): number {
  if (!Number.isFinite(size)) return PREVIEW_FONT_SIZE_DEFAULT;
  return Math.min(
    PREVIEW_FONT_SIZE_MAX,
    Math.max(PREVIEW_FONT_SIZE_MIN, Math.round(size)),
  );
}

export function loadPreviewFontSize(): number {
  try {
    const raw = localStorage.getItem(PREVIEW_FONT_SIZE_KEY);
    const value = raw ? Number.parseFloat(raw) : Number.NaN;
    if (Number.isFinite(value)) return clampPreviewFontSize(value);
  } catch {
    // localStorage 不可用时使用默认值
  }
  return PREVIEW_FONT_SIZE_DEFAULT;
}

/** 写入 CSS 变量并持久化；预览组件只依赖 CSS 变量，无需逐个传 prop */
export function applyPreviewFontSize(size: number): number {
  const clamped = clampPreviewFontSize(size);
  document.documentElement.style.setProperty("--preview-font-size", `${clamped}px`);
  // 字号越大，行高稍微收紧，避免代码行过于松散
  const lineHeight = clamped >= 17 ? 1.5 : clamped >= 14 ? 1.55 : 1.62;
  document.documentElement.style.setProperty("--preview-line-height", String(lineHeight));
  try {
    localStorage.setItem(PREVIEW_FONT_SIZE_KEY, String(clamped));
  } catch {
    // ignore
  }
  return clamped;
}
