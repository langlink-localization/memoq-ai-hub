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

- `Dashboard`：安装或重装 memoQ 集成、查看运行状态和更新状态。
- `Providers`：配置 OpenAI 或 OpenAI-compatible Provider，测试连通性并管理可用模型。
- `Builder`：创建翻译 Profile、选择执行路由、绑定 TB 资产，并调整 v1 暴露出来的少量高级开关。
- `Assets`：导入并预览 glossary / TB 资产。
- `History`：查看翻译记录，并支持导出或删除历史记录。
- `Logs`：查看本地诊断日志、打开日志文件、清理旧日志，并复制简短的排查摘要。

仓库里确实包含一些更底层的运行时能力，但当前版本并没有把所有内部模块都做成独立页面。本文档描述的是“当前交付界面”，不是所有内部实现细节。

## 近期更新

`v1.0.20` 增加上传 TM/TMX 匹配能力，并在主资产页面中显示上传入口：

- Custom TM 资产支持 TMX 文件，包括 memoQ 导出的 UTF-16 TMX 和相邻上下文 metadata。
- 桌面端会计算可解释的 `AI Hub TM score`，并使用 memoQ 风格区间：`101%`、`100%`、`95-99`、`85-94`、`75-84`、`<75`。
- 资产页面的新增菜单包含 Custom TM 上传，上传 TM 命中也会写入翻译历史，便于诊断。

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
5. 在 memoQ 中执行翻译并查看翻译记录。

如果是首次部署，请按这个顺序操作，这与当前版本的实际界面保持一致。

## 升级注意事项

- memoQ 使用本地网关时，请保持 memoQ AI Hub 桌面端运行。
- 如果之前已经安装过旧版本 memoQ AI Hub 插件 DLL，升级桌面端后仍需要在 Dashboard 点击 **Install / Reinstall**，让 memoQ 收到最新的 `MemoQ.AI.Hub.Plugin.dll`。
- 重新安装集成后请重启 memoQ。memoQ 会在启动时加载插件 DLL，已经运行的 memoQ 可能仍在使用旧 DLL。
- 如果手动安装，请替换 memoQ `Addins` 目录中的 `MemoQ.AI.Hub.Plugin.dll`，然后重启 memoQ。

## 本地开发

在仓库根目录安装依赖并构建：

```powershell
pnpm install
pnpm run install:desktop
pnpm run build:plugin
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

MIT，详见 [LICENSE](LICENSE)。
