# GitLensy - 轻量 Git 桌面工具

一款运行在 Windows 桌面端的轻量级 Git 可视化工具，以查看 Git 变化文件和代码差异为核心。

## 技术栈

- **桌面框架**: Tauri 2
- **后端**: Rust
- **前端**: React 18 + TypeScript
- **构建工具**: Vite
- **包管理器**: pnpm
- **Git 操作**: 通过 Rust `std::process::Command` 调用本机 Git CLI

## 项目结构

```
gitlensy/
├── src/                          # 前端 React 源代码
│   ├── api/tauri.ts              # Tauri API 封装
│   ├── components/               # UI 组件
│   │   ├── FileList.tsx          # 文件变化列表
│   │   └── DiffViewer.tsx        # 差异查看器
│   ├── pages/                    # 页面组件
│   │   ├── WelcomePage.tsx       # 欢迎页/仓库选择
│   │   └── MainWorkspace.tsx     # 主工作区
│   ├── types.ts                  # TypeScript 类型定义
│   ├── styles.css                # 全局样式
│   ├── App.tsx                   # 根组件
│   └── main.tsx                  # 入口文件
├── src-tauri/                    # Rust 后端
│   ├── src/
│   │   ├── main.rs               # 二进制入口
│   │   ├── lib.rs                # 库入口 / Tauri 构建
│   │   ├── commands.rs           # Tauri Commands
│   │   ├── error.rs              # 统一错误类型
│   │   ├── models.rs             # 共享数据结构
│   │   ├── git.rs                # Git 命令封装
│   │   ├── repository.rs         # 仓库检测与信息
│   │   ├── status.rs             # 状态解析（含单元测试）
│   │   └── diff.rs               # Diff 解析（含单元测试）
│   ├── capabilities/             # Tauri 权限配置
│   ├── Cargo.toml                # Rust 依赖
│   ├── tauri.conf.json           # Tauri 配置
│   └── build.rs                  # Tauri 构建脚本
├── index.html                    # Vite 入口 HTML
├── package.json                  # npm 依赖
├── tsconfig.json                 # TypeScript 配置
└── vite.config.ts                # Vite 配置
```

## 环境要求

- Node.js >= 18
- Rust (stable)
- pnpm
- Git (本机已安装)
- Windows 10/11
- WebView2 (Windows 11 已预装)

## 安装依赖

### 1. 前端依赖

```bash
pnpm install
```

### 2. Rust 依赖

Rust 依赖会在首次构建时自动下载。

```bash
cd src-tauri
cargo check
```

## 开发模式运行

```bash
pnpm tauri dev
```

这会同时启动 Vite 开发服务器和 Tauri 开发窗口。

## 运行测试

### Rust 单元测试

```bash
cd src-tauri
cargo test
```

测试覆盖：
- 状态解析：普通修改、新增、删除、重命名、同时暂存/未暂存、冲突、未跟踪、中文路径、空格路径、空状态
- numstat 解析：正常、空、二进制文件
- Diff 解析：简单差异、新增文件、删除文件、二进制、多 hunk、行号、重命名
- 仓库检测：有效仓库、不存在路径、非 Git 目录

### 前端类型检查

```bash
pnpm tsc
```

### 前端构建

```bash
pnpm build
```

## 打包生产版本

```bash
pnpm tauri build
```

打包产物位于 `src-tauri/target/release/bundle/`。

## 第一阶段功能

### 已实现

1. **打开 Git 仓库**
   - 原生目录选择对话框
   - 验证 Git 仓库有效性
   - 获取仓库根目录和当前分支
   - 支持 worktree
   - 最近打开仓库记录（localStorage）
   - 错误提示

2. **查看变化文件**
   - 未暂存更改区域
   - 已暂存更改区域
   - 文件状态标记（新增/修改/删除/重命名/冲突/未跟踪）
   - 新增/删除行数统计
   - 文件列表可折叠/展开
   - 按路径排序
   - 当前分支显示
   - 刷新按钮
   - 加载状态

3. **查看代码差异 (Diff)**
   - 统一 Diff 视图
   - 新增行绿色、删除行红色
   - 双栏行号显示
   - 区分暂存区和工作区 Diff
   - 同一文件两类变化时可切换查看
   - 新增文件显示全部内容
   - 删除文件显示删除前内容
   - 重命名文件路径展示
   - 二进制文件友好提示
   - 空状态和错误状态
   - 防请求竞态（请求 ID 对比）

### Git 状态处理

- 普通修改文件
- 新增文件（未暂存/已暂存）
- 删除文件
- 重命名文件
- 同一文件同时有暂存和未暂存变化
- 合并冲突
- 未跟踪文件
- 忽略文件（自动跳过）
- 中文路径和空格路径（NUL 分隔解析）
- 空仓库/无变化状态
- Detached HEAD
- 二进制文件检测

### 架构特点

- 前后端职责清晰分离
- Rust 模块独立（git / repository / status / diff / commands / models / error）
- Git 命令使用参数数组，不通过 Shell 拼接
- 使用 `git status --porcelain=v1 -z` 机器可读格式
- 核心解析逻辑有单元测试
- TypeScript 严格类型检查
- 统一错误处理

## 已知问题和限制

1. **图标未生成**：`src-tauri/icons/` 目录下暂无图标文件，首次打包前需运行 `pnpm tauri icon` 生成
2. **语法高亮**：当前 Diff 视图未集成语法高亮，可后续引入 `react-diff-viewer` 或 `monaco-editor` 等库
3. **并排 Diff**：当前仅支持统一 Diff 视图，并排模式可后续扩展
4. **文件系统监听**：当前仅支持手动刷新，自动监听可后续加入 `notify` crate
5. **行数统计精度**：未跟踪文件的行数通过直接读取文件计算，可能与 git 统计有细微差异

## 下一阶段推荐功能

1. 暂存/取消暂存文件（git add / git reset）
2. 提交更改（git commit）
3. 文件系统自动监听刷新
4. Diff 语法高亮
5. 并排 Diff 视图
6. 搜索过滤文件列表
7. 分支管理（切换、新建、删除）
8. 远程仓库操作（fetch/pull/push）
