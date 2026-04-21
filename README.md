# 白帽小队训练营 · 婉婉的冒险

> 为 6-9 岁儿童准备的 AI 安全启蒙闯关游戏
> 赛前训练工具 · 对标 2026 "天枢杯" 青少年 AI 安全创新大赛小学低年级组

---

## 🎮 当前可玩关卡

| 关卡 | 名称 | 教学概念 | 最优步 | 状态 |
|------|------|----------|--------|------|
| T1 | 醒来的婉婉 | 方向指令 | 2 | ✅ |
| T2 | 送早餐 | 功能指令·捡起放下 | 6 | ✅ |
| T3 | 彩色信号灯 | 颜色指令 | 5 | ✅ |
| T4 | 图书馆借书证 | 凭证指令 | 4 | ✅ |
| T5 | 重复浇花 | 逻辑指令·重复 | 2 | ✅ |
| C1 | 被偷改的购物清单 | ⭐ 指令注入 | 3 | ✅ |
| C2-C9、X1-X6、M1-M3 | 其他关卡 | | | 开发中 |

---

## 🚀 本地部署(3 种方式任选)

### 方式 A:Python(最简单,推荐)

**前提**:电脑装了 Python 3(Windows / Mac / Linux 都行)。

1. 解压 `wanwan-game.tar.gz` 到任意位置(比如桌面)
2. 打开命令行进入该目录:
   ```bash
   cd wanwan-game
   ```
3. 启动本地 HTTP 服务:
   ```bash
   python -m http.server 8080
   ```
   Windows 如果报错,试 `python3 -m http.server 8080`

4. 浏览器打开:**http://localhost:8080/levels.html**

5. 停止服务:命令行窗口按 `Ctrl+C`

### 方式 B:Node.js

**前提**:装了 Node.js。

```bash
cd wanwan-game
npx serve .
```
终端会显示访问地址,通常 http://localhost:3000

### 方式 C:VS Code + Live Server(适合开发者)

1. 用 VS Code 打开 `wanwan-game` 文件夹
2. 扩展市场搜索 **"Live Server"** 并安装
3. 右键 `levels.html` → **"Open with Live Server"**
4. 自动打开浏览器,**修改文件会自动刷新**

---

## ❓ 为什么不能直接双击 index.html?

浏览器安全策略禁止 `file://` 协议读取本地 JSON 文件(就是我们的关卡数据)。
必须通过 HTTP 服务启动,以上 3 种方式都是在开启本地 HTTP。

---

## 🧪 跑测试

访问 **http://localhost:8080/tests/smoke.html**,应该看到全部绿色 ✅ 通过。

---

## 📁 项目结构

```
wanwan-game/
├── levels.html             ← 【开始这里】关卡选择页
├── index.html              ← 主游戏页(支持 ?level=T1 直接进关)
├── game.js                 ← 游戏核心逻辑(~2000行)
├── SKILL.md                ← 项目权威设计文档
├── README.md               ← 本文件
├── .gitignore              ← Git 忽略规则
│
├── levels/                 ← 关卡数据(JSON驱动,改JSON就能改关卡)
│   ├── T1.json  T2.json  T3.json  T4.json  T5.json
│   └── C1.json
│
├── assets/
│   ├── sprites/            ← (未来 Banana 生图放这里)
│   └── _prompts/           ← 🎨 23 个角色的 Banana 生图提示词
│       ├── _STYLE_GUIDE.prompt.txt   全局风格锚点
│       ├── wanwan.prompt.txt         主角·婉婉
│       ├── xiaotian.prompt.txt       AI·小天
│       └── ... 其余 21 个
│
├── references/             ← 详细设计文档
│   ├── story_bible.md      完整 23 关剧情 + 134 条对话
│   ├── character_roster.md 角色 × 关卡分配表
│   ├── level_template.md   关卡 JSON 规范
│   ├── banana_workflow.md  生图工作流(三层提示词架构)
│   └── ai_playbook.md      给未来 AI 开发者的工作指南
│
├── tests/
│   └── smoke.html          冒烟测试页面
│
└── coach/                  ← (未来家长报告页)
```

---

## 🎨 未来生图工作流(Banana / Nano Banana)

当您想把占位图换成真正的角色画时:

1. 打开 `assets/_prompts/_STYLE_GUIDE.prompt.txt`,**全文复制**
2. 打开要生成的角色 `.prompt.txt`,追加到上面
3. 两段一起喂给 Banana
4. 生成的 PNG 保存到 `assets/sprites/{角色名}.png`
5. **刷新浏览器,角色图就自动替换**(代码无需改动)

详细流程见 `references/banana_workflow.md`。

---

## 🐛 常见问题

**关卡加载失败?**
→ 检查是不是用 `file://` 直接打开了。必须用 HTTP 服务。

**语音朗读没声音?**
→ 浏览器首次访问可能拦截自动播放,点任意按钮后再试。Chrome 中文音色最好。

**端口 8080 被占用?**
→ 换别的:`python -m http.server 9999`

**Safari 显示异常?**
→ 建议用 Chrome 或 Edge。游戏用了 ES2020+ 语法,Safari 15 以下可能不稳。

**改了 JSON 没生效?**
→ 浏览器缓存,按 `Ctrl+Shift+R`(Mac: `Cmd+Shift+R`)强制刷新。

---

## 📊 数据持久化

- **进度存储**:浏览器 LocalStorage(键名 `wanwan_progress`)
- **清理浏览器数据会丢进度**:所以 `levels.html` 提供了「💾 导出进度」按钮,可以下载 JSON 备份
- **多设备不同步**:单机本地游戏,无云端后端

---

## 🎯 项目设计原则(摘要,完整版见 SKILL.md)

**三条儿童友好铁律**:

1. **每句对话 ≤ 20 字**,全部支持语音朗读
2. **失败不扣分不打叉**,只给温柔的"再试一次"
3. **步数用按钮选,不用键盘打字**

**六条架构硬约束**:

1. 单文件 HTML 可预览,**不需要 npm build**
2. Phaser 3(CDN)+ 原生 DOM 混合架构
3. **关卡数据 JSON 驱动**,严禁代码里写死
4. 素材路径统一 `assets/sprites/`,未来替换不改代码
5. 每个角色配同名 `.prompt.txt`,保证换图风格一致
6. 进度用 LocalStorage + 导出 JSON 备份,无云同步

---

## 📝 关于

本项目献给我的女儿。
愿她在玩中建立"安全即本能"的思维方式。

*2026*
