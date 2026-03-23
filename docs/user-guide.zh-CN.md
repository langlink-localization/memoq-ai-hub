# memoQ AI Hub 用户操作指南

[English](user-guide.md) | [简体中文](user-guide.zh-CN.md)

本指南面向翻译人员，介绍从零开始使用 memoQ AI Hub 的完整流程。

## 系统概览

memoQ AI Hub 由两部分协同工作：

- **桌面端（memoQ AI Hub 应用）**：负责配置 AI 服务商、管理术语表、构建翻译 Profile，以及提供本地 HTTP 网关，默认地址为 `http://127.0.0.1:5271`。
- **memoQ 插件 DLL**：安装在 memoQ 的 `Addins` 目录中，将 memoQ 的翻译请求转发给桌面端网关。

请求流程：

`memoQ -> DLL 插件 -> 本地网关 (5271) -> AI 服务商 -> 返回译文 -> memoQ`

## 第一步：安装插件 DLL

### 1.1 通过桌面端自动安装

1. 打开 memoQ AI Hub 桌面应用。
2. 进入左侧导航的 **仪表盘（Dashboard）** 页面。
3. 点击 **安装 / 重装** 按钮，打开安装对话框。
4. 选择安装方式：
   - **使用默认 memoQ 路径**：从下拉列表中选择 memoQ 版本（支持 `10 / 11 / 12`），桌面端自动定位安装目录。
   - **选择自定义目录**：点击“浏览”手动指定 memoQ 根目录，适用于非标准安装路径。
5. 确认目标目录无误后，点击 **安装插件**。
6. 如目录中已存在旧版 DLL 或 `ClientDevConfig.xml`，确认覆盖即可。
7. 安装完成后，仪表盘会显示“集成安装成功”。

安装操作会写入以下文件到 memoQ 的 `Addins` 目录：

- `MemoQ.AI.Hub.Plugin.dll`
- `ClientDevConfig.xml`，其中包含 `<LoadUnsignedPlugins>true</LoadUnsignedPlugins>`，允许 memoQ 加载未签名插件

### 1.2 手动安装

1. 从 GitHub Releases 下载最新发布包。
2. 解压后找到以下文件：
   - `MemoQ.AI.Hub.Plugin.dll`
   - `ClientDevConfig.xml`
3. 将它们复制到 memoQ 安装目录下的 `Addins` 文件夹，例如：

```text
C:\Program Files\memoQ\memoQ-11\Addins\
```

4. 如 `ClientDevConfig.xml` 已存在，覆盖即可。

## 第二步：配置 AI Provider

1. 在左侧导航点击 **Provider 中心**。
2. 点击左侧面板右上角的 **+ 新增**，选择 Provider 类型：
   - **OpenAI Official**
   - **OpenAI Compatible**
3. 在右侧面板填写：
   - **名称**
   - **API Key**
   - **Base URL**，例如 `https://api.openai.com/v1`
   - **Request Path**，仅 OpenAI Compatible 在默认路径不同时需要填写
4. 点击 **测试**，等待连接状态变为绿色。
5. 点击 **保存**。

### 2.1 添加模型

1. 在模型列表区域点击 **添加模型**。
2. 点击 **发现模型**，从 Provider 拉取可用模型。
3. 点击 **添加** 将所需模型加入列表。
4. 选择一个模型作为 **默认模型**。
5. 确认模型已启用后再次保存 Provider。

## 第三步：上传术语表

若暂无术语表需求，可跳过此步骤。

1. 在左侧导航点击 **资产（Assets）**。
2. 点击 **+ 新增** -> **上传术语表**。
3. 选择本地术语文件，支持 TBX 和常见表格格式。
4. 上传完成后点击 **预览** 查看解析结果。
5. 如识别置信度较低，可手动指定源列、目标列和语言对，然后保存映射。

## 第四步：在 Builder 中构建翻译 Profile

1. 在左侧导航点击 **编排器（Builder）**。
2. 点击 **+ 新增** 创建 Profile。
3. 填写 Profile 名称和可选描述。
4. 完成以下四个步骤卡片配置。

### 4.1 Provider 与模型

分别为三条路线选择 Provider 和模型：

- **交互路线**：用于 memoQ 内实时翻译
- **批处理路线**：用于预翻译等批量操作
- **回退路线**：主路线失败时自动切换

### 4.2 风格与 Prompt 策略

- 可直接选择预设风格，如自然、正式、技术、营销、UI 文案
- 也可自由填写风格说明，例如：

```text
使用简洁的 UI 文案风格，中文自然，并严格保持产品术语一致。
```

其余角色指令、格式保护和 JSON 结构会由系统自动组装。

### 4.3 绑定术语表

- 在 **TB** 下拉框中选择已上传的术语表
- 如无术语表，可保持为空

### 4.4 更多设置

可选高级能力包括：

- 使用 memoQ 最佳模糊匹配 TM
- 使用 memoQ 元数据
- 启用缓存
- 使用预览上下文

5. 配置完成后点击 **保存 Profile**。
6. 如需作为默认配置，点击 **设为默认**。

## 第五步：打开 memoQ

确保 memoQ AI Hub 桌面端保持运行，因为本地网关需要持续监听 `5271` 端口。

## 第六步：在 memoQ 中配置插件

### 6.1 创建 MT 资源

1. 在 memoQ 中进入 **Resource Console**。
2. 找到 **MT Settings**，点击 **Create new**。
3. 选择 **My Computer**，填写资源名称。
4. 在 MT 引擎列表中勾选 **memoQ AI Hub**，并打开设置面板。

### 6.2 配置插件参数

通常保持默认即可：

- **Gateway Base URL**：`http://127.0.0.1:5271`
- **Enable Gateway**：勾选
- **Formatting Mode**：`BothFormattingAndTags`

可选项：

- 如桌面端改了端口，修改 **Gateway Base URL**
- 如需指定特定 Profile，在 **Default Profile ID** 中填写对应 ID

### 6.3 开启相关选项

在 MT 资源设置中，将以下功能指定为 **memoQ AI Hub**：

- **Pre-translation**
- **Match and Patch**
- **Send best fuzzy TM match**
- **Self-learning MT**

### 6.4 在项目中启用 MT

1. 进入项目的 **Project -> Settings -> MT settings**
2. 启用刚创建的 **memoQ AI Hub** 资源
3. 保存后即可在项目中使用 AI 翻译

## 第七步：查看翻译或执行预翻译

### 交互翻译

1. 在 memoQ 编辑器中选中源句段。
2. 在 MT 结果面板中选择 **memoQ AI Hub**。
3. 系统会实时调用桌面端并返回译文。
4. 采纳译文后，桌面端会通过 `StoreTranslation` 将确认译文写入缓存。

### 预翻译

1. 在项目管理器中右键文档，选择 **Pre-translate**
2. 将 MT 引擎设置为 **memoQ AI Hub**
3. 执行后系统会按批处理路线翻译句段

### 历史记录与运行状态

- 在桌面端左侧导航点击 **历史记录**，可查看原文、译文、耗时和成功率
- 在 **仪表盘** 中查看网关在线状态、memoQ 连接状态和最近通知

## 常见问题

**仪表盘显示“未连接”怎么办？**

1. 确认桌面端已启动并保持运行
2. 确认插件设置中的 **Enable Gateway** 已勾选
3. 确认 `Gateway Base URL` 为 `http://127.0.0.1:5271`
4. 在仪表盘点击 **测试连接**

**Provider 保存按钮是灰色的？**

- 必须先点击 **测试** 并等待状态变为绿色

**术语表没有被正确识别？**

- 在 Assets 页面点击 **预览**
- 如置信度较低，手动指定源列、目标列和语言对后再保存映射

**如何为不同项目使用不同 Profile？**

- 在 memoQ 插件设置的 **Default Profile ID** 中填写对应 Profile ID
- 留空则使用桌面端默认 Profile

**如何升级 DLL？**

- 在仪表盘重新点击 **安装 / 重装** 覆盖安装
- 或手动替换 `Addins` 目录中的 DLL，然后重启 memoQ
