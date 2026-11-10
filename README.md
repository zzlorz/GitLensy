# GitLensy

> 一款轻量、快速、专注的 Windows Git 桌面工具 —— 以「变更文件 + 代码差异」为核心，同时提供够用的提交、分支、同步与贮藏能力。

GitLensy 基于 Tauri 2 构建，直接调用本机 Git CLI，安装包小、启动快；所有数据都在本地处理，不依赖任何云端服务。

[![Tauri](https://img.shields.io/badge/Tauri-2.x-24C8DB?logo=tauri&logoColor=white)](https://tauri.app/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Rust](https://img.shields.io/badge/Rust-stable-000000?logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![Platform](https://img.shields.io/badge/Platform-Windows%2010%2F11-0078D4?logo=windows&logoColor=white)](#环境要求)

## 目录

- [功能特性](#功能特性)
- [界面布局](#界面布局)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [环境要求](#环境要求)
- [快速开始](#快速开始)
- [常用脚本](#常用脚本)
- [测试](#测试)
- [打包](#打包)
- [数据存储与隐私](#数据存储与隐私)
- [架构说明](#架构说明)
- [Git 状态覆盖](#git-状态覆盖)
- [已知限制](#已知限制)
- [后续计划](#后续计划)
- [常见问题](#常见问题)

## 功能特性

### 多仓库工作区

- 左侧项目栏集中管理最近打开的仓库，支持搜索、一键切换、变更数量徽标
- 展开项目即可浏览目录树，支持跨仓库直接打开文件
- 自动恢复上次打开的仓库，最近打开记录保存在本地
- 项目侧边栏与提交列表侧边栏均支持拖拽调整宽度，并自动记忆
- 侧边栏可折叠为图标栏，节省屏幕空间

### 变更管理

- 分开展示「工作区变更 (Unstaged)」与「暂存区变更 (Staged)」
- 文件状态标记：新增、修改、删除、重命名、复制、冲突、未跟踪
- 展示每个文件的新增/删除行数与二进制标记
- 单文件暂存、取消暂存、撤销修改；支持暂存全部、放弃全部工作区修改
- 输入提交信息后直接提交暂存区内容
- 同一文件同时存在暂存/未暂存变化时，可分别查看两种 Diff

### Diff 查看

- 统一（Unified）与左右双栏（Split）两种布局，可随时切换
- Diff 视图支持 highlight.js 语法高亮，主题跟随亮色 / 暗色自动切换
- 双栏行号、新增/删除行配色、Hunk 分隔与代码复制
- 新增文件显示完整内容，删除文件显示删除前内容，重命名文件展示新旧路径
- 二进制文件友好提示，空状态与错误状态完善
- 请求 ID 防竞态：快速切换文件时不会显示过期结果
- 「所有变更文件」连续对比视图，按文件顺序从上到下滚动查看

### 文件预览

- 内置文件目录树，自动忽略 `.git`、`node_modules`、`dist`、`target` 等目录
- 基于 highlight.js 的语法高亮，覆盖 JS/TS、Python、Rust、Go、Java、C/C++、C#、PHP、Ruby、Swift、Kotlin、HTML/CSS、JSON/YAML、Shell、SQL、Markdown 等常见语言
- 图片预览、文本文件大小限制、二进制文件识别
- 预览已变更文件时标出变更行，并可查看对应修改块
- 变更文件 Diff 头部提供「打开方式」：VS Code / 资源管理器 / 系统默认应用；文件预览可一键在外部编辑器中打开

### 提交历史

- 分页加载提交记录（滚动到底部自动加载更多）
- 内置 Git 拓扑图，展示分支、合并与提交车道
- 按提交信息、作者、哈希实时过滤
- 查看提交详情：作者、时间、哈希、正文、Merge 标记
- 查看该次提交的变更文件列表，并逐个查看文件 Diff
- 提交间对比：选择基准提交后再点击另一条提交，连续查看两者之间的全部差异
- 支持 Amend 修正上一次提交；支持撤销上一次提交（soft reset，内容保留在暂存区）
- 支持把指定提交 Cherry-pick 到当前分支
- 根提交与合并提交均能正确对比（以第一个父提交为基准）

### 分支、同步、冲突与贮藏

- 工具栏展示当前分支，支持本地/远程分支切换；远程分支会自动创建同名本地分支并跟踪
- 支持新建分支（创建后立即切换）、删除分支、重命名分支
- 支持把指定分支合并到当前分支，或把当前分支 rebase 到指定分支
- 合并冲突可视化解决：逐块选择保留当前 / 传入 / 两者都保留 / 全部删除，保存后自动 `git add` 并跳到下一个冲突文件
- 支持新建轻量标签
- 拉取（`pull --ff-only`）、推送、获取远程更新（`fetch --all --prune`）
- 展示本地与上游的领先/落后提交数；暂存区无变更且本地领先时，提交按钮自动切换为 **Sync Changes**
- 贮藏当前变更（包含未跟踪文件），支持查看列表、应用、恢复（pop）、删除单条与清空全部

### 外观与外部工具

- 暗色 / 亮色 / 跟随系统三种主题，原生窗口标题栏同步切换
- 无边框窗口 + 自定义窗口控制按钮与八向缩放手柄
- 一键在仓库根目录打开 PowerShell
- 外部编辑器命令可配置（默认 `code`，也支持 `cursor`、`subl`、`idea` 等）
- 基于 `notify` 的文件系统监听：外部工具修改文件后自动刷新变更、Diff、历史与目录树
- 窗口重新获得焦点时自动刷新，作为文件监听不可用时的兜底

## 界面布局

```
┌──────────────┬──────────────────┬─────────────────────────────────────┐
│  项目侧边栏   │  变更 / 历史列表   │            Diff / 文件预览           │
│              │                  │                                     │
│  搜索项目     │  提交信息 + 提交   │  统一 / 双栏 Diff                    │
│  项目 A  ●3  │  工作区变更       │  行号、增删配色、Hunk 分隔            │
│  项目 B  ●1  │  暂存区变更       │  打开方式 / 复制 / 二进制提示         │
│  项目 C      │  或提交历史       │  或带语法高亮的文件预览               │
└──────────────┴──────────────────┴─────────────────────────────────────┘
```

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 桌面框架 | Tauri 2 |
| 后端 | Rust（stable） |
| 前端 | React 18 + TypeScript 5 |
| 构建工具 | Vite 5 |
| 包管理器 | pnpm |
| 代码高亮 | highlight.js |
| 文件监听 | notify（Rust） |
| 图标 | lucide-react |
| Git 操作 | 通过 Rust `std::process::Command` 调用本机 Git CLI |

## 项目结构

```text
gitrees/
├── public/
│   ├── app-icon.png              # 应用图标
│   └── favicon.png               # 网页图标
├── src/                          # 前端 React 源码
│   ├── api/
│   │   └── tauri.ts              # Tauri command 封装、localStorage 读写
│   ├── components/
│   │   ├── AllChangesView.tsx    # 所有变更文件连续对比
│   │   ├── CommitChangesView.tsx # 单次提交 / 提交间对比的连续 Diff
│   │   ├── CommitDetail.tsx      # 提交详情与变更文件列表
│   │   ├── CommitList.tsx        # 提交历史列表 + 拓扑图 + 对比基准选择
│   │   ├── ConfirmDialog.tsx     # 通用确认对话框
│   │   ├── ConflictResolver.tsx  # 合并冲突可视化解决
│   │   ├── DiffViewer.tsx        # 统一 / 双栏 Diff 渲染 + 语法高亮
│   │   ├── FileList.tsx          # 工作区 / 暂存区文件列表
│   │   ├── FilePreview.tsx       # 文件内容 / 图片预览 + 语法高亮
│   │   ├── FolderTree.tsx        # 仓库目录树
│   │   ├── ProjectSidebar.tsx    # 多仓库项目侧边栏
│   │   ├── RepoAvatar.tsx        # 项目头像
│   │   ├── SettingsModal.tsx     # 设置弹窗（主题、外部编辑器）
│   │   ├── SidebarResizeHandle.tsx # 侧边栏拖拽调宽手柄
│   │   └── WindowControls.tsx    # 无边框窗口控制与缩放手柄
│   ├── lib/
│   │   └── highlight.ts          # 共享 highlight.js 语言注册与主题
│   ├── pages/
│   │   ├── WelcomePage.tsx       # 欢迎页 / 最近仓库
│   │   └── MainWorkspace.tsx     # 主工作区与所有交互编排
│   ├── App.tsx                   # 根组件、主题与仓库恢复
│   ├── main.tsx                  # 前端入口
│   ├── types.ts                  # 共享 TypeScript 类型
│   ├── styles.css                # 全局样式与主题变量
│   └── vite-env.d.ts             # Vite 类型声明
├── src-tauri/                    # Rust 后端
│   ├── src/
│   │   ├── main.rs               # 二进制入口
│   │   ├── lib.rs                # Tauri Builder、插件与 command 注册
│   │   ├── commands.rs           # 所有 Tauri Commands
│   │   ├── git.rs                # Git CLI 调用封装
│   │   ├── repository.rs         # 仓库检测与基础信息
│   │   ├── status.rs             # git status 解析（含单元测试）
│   │   ├── diff.rs               # diff 解析（含单元测试）
│   │   ├── history.rs            # git log / 提交文件 / 提交 Diff / 提交间对比（含测试）
│   │   ├── watcher.rs            # notify 文件系统监听与事件去抖
│   │   ├── models.rs             # 前后端共享数据结构
│   │   └── error.rs              # 统一错误类型
│   ├── capabilities/
│   │   └── default.json          # Tauri 权限配置
│   ├── icons/                    # 已生成的各平台图标
│   ├── Cargo.toml                # Rust 依赖
│   ├── tauri.conf.json           # 窗口、打包与图标配置
│   └── build.rs                  # Tauri 构建脚本
├── index.html                    # Vite 入口 HTML（含主题预加载）
├── package.json                  # 前端依赖与脚本
├── tsconfig.json                 # TypeScript 配置
├── vite.config.ts                # Vite 配置
└── pnpm-lock.yaml                # 依赖锁定文件
```

## 环境要求

- **Windows 10/11**
- **Node.js** >= 18（推荐 20 LTS）
- **pnpm** >= 8
- **Rust** stable（通过 [rustup](https://rustup.rs/) 安装）
- **Git** 已安装并加入 `PATH`（应用不自带 Git）
- **WebView2**（Windows 11 已预装；Windows 10 可通过 Evergreen Runtime 安装）
- **Microsoft C++ Build Tools**（Tauri 在 Windows 上编译 Rust 所需）

Tauri 的完整环境说明见官方文档：[Prerequisites](https://tauri.app/start/prerequisites/)。

## 快速开始

克隆仓库并安装前端依赖：

```bash
git clone git@github.com:zzlorz/GitLensy.git
cd GitLensy
pnpm install
```

首次编译 Rust 依赖会比较慢，可以先检查后端是否能通过编译：

```bash
cd src-tauri
cargo check
```

启动开发模式（同时启动 Vite 开发服务器与 Tauri 窗口）：

```bash
pnpm tauri dev
```

> 仅运行 `pnpm dev` 只会启动浏览器中的前端页面，无法调用 Tauri Commands，必须使用 `pnpm tauri dev` 才能完整体验。

## 常用脚本

| 命令 | 说明 |
| --- | --- |
| `pnpm tauri dev` | 启动开发模式（推荐） |
| `pnpm tauri build` | 打包生产版本 |
| `pnpm dev` | 仅启动前端 Vite 开发服务器 |
| `pnpm build` | TypeScript 类型检查 + 前端生产构建 |
| `pnpm preview` | 预览前端构建产物 |
| `pnpm exec tsc --noEmit` | 仅做前端类型检查 |
| `cd src-tauri && cargo check` | 检查 Rust 后端编译 |
| `cd src-tauri && cargo test` | 运行 Rust 测试 |

## 测试

### Rust 测试

```bash
cd src-tauri
cargo test
```

覆盖范围：

- **状态解析**：普通修改、新增、删除、重命名、复制、暂存/未暂存混合、冲突、未跟踪、中文路径、空格路径、空状态
- **numstat 解析**：正常、空输出、二进制文件
- **Diff 解析**：简单差异、新增/删除文件、二进制、多 Hunk、行号、重命名
- **提交历史**：`git log` 输出解析、根提交、合并提交、文件列表、文件 Diff、非法哈希校验
- **真实仓库测试**：在临时 Git 仓库中验证 `git log` / `git diff` / 提交间对比的完整调用链路（本机未安装 Git 时会跳过）
- **文件监听**：忽略目录判定（`.git`、`node_modules`、`target`、`dist` 等）与仓库根目录名称冲突场景

### 前端检查

```bash
pnpm exec tsc --noEmit
```

或直接构建，构建脚本会先执行类型检查：

```bash
pnpm build
```

## 打包

```bash
pnpm tauri build
```

产物位于：

```text
src-tauri/target/release/bundle/msi/
```

如需重新生成应用图标，替换 `src-tauri/icons/icon-source.png` 后运行：

```bash
pnpm tauri icon src-tauri/icons/icon-source.png
```

## 数据存储与隐私

GitLensy 不包含遥测，也不会主动上传任何数据。以下偏好仅保存在本机 `localStorage`：

| Key | 内容 |
| --- | --- |
| `gitlensy:recentRepos` | 最近打开的仓库列表（最多 10 个） |
| `gitlensy:currentRepo` | 当前仓库信息，用于启动时恢复 |
| `gitlensy:theme` | 主题模式 |
| `gitlensy:editor` | 外部编辑器命令 |
| `gitlensy:diffLayout` | Diff 布局偏好 |
| `gitlensy:projectSidebarWidth` | 项目侧边栏宽度 |
| `gitlensy:commitSidebarWidth` | 提交列表侧边栏宽度 |

所有 Git 操作均通过本机 Git CLI 在对应仓库中执行；只有用户主动点击拉取、推送、获取或同步时才会访问远程仓库。

## 架构说明

- **前后端职责分离**：React 负责界面与交互状态，Rust 负责仓库检测、Git 调用与输出解析
- **命令式通信**：前端通过 `src/api/tauri.ts` 统一调用 Tauri Commands，避免组件直接散落 `invoke`
- **安全的命令构造**：Git 参数以数组传递，不经过 Shell 拼接，路径中的空格、中文与特殊字符不会被解释
- **机器可读解析**：使用 `git status --porcelain=v1 -z`、`--name-status -z`、`--numstat -z` 等 NUL 分隔格式，正确处理中文与空格路径
- **稳定分隔符**：`git log` 使用不可见控制字符分隔字段，避免提交正文中的分隔符干扰解析
- **竞态防护**：文件 Diff 与提交 Diff 均使用递增请求 ID，只接受最新请求的结果
- **缓存策略**：当前仓库的 Diff / 提交 Diff 按 Key 缓存，刷新状态或切换仓库时主动失效
- **统一错误处理**：Rust 侧使用 `thiserror` 定义 `AppError`，前端以消息形式展示
- **实时刷新**：Rust 侧通过 `notify` 递归监听仓库，320ms 去抖后向前端发送 `repo-changed` 事件；前端节流刷新变更状态、Diff、历史与目录树，并忽略 `.git`、`node_modules`、`target`、`dist` 等目录
- **兜底刷新**：窗口重新获得焦点时合并触发一次自动刷新（1.2 秒内去重）；拉取、推送、提交、切换分支等操作完成后也会主动刷新相关数据

## Git 状态覆盖

- 普通修改文件
- 新增文件（未暂存 / 已暂存）
- 删除文件
- 重命名与复制文件
- 同一文件同时存在暂存与未暂存变化
- 合并冲突
- 未跟踪文件
- 忽略文件（自动跳过）
- 中文路径与空格路径（NUL 分隔解析）
- 空仓库 / 无变更状态
- Detached HEAD
- 二进制文件检测
- Worktree 仓库
- 根提交与合并提交（历史视图）

## 已知限制

1. **平台**：目前主要针对 Windows 10/11 开发与验证；其他平台可编译，但终端、资源管理器等能力未做完整适配。
2. **依赖本机 Git**：需要用户自行安装 Git 并加入 `PATH`。
3. **推送策略**：仅支持普通推送，暂未提供 force push / 强制覆盖远程。
4. **Rebase / Cherry-pick 冲突后续操作**：冲突文件可在应用内可视化解决，但 rebase 冲突全部解决后仍需在终端执行 `git rebase --continue` 或 `git rebase --abort`。
5. **大文件限制**：文本预览上限 512 KB，图片预览上限 10 MB，超出时会提示。
6. **未跟踪文件行数**：通过直接读取文件计算，可能与 Git 的统计存在细微差异。
7. **暂无自动更新**：需要手动下载并安装新版本。

## 后续计划

### 已完成

- [x] 使用 `notify` 实现文件系统监听与自动刷新
- [x] Diff 视图语法高亮
- [x] 合并冲突可视化解决
- [x] 更多分支操作：删除、重命名、rebase、cherry-pick、merge
- [x] 提交增强：amend、撤销提交、查看提交间对比
- [x] 项目侧边栏 / 提交列表侧边栏拖拽调整宽度

### 待实现

- [ ] 文件列表多选与批量暂存/撤销
- [ ] 全局快捷键与命令面板
- [ ] Rebase / Cherry-pick 冲突后的「继续 / 中止」操作入口
- [ ] 支持 Git LFS 与 Submodule 状态展示
- [ ] 应用自动更新与安装包签名

## 常见问题

**Q：`pnpm tauri dev` 提示找不到 Git？**

A：确认 `git --version` 能在终端中正常运行；如果是刚安装 Git，请重新打开终端或重启 IDE，让新的 `PATH` 生效。

**Q：点击「VS Code」或「终端」没有反应？**

A：确认 `code` / `powershell` 已在 `PATH` 中。外部编辑器命令可在「设置 → 外部编辑器」中修改为 `cursor`、`subl`、`idea` 等。

**Q：切换分支失败怎么办？**

A：工作区存在未提交修改、冲突或未跟踪文件覆盖时，`git checkout` 可能被拒绝。请先提交、贮藏或放弃相关修改后重试，错误信息会显示在工作区顶部。

**Q：推送按钮是灰的？**

A：当前分支没有关联上游远程，或没有待推送的本地提交。可以先执行一次「获取」；若分支尚未关联远程，请在终端中执行 `git push -u origin <branch>`。

**Q：为什么外部工具改了文件，列表没有立刻变？**

A：GitLensy 使用 `notify` 监听仓库文件，外部编辑器保存后通常会在几百毫秒内自动刷新。若仍未更新，切回 GitLensy 窗口会触发兜底刷新，也可以执行一次「获取」，或重新打开仓库。

**Q：打包时图标不对？**

A：替换 `src-tauri/icons/icon-source.png` 后运行 `pnpm tauri icon src-tauri/icons/icon-source.png`，再执行 `pnpm tauri build`。

---

如果这个项目对你有帮助，欢迎 Star ⭐ 或提交 Issue / PR。
