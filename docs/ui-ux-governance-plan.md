# memoQ AI Hub UI/UX 治理优化方案

> 性质：审计 + 整改方案（本文档不含代码变更）。与 `docs/ui-governance.md`（仓库 UI 契约）互补：契约规定"应该是什么样"，本文档盘点"现状差距"并给出分阶段路线。
> 审计对象：`apps/desktop/src/renderer/src/`（App.jsx 4423 行 + 5 个页面组件 + index.css 1136 行 + main.jsx theme）。
> 依据：`antd-design-system` 设计系统约定（layout-conventions / token-system / page-patterns / review-checklist）。
> 已确认边界：P0-P2 分阶段深度；暗黑模式不纳入（登记为未来项）；按 Electron 桌面应用定响应式验收标准。

---

## 0. 总体设计判断

- **壳型判断**：应用是"多层级、操作密集的工具台"，6 个一级导航按 configure / activity / support 分 3 组（App.jsx:1656-1661），现有 B 型壳（Sider + Header + Content）选型正确，**不换壳、不引入路由库**。导航三态（expanded/compact/drawer）已是超规格实现，保留。
- **Ant Design 是基础**：当前问题不是 antd 用得不够，而是**绕开 antd 机制自造平行体系**——手工铺 45 档色 token、CSS 变量第二份拷贝、全局 `.ant-*` 覆盖、手写表单。治理方向是"回到 token 与组件契约内"，不是引入新库。
- **先交互后机制**：真正伤害 UX 的是反馈缺失与不一致（无 loading、无确认、陈旧错误、保存位置四种形态），token/样式问题是第二序。P0 排序据此而定。

---

## 1. 现状审计结论（问题清单，按治理级别归类）

### P0 — 止血级（直接损害可用性，且正在持续产生新漂移）

**反馈与交互安全**

1. 多个异步操作无 loading/禁用态：`refresh()`、导出历史、删除历史、复制/新建 profile、导入资产（App.jsx:2296-2307, 2238-2246, 2688-2700, 3073-3082）。用户可重复点击产生并发写。
2. 危险操作无确认：安装/重装 memoQ 集成（App.jsx:2541-2566）、日志立即清理（App.jsx:1764-1779）、"Restart and install update"（关闭应用，App.jsx:3523）、编辑器内"放弃修改"直点无确认（App.jsx:2233-2236, 2922-2942）。
3. 全局错误 Alert 无关闭按钮、不自动过期，只在下一次 `refresh()` 时清除（App.jsx:3330, 1679）——陈旧错误与新上下文脱节，违反"失败须 local 且可恢复"。
4. 静态 `message` 导入调用 34 处（App.jsx:29），未走 `App.useApp()`——丢失主题上下文，antd v5 运行时警告，且阻断后续 feedback 契约统一。
5. 初始加载屏是裸 `<div>{error || loading}</div>`（App.jsx:3223），无 Spin/Skeleton，且错误与加载复用同一槽位。

**一致性失控（四个页面四种形态）**

6. 保存按钮位置四种：底部 sticky bar（Builder）/ 卡片 extra（Prompts）/ hero 右侧（Providers）/ 不存在（Advanced 无保存按钮，只有即时回调）。
7. 删除入口四种：More 下拉（Builder）/ extra 裸 danger（Prompts/Providers）/ 行内 text（Assets）。
8. 页面主标题四种呈现：hero `Title level=3`（Providers/Advanced）/ 自定义 div（Builder）/ 仅 Card title（Logs/Assets）。
9. 栅格两套：`gutter={16}`+外层 `Space size={18}`（Builder/Prompts）vs `gutter={[20,20]}` 无外层（Providers/Advanced）。

### P1 — 共享契约级（体系性偏离 token/壳层约定）

10. **平行主题系统**：index.css `:root` 约 20 个 `--app-*` 变量（index.css:1-21）是 main.jsx token 的第二份手工拷贝，同色两处维护。
11. **手工铺 45 档色 token**（main.jsx:19-63）：五色各 9 档手写，应收敛为 seed token + 算法派生；当前写法使任何品牌色调整要改 45 处。
12. **全局 `.ant-*` 无 scope 覆盖 + 24 处 `!important`**：`.ant-btn { height: auto }`（index.css:88-98）破坏按钮高度体系；`.ant-select`/`.ant-table`/`.ant-modal` 批量覆盖（index.css:129-188）；菜单选中色手写（index.css:327-334）而非 token 派生。
13. **壳层硬编码**：Sider/Header 用 inline style 写底色与边框 + `backdropFilter: blur(12px)`（App.jsx:3236, 3288），未走 `theme.components.Layout`；`collapsedWidth={72}` 偏离约定 80。
14. **Header 混入页面级元素**：当前页标题+描述放 Header（App.jsx:3300-3304），违反"页面标题归 Content 区"的归属约定（docs/ui-governance.md 亦规定 page-specific actions 不进 global header）。
15. **零 Form 使用**：全部手写受控 + `<Text strong>` 标签 + imperative `message.error` 校验；数字输入 `Number(value||0)` 可产生 NaN/0（App.jsx:1562-1569）；日期筛选用纯文本 Input 而非 DatePicker（App.jsx:3839, 3850）。
16. **无障碍回退**：AdvancedTuningPage 的 collapsed 列表缺 `role="option"/tabIndex/aria-selected/onKeyDown`（AdvancedTuningPage.jsx:142-150，与其复制源 ProvidersPage 不一致）；圆角 CSS 出现 10/12/16px 偏离 token 4/6（index.css:403, 986, 1001）。
17. **i18n 缺口**：`translateWithFallback` 允许 key 缺失时静默回退英文，dashboard 更新区块大面积中招（App.jsx:516-522, 3474-3535）；`STYLE_PRESETS` 五段英文提示词写进用户数据（BuilderPage.jsx:37-56, PromptsPage.jsx:14-33）；错误兜底 UI 硬编码英文（main.jsx:124-125）。

### P2 — 债务级（不紧迫但持续累积成本）

18. **死代码**：`EditableProfileForm` 247 行完整组件零引用（App.jsx:1333-1579）；`PlaceholderDrawer` 定义后未渲染（BuilderPage.jsx:382-421）；未使用导入/常量 3 处（App.jsx:68, 74, 123）。
19. **跨文件复制粘贴**：`STYLE_PRESETS`、`ProfileListPanel`、`ProviderCatalog`（ProvidersPage.jsx:56-201 vs AdvancedTuningPage.jsx:29-157，且复制品丢了键盘可达性）；删除历史确认 Modal 整段重复两次（App.jsx:3101-3116, 3930-3940）。
20. **工程健康影响 UX**：App 组件 45 个 useState；dashboard 每 3 秒全量轮询整体 setState → 全树重渲染，多个 useMemo 依赖整个 state 对象实际失效（App.jsx:1829-1831, 2023-2055）；ProvidersPage 接收约 50 个 props（App.jsx:3590-3639）。
21. **两套并行响应式机制**：JS `viewportWidth`+`innerWidth` 断点判定（App.jsx:1624, 2096-2102）与 CSS media query 1200/768/480（index.css:1010-1136）断点值分置两处。
22. 细节：导出按钮 "CSV"=selected scope / "XLSX"=filtered scope，文案不体现差异（App.jsx:3665-3666）；`HoverText` 对 `'-'` 占位值也出 Tooltip（App.jsx:470-479）；37 处 `style={{display:'flex'}}` Space hack（应用 Space `block` prop）；dashboard/history 页仍内联 App.jsx 未随兄弟页面拆出。

---

## 2. 目标契约（治理完成时的四条共享约定）

### 2.1 Token 契约

- `ConfigProvider.theme` 是唯一 theme source of truth。
- Seed 层只保留：`colorPrimary #0066ff`、`colorSuccess/Warning/Error` 四个品牌色、`borderRadius 4`、`fontFamily`（新增，现缺失）。**删除全部 45 档手工色阶**，由 `defaultAlgorithm` 派生；派生结果与现值有视觉差异时逐组件用 component token 微调并登记。
- 消灭 index.css `:root --app-*` 平行变量；自定义组件取值走 `useToken`。
- 布局尺寸走 `theme.components.Layout`：`headerHeight`、`headerPadding 0 24px`、`lightSiderBg`；Sider `width 248` 符合 `200+8n` 保留并登记，`collapsedWidth` 72→80 归位。

### 2.2 壳层契约（B 型，桌面应用）

- Header 只保留：移动抽屉触发钮、产品名、语言切换、刷新、连接状态 Tag。**页面标题/描述下放到 Content 区页头**（每页统一 `PageHeaderBlock`：标题 + 描述 + 主操作区）。
- 消灭 Header/Sider 的 inline style 与 blur；分隔用 1px `colorBorderSecondary` 边线（token 派生）。
- 响应式验收宽度（桌面应用）：1024 / 1280 / 1440 / 1920；1024 以下进 drawer 态为登记例外（现有实现），不做 320-768 移动验收。
- 断点单一来源：JS 导航模式断点与 CSS media query 收敛到同一组常量。

### 2.3 反馈契约

- 全部 `message`/`Modal` 走 `App.useApp()`（根 `ConfigProvider` 内挂 antd `App` 组件）。
- 分级规则：静默成功 → `message.success`；异步操作错误 → 操作点就近 `Alert`/字段级提示；全局连接状态 → 现有 Header Tag；长耗时后台事件 → 引入 `notification`（当前 0 使用）；不可恢复页级错误 → `Result`。
- 每个异步操作必须有 pending 态；破坏性操作按风险分级：低风险 → `Popconfirm`，高风险（安装集成、重启更新、放弃修改、清日志）→ `Modal.confirm` + danger 按钮 + 后果文案。
- 全局错误 Alert 加 `closable` 且随页面切换自动清除。
- 加载分级：首次加载 Skeleton/Spin、操作加载 Button[loading]、抽屉/面板加载 Spin（统一历史详情与资产预览两种现状）。

### 2.4 页面模式契约

- 编辑器类页面（Builder/Prompts/Providers/Advanced）统一：**右侧编辑器 Card + extra 放主操作（Save primary + 次级 More Dropdown），Danger 操作只进 Dropdown 且带确认**；四页保存/删除位置归一到此模式。
- 列表/表格页（History/Logs/Assets）统一：工具条（筛选/搜索 + 主操作）→ Table/List → 行操作超 2 个收进 Dropdown；空态统一带"下一步动作"文案的 Empty。
- 页面主标题统一由 Content 页头呈现（见 2.2），Card title 只用于卡片级。
- 栅格统一 `Row gutter={[16,16]}` + 外层垂直间距 16。
- 表单统一迁 `Form`/`Form.Item`（声明式校验）；数字输入 `InputNumber` 带 min/max；日期 `DatePicker`；Select 宽度由布局容器控制，删 inline width。

---

## 3. 分阶段治理路线

### P0 — 止血（约 1-2 天，纯行为修复，不动视觉）

| # | 动作 | 验收 |
|---|------|------|
| 1 | 根挂 antd `App`，34 处静态 message/Modal 迁 `App.useApp()` | 控制台无 antd v5 静态方法警告；所有反馈正常出主题样式 |
| 2 | 给 refresh/导出/删除历史/复制新建 profile/导入资产补 loading+禁用 | 操作期间按钮进 loading 且不可重复触发 |
| 3 | 给安装集成、清日志、重启更新、编辑器内放弃修改补 `Modal.confirm`(danger) | 四个操作均先弹确认且文案说明后果 |
| 4 | 全局错误 Alert 加 `closable` + 页面切换自动清除 | 错误不再跨页残留 |
| 5 | 初始加载屏改 Spin 居中，错误与加载分槽 | 启动有明确加载态；启动错误独立呈现 |
| 6 | 导出按钮文案体现 scope（如"导出所选 CSV"/"导出筛选结果 XLSX"） | 不再歧义 |
| 7 | AdvancedTuning collapsed 列表补 role/tabIndex/aria-selected/onKeyDown | 键盘可达性与 ProvidersPage 对齐 |

### P1 — 契约对齐（约 3-5 天，视觉有微调，逐屏回归）

| # | 动作 | 验收 |
|---|------|------|
| 1 | theme 收敛：删 45 档手工色阶→seed 派生；补 fontFamily；Layout component token 接管壳层颜色/高度 | main.jsx token 块 ≤ 15 行；视觉回归差异逐屏登记 |
| 2 | 清除 `:root --app-*` 平行变量与 24 处 `!important`、无 scope `.ant-*` 覆盖（重点 `.ant-btn height:auto`）；自定义组件改 `useToken` | index.css 无 `.ant-*` 选择器、无 `!important`；按钮高度回到 antd 体系 |
| 3 | 页面标题/描述从 Header 下放 Content 页头；四编辑器页操作位归一（extra: Save primary + More Dropdown）；栅格统一 | 四页结构同构；Header 只剩全局元素 |
| 4 | 表单迁 Form/InputNumber/DatePicker（Providers 配置卡、Builder 数字字段、History 日期筛选优先） | 无手写 label 布局；校验声明式；NaN/0 隐患消除 |
| 5 | i18n 补全：消灭 translateWithFallback 英文静默回退（补齐 zh key）；STYLE_PRESETS 走 i18n；兜底 UI 文案走 t() | 中文界面全文搜索无英文残留（品牌词除外） |
| 6 | 断点常量单一来源；`collapsedWidth` 72→80 | JS/CSS 断点同值；收起态按 80px 验收 |
| 7 | 空态统一：History/Providers 主表补带引导动作的 Empty | 所有列表空态有"下一步"文案 |

### P2 — 偿债（可穿插后续迭代，不阻塞）

| # | 动作 | 验收 |
|---|------|------|
| 1 | 删死代码：EditableProfileForm、PlaceholderDrawer、未使用导入/常量 | grep 零引用 |
| 2 | 提取共享件：STYLE_PRESETS、ProfileListPanel、ProviderCatalog、删除确认 hook 各一份 | 复制块消除 |
| 3 | dashboard/history 页拆出 App.jsx（对齐兄弟页面 lazy 模式） | App.jsx 回落到壳层+编排职责 |
| 4 | 状态拆分：轮询 state 按页面切片（useSyncExternalStore 或简单 context 分片），修 useMemo 失效 | 轮询不再触发全树重渲染（React DevTools Profiler 验证） |
| 5 | HoverText 空值不出 Tooltip；`display:flex` hack 改 Space `block`；表格列宽改比例/语义宽 | 37 处 hack 清零 |

---

## 4. 明确拒绝的方案（取舍记录）

- **不引入 react-router 等路由库**：6 页 + 状态导航已满足，路由化是 P2 之后才可重新评估的独立议题，当前引入只会扩大变更面。
- **不做暗黑模式**：登记为未来项；届时只需 `darkAlgorithm` + token 双模式，前提是 P1-1/P1-2 完成（平行 CSS 变量清除前做暗色等于再建第三份主题）。
- **不引入 styled-components/CSS-in-JS 库**：目标是回到 antd token 机制内，不是换一套样式技术栈。
- **不做一次性大重写**：P2-4 状态管理重构限定为"按页面切片"的最小手术，不迁 Redux/Zustand（与现有自研草稿系统兼容性未验证，超出 UX 治理范围）。
- **不动 `.ant-btn height:auto` 之外的响应式换行覆盖**（P1-2 中保留评估）：其中部分是为了中英混排防溢出，删除前须按 1024/1280 宽度逐屏回归。

---

## 5. 验收门（每个阶段收口时跑一遍）

- 反馈：所有异步操作有 pending 态；破坏性操作确认与风险匹配；错误可恢复、不陈旧。
- 壳层：Header/Sider 无 inline style；颜色尺寸全部 token 可查；收起态 80px；当前导航项非仅靠颜色区分。
- Token：`ConfigProvider.theme` 唯一 source of truth；index.css 无 `.ant-*`、无 `!important`、无平行变量。
- 一致性：四编辑器页保存/删除位置同构；页面标题位置统一；栅格统一。
- i18n：中文界面无英文静默回退；中英文 locale key 集合保持一致（对齐 docs/ui-governance.md Verification Gates）。
- 响应式：1024/1280/1440/1920 四宽度无页面级横向溢出；drawer 态（<1024）导航可用。
- 无障碍：键盘可完成主流程（导航、列表选择、保存）；focus 可见。
- 测试：`pnpm run test:desktop`、`pnpm run test:repo` 通过（对齐 docs/ui-governance.md Verification Gates）。
