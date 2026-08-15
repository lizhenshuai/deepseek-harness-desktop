# Agent Note: 桌面运行时 artifact 保留已暂存目录树

Status: implemented

[English](2026-08-15-desktop-runtime-artifact-boundary.md) | 中文

## Problem

已暂存的 Windows 运行时在上传前通过了 manifest 检查，但 `actions/upload-artifact` 默认会省略隐藏文件。依赖包包含由 `runtime-manifest.json` 封存的合法 dotfile，因此单独下载后的 artifact 无法通过脱离检出目录的 manifest 检查。Electron 冒烟命令还在通过嵌套 `pnpm run` 转发路径时加入了 `--`；pnpm 将该分隔符保留为位置参数，测试因收到两个参数而拒绝执行。

## Decision

桌面运行时 artifact 显式启用 `include-hidden-files`。暂存过程会在目录到达 artifact 边界前拒绝带凭据特征的文件名和秘密内容，因此上传目录可以与 manifest 保持逐字节一致，而不会扩大凭据暴露范围。

桌面 Electron 和已打包应用的冒烟命令会把目标路径直接传给根脚本。根脚本已经委托给桌面 workspace，pnpm 无需额外分隔符即可转发该路径。

工作流测试固定这两项要求：运行时上传必须包含隐藏文件，嵌套桌面冒烟命令不得包含字面分隔符参数。

## Alternatives considered

**从运行时 manifest 中排除 dotfile。** 不采用，因为依赖 dotfile 属于已安装包载荷。忽略它们会让上传后的验证弱于暂存验证。

**在生成清单前删除依赖 dotfile。** 不采用，因为包载荷裁剪需要明确的产品策略和兼容性证明；传输层不得静默修改已经验证的运行时。

**让 Electron 测试忽略开头的 `--`。** 不采用，因为多余值是工作流转发缺陷。接受它会掩盖错误调用并让测试约定更复杂。

## Consequences

- 下载后的运行时 artifact 包含 manifest 记录的所有文件。
- 隐藏文件上传前仍由凭据扫描守卫。
- 桌面冒烟测试在暂存和打包模式下都只接收一个目标路径。
