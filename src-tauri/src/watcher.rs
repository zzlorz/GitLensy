use std::path::{Component, Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;

use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

/// 前端监听的事件名：仓库文件发生变化时触发自动刷新。
pub const REPO_CHANGED_EVENT: &str = "repo-changed";

/// 去抖窗口：Git 操作往往会连续产生大量文件事件，等安静下来再通知前端。
const DEBOUNCE: Duration = Duration::from_millis(320);

/// 是否忽略该路径：`.git` 内部变化由应用自身的 Git 操作处理；
/// 依赖 / 构建目录通常不参与版本控制，忽略可显著降低事件噪音。
///
/// 只检查相对于仓库根目录的路径，避免仓库本身位于名为 `target` 等目录下时误判。
fn is_ignored(root: &Path, path: &Path) -> bool {
    let relative = path.strip_prefix(root).unwrap_or(path);
    relative.components().any(|component| {
        matches!(
            component,
            Component::Normal(name)
                if name == ".git"
                    || name == "node_modules"
                    || name == "target"
                    || name == "dist"
                    || name == ".next"
        )
    })
}

/// 开始递归监听仓库目录，返回的 watcher 需要由调用方持有（drop 即停止监听）。
///
/// 文件事件先汇总到通道，由后台线程做 320ms 去抖，然后向前端发送一次
/// `repo-changed` 事件，避免一次 Git 操作触发多次刷新。
pub fn start(app: AppHandle, repo_root: &str) -> notify::Result<RecommendedWatcher> {
    let (tx, rx) = mpsc::channel::<()>();
    let root = PathBuf::from(repo_root);

    std::thread::Builder::new()
        .name("gitlensy-fs-watcher".to_string())
        .spawn(move || {
            while rx.recv().is_ok() {
                // 持续吸收短时间内的后续事件，直到安静 DEBOUNCE 为止
                while rx.recv_timeout(DEBOUNCE).is_ok() {}
                let _ = app.emit(REPO_CHANGED_EVENT, ());
            }
        })
        .map_err(|e| notify::Error::io(e))?;

    let mut watcher = RecommendedWatcher::new(
        move |result: notify::Result<Event>| {
            let Ok(event) = result else { return };
            // 只关心内容变更；Access 等事件（读取、关闭）不触发刷新
            if matches!(event.kind, notify::EventKind::Access(_)) {
                return;
            }
            if event.paths.iter().all(|path| is_ignored(&root, path)) {
                return;
            }
            let _ = tx.send(());
        },
        Config::default(),
    )?;

    watcher.watch(Path::new(repo_root), RecursiveMode::Recursive)?;
    Ok(watcher)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ignores_git_internal_and_build_directories() {
        let root = Path::new("D:/work/repo");
        assert!(is_ignored(root, &root.join(".git").join("index")));
        assert!(is_ignored(root, &root.join("node_modules").join("a.js")));
        assert!(is_ignored(root, &root.join("target").join("debug").join("app.exe")));
        assert!(is_ignored(root, &root.join("dist").join("index.js")));
    }

    #[test]
    fn keeps_regular_source_files() {
        let root = Path::new("D:/work/repo");
        assert!(!is_ignored(root, &root.join("src").join("main.rs")));
        assert!(!is_ignored(root, &root.join("README.md")));
    }

    #[test]
    fn repo_root_may_itself_contain_ignored_names() {
        let root = Path::new("D:/target/repo");
        assert!(!is_ignored(root, &root.join("src").join("main.rs")));
        // 相对仓库根目录下的 target 仍然忽略
        assert!(is_ignored(root, &root.join("target").join("x")));
    }
}
