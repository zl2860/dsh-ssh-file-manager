# dsh-ssh-file-manager

> 给 DeepSeek Harness（Web GUI）加一个「SSH 远程文件」面板：不用开终端，也能浏览、预览和管理远程服务器上的文件。

配套插件：[`dsh-ssh-toolkit`](https://github.com/MaiwulanjiangMaiming/Deepseek-harness-SSH-toolkit)。本插件复用它的 SSH 连接池、主机配置与主机指纹信任（TOFU），**不复制、不保存任何凭据**。

## 功能

| | |
|---|---|
| **来源** | 侧栏图标 → 主面板；顶部下拉列出所有远程工作区（来自你的 SSH 会话）和所有已配置的 SSH 主机（从 `$HOME` 开始浏览） |
| **浏览** | 目录树、可编辑路径栏、`↑` 上级；目录按需展开，目录优先 + 自然排序 |
| **预览** | 文本（前 1.5 MB，等宽显示）、图片（PNG/JPEG/GIF/WebP/SVG…）、PDF（内置查看器）；二进制文件显示大小与修改时间 |
| **多选** | 单击选中、`Cmd/Ctrl` 反选、`Shift` 连选；方向键移动、`Enter` 打开、`F2` 重命名、`Delete` 删除 |
| **文件操作** | 复制 / 剪切 / 粘贴（服务端 `cp -a`、`mv`）、重命名、删除（`rm -rf`，二次确认）、新建文件夹、新建文件 |
| **传输** | 上传：按钮或**拖拽文件到面板**，同名文件询问是否覆盖，逐文件进度；下载：单文件原样下载，多选/目录在服务端打包为 `tar.gz` 流式下载 |
| **右键菜单** | 文件：下载、复制、剪切、重命名、复制路径、删除；目录：展开、下载（tar.gz）、粘贴到此处、新建、重命名、删除 |

## 安装

仓库：<https://github.com/zl2860/dsh-ssh-file-manager>

```bash
# 从 GitHub 安装
dsh plugin --profile desktop add github:zl2860/dsh-ssh-file-manager

# 或者用本地目录（开发时）
dsh plugin --profile desktop add /path/to/ssh-file-manager
```

也可以在 **设置 → 插件 → 添加插件** 里选择本目录。安装后刷新页面即可（Host 路由随插件加载）。本插件没有构建步骤，不需要 `pnpm run build`。

## 使用

1. 侧栏点新出现的 **SSH 远程文件** 图标。
2. 顶部选一个来源：
   - **工作区 · 名称**：直接定位到该远程工作区的目录；
   - **主机 · 名称**：从远端登录用户的 `$HOME` 开始浏览。
3. 左侧点目录展开 / 点文件预览；右键或底栏按钮执行操作。
4. 从 Finder 把文件拖进左侧树 = 上传到当前目标目录（选中的目录，或选中项的父目录，否则为根目录）。

## 安全与边界

- 面板只调用本机 Host 上 `dsh-ssh-toolkit` 已配置的主机；连接使用该插件保存的认证方式，本插件不读取口令字段。
- 路由在 `/x-ssh-files/*`，位于 `/api` 之外，因此自行校验同源：`Sec-Fetch-Site: cross-site` 或 `Origin` 与 Host 不一致的请求一律 403。
- 主机指纹未信任时返回明确错误，请在 设置 → SSH 连接 中测试并信任后重试。
- 上传上限 256 MiB（请求体在 Host 内存中缓冲后原子写入）；文本预览上限 1.5 MB；`/raw` 的 Range 单次上限 8 MiB，更大的请求回退为整文件流。
- 目录下载依赖远端的 `tar`（GNU tar 或 bsdtar 均可），远端平台需为 Linux 或 macOS（与 `dsh-ssh-toolkit` 一致）。
- 不支持：拖出浏览器到 Finder（浏览器限制）、Windows 远端、跨主机复制。

## 结构

```
index.js            Host 入口：注册 /x-ssh-files/* 路由
lib/remote.js       SFTP/exec 原语：列目录、读文本、复制/移动/删除/新建、错误映射
lib/router.js       远程工作区占位目录 → 主机 + 远程路径的解码（与 toolkit 同规则）
client.js           浏览器端：侧栏图标 + 主面板（React，零 Harness 包依赖）
cordis.patch.yml    插入 Host 插件行
locale/             插件标题与描述
icon.svg            侧栏/插件列表图标
```
