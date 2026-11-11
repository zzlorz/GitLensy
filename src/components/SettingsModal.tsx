import { useEffect, useState } from "react";
import { X, Moon, Sun, Monitor, Check } from "lucide-react";
import type { ThemeMode } from "../types";
import {
  PREVIEW_FONT_SIZE_DEFAULT,
  PREVIEW_FONT_SIZE_MAX,
  PREVIEW_FONT_SIZE_MIN,
} from "../lib/fontSize";
import { useI18n } from "../i18n";
import type { SupportedLocale } from "../i18n";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  /** 外部编辑器命令，默认 code（VS Code） */
  editor: string;
  onEditorChange: (editor: string) => void;
  /** Diff / 文件预览的代码字号 */
  previewFontSize: number;
  onPreviewFontSizeChange: (size: number) => void;
}

export default function SettingsModal({
  isOpen,
  onClose,
  theme,
  onThemeChange,
  editor,
  onEditorChange,
  previewFontSize,
  onPreviewFontSizeChange,
}: Props) {
  const { locale, setLocale, locales, t } = useI18n();

  // 编辑器命令用本地草稿，失焦或回车时才提交，避免输入过程被裁剪
  const [editorDraft, setEditorDraft] = useState(editor);

  useEffect(() => {
    if (isOpen) setEditorDraft(editor);
  }, [isOpen, editor]);

  // ESC 快捷键关闭
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const themes: {
    id: ThemeMode;
    label: string;
    description: string;
    icon: typeof Moon;
  }[] = [
    {
      id: "dark",
      label: t("settings.darkTheme"),
      description: t("settings.darkThemeDesc"),
      icon: Moon,
    },
    {
      id: "light",
      label: t("settings.lightTheme"),
      description: t("settings.lightThemeDesc"),
      icon: Sun,
    },
    {
      id: "system",
      label: t("settings.systemTheme"),
      description: t("settings.systemThemeDesc"),
      icon: Monitor,
    },
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="settings-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
      >
        <div className="settings-modal-header">
          <span className="settings-modal-title" id="settings-modal-title">
            {t("settings.title")}
          </span>
          <button
            className="settings-modal-close"
            onClick={onClose}
            title={t("settings.closeTooltip")}
          >
            <X size={16} />
          </button>
        </div>

        <div className="settings-modal-body">
          {/* 界面语言设置 */}
          <div className="settings-section">
            <div className="settings-section-title">{t("settings.languageSection")}</div>
            <div className="settings-section-desc">
              {t("settings.languageDesc")}
            </div>

            <div className="language-options-grid">
              {locales.map((item) => {
                const isSelected = locale === item.id;
                return (
                  <div
                    key={item.id}
                    className={`language-option-card ${isSelected ? "selected" : ""}`}
                    onClick={() => setLocale(item.id as SupportedLocale)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        setLocale(item.id as SupportedLocale);
                      }
                    }}
                  >
                    <div className="language-option-info">
                      <div className="language-option-name">{item.nativeName}</div>
                      <div className="language-option-sub">{item.englishName}</div>
                    </div>
                    {isSelected && (
                      <div className="theme-check-badge">
                        <Check size={12} strokeWidth={2.5} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 主题外观设置 */}
          <div className="settings-section">
            <div className="settings-section-title">{t("settings.appearanceSection")}</div>
            <div className="settings-section-desc">
              {t("settings.appearanceDesc")}
            </div>

            <div className="theme-options-grid">
              {themes.map((item) => {
                const Icon = item.icon;
                const isSelected = theme === item.id;
                return (
                  <div
                    key={item.id}
                    className={`theme-option-card ${isSelected ? "selected" : ""}`}
                    onClick={() => onThemeChange(item.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        onThemeChange(item.id);
                      }
                    }}
                  >
                    <div className={`theme-card-preview theme-preview-${item.id}`}>
                      <div className="theme-preview-sidebar" />
                      <div className="theme-preview-content">
                        <div className="theme-preview-line line-header" />
                        <div className="theme-preview-line line-added" />
                        <div className="theme-preview-line line-deleted" />
                      </div>
                    </div>

                    <div className="theme-option-info">
                      <div className="theme-option-header">
                        <Icon size={14} className="theme-option-icon" />
                        <span className="theme-option-label">{item.label}</span>
                        {isSelected && (
                          <div className="theme-check-badge">
                            <Check size={12} strokeWidth={2.5} />
                          </div>
                        )}
                      </div>
                      <div className="theme-option-desc">{item.description}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 预览字号 */}
          <div className="settings-section">
            <div className="settings-section-title">{t("settings.fontSizeSection")}</div>
            <div className="settings-section-desc">
              {t("settings.fontSizeDesc")}
            </div>

            <div className="settings-font-row">
              <button
                type="button"
                className="settings-font-step"
                title={t("settings.decreaseFontSize")}
                disabled={previewFontSize <= PREVIEW_FONT_SIZE_MIN}
                onClick={() =>
                  onPreviewFontSizeChange(Math.max(PREVIEW_FONT_SIZE_MIN, previewFontSize - 1))
                }
              >
                A−
              </button>
              <input
                className="settings-font-slider"
                type="range"
                min={PREVIEW_FONT_SIZE_MIN}
                max={PREVIEW_FONT_SIZE_MAX}
                step={1}
                value={previewFontSize}
                onChange={(e) => onPreviewFontSizeChange(Number(e.target.value))}
                aria-label={t("settings.fontSizeSection")}
              />
              <button
                type="button"
                className="settings-font-step"
                title={t("settings.increaseFontSize")}
                disabled={previewFontSize >= PREVIEW_FONT_SIZE_MAX}
                onClick={() =>
                  onPreviewFontSizeChange(Math.min(PREVIEW_FONT_SIZE_MAX, previewFontSize + 1))
                }
              >
                A+
              </button>
              <span className="settings-font-value">{previewFontSize}px</span>
              <button
                type="button"
                className="settings-editor-reset"
                onClick={() => onPreviewFontSizeChange(PREVIEW_FONT_SIZE_DEFAULT)}
              >
                {t("common.resetDefault")}
              </button>
            </div>

            <pre
              className="settings-font-preview"
              style={{ fontSize: `${previewFontSize}px` }}
            >
              <code>
                <span className="settings-font-comment">
                  {t("settings.fontSizePreviewComment", { size: previewFontSize })}
                </span>
                {"\n"}
                <span className="settings-font-keyword">const</span> message ={" "}
                <span className="settings-font-string">
                  &quot;{t("settings.fontSizePreviewString")}&quot;
                </span>;
              </code>
            </pre>
          </div>

          {/* 外部编辑器 */}
          <div className="settings-section">
            <div className="settings-section-title">{t("settings.editorSection")}</div>
            <div className="settings-section-desc">
              {t("settings.editorDesc")}
            </div>
            <div className="settings-editor-row">
              <input
                className="settings-editor-input"
                type="text"
                spellCheck={false}
                value={editorDraft}
                placeholder="code"
                onChange={(e) => setEditorDraft(e.target.value)}
                onBlur={() => onEditorChange(editorDraft)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    onEditorChange(editorDraft);
                    e.currentTarget.blur();
                  }
                }}
              />
              <button
                type="button"
                className="settings-editor-reset"
                onClick={() => {
                  setEditorDraft("code");
                  onEditorChange("code");
                }}
              >
                {t("common.resetDefault")}
              </button>
            </div>
            <div className="settings-editor-hint">
              {t("settings.editorHint")}
            </div>
          </div>
        </div>

        <div className="settings-modal-footer">
          <button className="settings-modal-btn primary" onClick={onClose}>
            {t("settings.done")}
          </button>
        </div>
      </div>
    </div>
  );
}
