# Agent Note: 规范化 packed manifest 使发布 tarball 可复现

Status: implemented

[English](2026-08-15-deterministic-packed-manifests.md) | 中文

## Problem

`pnpm pack` 会在发布前解析 workspace 依赖范围，但导出的 `package.json` 依赖映射没有稳定的键顺序。因此，同一包的两次干净构建可能包含完全相同的程序文件与语义等价的 manifest，却产生不同的 tarball 校验和。Windows 桌面运行时锁会封存这些校验和，所以由一次干净构建生成的锁会在下一次干净 CI 构建中漂移。

## Decision

发布打包边界会先规范化每个导出 manifest，再重新打包并校验 payload。对象键递归排序，数组顺序保持不变，生命周期脚本被禁用，最终归档由 npm 完成。隔离的缓存使并发操作或宿主 npm 缓存状态不会影响结果。

dsh 与 vendored 两个发布族都使用 `scripts/release/pack.ts`，因此该规则同时适用于两者。Landlock 序列继续直接打包；它的 manifest 不包含暴露此次非确定性的 workspace 依赖映射。

## Alternatives considered

**构建桌面锁时忽略 manifest 顺序。** 不采用，因为该锁有意封存前序发布作业已经证明的精确发布产物。若只对语义投影计算哈希，发布字节可能与锁定输入不同。

**提交由最新 CI artifact 生成的锁。** 不采用，因为下一次干净打包仍可能选择不同的键顺序，只会造成反复更新锁，而不是得到可复现输入。

**用仓库自有 manifest 转换器替换 pnpm 的 workspace 导出。** 不采用，因为 workspace 范围转换与发布字段处理仍应由 pnpm 负责。规范化只在这个受维护的转换已经生成可发布 manifest 后开始。

## Consequences

- 即使 pnpm 以不同顺序输出依赖映射，内容相同的 payload 也具有可复现的 tarball 标识。
- 发布打包会增加一次本地归档过程，因此耗时更长。
- 规范化期间不会运行包生命周期脚本；第一次 `pnpm pack` 仍是构建和选择 payload 的负责步骤。
- 如果某个包的导出 payload 无法经过解包和禁用脚本的 npm 重打包，发布边界会在发布前失败。
