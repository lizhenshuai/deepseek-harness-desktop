# Agent Note: CSS Module 哈希使用仓库相对标识

Status: implemented

[English](2026-08-15-repository-relative-css-module-hashes.md) | 中文

## Problem

客户端 bundle 插件把每个样式表的绝对文件系统路径传给 Lightning CSS。Lightning CSS 在生成 CSS Module 类名哈希时会包含该文件名，因此同一份源码在开发者检出目录和 GitHub Runner 下会产生不同的 bundle 字节。Windows 桌面运行时锁会封存已打包的客户端 bundle，导致本地生成的锁无法在 CI 中验证。

## Decision

`dsh-css-modules-inline` 为样式表保留两种标识。绝对路径继续作为读取目标和 watch 依赖。Lightning CSS 接收已编码进虚拟模块 id 的仓库相对标识；仓库外的源使用其 basename。因此，只要源码与稳定标识相同，无论检出根目录或路径分隔符是什么，都会产生相同的类映射。

CSS 文本、导出的类映射与样式所有权标签保持既有运行时行为。构建测试会从两个不同物理根目录加载名称和内容相同的模块，并要求虚拟模块输出逐字节一致。

## Alternatives considered

**从桌面锁中排除客户端 bundle 校验和。** 不采用，因为客户端 JavaScript 和注入的 CSS 都是可执行产品输入。为了容忍构建缺陷而省略它们，会削弱安装器的完整性边界。

**在 Lightning CSS 编译后规范化生成的类名。** 不采用，因为编译后重写选择器与导出映射会重复实现 CSS Module 语义，而且未来 Lightning CSS 输出变化时可能漏掉引用。

**要求每次构建都使用相同的绝对检出根目录。** 不采用，因为开发者机器、GitHub Runner 与下游发布设施必然使用不同根目录。文件系统位置不是包标识的一部分。

## Consequences

- 客户端 bundle 字节不再依赖检出目录的绝对路径。
- 在仓库内重命名或移动样式表会有意改变其 CSS Module 哈希。
- basename 相同的仓库外测试 fixture 会共享稳定标识；生产样式表都位于仓库内，并使用完整的仓库相对路径。
