use std::path::Path;

use crate::error::{AppError, AppResult};
use crate::git::{get_current_branch, get_repo_root, is_git_repo};
use crate::models::RepositoryInfo;

/// Validate that a path is a valid Git repository and return its info.
pub fn open_repository(path: &str) -> AppResult<RepositoryInfo> {
    let path = Path::new(path);

    if !path.exists() {
        return Err(AppError::InvalidRepository(format!(
            "Path does not exist: {}",
            path.display()
        )));
    }

    if !path.is_dir() {
        return Err(AppError::InvalidRepository(format!(
            "Path is not a directory: {}",
            path.display()
        )));
    }

    if !is_git_repo(path) {
        return Err(AppError::InvalidRepository(format!(
            "Not a valid Git repository: {}",
            path.display()
        )));
    }

    let root = get_repo_root(path)?;
    let (branch, is_detached) = get_current_branch(path)?;
    let name = Path::new(&root)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    Ok(RepositoryInfo {
        path: root,
        name,
        branch,
        is_detached,
    })
}

#[cfg(test)]
#[cfg(feature = "integration-tests")]
mod tests {
    use super::*;
    use std::process::Command;
    use tempfile::TempDir;

    fn create_test_repo() -> TempDir {
        let dir = TempDir::new().unwrap();
        Command::new("git")
            .args(["init"])
            .current_dir(dir.path())
            .output()
            .unwrap();
        // Configure git user for commits
        Command::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(dir.path())
            .output()
            .unwrap();
        Command::new("git")
            .args(["config", "user.name", "Test User"])
            .current_dir(dir.path())
            .output()
            .unwrap();
        dir
    }

    #[test]
    fn test_open_valid_repo() {
        let dir = create_test_repo();
        let result = open_repository(dir.path().to_str().unwrap());
        assert!(result.is_ok());
        let info = result.unwrap();
        assert_eq!(info.name, dir.path().file_name().unwrap().to_str().unwrap());
    }

    #[test]
    fn test_open_nonexistent_path() {
        let result = open_repository("/nonexistent/path/12345");
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::InvalidRepository(_) => {}
            _ => panic!("Expected InvalidRepository error"),
        }
    }

    #[test]
    fn test_open_non_git_directory() {
        let dir = TempDir::new().unwrap();
        let result = open_repository(dir.path().to_str().unwrap());
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::InvalidRepository(_) => {}
            _ => panic!("Expected InvalidRepository error"),
        }
    }
}
