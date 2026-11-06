use std::path::Path;
use std::process::Command;

use crate::error::{AppError, AppResult};

/// 创建一个隐藏控制台窗口的 git Command。
/// Windows GUI 子系统下，子进程默认会短暂弹出黑色控制台；
/// CREATE_NO_WINDOW (0x0800_0000) 标志可彻底抑制该行为。
fn git_command() -> Command {
    let mut cmd = Command::new("git");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}

/// Run a git command in the specified working directory and return stdout as bytes.
pub fn run_git_bytes<P: AsRef<Path>>(repo_path: P, args: &[&str]) -> AppResult<Vec<u8>> {
    let repo_path = repo_path.as_ref();

    // `core.quotePath=false` 让 Git 直接输出 UTF-8 路径，
    // 而不是把中文等非 ASCII 字符转义成 `"\344\270\255"` 形式。
    let output = git_command()
        .args(["-c", "core.quotePath=false"])
        .args(args)
        .current_dir(repo_path)
        .output()
        .map_err(AppError::Io)?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(AppError::GitCommand(format!(
            "git {} failed: {}",
            args.join(" "),
            stderr.trim()
        )));
    }

    Ok(output.stdout)
}

/// Run a git command and return stdout as a UTF-8 string.
pub fn run_git_string<P: AsRef<Path>>(repo_path: P, args: &[&str]) -> AppResult<String> {
    let bytes = run_git_bytes(repo_path, args)?;
    String::from_utf8(bytes).map_err(|e| AppError::Encoding(format!("Invalid UTF-8: {}", e)))
}

/// Run a git command and return stdout lines as Vec<String>.
pub fn run_git_lines<P: AsRef<Path>>(repo_path: P, args: &[&str]) -> AppResult<Vec<String>> {
    let output = run_git_string(repo_path, args)?;
    Ok(output.lines().map(|s| s.to_string()).collect())
}

/// Check if a path is inside a valid Git repository.
pub fn is_git_repo<P: AsRef<Path>>(path: P) -> bool {
    let path = path.as_ref();
    if !path.exists() || !path.is_dir() {
        return false;
    }

    git_command()
        .args(["rev-parse", "--git-dir"])
        .current_dir(path)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Run a git command, returning Ok(()) on success.
///
/// 失败时把 Git 报错 stderr 连同命令信息一起拼进 AppError::GitCommand。
pub fn run_git<P: AsRef<Path>>(repo_path: P, args: &[&str]) -> AppResult<()> {
    let repo_path = repo_path.as_ref();

    let output = git_command()
        .args(["-c", "core.quotePath=false"])
        .args(args)
        .current_dir(repo_path)
        .output()
        .map_err(AppError::Io)?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::GitCommand(format!(
            "git {} failed: {}",
            args.join(" "),
            stderr
        )));
    }

    Ok(())
}

/// Get the root directory of a Git repository.
pub fn get_repo_root<P: AsRef<Path>>(path: P) -> AppResult<String> {
    let output = run_git_string(path, &["rev-parse", "--show-toplevel"])?;
    Ok(output.trim().to_string())
}

/// Get the current branch name, or "HEAD" if detached.
pub fn get_current_branch<P: AsRef<Path>>(path: P) -> AppResult<(String, bool)> {
    let branch = run_git_string(path, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    let branch = branch.trim().to_string();
    let is_detached = branch == "HEAD";
    Ok((branch, is_detached))
}
