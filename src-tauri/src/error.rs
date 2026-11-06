use serde::Serialize;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("Git command failed: {0}")]
    GitCommand(String),

    #[error("Invalid git repository: {0}")]
    InvalidRepository(String),

    #[error("No repository open")]
    NoRepository,

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Path not found: {0}")]
    PathNotFound(String),

    #[error("Parse error: {0}")]
    ParseError(String),

    #[error("Encoding error: {0}")]
    Encoding(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
