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
mod watcher;

use std::sync::Mutex;

pub use error::AppError;
pub use models::*;

struct AppState {
    repo_path: Mutex<Option<String>>,
    /// 仓库文件监听器；打开新仓库时替换，关闭仓库时 drop 停止监听。
    watcher: Mutex<Option<notify::RecommendedWatcher>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState {
            repo_path: Mutex::new(None),
            watcher: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_repository,
            commands::close_repository,
            commands::get_status,
            commands::get_repo_change_count,
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
            commands::get_sync_status,
            commands::sync_changes,
            commands::pull_changes,
            commands::fetch_changes,
            commands::push_changes,
            commands::create_branch,
            commands::create_tag,
            commands::stash_changes,
            commands::get_stash_list,
            commands::pop_stash,
            commands::apply_stash,
            commands::drop_stash,
            commands::clear_stashes,
            commands::open_in_editor,
            commands::open_with_method,
            commands::get_branches,
            commands::checkout_branch,
            commands::get_conflict_file,
            commands::resolve_conflict,
            commands::mark_conflict_resolved,
            commands::delete_branch,
            commands::rename_branch,
            commands::merge_branch,
            commands::rebase_branch,
            commands::cherry_pick_commit,
            commands::amend_commit,
            commands::undo_last_commit,
            commands::get_compare_files,
            commands::get_compare_file_diff,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application")
}
