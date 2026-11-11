use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepositoryInfo {
    pub path: String,
    pub name: String,
    pub branch: String,
    pub is_detached: bool,
}

/// 当前分支与上游远程的同步状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncStatus {
    pub branch: String,
    pub has_upstream: bool,
    pub ahead: usize,
    pub behind: usize,
}

/// 一条贮藏记录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StashEntry {
    pub index: usize,
    pub ref_name: String,
    pub message: String,
    pub date: String,
}

/// 本地 / 远程分支列表
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BranchList {
    /// 当前分支名；detached HEAD 时为空
    pub current: String,
    pub local: Vec<String>,
    pub remote: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileStatus {
    Modified,
    Added,
    Deleted,
    Renamed,
    Copied,
    Conflict,
    Untracked,
    Ignored,
    Unchanged,
}

impl FileStatus {
    pub fn from_char(c: char) -> Option<Self> {
        match c {
            'M' => Some(FileStatus::Modified),
            'A' => Some(FileStatus::Added),
            'D' => Some(FileStatus::Deleted),
            'R' => Some(FileStatus::Renamed),
            'C' => Some(FileStatus::Copied),
            'U' => Some(FileStatus::Conflict),
            '?' => Some(FileStatus::Untracked),
            '!' => Some(FileStatus::Ignored),
            ' ' => Some(FileStatus::Unchanged),
            _ => None,
        }
    }

    pub fn is_conflict(c: char) -> bool {
        matches!(c, 'U' | 'A' | 'D')
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChangedFile {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
    pub status: FileStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub staged_status: Option<FileStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unstaged_status: Option<FileStatus>,
    pub additions: usize,
    pub deletions: usize,
    pub is_binary: bool,
    pub has_staged_changes: bool,
    pub has_unstaged_changes: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitStatus {
    pub staged: Vec<ChangedFile>,
    pub unstaged: Vec<ChangedFile>,
    pub branch: String,
    pub is_detached: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DiffLineType {
    Add,
    Remove,
    Context,
    Hunk,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffLine {
    #[serde(rename = "type")]
    pub line_type: DiffLineType,
    pub content: String,
    pub old_line_number: i32,
    pub new_line_number: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffHunk {
    pub old_start: i32,
    pub old_lines: i32,
    pub new_start: i32,
    pub new_lines: i32,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileDiff {
    pub old_path: String,
    pub new_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_mode: Option<String>,
    pub is_binary: bool,
    pub is_new: bool,
    pub is_deleted: bool,
    pub hunks: Vec<DiffHunk>,
    pub additions: usize,
    pub deletions: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DiffView {
    Staged,
    Unstaged,
}

/// A single commit entry from git log.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitInfo {
    /// Full 40-char SHA
    pub hash: String,
    /// Abbreviated 7-char SHA
    pub short_hash: String,
    /// First line of the commit message
    pub subject: String,
    /// Full commit message body (may be empty)
    pub body: String,
    pub author_name: String,
    pub author_email: String,
    /// ISO-8601 timestamp (UTC)
    pub date: String,
    /// Human-readable relative time ("3 days ago")
    pub date_relative: String,
    /// Number of parents (0 = root, 2+ = merge)
    pub parent_count: usize,
    /// Full parent SHAs in order (first parent first)
    pub parents: Vec<String>,
}

/// A file entry in a commit's changeset.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitFile {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
    pub status: FileStatus,
    pub additions: usize,
    pub deletions: usize,
}

/// 当前仓库是否处于 rebase / cherry-pick 等多步操作中。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperationState {
    pub in_progress: bool,
    /// "rebase" | "cherry-pick" | "none"
    pub kind: String,
}
