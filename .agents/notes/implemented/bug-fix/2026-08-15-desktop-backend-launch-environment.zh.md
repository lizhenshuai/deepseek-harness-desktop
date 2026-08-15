# Agent Note: 桌面后端继承经过清理的启动环境

Status: implemented

[English](2026-08-15-desktop-backend-launch-environment.md) | 中文

## Problem

桌面后端控制器启动内置 Node 时只传入 `DSH_HOME` 和 `DSH_TELEMETRY_DISABLED`。Windows 系统变量、区域设置、代理设置和普通用户配置全部缺失。已暂存 CLI 可以通过直接冒烟测试，但在 Electron 下无法达到就绪状态，因为受监督进程的环境与正常产品启动不同。

## Decision

控制器以 `@deepseek-ai/dsh-subprocess` 的统一 `scrubbedParentEnv()` 为基础，再应用可选的受信任测试或宿主覆盖，最后写入桌面拥有的 `DSH_HOME` 和遥测值。因此，凭据特征名称与继承的 `DSH_*` 名称默认不存在，普通平台变量则继续可用。

控制器测试证明普通继承标记会保留，token 特征标记与继承的 DSH 标记会被移除，桌面拥有的 home 会替换所有环境值。

## Alternatives considered

**在桌面包中维护 Windows 环境变量白名单。** 不采用，因为系统和区域要求会随 Windows 版本与依赖而变化。subprocess seam 已经拥有全仓统一的凭据清理规则。

**原样转发 `process.env`。** 不采用，因为 Electron 宿主可能携带提供商凭据和 Harness 标识，受监督后端不得隐式继承它们。

**保留空基础，并在遇到失败时逐个添加变量。** 不采用，因为这会形成第二套不完整的可用子进程环境定义，并让普通用户设置静默消失。

## Consequences

- 内置后端会获得正常的 Windows 执行环境，同时不会继承环境中的凭据特征名称或 Harness 自有变量。
- 清理之后写入的桌面自有值继续保持权威。
- 桌面进程启动与仓库内其他 subprocess owner 共用同一安全规则。
