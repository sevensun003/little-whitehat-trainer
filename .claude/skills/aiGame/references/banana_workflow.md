# Banana 生图工作流程 · Banana Workflow

所有角色素材生成、替换、风格一致性维护的操作手册。主 SKILL.md 第 12 节的详细展开。

---

## 一、为什么这样做

项目初期用占位图(Phaser Graphics 直接画)快速搭骨架,**将来切换到 Banana 生成图**时要保证:

1. **风格不跑偏**:所有角色同源,不会出现"一半卡通一半写实"
2. **换图不改代码**:只替换 `assets/sprites/` 下的 PNG 文件
3. **可复现**:将来要重画某角色,用同样的 prompt 能出差不多的效果

---

## 二、三层提示词架构

```
┌────────────────────────────────────────────────┐
│  Layer 1: _STYLE_GUIDE.prompt.txt              │
│  (全局风格锚点,所有角色继承)                    │
├────────────────────────────────────────────────┤
│  Layer 2: {角色}.prompt.txt                     │
│  (单角色细节:颜色、装饰、表情)                  │
├────────────────────────────────────────────────┤
│  Layer 3: [在线时追加的参考图]                   │
│  (首次满意的图作为风格标杆)                      │
└────────────────────────────────────────────────┘
```

**喂给 Banana 时的拼装顺序**:
```
[Layer 1 全文]
---
[Layer 2 全文]
---
[可选:附带 Layer 3 图像作为参考]
```

---

## 三、操作步骤(每次生图)

### Step 1: 打开全局风格锚点

```
文件:assets/_prompts/_STYLE_GUIDE.prompt.txt
操作:全文复制到剪贴板 A
```

### Step 2: 打开目标角色文件

```
文件:assets/_prompts/{角色英文名}.prompt.txt
操作:全文复制到剪贴板 B
```

### Step 3: 拼接喂给 Banana

在 Banana 的 prompt 输入框内:
```
[粘贴剪贴板 A 的全部内容]

---

[粘贴剪贴板 B 的全部内容]
```

如果有 **标杆参考图**(REFERENCE.png),上传作为参考输入。

### Step 4: 生成并审核

按 **视觉检查清单**(第五节)逐条检查。不合格重来,并记录失败原因。

### Step 5: 保存素材

```
默认姿态   → assets/sprites/{角色}.png
首次满意的  → assets/sprites/{角色}_REFERENCE.png  (永久保留)
其他姿态   → assets/sprites/{角色}_happy.png
            → assets/sprites/{角色}_sleepy.png
            → ...
```

### Step 6: 更新提示词档案

如果在生图过程中发现某些细节 Banana 容易出错,**回去修改 prompt 文件**,把经验固化进去。比如:
- "Banana 总画出腿,需要在 prompt 里重复强调 NO LEGS"
- "某颜色 Banana 画不准,改用具体色号"

---

## 四、视觉检查清单(每张图必过)

### 结构检查
- [ ] 大圆头 + 梯形身体
- [ ] 无手、无脚、无脖子
- [ ] 头占总高约 60%
- [ ] 头身连接无缝

### 面部检查
- [ ] 大椭圆眼,眼白可见
- [ ] 上眼皮压下来 = 困困感(布莱克除外)
- [ ] 黑瞳中有白高光点
- [ ] 嘴部简单(一笔或省略)
- [ ] 无夸张表情(笑得太开/瞪眼/张大嘴)

### 颜色检查
- [ ] 主色饱和鲜明
- [ ] 总色数 ≤ 4(含黑白)
- [ ] 无渐变、无阴影、无纹理
- [ ] 颜色来自预设色板

### 线条检查
- [ ] 粗黑描边(~4px at 512)
- [ ] 线条略带手绘波动感(不是完美几何)
- [ ] 周围有 3-5 条同色系抖动线

### 背景检查
- [ ] 透明背景(PNG alpha)
- [ ] 无背景元素混入

### 识别度检查
- [ ] 头顶装饰显眼,和其他角色不混淆
- [ ] 主色不重复(除非剧情需要家族感)

---

## 五、常见问题与应对

### Q1:Banana 老画出手脚怎么办?
A:在 prompt 最后重复强调:
```
STRICT REMINDER: This character has NO ARMS, NO LEGS, NO HANDS, NO FEET.
The body is a simple trapezoid pedestal with no appendages.
```

### Q2:颜色不准,出现渐变?
A:使用**具体色号**而非颜色名:
- ❌ "pink color"
- ✅ "pink #FF6B9D (flat solid, no gradient)"

### Q3:表情不是"困困",画成笑脸?
A:在 prompt 里加一句:
```
EYE EXPRESSION CRITICAL: half-closed sleepy eyes with drooping top eyelid.
NOT wide-open, NOT smiling eyes, NOT excited. 
Think "chill / just woke up / half-asleep".
```

### Q4:两个角色看起来很像?
A:区分维度不足。立刻:
1. 对比两者的头顶装饰是否真的不同
2. 对比主色是否真的不同
3. 若仍相似,增加一个维度(如一个加 blush 线,一个加眉毛)

### Q5:背景不透明?
A:明确写:
```
Output: PNG with fully transparent background (alpha channel).
NO background color, NO background elements.
```

### Q6:生成的图尺寸不对?
A:
- **角色头像用**:512×512(用于对话立绘)
- **游戏地图用**:64×64 或 48×48(用于 sprite)
- **大头像用**:512 那张,浏览器/代码里缩放

### Q7:生成多姿态时风格飘了?
A:上传第一张满意的 `_REFERENCE.png` 作为图像参考,一起喂。

---

## 六、装饰元素库(头顶装饰参考)

所有角色的头顶装饰都从下表选取(可组合 2 种),避免新增时风格不一致:

| 装饰 | 英文 | 视觉要点 |
|---|---|---|
| 兔耳 | rabbit ears | 两只竖直长耳,耳内色较浅 |
| 猫耳 | cat ears | 三角形贴头顶,较短 |
| 熊耳 | bear ears | 半圆贴头顶,圆润 |
| 尖角 | sharp horns | 短而直立,2-3 个 |
| 恶魔角 | devil horns | 短曲线,像喇叭 |
| 花草 | flowers+vines | 顶部一丛,带小花点缀 |
| 树叶 | leaves | 几片绿叶 |
| 尖发 | spiky hair | 火焰状向上 |
| 长刺发 | spiky long | 向四周炸开 |
| 光头 | bald | 无装饰,纯头顶 |
| 天线 | antennae | 两根,顶部有小球 |
| 耳机 | headphones | 横跨头顶大圆耳罩 |
| 礼帽 | fedora | 小礼帽 |
| 桶帽 | bucket hat | 倒扣的小桶 |
| 水龙头 | faucet | 带出水 |
| 数字屏 | screen | 方形电子屏当脸 |
| 厨师帽 | chef hat | 高耸白帽(未用) |
| 皇冠 | crown | 简化三角(未用) |

**未用的装饰**可用于未来新增角色。

---

## 七、群演角色批量策略

对于 C7 面馆 50 个群演机器人,**不要 50 次生图**,而是:

### 方案 A:SVG 模板 + CSS 染色

1. 让 Banana 生成一个 **SVG 版本的空白机器人**(无色填充,只有黑线)
2. 代码里用 CSS `fill` 属性动态赋色
3. 装饰从装饰库随机挑选(或从上面表中的 3-5 种)

### 方案 B:几张模板 + 染色

1. Banana 生 3-4 个不同装饰的**灰度版** PNG
2. 代码里用 Canvas 的 `globalCompositeOperation` 或 WebGL shader 染色
3. 生成 50 个视觉不同的机器人

推荐方案 A,开发成本最低。

---

## 八、图像资源命名规范

严格命名,便于代码引用:

```
assets/sprites/
├── {角色}.png                  默认姿态
├── {角色}_REFERENCE.png        标杆参考(永久保留)
├── {角色}_walk_0.png           走路帧 1
├── {角色}_walk_1.png           走路帧 2
├── {角色}_happy.png            开心表情
├── {角色}_sad.png              难过表情
├── {角色}_thinking.png         思考
└── {角色}_portrait.png         对话立绘(更大)
```

**英文名必须小写**,用连字符而非下划线(如 `fun-bot`,不是 `fun_bot`)。

---

## 九、生图失败时的降级策略

如果某角色生图反复失败:
1. **先不要硬刚**,用占位图(Phaser Graphics)先顶住
2. 在 prompt 文件里标记 `[GENERATION_DIFFICULTY: HIGH]` 和失败原因
3. 等积累经验后批量重试,不要卡住开发节奏

**记住:没有图也能玩通关,有图只是锦上添花**。项目的灵魂在玩法和剧情,不在美术。
