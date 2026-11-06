use std::path::Path;

use crate::error::{AppError, AppResult};
use crate::git::run_git_bytes;
use crate::models::{DiffHunk, DiffLine, DiffLineType, DiffView, FileDiff};

/// Get the diff for a specific file.
pub fn get_file_diff<P: AsRef<Path>>(
    repo_path: P,
    file_path: &str,
    view: DiffView,
) -> AppResult<FileDiff> {
    let repo_path = repo_path.as_ref();

    let args = match view {
        DiffView::Staged => vec!["diff", "--cached", "--no-color", "--", file_path],
        DiffView::Unstaged => vec!["diff", "--no-color", "--", file_path],
    };

    let diff_bytes = run_git_bytes(repo_path, &args)?;

    // Check for empty diff (no changes)
    if diff_bytes.is_empty() {
        // For unstaged view on an untracked file, we need to show the file content
        if matches!(view, DiffView::Unstaged) {
            // Check if file exists and is untracked
            let full_path = repo_path.join(file_path);
            if full_path.exists() && full_path.is_file() {
                return get_new_file_diff(&full_path, file_path);
            }
        }

        return Ok(FileDiff {
            old_path: file_path.to_string(),
            new_path: file_path.to_string(),
            old_mode: None,
            new_mode: None,
            is_binary: false,
            is_new: false,
            is_deleted: false,
            hunks: vec![],
            additions: 0,
            deletions: 0,
            error: None,
        });
    }

    parse_unified_diff(&diff_bytes, file_path)
}

/// Get diff for a new (untracked) file by reading its content.
fn get_new_file_diff(file_path: &Path, display_path: &str) -> AppResult<FileDiff> {
    let content = std::fs::read(file_path)?;

    // Check if binary
    if is_binary_content(&content) {
        return Ok(FileDiff {
            old_path: "/dev/null".to_string(),
            new_path: display_path.to_string(),
            old_mode: None,
            new_mode: None,
            is_binary: true,
            is_new: true,
            is_deleted: false,
            hunks: vec![],
            additions: 0,
            deletions: 0,
            error: None,
        });
    }

    let text = String::from_utf8_lossy(&content);
    let lines: Vec<&str> = text.lines().collect();
    let mut diff_lines = Vec::new();
    let mut additions = 0;

    for (i, line) in lines.iter().enumerate() {
        diff_lines.push(DiffLine {
            line_type: DiffLineType::Add,
            content: line.to_string(),
            old_line_number: 0,
            new_line_number: (i + 1) as i32,
        });
        additions += 1;
    }

    // Handle non-newline at end of file
    if !text.ends_with('\n') && !text.is_empty() {
        // Last line was already added, but we should note it
    }

    let hunk = DiffHunk {
        old_start: 0,
        old_lines: 0,
        new_start: 1,
        new_lines: lines.len() as i32,
        lines: diff_lines,
    };

    Ok(FileDiff {
        old_path: "/dev/null".to_string(),
        new_path: display_path.to_string(),
        old_mode: None,
        new_mode: None,
        is_binary: false,
        is_new: true,
        is_deleted: false,
        hunks: vec![hunk],
        additions,
        deletions: 0,
        error: None,
    })
}

/// Parse a unified diff into structured format.
pub fn parse_unified_diff(diff_bytes: &[u8], default_path: &str) -> AppResult<FileDiff> {
    // Check for binary diff
    let diff_text = String::from_utf8_lossy(diff_bytes);

    if diff_text.contains("Binary files") {
        return Ok(FileDiff {
            old_path: default_path.to_string(),
            new_path: default_path.to_string(),
            old_mode: None,
            new_mode: None,
            is_binary: true,
            is_new: false,
            is_deleted: false,
            hunks: vec![],
            additions: 0,
            deletions: 0,
            error: None,
        });
    }

    let lines: Vec<&str> = diff_text.lines().collect();
    let mut idx = 0;

    let mut old_path = default_path.to_string();
    let mut new_path = default_path.to_string();
    let mut old_mode = None;
    let mut new_mode = None;
    let mut is_new = false;
    let mut is_deleted = false;
    let mut is_binary = false;
    let mut hunks = Vec::new();
    let mut total_additions = 0usize;
    let mut total_deletions = 0usize;

    // Parse diff headers
    while idx < lines.len() {
        let line = lines[idx];

        if line.starts_with("diff --git") {
            // Parse paths from "diff --git a/path b/path"
            if let Some((old_p, new_p)) = parse_diff_git_header(line) {
                old_path = old_p;
                new_path = new_p;
            }
            idx += 1;
        } else if line.starts_with("old mode") {
            old_mode = Some(line["old mode ".len()..].to_string());
            idx += 1;
        } else if line.starts_with("new file mode") {
            new_mode = Some(line["new file mode ".len()..].to_string());
            is_new = true;
            idx += 1;
        } else if line.starts_with("deleted file mode") {
            old_mode = Some(line["deleted file mode ".len()..].to_string());
            is_deleted = true;
            idx += 1;
        } else if line.starts_with("new mode") {
            new_mode = Some(line["new mode ".len()..].to_string());
            idx += 1;
        } else if line.starts_with("--- ") {
            old_path = parse_diff_path_line(line, "--- ");
            idx += 1;
        } else if line.starts_with("+++ ") {
            new_path = parse_diff_path_line(line, "+++ ");
            idx += 1;
        } else if line.starts_with("Binary files") {
            is_binary = true;
            idx += 1;
            break;
        } else if line.starts_with("@@") {
            // Start of hunks
            break;
        } else {
            idx += 1;
        }
    }

    // Parse hunks
    while idx < lines.len() {
        let line = lines[idx];
        if line.starts_with("@@") {
            let (hunk, new_idx) = parse_hunk(&lines, idx)?;
            total_additions += hunk.lines.iter().filter(|l| matches!(l.line_type, DiffLineType::Add)).count();
            total_deletions += hunk.lines.iter().filter(|l| matches!(l.line_type, DiffLineType::Remove)).count();
            hunks.push(hunk);
            idx = new_idx;
        } else {
            idx += 1;
        }
    }

    Ok(FileDiff {
        old_path,
        new_path,
        old_mode,
        new_mode,
        is_binary,
        is_new,
        is_deleted,
        hunks,
        additions: total_additions,
        deletions: total_deletions,
        error: None,
    })
}

fn parse_diff_git_header(line: &str) -> Option<(String, String)> {
    // Format: "diff --git a/path b/path"
    let rest = line.strip_prefix("diff --git ")?;
    let parts: Vec<&str> = rest.splitn(2, " b/").collect();
    if parts.len() != 2 {
        return None;
    }
    let old = parts[0].strip_prefix("a/").unwrap_or(parts[0]).to_string();
    let new = parts[1].to_string();
    Some((old, new))
}

fn parse_diff_path_line(line: &str, prefix: &str) -> String {
    let path = line.strip_prefix(prefix).unwrap_or(line);
    // Remove tab and anything after
    let path = path.split('\t').next().unwrap_or(path);
    // Strip git diff a/ or b/ prefix
    let path = path.strip_prefix("a/").unwrap_or(path);
    let path = path.strip_prefix("b/").unwrap_or(path);
    path.to_string()
}

fn parse_hunk(lines: &[&str], start_idx: usize) -> AppResult<(DiffHunk, usize)> {
    let header = lines[start_idx];

    // Parse @@ -old_start,old_lines +new_start,new_lines @@
    let (old_start, old_lines, new_start, new_lines) = parse_hunk_header(header)?;

    let mut diff_lines = Vec::new();
    let mut old_line_num = old_start;
    let mut new_line_num = new_start;
    let mut idx = start_idx + 1;

    while idx < lines.len() {
        let line = lines[idx];

        if line.starts_with("@@") {
            // Next hunk
            break;
        }

        if line.starts_with("diff --git") {
            // Next file
            break;
        }

        if line.starts_with('+') && !line.starts_with("+++") {
            diff_lines.push(DiffLine {
                line_type: DiffLineType::Add,
                content: line[1..].to_string(),
                old_line_number: 0,
                new_line_number: new_line_num,
            });
            new_line_num += 1;
        } else if line.starts_with('-') && !line.starts_with("---") {
            diff_lines.push(DiffLine {
                line_type: DiffLineType::Remove,
                content: line[1..].to_string(),
                old_line_number: old_line_num,
                new_line_number: 0,
            });
            old_line_num += 1;
        } else if line.starts_with(' ') {
            diff_lines.push(DiffLine {
                line_type: DiffLineType::Context,
                content: line[1..].to_string(),
                old_line_number: old_line_num,
                new_line_number: new_line_num,
            });
            old_line_num += 1;
            new_line_num += 1;
        } else if line.starts_with("\\ No newline at end of file") {
            // Skip this marker
        } else {
            // Unknown line type, treat as context
            diff_lines.push(DiffLine {
                line_type: DiffLineType::Context,
                content: line.to_string(),
                old_line_number: old_line_num,
                new_line_number: new_line_num,
            });
            old_line_num += 1;
            new_line_num += 1;
        }

        idx += 1;
    }

    Ok((
        DiffHunk {
            old_start,
            old_lines,
            new_start,
            new_lines,
            lines: diff_lines,
        },
        idx,
    ))
}

fn parse_hunk_header(header: &str) -> AppResult<(i32, i32, i32, i32)> {
    // Format: @@ -old_start,old_lines +new_start,new_lines @@ [context]
    let parts: Vec<&str> = header.split(" @@").collect();
    let range_part = parts.first().ok_or_else(|| {
        AppError::ParseError(format!("Invalid hunk header: {}", header))
    })?;

    // Remove leading @@
    let range_part = range_part.strip_prefix("@@ ").unwrap_or(range_part);

    let ranges: Vec<&str> = range_part.split(' ').collect();
    if ranges.len() < 2 {
        return Err(AppError::ParseError(format!(
            "Invalid hunk header ranges: {}",
            header
        )));
    }

    let (old_start, old_lines) = parse_range(ranges[0], '-')?;
    let (new_start, new_lines) = parse_range(ranges[1], '+')?;

    Ok((old_start, old_lines, new_start, new_lines))
}

fn parse_range(s: &str, prefix: char) -> AppResult<(i32, i32)> {
    let s = s.strip_prefix(prefix).ok_or_else(|| {
        AppError::ParseError(format!("Invalid range prefix: {}", s))
    })?;

    if let Some((start_str, lines_str)) = s.split_once(',') {
        let start = start_str.parse::<i32>().map_err(|_| {
            AppError::ParseError(format!("Invalid range start: {}", start_str))
        })?;
        let lines = lines_str.parse::<i32>().map_err(|_| {
            AppError::ParseError(format!("Invalid range lines: {}", lines_str))
        })?;
        Ok((start, lines))
    } else {
        let start = s.parse::<i32>().map_err(|_| {
            AppError::ParseError(format!("Invalid range: {}", s))
        })?;
        Ok((start, 1))
    }
}

/// Check if content appears to be binary.
fn is_binary_content(content: &[u8]) -> bool {
    // Check for NUL bytes in first 8000 bytes
    let check_len = content.len().min(8000);
    content[..check_len].contains(&0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_simple_diff() {
        let diff = r#"diff --git a/test.txt b/test.txt
index 1234567..abcdefg 100644
--- a/test.txt
+++ b/test.txt
@@ -1,3 +1,4 @@
 line 1
 line 2
+new line
 line 3
"#;
        let result = parse_unified_diff(diff.as_bytes(), "test.txt").unwrap();
        assert_eq!(result.old_path, "test.txt");
        assert_eq!(result.new_path, "test.txt");
        assert!(!result.is_binary);
        assert!(!result.is_new);
        assert!(!result.is_deleted);
        assert_eq!(result.hunks.len(), 1);
        assert_eq!(result.additions, 1);
        assert_eq!(result.deletions, 0);

        let hunk = &result.hunks[0];
        assert_eq!(hunk.old_start, 1);
        assert_eq!(hunk.old_lines, 3);
        assert_eq!(hunk.new_start, 1);
        assert_eq!(hunk.new_lines, 4);
        assert_eq!(hunk.lines.len(), 4);
    }

    #[test]
    fn test_parse_new_file_diff() {
        let diff = r#"diff --git a/newfile.txt b/newfile.txt
new file mode 100644
index 0000000..abc1234
--- /dev/null
+++ b/newfile.txt
@@ -0,0 +1,2 @@
+line 1
+line 2
"#;
        let result = parse_unified_diff(diff.as_bytes(), "newfile.txt").unwrap();
        assert!(result.is_new);
        assert_eq!(result.old_path, "/dev/null");
        assert_eq!(result.new_path, "newfile.txt");
        assert_eq!(result.additions, 2);
        assert_eq!(result.deletions, 0);
    }

    #[test]
    fn test_parse_deleted_file_diff() {
        let diff = r#"diff --git a/deleted.txt b/deleted.txt
deleted file mode 100644
index abc1234..0000000
--- a/deleted.txt
+++ /dev/null
@@ -1,2 +0,0 @@
-line 1
-line 2
"#;
        let result = parse_unified_diff(diff.as_bytes(), "deleted.txt").unwrap();
        assert!(result.is_deleted);
        assert_eq!(result.old_path, "deleted.txt");
        assert_eq!(result.new_path, "/dev/null");
        assert_eq!(result.additions, 0);
        assert_eq!(result.deletions, 2);
    }

    #[test]
    fn test_parse_binary_diff() {
        let diff = "Binary files a/image.png and b/image.png differ\n";
        let result = parse_unified_diff(diff.as_bytes(), "image.png").unwrap();
        assert!(result.is_binary);
        assert_eq!(result.hunks.len(), 0);
    }

    #[test]
    fn test_parse_empty_diff() {
        let result = parse_unified_diff(b"", "test.txt").unwrap();
        assert_eq!(result.hunks.len(), 0);
        assert_eq!(result.additions, 0);
        assert_eq!(result.deletions, 0);
    }

    #[test]
    fn test_parse_multiple_hunks() {
        let diff = r#"diff --git a/test.txt b/test.txt
--- a/test.txt
+++ b/test.txt
@@ -1,3 +1,4 @@
 line 1
+inserted
 line 2
 line 3
@@ -10,2 +11,3 @@
 line 10
 line 11
+appended
"#;
        let result = parse_unified_diff(diff.as_bytes(), "test.txt").unwrap();
        assert_eq!(result.hunks.len(), 2);
        assert_eq!(result.additions, 2);
    }

    #[test]
    fn test_hunk_line_numbers() {
        let diff = r#"diff --git a/test.txt b/test.txt
--- a/test.txt
+++ b/test.txt
@@ -2,3 +2,4 @@
 context before
-removed
+added1
+added2
 context after
"#;
        let result = parse_unified_diff(diff.as_bytes(), "test.txt").unwrap();
        let hunk = &result.hunks[0];

        assert_eq!(hunk.old_start, 2);
        assert_eq!(hunk.new_start, 2);

        // First line: context
        assert!(matches!(hunk.lines[0].line_type, DiffLineType::Context));
        assert_eq!(hunk.lines[0].old_line_number, 2);
        assert_eq!(hunk.lines[0].new_line_number, 2);

        // Second line: remove
        assert!(matches!(hunk.lines[1].line_type, DiffLineType::Remove));
        assert_eq!(hunk.lines[1].old_line_number, 3);
        assert_eq!(hunk.lines[1].new_line_number, 0);

        // Third line: add
        assert!(matches!(hunk.lines[2].line_type, DiffLineType::Add));
        assert_eq!(hunk.lines[2].old_line_number, 0);
        assert_eq!(hunk.lines[2].new_line_number, 3);

        // Fourth line: add
        assert!(matches!(hunk.lines[3].line_type, DiffLineType::Add));
        assert_eq!(hunk.lines[3].new_line_number, 4);
    }

    #[test]
    fn test_parse_renamed_diff() {
        let diff = r#"diff --git a/oldname.txt b/newname.txt
similarity index 100%
rename from oldname.txt
rename to newname.txt
"#;
        let result = parse_unified_diff(diff.as_bytes(), "newname.txt").unwrap();
        assert_eq!(result.old_path, "oldname.txt");
        assert_eq!(result.new_path, "newname.txt");
    }
}
