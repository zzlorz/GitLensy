// 正式包（release）使用 Windows GUI 子系统，不弹 PowerShell 控制台窗口；
// 开发模式（debug）保留控制台以便查看日志。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    gitlensy_lib::run();
}
