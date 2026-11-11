import { useEffect, useState } from "react";
import { X, Moon, Sun, Monitor, Check } from "lucide-react";
import type { ThemeMode } from "../types";
import {
  PREVIEW_FONT_SIZE_DEFAULT,
  PREVIEW_FONT_SIZE_MAX,
  PREVIEW_FONT_SIZE_MIN,
} from "../lib/fontSize";

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
      label: "暗色模式",
      description: "经典深色界面，夜间使用更舒适",
      icon: Moon,
    },
    {
      id: "light",
      label: "亮色模式",
      description: "明亮清晰界面，日光环境下更易读",
      icon: Sun,
    },
    {
      id: "system",
      label: "跟随系统",
      description: "自动与操作系统的外观偏好保持同步",
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
            设置
          </span>
          <button
            className="settings-modal-close"
            onClick={onClose}
            title="关闭 (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        <div className="settings-modal-body">
          <div className="settings-section">
            <div className="settings-section-title">主题外观</div>
            <div className="settings-section-desc">
              切换应用程序的整体显示风格（暗色 / 亮色）
            </div>

            <div className="theme-options-grid">
              {themes.map((t) => {
                const Icon = t.icon;
                const isSelected = theme === t.id;
                return (
                  <div
                    key={t.id}
                    className={`theme-option-card ${isSelected ? "selected" : ""}`}
                    onClick={() => onThemeChange(t.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        onThemeChange(t.id);
                      }
                    }}
                  >
                    <div className={`theme-card-preview theme-preview-${t.id}`}>
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
                        <span className="theme-option-label">{t.label}</span>
                        {isSelected && (
                          <div className="theme-check-badge">
                            <Check size={12} strokeWidth={2.5} />
                          </div>
                        )}
                      </div>
                      <div className="theme-option-desc">{t.description}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-section-title">预览字号</div>
            <div className="settings-section-desc">
              调整 Diff 与文件预览的代码字号，修改后立即生效并自动保存。
            </div>

            <div className="settings-font-row">
              <button
                type="button"
                className="settings-font-step"
                title="减小字号"
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
                aria-label="预览字号"
              />
              <button
                type="button"
                className="settings-font-step"
                title="增大字号"
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
                恢复默认
              </button>
            </div>

            <pre
              className="settings-font-preview"
              style={{ fontSize: `${previewFontSize}px` }}
            >
              <code>
                <span className="settings-font-comment">// 预览字号 {previewFontSize}px</span>
                {"\n"}
                <span className="settings-font-keyword">const</span> message ={" "}
                <span className="settings-font-string">"可读性刚刚好"</span>;
              </code>
            </pre>
          </div>

          <div className="settings-section">
            <div className="settings-section-title">外部编辑器</div>
            <div className="settings-section-desc">
              「在编辑器中打开」项目或文件时使用的命令，默认为 VS Code 的 code。
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
                恢复默认
              </button>
            </div>
            <div className="settings-editor-hint">
              也可填写 cursor、subl、idea 等可执行命令；未安装时打开会提示失败。
            </div>
          </div>
        </div>

        <div className="settings-modal-footer">
          <button className="settings-modal-btn primary" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
