# Agent Note: 带向导的 NSIS 桌面安装程序

Status: implemented

[English](2026-08-15-assisted-nsis-desktop-installer.md) | 中文

## 问题

Windows 桌面安装程序原先使用 Squirrel 直接执行每用户安装。它不会展示 Windows 安装向导中常见的目录与确认步骤；由于这个桌面客户端不提供自动更新，它生成的 NuGet 和 `RELEASES` 产物也没有用途。

## 决策

基于既有 hardened Electron package 构建一个带向导的 NSIS 安装程序。向导允许选择安装目录，默认执行每用户安装，并创建桌面和开始菜单快捷方式。运行时仍位于 ASAR 外，应用数据仍位于 Electron `userData` 下，卸载时保留这些数据。CI 与发行上传 setup executable、block map 和 checksum 清单。

package、运行时组合、桌面生命周期和 Web 应用均不改变。Windows 签名继续使用既有的全有或全无 PFX 配置。本决策取代 [Windows 桌面发行方案](../../proposed/architecture/2026-08-14-windows-desktop-distribution.md)中关于 Squirrel 安装程序的部分。

## 曾考虑的替代方案

**保留 Squirrel。** 不采用：它的直接安装方式不能提供所需的安装目录选择向导。

**增加第二种安装格式。** 不采用：同时维护和发布 Squirrel 与 NSIS 会增加发行路径，却不会增加必需能力。

## 后果

交互式安装现在遵循常规向导并允许自定义目录。静默验收使用同一安装程序的 `/S` 与显式 `/D` 目录，随后启动已安装 executable 并运行既有 Web UI probe。移除 Squirrel maintenance 处理与 Squirrel 专用产物；自动更新仍不在范围内。
