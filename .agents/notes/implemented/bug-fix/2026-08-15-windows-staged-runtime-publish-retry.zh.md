# Agent Note: Windows 运行时发布会重试瞬时目录锁

Status: implemented

[English](2026-08-15-windows-staged-runtime-publish-retry.md) | 中文

## Problem

桌面 staging 会在随机同级目录中构建并验证完整运行时，随后以原子 rename 将该目录发布到最终路径。在托管 Windows runner 上，固定 Node 的 Web 验证已成功完成，但 Windows 仍在释放进程或扫描器句柄，导致最后的 rename 收到 `EPERM`。运行时内容和目标路径均有效，已经验证的产物却被丢弃。

## Decision

同级目录发布只重试 Windows 风格的瞬时 rename 失败：`EBUSY`、`ENOTEMPTY` 和 `EPERM`。延迟采用有界指数阶梯，总计少于 32 秒。每次重试都会确认目标仍然不存在；如果出现竞争目标，会立即失败而不是替换它。

该操作仍然只执行一次目录 rename。它不会复制文件、发布不完整目录树、删除目标，也不会弱化任何 manifest、策略或运行时证明。

## Alternatives considered

**把已验证目录复制到目标。** 不采用，因为读取者可能观察到不完整运行时，目标也不再代表一次原子发布。

**无限重试所有 rename 错误。** 不采用，因为无效路径、权限和持续锁定需要诊断。封闭的错误集合和有限延迟保留了可操作的失败。

**在 Web 验证后无条件休眠。** 不采用，因为已经释放句柄的宿主应立即发布，而一个固定延迟无法区分瞬时锁和其他失败。

## Consequences

- 托管 Windows runner 可以容忍真实 Web smoke 退出后的短时句柄保留。
- 持续锁定仍会在有界时间后以原始文件系统错误失败。
- 成功发布继续保留目标必须不存在和同级原子 rename 的保证。
