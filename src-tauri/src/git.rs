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

/// 把 Git 的 stderr / stdout 合并成一条可展示的错误详情。
///
/// Git 有时把关键提示写到 stdout（例如 "Updating a..b"），错误写到 stderr；
/// 只取 stderr 可能丢失上下文，因此两者都保留，stderr 放在前面。
fn format_git_failure(args: &[&str], output: &std::process::Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

    let detail = match (stderr.is_empty(), stdout.is_empty()) {
        (false, false) => format!("{}\n{}", stderr, stdout),
        (false, true) => stderr,
        (true, false) => stdout,
        (true, true) => format!("Git 进程退出码：{}", output.status),
    };

    format!("git {} failed:\n{}", args.join(" "), detail)
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
        return Err(AppError::GitCommand(format_git_failure(args, &output)));
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
        return Err(AppError::GitCommand(format_git_failure(args, &output)));
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn git_error_contains_full_stderr() {
        // 未安装 Git 时跳过
        if Command::new("git").arg("--version").output().is_err() {
            return;
        }

        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("gitlensy-git-error-{}", unique));
        std::fs::create_dir_all(&dir).expect("create temp dir");

        let message = run_git(&dir, &["status"])
            .expect_err("git status should fail outside a repository")
            .to_string();

        let _ = std::fs::remove_dir_all(&dir);

        // 命令、换行与 Git 的完整 stderr 都应保留，而不是只剩最后一句
        assert!(message.contains("git status failed"));
        assert!(message.contains("not a git repository"));
        assert!(message.contains('\n'));
    }
}
