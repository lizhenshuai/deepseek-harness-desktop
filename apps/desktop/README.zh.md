# `@deepseek-ai/dsh-desktop`

[English](README.md) | 中文

这个私有 workspace 包负责 staged 桌面运行时的 Electron main process 和带向导的 Windows x64 NSIS 安装程序。它启动一个内置的 `dsh web` 后端，并在其 loopback endpoint 上创建唯一的 sandboxed 窗口。自动更新不属于该桌面包。

## 构建与测试

`pnpm run desktop:build` 生成 ESM main 入口，`pnpm run desktop:test` 覆盖后端生命周期、有界诊断、窗口状态、origin、导航、权限、运行时路径和单实例策略。`pnpm run desktop:test:electron -- <absolute-runtime-root>` 让构建后的 shell 使用任务 2 staged runtime，并在真实 Electron 中回放已提交的语义和截图 snapshot。开发环境要求显式传入绝对路径 `DSH_DESKTOP_RUNTIME_ROOT`；打包应用始终使用 `resources/runtime`。

`pnpm run desktop:package` 把 Electron main 代码放入 ASAR，并把 `dist/desktop-runtime/windows-x64/runtime`、`LICENSE` 和 `THIRD_PARTY_NOTICES.md` 复制成外部资源。`pnpm run desktop:make` 生成一个带向导的 Windows x64 NSIS `Setup.exe`、对应 block map 和 SHA-256 清单；`desktop:verify-package` 与 `desktop:verify-installer` 分别检查这两层产物。普通安装会显示安装目录步骤，创建开始菜单和桌面快捷方式，并默认以无需管理员权限的当前用户模式安装。`pnpm run desktop:test:packaged -- <absolute-executable>` 连接仅供测试使用的 loopback Chromium 调试端点，检查 hardened 包的真实 Web 组合、sandboxed renderer、视觉 snapshot 与单实例行为；由于打包 fuse 禁用 Node inspection，main-process restart 覆盖由开发 Electron smoke 负责。shell 不包含 renderer 源码、preload 脚本、IPC API 或更新客户端。

`pnpm run desktop:verify-acceptance -- ...` 校验专用 Windows 10/11 Hyper-V controller 生成的 machine-readable report。缺少 lifecycle assertion、installer digest 不同、发行证据未签名、命中 credential、操作系统矩阵不完整或缺少受保护 Provider 结果时，该命令都会失败。controller prerequisite、签名候选流程与发行判定详见[桌面发行验收手册](../../docs/cookbook/desktop-release-acceptance.md)。

## 安全性与限制

桌面控制器通过内置 Node 和 CLI 运行 `web --supervised-stdin --host 127.0.0.1 --port 0`，把 Harness 数据存放在 `<userData>/harness`，校验精确的就绪 origin，并在创建窗口前探测已提供服务的首页。正常退出会发送 `shutdown\n` 并等待完全停稳；超时、Windows session end 和宿主退出使用共享的进程树终止回退。当前和上一代后端日志经过脱敏并限制大小，存放于 `<userData>/logs`。原生菜单和故障对话框提供重启、打开日志与退出操作，不需要 preload 或 IPC 权限。

NSIS 卸载程序会删除应用和快捷方式，同时保留 Electron `userData`。开发与 pull-request 构建默认不签名。发行构建通过 `DSH_WINDOWS_CERTIFICATE_FILE` 提供绝对路径下的普通 PFX 文件，并通过 `DSH_WINDOWS_CERTIFICATE_PASSWORD` 提供 secret；`DSH_WINDOWS_SIGN_REQUIRED=1` 会拒绝未签名构建。签名输入绝不会复制到应用中。

后端 endpoint 必须是精确的 `http://127.0.0.1:<port>` origin。renderer 禁用 Node integration，启用 context isolation 和 sandbox，禁用 WebView，不使用 preload，拒绝全部权限，并在打包环境禁用开发者工具。frame 导航和 redirect 必须保留在受管 origin；子窗口一律拒绝，只有经过校验且不带凭据的 HTTP 或 HTTPS 目标才能在系统浏览器中打开。发行验收消费上游 workflow 的 installer，不重新构建，并在每个破坏性阶段前恢复封存 guest snapshot。
