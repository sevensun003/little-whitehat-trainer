# 关卡 JSON 规范 · Level Template

所有关卡的数据格式规范与设计模板。主 SKILL.md 第 11.2 节的详细展开。

---

## 一、关卡 JSON 完整字段表

```json
{
  "id": "T1",
  "title": "醒来的婉婉",
  "act": 1,
  "chapter": "学徒篇",
  "location": "婉婉的卧室",
  "concept_intro": "方向指令",

  "available_commands": ["direction"],

  "intro_dialog": [
    { "speaker": "小天", "text": "..." }
  ],

  "map": {
    "size": [10, 8],
    "tileset": "bedroom",
    "floor_tiles": "wood",
    "walls": [
      { "x": 0, "y": 0, "w": 10, "h": 1 }
    ],
    "objects": [
      { "type": "bed", "pos": [1, 2], "size": [2, 2] }
    ]
  },

  "entities": [
    { "id": "player", "type": "wanwan", "start_pos": [2, 2], "facing": "down" },
    { "id": "goal", "type": "door", "pos": [8, 6], "goal": true }
  ],

  "available_command_cards": [
    {
      "id": "move_up",
      "category": "direction",
      "label": "向上",
      "icon": "arrow_up",
      "action": "move",
      "dir": "up",
      "steps_input": true
    }
  ],

  "success_condition": {
    "type": "reach_goal",
    "entity": "player",
    "goal_id": "goal"
  },

  "optimal_steps": 2,
  "max_hint_level": 3,

  "hints": [
    { "level": 1, "text": "先向右走几步,再向下走。" },
    { "level": 2, "text": "向右走6步,再向下走4步。" },
    { "level": 3, "text": "按顺序拖入:..." }
  ],

  "on_clear_dialog": [
    { "speaker": "小天", "text": "..." }
  ],

  "rewards": {
    "unlock_next": "T2",
    "unlock_character": null,
    "first_time_dialog_card": "direction_card_explained"
  }
}
```

---

## 二、字段详解

### 2.1 基本信息

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | ✓ | 唯一 ID,与文件名一致(如 "T1") |
| `title` | string | ✓ | 关卡名(中文) |
| `act` | number | ✓ | 第几幕(1/2/3) |
| `chapter` | string |  | 章节名 |
| `location` | string |  | 地点描述 |
| `concept_intro` | string | ✓ | 本关学习重点(一句话) |

### 2.2 指令系统

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `available_commands` | string[] | ✓ | 开放的指令类别:`direction`/`color`/`function`/`credential`/`logic` |
| `available_command_cards` | object[] | ✓ | 具体指令卡(下详) |

**available_command_cards 子字段**:
- `id`:卡片唯一 ID
- `category`:类别(对应 available_commands)
- `label`:显示名(中文)
- `icon`:图标 ID(`arrow_up` 等)
- `action`:动作名(`move`/`pickup`/`drop`/`color_change` 等)
- `dir`:方向(仅 move 用)
- `steps_input`:是否需要步数输入弹窗
- `params`:其他参数(如颜色卡的 `color` 字段)

### 2.3 地图与实体

**map.size**:`[cols, rows]`,**默认 10×8,最大 12×10**
**map.objects**:静态装饰物(家具、植物、装饰)
**entities**:有逻辑意义的对象(玩家、终点、NPC、可捡起物、钥匙等)

### 2.4 胜利条件

```json
"success_condition": {
  "type": "reach_goal",    // 到达终点
  "entity": "player",
  "goal_id": "goal"
}
```

其他 type:
- `"collect_all"` — 收集所有指定物品
- `"sequence"` — 按顺序触发多个事件
- `"custom"` — 自定义判定(需配套代码)

### 2.5 提示系统(必须 3 级)

```json
"hints": [
  { "level": 1, "text": "方向性提示" },
  { "level": 2, "text": "具体步数提示" },
  { "level": 3, "text": "完整答案演示" }
]
```

**每关必须完整提供 3 级**,不可少于 3 级,不可超过 3 级。

### 2.6 奖励

- `unlock_next`:解锁下一关 ID,`null` 表示本幕结束
- `unlock_character`:是否解锁新角色加入队伍(C1/C2/C3 专用)
- `first_time_dialog_card`:首次通关后展示的概念卡 ID

---

## 三、三类关卡设计模板

### 3.1 教学关 (T1-T5)

**设计目标**:引入一类**新**指令,让孩子熟练使用;同时允许此前已学过的指令作为基础工具存在

**设计原则**:
- 本关要**新引入**的指令类别**只有 1 类**(绝对纯净的教学焦点)
- 可以**同时开放**之前关卡教过的类别作为辅助(例:T2 学功能,但方向是必需的基础能力)
- `available_commands` 的**第一项**视为"本关主讲"
- `optimal_steps` ≤ 8(教学关步数上限,从原 ≤5 放宽)
- 无陷阱、无复杂逻辑
- `hints` 第 1 级非常温和("试试用 X 指令")
- 通关对话 2-3 句,不讲概念,只强化操作

**地图规模**:建议 8×6 到 10×8

**示例**:T1 只给方向指令,只要移动到门口,地图上无其他干扰

### 3.2 概念关 (C1-C9)

**设计目标**:植入一个信息安全概念的攻方思维

**设计原则**:
- `available_commands` 可组合 2-3 类(但仍有主导类别)
- `optimal_steps` ≤ 10
- 必须有"意图反转"时刻(正常思路通不过,换攻方视角才通)
- 通关对话**必须包含三要素**:
  1. 概念名称
  2. 生活类比
  3. 防御建议

**地图规模**:10×8

**示例**:C2 红钥匙关,必须有"苹果代替钥匙"这种意图反转,才能体现凭证窃取思维

### 3.3 综合关 (X1-X6)

**设计目标**:组合多个概念和指令类别

**设计原则**:
- `available_commands` 通常 3-5 类
- `optimal_steps` 10-20
- 有多条解法路径
- `hints` 第 1 级只给**整体策略**,不给具体操作
- 通关对话可以更长,铺剧情

**地图规模**:10×8 到 12×10

### 3.4 模拟赛(M1-M3)

**设计目标**:还原官方《指令工厂》赛题体感

**特殊约束**:
- 开考前弹录屏准备页
- 计时器 60 分钟
- 隐藏提示按钮
- 隐藏重来按钮(只能当题重置)
- 题目难度递增
- 每套 3 题,合计用时约 45-55 分钟

**数据结构**:模拟赛用独立 JSON schema,见下节

---

## 四、模拟赛 JSON 示例

```json
{
  "id": "mock-1",
  "type": "mock_contest",
  "title": "模拟赛 1 · 指令基础综合",
  "time_limit_seconds": 3600,
  "recording_reminder": true,
  "hide_hints": true,
  "hide_reset": "per_question",
  "questions": [
    {
      "id": "mock-1-q1",
      "difficulty": 1,
      "time_suggested": 600,
      "level_json_inline": { /* 完整关卡数据 */ }
    },
    {
      "id": "mock-1-q2",
      "difficulty": 2,
      "time_suggested": 1200,
      "level_json_inline": { /* ... */ }
    },
    {
      "id": "mock-1-q3",
      "difficulty": 3,
      "time_suggested": 1800,
      "level_json_inline": { /* ... */ }
    }
  ],
  "scoring": {
    "per_question_max": 100,
    "time_bonus": true,
    "optimal_path_bonus": 20
  }
}
```

---

## 五、关卡设计 checklist(每关必过)

设计一个新关卡时,按顺序检查:

- [ ] 关卡 ID 与文件名一致
- [ ] 地图尺寸合规(≤ 12×10)
- [ ] `available_commands` 符合关卡定位(教学关纯净 / 概念关主导 / 综合关混合)
- [ ] 玩家起点和终点都在地图内
- [ ] `optimal_steps` 人工验算过
- [ ] **所有对话 ≤ 20 字/句**
- [ ] **对话避免抽象词**
- [ ] **3 级提示齐全**,梯度合理
- [ ] 概念关的通关对话包含三要素(概念名/类比/防御)
- [ ] 冒烟测试补了对应检查条目
