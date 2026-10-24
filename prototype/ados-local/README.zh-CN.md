# ADOS Local — 完整原型源码

[English](README.md) · [ADOS 总览](../../README.zh-CN.md) · [发布前验证记录](review/OWNER_REVIEW.md)

本目录包含 ADOS Local 完整可执行原型源码：TypeScript 协调器、SQLite 事件存储与六份迁移、交付编译器与校验器、执行／Forge 适配器、浏览器扩展、Windows Native Host、测试和九份固定协议快照。这是从审阅报告指定的固定实现快照导出的独立脱敏副本，不包含私有 Git 历史、历史任务／批准记录、设备身份、凭据或运行数据库。

**状态：完整原型源码已公开。** Owner 已于 2026 年 10 月 25 日审阅候选 `75f5c44a5aa2cd894bd6c62c2efab547255f136d` 并批准公开发布。可复现范围是离线合成路径。本发行副本尚未完成真实产品 Dogfood，也未重新完成 Windows／Chrome／Codex／GitHub 端到端验证。源码发布批准不等于生产可用或真实产品验收。

审阅报告、文件清单和演示输出保留已验收候选的发布前状态，包括当时的 OWNER_REVIEW 表述。本次发布仅修改入口 README 和 STATUS；已验证实现与依赖锁文件保持不变。见[当前状态](../../docs/STATUS.md)。

**依赖修复：** 本轮按批准范围，仅在锁文件中将间接依赖 `fast-uri` 从 `3.1.5` 更新至 `3.1.9`。已重新完成干净安装与完整回归，验证时 `npm audit` 报告 **0 个已知漏洞**。这不等于安全认证；Windows 实机集成和真实产品 Dogfood 仍未验证，详见审阅报告。

## 已包含的实现

| 源码位置 | 职责 |
| --- | --- |
| `src/compiler`、`src/capture`、`src/intake` | 选中消息采集、不可信模型输出校验、交付卡片、签名确认与持久化接收 |
| `src/storage`、`migrations` | SQLite 事务、追加事件、投影、租约、fencing、outbox、备份与恢复 |
| `src/coordinator`、`src/profiles`、`src/resolver` | 有界执行、固定项目／主机身份、Forge 回读与核对 |
| `src/safety/slice4`、`src/verifiers` | 身份／授权／范围漂移拒绝、从证据推导安全卡片、独立验证进程 |
| `browser-extension`、`native-host`、`scripts` | Chrome 侧栏、选中消息解析、Native Messaging 与 Windows 注册 |
| `vendor/ados`、`test` | 固定协议文件与实现回归测试 |

原架构和权限检查保留。发行改动仅涉及合成身份、对应版本／摘要、安装绑定、平台专属测试声明、已批准的 `fast-uri` 补丁升级和说明文档。具体差异及排除文件见 `review/`。

## 运行离线原型

使用 **Node 22.23.1**、npm **10.9.x** 和 Git。`better-sqlite3@12.11.1` 是唯一原生扩展，必须使用官方兼容预编译包；没有兼容包就停止，不以本地 `node-gyp` 编译替代固定运行环境。

在本目录的 PowerShell 中执行：

```powershell
npm ci --ignore-scripts
Push-Location node_modules/better-sqlite3
node ../prebuild-install/bin.js
Pop-Location
npm run typecheck
npm run build
npm test
node --test "browser-extension/*.test.js"
npm run verify:contracts
npm run demo:walking-skeleton
```

Linux 将 `Push-Location ...`／`Pop-Location` 分别替换为 `cd node_modules/better-sqlite3`／`cd ../..`。上一条成功后再执行下一条。单独调用 `prebuild-install` 不会退回本地原生编译；`npm ci --ignore-scripts` 不执行依赖安装钩子。保留 `package.json`、`package-lock.json` 和 `.node-version` 原样。

使用干净检出和新的 `.ados-local/`。不要复制私有安装中的数据库、设备密钥或批准记录。公开绑定版本带有 `-public.1` 后缀；其迁移校验和与身份刻意区别于私有安装。本副本不用于迁移旧 Run。

walking-skeleton 使用假执行器，但会真实运行 SQLite 事务和独立验证进程。它先到达 `OWNER_REVIEW`，再通过明确标记的**模拟 T4 验收**到达 `DONE`。最后的状态只属于合成 Fixture；JSON 证据位于 `.ados-local/evidence/`，没有真实 Objective 被验收或发布。

其他离线命令包括 `demo:duplicate`、`demo:crash-recovery`、`demo:forged-approval`、`demo:false-completion`、`demo:cancel`、`demo:scope-violation`、`demo:invalid-transition`、`demo:storage-integrity`、`demo:storage-rebuild` 和 `demo:storage-backup-restore`。

## Fixture 与环境隔离

`fixtures/public-bindings.json` 提供合成 capture／candidate／request／card 记录及固定摘要的预像，不含设备秘密、签名 Challenge Token 或真实批准。测试使用原生产校验器和记录生成函数重新计算绑定。Git 风格的合成修订标识只是 Fixture 身份，不代表远端存在这些提交。

`fixture.invalid/...` 引用刻意不连接真实仓库；本包不会创建 GitHub 仓库。原 Forge 对唯一固定**私有** Fixture 仓的限制仍保留。源码公开不授权向公开仓库写入，改变这项限制仍需单独决定。

九份协议快照的 Git blob 内容保持不变。原 manifest 摘要对应 CRLF 检出字节，`.gitattributes` 在各平台明确保留该格式，解压分发包时也必须保留换行。manifest 中历史批准／安装元数据已移除，协议版本和文件摘要未改。

## Windows 集成限制

集成 Native Host 仍限定 **Windows x64／Node 22.23.1**，使用 Chrome Native Messaging 和 `HKCU` Registry64。注册继续拒绝管理员进程、安装碰撞和路径漂移。公开 Fixture 使用独立扩展公钥／origin 与 Host 名，不复用私有安装身份。

固定安装位置是 `C:\ADOS-Public-Fixture\prototype\ados-local`。预期 manifest 在 `fixtures/public-native-host-manifest.json`，其字节与 launcher 字节已固定到 admission。移动目录会被拒绝；这只是明确的 Fixture 布局，不是通用安装器或跨设备可移植方案。

离线快速体验无需运行 `native:slice3a-register`。它会写入当前用户注册表，并要求固定 Windows 布局；对应卸载命令是 `native:slice3a-unregister`。本发行尚未验证注册操作或真实 Chrome → Host 通路。

实时编译器／执行器保留精确 Codex 二进制和版本检查：后期路径使用 `codex-cli 0.147.0-alpha.1.2`，早期路径使用 `0.146.0-alpha.9.2`。本发行没有证明这些二进制的可获取性和行为。未知二进制继续被拒绝，没有加入自动升级或“首次看到即信任”。

`demo:gate0a`、`demo:gate0a-card`、`demo:gate0b`、`demo:slice2*`、`demo:slice3b-dispatch/resume`、`demo:slice4-safety-card` 和历史 `reports` 命令**不是离线安装步骤**。它们需要相应真实环境／证据，部分执行路径在授权后具有 Git／GitHub 写入副作用。替换为非实时 Fixture 引用并不会让它们自动可运行。`demo:gate0s`／`verify:storage` 保留 Windows 二进制门槛。

## 证据能说明什么

准确环境、命令、退出码、测试数量、跳过项和限制见 [OWNER_REVIEW.md](review/OWNER_REVIEW.md)。Linux 验证覆盖本地存储／恢复、生产拒绝函数、语义校验、解析 Fixture 和消息 framing。注入编译器、构造的 Forge 观察和安全卡片输入均为合成数据，不能当作实时提供方或 Windows 运行结果。

首次真实产品 Dogfood、当前 ChatGPT 页面上的真实采集、Windows 进程树取消、Codex 执行到 Forge 发布的端到端路径、通用可移植性和减少人工负担的效果，仍未验证。[威胁模型](docs/THREAT_MODEL.md) 说明实现中的控制意图，不是独立安全认证。

## 许可

纳入本仓库的项目代码与文档适用 [Apache-2.0](../../LICENSE)。依赖保留各自许可，源码发行不捆绑依赖。私有历史、排除的记录和外部论文不属于本次授权。`package.json` 保留 `private: true`，防止意外发布到 npm。
