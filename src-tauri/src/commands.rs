use std::path::Path;

use tauri::State;

use crate::error::{AppError, AppResult};
use crate::models::{CommitFile, CommitInfo, DiffView, FileDiff, GitStatus, RepositoryInfo, SyncStatus};
use crate::repository;
use crate::{diff, git, history, status, AppState};

#[tauri::command]
pub async fn open_repository(
    path: String,
    state: State<'_, AppState>,
) -> AppResult<RepositoryInfo> {
    let info = repository::open_repository(&path)?;

    let mut repo_path = state.repo_path.lock().unwrap();
    *repo_path = Some(info.path.clone());

    Ok(info)
}

#[tauri::command]
pub async fn close_repository(state: State<'_, AppState>) -> Result<(), String> {
    let mut repo_path = state.repo_path.lock().unwrap();
    *repo_path = None;
    Ok(())
}

#[tauri::command]
pub async fn get_status(state: State<'_, AppState>) -> AppResult<GitStatus> {
    // Clone the path out of the Mutex guard so the lock is released before
    // the blocking git subprocess runs (avoids holding the lock during I/O).
    let path = {
        let repo_path = state.repo_path.lock().unwrap();
        repo_path
            .as_ref()
            .ok_or(crate::error::AppError::NoRepository)?
            .clone()
    };

    status::get_status(&path)
}

#[tauri::command]
pub async fn get_repo_change_count(path: String) -> AppResult<usize> {
    let status = status::get_status(&path)?;
    let mut seen = std::collections::HashSet::new();
    for file in status.staged.iter().chain(status.unstaged.iter()) {
        seen.insert(file.path.clone());
    }
    Ok(seen.len())
}

#[tauri::command]
pub async fn get_file_diff(
    file_path: String,
    view: DiffView,
    state: State<'_, AppState>,
) -> AppResult<FileDiff> {
    // Clone the path out of the Mutex guard immediately so the lock is
    // released before the blocking git subprocess runs. Previously the lock
    // was held for the entire git diff call, serialising every request.
    let path = {
        let repo_path = state.repo_path.lock().unwrap();
        repo_path
            .as_ref()
            .ok_or(crate::error::AppError::NoRepository)?
            .clone()
    };

    diff::get_file_diff(&path, &file_path, view)
}

/// Get a page of commits from git log.
#[tauri::command]
pub async fn get_commit_log(
    limit: usize,
    offset: usize,
    state: State<'_, AppState>,
) -> AppResult<Vec<CommitInfo>> {
    let path = {
        let repo_path = state.repo_path.lock().unwrap();
        repo_path
            .as_ref()
            .ok_or(crate::error::AppError::NoRepository)?
            .clone()
    };

    history::get_commit_log(&path, limit, offset)
}

/// Get the list of files changed in a commit.
#[tauri::command]
pub async fn get_commit_files(
    hash: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<CommitFile>> {
    let path = {
        let repo_path = state.repo_path.lock().unwrap();
        repo_path
            .as_ref()
            .ok_or(crate::error::AppError::NoRepository)?
            .clone()
    };

    history::get_commit_files(&path, &hash)
}

/// Get the diff for a single file within a commit.
#[tauri::command]
pub async fn get_commit_file_diff(
    hash: String,
    file_path: String,
    old_path: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<FileDiff> {
    let path = {
        let repo_path = state.repo_path.lock().unwrap();
        repo_path
            .as_ref()
            .ok_or(crate::error::AppError::NoRepository)?
            .clone()
    };

    history::get_commit_file_diff(&path, &hash, &file_path, old_path.as_deref())
}

/// 在仓库根目录打开一个新的 Windows PowerShell 窗口。
#[tauri::command]
pub async fn open_terminal(state: State<'_, AppState>) -> AppResult<()> {
    let path = {
        let repo_path = state.repo_path.lock().unwrap();
        repo_path
            .as_ref()
            .ok_or(crate::error::AppError::NoRepository)?
            .clone()
    };

    let spawn = |exe: &str| -> std::io::Result<std::process::Child> {
        let mut command = std::process::Command::new(exe);
        command.current_dir(&path);

        // 显式重置 stdin/stdout/stderr，让 PowerShell 拥有完整的控制台 I/O，
        // 避免从 Tauri GUI 进程继承到空句柄导致无法输入。
        command
            .stdin(std::process::Stdio::inherit())
            .stdout(std::process::Stdio::inherit())
            .stderr(std::process::Stdio::inherit());

        // CREATE_NEW_CONSOLE (0x0000_0010)：强制在新窗口中启动，
        // 而不是复用 Tauri 父进程的控制台（开发模式下父进程有控制台）。
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0000_0010);
        }

        command.spawn()
    };

    // 优先使用 PowerShell 7 (pwsh.exe)，未安装时回退到系统自带的 Windows PowerShell 5.1
    match spawn("pwsh.exe") {
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            spawn("powershell.exe").map_err(crate::error::AppError::Io)?;
            Ok(())
        }
        Err(e) => Err(crate::error::AppError::Io(e)),
    }
}

/// 动态更新原生窗口标题栏主题（深色 / 浅色 / 跟随系统）
#[tauri::command]
pub async fn set_window_theme(
    theme: String,
    window: tauri::Window,
) -> Result<(), String> {
    let t = match theme.as_str() {
        "dark" => Some(tauri::Theme::Dark),
        "light" => Some(tauri::Theme::Light),
        _ => None,
    };
    window.set_theme(t).map_err(|e| e.to_string())
}

/// 撤销单个文件的变更。
///
/// `scope` 控制撤销范围：
/// - `"unstaged"`：丢弃工作区修改（恢复 HEAD 或暂存区版本），适用于 Unstaged 区域的文件
/// - `"staged"`：从暂存区取消暂存（保留工作区修改），适用于 Staged 区域的文件
/// - `"all"`：同时丢弃暂存区 + 工作区修改，彻底恢复到 HEAD
///
/// 该命令会修改文件系统，属于破坏性操作。
#[tauri::command]
pub async fn revert_file(
    file_path: String,
    scope: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let repo_path = {
        let repo_path = state.repo_path.lock().unwrap();
        repo_path
            .as_ref()
            .ok_or(crate::error::AppError::NoRepository)?
            .clone()
    };

    let path = Path::new(&repo_path);

    // 先查一下文件当前的真实状态，避免对 untracked 等特殊状态误用 restore。
    let status_line = git::run_git_string(
        path,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", &file_path],
    )?;

    let scope = scope.trim().to_ascii_lowercase();

    let bytes = status_line.as_bytes();
    if bytes.len() < 2 {
        return Err(AppError::GitCommand(format!(
            "文件 {:?} 当前没有可撤销的变更",
            file_path
        )));
    }

    let x = bytes[0] as char; // 暂存区状态位
    let y = bytes[1] as char; // 工作区状态位

    let is_untracked = x == '?' && y == '?';
    let is_conflict = matches!(x, 'U' | 'A' | 'D') && matches!(y, 'U' | 'A' | 'D');

    if is_conflict {
        return Err(AppError::GitCommand(
            "该文件处于合并冲突状态，请手动解决后再重试".to_string(),
        ));
    }

    match scope.as_str() {
        "unstaged" => revert_unstaged(path, &file_path, x, y, is_untracked)?,
        "staged" => revert_staged(path, &file_path, x, y, is_untracked)?,
        "all" => revert_all(path, &file_path, x, y, is_untracked)?,
        _ => {
            return Err(AppError::ParseError(format!(
                "Unknown revert scope: {}",
                scope
            )))
        }
    }

    Ok(())
}

/// 丢弃工作区的修改（恢复到暂存区 / HEAD 版本）。
fn revert_unstaged(
    repo: &Path,
    file_path: &str,
    x: char,
    y: char,
    is_untracked: bool,
) -> AppResult<()> {
    if y == ' ' || y == '?' {
        // 工作区本来就没变化；对于 tracked 文件这是幂等的，
        // 但对 untracked 文件我们不能说"撤销工作区修改"就当没事。
        if is_untracked {
            // untracked 文件的"工作区修改"= 文件本身存在，
            // 用户要撤销 → 直接删掉。
            let full = repo.join(file_path);
            if full.is_file() {
                std::fs::remove_file(&full).map_err(|e| AppError::Io(e))?;
            } else if full.is_dir() {
                // 如果用户把 untracked 目录整个都删掉，Git 不会单独报告里面的文件。
                // 保险起见，按 Git 规范的 -- 语法来走。
                return Err(AppError::GitCommand(
                    "未跟踪目录暂不支持自动撤销，请手动删除".to_string(),
                ));
            }
            return Ok(());
        }
        // tracked 文件但工作区无变化 → 没事做，直接返回
        return Ok(());
    }

    // 有暂存区版本（x != ' '）时，restore 会恢复为暂存区版本，
    // 否则恢复为 HEAD 版本——这正是"丢弃工作区修改"的语义。
    git::run_git(repo, &["restore", "--", file_path])?;

    // restore 只会恢复 tracked 文件，不会删除 untracked；
    // 但 y != '?' 时我们的状态查询不会是 untracked，所以不会走到这里。
    let _ = (x, y); // avoid unused warnings
    Ok(())
}

/// 取消暂存（保留工作区修改不动）。
fn revert_staged(
    repo: &Path,
    file_path: &str,
    x: char,
    _y: char,
    is_untracked: bool,
) -> AppResult<()> {
    if x == ' ' {
        // 暂存区没东西可撤
        return Ok(());
    }

    if is_untracked {
        // 被加进暂存区的未跟踪文件（A 状态，staged 新增）
        // restore --staged 会把它从暂存区移除，但文件仍然留在磁盘。
        git::run_git(repo, &["restore", "--staged", "--", file_path])?;
    } else {
        // modified / deleted 的 staged 修改
        git::run_git(repo, &["restore", "--staged", "--", file_path])?;
    }

    Ok(())
}

/// 彻底丢弃：暂存区 + 工作区都恢复到 HEAD。
fn revert_all(
    repo: &Path,
    file_path: &str,
    x: char,
    y: char,
    is_untracked: bool,
) -> AppResult<()> {
    if is_untracked {
        // 彻底丢弃 untracked → 直接删文件
        let full = repo.join(file_path);
        if full.is_file() {
            std::fs::remove_file(&full).map_err(|e| AppError::Io(e))?;
        }
        return Ok(());
    }

    // 先撤暂存区（如果有），再恢复工作区
    if x != ' ' {
        git::run_git(repo, &["restore", "--staged", "--", file_path])?;
    }
    if y != ' ' {
        git::run_git(repo, &["restore", "--", file_path])?;
    }

    let _ = (x, y);
    Ok(())
}

/// 暂存指定文件（等价于 `git add -- <path>`）。
#[tauri::command]
pub async fn stage_file(
    file_path: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let repo_path = {
        let repo_path = state.repo_path.lock().unwrap();
        repo_path
            .as_ref()
            .ok_or(crate::error::AppError::NoRepository)?
            .clone()
    };

    git::run_git(Path::new(&repo_path), &["add", "--", &file_path])?;
    Ok(())
}

/// 是否存在未解决的合并冲突条目
fn has_unmerged_changes(repo: &Path) -> AppResult<bool> {
    let out = git::run_git_string(repo, &["status", "--porcelain=v1", "-z"])?;
    let bytes = out.as_bytes();
    let mut i = 0;
    while i + 1 < bytes.len() {
        let x = bytes[i] as char;
        let y = bytes[i + 1] as char;
        if matches!(x, 'D' | 'A' | 'U') && matches!(y, 'D' | 'A' | 'U') {
            return Ok(true);
        }
        // 跳过当前条目：XY + 空格 + 路径 + NUL
        match bytes[i..].iter().position(|b| *b == 0) {
            Some(pos) => i += pos + 1,
            None => break,
        }
    }
    Ok(false)
}

/// 暂存所有变更（含新增与删除），等价于 `git add -A`。
#[tauri::command]
pub async fn stage_all(state: State<'_, AppState>) -> AppResult<()> {
    let repo_path = {
        let repo_path = state.repo_path.lock().unwrap();
        repo_path
            .as_ref()
            .ok_or(crate::error::AppError::NoRepository)?
            .clone()
    };
    let path = Path::new(&repo_path);

    if has_unmerged_changes(path)? {
        return Err(AppError::GitCommand(
            "存在未解决的合并冲突，请手动解决后再操作".to_string(),
        ));
    }

    git::run_git(path, &["add", "-A"])?;
    Ok(())
}

/// 放弃所有工作区变更：已跟踪文件恢复到暂存区状态，未跟踪文件直接删除。
#[tauri::command]
pub async fn discard_all_unstaged(state: State<'_, AppState>) -> AppResult<()> {
    let repo_path = {
        let repo_path = state.repo_path.lock().unwrap();
        repo_path
            .as_ref()
            .ok_or(crate::error::AppError::NoRepository)?
            .clone()
    };
    let path = Path::new(&repo_path);

    if has_unmerged_changes(path)? {
        return Err(AppError::GitCommand(
            "存在未解决的合并冲突，请手动解决后再操作".to_string(),
        ));
    }

    // 已跟踪文件：工作区恢复为暂存区内容，不触碰暂存区
    git::run_git(path, &["restore", "--worktree", "--", "."])?;
    // 未跟踪文件/目录：直接清理（遵循 .gitignore）
    git::run_git(path, &["clean", "-fd"])?;
    Ok(())
}

/// 提交暂存区内容，提交信息来自输入框。
#[tauri::command]
pub async fn commit_changes(state: State<'_, AppState>, message: String) -> AppResult<()> {
    let message = message.trim();
    if message.is_empty() {
        return Err(AppError::GitCommand("提交信息不能为空".to_string()));
    }

    let repo_path = {
        let repo_path = state.repo_path.lock().unwrap();
        repo_path
            .as_ref()
            .ok_or(crate::error::AppError::NoRepository)?
            .clone()
    };
    let path = Path::new(&repo_path);

    if has_unmerged_changes(path)? {
        return Err(AppError::GitCommand(
            "存在未解决的合并冲突，请手动解决后再提交".to_string(),
        ));
    }

    git::run_git(path, &["commit", "-m", message])?;
    Ok(())
}

/// 读取当前分支与上游远程的领先/落后提交数
fn sync_status_for(path: &Path) -> AppResult<SyncStatus> {
    let branch = git::run_git_string(path, &["rev-parse", "--abbrev-ref", "HEAD"])?
        .trim()
        .to_string();

    // 没有上游分支时上游查询会失败，此时视为未关联远程
    if git::run_git_string(path, &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])
        .is_err()
    {
        return Ok(SyncStatus {
            branch,
            has_upstream: false,
            ahead: 0,
            behind: 0,
        });
    }

    let ahead = git::run_git_string(path, &["rev-list", "--count", "@{u}..HEAD"])?
        .trim()
        .parse::<usize>()
        .unwrap_or(0);
    let behind = git::run_git_string(path, &["rev-list", "--count", "HEAD..@{u}"])?
        .trim()
        .parse::<usize>()
        .unwrap_or(0);

    Ok(SyncStatus {
        branch,
        has_upstream: true,
        ahead,
        behind,
    })
}

/// 查询当前分支与远程的同步状态
#[tauri::command]
pub async fn get_sync_status(state: State<'_, AppState>) -> AppResult<SyncStatus> {
    let repo_path = {
        let repo_path = state.repo_path.lock().unwrap();
        repo_path
            .as_ref()
            .ok_or(crate::error::AppError::NoRepository)?
            .clone()
    };
    sync_status_for(Path::new(&repo_path))
}

/// 同步到远程仓库：落后时先快进拉取，再推送本地提交。
#[tauri::command]
pub async fn sync_changes(state: State<'_, AppState>) -> AppResult<()> {
    let repo_path = {
        let repo_path = state.repo_path.lock().unwrap();
        repo_path
            .as_ref()
            .ok_or(crate::error::AppError::NoRepository)?
            .clone()
    };
    let path = Path::new(&repo_path);

    if has_unmerged_changes(path)? {
        return Err(AppError::GitCommand(
            "存在未解决的合并冲突，请手动解决后再同步".to_string(),
        ));
    }

    let sync = sync_status_for(path)?;
    if !sync.has_upstream {
        return Err(AppError::GitCommand(
            "当前分支未关联远程分支，无法同步".to_string(),
        ));
    }

    if sync.behind > 0 {
        // 只做快进合并，避免意外产生合并提交
        git::run_git(path, &["pull", "--ff-only"])?;
    }
    git::run_git(path, &["push"])?;
    Ok(())
}

/// 拉取远程变更（仅快进，不产生合并提交）
#[tauri::command]
pub async fn pull_changes(state: State<'_, AppState>) -> AppResult<()> {
    let repo_path = {
        let repo_path = state.repo_path.lock().unwrap();
        repo_path
            .as_ref()
            .ok_or(crate::error::AppError::NoRepository)?
            .clone()
    };
    let path = Path::new(&repo_path);

    if has_unmerged_changes(path)? {
        return Err(AppError::GitCommand(
            "存在未解决的合并冲突，请手动解决后再拉取".to_string(),
        ));
    }
    if !sync_status_for(path)?.has_upstream {
        return Err(AppError::GitCommand(
            "当前分支未关联远程分支，无法拉取".to_string(),
        ));
    }

    git::run_git(path, &["pull", "--ff-only"])?;
    Ok(())
}

/// 获取远程更新（git fetch --all --prune，仅更新远程引用，不合并到本地）
#[tauri::command]
pub async fn fetch_changes(state: State<'_, AppState>) -> AppResult<()> {
    let repo_path = {
        let repo_path = state.repo_path.lock().unwrap();
        repo_path
            .as_ref()
            .ok_or(crate::error::AppError::NoRepository)?
            .clone()
    };
    let path = Path::new(&repo_path);

    git::run_git(path, &["fetch", "--all", "--prune"])?;
    Ok(())
}

/// 新建分支：checkout 为 true 时创建并切换到新分支
#[tauri::command]
pub async fn create_branch(
    state: State<'_, AppState>,
    name: String,
    checkout: bool,
) -> AppResult<()> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::GitCommand("分支名称不能为空".to_string()));
    }

    let repo_path = {
        let repo_path = state.repo_path.lock().unwrap();
        repo_path
            .as_ref()
            .ok_or(crate::error::AppError::NoRepository)?
            .clone()
    };
    let path = Path::new(&repo_path);

    // 引用名校验，同时拦截 checkout 时的路径歧义
    if git::run_git(path, &["check-ref-format", "--branch", &name]).is_err() {
        return Err(AppError::GitCommand(format!("分支名称不合法：{}", name)));
    }

    let ref_name = format!("refs/heads/{}", name);
    if git::run_git(path, &["show-ref", "--verify", "--quiet", &ref_name]).is_ok() {
        return Err(AppError::GitCommand(format!("分支 {} 已存在", name)));
    }

    if checkout {
        git::run_git(path, &["checkout", "-b", &name])?;
    } else {
        git::run_git(path, &["branch", &name])?;
    }
    Ok(())
}

/// 新建标签：message 非空时创建附注标签，否则创建轻量标签
#[tauri::command]
pub async fn create_tag(
    state: State<'_, AppState>,
    name: String,
    message: Option<String>,
) -> AppResult<()> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::GitCommand("标签名称不能为空".to_string()));
    }

    let repo_path = {
        let repo_path = state.repo_path.lock().unwrap();
        repo_path
            .as_ref()
            .ok_or(crate::error::AppError::NoRepository)?
            .clone()
    };
    let path = Path::new(&repo_path);

    // 空仓库没有 HEAD，无法打标签
    if git::run_git(path, &["rev-parse", "--verify", "HEAD"]).is_err() {
        return Err(AppError::GitCommand(
            "当前仓库还没有提交，无法创建标签".to_string(),
        ));
    }

    let ref_name = format!("refs/tags/{}", name);
    if git::run_git(path, &["check-ref-format", &ref_name]).is_err() {
        return Err(AppError::GitCommand(format!("标签名称不合法：{}", name)));
    }
    if git::run_git(path, &["show-ref", "--verify", "--quiet", &ref_name]).is_ok() {
        return Err(AppError::GitCommand(format!("标签 {} 已存在", name)));
    }

    let msg = message
        .map(|m| m.trim().to_string())
        .filter(|m| !m.is_empty());
    match msg {
        Some(ref m) => git::run_git(path, &["tag", "-a", &name, "-m", m])?,
        None => git::run_git(path, &["tag", &name])?,
    }
    Ok(())
}

/// 推送本地提交到远程
#[tauri::command]
pub async fn push_changes(state: State<'_, AppState>) -> AppResult<()> {
    let repo_path = {
        let repo_path = state.repo_path.lock().unwrap();
        repo_path
            .as_ref()
            .ok_or(crate::error::AppError::NoRepository)?
            .clone()
    };
    let path = Path::new(&repo_path);

    if !sync_status_for(path)?.has_upstream {
        return Err(AppError::GitCommand(
            "当前分支未关联远程分支，无法推送".to_string(),
        ));
    }

    git::run_git(path, &["push"])?;
    Ok(())
}

/// 贮藏当前工作区变更（含未跟踪文件）
#[tauri::command]
pub async fn stash_changes(
    state: State<'_, AppState>,
    message: Option<String>,
) -> AppResult<()> {
    let repo_path = {
        let repo_path = state.repo_path.lock().unwrap();
        repo_path
            .as_ref()
            .ok_or(crate::error::AppError::NoRepository)?
            .clone()
    };
    let path = Path::new(&repo_path);

    // 没有任何变更时拒绝贮藏，避免生成空 stash
    let current = status::get_status(&repo_path)?;
    if current.staged.is_empty() && current.unstaged.is_empty() {
        return Err(AppError::GitCommand("当前没有可贮藏的变更".to_string()));
    }

    let msg = message
        .map(|m| m.trim().to_string())
        .filter(|m| !m.is_empty());

    let mut args: Vec<&str> = vec!["stash", "push", "--include-untracked"];
    if let Some(ref m) = msg {
        args.push("-m");
        args.push(m);
    }

    git::run_git(path, &args)?;
    Ok(())
}

/// 列出当前仓库的所有贮藏记录（最新的在最前）
#[tauri::command]
pub async fn get_stash_list(state: State<'_, AppState>) -> AppResult<Vec<crate::models::StashEntry>> {
    let repo_path = {
        let repo_path = state.repo_path.lock().unwrap();
        repo_path
            .as_ref()
            .ok_or(crate::error::AppError::NoRepository)?
            .clone()
    };
    let path = Path::new(&repo_path);

    let lines = git::run_git_lines(path, &["stash", "list", "--format=%gd%x1f%gs%x1f%cr"])?;
    Ok(lines
        .into_iter()
        .enumerate()
        .filter_map(|(index, line)| {
            let mut parts = line.split('\x1f');
            let ref_name = parts.next()?.trim().to_string();
            if ref_name.is_empty() {
                return None;
            }
            Some(crate::models::StashEntry {
                index,
                ref_name,
                message: parts.next().unwrap_or("").to_string(),
                date: parts.next().unwrap_or("").to_string(),
            })
        })
        .collect())
}

/// 恢复指定序号的贮藏（pop），成功后该记录从列表中移除
#[tauri::command]
pub async fn pop_stash(state: State<'_, AppState>, index: usize) -> AppResult<()> {
    let repo_path = {
        let repo_path = state.repo_path.lock().unwrap();
        repo_path
            .as_ref()
            .ok_or(crate::error::AppError::NoRepository)?
            .clone()
    };
    let path = Path::new(&repo_path);
    let ref_name = format!("stash@{{{}}}", index);
    git::run_git(path, &["stash", "pop", &ref_name])
}

/// 应用指定序号的贮藏（apply），不删除记录
#[tauri::command]
pub async fn apply_stash(state: State<'_, AppState>, index: usize) -> AppResult<()> {
    let repo_path = {
        let repo_path = state.repo_path.lock().unwrap();
        repo_path
            .as_ref()
            .ok_or(crate::error::AppError::NoRepository)?
            .clone()
    };
    let path = Path::new(&repo_path);
    let ref_name = format!("stash@{{{}}}", index);
    git::run_git(path, &["stash", "apply", &ref_name])
}

/// 删除指定序号的贮藏记录（不应用到工作区）
#[tauri::command]
pub async fn drop_stash(state: State<'_, AppState>, index: usize) -> AppResult<()> {
    let repo_path = {
        let repo_path = state.repo_path.lock().unwrap();
        repo_path
            .as_ref()
            .ok_or(crate::error::AppError::NoRepository)?
            .clone()
    };
    let path = Path::new(&repo_path);
    let ref_name = format!("stash@{{{}}}", index);
    git::run_git(path, &["stash", "drop", &ref_name])
}

/// 清空全部贮藏记录
#[tauri::command]
pub async fn clear_stashes(state: State<'_, AppState>) -> AppResult<()> {
    let repo_path = {
        let repo_path = state.repo_path.lock().unwrap();
        repo_path
            .as_ref()
            .ok_or(crate::error::AppError::NoRepository)?
            .clone()
    };
    let path = Path::new(&repo_path);
    git::run_git(path, &["stash", "clear"])
}

/// 在外部编辑器中打开项目目录或文件（默认 VS Code：code）
#[tauri::command]
pub async fn open_in_editor(path: String, editor: Option<String>) -> AppResult<()> {
    let target = Path::new(&path);
    if !target.exists() {
        return Err(AppError::PathNotFound(path.clone()));
    }

    let editor = editor
        .map(|e| e.trim().to_string())
        .filter(|e| !e.is_empty())
        .unwrap_or_else(|| "code".to_string());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;

        // 直接通过 cmd /C 启动编辑器，不使用 start，避免额外弹出控制台/PowerShell 窗口
        std::process::Command::new("cmd")
            .arg("/C")
            .arg(&editor)
            .arg(&path)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| AppError::GitCommand(format!("启动编辑器失败（{}）：{}", editor, e)))?;
    }

    #[cfg(not(windows))]
    {
        std::process::Command::new(&editor)
            .arg(&path)
            .spawn()
            .map_err(|e| AppError::GitCommand(format!("启动编辑器失败（{}）：{}", editor, e)))?;
    }

    Ok(())
}

/// Windows 的 explorer.exe 不认正斜杠路径：传入 `D:/foo/bar` 时不会打开目标目录，
/// 而是错误地打开「文档」。git 返回的仓库根路径恰好是 `D:/foo/bar` 形式，
/// 因此交给系统 Shell 前统一转成反斜杠的原生路径。
#[cfg(windows)]
fn to_native_windows_path(path: &str) -> String {
    let mut normalized = path.replace('/', "\\");
    // 去掉末尾多余的分隔符，但保留盘符根目录（如 `C:\`）
    while normalized.len() > 3 && normalized.ends_with('\\') {
        normalized.pop();
    }
    normalized
}

/// 按指定方式打开项目或文件：editor（默认编辑器）/ explorer（资源管理器）/ system（默认应用）
#[tauri::command]
pub async fn open_with_method(
    path: String,
    method: String,
    editor: Option<String>,
) -> AppResult<()> {
    let target = Path::new(&path);
    if !target.exists() {
        return Err(AppError::PathNotFound(path.clone()));
    }

    match method.trim().to_lowercase().as_str() {
        "explorer" => {
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                const CREATE_NO_WINDOW: u32 = 0x0800_0000;

                let native_path = to_native_windows_path(&path);
                let mut cmd = std::process::Command::new("explorer");
                if target.is_file() {
                    // 文件：打开其所在文件夹并选中该文件
                    cmd.raw_arg(format!("/select,\"{}\"", native_path));
                } else {
                    // 文件夹 / 项目：直接打开该文件夹
                    cmd.arg(&native_path);
                }
                cmd.creation_flags(CREATE_NO_WINDOW)
                    .spawn()
                    .map_err(|e| AppError::GitCommand(format!("打开资源管理器失败：{}", e)))?;
            }
            #[cfg(not(windows))]
            {
                std::process::Command::new("xdg-open")
                    .arg(if target.is_file() {
                        target.parent().unwrap_or(target)
                    } else {
                        target
                    })
                    .spawn()
                    .map_err(|e| AppError::GitCommand(format!("打开资源管理器失败：{}", e)))?;
            }
            Ok(())
        }
        "system" | "default" => {
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                const CREATE_NO_WINDOW: u32 = 0x0800_0000;

                // 弹出 Windows 的「选择一个应用打开」对话框（文件/文件夹都走系统选择）
                std::process::Command::new("rundll32.exe")
                    .arg("shell32.dll,OpenAs_RunDLL")
                    .arg(to_native_windows_path(&path))
                    .creation_flags(CREATE_NO_WINDOW)
                    .spawn()
                    .map_err(|e| {
                        AppError::GitCommand(format!("打开「选择应用」对话框失败：{}", e))
                    })?;
            }
            #[cfg(not(windows))]
            {
                std::process::Command::new("xdg-open")
                    .arg(&path)
                    .spawn()
                    .map_err(|e| AppError::GitCommand(format!("用默认应用打开失败：{}", e)))?;
            }
            Ok(())
        }
        _ => open_in_editor(path, editor).await,
    }
}

/// 列出本地与远程分支（远程已 fetch 的引用）
#[tauri::command]
pub async fn get_branches(
    state: State<'_, AppState>,
) -> AppResult<crate::models::BranchList> {
    let repo_path = {
        let repo_path = state.repo_path.lock().unwrap();
        repo_path
            .as_ref()
            .ok_or(crate::error::AppError::NoRepository)?
            .clone()
    };
    let path = Path::new(&repo_path);

    let local = git::run_git_lines(path, &["branch", "--format=%(refname:short)"])?
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>();

    let remote = git::run_git_lines(path, &["branch", "-r", "--format=%(refname:short)"])?
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && !s.ends_with("/HEAD"))
        .collect::<Vec<_>>();

    let mut current =
        git::run_git_string(path, &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap_or_default();
    current = current.trim().to_string();
    if current == "HEAD" {
        current.clear();
    }

    Ok(crate::models::BranchList {
        current,
        local,
        remote,
    })
}

/// 切换分支；远程分支会自动创建同名本地分支并跟踪
#[tauri::command]
pub async fn checkout_branch(
    state: State<'_, AppState>,
    name: String,
    is_remote: bool,
) -> AppResult<()> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::GitCommand("分支名称不能为空".to_string()));
    }

    let repo_path = {
        let repo_path = state.repo_path.lock().unwrap();
        repo_path
            .as_ref()
            .ok_or(crate::error::AppError::NoRepository)?
            .clone()
    };
    let path = Path::new(&repo_path);

    if is_remote {
        // origin/feature/login → 去掉远程名前缀，得到本地分支名
        let short = match name.split_once('/') {
            Some((_, rest)) if !rest.is_empty() => rest.to_string(),
            _ => return Err(AppError::GitCommand(format!("远程分支名称不合法：{}", name))),
        };

        let local_ref = format!("refs/heads/{}", short);
        if git::run_git(path, &["show-ref", "--verify", "--quiet", &local_ref]).is_ok() {
            // 本地已有同名分支，直接切换
            git::run_git(path, &["checkout", &short])?;
        } else {
            git::run_git(path, &["checkout", "-b", &short, "--track", &name])?;
        }
    } else {
        git::run_git(path, &["checkout", &name])?;
    }
    Ok(())
}
