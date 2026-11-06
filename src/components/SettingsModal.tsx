import { useEffect } from "react";
import { X, Moon, Sun, Monitor, Check } from "lucide-react";
import type { ThemeMode } from "../types";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
}

export default function SettingsModal({
  isOpen,
  onClose,
  theme,
  onThemeChange,
}: Props) {
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
