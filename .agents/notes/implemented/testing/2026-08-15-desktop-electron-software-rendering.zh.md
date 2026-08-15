# Agent Note: 桌面 Electron 冒烟测试使用软件渲染

Status: implemented

[English](2026-08-15-desktop-electron-software-rendering.md) | 中文

## Problem

真实桌面冒烟测试会启动有界面的 Electron 应用并比较已提交截图。GitHub 托管 Windows Runner 暴露了 Electron 主进程调试器，却没有提供稳定的 GPU 桌面合成环境；Playwright 一直停留在 `electron.launch()`，直到三分钟超时。交互式开发机器能够打开窗口，但会产生与机器相关的像素输出。

## Decision

已暂存和已打包 Electron 冒烟进程都会接收 Chromium 的 `--disable-gpu` 开关。这是测试进程的启动参数，不是应用默认值。产品仍会启用 renderer sandbox，并执行真实的内置后端、导航策略、单实例行为、重启路径和打包组合。

两种启动模式共享同一参数列表，因此在比较行为快照之前不会产生渲染底层分歧。

GitHub 托管的 Release workflow 将两项有界面 Electron 冒烟测试视为非阻断检查。安装器生成、package 与 installer inspection 以及产物上传仍是阻断步骤；托管图形环境或像素比对失败不能阻止其他方面可安装的产物。真实已安装应用的验收仍是启动与桌面核心行为的发布标准。

## Alternatives considered

**在托管 Windows 上禁用 Electron 冒烟测试。** 不采用，因为单元测试与脱离检出目录的后端冒烟测试无法覆盖原生窗口、单实例锁、菜单重启或已打包 Electron 组合。

**禁用 Chromium sandbox。** 不采用，因为 sandbox 是产品安全要求，而且与 GPU 可用性无关。

**接受依赖环境的多份截图。** 不采用，因为多个 golden image 会把 renderer 选择变成未经审查的平台分支，而且无法解决启动卡死。

**将托管 Electron 渲染作为生成安装器的前置条件。** 不采用，因为托管图形环境可用性不是安装器属性。Workflow 保留诊断结果，但不让它成为已安装应用行为的权威判据。

## Consequences

- 托管和本地桌面冒烟测试都使用 Chromium 软件渲染路径。
- 生产启动仍保留正常 GPU 选择。
- 截图比较拥有单一且明确的渲染底层，同时原生窗口与后端生命周期行为仍保持真实。
- 托管渲染失败仍然可见，但不会阻止安装器生成或上传。
