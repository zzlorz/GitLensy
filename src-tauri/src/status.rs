use std::collections::HashMap;
use std::path::Path;

use crate::error::{AppError, AppResult};
use crate::git::run_git_bytes;
use crate::models::{ChangedFile, FileStatus, GitStatus};

/// Parse git status --porcelain=v1 -z output into structured status.
pub fn parse_status(output: &[u8]) -> AppResult<Vec<ParsedStatusEntry>> {
    let mut entries = Vec::new();
    let mut i = 0;

    while i < output.len() {
        // Each entry starts with XY (2 chars) + space (1 char) = 3 bytes before the path
        if i + 3 > output.len() {
            break;
        }

        let x = output[i] as char;
        let y = output[i + 1] as char;
        // output[i+2] should be ' '

        i += 3; // skip "XY "

        // Read the first path (NUL-terminated)
        let (path, new_i) = read_nul_string(output, i)?;
        i = new_i;

        // For rename/copy, there's a second path
        let mut old_path: Option<String> = None;
        if x == 'R' || x == 'C' || y == 'R' || y == 'C' {
            let (old_p, new_i) = read_nul_string(output, i)?;
            old_path = Some(old_p);
            i = new_i;
        }

        entries.push(ParsedStatusEntry {
            staged_status: FileStatus::from_char(x),
            unstaged_status: FileStatus::from_char(y),
            path,
            old_path,
        });
    }

    Ok(entries)
}

/// Read a NUL-terminated string from bytes starting at position i.
/// Returns the string and the position after the NUL.
fn read_nul_string(bytes: &[u8], start: usize) -> AppResult<(String, usize)> {
    let mut end = start;
    while end < bytes.len() && bytes[end] != 0 {
        end += 1;
    }

    if end >= bytes.len() {
        return Err(AppError::ParseError("Unexpected end of status output".into()));
    }

    let s = String::from_utf8_lossy(&bytes[start..end]).to_string();
    Ok((s, end + 1)) // skip the NUL byte
}

/// Intermediate representation of a parsed status line.
#[derive(Debug, Clone)]
pub struct ParsedStatusEntry {
    pub staged_status: Option<FileStatus>,
    pub unstaged_status: Option<FileStatus>,
    pub path: String,
    pub old_path: Option<String>,
}

/// Combine parsed entries into staged and unstaged file lists.
pub fn build_file_lists(entries: &[ParsedStatusEntry]) -> (Vec<ChangedFile>, Vec<ChangedFile>) {
    let mut staged = Vec::new();
    let mut unstaged = Vec::new();
    let mut file_map: HashMap<String, ChangedFile> = HashMap::new();

    for entry in entries {
        // Skip ignored files
        if entry.staged_status == Some(FileStatus::Ignored)
            || entry.unstaged_status == Some(FileStatus::Ignored)
        {
            continue;
        }

        // Untracked files only appear in unstaged list (they're not in the index)
        let is_untracked = entry.staged_status == Some(FileStatus::Untracked)
            && entry.unstaged_status == Some(FileStatus::Untracked);

        let has_staged = if is_untracked {
            false
        } else {
            entry.staged_status.map(|s| s != FileStatus::Unchanged).unwrap_or(false)
        };
        let has_unstaged = entry.unstaged_status.map(|s| s != FileStatus::Unchanged).unwrap_or(false);

        // Determine overall/display status
        let primary_status = if has_staged {
            entry.staged_status.unwrap_or(FileStatus::Unchanged)
        } else {
            entry.unstaged_status.unwrap_or(FileStatus::Unchanged)
        };

        let file = ChangedFile {
            path: entry.path.clone(),
            old_path: entry.old_path.clone(),
            status: primary_status,
            staged_status: entry.staged_status,
            unstaged_status: entry.unstaged_status,
            additions: 0,
            deletions: 0,
            is_binary: false,
            has_staged_changes: has_staged,
            has_unstaged_changes: has_unstaged,
        };

        file_map.insert(entry.path.clone(), file);

        if has_staged {
            staged.push(entry.path.clone());
        }
        if has_unstaged {
            unstaged.push(entry.path.clone());
        }
    }

    // Build the final lists
    let staged_files: Vec<ChangedFile> = staged
        .iter()
        .filter_map(|p| file_map.get(p).cloned())
        .collect();

    let unstaged_files: Vec<ChangedFile> = unstaged
        .iter()
        .filter_map(|p| file_map.get(p).cloned())
        .collect();

    (staged_files, unstaged_files)
}

/// Parse git diff --numstat output into a map of path -> (additions, deletions).
pub fn parse_numstat(output: &str) -> HashMap<String, (usize, usize)> {
    let mut map = HashMap::new();
    for line in output.lines() {
        let parts: Vec<&str> = line.splitn(3, '\t').collect();
        if parts.len() == 3 {
            let additions = parts[0].parse::<usize>().unwrap_or(0);
            let deletions = parts[1].parse::<usize>().unwrap_or(0);
            // For rename/copy, the path is in the third column (may have "old => new")
            let path = parts[2].to_string();
            map.insert(path, (additions, deletions));
        }
    }
    map
}

/// Get numstat for staged changes.
fn get_staged_numstat<P: AsRef<Path>>(repo_path: P) -> AppResult<HashMap<String, (usize, usize)>> {
    let output = crate::git::run_git_string(
        repo_path,
        &["diff", "--cached", "--numstat"],
    )?;
    Ok(parse_numstat(&output))
}

/// Get numstat for unstaged changes.
fn get_unstaged_numstat<P: AsRef<Path>>(repo_path: P) -> AppResult<HashMap<String, (usize, usize)>> {
    let output = crate::git::run_git_string(
        repo_path,
        &["diff", "--numstat"],
    )?;
    Ok(parse_numstat(&output))
}

/// Get full git status for a repository.
pub fn get_status<P: AsRef<Path>>(repo_path: P) -> AppResult<GitStatus> {
    let repo_path = repo_path.as_ref();

    // Get status with porcelain v1, NUL-separated
    let status_bytes = run_git_bytes(repo_path, &["status", "--porcelain=v1", "-z"])?;
    let entries = parse_status(&status_bytes)?;
    let (mut staged, mut unstaged) = build_file_lists(&entries);

    // Get numstat for line counts
    let staged_numstat = get_staged_numstat(repo_path).unwrap_or_default();
    let unstaged_numstat = get_unstaged_numstat(repo_path).unwrap_or_default();

    // Apply numstat to staged files
    for file in &mut staged {
        if let Some((add, del)) = staged_numstat.get(&file.path) {
            file.additions = *add;
            file.deletions = *del;
        }
        // For untracked files in staged (shouldn't happen normally)
    }

    // Apply numstat to unstaged files
    for file in &mut unstaged {
        // For untracked files, we can't get numstat from git diff
        if file.status == FileStatus::Untracked {
            // Try to count lines in the file
            let full_path = repo_path.join(&file.path);
            if let Ok(content) = std::fs::read_to_string(&full_path) {
                file.additions = content.lines().count();
                file.deletions = 0;
            }
        } else if let Some((add, del)) = unstaged_numstat.get(&file.path) {
            file.additions = *add;
            file.deletions = *del;
        }
    }

    // Sort files by path
    staged.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
    unstaged.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));

    // Get branch info
    let branch_output = crate::git::run_git_string(repo_path, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    let branch = branch_output.trim().to_string();
    let is_detached = branch == "HEAD";

    Ok(GitStatus {
        staged,
        unstaged,
        branch,
        is_detached,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_z(s: &str) -> Vec<u8> {
        let mut v = s.as_bytes().to_vec();
        v.push(0); // NUL terminator
        v
    }

    #[test]
    fn test_parse_modified_file() {
        // Modified file in working tree (unstaged)
        let mut data = Vec::new();
        data.extend_from_slice(b" M ");
        data.extend(make_z("src/main.rs"));

        let entries = parse_status(&data).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].path, "src/main.rs");
        assert_eq!(entries[0].staged_status, Some(FileStatus::Unchanged));
        assert_eq!(entries[0].unstaged_status, Some(FileStatus::Modified));
    }

    #[test]
    fn test_parse_staged_addition() {
        // New file staged
        let mut data = Vec::new();
        data.extend_from_slice(b"A  ");
        data.extend(make_z("new_file.txt"));

        let entries = parse_status(&data).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].staged_status, Some(FileStatus::Added));
        assert_eq!(entries[0].unstaged_status, Some(FileStatus::Unchanged));
    }

    #[test]
    fn test_parse_deleted_file() {
        // Deleted file (staged)
        let mut data = Vec::new();
        data.extend_from_slice(b"D  ");
        data.extend(make_z("deleted_file.txt"));

        let entries = parse_status(&data).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].staged_status, Some(FileStatus::Deleted));
    }

    #[test]
    fn test_parse_both_staged_and_unstaged() {
        // File staged then modified again
        let mut data = Vec::new();
        data.extend_from_slice(b"MM ");
        data.extend(make_z("both_changed.rs"));

        let entries = parse_status(&data).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].staged_status, Some(FileStatus::Modified));
        assert_eq!(entries[0].unstaged_status, Some(FileStatus::Modified));
    }

    #[test]
    fn test_parse_untracked_file() {
        let mut data = Vec::new();
        data.extend_from_slice(b"?? ");
        data.extend(make_z("untracked.txt"));

        let entries = parse_status(&data).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].staged_status, Some(FileStatus::Untracked));
        assert_eq!(entries[0].unstaged_status, Some(FileStatus::Untracked));
    }

    #[test]
    fn test_parse_renamed_file() {
        let mut data = Vec::new();
        data.extend_from_slice(b"R  ");
        data.extend(make_z("new_name.txt"));
        data.extend(make_z("old_name.txt"));

        let entries = parse_status(&data).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].staged_status, Some(FileStatus::Renamed));
        assert_eq!(entries[0].path, "new_name.txt");
        assert_eq!(entries[0].old_path, Some("old_name.txt".to_string()));
    }

    #[test]
    fn test_parse_conflict() {
        let mut data = Vec::new();
        data.extend_from_slice(b"UU ");
        data.extend(make_z("conflict_file.txt"));

        let entries = parse_status(&data).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].staged_status, Some(FileStatus::Conflict));
        assert_eq!(entries[0].unstaged_status, Some(FileStatus::Conflict));
    }

    #[test]
    fn test_parse_path_with_spaces() {
        let mut data = Vec::new();
        data.extend_from_slice(b" M ");
        data.extend(make_z("my file with spaces.txt"));

        let entries = parse_status(&data).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].path, "my file with spaces.txt");
    }

    #[test]
    fn test_parse_path_with_chinese() {
        let mut data = Vec::new();
        data.extend_from_slice(b" M ");
        data.extend(make_z("中文文件.txt"));

        let entries = parse_status(&data).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].path, "中文文件.txt");
    }

    #[test]
    fn test_parse_multiple_files() {
        let mut data = Vec::new();

        data.extend_from_slice(b" M ");
        data.extend(make_z("file1.rs"));

        data.extend_from_slice(b"A  ");
        data.extend(make_z("file2.rs"));

        data.extend_from_slice(b" D ");
        data.extend(make_z("file3.rs"));

        let entries = parse_status(&data).unwrap();
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].path, "file1.rs");
        assert_eq!(entries[1].path, "file2.rs");
        assert_eq!(entries[2].path, "file3.rs");
    }

    #[test]
    fn test_parse_empty_status() {
        let entries = parse_status(b"").unwrap();
        assert_eq!(entries.len(), 0);
    }

    #[test]
    fn test_build_file_lists_both_changed() {
        let entries = vec![
            ParsedStatusEntry {
                staged_status: Some(FileStatus::Modified),
                unstaged_status: Some(FileStatus::Modified),
                path: "both.rs".to_string(),
                old_path: None,
            },
            ParsedStatusEntry {
                staged_status: Some(FileStatus::Added),
                unstaged_status: Some(FileStatus::Unchanged),
                path: "staged_only.rs".to_string(),
                old_path: None,
            },
            ParsedStatusEntry {
                staged_status: Some(FileStatus::Unchanged),
                unstaged_status: Some(FileStatus::Modified),
                path: "unstaged_only.rs".to_string(),
                old_path: None,
            },
        ];

        let (staged, unstaged) = build_file_lists(&entries);

        assert_eq!(staged.len(), 2);
        assert_eq!(unstaged.len(), 2);

        // both.rs should be in both lists
        assert!(staged.iter().any(|f| f.path == "both.rs"));
        assert!(unstaged.iter().any(|f| f.path == "both.rs"));
    }

    #[test]
    fn test_ignored_files_skipped() {
        let entries = vec![
            ParsedStatusEntry {
                staged_status: Some(FileStatus::Ignored),
                unstaged_status: Some(FileStatus::Ignored),
                path: "ignored.log".to_string(),
                old_path: None,
            },
            ParsedStatusEntry {
                staged_status: Some(FileStatus::Modified),
                unstaged_status: Some(FileStatus::Unchanged),
                path: "real.rs".to_string(),
                old_path: None,
            },
        ];

        let (staged, unstaged) = build_file_lists(&entries);
        assert_eq!(staged.len(), 1);
        assert_eq!(unstaged.len(), 0);
        assert_eq!(staged[0].path, "real.rs");
    }

    #[test]
    fn test_parse_numstat() {
        let input = "10\t5\tsrc/main.rs\n3\t0\tREADME.md\n0\t2\tdeleted.txt\n";
        let result = parse_numstat(input);
        assert_eq!(result.len(), 3);
        assert_eq!(result.get("src/main.rs"), Some(&(10, 5)));
        assert_eq!(result.get("README.md"), Some(&(3, 0)));
        assert_eq!(result.get("deleted.txt"), Some(&(0, 2)));
    }

    #[test]
    fn test_parse_numstat_empty() {
        let result = parse_numstat("");
        assert_eq!(result.len(), 0);
    }

    #[test]
    fn test_parse_numstat_binary_file() {
        // Binary files show "-" for both counts
        let input = "-\t-\timage.png\n";
        let result = parse_numstat(input);
        assert_eq!(result.len(), 1);
        assert_eq!(result.get("image.png"), Some(&(0, 0)));
    }

    #[test]
    fn test_untracked_only_in_unstaged() {
        let entries = vec![
            ParsedStatusEntry {
                staged_status: Some(FileStatus::Untracked),
                unstaged_status: Some(FileStatus::Untracked),
                path: "new_untracked.txt".to_string(),
                old_path: None,
            },
        ];

        let (staged, unstaged) = build_file_lists(&entries);
        assert_eq!(staged.len(), 0, "untracked files should not be in staged list");
        assert_eq!(unstaged.len(), 1);
        assert_eq!(unstaged[0].path, "new_untracked.txt");
        assert!(!unstaged[0].has_staged_changes);
        assert!(unstaged[0].has_unstaged_changes);
    }
}
