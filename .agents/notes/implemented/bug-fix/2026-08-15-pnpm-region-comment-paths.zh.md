# Agent Note: 客户端 bundle 区域注释隐藏 pnpm 存储标识

Status: implemented

[English](2026-08-15-pnpm-region-comment-paths.md) | 中文

## Problem

Rolldown 会生成包含源模块路径的 `//#region` 注释。内联依赖的路径包含 pnpm 虚拟存储目录名，其 peer 后缀可能会根据物理存储路径在 Windows 上缩短。因此，即使注释没有运行时含义，相同依赖代码在不同检出环境中仍会产生不同的客户端 bundle 字节。桌面运行时锁检测到该字节差异后，会拒绝 CI 构建的包。

## Decision

共享客户端 bundle preset 仅重写穿过 pnpm 虚拟存储段的自动生成 `//#region` 行。环境相关的目录组件替换为固定的 `<virtual-store>` 标记，依赖包目录以下的路径仍然保留。运行时代码、第一方区域标签和 source map 源路径保持不变。

构建测试会提供完整和缩短的 pnpm 存储标识，并要求两者生成相同的规范化注释。

## Alternatives considered

**忽略客户端 bundle 校验和。** 不采用，因为这些 bundle 是安装器中的可执行输入，必须继续包含在运行时完整性边界内。

**要求固定的 pnpm 虚拟存储路径长度。** 不采用，因为 pnpm 会有意根据平台路径限制调整存储目录名，仓库构建不应依赖安装位置。

**删除所有区域注释。** 不采用，因为稳定的第一方与依赖路径仍有助于检查未压缩 bundle。只需规范化环境相关的存储标识。

## Consequences

- 客户端 bundle 字节不再依赖 pnpm 对虚拟存储目录名的缩短方式。
- 依赖区域标签保留包内相对源路径，但省略 peer 解析细节。
- 重写仅限行注释，不会改变可执行 JavaScript 或 source map。
