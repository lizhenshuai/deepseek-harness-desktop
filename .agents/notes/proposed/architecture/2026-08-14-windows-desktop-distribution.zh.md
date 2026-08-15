# Agent Note: 自包含 Windows 桌面发行

[English](2026-08-14-windows-desktop-distribution.md) | 中文

Status: proposed

## Problem

当前 Web 应用的发行运行依赖兼容的 Node.js 运行时、已安装的 NPM 依赖图、完成构建的 Host 和 Client 包、Vite 前端 dist、Cordis patch 文件，以及启动 `web` profile 的命令。只想使用桌面产品的 Windows 用户不应安装 Node 或 pnpm、克隆此 monorepo、构建包、理解 profile，也不应保持终端窗口开启。

Web 应用不是独立静态站点。`apps/web` 提供 Vite/React shell，但 `apps/cli` 初始化并组合 profile，`packages/bundle/web-app` 插入 Web Host 和 Client 名录，`packages/host/webserver` 与 `packages/host/frontend-static` 提供注入启动 manifest 后的前端，`packages/host/apiproxy` 连接 API，`packages/client/*` 贡献浏览器插件。Cordis 在运行时按 NPM 包名解析插件，因此复制单个 bundle 入口文件无法得到完整应用。

运行时还会启动 Worker Threads、PowerShell、目录选择 worker、沙箱 runner 和其他子进程。Electron 的 `process.execPath` 指向桌面可执行文件，而不是普通 `node.exe`；用 Electron 作为 Harness 解释器会改变 Node 子进程路径所依赖的假设。因此发行方案必须明确进程、文件系统、安全、持久化和发布设计。

## Proposal

### Product scope

首个桌面版本面向 Windows 10 和 11 x64。用户安装一个 `Setup.exe`，启动应用时不出现控制台窗口，在现有 UI 中配置模型凭据、选择工作区，然后使用现有 Web 产品。安装后的应用不依赖 Node、pnpm、仓库文件或 workspace 链接。agent 工作调用的 Git、Python、编译器或语言服务器等外部工具仍由用户提供，不属于自包含 Harness 运行时的承诺。

在 x64 安装包和生命周期通过干净机器验收前，Windows ARM64、系统托盘、自动更新、Microsoft Store 打包和通用开发工具链内置均暂缓。

### Runtime topology and package ownership

Electron 只负责桌面窗口、单实例行为、导航策略、后端进程监管和应用生命周期。其 renderer 加载现有 Web 应用且不获得 Node 集成能力。带校验和的固定官方 Node.js 24 x64 运行时，在系统分配的 `127.0.0.1` 端口上以 `web` profile 启动完成构建的 `apps/cli` 入口。

现有包保持职责不变：`apps/web` 构建浏览器 shell；`apps/cli` 负责 profile 启动；`packages/bundle/web-app` 组合浏览器应用；`packages/host/{webserver,frontend-static,apiproxy}` 负责本地 HTTP、静态资源和 API 传输；`packages/client/web` 组装 shell；`packages/client/*` 提供运行时 Client 插件名录。新增的 `apps/desktop` 负责 Electron 专属代码。构建期 staging 脚本负责生产依赖闭包并生成经 manifest 校验的桌面运行时；它不把桌面行为引入 `packages/core` 或 `agent-loop`。

staged 运行时包含完成编译的包 exports、生产依赖、Cordis patch 文件、Client bundle、Vite dist、许可证、固定的 `node.exe` 和内容 manifest。它不包含 TypeScript 源码、测试、缓存、`.env`、凭据、仓库绝对路径或 workspace 符号链接。可执行文件和动态解析资源保留在 ASAR 外；Electron 主进程代码可以使用 ASAR。

Electron 将 `DSH_HOME` 设置在稳定的 `userData` 目录下。profile、设置、凭据、会话、附件和插件状态因此在应用升级和默认卸载后继续保留。安装目录只存放不可变应用内容，绝不作为工作区或持久化根目录。

BrowserWindow 使用 `nodeIntegration: false`、`contextIsolation: true` 和 `sandbox: true`。它只加载为自身受管后端分配的精确 loopback origin，拒绝其他窗口内导航和新窗口创建，并把允许的外部 HTTP 或 HTTPS 链接交给系统浏览器。桌面产品的服务器绝不绑定 `0.0.0.0`。

### Ordered delivery tasks

1. **架构与闭包证明。** 使用独立 Node 可执行文件，证明完成构建的 `dsh web` 能在 workspace 外的临时目录运行。记录所有动态解析的包和资源，发现仓库路径或 workspace 链接依赖时失败，并在产品实现前确定运行时、数据、安全和发布决策。
2. **确定性运行时 staging。** 构建脚本以收集已验证的生产闭包，通过 SHA-256 校验下载或接收固定 Node 运行时，排除开发内容和敏感内容，写入 `runtime-manifest.json`，并在断开仓库访问后从 staged 目录运行构建产物冒烟测试。
3. **Electron shell。** 新增 `apps/desktop`，包含 Electron Forge 配置、单实例主进程、沙箱化 BrowserWindow、严格 origin 与外部链接处理，以及窗口和路径策略的单元测试。shell 使用 staged 运行时，而不是 workspace 源码。
4. **后端生命周期与桌面体验。** 实现明确的 starting、ready、stopping、stopped 和 failed 状态；有界就绪检测；隐藏子进程启动；日志访问；重启和退出操作；窗口状态持久化；崩溃处理；以及正常退出、启动取消、失败和 Windows 注销时的完整进程树清理。
5. **Windows 安装包。** 使用 Electron Forge 和 Squirrel.Windows 生成 Windows x64 安装包，把 staged 运行时放在 ASAR 外，配置产品元数据和快捷方式，在升级和卸载时保留 `userData`，验证带空格和非 ASCII 字符的路径，生成第三方声明，并提供不要求开发者证书的 CI 安全代码签名配置。
6. **干净机器发布验收。** 在没有 Node、pnpm 或 Git 的干净 Windows 10 和 11 机器上，测试安装、首次启动、缺少凭据、离线启动、默认端口被占用、真实模型交互、会话持久化、文件与 PowerShell 工具、Worker Threads、目录选择、崩溃恢复、升级、卸载和无孤儿进程。只有发布的安装包满足这些检查后，才把本 Note 转为 implemented。

每个任务作为独立的依赖 PR 落地。在缺陷传播前由引入该缺陷的 PR 负责修复。每个任务规划并执行适用范围内最小的单元、构建组合、浏览器快照、文档和 Windows 检查；CI 继续负责完整平台矩阵。

### 任务 1 证明协议

打包安装验证器是任务 1 的闭包依据。它把正式的 dsh、vendored Cordis 和 Landlock entry tarball 安装到 checkout 外的临时 consumer，使用所选 Node 发行包自身的 npm 和 `node` 可执行文件，为 npm 和 `DSH_HOME` 分配隔离目录，并拒绝不受支持的 Node 版本。Windows 安装保留平台 optional dependency，使 Koffi 原生实现来自其已发布的平台包而不要求编译器；非 Windows 验证继续省略独立发布的 Landlock 平台产物。

启用 `--web` 后，验证器在系统分配的 loopback 端口启动已安装的 `dsh web` 入口，并等待其权威 ready 日志。它抓取所提供的 index、index 引用的每个本地 Vite 或 public 资源，以及 `window.__DSH_BOOT__` 中的每个动态 Client bundle；校验启动字段和 bundle URL；记录 seed 与动态注入引用；对每个响应计算哈希；并拒绝解析目标离开 consumer 的 profile 模块链接。带 schema 版本的 JSON 报告把每个输入包的名称和版本绑定到 tarball SHA-256，并包含 Web profile bundle、Client 配置项和资源哈希，但不包含时间戳、secret、checkout 路径、临时路径或端口。

dsh 发布工作流先对普通正式打包结果执行证明，再在 Windows x64 的 Node 24 下重放同一组 tarball。一次 Windows 基准运行使用经官方 SHA-256 清单校验的 Node 24.17.0，安装了 231 个 tarball，并抓取了 44 个浏览器资源，其中包含 38 个动态 Client bundle。`pnpm run desktop:prove-runtime -- --node <node.exe> --from <directory>... --report <file>` 为任务 2 和发布诊断提供等价的本地入口。

### 任务 2 staging 协议

`pnpm run desktop:stage-runtime` 接收正式 tarball 目录和任务 1 证明，然后下载或接收由 `scripts/desktop/runtime-targets.json` 固定的 Node 压缩包。它先校验压缩包 SHA-256、目标版本、平台和架构，再使用该发行包自身的 npm。`scripts/desktop/runtime-lock.json` 记录每个生产包位置、名称、版本，以及 registry integrity 或正式 tarball SHA-256；普通 staging 拒绝漂移，`desktop:update-runtime-lock` 是有意变更依赖时的显式评审入口。

投影器从 `@deepseek-ai/dsh` 沿 required dependency、已安装的 optional dependency 和 peer dependency 遍历。它保留编译产物、许可证、运行时资源和仅适用于 Windows x64 的原生 prebuild；拒绝链接、测试、fixture、coverage、TypeScript 和构建输入、仓库或临时目录绝对路径、可能携带凭据的文件名、npm 身份验证信息和私钥内容。稳定的 `runtime-manifest.json` 记录目标、包清单和每个 staged 文件的 SHA-256；独立验证器在启动进程前拒绝缺失、被修改或额外的文件。

Windows staging 工作流只消费发行产物，其下游验证 job 不 checkout 仓库，也不安装包管理器。staged `node.exe` 运行复制进来的验证器，启动打包后的 `dsh web`，检查生成的 profile 链接仍位于运行时内部，并把全部 Client 模块和前端资源与任务 1 证明逐字节比较。基准结果包含 528 个生产包位置和 13,753 个文件，总计 230,187,447 字节；最终保留 16 个可执行或原生文件，全部为必需的 Windows x64 负载。两次独立运行生成了相同的 manifest SHA-256：`8c0f83702dd805cf92b547cca2d63279fa51005a71413b4e271b1f136de4651e`；冒烟测试匹配了 38 个 Client 模块和 44 个前端资源。

### 任务 3 Electron shell 设计

#### 交付边界

任务 3 新增私有 workspace 包 `apps/desktop`，作为 Electron main process shell。它负责单实例协调、唯一的 `BrowserWindow`、受管后端 origin 校验、导航与外部链接策略、Electron session 权限、打包运行时路径解析和 Forge 打包配置。它不负责后端进程创建、ready 检测、重启、日志、失败展示、进程树清理、窗口状态持久化、安装程序生成或更新；这些内容由任务 4 和任务 5 负责。

shell 消费一个 `DesktopBackendEndpointProvider`，它在后端 ready 后解析一次并返回 HTTP origin。可接受值必须精确采用 `http://127.0.0.1:<port>`，端口为 1 到 65535 的十进制数，且不带凭据、`/` 以外的路径、query 或 fragment。任务 3 的测试由外部测试宿主启动任务 2 staged 运行时并提供该接口；任务 4 提供产品实现并拥有其生命周期。这样，任务 3 不会加入随后被生命周期状态机替换的临时子进程实现。

任务 3 分支是依赖交付栈中可构建、可测试的 shell 层，本身不是发行候选。其 Electron 入口导出供集成测试 harness 使用的组合函数；任务 4 接入后端提供方后，产品入口才完整。接口失败或 origin 无效时，在创建任何窗口前拒绝启动。

#### 包与构建布局

`apps/desktop` 包含负责 Electron 事件组合的 `src/main.ts`、负责创建和 dispose 唯一窗口的 `src/window.ts`、负责纯 URL 决策的 `src/origin-policy.ts`、负责打包与测试布局解析的 `src/runtime-paths.ts`，以及声明后端 endpoint provider 的 `src/types.ts`；测试与这些 owner 对应。该包没有 renderer 源码和 preload 脚本，因为现有 Web 应用不需要 Electron API。

仓库现有 TypeScript 和 tsdown 流水线生成 ESM main process 代码；Forge 把这些代码放入 ASAR，并把任务 2 的 `runtime/` 目录复制成外部资源。打包运行时通过 `process.resourcesPath/runtime` 定位；测试显式接收 staged 运行时的绝对根目录，绝不根据当前工作目录猜测。任务 5 之前，Forge 不包含 maker、签名、Squirrel startup 或更新配置；它也不使用 Forge Vite 插件，因为不存在 Electron 自有 renderer 需要构建。

Forge 应用 Electron fuse：禁用 RunAsNode、`NODE_OPTIONS` 和 Node CLI inspect 参数，启用 cookie 加密、内嵌 ASAR 完整性校验，并只允许从 ASAR 加载应用代码。运行时保留在 ASAR 外，因为它的 `node.exe`、原生模块、动态 Client 包、profile 文件和前端资源需要普通文件系统路径。实现时在 lockfile 中固定 Electron 与 Forge 依赖版本，并通过发行依赖流程持续使用当前 Electron 版本。

#### Main process 与窗口行为

main process 在 `app.whenReady()` 前调用 `app.enableSandbox()` 并请求单实例锁。未取得锁的进程直接退出，不解析后端提供方，也不创建窗口。主进程只把 `second-instance` 当作激活请求：恢复最小化窗口并聚焦，或者在首个窗口出现前记录待处理激活；它不解释第二个进程的参数或工作目录。

Electron ready 且提供方返回有效 origin 后，shell 安装 session 权限策略，创建一个隐藏窗口，在 `loadURL()` 前安装导航策略，并只在 `ready-to-show` 后显示窗口。初始窗口使用 `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`、`webviewTag: false`、打包环境 `devTools: false`，且不使用 preload。应用菜单被移除，使打包版本不暴露 reload 或开发者工具命令。ready 失败、窗口关闭或应用退出时的行为由任务 4 负责。

默认 Electron session 拒绝全部权限请求和权限检查。`will-frame-navigate` 与 `will-redirect` 只允许 origin 与受管 loopback origin 完全一致的 URL；其他 main frame 或 child frame 导航全部取消。同文档 history 和 fragment 变化仍可使用。`setWindowOpenHandler` 始终返回 `deny`；纯策略接受不含用户名和密码的绝对外部 `https:` 或 `http:` URL 后，才可委托系统浏览器打开；`file:`、`javascript:`、`data:`、自定义 scheme、格式错误 URL 和带凭据 URL 一律拒绝。未经该校验的 renderer 输入绝不传给 `shell.openExternal`。

#### 验证计划

跨平台 Vitest 测试覆盖所有允许和拒绝的 origin、同源路径与 fragment、redirect 和 frame 决策、外部链接 scheme 与凭据、打包和测试运行时根目录、安全 `BrowserWindow` 选项、权限拒绝以及两个单实例分支。Electron API 测试替身只实现各 owner 实际消费的方法；策略测试保持纯函数，不启动外部应用。

Windows Electron 集成测试消费任务 2 的 `dsh-desktop-runtime-windows-x64` 产物，从 workspace 外启动其后端，并针对产生的 origin 启动构建后的 shell。它证明只有一个窗口加载 staged Web 应用、renderer 无法访问 `require` 和 Node 全局变量、窗口不能导航到其他 origin 或创建子窗口、第二个进程激活第一个实例后退出，且打包运行时路径不含 checkout 位置。测试记录真实 Web 组合在 Electron 中的 keyless screenshot snapshot；实现 PR 同时包含由真实 staged server 流程生成的 GUI 演示 GIF。

Windows CI job 依赖运行时 staging，从 lockfile 安装 Electron 开发依赖，构建 `apps/desktop` 并运行集成测试。包检查验证 ASAR 位置、外部运行时位置和已配置 fuse。clean-machine 安装、签名、升级、卸载、后端崩溃恢复与孤儿进程检查仍属于任务 4 到任务 6 的验收范围。

任务 3 基准实现固定 Electron 43.4.0 和 Forge 7.11.2，生成 6.74 kB 的 ESM main bundle，并通过 22 个策略与组合测试。真实 Electron 回放在唯一的 sandboxed 窗口中加载 38 个 Client 配置项，并证明第二个进程以零退出码结束且不创建其他窗口。Forge 把完整的 230 MB staged 运行时打包在 ASAR 外；包检查确认运行时 manifest、可执行文件和六项安全 fuse。pnpm workspace 只公开 hoist Forge 工具，而打包应用排除全部 npm 依赖，因为 main bundle 只导入 Electron。私有桌面 assembly 不参与 npm 发行发现；已发布的 CLI 和 Web 应用仍属于 dsh 发行族。

### 任务 4 后端生命周期设计

#### 交付边界与职责

任务 4 将任务 3 shell 的 `DesktopBackendEndpointProvider` 接到唯一的 `DesktopBackendController`，从而使打包应用可以运行。controller 负责 staged 后端进程、ready 检测、重启、诊断和清理；shell 继续负责单实例激活和受管窗口。任务 4 不增加 installer maker、签名、更新、托盘、远程访问或第二套 Web 应用；任务 5 仍是安装包 owner。

`apps/desktop` 新增生命周期、诊断、菜单和窗口状态模块。现有 local-subprocess 实现发布一个编译后的 `managed-process` 子路径，其中只包含 detached process tree 启动原语和本地 handle，不要求 Cordis context，也不导入 terminal provider。桌面 bundle 消费该子路径，而不实现第二套 Windows 进程树算法。local spawn 选项增加 `node.exe` 所需的显式 `windowsHide` 选择；现有 Consumer 保持当前默认值。

`apps/cli` 新增通用的 supervised-stdin 启动模式。在该模式中，精确命令 `shutdown\n` 和 supervisor pipe EOF 都请求与 SIGTERM 相同的 quiescent shutdown；首个请求生效，后续输入忽略，格式错误或超过上限的输入会先 dispose 已挂载根节点，再以非零状态退出。这个小型进程协议属于 CLI launcher，不属于 `packages/core`、Web Host 或 renderer 可访问的 HTTP 路由。父管道关闭会在 Electron 崩溃或被强制终止时停止后端；普通桌面退出则允许 Cordis plugin 在进程树升级终止前完成 dispose。

#### 运行时路径、环境与启动

打包启动先通过任务 2 manifest 验证 `process.resourcesPath/runtime`，再执行 `runtime/node/node.exe runtime/app/node_modules/@deepseek-ai/dsh/lib/bin.js web --supervised-stdin --host 127.0.0.1 --port 0`。按照 CLI 的 pass-through 解析规则，launcher 拥有的 supervision flag 位于 Web 应用参数之前。开发和测试显式传入 staged 运行时的绝对根目录；两种模式都不搜索 checkout 或 `PATH`。子进程工作目录和 `DSH_HOME` 都是稳定的 `<userData>/harness` 目录；该目录在启动前创建，且绝不位于安装目录下。

后端获得 subprocess 原语经过凭据清理的父环境，以及桌面显式拥有的环境项。桌面产品不转发名称疑似 secret 的 ambient 变量；模型凭据通过现有 UI 配置，并由 Harness 存储在 `DSH_HOME` 下。环境值绝不写入诊断。可执行文件、参数、工作目录、环境键和运行时 manifest 都在 spawn 前解析，因此自包含配置错误会在任何子进程出现前失败。

#### 状态机与并发

controller 公开 discriminated `DesktopBackendState`，包含 `stopped`、`starting`、`ready`、`stopping` 和 `failed` variant。每次启动分配单调递增的 generation。子进程输出、ready probe、退出 callback、timer、dialog 和 restart 完成都携带 generation，不能修改后续运行。`starting` 与 `ready` 精确拥有一个 process handle；`stopping` 拥有同一 handle 和唯一共享的 stop promise。`failed` 记录清理是否完成；只有在有界 force-stop 无法证明进程树退出时才保留 handle。

`start()`、`stop(cause)` 和 `restart()` 通过一个 controller operation queue 串行化。并发 start 共享同一 ready promise，并发 stop 共享同一 quiescence promise；restart 精确等于 stop 后启动新 generation。stopping 期间请求 start 会等待清理。failed 状态只有在不拥有 live process 后才能重新启动。stopping 中的预期退出会记录退出事实，但不变成 crash；starting 或 ready 中的退出则成为该 generation 的启动或运行时失败。

endpoint provider 调用 `start()`，并且只从 `ready` 解析成功。spawn、manifest、输出、ready 或提前退出失败都会在 `createDesktopWindow` 前 reject。controller failure 把 timeout classification、exit code、signal、是否使用强制终止、发生阶段、脱敏诊断 tail 和日志路径记录为独立事实；退出码为零不能抹去同时发生的 timeout 或 cancellation。

#### Ready 检测与恢复

生产生命周期限制由一个经过校验的 composition value 提供，使测试可以使用确定性的更短限制。启动共用一个 60 秒总预算。controller 只接受 CLI 权威 stdout 行 `dsh web: http://127.0.0.1:<port>`，使用任务 3 的精确 origin parser 校验，然后以禁止 redirect 的 loopback fetch 获取 index，成功后才发布 endpoint。stderr 文本、不完整行、重复 ready 行、其他 host 或取消后到达的 ready 行都不能让运行进入 ready。

stdout 与 stderr 按增量解码，并限制每个未完成行的字节数。controller 为即时诊断保留脱敏后的 64 KiB tail，并把经过脱敏、限制大小的 generation 日志写到 `<userData>/logs`；只保留当前和上一个后端日志。任何 sink 接收内容前，脱敏会清除名称疑似 credential 的赋值、bearer 值、URL user information 和 secret query value。原生 Open Logs 操作只显示内部构造的日志文件，不接受 renderer 路径。

启动失败或 ready 后后端 crash 会隐藏或销毁陈旧 Web 窗口，并进入唯一的原生恢复循环，其中包含 Retry、Open Logs 和 Exit。Retry 等待完整清理并创建新 generation；由于 loopback origin 已变化，它创建新的安全 Web 窗口，而不是复用绑定旧 origin 的导航 listener。最小原生应用菜单在健康状态提供 Restart Backend、Open Logs 和 Exit，且不包含 reload 或开发者工具命令。不增加 renderer preload 或 IPC API。

#### 关闭与 Windows session end

普通 stop 先关闭诊断 listener，再写入 `shutdown\n` 并关闭 supervisor stdin，随后等待直接进程结果和完整进程树 quiescence。优雅关闭期限到期后，它调用共享的 Windows 进程树终止，并等待确认退出。有界 force-stop 失败时会报告错误，但不会清除所有权或声称进入 `stopped`；Retry 和 Exit 会先重试该清理。这个顺序避免 teardown 后到达的输出或退出 callback 再次打开 dialog。

Electron 第一次触发 `before-quit` 时阻止默认退出，持久化窗口状态并等待 controller stop；只有确认 quiescence 后，带 guard 的第二次 `app.quit()` 才继续。`window-all-closed`、菜单 Exit、启动取消、controller failure 和 restart 都委托给同一个 coordinator，而不各自执行 kill。同步 process-exit fallback 会强制终止仍被拥有的进程树；如果 Electron 在异步清理前消失，supervised-stdin EOF 则为后端提供独立的优雅关闭路径。

Windows 在关机、重启或注销时不会发出 Electron `before-quit` 或 `will-quit`。因此受管窗口在 `query-session-end` 时只为有界 stop 延迟 session end，完成后退出应用；如果 Windows 在 wait 完成前继续，`session-end` 和 process-exit hook 会执行同步的最终进程树终止。重复 session-end 通知保持幂等，且绝不启动新的后端 generation。

#### 窗口状态与持久化文件

窗口 geometry 与 Harness 数据分开存储在 `<userData>/window-state.json` 中，其中包含 schema version、normal bounds 和 maximized 状态。写入先创建随机同级临时文件，再通过 atomic rename 发布。读取时校验整数尺寸和最小值，并要求恢复矩形与当前某个 display work area 相交；无效、屏幕外、link-shaped 或格式错误状态回退到居中默认值。move、resize 和 maximize 变化共享一个 debounce writer，最终退出会在后端 teardown 前 flush。

任务 4 在 restart 或 exit 时绝不删除 `DSH_HOME`、日志或窗口状态。运行时重启复用同一个 home，因此设置、凭据、session 和 attachment 继续可用。安装包升级和卸载时的数据保留仍属于任务 5 验收。

#### 实现顺序与验证

任务 4 先发布并测试 managed-process 子路径和 supervised-stdin 协议，再基于注入的 process、clock、fetch、log、dialog、screen 与 application adapter 实现纯 controller 状态机。随后接入打包 `main.ts`、原生操作、窗口重建和持久化。最后一步在打包组合中替换任务 3 的开发 endpoint，并扩展 Windows artifact job；每一步都保持产品入口可构建。

fake-clock 测试覆盖全部允许 transition、operation 合并、过期 generation 隔离、不完整和超限输出、错误 origin、ready timeout、每个启动点的 cancellation、ready 前后退出、优雅与强制 stop、清理失败、重复 quit 和 callback exception。持久化文件测试覆盖 atomic replacement、损坏、link、display 变化、日志 rotation、字节限制和 credential canary。CLI built 测试证明 `shutdown\n`、EOF、错误输入和忽略 TERM 的 descendant 都达到规定结果。

真实 Windows Electron lane 在没有外部 endpoint 变量的情况下启动打包的任务 2 运行时，验证 `DSH_HOME` 位于安装树外，restart 后切换到新 origin，在 starting 和 ready 后分别关闭，强杀 Electron parent 以触发 supervisor EOF，使后端 crash，并在每个场景后轮询完整进程树。它记录 keyless 健康与恢复 snapshot，以及要求的真实流程 GUI GIF。任务 4 对 Windows session event adapter 做聚焦测试；会破坏会话的真实注销验收保留到任务 6 的干净 Windows 10 和 11 环境。

任务 4 的完成条件是：打包应用不依赖 `DSH_DESKTOP_BACKEND_ORIGIN` 即可进入现有 Web UI；启动始终在预算内进入 ready 或提供有效失败信息；Retry、Open Logs、Restart Backend 和 Exit 不需要 renderer 权限即可工作；窗口状态与 `DSH_HOME` 在 restart 后保留；所有已测试的 close、cancellation、crash、parent death、forced stop 和模拟 session-end 路径都证明没有 owned process 留存。该分支在任务 5 前仍未签名，也没有安装包。

#### 任务 4 实现记录

实现已发布自包含的 `managed-process` 入口，新增有界 CLI stdin supervisor，并把打包后的 Electron main process 接到 staged runtime。桌面控制器负责带 generation 围栏的启动、精确 stdout ready 检测与 HTTP 探测、温和和强制关闭、两代有界脱敏日志、原生启动／运行时恢复、使用新安全窗口完成后端重启、Windows session-end 清理，以及 `userData` 下经过校验的窗口位置。renderer 仍没有 preload 或 IPC surface。

聚焦验证覆盖 32 项桌面单元测试、两项在真实 Loader 树上运行的 built CLI supervised shutdown 用例、workspace constraints、export JSDoc 和定向 lint。全新的 231 个 tarball 安装证明提供了 38 个 Client bundle 与 44 个浏览器资源；由此生成的 Windows runtime 验证了 528 个包位置。真实 Electron replay 连续两次证明唯一 sandboxed 窗口、单实例激活、桌面自有后端启动、重启后切换到新 origin、38 个 Client entry，以及稳定的语义与像素 snapshot。当前 checkout 没有 `.git` 元数据，因此这里无法运行要求 clean worktree 的 GUI GIF 和依赖 git 的 translation-pairing 命令；双语 blob 记录按同一 Git blob 格式计算。任务 5 负责已完成的 ASAR、外部资源、fuse 与安装程序检查。

### 任务 5 Windows 安装程序设计

任务 5 为现有 Forge 包增加 Squirrel.Windows maker，并且只生成 Windows x64 产物：`DeepSeek-Harness-Setup-x64.exe`、一个完整 NuGet 包、`RELEASES` 和 SHA-256 清单。面向用户的名称仍为 `DeepSeek Harness`，NuGet identity 与 AppUserModelID 则使用 Squirrel 所需的不含空格的 `DeepSeekHarness` identity。MSI、delta 包、自动更新和公开发行不属于本任务。

Squirrel maintenance 参数会在 runtime 解析、backend controller 构造、单实例锁获取或窗口创建前处理。维护中的 `electron-squirrel-startup` adapter 为 install、update 和 uninstall 事件创建或移除快捷方式；已处理的调用会直接退出且不接触 `DSH_HOME`。应用代码仍位于 ASAR，sealed runtime、根许可证与生成的第三方声明作为外部资源存在。Electron `userData` 保持在每用户 Squirrel 安装目录之外，任何 uninstall 路径都不会删除它。

开发、pull-request 与 master 验证构建可以不签名。签名构建通过不同环境变量提供一个绝对路径下的普通 PFX 文件及其密码；配置不完整时失败，`DSH_WINDOWS_SIGN_REQUIRED=1` 则在缺少证书时失败。同一个 `windowsSign` 对象同时传给 Packager 与 Squirrel，使应用和安装程序共用 Authenticode 策略，且证书和密码都不会复制到任何产物。

Windows CI 使用任务 2 artifact 创建安装程序，检查 ASAR 与 fuse 状态、外部 runtime 和法律文件、精确的 Squirrel 产物集合与 checksum 清单，并要求符合预期的已签名或未签名 Authenticode 状态。随后把打包应用复制到同时包含空格和非 ASCII 字符的路径，并在那里回放真实 Electron 组合。未签名安装程序作为 workflow artifact 保留七天；干净机器安装、升级、卸载、签名发行和 Windows 10/11 验收由任务 6 负责。

#### 任务 5 实现记录

桌面包使用 Forge 7.11.2 的 Squirrel maker、位于产品应用模块之前的精简 maintenance-only 入口、固定 Windows 产品元数据，以及全有或全无的签名配置。官方 Electron Packager 在 Forge 使用 `--skip-package` 运行 maker 前创建已应用 fuse 的目录包，从而避开 Forge 的 package coordination deadlock，同时保留其 Squirrel 集成。maker 产物根据最终字节生成 checksum，package inspector 也要求两个法律文档与外部 runtime 并存。workspace 允许经过评审的 `electron-winstaller` install 脚本，并修补其 `os.arch()` 调用，使其安装 Squirrel 实际使用的 x64 7-Zip binary，而不是包中有缺陷的通用 alias。

验证覆盖 35 项桌面单元测试，以及由 231 个新 tarball 组成的 Web 组合，其中包含 528 个 staged 包位置、38 个 Client bundle 和 44 个浏览器资源。package inspection 检查 ASAR、hardened fuse、经 manifest 校验的外部 runtime 与法律文件；installer inspection 检查精确的 Squirrel 产物集合、SHA-256 清单、不存在 MSI，以及符合预期的未签名 Authenticode 状态。由于 Node-inspection fuse 保持禁用，hardened packaged smoke 使用仅供测试的 loopback Chromium 调试端点；开发 Electron smoke 则通过原生菜单覆盖后端 restart。最终包在输出目录和包含空格与非 ASCII 字符的复制路径中均通过语义与视觉 snapshot；最终 `--squirrel-obsolete` 可执行文件探针成功退出且没有创建 Harness home。干净机器安装、升级、卸载和签名发行验收仍属于任务 6。

### 任务 6 干净 Windows 发行验收设计

#### 边界与产物身份

任务 6 增加发行验收基础设施与证据，不引入另一套桌面 runtime、installer 格式、updater 或数据迁移层。每次运行消费上游 workflow 生成的任务 5 Squirrel 精确产物集合，在向 guest 复制任何文件前校验 `SHA256SUMS.txt`，并在每份结果中记录候选 installer digest。guest 不 checkout 仓库、不安装构建依赖，也不重新构建候选产物。因此，通过验收的已签名 installer 字节就是允许发布的字节。

验收 controller 在 guest 外部运行，以便重置 image、观察会破坏会话的注销与重启场景、回收结果，并拒绝停止上报的 guest。guest runner 及其带版本的 report schema 随仓库交付，但 controller 只传入 runner、锁定的产物集合和非 secret 场景输入。本任务发现的产品缺陷应在任务 1 至 5 所属 surface 中修复；验收 harness 不得把失败 normalise 掉，也不得增加 desktop-only compatibility shim。

#### 验收环境

强制矩阵使用一次性 Windows 10 与 Windows 11 x64 image，每个候选版本都从封存的干净 snapshot 恢复。每个 image 包含其声明 build 对应的当前产品 prerequisite 和 Windows 更新，但不含 Node、pnpm、Git、仓库 checkout、`DSH_*` 环境变量、模型凭据、既有 DeepSeek Harness 安装或 Harness 数据。交互式测试账号不是管理员，其 profile path 同时包含空格和非 ASCII 字符。controller 记录 Windows edition 与 build、image identity、账号权限状态、开发工具安装探针、locale、architecture，以及运行前 process 与 filesystem baseline。

普通 lifecycle lane 不使用密钥，可以针对明确标识为未签名的开发候选运行。release lane 要求已签名候选、干净且信任有效的 image，以及受保护 workflow 审批。缺少任一 OS image、controller 不可用、snapshot 不干净、出现意外预装工具或跳过强制场景时，release gate 必须进入 blocked 或 failed，而不是成功。GitHub-hosted Windows 2025 job 继续负责构建和结构检查 package；专用一次性 image 负责 Windows 10/11 产品验收。

#### 强制 lifecycle 序列

每个 image 使用一个串行场景负责完整状态转换：校验产物身份与预期 signature policy；以普通用户身份无提权安装；通过已注册产品状态与快捷方式发现当前 Squirrel 安装位置，而不是猜测带版本的路径；从已安装快捷方式启动；并等待现有 Web UI。场景证明即使端口 3080 已被占用，server 仍使用随机 loopback 端口，拒绝非 loopback listener，并把 `DSH_HOME`、日志和窗口状态保留在 install tree 之外。

在不存在凭据时，该 lane 检查有用的缺失凭据行为、离线启动、renderer 隔离、全部 38 个已打包 Client entry、在同时包含空格和非 ASCII 字符的路径下选择目录，以及 keyless 真实组合 replay。随后创建应用可见的 session 与 settings canary，重启后端，退出并重新启动应用，并要求仍可读取相同 canary。聚焦场景继续覆盖 filesystem 操作、PowerShell/subprocess 执行、Worker Thread workflow、后端失败与恢复、强制终止 Electron，以及 Windows 注销。每个退出边界之后，外部 controller 都等待到不存在由应用派生或归属于应用的进程。

升级步骤先安装版本较低且已验收的 predecessor，创建 opaque 数据 canary，通过受支持的 Squirrel 路径应用候选版本，并证明候选 executable 替换 predecessor、install tree 不含持久化数据且 `DSH_HOME` 字节保持不变。在首个 tagged release 之前，可以使用同一 runtime 的受控低版本 package 证明 Squirrel replacement mechanics；这不代表兼容旧的 pre-release session schema。存在已验收发行版后，其已发布产物成为 predecessor。拒绝过期 pre-release 数据格式仍是有效产品行为，并与文件是否得到保留分别报告。

卸载通过 Windows 注册的 uninstall entry 运行，而不是直接删除目录。它必须删除快捷方式、注册信息、带版本的 application tree、installer 所有的 executable 和运行中进程，同时保留 `DSH_HOME`、desktop 日志和窗口状态。重新安装同一已验收候选后必须重新发现保留的 canary。之后由 controller 丢弃一次性 image，而不是让产品 uninstaller 学会删除用户数据。

#### Provider、签名与 secret 处理

已签名 release lane 首先要求 `Setup.exe` 与已安装 application executable 的 Authenticode 状态有效、publisher identity 符合配置，并带有受信 timestamp。签名发生在上游；PFX 及其密码都不进入验收 guest 或 artifact bundle。文件传输后与安装后都重新校验 signature，避免受信的外层 installer 隐藏未签名或被修改的 application executable。

一个受保护的 Windows 11 运行通过已安装 Web UI 完成一次真实 DeepSeek provider 对话，在应用重启后验证稳定的 transcript marker，并在同一用户 session 中执行已打包的 filesystem、PowerShell 与 Worker Thread 路径。credential 只在该次运行中通过受支持的产品 credential path 注入，使用尽可能小的 scope 与 lifetime，并在丢弃 snapshot 前移除。唯一 credential canary 必须不存在于 desktop 日志、验收 JSON、截图、process command line、environment capture、crash diagnostics、`DSH_HOME` export 和上传 artifact 中。provider 不可用时记为失败或明确可重跑的 protected check；keyless 操作系统矩阵保持独立可诊断。

#### 证据约定与 CI 拓扑

每个 guest 生成有界 machine-readable report 和 JUnit projection。report 包含 schema 与 runner version、installer 与 NuGet digest、signature result、OS 与账号 attestation、发现的 install 和 data root、scenario timestamp、观察到的 loopback endpoint、canary hash、process-tree identity、运行前后 filesystem delta，以及每项强制 assertion 的结果。截图覆盖安装后首次启动、缺少凭据、恢复的 session 和升级后启动。成功与失败都附带脱敏后的 application log、Windows event 摘要、process 与 listener snapshot；禁止上传原始 registry export、完整 environment dump、credential 和无限制 user data。

专用 release-acceptance workflow 按 workflow identity 下载任务 5 artifact、校验 digest，并为每个一次性 image 分派一个串行 job。pull request 可以运行未签名 Windows 11 lifecycle lane 以获得快速反馈；master 候选运行完整的未签名 Windows 10/11 矩阵；受保护 release-candidate dispatch 运行已签名 Windows 10/11 矩阵与真实 provider 检查。release job 依赖精确的已签名验收报告，不发布重新构建的替代品。release candidate 的报告随发行证据保留，普通未签名诊断沿用现有短期 retention。

任务 6 在一个 PR 内按四个可评审 slice 实现：定义 report schema 与纯结果 validator；实现带确定性 cleanup 的 guest lifecycle runner；接入 guest 外 image controller 和 Windows 10/11 矩阵；最后增加受保护的签名/provider lane 与双语 release runbook。完成条件是：同一候选 digest 获得两份干净 image 报告、已签名 Windows 10/11 矩阵通过、受保护的真实对话通过、install-to-uninstall 证据完整、用户数据得到保留、孤儿进程为零，并且没有跳过任何强制 assertion。只有到达该状态后，本提案才移动至 `implemented`，同时记录实际 image identity、workflow 名称和保留的证据。

#### 任务 6 基础设施实现记录

仓库包含带版本的验收报告 parser 与 fail-closed 集合 validator、使用候选版本内置 Node 运行的 CDP-only 已安装应用探针、交互式 guest lifecycle runner，以及在 session-exit 和 install-to-uninstall 阶段前恢复配置封存 snapshot 的 Hyper-V controller。controller 要求精确的 VM 与 snapshot、受 DPAPI 保护的 PowerShell Direct credential，以及预先配置的交互式 scheduled task。guest 校验 artifact hash、干净账号属性、Authenticode 状态、安装、快捷方式、loopback 与 renderer 隔离、Client 清单、重启持久性、升级、卸载、重新安装、数据保留、secret 缺失和 process quiescence。另一个破坏性阶段会终止已打包后端、重新启动应用、注销用户，并让 controller 从用户 session 外验证没有残留进程。

release workflow 可以生成全有或全无的已签名桌面 artifact，且 PFX 不会离开 runner 临时存储。专用 acceptance workflow 消费精确的候选与 predecessor run artifact，分派 Windows 10 和 Windows 11 controller job，保留失败证据，并校验组合后的已签名矩阵及可选的受保护 Windows 11 Provider report。双语发行手册负责 controller provisioning、environment 保护、dispatch 与 publication procedure。

基础设施本身不构成发行证据。在配置完成的 Windows 10/11 controller image、发行证书、已验收 predecessor artifact 和受保护真实 UI Provider driver 为同一个已签名候选 digest 生成通过报告之前，本提案保持 `proposed`。手工编写的 Provider JSON 不能作为验收证据。

### Completion criteria

- 普通用户无需仅管理员可完成的准备、Node、pnpm、仓库 checkout 或终端，即可安装并启动签名发行版。
- 打包后的应用通过现有 Web UI 完成一次真实模型对话，并在重启后恢复会话。
- 运行时从打包文件解析每个随附的 profile 配置项和 Client 插件，不依赖仓库路径、workspace 链接或联网安装。
- 关闭、重启、崩溃或注销后，不留下受管 Node、PowerShell、Worker、终端或沙箱进程。
- 安装、升级和卸载绝不把持久化数据写入安装目录，且默认不删除 `DSH_HOME`。
- 安装包不包含凭据、`.env`、源码树、测试 fixture、缓存或未纳入 manifest 的可执行文件。
- 浏览器代码没有 Node 访问能力，不能让应用窗口离开受管 loopback origin，也不能让服务器暴露到 loopback 之外。
- Windows 10 和 11 x64 干净机器验收覆盖含空格路径和非 ASCII 用户名并通过。
- 包 README、用户文档、维护说明、许可证、Agent Note 和相关快照，在需要时以双语说明已发布行为。

## Alternatives considered

**保留仅限 CLI 的 `dsh web` 安装。** 这能保持当前架构，但用户仍需准备 Node 和 NPM 包并管理终端，因此不满足桌面发行目标。

**使用 Electron 内置 Node 运行 Harness。** 这能少携带一份运行时，但 Electron 会改变 `process.execPath`，并遵循 Electron 的 Node/ABI 生命周期。Harness 及其子进程路径需要普通 Node 可执行文件。固定的独立 Node 运行时保留这些假设，并将 Harness 引擎支持与桌面 shell 解耦。

**使用带 Node sidecar 的 Tauri。** Tauri 能减小浏览器 shell 体积，但此应用仍需要完整 Node Host 和动态 NPM 包图。Node sidecar 仍须管理，并会增加 Rust/WebView2 打包范围，却没有消除主要运行时工作。

**在 Electron 中直接加载静态文件。** Vite shell 需要 `window.__DSH_BOOT__`、动态提供的 Client 插件 bundle 和本地 API 传输。`file:` 页面会绕过现有 Web 组合方式，并产生第二套启动和传输设计。

**打包整个 monorepo。** 这便于制作原型，但会携带源码、测试、开发依赖、缓存和 workspace 链接，形成庞大且不确定的安装包，并掩盖缺少生产声明的问题。经 manifest 校验的生产闭包会明确暴露遗漏和意外加入。

**内置 Git、Python、编译器和语言服务器。** 这些工具随用户和工作区变化，会把桌面安装包变成通用开发环境。本提案只保证 Harness 运行时，并通过现有能力诊断报告不可用的外部工具。

**所有桌面 stop 只使用 `taskkill /T /F`。** 这能强制终止 Windows 进程树，但会跳过 CLI 的 Cordis dispose，可能中断 session 持久化或其他清理。supervisor stdin 先提供有序请求，并保留 taskkill 作为有界 fallback。

**增加用于 shutdown 和 restart 的 loopback 管理 endpoint。** 这会在产品 API 之外增加需要身份验证的第二套外部可达控制协议。继承的 stdin pipe 已能证明父进程所有权，会随父进程自动关闭，而且不暴露 renderer 或网络入口。

**在 `apps/desktop` 内实现另一套进程树 supervisor。** 仓库的 local-subprocess 实现已经拥有 Windows taskkill、退出观测、输出限制、环境清理和 quiescent wait。发布其 managed-process 原语可避免两套清理算法产生细微差异。

**构建带 preload 和 IPC 操作的恢复 renderer。** 本地失败页面能提供更丰富的展示，但会为三个固定操作增加另一种 renderer、导航类型、preload、IPC 授权策略和 snapshot 范围。原生 dialog 与菜单把 restart、logs 和 exit 保持在 main process 内。

## Acceptance criteria

- 在 `apps/desktop` 产品代码落地前，任务 1 生成可重复的 workspace 外启动证据和经过评审的闭包清单。
- 任务 2 生成 staged 运行时；删除必需资源或出现禁止的敏感／开发文件时，其 manifest 和冒烟测试失败。
- 任务 3 证明单实例行为、BrowserWindow 隔离、精确 origin 导航策略、外部链接委托和 staged Web 应用加载。
- 任务 4 证明有界启动、有效失败诊断、重启、持久化 `DSH_HOME`，以及每个受管生命周期退出路径上的完整清理。
- 任务 5 生成可安装的 Windows x64 `Setup.exe`；安装后的应用以普通用户身份运行，不依赖全局 Node 或 pnpm，并在升级和卸载后保留用户数据。
- 任务 6 记录 Windows 10/11 从安装到卸载、一次真实提供方对话、打包工具和 worker、数据持久化、路径变体及无孤儿进程的干净机器证据。
- 每项非平凡可见变更都具备[测试策略](../../../../docs/testing.md)要求的无 key 真实组合或浏览器快照，每个 PR 都运行 [dsh-pre-push-checks](../../../../.agents/skills/dsh-pre-push-checks/SKILL.md)选择的聚焦检查。

## Risks

- **动态依赖遗漏。** Cordis 在运行时解析包名和 Client 资源；依赖可能成功编译却没有进入安装包。闭包 manifest 和 staged 冒烟测试必须执行发布 profile，不能根据 TypeScript import 推断完整性。
- **进程树泄漏。** PowerShell、worker、终端、沙箱、subagent 和用户命令可能比其直接父进程存活更久。桌面关闭必须使用仓库的进程树所有权机制，并在 Windows 上证明完全停稳。
- **Node 版本漂移。** 仓库引擎范围和固定桌面运行时可能分离。发布检查必须拒绝不受支持的 Node 版本，并验证其校验和与许可证。
- **ASAR 与路径行为。** 不能假设可执行文件和动态解析包在 ASAR 内运行；空格、非 ASCII 字符、移动和只读安装目录可能暴露隐藏路径假设。
- **未签名发行警告。** 内部构建可以不签名，但公开 Windows 发行在安装包签名前可能触发 SmartScreen。签名凭据必须置于仓库和日志之外。
- **凭据泄漏。** 环境构造、子进程输出、崩溃诊断、manifest 和安装包输入可能意外捕获模型凭据。测试必须证明打包文件不含 secret，桌面日志经过脱敏。
- **自包含承诺歧义。** 用户可能期待内置所有开发工具。产品文档必须区分自包含 Harness 运行时和特定任务需要的可选外部命令。
- **预发布格式变更。** 首个 tag 前，profile、存储或会话格式可能变化。桌面升级测试必须遵循仓库当前的拒绝和版本策略，而不是在 shell 中增加兼容 shim。
