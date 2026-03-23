# memoQ AI Hub

[English](README.md) | [简体中文](README.zh-CN.md)

## 项目概述

`memoQ AI Hub` 是一个给 memoQ 使用的本地 AI 翻译控制台，核心思路来源于 [JuchiaLu/Multi-Supplier-MT-Plugin](https://github.com/JuchiaLu/Multi-Supplier-MT-Plugin)。

这个项目没有沿用“把所有业务都塞进 memoQ 插件 DLL”的做法，而是采用更容易维护和发布的“薄 DLL + 本地桌面端”架构。memoQ 插件只负责 SDK 对接、片段格式转换和本机通信，桌面端负责提供商配置、提示词编排、资产管理、历史记录、缓存和安装诊断。

## 项目能做什么

- 把 memoQ MT 插件请求转发到本地桌面端，再由桌面端统一调用 OpenAI 或 OpenAI-compatible 服务。
- 在桌面端集中管理 provider、model、API Key、Prompt 策略和运行参数。
- 为翻译请求拼装上下文，包括语言信息、相邻句、术语资产、brief、TM 信息和预览链路上下文。
- 记录翻译历史、成功率、延迟等运行数据，便于排查和调优。
- 支持 `StoreTranslation` 回写，把用户确认过的译文沉淀为后续请求可复用的自适应缓存。
- 提供 memoQ 集成安装辅助，把插件 DLL、`ClientDevConfig.xml` 和桌面侧所需资源一起打包。

## 核心思路

运行时职责拆成四层：

- `native/plugin/`：最小化 memoQ 插件层，负责实现 memoQ MT SDK 接口、收发 Segment、透传 metadata 和 TM 信息，并调用本地 HTTP 网关。
- `apps/desktop/`：Electron 桌面端，负责 provider 编排、上下文构建、历史记录、缓存、本地服务和安装诊断。
- `native/preview-helper/`：补足预览相关能力，为桌面端提供文档级上下文和预览链路支持。
- `packages/contracts/`：统一 DLL 和桌面端之间的 HTTP 契约，避免接口漂移。

整体判断是：memoQ 插件适合做宿主适配，不适合承载快速变化的 AI 业务。把复杂逻辑移到桌面端后，调试、扩展、打包、发布和后续 UI 迭代都会简单很多。

## 处理流程

1. memoQ 调用本地插件 DLL。
2. 插件把 segment、语言对、request type、TM 和 metadata 等信息整理成统一请求，发到本地网关 `http://127.0.0.1:5271`。
3. 桌面端读取当前 profile 和 provider 配置，决定走哪个模型与参数组合。
4. 桌面端按需拼装提示词和上下文，包括术语、brief、预览上下文、上下句和历史策略等。
5. provider registry 调用 OpenAI 或兼容接口，拿到译文后做结果规范化。
6. 结果写回历史、指标和缓存；如果命中自适应缓存则可直接返回。
7. 插件把文本重新组装成 memoQ 可接受的结果格式，再交还给 memoQ。

`StoreTranslation` 路径则反过来工作：当用户在 memoQ 中确认译文后，插件会把源文和目标文写回桌面端，保存成后续请求可命中的缓存条目。

## 仓库结构

- 运行时模块：`apps/desktop/`、`native/plugin/`、`native/preview-helper/`、`packages/contracts/`
- 工程支持层：`tooling/scripts/`、`tooling/build/`、`.github/workflows/`
- 文档与参考资料：`docs/`
- 静态资源：`assets/`
- 根级测试：`tests/repo/`

结构约定与扩展规则见 `docs/repository-structure.md`。

## 本地开发

```powershell
pnpm install
pnpm run install:desktop
pnpm run build:plugin
pnpm run prepare:release
cd apps/desktop
pnpm start
```

默认网关地址：`http://127.0.0.1:5271`

## 打包与发布

本仓库已内置 GitHub Actions：

- `.github/workflows/ci.yml`：在 `main` 分支 push 和 pull request 时执行构建、测试与 Windows 打包检查。
- `.github/workflows/release.yml`：在推送 `v*` tag 时执行正式打包，并把 `apps/desktop/out/**/*.zip` 发布到 GitHub Release。

本地打包命令：

```powershell
pnpm run package:windows
```

主要输出：

- `native/plugin/MemoQ.AI.Desktop.Plugin/bin/Release/net48/MemoQ.AI.Hub.Plugin.dll`
- `apps/desktop/out/*.zip`
- `apps/desktop/out/make/**/*.exe`
- `apps/desktop/build-resources/memoq-integration/*`

## 许可

本项目基于 MIT License 发布，详见 `LICENSE`。
