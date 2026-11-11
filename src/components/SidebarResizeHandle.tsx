import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";

interface Props {
  /** 当前宽度（px） */
  width: number;
  min: number;
  max: number;
  /** 拖拽过程中的实时宽度 */
  onWidthChange: (width: number) => void;
  /** 拖拽结束 / 键盘调整后触发，适合在这里持久化 */
  onResizeEnd?: (width: number) => void;
  /** 双击 / 重置（通常恢复默认宽度） */
  onReset?: () => void;
  /** 是否显示常驻分隔线（默认 true）；项目侧边栏可关闭，避免多出线框 */
  showLine?: boolean;
  title?: string;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(value)));

/**
 * 侧边栏宽度拖拽手柄。
 *
 * 放在两个 flex 子项之间，采用 0 布局宽度 + 隐形感应热区（::before）设计，
 * 避免在侧边栏与主区域/顶部工具栏之间产生多余间隙或白色空隙。
 * 使用 Pointer Capture，拖动速度快或光标移出手柄也不会丢失事件。
 */
export default function SidebarResizeHandle({
  width,
  min,
  max,
  onWidthChange,
  onResizeEnd,
  onReset,
  showLine = true,
  title: customTitle,
}: Props) {
  const { t } = useI18n();
  const title = customTitle ?? t("projectSidebar.resizeDefaultTooltip");
  const dragRef = useRef<{ startX: number; startWidth: number; latest: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  // 拖拽期间禁止选中文本，并让光标保持为 col-resize
  useEffect(() => {
    if (!dragging) return;
    document.body.classList.add("resizing-sidebar");
    return () => document.body.classList.remove("resizing-sidebar");
  }, [dragging]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startWidth: width, latest: width };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const next = clamp(drag.startWidth + (e.clientX - drag.startX), min, max);
    if (next !== drag.latest) {
      drag.latest = next;
      onWidthChange(next);
    }
  };

  const finishDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    onResizeEnd?.(drag.latest);
  };

  const handleLostPointerCapture = () => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setDragging(false);
    onResizeEnd?.(drag.latest);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const step = e.shiftKey ? 40 : 10;
    const next = clamp(width + (e.key === "ArrowLeft" ? -step : step), min, max);
    if (next === width) return;
    onWidthChange(next);
    onResizeEnd?.(next);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      className={`sidebar-resize-handle ${dragging ? "dragging" : ""} ${showLine ? "" : "no-line"}`}
      title={title}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onLostPointerCapture={handleLostPointerCapture}
      onDoubleClick={() => onReset?.()}
      onKeyDown={handleKeyDown}
    />
  );
}
