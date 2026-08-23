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
2. 进入左侧导航的 **概览（Dashboard）** 页面。
3. 点击 **安装 / 重装** 按钮，打开安装对话框。
4. 选择安装方式：
   - **使用默认 memoQ 路径**：从下拉列表中选择 memoQ 版本（支持 `10 / 11 / 12`），桌面端自动定位安装目录。
   - **选择自定义目录**：点击“浏览”手动指定 memoQ 根目录，适用于非标准安装路径。
5. 确认目标目录无误后，点击 **安装插件**。
6. 如目录中已存在旧版 DLL 或 `ClientDevConfig.xml`，确认覆盖即可。
7. 安装完成后，仪表盘会显示“集成安装成功”。

安装操作会将插件写入 memoQ 的 `Addins` 目录，并在 `%ProgramData%\MemoQ` 下生成未签名插件配置：

- `MemoQ.AI.Hub.Plugin.dll`
- `%ProgramData%\MemoQ\ClientDevConfig.xml`，其中包含 `<LoadUnsignedPlugins>true</LoadUnsignedPlugins>`，允许 memoQ 加载未签名插件

### 1.2 手动安装

1. 从 GitHub Releases 下载最新发布包。
   - 如果 Windows 在文件属性中显示“此文件来自其他计算机，可能被阻止”，请先在 zip 文件属性中点击 **解除锁定**，再解压。
2. 解压后找到以下文件：
   - `MemoQ.AI.Hub.Plugin.dll`
   - `ClientDevConfig.xml`
3. 将 `MemoQ.AI.Hub.Plugin.dll` 复制到 memoQ 安装目录下的 `Addins` 文件夹，例如：

```text
C:\Program Files\memoQ\memoQ-11\Addins\
```

4. 将 `ClientDevConfig.xml` 复制到 `%ProgramData%\MemoQ\ClientDevConfig.xml`；如已存在，请先检查内容再覆盖。
5. 如果 memoQ 启动时报 `0x80131515` 或 “loadFromRemoteSources”，请在管理员 PowerShell 中运行：

```powershell
Unblock-File -LiteralPath "C:\Program Files\memoQ\memoQ-11\Addins\MemoQ.AI.Hub.Plugin.dll"
```

然后重启 memoQ。

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

## 第三步：上传资产

若暂无术语表或自定义 TM 需求，可跳过此步骤。

1. 在左侧导航点击 **资产（Assets）**。
2. 点击 **+ 新增**，选择要上传的资产类型。
3. 选择本地文件，支持 TBX、TMX 和常见表格格式。
4. 上传完成后点击 **预览** 查看解析结果。
5. 如识别置信度较低，可手动指定源列、目标列和语言对，然后保存映射。

对于上传的 Custom TM 资产，memoQ AI Hub 会在本地计算 `AI Hub TM score`，并把最佳命中与 memoQ 自带的 best fuzzy TM hint 分开传给 AI Provider。memoQ 导出的 TMX 如果包含相邻上下文，也可以在源文和上下文证据同时匹配时产生 `101%` 命中。

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
- 如需使用本地上传的 TMX 或表格记忆库，在 **Custom TM** 下拉框中选择对应资产
- 如无术语表，可保持为空

### 4.4 更多设置

可选高级能力包括：

- 使用 memoQ 最佳模糊匹配 TM
- 使用 memoQ 元数据
- 启用缓存
- 使用预览上下文

5. 配置完成后点击 **保存 Profile**。
6. 如需作为默认配置，点击 **设为默认**。

## 第五步（可选）：按项目路由 Profile

保存至少一个 Profile 后，打开 **项目规则**。规则可以匹配客户、领域、主题、项目、源语言、目标语言、文档名称正则表达式和句段状态；同一规则内所有非空条件按 **AND** 组合。

1. 点击 **新增规则**，填写名称、选择 Profile，并只添加需要的条件。
2. 设置优先级。数字越小越先匹配；优先级相同时保持已有保存顺序。
3. 除非确有需要，否则不要创建无条件的兜底规则。此类规则可能阻止后续低优先级规则执行，保存前应用会要求确认。
4. 启用前使用 **测试匹配** 输入有代表性的 memoQ 元数据。结果会明确区分命中规则、回退到桌面端默认 Profile，以及 Profile 不存在。
5. 可在列表查看命中次数；需要创建相近变体时可复制现有规则。

规则只能选择已保存的 Profile。被规则引用的 Profile 在规则变更或删除前不能删除。如果 memoQ 插件的 **Default Profile ID** 不为空，该显式配置会覆盖此插件配置下的项目规则。

## 第六步：打开 memoQ

确保 memoQ AI Hub 桌面端保持运行，因为本地网关需要持续监听 `5271` 端口。

## 第七步：在 memoQ 中配置插件

### 7.1 创建 MT 资源

1. 在 memoQ 中进入 **Resource Console**。
2. 找到 **MT Settings**，点击 **Create new**。
3. 选择 **My Computer**，填写资源名称。
4. 在 MT 引擎列表中勾选 **memoQ AI Hub**，并打开设置面板。

### 7.2 配置插件参数

通常保持默认即可：

- **Gateway Base URL**：`http://127.0.0.1:5271`
- **Enable Gateway**：勾选
- **Formatting Mode**：`BothFormattingAndTags`

可选项：

- 如桌面端改了端口，修改 **Gateway Base URL**
- 如需指定特定 Profile，在 **Default Profile ID** 中填写对应 ID

### 7.3 开启相关选项

在 MT 资源设置中，将以下功能指定为 **memoQ AI Hub**：

- **Pre-translation**
- **Match and Patch**
- **Send best fuzzy TM match**
- **Self-learning MT**

### 7.4 在项目中启用 MT

1. 进入项目的 **Project -> Settings -> MT settings**
2. 启用刚创建的 **memoQ AI Hub** 资源
3. 保存后即可在项目中使用 AI 翻译

## 第八步：查看翻译或执行预翻译

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

### 质量检查

- 打开 **质量检查** 可检查当前 Preview 句段。确定性检查默认在本地运行；实时 AI 默认关闭。
- AI 默认只发送当前句段、少量相邻上下文、相关术语和最高匹配的 TM。文档摘要与全文需要在所选翻译方案中分别开启。
- 问题按严重度和证据展示，不提供整体质量评分。可按严重度、类别、来源或复核状态筛选，查看证据、复制建议并在本地保存反馈；首版不会把修改写回 memoQ。
- 执行摘要会分别显示确定性检查与 AI 的执行、缓存、Provider 失败和置信度阈值过滤状态，因此即使没有问题，也能确认 AI 是否真正运行。
- **打开助手窗口** 会打开置顶的 Preview 助手。**翻译** 与 **润色** 复用所选方案、Provider 路线、Preview 上下文、术语和 TM；**QA 检查** 支持仅本次请求使用的附加指令、术语覆盖，以及与主质量页和历史详情一致的持久化复核操作。
- QA 提示词模板按翻译方案保存。自定义模板可调整检查要求，但不能替换固定的输出 Schema、证据策略、阈值和“不输出总分”规则。
- Preview 不可用或映射不确定时，实时 AI 会停止。可使用 **选择双语文件** 只读检查 MQXLIFF/XLF/XLIFF，并导出 HTML、CSV 和 JSON 报告。
- QA 结果与反馈默认在本地保留 30 天。导出报告可能包含客户文本，必须遵循项目数据策略。
- 选择 **停用此规则** 时需要确认；系统会先在最新保存的翻译方案中停用对应规则，再记录反馈。未关联到当前方案规则的问题不能使用此操作。

### 导航、草稿与详情视图

- 应用会恢复上次有效页面、导航偏好和各页面的滚动位置。
- 在 769–1199px 宽度下导航自动变为紧凑模式；在 768px 及以下通过菜单按钮打开导航抽屉。
- AI 服务或翻译方案有未保存更改时，切换页面或选择其他条目会要求保存、丢弃或留在当前页。
- **翻译记录** 默认保留常用筛选；项目、主题、状态、问题类型和日期位于 **更多筛选条件** 中。
- 记录摘要保持可见；尝试过程、元数据、提示词、上下文和片段统一收纳在 **技术详情、提示词与片段** 中。

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
