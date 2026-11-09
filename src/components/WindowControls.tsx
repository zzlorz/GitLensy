import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";

/** 无边框窗口的边缘缩放热区 */
const RESIZE_HANDLES: {
  dir: "North" | "South" | "East" | "West" | "NorthWest" | "NorthEast" | "SouthWest" | "SouthEast";
  className: string;
}[] = [
  { dir: "North", className: "resize-handle rh-n" },
  { dir: "South", className: "resize-handle rh-s" },
  { dir: "West", className: "resize-handle rh-w" },
  { dir: "East", className: "resize-handle rh-e" },
  { dir: "NorthWest", className: "resize-handle rh-nw" },
  { dir: "NorthEast", className: "resize-handle rh-ne" },
  { dir: "SouthWest", className: "resize-handle rh-sw" },
  { dir: "SouthEast", className: "resize-handle rh-se" },
];

/** 放在工具栏最右侧的窗口控制按钮 */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  const appWindow = getCurrentWindow();

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const syncMaximized = () => {
      appWindow.isMaximized().then(setMaximized).catch(() => {});
    };

    syncMaximized();
    appWindow
      .onResized(syncMaximized)
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});

    return () => {
      unlisten?.();
    };
  }, [appWindow]);

  const toggleMaximize = () => {
    appWindow.toggleMaximize().then(() => appWindow.isMaximized()).then(setMaximized).catch(() => {});
  };

  return (
    <div className="window-controls">
      <button
        type="button"
        className="window-btn"
        title="最小化"
        onClick={() => appWindow.minimize().catch(() => {})}
      >
        <Minus size={14} />
      </button>
      <button
        type="button"
        className="window-btn"
        title={maximized ? "还原" : "最大化"}
        onClick={toggleMaximize}
      >
        {maximized ? <Copy size={13} /> : <Square size={12} />}
      </button>
      <button
        type="button"
        className="window-btn window-btn-close"
        title="关闭"
        onClick={() => appWindow.close().catch(() => {})}
      >
        <X size={15} />
      </button>
    </div>
  );
}

/** 无边框窗口的四边/四角缩放手柄 */
export function WindowResizeHandles() {
  const appWindow = getCurrentWindow();

  return (
    <>
      {RESIZE_HANDLES.map(({ dir, className }) => (
        <div
          key={dir}
          className={className}
          onMouseDown={(e) => {
            e.preventDefault();
            appWindow.startResizeDragging(dir).catch(() => {});
          }}
        />
      ))}
    </>
  );
}
