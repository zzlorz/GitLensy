import { useState, useEffect, useCallback, useRef } from "react";
import { Loader2 } from "lucide-react";
import WelcomePage from "./pages/WelcomePage";
import MainWorkspace from "./pages/MainWorkspace";
import SettingsModal from "./components/SettingsModal";
import type { RepositoryInfo, ThemeMode } from "./types";
import { getSavedRepo, saveCurrentRepo, openRepository, closeRepository, setWindowTheme, getPreferredEditor, setPreferredEditor } from "./api/tauri";

const THEME_KEY = "gitlensy:theme";

function getInitialTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark" || saved === "system") {
      return saved;
    }
  } catch {
    // ignore
  }
  return "dark";
}

export default function App() {
  const [repo, setRepo] = useState<RepositoryInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const [editor, setEditor] = useState<string>(getPreferredEditor);
  const [showSettings, setShowSettings] = useState(false);
  const manuallyClosed = useRef(false);

  // Apply theme to document and native window title bar
  useEffect(() => {
    const applyTheme = () => {
      let effectiveTheme: "dark" | "light" = "dark";
      if (theme === "system") {
        const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        effectiveTheme = prefersDark ? "dark" : "light";
      } else {
        effectiveTheme = theme;
      }
      document.documentElement.setAttribute("data-theme", effectiveTheme);
      // 同步更新原生窗口标题栏主题
      setWindowTheme(effectiveTheme).catch(() => {});
    };

    applyTheme();

    if (theme === "system") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => applyTheme();
      mediaQuery.addEventListener("change", handler);
      return () => mediaQuery.removeEventListener("change", handler);
    }
  }, [theme]);

  const handleThemeChange = useCallback((newTheme: ThemeMode) => {
    setTheme(newTheme);
    try {
      localStorage.setItem(THEME_KEY, newTheme);
    } catch {
      // ignore
    }
  }, []);

  const handleEditorChange = useCallback((value: string) => {
    setPreferredEditor(value);
    setEditor(getPreferredEditor());
  }, []);

  // Try to restore last opened repo on first mount
  useEffect(() => {
    async function restoreRepo() {
      // 用户主动关闭过仓库，当前会话不自动恢复
      if (sessionStorage.getItem("gitlensy:manuallyClosed") === "1") {
        setLoading(false);
        return;
      }
      const saved = getSavedRepo();
      if (saved && !manuallyClosed.current) {
        try {
          const info = await openRepository(saved.path);
          setRepo(info);
        } catch {
          // Saved repo is no longer valid
        }
      }
      setLoading(false);
    }
    restoreRepo();
  }, []);

  const handleOpenRepo = useCallback(async (path: string) => {
    setError(null);
    manuallyClosed.current = false;
    sessionStorage.removeItem("gitlensy:manuallyClosed");
    try {
      const info = await openRepository(path);
      setRepo(info);
      saveCurrentRepo(info);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const handleCloseRepo = useCallback(async () => {
    // 立即清除 localStorage 中的当前仓库，防止刷新后自动恢复
    localStorage.removeItem("gitlensy:currentRepo");
    // 会话级标记：本次会话中用户主动关闭了，不自动恢复
    sessionStorage.setItem("gitlensy:manuallyClosed", "1");
    try {
      await closeRepository();
    } catch {
      // ignore
    }
    manuallyClosed.current = true;
    setRepo(null);
    setError(null);
  }, []);

  if (loading) {
    return (
      <div className="loading" style={{ height: "100vh", backgroundColor: "var(--bg-primary)", gap: 12 }}>
        <Loader2 size={24} className="spin" style={{ color: "var(--accent-color)" }} />
        <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>正在加载 GitLensy...</span>
      </div>
    );
  }

  return (
    <>
      {!repo ? (
        <WelcomePage
          onOpenRepo={handleOpenRepo}
          error={error}
          onOpenSettings={() => setShowSettings(true)}
        />
      ) : (
        <MainWorkspace
          repo={repo}
          onCloseRepo={handleCloseRepo}
          onRepoUpdate={setRepo}
          onOpenSettings={() => setShowSettings(true)}
        />
      )}

      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        theme={theme}
        onThemeChange={handleThemeChange}
        editor={editor}
        onEditorChange={handleEditorChange}
      />
    </>
  );
}
