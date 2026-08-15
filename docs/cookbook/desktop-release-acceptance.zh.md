# Windows 桌面发行验收

[English](desktop-release-acceptance.md) | 中文

本手册用于准备专用 controller，并针对已签名的 DeepSeek Harness 桌面候选版本触发 Windows 10/11 验收 workflow。workflow 消费既有 installer artifact；绝不在验收 guest 内构建或签名。

## 准备每个 controller 与 guest

准备两台专用 x64 Hyper-V controller，分别带有 `dsh-desktop-acceptance` 和 `dsh-desktop-windows-10` 或 `dsh-desktop-windows-11` label。每个 controller 拥有一个 guest 和一个封存 snapshot。不要让这些 guest 与开发或普通 CI 共用。

封存 guest 包含一个交互式非管理员验收账号，其 profile path 同时包含空格和非 ASCII 字符。封存 snapshot 时保持该账号已登录。guest 中不得存在 Node、pnpm、Git、DeepSeek Harness、`DSH_*` 环境变量、模型凭据或 Harness 数据。Windows 与 guest integration service 保持为验收报告所记录 image build 对应的当前状态。

在验收账号下创建名为 `DeepSeekHarnessAcceptance` 的 scheduled task。它使用 `Interactive` logon，并执行以下固定 action：

```powershell
pwsh.exe -NoProfile -ExecutionPolicy Bypass -File C:\dsh-acceptance\request.ps1
```

controller 会在破坏 session 的退出阶段之前恢复封存 snapshot，并在 install-to-uninstall 阶段之前再次恢复。它只在 guest 的 `C:\dsh-acceptance` 下写入。snapshot 是清理机制；产品 uninstaller 有意保留用户数据。

为每个 controller 上的 self-hosted runner service 配置以下环境变量：

| 变量 | 值 |
|---|---|
| `DSH_ACCEPTANCE_VM_NAME` | 精确的 Hyper-V guest 名称 |
| `DSH_ACCEPTANCE_VM_SNAPSHOT` | 精确的封存 snapshot 名称 |
| `DSH_ACCEPTANCE_CREDENTIAL_FILE` | 指向受 DPAPI 保护的 PowerShell credential 的 controller 绝对路径 |

使用 GitHub runner service 的同一 Windows identity 创建 credential 文件：

```powershell
Get-Credential | Export-Clixml D:\dsh-secrets\desktop-acceptance-vm.xml
```

该 credential 只用于打开 PowerShell Direct，绝不复制到 guest 或上传。把文件 ACL 限制为 runner-service identity。VM 缺失、snapshot 不唯一、scheduled task 不兼容、credential 不可用或 guest 停止上报时，workflow 都会失败。

## 配置签名与 Provider 保护

GitHub `desktop-release-acceptance` environment 保护两个操作系统 job。`desktop-release-provider` environment 额外配置 required reviewer，以及组织自有真实 UI Provider driver 使用的短期 DeepSeek credential。该 driver 在 Windows 11 controller 上写入 `DSH_ACCEPTANCE_PROVIDER_EVIDENCE` 指定的文件。其 JSON 对以下每个 id 都包含且只包含一项通过观察，并且不包含 credential 值：

```text
provider.conversation
provider.session-restored
tools.filesystem
tools.powershell
tools.worker-thread
```

Provider driver 必须通过已安装 Web UI 配置 credential，使用唯一 transcript 和 tool-result canary 完成一次对话，重启应用，重新打开 session，扫描所有保留证据是否含 credential canary，并删除本地 credential 文件。不要手工编写该 JSON；它必须来自受保护的已安装产品运行。

只有选择 `desktop_sign` 时，release workflow 才读取 `DSH_WINDOWS_CERTIFICATE_PFX_BASE64` 和 `DSH_WINDOWS_CERTIFICATE_PASSWORD`。将两者存储为 repository 或 environment secret。workflow 把 PFX 写入 hosted runner 临时目录，强制签名，校验 application 和 installer，上传已签名 artifact，然后删除临时 PFX。

## 运行发行候选版本

1. 从预定 release ref 触发 `Release (dsh)`，并启用 `desktop_sign`。记录 run id、`dsh-desktop-installer-windows-x64-signed` artifact 名称，以及其 `SHA256SUMS.txt` 中的小写 Setup digest。
2. 选择一个已验收的低版本签名 artifact 作为 predecessor。在首个 tagged release 前，只可使用相同 runtime 的刻意低版本 package 证明 NSIS 原位替换与 opaque 数据保留；这不建立 pre-release 数据格式兼容性。
3. 触发 `Desktop release acceptance`，传入两个 run id 与 artifact 名称、候选 Setup digest 和预期 publisher-subject 子串。发行判定必须保持 `provider` 启用。
4. 要求两个操作系统 job、Windows 11 受保护 Provider job 和 `Verify release acceptance evidence` 全部通过。校验器会拒绝缺失断言、失败观察、不同的候选 digest、未签名发行证据、credential 命中、缺少任一操作系统或缺少 Provider 结果。
5. 只发布已记录候选 run 中的已签名 artifact。验收后绝不重新构建。

即使 guest 报告失败，每个 job 仍上传有界 JSON、JUnit-compatible result input、截图和脱敏诊断。runner 或 Provider 不可用表示发行被阻塞，不是跳过后成功。
