# 用户数据设计（数据组件：清单、表单、统计）

> 状态：**已实现**（2026-10-22，schemaVersion 3）。第 9 节已由创始人确认，见 DECISIONS D-036–D-043。
> 相关：恢复语义见交接文档 §7E，用户文件见 §7G，云端见 [CLOUD_DESIGN.md](CLOUD_DESIGN.md)。

## 1. 目标

- 用户用一句话搭出**能记东西**的页面：记账、待办、读书清单、笔记、客户名单……
- **数据属于用户**：改界面、撤销、恢复历史版本、卸载工具，都不会删除或改动用户填的内容（和用户文件同一原则，§6 不变量）。
- **AI 只设计数据的“形状”和展示方式**，不读、不写用户填的内容（§8：发给模型的内容尽量少）。
- 仍然是白名单 + 声明式：没有公式、脚本、任意查询，保持非图灵完备（§7C、应用商店动态代码政策）。

## 2. 核心划分：结构在配置里，内容在配置外

|              | 数据表结构（Collection）                  | 记录（Record）                   |
| ------------ | ----------------------------------------- | -------------------------------- |
| 例子         | “账目”表有金额、分类、日期、备注四个字段  | 「午饭 35 元 餐饮 10-22」        |
| 存在哪       | `WorkspaceConfig.collections`，随版本保存 | SQLite `records` 表，不随版本    |
| 谁来改       | AI 或修改流程：预览 → 确认 → 可撤销       | 用户在页面上直接增删改，立即生效 |
| 恢复历史版本 | 还原                                      | **不还原、不删除**               |
| 发给 AI      | 发送（表名、字段名、选项文字）            | **从不发送**                     |

这和现在“工具配置随版本、用户文件独立”的划分完全一致。用户撤销一次界面修改，不会丢掉刚记的一笔账。

## 3. 数据表结构

```jsonc
// WorkspaceConfig 新增 collections（schemaVersion 3）
"collections": [
  {
    "id": "expenses",
    "name": "账目",
    "icon": "chart",
    "fields": [
      { "id": "amount",   "name": "金额", "type": "money", "currency": "CNY", "required": true },
      { "id": "category", "name": "分类", "type": "choice",
        "options": [{ "id": "food", "label": "餐饮" }, { "id": "transport", "label": "交通" }] },
      { "id": "date",     "name": "日期", "type": "date", "default": "today" },
      { "id": "note",     "name": "备注", "type": "text" }
    ]
  }
]
```

### 字段类型（白名单）

| 类型       | 存储的值                                         | 典型用途     |
| ---------- | ------------------------------------------------ | ------------ |
| `text`     | 字符串，≤ 200 字                                 | 标题、名称   |
| `note`     | 字符串，≤ 5000 字                                | 笔记正文     |
| `number`   | 数字；可设小数位（0–4）和单位（如“页”“km”）      | 数量、进度   |
| `money`    | 数字（2 位小数）+ 币种（ISO 代码，整个字段统一） | 金额         |
| `checkbox` | true / false                                     | 完成、已读   |
| `date`     | `YYYY-MM-DD`，设备本地日期                       | 日期、截止日 |
| `choice`   | 选项 ID（单选）                                  | 分类、状态   |
| `rating`   | 1–5 的整数                                       | 评分         |
| `file`     | Morph 里一个文件的 ID（D-187）                   | 收据、照片   |
| `formula`  | 不存值，按 `expression` 现算（D-188、D-246）     | 小计、含税   |
| `link`     | 另一张表里一条记录的 ID（D-250）                 | 订单的客户   |

每条记录还自带两个系统字段：`createdAt`、`updatedAt`，可以用来排序和筛选。

### 规则

- **ID 稳定，名字可改**：字段和选项都有固定 ID；改名只改显示文字，已有数据不受影响。
- **删除字段 = 隐藏**：记录里这个字段的值保留不动；恢复到旧版本时字段重新出现，数据也回来了。
- **删除选项**：已经选了它的记录显示为空（数据仍在，恢复后回来）。
- **改字段类型**：只允许兼容的转换（`text ↔ note`、`number ↔ money`）。其他情况要新建一个字段（建议，见第 9 节 Q3）。
- **默认值**：`date` 可以是 `"today"`；其他类型是常量。
- **上限**：每个工作空间 20 张表，每张表 30 个字段，每个选择字段 50 个选项。

## 4. 记录

```sql
-- 本地数据库新增（PRAGMA user_version 3）
CREATE TABLE records (
  id            TEXT PRIMARY KEY,      -- UUID
  collection_id TEXT NOT NULL,
  values_json   TEXT NOT NULL,         -- { 字段 ID: 值 }
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  deleted_at    INTEGER                -- 软删除
);
CREATE INDEX records_by_collection ON records (collection_id, deleted_at, created_at);
```

- **写入时严格**：按当前字段定义校验（`core` 提供纯函数 `validateRecord`），不合法的值不能保存。
- **读取时宽容**：和当前定义对不上的值（比如恢复旧版本后类型变了），只是不显示，**绝不能让页面崩溃**。记录不经过版本校验，所以渲染器必须能承受任何数据。
- **已删除字段的值**会原样保留在 `values_json` 里，不显示。
- **删除记录**：软删除，提示条上可以「撤销」；「设置 → 数据 → 最近删除」保留 30 天（见 Q2）。
- **数据表被移出配置**（AI 删除了表，或恢复到建表之前的版本）：记录保留。「设置 → 数据」列出“未使用的数据表”，可以导出或永久删除（需确认）。同一个表 ID 重新出现时，数据自动回来。
- **规模**：每张表软上限 1 万条（满了不能再添加）。实现时筛选、排序和统计用 `core` 的纯函数在内存中计算（和测试共用同一套逻辑）；记录很多时再改为 SQLite `json_extract`（D-043）。

## 5. 数据组件

| 组件         | 主要属性                                                                                                                                   | 说明                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `recordList` | `collectionId`、`display`（`list` / `cards` / `checklist`）、`titleField`、`subtitleFields`（≤ 2）、`filter`、`sort`、`limit`、`emptyText` | 点一条打开编辑；`checklist` 用一个 `checkbox` 字段直接打勾 |
| `recordForm` | `collectionId`、`fieldIds`、`submitLabel`、`mode`（`inline` / `button`）                                                                   | 快速添加：`inline` 直接在页面上填，`button` 弹出完整表单   |
| `stat`       | `collectionId`、`aggregate`（`count` / `sum` / `avg` / `min` / `max`）、`fieldId`、`filter`、`label`、`groupBy`（D-248）                   | 例如“本月支出 ¥1,234”“未完成 5 项”；`groupBy` 每个选项一行 |

**筛选**只能用白名单条件，多个条件之间是“并且”，没有表达式：

```jsonc
"filter": [
  { "field": "date", "op": "inPeriod", "value": "thisMonth" },
  { "field": "category", "op": "is", "value": "food" }
],
"sort": { "field": "date", "direction": "desc" }
```

可用的条件：`is` / `isNot` / `contains` / `gt` / `lt` / `isEmpty` / `isNotEmpty` / `inPeriod`。`inPeriod` 的取值有 `today`、`thisWeek`、`thisMonth`、`thisYear`、`last7days`、`last30days`。

**记录编辑页**由内核按字段定义自动生成，不可配置：点列表里的一条，或 `recordForm` 的 `button` 模式都会打开它，删除也在这里。

这三个组件和其他组件一样，可以放进分组里，例如两个 `stat` 横排、列表放在网格下面。

## 6. AI 修改操作

新增的操作：

| 操作                                                                               | 说明                            |
| ---------------------------------------------------------------------------------- | ------------------------------- |
| `addCollection {collection}`                                                       | 新建数据表                      |
| `updateCollection {collectionId, name?, icon?}`                                    | 改名、换图标                    |
| `addField {collectionId, field, index?}`                                           | 加字段                          |
| `updateField {collectionId, fieldId, name?, options?, required?, default?, type?}` | 改字段；`type` 只能做兼容转换   |
| `moveField {collectionId, fieldId, toIndex}`                                       | 调整字段顺序                    |
| `removeField {collectionId, fieldId}`                                              | 隐藏字段，数据保留              |
| `removeCollection {collectionId}`                                                  | 移出配置，数据保留（见第 4 节） |

数据组件仍然用现有的 `addComponent` / `setComponentProps` 等操作。

**校验器**新增检查：组件引用的表和字段必须存在；用法和类型匹配（`sum` 只能用于 `number` / `money`，`checklist` 需要 `checkbox` 字段，`inPeriod` 只能用于 `date` 或系统时间字段）；筛选值必须符合字段类型和选项。

**修改说明**举例：「新建数据表「账目」（金额、分类、日期、备注）」「隐藏「账目」的字段「备注」（已有数据保留）」。

**快捷操作写记录（D-187）**：`out.addRecord` 在快捷操作运行时弹出按表结构生成的表单，用户填完才写进数据库；文件存成 Morph 的文件放进附件字段。AI 只决定记到哪张表。

**AI 不碰记录内容**：「删掉上个月的账」「把所有待办标成完成」这类请求会被拒绝，并提示直接在页面上操作（和 `deleteFiles` 同一类）。AI 是否可以代写记录，见 Q1。

### 例子：「做一个记账页面，显示本月花了多少」

模型会输出：`addCollection`（账目表，同第 3 节）+ `addPage` + `setNavItems`。新页面是这样的：

```jsonc
{
  "id": "budget",
  "title": "记账",
  "icon": "chart",
  "components": [
    { "id": "title", "type": "header", "props": { "title": "记账" } },
    {
      "id": "month-total",
      "type": "stat",
      "props": {
        "collectionId": "expenses",
        "aggregate": "sum",
        "fieldId": "amount",
        "label": "本月支出",
        "filter": [{ "field": "date", "op": "inPeriod", "value": "thisMonth" }],
      },
    },
    {
      "id": "add",
      "type": "recordForm",
      "props": {
        "collectionId": "expenses",
        "fieldIds": ["amount", "category", "note"],
        "submitLabel": "记一笔",
        "mode": "inline",
      },
    },
    {
      "id": "recent",
      "type": "recordList",
      "props": {
        "collectionId": "expenses",
        "display": "list",
        "titleField": "note",
        "subtitleFields": ["category", "date"],
        "sort": { "field": "date", "direction": "desc" },
        "limit": 20,
        "emptyText": "还没有记录",
      },
    },
  ],
}
```

**Mock AI** 增加几个内置模板，例如「新建一个记账页面」「新建待办清单」「新建读书清单」「新建笔记」，以及「给账目加一个「支付方式」字段」这类单项修改。

## 7. 恢复、迁移、同步、导出

- **§7E 恢复语义**新增两行：数据表结构 → 还原；记录 → 不还原、不删除。
- **迁移**：配置 schemaVersion 2 → 3，补上 `collections: []`；本地数据库新增 `records` 表。
- **新组件和版本号**（D-254）：只新增一种页面组件时不提升 schemaVersion。读取已存的配置时，这个版本不认识的组件原样保留（保存时写回原来的 JSON），页面上显示「需要更新 App」的占位，只能移动和删除；AI 不能新加或修改它们。改了已有结构（给已有组件加属性、加字段类型、改取值范围）仍要提升版本号并写迁移。这个版本之前装的 App 仍会拒绝含新组件的配置。
- **云端**（CLOUD_DESIGN.md 补充）：新增 `records` 表（带 `workspace_id`，受 RLS 保护）。版本是不可变的，记录是可变的，所以同步方式不同：每条记录按 `updated_at` 以“后写入者为准”，删除用墓碑记录。两台设备同时改同一条时，后改的生效（字段级合并以后再做）。
- **导出**：每张表可以导出 CSV，通过系统分享面板发出去（“数据高于界面”，§12）。

## 8. 这一版不做

| 不做                        | 原因 / 以后怎么做                                |
| --------------------------- | ------------------------------------------------ |
| 表之间的关联（客户 ↔ 订单） | D-250 做了单向引用；反向列表、多选、级联删除不做 |
| 公式、计算字段              | D-188 / D-246 / D-247 做了受限的公式             |
| 图表、日历视图              | D-249 做了图表；日历视图仍不做                   |
| 重复任务、每日打卡          | 需要“按日期生成记录”的规则，单独设计             |
| 附件字段（引用用户文件）    | 需要和 AssetGrant 打通，放到下一步               |
| AI 代写记录                 | 见 Q1                                            |
| 多人共享                    | 依赖账号和云端                                   |

## 9. 创始人的决定（2026-10-22）

| #   | 事项                                                            | 建议                                                                              |
| --- | --------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Q1  | AI 能不能代写记录（例如「记一笔午饭 35」）                      | **已定：不能。AI 只改界面。** 这类请求以 `userData` 拒绝（D-036）                 |
| Q2  | 删除记录后能找回多久                                            | 提示条上可以撤销，另外「最近删除」保留 30 天，之后自动清除                        |
| Q3  | 字段改类型                                                      | 只允许兼容的转换；其他情况新建字段，旧字段隐藏（数据不丢）                        |
| Q4  | AI 能不能删除数据表                                             | 能，但只是移出配置，数据保留在「设置 → 数据」里；永久删除只能由用户手动操作并确认 |
| Q5  | 第一版 Mock AI 带哪些模板                                       | 记账、待办、读书清单、笔记                                                        |
| Q6  | 第一版是否包含 CSV 导出                                         | 包含：工作量小，对“数据属于用户”的信任很重要                                      |
| Q7  | 表名、字段名、选项文字会发给 AI（用户可能写进客户名之类的隐私） | 接受，和页面标题同等对待；隐私说明里写清楚。记录内容始终不发送                    |

## 10. 「AI 读不到用户数据」如何保证

创始人要求：一定要保证 AI 不能读到用户数据。实现上有三层：

1. **结构隔离**：记录只存在数据库的 `records` 表里，从不写进 `WorkspaceConfig`；发给模型的用户消息只由 `WorkspaceConfig` 和用户这句话组成（`buildUserMessage`）。
2. **接口隔离**：`AIProvider.plan(input, ctx)` 的 `ctx` 只有配置、工具目录和语言，没有数据库或文件的访问能力；规划器（服务端和 App 内两种传输方式共用）因此不可能读到记录。
3. **测试**：`apps/mobile/src/__tests__/data-journeys-test.tsx` 在界面上记一笔带特殊标记的账（含人名和金额），然后发起一次 AI 修改，检查发给 Claude 的**完整请求**和 AIProvider 收到的全部参数：数据表结构在里面，标记、人名和金额都不在。

另外，AI 也不能写记录：修改操作里没有任何读写记录的操作；涉及记录内容的请求被拒绝（`userData`）。

## 11. 实现计划（已完成）

1. **core**：schema v3（collections、字段类型、三个数据组件）、新操作、校验、`validateRecord`、筛选和统计的纯函数、修改说明、迁移、Mock 模板、提示词、评测用例。
2. **App**：`records` 存储（SQLite + 内存实现）、三个数据组件、记录编辑页、「设置 → 数据」（未使用的表、最近删除、导出 CSV）。
3. **测试**：UI 旅程（用 AI 搭记账页 → 记几笔 → 统计更新 → 撤销界面修改后记录还在 → 恢复到建表之前的版本再恢复回来，数据完整）；评测只用 Haiku。

预计和上一个里程碑（样式与页面）的工作量相当。

## 12. 公式的条件和日期（D-246 起）

公式字段（D-188）仍然只是解析成小树再计算的固定写法：

- **条件**（D-246）：`if(左边 运算符 右边, 是的时候, 不是的时候)`，运算符 `> < >= <= =`，只能写在 `if` 的第一项；可以嵌套，嵌套层数（20）和长度（200 字）的上限不变。比较的两边有一边没有值时整个公式没有值。例：`if({total} >= 100, {total} * 0.9, {total})`。
- **日期**（D-247）：日期字段 `{due}` 和 `today` 是日期，`days(从, 到)` 是相差的天数（到 − 从），两个日期可以在 `if` 里比较；日期不能加减乘除，结果必须是数字。例：「距离到期还有几天」= `days(today, {due})`，「逾期罚款」= `if({paid} > {due}, days({due}, {paid}) * 5, 0)`。日期字段为空时没有值；用到 `today` 的公式每天的值会变。

## 13. 分组统计、图表、表间引用（D-248 起）

- **分组统计**（D-248，schemaVersion 13）：`stat.groupBy` 是一个单选字段，每个选项一行（按选项顺序，没有记录的也列出），没选的记录放在最后「未选」。
- **图表**（D-249，schemaVersion 14）：`chart {collectionId, kind: bar / line / pie, aggregate: count / sum / avg, fieldId?, group: day / week / month / choice, dateField?, choiceField?, periods?, filter?, title}`。按时间分组显示最近几段（默认 7 天、8 周、6 个月），按单选字段分组每个选项一个点；饼图只能按单选分，超过 7 块合成「其他」。分组和几何在 `core/chart.ts`，App 用 View 画柱子、Skia `Path` 画折线和饼图。
- **表间引用**（D-250，schemaVersion 15）：字段 `link {collectionId}`，值是那条记录的 ID，显示它的标题字段（第一个文字字段）。被引用的记录删掉时值保留、显示「已删除的记录」，恢复后显示回来；别的表还引用一张表时不能移除它（先移除引用字段）。筛选只有「有没有选」，不能按它排序。不做反向列表、多选和级联删除。
- **到期提醒**（D-251，schemaVersion 16）：`reminders` 里 `schedule: dateField` 的提醒按一张表的日期字段，在到期前 `daysBefore` 天的 `time` 用本地通知提醒；记录在本机读、正文在本机生成且只写表名（会出现在锁屏上，不写记录标题，P-043 ②），配置里只有设置。点提醒只打开页面或快捷操作，不运行。
