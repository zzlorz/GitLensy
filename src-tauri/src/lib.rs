#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![allow(dependency_on_unit_never_type_fallback)]

mod error;
mod models;
mod git;
mod repository;
mod status;
mod diff;
mod history;
mod commands;

use std::sync::Mutex;

pub use error::AppError;
pub use models::*;

struct AppState {
    repo_path: Mutex<Option<String>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState {
            repo_path: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_repository,
            commands::close_repository,
            commands::get_status,
            commands::get_file_diff,
            commands::get_commit_log,
            commands::get_commit_files,
            commands::get_commit_file_diff,
            commands::open_terminal,
            commands::set_window_theme,
            commands::revert_file,
            commands::stage_file,
            commands::stage_all,
            commands::discard_all_unstaged,
            commands::commit_changes,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application")
}
