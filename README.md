# dsh-ssh-file-manager

> 给 [DeepSeek Harness](https://github.com/deepseek-ai)（Web GUI）加一个 **「SSH 远程文件」** 面板：不用开终端，也能浏览、预览和管理远程服务器上的文件。

配合 [`dsh-ssh-toolkit`](https://github.com/MaiwulanjiangMaiming/Deepseek-harness-SSH-toolkit) 使用。本插件复用它的 SSH 连接池、主机配置与主机指纹信任（TOFU），**不复制、不保存任何凭据**。

```text
侧栏「SSH 远程文件」→ 选工作区/主机 → 浏览目录 → 预览 / 复制 / 移动 / 重命名 / 删除 / 上传 / 下载
```

## 功能

| 分类 | 能力 |
|---|---|
| **来源** | 顶部下拉列出所有远程工作区（来自你的 SSH 会话）和所有已配置的 SSH 主机（从 `$HOME` 开始浏览） |
| **浏览** | 目录树按需展开、目录优先 + 自然排序、可编辑路径栏（输入绝对路径回车跳转）、`↑` 上级、刷新 |
| **预览** | 文本（前 1.5 MB，等宽、保留换行）、图片（PNG/JPEG/GIF/WebP/SVG/BMP/ICO/AVIF）、PDF（浏览器内置查看器）；二进制与目录显示大小/修改时间 |
| **多选** | 单击选中、`Cmd/Ctrl` 反选、`Shift` 连选；右键作用于整个选中集合 |
| **文件操作** | 复制 / 剪切 / 粘贴（服务端 `cp -a` / `mv`）、重命名、删除（`rm -rf`，二次确认）、新建文件夹、新建文件 |
| **上传** | 顶部按钮选择文件，或**把文件从 Finder 拖进树**（拖到哪个目录行就传到哪个目录）；同名文件询问是否覆盖，本批次记住选择；逐文件百分比进度 |
| **下载** | 单文件原样流式下载；多选或文件夹在服务端打包为 `tar.gz` 后流式下载；下载前先校验存在性，避免把错误页当文件 |
| **右键菜单** | 文件：下载、复制、剪切、重命名、复制路径、删除；目录：展开/收起、下载（tar.gz）、粘贴到此处、新建、重命名、删除；空白处：新建、粘贴、刷新 |
| **反馈** | 底栏常驻 `aria-live` 状态：进度、成功 6 秒后自动消失，失败保留；删除/覆盖等破坏性操作都有确认框 |
| **外观** | 跟随 DSH 主题令牌（明/暗色自动适配）；窄窗口（≤760px）自动改为上下布局 |

### 快捷键（焦点在目录树时）

| 按键 | 作用 |
|---|---|
| `↑` `↓` / `Home` `End` | 移动选中项 |
| `→` / `←` | 展开 / 收起选中的目录 |
| `Enter` | 打开目录或预览文件 |
| `Cmd/Ctrl + C` / `X` / `V` | 复制 / 剪切 / 粘贴 |
| `F2` | 重命名 |
| `Delete` | 删除（确认后） |
| `Shift + F10` 或菜单键 | 打开选中项的右键菜单 |
| `Esc` | 关闭菜单 / 清空选择 |

## 前置条件

- DeepSeek Harness 桌面版（Web GUI），已在 macOS 上验证。
- 已安装 `dsh-ssh-toolkit`，并至少配置了一台 SSH 主机（**设置 → SSH 连接**）。
- 远端为 Linux 或 macOS（需要 `sshd`；目录下载另外需要 `tar`）。
- 首次连接的主机指纹需先在 **设置 → SSH 连接** 中确认。

## 安装

仓库：<https://github.com/zl2860/dsh-ssh-file-manager>

```bash
# 从 GitHub 安装（推荐；可加 #v0.1.0 固定版本）
dsh plugin --profile desktop add github:zl2860/dsh-ssh-file-manager

# 或本地目录（开发时）
dsh plugin --profile desktop add /path/to/ssh-file-manager
```

也可以在 **设置 → 插件 → 添加插件** 中选择本目录。

安装后**刷新页面**：侧栏出现「SSH 远程文件」图标。Host 路由随插件加载，客户端 bundle 在页面加载时载入。本插件没有构建步骤，不需要 `pnpm run build`。

## 使用

1. 点侧栏 **SSH 远程文件** 图标。
2. 顶部选来源：
   - **工作区 · 名称** —— 直接定位到某个远程工作区目录（来自你已有的 SSH 会话）；
   - **主机 · 名称** —— 从远端登录用户的 `$HOME` 开始，可浏览整台机器。
3. 左侧点目录展开、点文件预览；路径栏可直接输入绝对路径跳转。
4. 右键或用底栏按钮操作；从 Finder 拖文件进树即上传。
5. 目标目录规则：选中单个目录时操作作用于该目录；否则作用于最后一个选中项的父目录；没有选择时为当前根目录。

## 工作原理

```text
浏览器（client.js）                     Host（index.js）                 SSH 主机
侧栏图标 + 主面板  ── fetch ──▶  /x-ssh-files/* 路由  ── ctx.sshPool ──▶  SFTP / exec
   React，主题令牌               只读/写协议、路径校验           cp / mv / rm / mkdir / cat / tar
```

- Host 半边注册 15 条精确路由，通过 `dsh-ssh-toolkit` 的 `ctx.sshPool` 连接主机；`conn.fs()` 在有 SFTP 时走 SFTP，否则回退到 `exec` + base64。
- 需要递归或流式的地方（复制、移动、删除、打 `tar.gz`、下载）改走远端 POSIX 命令，参数统一单引号转义，并拒绝 `..` / NUL / 相对路径。
- 客户端是自包含的浏览器模块（`window.__ModuleLoader__.load`），只 `require('react')`，不引用任何 Harness 客户端包；样式全部使用 `--dsw-alias-*` / `--dsw-radius-*` / `--dsw-shadow-*` 主题令牌。
- 插件在 `sidebar.panellist` 注册入口，在 `main` 注册面板；文字走 `ctx.locale`（中文 + English）。

### HTTP 路由

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/x-ssh-files/ping` | 健康检查 + 版本 |
| GET | `/x-ssh-files/sources` | 已配置主机 + 远程工作区（解码占位目录） |
| GET | `/x-ssh-files/home?hostId=` | 远端 `$HOME` |
| GET | `/x-ssh-files/list?hostId=&path=` | 列目录（目录优先，上限 5000 项，超出标记 truncated） |
| GET | `/x-ssh-files/stat?hostId=&path=` | 元数据（不存在返回 404） |
| GET | `/x-ssh-files/text?hostId=&path=` | 文本预览（≤1.5 MB，检测二进制） |
| GET | `/x-ssh-files/raw?hostId=&path=` | 图片 / PDF 字节，支持有界 `Range`（≤8 MiB） |
| GET | `/x-ssh-files/download?hostId=&dir=&name=` | 单文件流式下载；文件夹/多选返回 `tar.gz` |
| POST | `/x-ssh-files/mkdir` \| `newfile` \| `rename` \| `remove` \| `copy` \| `move` | 目录与文件操作（JSON） |
| POST | `/x-ssh-files/upload?hostId=&dir=&name=&overwrite=` | 原始字节上传（≤256 MiB，原子写入） |

统一返回 `{ ok: true, value }` 或 `{ ok: false, code, message }`；`copy`/`move`/`remove` 逐项返回 `done` / `failed`。

## 安全与边界

- 面板只操作 `dsh-ssh-toolkit` 已配置的主机；认证方式（密钥 / agent / 口令）完全由该插件持有，本插件不读取口令字段，也不落盘任何凭据。
- 路由位于 `/api` 之外，因此**自行校验同源**：`Sec-Fetch-Site: cross-site`，或 `Origin` 与请求 `Host` 不一致时直接 403，且在校验通过前不触碰 SSH。
- 主机指纹未信任时返回可操作的错误（提示到 设置 → SSH 连接 里确认指纹），不会静默失败。
- 路径参数必须是绝对 POSIX 路径且不含 NUL；远端命令参数单引号转义；拒绝删除 `/`。
- 上传在 Host 内存中缓冲（上限 256 MiB）后原子写入；文本预览上限 1.5 MB；`/raw` 单次 Range 上限 8 MiB，更大的请求回退为整文件流。

### 已知限制

- 不支持拖出浏览器到 Finder（浏览器安全限制），请用「下载」。
- 不支持 Windows 远端；跨主机复制不支持（可在主机内复制）。
- 粘贴不做自动覆盖：目标已存在同名项时会失败并提示，需要先重命名或换目录。
- 上传只有逐文件进度，没有整批进度条与取消按钮。
- 符号链接按普通条目显示，指向目录时会预览失败并给出错误。
- 目录列表上限 5000 项（超出时末尾提示）。

## 排错

| 现象 | 原因 / 解决 |
|---|---|
| 侧栏没有「SSH 远程文件」图标 | 客户端 bundle 只在页面加载时载入 —— **刷新页面**；仍无则确认插件在 设置 → 插件 中已启用 |
| 打开面板提示没有来源 | 还没有配置 SSH 主机：**设置 → SSH 连接** 添加或导入 `~/.ssh/config` |
| 报 `主机指纹未信任` | 到 **设置 → SSH 连接** 对该主机「测试连接」并确认指纹，然后重试 |
| 报 `unknown-host` | Profile 里的工作区指向的主机已被删除；重新建工作区或恢复主机 |
| 连接失败（502） | 检查主机/端口/用户与网络；macOS 桌面版从 Finder 启动时可能没有 `SSH_AUTH_SOCK`，请改用显式私钥路径 |
| 上传同名文件被拒绝 | 确认框选「覆盖」，或先重命名 |
| 目录下载报错 | 远端缺少 `tar`，或目录内文件权限不足 |

## 开发与测试

```bash
node --test test/*.test.mjs        # 14 项：Host 路由 10 + 客户端注册/渲染 4
```

测试不接触真实 SSH：`test/routes.test.mjs` 用本地临时目录和一个「假连接」（命令在本机执行）跑通全部路由，包括 `tar.gz`、Range、0 字节上传、冲突、跨站拒绝；`test/client.test.mjs` 按 `window.__ModuleLoader__` 的加载方式验证槽位注册、中英文案键一致性与一次无浏览器渲染。

```text
index.js            Host 入口：注册 /x-ssh-files/* 路由
lib/remote.js       SFTP/exec 原语：列目录、读文本、复制/移动/删除/新建、错误映射
lib/router.js       远程工作区占位目录 → 主机 + 远程路径的解码（与 toolkit 同规则）
client.js           浏览器端：侧栏图标 + 主面板（React，零 Harness 包依赖）
cordis.patch.yml    插入 Host 插件行
locale/             插件标题与描述（zh / en）
icon.svg            插件列表图标（侧栏图标跟随主题色，不使用它）
test/               自动化测试
```

## 版本兼容

| | |
|---|---|
| 已测试 | DeepSeek Harness 0.2.2-rc.3（macOS 桌面版）、`dsh-ssh-toolkit` 1.4.6 |
| 依赖 | 无第三方运行时依赖；浏览器端只用 `react`（由 DSH 注入） |
| 协议 | Profile 中作为普通 bundle 安装，卸载/禁用不会留下改动 |

## English

**dsh-ssh-file-manager** adds an *SSH remote files* panel to DeepSeek Harness. Pick a remote workspace or a configured SSH host, browse the server tree, preview text/images/PDF, multi-select, copy/cut/paste, rename, delete, create folders/files, upload by button or drag-and-drop, and download files or folders as `tar.gz`.

It reuses [`dsh-ssh-toolkit`](https://github.com/MaiwulanjiangMaiming/Deepseek-harness-SSH-toolkit) for connections and host-key trust, stores no credentials, and serves its own same-origin `/x-ssh-files/*` routes. Requires an SSH host configured under **Settings → SSH connections** and a Linux/macOS remote.

```bash
dsh plugin --profile desktop add github:zl2860/dsh-ssh-file-manager
```

Refresh the page after installing; the sidebar entry is named *SSH remote files* (Chinese locale: SSH 远程文件).

## License

MIT — see [LICENSE](LICENSE).
