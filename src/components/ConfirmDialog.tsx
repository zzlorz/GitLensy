import { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import { useI18n } from "../i18n";

interface Props {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title,
  message,
  confirmText,
  cancelText,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useI18n();
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  const effectiveConfirm = confirmText ?? t("common.confirm");
  const effectiveCancel = cancelText ?? t("common.cancel");

  // 默认聚焦到取消按钮，防止 Enter 误触
  useEffect(() => {
    cancelBtnRef.current?.focus();
  }, []);

  // ESC 关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);

  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="confirm-header">
          <AlertTriangle size={16} className="confirm-icon" />
          <span id="confirm-title" className="confirm-title">{title}</span>
        </div>
        <div className="confirm-body">{message}</div>
        <div className="confirm-actions">
          <button ref={cancelBtnRef} className="confirm-btn confirm-btn-cancel" onClick={onCancel}>
            {effectiveCancel}
          </button>
          <button className="confirm-btn confirm-btn-danger" onClick={onConfirm}>
            {effectiveConfirm}
          </button>
        </div>
      </div>
    </div>
  );
}
