# memoQ AI Hub

[English](README.md) | [简体中文](README.zh-CN.md)

## 项目概述

`memoQ AI Hub` 是一个面向 memoQ 的本地桌面网关，用来承接 AI 翻译相关流程。

项目采用“薄 DLL + 本地 Electron 桌面端”的结构：

- memoQ 插件 DLL 只负责 memoQ SDK 对接和本地请求转发。
- 桌面端负责 Provider 配置、Profile 构建、术语资产、历史记录、缓存、安装诊断和打包发布。

这样可以把变化较快的 AI 逻辑从 memoQ 插件中剥离出来，降低调试和维护成本。

## 当前版本实际启用的能力

当前桌面端真正对操作人员开放的模块是：

- `概览`：安装或重装 memoQ 集成、查看运行状态和更新状态。
- `AI 服务`：配置 OpenAI 或 OpenAI-compatible Provider，测试连通性并管理可用模型。
- `设置`：创建翻译 Profile、选择执行路由、绑定术语和 Custom TM 资产、筛选 TM 匹配区间、配置术语策略和可选上下文，并在本地测试已保存方案的资产，无需调用模型。
- `项目规则`：按客户、领域、主题、项目、语言对、文档正则表达式或句段状态，将 memoQ 项目路由到已保存的 Profile，并可在翻译前测试匹配结果。
- `资产`：导入并预览 glossary、TB、TMX 和表格格式的 Custom TM 资产。支持按语言名称配置多语言术语栏位，一份表复用于不同语言对，以及搜索、重命名和绑定翻译方案。
- `翻译记录`：按原文、译文或请求编号搜索，逐句查看原译文、命中术语、资产指纹、模型及缓存信息和术语检查结果；支持选择已保存的方案重新翻译并对比结果，也可查看提示词诊断、导出或删除记录。
- `质量检查`：检查当前 Preview 句段，查看和导出本地 QA 历史，管理 QA/翻译/润色提示词预设，打开翻译/润色与 QA 双模式助手，并只读检查 MQXLIFF/XLIFF 文件。
- `日志`：查看本地诊断日志、打开日志文件、清理旧日志，并复制简短的排查摘要。

仓库里确实包含一些更底层的运行时能力，但当前版本并没有把所有内部模块都做成独立页面。本文档描述的是“当前交付界面”，不是所有内部实现细节。

## 当前版本亮点

**v1.0.53** 修复中日韩术语与数字相邻时的漏匹配，新增可选严格术语检查、逐句资产证据、本地资产测试和重新翻译对比。可将翻译结果信息中的编号粘贴到插件 Options 窗口，打开对应的 Hub 记录。参见 [发布说明](docs/release-notes/v1.0.53.md) 和 [使用说明](docs/reference/translation-evidence.md)。

**v1.0.52** 修复六项依赖安全告警，Windows 构建升级到 Electron Forge 8，无需迁移设置。详见[版本说明](docs/release-notes/v1.0.52.md)。

**v1.0.51** 支持多语言术语表复用、按语言名称配置栏位、无表头导入，以及资产直接绑定和重命名。详见[版本说明](docs/release-notes/v1.0.51.md)。

**v1.0.50** 桌面界面升级到 Ant Design 6 和 React 19，并接入 LangLink 统一的 antd kit：次要文字满足 WCAG 对比度底线，支持系统高对比度、降低透明度和强制颜色设置。插件合约和数据库 schema 不变。详见[版本说明](docs/release-notes/v1.0.50.md)。

**v1.0.49** 为更新清单、下载资源和持久化更新状态，以及 sql.js 数据库句柄补上类型。更新和存储行为不变；便携版准备更新时如果清单资源缺失，会按完整性失败关闭。详见[版本说明](docs/release-notes/v1.0.49.md)。

**v1.0.48** 用共享 domain 类型描述预览 helper 的 part/segment，以及 memoQ 集成安装选项。匹配行为、插件合约和数据库 schema 不变。详见[版本说明](docs/release-notes/v1.0.48.md)。

**v1.0.47** 把 desktop runtime 组合根里的产品行为拆到独立 owner，并把 runtime、数据库、集成、预览 helper 和更新服务纳入 strict 类型检查。memoQ 插件合约和数据库 schema 不变。详见[版本说明](docs/release-notes/v1.0.47.md)。

**v1.0.45**完善了并发配置保存和凭据恢复，修复了概览轮询中的进度状态，并优化了编辑保存保护、资产预览恢复、键盘操作和减少动态效果。详见[版本说明](docs/release-notes/v1.0.45.md)和[架构与 UI/UX 审查记录](docs/audits/2026-09-12-architecture-uiux.md)。

`v1.0.40` 汇总了 `v1.0.20` 以来的产品、性能、安全、可靠性和打包改进：

- “项目规则”现已将已有的元数据路由引擎开放为完整操作流程：支持新增、编辑、复制、启用、停用、删除、查看命中次数，并使用 memoQ 项目元数据测试规则。
- Profile 可绑定上传的 TMX 或表格格式 Custom TM，并选择发送给 AI 的 `AI Hub TM score` 区间。带上下文的 TMX 命中最高可达 `101%`，memoQ 自带的模糊匹配提示仍作为独立参考。
- 五步设置流程、响应式导航、未保存修改保护、键盘可访问控件和聚焦后的翻译记录视图，让日常配置与诊断更清晰。
- 通过延迟加载和打包清理降低启动内存与包体积，同时保留标准 ZIP 和体积更小的 7z 便携包。
- 本地网关仅监听 loopback，更新链接只接受 HTTPS，应用管理的下载会在启动前按 SHA-256 校验。
- 本地数据库现在通过校验后的原子替换提交，并保留上一代有效恢复备份；非法或超限的网关请求会返回稳定 JSON 错误。
- 独立服务和 worker 本地模式不再生成可逆凭据文件，运行时基准也已明确按生产 worker 组合测量。
- Renderer 的刷新、轮询、历史详情和 Shell 生命周期已经收敛到专用 hooks，CI 也从保留 React Hooks 警告升级为拒绝任何 ESLint warning。
- 桌面 worker 请求设有明确超时，Windows 安全存储不可用时 Provider 凭据保存会失败关闭，CI 同时执行静态分析。
- Electron 与桌面端依赖已升级到持续安全维护的版本；只有源码构建需要 Node.js 22.13 或更高版本。
- 仓库和发布包不再包含 memoQ SDK 二进制、AddinSigner 或官方 SDK 示例；源码构建只会将两个必要的编译期程序集解析到 Git 忽略的本地缓存。
- memoQ 插件与本地网关现在会在首次请求前互相校验共享契约版本，网关 POST 请求体会先做轻量形状校验，本地数据库也引入了版本化的 schema 迁移。
- 渲染层应用壳已拆分为聚焦的页面域 hooks 与组件，渲染层 IPC 面由 preload 与 main 共享的单一表生成，runtime 也补齐了显式依赖的历史呈现与状态视图服务。
- 严格类型检查（JSDoc 注解 + `tsc --noEmit`）现已覆盖共享契约层、QA 与双语模块、完整的资产解析层、provider 配置/治理/响应/传输/提示词构建/注册表模块及渲染层 IPC 面，通过 `pnpm run typecheck` 与 CI 步骤执行。

## 运行时结构

- `native/plugin/`：memoQ MT 插件实现和相关打包资源。
- `apps/desktop/`：Electron 桌面端、本地 worker、渲染层 UI 和本地网关。
- `native/preview-helper/`：为文档级上下文提供支持的预览辅助程序。
- `packages/contracts/`：桌面端与插件之间共享的契约定义。

## 请求链路

1. memoQ 调用本地插件 DLL。
2. DLL 将请求标准化后转发到本地桌面网关 `http://127.0.0.1:5271`。
3. 桌面端运行时解析当前 Profile 和 Provider 路由。
4. 运行时按配置组装上下文，包括 Profile 设置、元数据、TB 资产、预览上下文、TM 提示和缓存策略。
5. 运行时按当前术语检查符合复用条件的缓存结果，或调用选定的 OpenAI 或兼容接口。
6. 运行时执行术语检查并保存逐句资产证据。提醒模式返回译文并提示问题；严格模式拒绝不合规句段，并可按配置尝试一次修复。不合规结果不写入缓存。
7. 插件接收结果及历史记录定位信息；新版插件不会对术语策略拒绝的句段继续尝试其他格式重译。

当用户在 memoQ 中确认译文后，`StoreTranslation` 也会把确认结果回写到桌面端，供后续自适应缓存复用。

## 当前实际操作顺序

当前 Dashboard 和整体用户流程已经围绕下面的顺序组织：

1. 安装或修复 memoQ 集成。
2. 连接并测试 AI 服务。
3. 按需上传术语或翻译记忆资产。导入多语言表时，按语言名称配置各栏位并确认预览。
4. 在“翻译方案”中创建并保存 Profile，使用“测试资产”输入示例原文和语言对，在调用模型前确认匹配结果。
5. 按需添加并测试“项目规则”，根据 memoQ 项目元数据选择 Profile。
6. 在 memoQ 中执行翻译并查看翻译记录。

如果是首次部署，请按这个顺序操作，这与当前版本的实际界面保持一致。

## 查看术语和翻译是否生效

先在**设置 → 测试资产**中，检查已保存方案能否为指定语言对匹配预期术语。测试在本地完成，不调用模型。配置好对应语言栏位后，一份多语言术语表可用于多个语言对，也支持反向翻译。

翻译后打开**翻译记录**，逐句查看命中了哪些术语、资产是否发送给模型，以及返回的译文是否通过术语检查。资产停用、语言对不适用、未命中、资产错误和历史证据缺失会分别显示。术语检查通过不代表整体翻译质量合格；缓存结果也无法还原最初生成时的模型调用证据。

默认模式返回译文并提示术语问题，严格拒绝和额外修复需主动开启。**使用当前方案重新翻译**会采用当前已保存的配置、绕过缓存，可能产生模型费用，并保存关联记录供新旧对比；原记录和 memoQ 中的译文均会保留。

从 memoQ 查找记录时，复制翻译结果信息中的 **Hub record** 编号，粘贴到插件 **Options** 窗口，再点击 **View translation record in Hub**。入口位于插件选项窗口，不是 memoQ 编辑器中的自定义工具栏按钮。

详细操作见[使用说明](docs/reference/translation-evidence.md)，已验证范围见[验收记录](docs/specs/translation-evidence/verification.md)。v1.0.53 已通过 Windows 构建、发布包检查及本地界面验收；已获得许可的 memoQ 实际运行、Windows 安装版和便携版的记录跳转仍需实机验收。

## 升级注意事项

- memoQ 使用本地网关时，请保持 memoQ AI Hub 桌面端运行。
- 在 Windows 上启动一次新版 Hub，以注册记录跳转。便携版移动目录后，先从新位置启动 Hub，再使用插件跳转入口。
- v1.0.53 保留已有设置和历史记录，无需数据库迁移。旧记录未保存的资产证据会明确显示为不可用。
- 如果之前已经安装过旧版本 memoQ AI Hub 插件 DLL，升级桌面端后仍需要在 Dashboard 点击 **Install / Reinstall**，让 memoQ 收到最新的 `MemoQ.AI.Hub.Plugin.dll`。
- 重新安装集成后请重启 memoQ。memoQ 会在启动时加载插件 DLL，已经运行的 memoQ 可能仍在使用旧 DLL。
- 如果手动安装，请替换 memoQ `Addins` 目录中的 `MemoQ.AI.Hub.Plugin.dll`，然后重启 memoQ。

## 本地开发

仓库不包含 memoQ SDK 二进制文件。插件构建会从 memoQ 官方文档站下载固定的 memoQ MT SDK 2.4.4，校验 SHA-256，并仅将两个编译期程序集提取到 Git 忽略的 `.memoq-sdk/` 缓存。如果需要使用自行管理的 SDK 或 memoQ 安装目录，可将 `MEMOQ_SDK_DIR` 指向同时包含 `MemoQ.Addins.Common.dll` 和 `MemoQ.MTInterfaces.dll` 的目录。

使用 SDK 前请阅读 [memoQ EULA](https://www.memoq.com/legal/end-user-license-agreement/)。下载 SDK 文件不会使其自动适用本仓库的 MIT 许可证。

`pnpm run test:plugin` 是运行时回归测试，需要本机已获得许可的 memoQ 安装。脚本会自动查找标准安装目录，也可通过 `MEMOQ_RUNTIME_DIR` 指定安装目录。

在仓库根目录安装依赖并构建：

```powershell
pnpm install
pnpm run install:desktop
pnpm run build:plugin
pnpm run test:plugin
pnpm run prepare:release
```

运行测试：

```powershell
pnpm run test:desktop
pnpm run test:repo
```

启动桌面端：

```powershell
cd apps/desktop
pnpm start
```

默认本地网关地址：

```text
http://127.0.0.1:5271
```

## 打包

常用打包命令：

```powershell
pnpm run package:desktop
pnpm run zip:desktop
pnpm run package:windows
```

常见产物包括：

- `native/plugin/MemoQ.AI.Desktop.Plugin/bin/Release/net48/MemoQ.AI.Hub.Plugin.dll`
- `apps/desktop/out/memoq-ai-hub-win32-x64.7z`（体积最小的便携归档）
- `apps/desktop/out/memoq-ai-hub-win32-x64.zip`（兼容归档）
- `apps/desktop/out/make/**/*.exe`

## 相关文档

- 术语与翻译证据：[docs/reference/translation-evidence.md](docs/reference/translation-evidence.md)
- 用户指南：[docs/user-guide.zh-CN.md](docs/user-guide.zh-CN.md)
- 英文用户指南：[docs/user-guide.md](docs/user-guide.md)
- 仓库结构说明：[docs/repository-structure.md](docs/repository-structure.md)

## 许可证

LangLink 有权授权的部分采用 MIT 许可证。详见 [LICENSE](LICENSE)、[LICENSE_SCOPE.md](LICENSE_SCOPE.md) 和 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。memoQ SDK 材料和商标不在 MIT 授权范围内，本项目也不是 memoQ 官方产品。
