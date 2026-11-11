import { useState, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, AlertCircle, X, GitBranch, Settings } from "lucide-react";
import { getRecentRepos, removeRecentRepo } from "../api/tauri";
import type { RecentRepo } from "../types";
import { useI18n } from "../i18n";

interface Props {
  onOpenRepo: (path: string) => void;
  error: string | null;
  onOpenSettings?: () => void;
}

export default function WelcomePage({ onOpenRepo, error, onOpenSettings }: Props) {
  const { t } = useI18n();
  const [recentRepos, setRecentRepos] = useState<RecentRepo[]>([]);

  useEffect(() => {
    setRecentRepos(getRecentRepos());
  }, []);

  const handleBrowse = async () => {
    try {
      const result = await open({
        directory: true,
        multiple: false,
        title: t("welcome.openDialogTitle"),
      });
      if (result && typeof result === "string") {
        onOpenRepo(result);
      }
    } catch (e) {
      console.error("Failed to open dialog:", e);
      // Fallback to prompt
      const path = window.prompt(t("welcome.enterRepoPath"));
      if (path) {
        onOpenRepo(path);
      }
    }
  };

  const handleRecentClick = (repoPath: string) => {
    onOpenRepo(repoPath);
  };

  const handleRemoveRecent = (e: React.MouseEvent, repoPath: string) => {
    e.stopPropagation();
    removeRecentRepo(repoPath);
    setRecentRepos(getRecentRepos());
  };

  return (
    <div className="welcome-page">
      {onOpenSettings && (
        <div className="welcome-topbar">
          <button
            className="toolbar-btn"
            onClick={onOpenSettings}
            title={t("welcome.settingsTooltip")}
          >
            <Settings size={14} />
            <span>{t("settings.title")}</span>
          </button>
        </div>
      )}

      <div className="welcome-logo-wrapper">
        <img src="/app-icon.png" alt="GitLensy" style={{ width: 52, height: 52, objectFit: "contain" }} />
      </div>

      <div className="welcome-header">
        <h1 className="welcome-title">{t("welcome.title")}</h1>
        <p className="welcome-subtitle">{t("welcome.subtitle")}</p>
      </div>

      {error && (
        <div className="error-message" style={{ maxWidth: 440 }}>
          <AlertCircle size={16} style={{ flexShrink: 0 }} />
          <span>{error}</span>
        </div>
      )}

      <div className="welcome-actions">
        <button className="welcome-btn primary" onClick={handleBrowse}>
          <FolderOpen size={18} strokeWidth={2} />
          <span>{t("welcome.openRepo")}</span>
        </button>
      </div>

      {recentRepos.length > 0 && (
        <div className="recent-repos">
          <div className="recent-repos-header">
            <span className="recent-repos-title">{t("welcome.recentRepos")}</span>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
              {t("welcome.repoCount", { count: recentRepos.length })}
            </span>
          </div>
          <div className="recent-repos-list">
            {recentRepos.map((repo) => (
              <div
                key={repo.path}
                className="recent-repo-item"
                onClick={() => handleRecentClick(repo.path)}
                title={repo.path}
              >
                <GitBranch size={16} className="recent-repo-icon" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="recent-repo-name">{repo.name}</div>
                  <div className="recent-repo-path">{repo.path}</div>
                </div>
                <button
                  className="diff-copy-btn"
                  title={t("welcome.removeFromRecent")}
                  onClick={(e) => handleRemoveRecent(e, repo.path)}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
