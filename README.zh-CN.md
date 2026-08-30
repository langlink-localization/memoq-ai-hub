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
- `设置`：创建翻译 Profile、选择执行路由、绑定术语和 Custom TM 资产、筛选 TM 匹配区间，并配置可选上下文能力。
- `项目规则`：按客户、领域、主题、项目、语言对、文档正则表达式或句段状态，将 memoQ 项目路由到已保存的 Profile，并可在翻译前测试匹配结果。
- `资产`：导入并预览 glossary、TB、TMX 和表格格式的 Custom TM 资产。
- `翻译记录`：查看翻译记录、Custom TM 命中、提示词和诊断信息，并支持导出或删除记录。
- `质量检查`：检查当前 Preview 句段，查看和导出本地 QA 历史，管理 QA/翻译/润色提示词预设，打开翻译/润色与 QA 双模式助手，并只读检查 MQXLIFF/XLIFF 文件。
- `日志`：查看本地诊断日志、打开日志文件、清理旧日志，并复制简短的排查摘要。

仓库里确实包含一些更底层的运行时能力，但当前版本并没有把所有内部模块都做成独立页面。本文档描述的是“当前交付界面”，不是所有内部实现细节。

## 当前版本亮点

`v1.0.37` 汇总了 `v1.0.20` 以来的产品、性能、安全、可靠性和打包改进：

- “项目规则”现已将已有的元数据路由引擎开放为完整操作流程：支持新增、编辑、复制、启用、停用、删除、查看命中次数，并使用 memoQ 项目元数据测试规则。
- Profile 可绑定上传的 TMX 或表格格式 Custom TM，并选择发送给 AI 的 `AI Hub TM score` 区间。带上下文的 TMX 命中最高可达 `101%`，memoQ 自带的模糊匹配提示仍作为独立参考。
- 五步设置流程、响应式导航、未保存修改保护、键盘可访问控件和聚焦后的翻译记录视图，让日常配置与诊断更清晰。
- 通过延迟加载和打包清理降低启动内存与包体积，同时保留标准 ZIP 和体积更小的 7z 便携包。
- 本地网关仅监听 loopback，更新链接只接受 HTTPS，应用管理的下载会在启动前按 SHA-256 校验。
- 本地数据库现在通过校验后的原子替换提交，并保留上一代有效恢复备份；非法或超限的网关请求会返回稳定 JSON 错误。
- 独立服务和 worker 本地模式不再生成可逆凭据文件，运行时基准也已明确按生产 worker 组合测量。
- Renderer 的刷新、轮询、历史详情和 Shell 生命周期已经收敛到专用 hooks，CI 也从保留 React Hooks 警告升级为拒绝任何 ESLint warning。
- 桌面 worker 请求设有明确超时，Windows 安全存储不可用时 Provider 凭据保存会失败关闭，CI 同时执行静态分析。
- Electron 与桌面端依赖已升级到持续安全维护的版本；只有源码构建需要 Node.js 22.12 或更高版本。
- 仓库和发布包不再包含 memoQ SDK 二进制、AddinSigner 或官方 SDK 示例；源码构建只会将两个必要的编译期程序集解析到 Git 忽略的本地缓存。
- memoQ 插件与本地网关现在会在首次请求前互相校验共享契约版本，网关 POST 请求体会先做轻量形状校验，本地数据库也引入了版本化的 schema 迁移。

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
5. Provider 注册层调用 OpenAI 或兼容接口。
6. 结果写回历史记录与缓存，再返回给 memoQ。

当用户在 memoQ 中确认译文后，`StoreTranslation` 也会把确认结果回写到桌面端，供后续自适应缓存复用。

## 当前实际操作顺序

当前 Dashboard 和整体用户流程已经围绕下面的顺序组织：

1. 安装或修复 memoQ 集成。
2. 连接并测试 AI 服务。
3. 按需上传术语或翻译记忆资产。
4. 在“翻译方案”中创建并保存 Profile。
5. 按需添加并测试“项目规则”，根据 memoQ 项目元数据选择 Profile。
6. 在 memoQ 中执行翻译并查看翻译记录。

如果是首次部署，请按这个顺序操作，这与当前版本的实际界面保持一致。

## 升级注意事项

- memoQ 使用本地网关时，请保持 memoQ AI Hub 桌面端运行。
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

- 用户指南：[docs/user-guide.zh-CN.md](docs/user-guide.zh-CN.md)
- 英文用户指南：[docs/user-guide.md](docs/user-guide.md)
- 仓库结构说明：[docs/repository-structure.md](docs/repository-structure.md)

## 许可证

LangLink 有权授权的部分采用 MIT 许可证。详见 [LICENSE](LICENSE)、[LICENSE_SCOPE.md](LICENSE_SCOPE.md) 和 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。memoQ SDK 材料和商标不在 MIT 授权范围内，本项目也不是 memoQ 官方产品。
