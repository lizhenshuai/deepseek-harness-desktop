# DeepSeek Harness 客户端

[English](README.md) | 中文

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）的 **Windows 桌面客户端**。它用 Electron 把 DeepSeek Harness 的 Web 运行时打包成桌面应用：启动即运行内置的 `dsh web` 后端，并在沙箱化窗口中打开 Web 界面——无需安装 Node.js、pnpm 或任何仓库文件。

本仓库派生自上游 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)——一个**一切皆插件**、由 [Cordis](https://github.com/cordiverse/cordis) 驱动的开源智能体框架。客户端实现位于 [`apps/desktop`](apps/desktop)，其余为它所打包的上游代码。插件模型见 [architecture](docs/architecture.md)。

## 特性

- **开箱即用**：内置 Node 运行时与 `dsh web` 后端，用户无需安装 Node.js、pnpm 或拉取仓库
- **沙箱化**：Electron 渲染进程开启 `sandbox` 与 `contextIsolation`，禁用 Node 集成、preload 与 WebView
- **单实例**：同一时间只运行一个应用实例
- **可靠生命周期**：后端就绪探测、优雅/强制停止、崩溃自动恢复与手动重启
- **数据持久**：应用数据保存在 Electron `userData` 下，卸载时保留
- **日志脱敏**：后端日志脱敏并截断，仅保留最近两代

## 下载安装

系统要求：**Windows 10 / 11（x64）**。

从 [Releases](https://github.com/lizhenshuai/deepseek-harness-desktop/releases) 下载最新 `Setup.exe` 并运行：

- 默认按当前用户安装（无需管理员权限），可自选安装目录
- 安装后自动启动，并在桌面与开始菜单创建快捷方式

> 当前安装包为未签名构建，Windows SmartScreen 可能提示，选择“更多信息 → 仍要运行”即可。

## 从源码构建

前置要求：Node.js `^22.19 || >=24` 与 pnpm。

```sh
pnpm install
pnpm run desktop:build     # 编译 Electron 主进程
pnpm run desktop:package   # 构建 hardened package（ASAR + 外部运行时资源）
pnpm run desktop:make      # 生成 Windows x64 NSIS 安装包（out/make/DeepSeek-Harness-Setup-x64.exe）
```

## 开发

```sh
pnpm run desktop:test            # 单元测试
pnpm run desktop:test:electron   # 在真实 Electron 中回放语义/截图快照
pnpm run desktop:test:packaged   # 验证打包产物（需先 desktop:package）
```

完整的桌面端开发与发布说明见 [`apps/desktop/README.md`](apps/desktop/README.md)。

## 社区

感兴趣的可以进群，扫码加入 DeepSeek Harness 社区群聊：

<img width="280" alt="DeepSeek Harness 社区群聊二维码" src="https://github.com/user-attachments/assets/56148239-5d99-414c-8893-8c091e7941da" />

> 二维码 7 天内有效，过期后群主会更新。

## 安全与限制

- 后端端点严格限定为环回地址 `http://127.0.0.1:<port>`
- 渲染进程无 Node 集成、无 preload、无 IPC，仅通过托管页面访问后端
- 卸载保留 `userData`；如需彻底清除，请卸载后手动删除用户目录下的应用数据

## License

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
