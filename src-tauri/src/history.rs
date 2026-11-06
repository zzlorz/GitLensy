use std::collections::HashMap;
use std::path::Path;

use crate::diff::parse_unified_diff;
use crate::error::{AppError, AppResult};
use crate::git::{run_git_bytes, run_git_string};
use crate::models::{CommitFile, CommitInfo, FileDiff, FileStatus};

/// Git 空树的固定哈希，作为根提交（没有父提交）的对比基准。
const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/// `git log` 输出中的字段分隔符（ASCII RS）。
const FIELD_SEP: char = '\x1e';

/// `git log` 的格式化参数。
///
/// 注意：这里必须用 `%x00` / `%x1e` 转义来表示控制字符，不能直接把 NUL 字节
/// 拼进命令行参数——Windows 上进程参数是 C 字符串，内嵌 NUL 会让
/// `std::process::Command` 直接以 "nul byte found in provided data" 失败。
///
/// `%b`（提交正文）放在最后一个字段，这样正文里即使出现字段分隔符也不会
/// 影响前面字段的解析（`splitn` 的最后一个字段会吞掉多余的分隔符）。
const LOG_FORMAT: &str =
    "--pretty=format:%H%x1e%h%x1e%s%x1e%an%x1e%ae%x1e%aI%x1e%ar%x1e%P%x1e%b%x00";

/// 获取分页的提交列表。
///
/// `limit`  – 本次最多返回多少条提交。
/// `offset` – 跳过多少条提交（分页）。
pub fn get_commit_log<P: AsRef<Path>>(
    repo_path: P,
    limit: usize,
    offset: usize,
) -> AppResult<Vec<CommitInfo>> {
    let repo_path = repo_path.as_ref();

    // 刚 init 的仓库还没有 HEAD，`git log` 会以退出码 128 失败，
    // 这里直接返回空列表，避免把「空仓库」当成错误抛给界面。
    if run_git_string(repo_path, &["rev-parse", "--verify", "HEAD"]).is_err() {
        return Ok(Vec::new());
    }

    let limit_arg = format!("-{}", limit);
    let skip_arg = format!("--skip={}", offset);

    let raw = run_git_bytes(
        repo_path,
        &[
            "log",
            "--no-color",
            "--encoding=UTF-8",
            LOG_FORMAT,
            &limit_arg,
            &skip_arg,
        ],
    )?;

    Ok(parse_commit_log(&raw))
}

/// 解析 `git log` 的原始输出（NUL 分隔记录，RS 分隔字段）。
pub fn parse_commit_log(raw: &[u8]) -> Vec<CommitInfo> {
    let text = String::from_utf8_lossy(raw);
    let mut commits = Vec::new();

    for record in text.split('\0') {
        let record = record.trim_matches(['\n', '\r']);
        if record.is_empty() {
            continue;
        }

        let fields: Vec<&str> = record.splitn(9, FIELD_SEP).collect();
        if fields.len() < 8 {
            continue;
        }

        let hash = fields[0].trim().to_string();
        if hash.is_empty() {
            continue;
        }

        let parent_hashes = fields[7].trim();

        commits.push(CommitInfo {
            hash,
            short_hash: fields[1].trim().to_string(),
            subject: fields[2].trim().to_string(),
            author_name: fields[3].trim().to_string(),
            author_email: fields[4].trim().to_string(),
            date: fields[5].trim().to_string(),
            date_relative: fields[6].trim().to_string(),
            parent_count: parent_hashes.split_whitespace().count(),
            body: fields.get(8).map(|s| s.trim().to_string()).unwrap_or_default(),
        });
    }

    commits
}

/// 获取某次提交涉及的文件列表。
///
/// 使用 `git diff <base> <hash>` 而不是 `git diff-tree`：
/// - 根提交（无父提交）以空树为基准，`diff-tree` 需要额外的 `--root`；
/// - 合并提交在 `diff-tree` 下默认不输出任何内容，而 `git diff <parent> <hash>`
///   天然等价于「与第一个父提交比较」，与 diff 面板行为一致。
pub fn get_commit_files<P: AsRef<Path>>(
    repo_path: P,
    hash: &str,
) -> AppResult<Vec<CommitFile>> {
    let repo_path = repo_path.as_ref();

    validate_hash(hash)?;
    let base = commit_base(repo_path, hash)?;

    let name_status = run_git_bytes(
        repo_path,
        &["diff", "--name-status", "-M", "-z", &base, hash],
    )?;
    let numstat = run_git_bytes(
        repo_path,
        &["diff", "--numstat", "-M", "-z", &base, hash],
    )?;

    Ok(parse_commit_files(&numstat, &name_status))
}

/// 解析 `--numstat -z` 与 `--name-status -z` 的输出并合并成文件列表。
///
/// `-z` 模式下路径以 NUL 分隔，且不会被 Git 做八进制转义，因此中文、空格等
/// 特殊路径都能原样保留。
pub fn parse_commit_files(numstat: &[u8], name_status: &[u8]) -> Vec<CommitFile> {
    let stats = parse_numstat(numstat);

    let text = String::from_utf8_lossy(name_status);
    let tokens: Vec<&str> = text.split('\0').collect();

    let mut files = Vec::new();
    let mut i = 0;

    while i < tokens.len() {
        let token = tokens[i];
        if token.is_empty() {
            i += 1;
            continue;
        }

        let status_char = token.chars().next().unwrap_or(' ');
        let status = match status_char {
            'A' => FileStatus::Added,
            'D' => FileStatus::Deleted,
            'R' => FileStatus::Renamed,
            'C' => FileStatus::Copied,
            _ => FileStatus::Modified,
        };

        let (path, old_path, consumed) = if matches!(status_char, 'R' | 'C') && i + 2 < tokens.len() {
            (
                tokens[i + 2].to_string(),
                Some(tokens[i + 1].to_string()),
                3,
            )
        } else if i + 1 < tokens.len() {
            (tokens[i + 1].to_string(), None, 2)
        } else {
            break;
        };

        let (additions, deletions) = stats.get(&path).copied().unwrap_or((0, 0));

        files.push(CommitFile {
            path,
            old_path,
            status,
            additions,
            deletions,
        });

        i += consumed;
    }

    files
}

/// 解析 `git diff --numstat -M -z`：`新增\t删除\t路径\0`，
/// 重命名/复制为 `新增\t删除\t\0旧路径\0新路径\0`。
fn parse_numstat(numstat: &[u8]) -> HashMap<String, (usize, usize)> {
    let text = String::from_utf8_lossy(numstat);
    let tokens: Vec<&str> = text.split('\0').collect();

    let mut stats = HashMap::new();
    let mut i = 0;

    while i < tokens.len() {
        let token = tokens[i];
        if token.is_empty() {
            i += 1;
            continue;
        }

        let parts: Vec<&str> = token.splitn(3, '\t').collect();
        if parts.len() < 3 {
            i += 1;
            continue;
        }

        // 二进制文件的行数显示为 "-"，这里按 0 处理。
        let additions = parts[0].parse::<usize>().unwrap_or(0);
        let deletions = parts[1].parse::<usize>().unwrap_or(0);

        if parts[2].is_empty() {
            // 重命名/复制：后两个 token 分别是旧路径和新路径。
            if i + 2 < tokens.len() {
                stats.insert(tokens[i + 2].to_string(), (additions, deletions));
                i += 3;
                continue;
            }
            i += 1;
        } else {
            stats.insert(parts[2].to_string(), (additions, deletions));
            i += 1;
        }
    }

    stats
}

/// 获取某次提交中单个文件的 diff。
///
/// 以第一个父提交（根提交则以空树）为基准，与 `get_commit_files` 保持一致。
/// 重命名文件会同时把旧路径加入 pathspec，以便 Git 有机会识别出重命名。
pub fn get_commit_file_diff<P: AsRef<Path>>(
    repo_path: P,
    hash: &str,
    file_path: &str,
    old_path: Option<&str>,
) -> AppResult<FileDiff> {
    let repo_path = repo_path.as_ref();

    validate_hash(hash)?;
    let base = commit_base(repo_path, hash)?;

    let mut args: Vec<&str> = vec!["diff", "--no-color", "-M", &base, hash, "--"];
    match old_path {
        Some(old) if !old.is_empty() && old != file_path => {
            args.push(old);
            args.push(file_path);
        }
        _ => args.push(file_path),
    }

    let diff_bytes = run_git_bytes(repo_path, &args)?;

    if diff_bytes.is_empty() {
        return Ok(empty_diff(file_path));
    }

    parse_unified_diff(&diff_bytes, file_path)
}

fn empty_diff(path: &str) -> FileDiff {
    FileDiff {
        old_path: path.to_string(),
        new_path: path.to_string(),
        old_mode: None,
        new_mode: None,
        is_binary: false,
        is_new: false,
        is_deleted: false,
        hunks: vec![],
        additions: 0,
        deletions: 0,
        error: None,
    }
}

/// 计算提交的对比基准：第一个父提交；根提交返回空树哈希。
fn commit_base(repo_path: &Path, hash: &str) -> AppResult<String> {
    // 先确认这是一个真实存在的提交，避免把「无效哈希」误判成根提交。
    run_git_string(
        repo_path,
        &["rev-parse", "--verify", &format!("{}^{{commit}}", hash)],
    )
    .map_err(|_| AppError::GitCommand(format!("Unknown commit: {}", hash)))?;

    match run_git_string(repo_path, &["rev-parse", "--verify", &format!("{}^", hash)]) {
        Ok(parent) => Ok(parent.trim().to_string()),
        Err(_) => Ok(EMPTY_TREE.to_string()),
    }
}

/// 校验哈希格式：4-40 位十六进制字符。
fn validate_hash(hash: &str) -> AppResult<()> {
    if hash.is_empty() || hash.len() > 40 || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(AppError::ParseError(format!("Invalid commit hash: {}", hash)));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn log_record(
        hash: &str,
        short: &str,
        subject: &str,
        parents: &str,
        body: &str,
    ) -> String {
        format!(
            "{}\x1e{}\x1e{}\x1eAlice\x1ealice@example.com\x1e2024-01-02T03:04:05+08:00\x1e2 days ago\x1e{}\x1e{}\x00",
            hash, short, subject, parents, body
        )
    }

    #[test]
    fn parses_single_commit() {
        let raw = log_record("a".repeat(40).as_str(), "aaaaaaa", "initial commit", "", "");
        let commits = parse_commit_log(raw.as_bytes());

        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].hash, "a".repeat(40));
        assert_eq!(commits[0].short_hash, "aaaaaaa");
        assert_eq!(commits[0].subject, "initial commit");
        assert_eq!(commits[0].author_name, "Alice");
        assert_eq!(commits[0].author_email, "alice@example.com");
        assert_eq!(commits[0].date_relative, "2 days ago");
        // 根提交没有父提交
        assert_eq!(commits[0].parent_count, 0);
        assert!(commits[0].body.is_empty());
    }

    #[test]
    fn parses_multiple_commits() {
        let mut raw = log_record(&"a".repeat(40), "aaaaaaa", "first", "", "");
        raw.push_str(&log_record(&"b".repeat(40), "bbbbbbb", "second", "", ""));

        let commits = parse_commit_log(raw.as_bytes());
        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].subject, "first");
        assert_eq!(commits[1].subject, "second");
    }

    #[test]
    fn parses_merge_commit_parent_count() {
        let parents = format!("{} {}", "a".repeat(40), "b".repeat(40));
        let raw = log_record(&"c".repeat(40), "ccccccc", "merge branch", &parents, "");
        let commits = parse_commit_log(raw.as_bytes());

        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].parent_count, 2);
    }

    #[test]
    fn parses_chinese_subject_and_body_with_separators() {
        let body = "第一行说明\x1e第二行说明\n第三行";
        let raw = log_record(&"d".repeat(40), "ddddddd", "修复：中文标题 含空格", "", body);
        let commits = parse_commit_log(raw.as_bytes());

        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].subject, "修复：中文标题 含空格");
        // 正文包含字段分隔符时也不应破坏解析
        assert!(commits[0].body.contains("第一行说明"));
        assert!(commits[0].body.contains("第三行"));
    }

    #[test]
    fn empty_output_yields_no_commits() {
        assert!(parse_commit_log(b"").is_empty());
        assert!(parse_commit_log(b"\0\0").is_empty());
    }

    #[test]
    fn parses_commit_files_with_rename() {
        let name_status = "R100\0a.txt\0中文 文件.txt\0".as_bytes();
        let numstat = "0\t0\t\0a.txt\0中文 文件.txt\0".as_bytes();

        let files = parse_commit_files(numstat, name_status);

        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "中文 文件.txt");
        assert_eq!(files[0].old_path.as_deref(), Some("a.txt"));
        assert_eq!(files[0].status, FileStatus::Renamed);
        assert_eq!((files[0].additions, files[0].deletions), (0, 0));
    }

    #[test]
    fn parses_commit_files_with_add_modify_delete() {
        let name_status = "A\0new file.txt\0M\0src/main.rs\0D\0old.md\0".as_bytes();
        let numstat = "12\t0\tnew file.txt\x006\t3\tsrc/main.rs\x000\t40\told.md\x00".as_bytes();

        let files = parse_commit_files(numstat, name_status);

        assert_eq!(files.len(), 3);
        assert_eq!(files[0].status, FileStatus::Added);
        assert_eq!((files[0].additions, files[0].deletions), (12, 0));
        assert_eq!(files[1].status, FileStatus::Modified);
        assert_eq!((files[1].additions, files[1].deletions), (6, 3));
        assert_eq!(files[2].status, FileStatus::Deleted);
        assert_eq!((files[2].additions, files[2].deletions), (0, 40));
    }

    #[test]
    fn parses_binary_numstat_as_zero() {
        let name_status = "M\0assets/logo.png\0".as_bytes();
        let numstat = "-\t-\tassets/logo.png\0".as_bytes();

        let files = parse_commit_files(numstat, name_status);

        assert_eq!(files.len(), 1);
        assert_eq!((files[0].additions, files[0].deletions), (0, 0));
    }

    #[test]
    fn parses_copied_file() {
        let name_status = "C075\0src/a.rs\0src/b.rs\0".as_bytes();
        let numstat = "3\t0\t\0src/a.rs\0src/b.rs\0".as_bytes();

        let files = parse_commit_files(numstat, name_status);

        assert_eq!(files.len(), 1);
        assert_eq!(files[0].status, FileStatus::Copied);
        assert_eq!(files[0].path, "src/b.rs");
        assert_eq!(files[0].old_path.as_deref(), Some("src/a.rs"));
        assert_eq!((files[0].additions, files[0].deletions), (3, 0));
    }

    #[test]
    fn empty_name_status_yields_no_files() {
        assert!(parse_commit_files(b"", b"").is_empty());
    }

    #[test]
    fn accepts_valid_hashes() {
        assert!(validate_hash("abc1234").is_ok());
        assert!(validate_hash(&"a".repeat(40)).is_ok());
    }

    #[test]
    fn rejects_invalid_hashes() {
        assert!(validate_hash("").is_err());
        assert!(validate_hash("zzzzzzz").is_err());
        assert!(validate_hash(&"a".repeat(41)).is_err());
        assert!(validate_hash("--all").is_err());
    }
}

/// 使用真实 Git 仓库的端到端测试。
///
/// 目的：覆盖 `git log` / `git diff` 的实际调用路径 —— 解析单测无法发现
/// 「命令行参数里带非法字符导致进程启动失败」这类问题。
#[cfg(test)]
mod real_repo_tests {
    use super::*;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TempRepo(PathBuf);

    impl Drop for TempRepo {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn git(dir: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .args(["-c", "user.email=test@example.com", "-c", "user.name=Test User"])
            .args(args)
            .current_dir(dir)
            .output()
            .expect("failed to spawn git");
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    fn init_repo() -> Option<TempRepo> {
        // 没装 Git 时跳过（显式提示，避免伪装成「测试通过」）
        if Command::new("git").arg("--version").output().is_err() {
            eprintln!("skipping: git is not available in this environment");
            return None;
        }

        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let path = std::env::temp_dir().join(format!("gitlensy-history-{}", unique));
        fs::create_dir_all(&path).expect("failed to create temp repo");

        let repo = TempRepo(path);
        git(&repo.0, &["init"]);
        Some(repo)
    }

    fn write(dir: &Path, name: &str, contents: &str) {
        fs::write(dir.join(name), contents).expect("failed to write file");
    }

    #[test]
    fn empty_repository_has_no_commits() {
        let Some(repo) = init_repo() else { return };
        let commits = get_commit_log(&repo.0, 50, 0).expect("log on empty repo should succeed");
        assert!(commits.is_empty());
    }

    #[test]
    fn reads_real_history_end_to_end() {
        let Some(repo) = init_repo() else { return };
        let dir = &repo.0;

        // ── 根提交 ────────────────────────────────────────────────
        write(dir, "a.txt", "line1\nline2\n");
        git(dir, &["add", "-A"]);
        git(dir, &["commit", "-m", "initial commit"]);

        let root_hash = git(dir, &["rev-parse", "HEAD"]);

        let commits = get_commit_log(dir, 50, 0).expect("git log should succeed");
        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].subject, "initial commit");
        assert_eq!(commits[0].parent_count, 0);
        assert_eq!(commits[0].hash, root_hash);

        // 根提交的文件列表：diff-tree 默认输出为空，这里必须能拿到 a.txt
        let root_files = get_commit_files(dir, &root_hash).expect("commit files");
        assert_eq!(root_files.len(), 1);
        assert_eq!(root_files[0].path, "a.txt");
        assert_eq!(root_files[0].status, FileStatus::Added);
        assert_eq!(root_files[0].additions, 2);

        // 根提交的 diff：以空树为基准，应当能看到新增内容
        let root_diff =
            get_commit_file_diff(dir, &root_hash, "a.txt", None).expect("root diff");
        assert!(root_diff.is_new);
        assert!(!root_diff.hunks.is_empty());
        assert_eq!(root_diff.additions, 2);

        // ── 修改文件 ──────────────────────────────────────────────
        write(dir, "a.txt", "line1\nline2 changed\n");
        git(dir, &["add", "-A"]);
        git(dir, &["commit", "-m", "modify a"]);
        let modify_hash = git(dir, &["rev-parse", "HEAD"]);

        let files = get_commit_files(dir, &modify_hash).expect("commit files");
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].status, FileStatus::Modified);
        assert_eq!((files[0].additions, files[0].deletions), (1, 1));

        let diff = get_commit_file_diff(dir, &modify_hash, "a.txt", None).expect("diff");
        assert!(!diff.is_new);
        assert!(diff.hunks.iter().any(|h| h
            .lines
            .iter()
            .any(|l| matches!(l.line_type, crate::models::DiffLineType::Add))));
        assert!(diff.hunks.iter().any(|h| h
            .lines
            .iter()
            .any(|l| matches!(l.line_type, crate::models::DiffLineType::Remove))));

        // ── 重命名（含中文与空格）────────────────────────────────
        fs::rename(dir.join("a.txt"), dir.join("中文 文件.txt")).expect("rename");
        git(dir, &["add", "-A"]);
        git(dir, &["commit", "-m", "rename file"]);
        let rename_hash = git(dir, &["rev-parse", "HEAD"]);

        let files = get_commit_files(dir, &rename_hash).expect("commit files");
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].status, FileStatus::Renamed);
        assert_eq!(files[0].path, "中文 文件.txt");
        assert_eq!(files[0].old_path.as_deref(), Some("a.txt"));

        // ── 合并提交（与第一个父提交比较）────────────────────────
        let base_branch = git(dir, &["rev-parse", "--abbrev-ref", "HEAD"]);

        git(dir, &["checkout", "-b", "feature"]);
        write(dir, "feature.txt", "from feature\n");
        git(dir, &["add", "-A"]);
        git(dir, &["commit", "-m", "feature work"]);

        git(dir, &["checkout", &base_branch]);
        write(dir, "main.txt", "from main\n");
        git(dir, &["add", "-A"]);
        git(dir, &["commit", "-m", "main work"]);

        git(dir, &["merge", "--no-ff", "feature", "-m", "merge feature"]);
        let merge_hash = git(dir, &["rev-parse", "HEAD"]);

        let merge_files = get_commit_files(dir, &merge_hash).expect("merge commit files");
        assert_eq!(merge_files.len(), 1);
        assert_eq!(merge_files[0].path, "feature.txt");
    }
}
