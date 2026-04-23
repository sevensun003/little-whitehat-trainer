/* ============================================================
   白帽小队训练营 - 主游戏逻辑
   架构要点:
   - Phaser 负责游戏画面(地图、角色、动画)
   - 原生 DOM 负责 UI(指令栏、队列、对话框)—— 6-9岁触控更友好
   - 关卡数据全部走 JSON,改关卡不改代码
   ============================================================ */

// ========== 全局游戏状态 ==========
const G = {
  currentLevel: null,       // 当前关卡数据
  commandQueue: [],         // 用户搭建的指令队列
  player: null,             // Phaser 玩家对象
  goalPos: null,            // 终点坐标
  isRunning: false,         // 指令是否正在执行
  tileSize: 48,             // 地图格子像素大小(屏幕自适应时会调整)
  mapOriginX: 0,            // 地图左上角屏幕 X
  mapOriginY: 0,            // 地图左上角屏幕 Y
  hintLevel: 0,             // 当前提示等级(0-3)
  phaserScene: null,        // Phaser Scene 引用
  progress: loadProgress()  // 用户进度(localStorage)
};

// ========== 进度持久化 ==========
function loadProgress() {
  try {
    return JSON.parse(localStorage.getItem('wanwan_progress') || '{}');
  } catch {
    return {};
  }
}

function saveProgress() {
  localStorage.setItem('wanwan_progress', JSON.stringify(G.progress));
}

function markLevelCleared(levelId) {
  G.progress[levelId] = {
    cleared: true,
    clearedAt: Date.now(),
    steps: G.commandQueue.length
  };
  saveProgress();
}

// ========== 语音朗读(Web Speech API) ==========
function speak(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'zh-CN';
  u.rate = 0.9;   // 稍慢,方便低龄
  u.pitch = 1.1;  // 稍高,亲切
  window.speechSynthesis.speak(u);
}

// 清理所有循环计时器(防止 loop_npc 在 scene.restart 后遗留定时器)
function _clearLoopTimers() {
  if (!G.entities) return;
  Object.values(G.entities).forEach(en => {
    if (en && en._loopTimer) {
      clearInterval(en._loopTimer);
      en._loopTimer = null;
    }
  });
}

// ========== 关卡加载 ==========
async function loadLevel(levelId) {
  const res = await fetch(`levels/${levelId}.json?v=2026.04.23e`);
  if (!res.ok) throw new Error(`关卡 ${levelId} 加载失败`);
  const data = await res.json();

  // 模考关:特殊处理
  if (data.contest_mode && Array.isArray(data.stages)) {
    G.contest = {
      id: data.id,
      title: data.title,
      stages: data.stages,
      currentStageIndex: 0,
      stageTimes: [],
      stageStartAt: 0,
      contestStartAt: 0,
      totalLimit: data.time_limit_seconds || 3600,
      introDialog: data.intro_dialog || []
    };
    await showContestPrepModal(data);
    G.contest.contestStartAt = Date.now();
    G.contest.stageStartAt = Date.now();
    enterContestMode();
    return loadLevel(data.stages[0]);
  }

  G.currentLevel = data;
  G.commandQueue = [];
  G.hintLevel = 0;
  G._hintShown = new Set();   // 新关卡重置已弹出的线索记录
  G.giftsOpened = 0;
  G.trojanTriggered = 0;
  G.buttonPressed = false;
  G._pendingInject = null;
  if (typeof _editTarget !== 'undefined') _editTarget = null;

  // 支持预填队列(概念关用来展示"被篡改的队列"等初始状态)
  applyPresetQueue();

  // 模考中显示不同的关卡标题
  if (G.contest) {
    const stageNum = G.contest.currentStageIndex + 1;
    const total = G.contest.stages.length;
    document.getElementById('level-title').textContent =
      `${G.contest.id} · 第 ${stageNum}/${total} 题 · ${data.title}`;
    document.getElementById('level-concept').textContent = `【模考中】`;
  } else {
    document.getElementById('level-title').textContent = `${data.id} · ${data.title}`;
    document.getElementById('level-concept').textContent = `【学习:${data.concept_intro}】`;
  }

  renderCommandCards(data.available_command_cards);
  renderQueue();

  // 每关开局:提示按钮进入 3 分钟锁
  armHintButtonLock();

  if (G.phaserScene) {
    _clearLoopTimers();
    G.phaserScene.scene.restart({ levelData: data });
  }
}

// ========== 模考:录屏准备 + 计时器 + 流程控制 ==========
function showContestPrepModal(contestData) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed; inset:0; background:rgba(0,0,0,0.7);
      display:flex; align-items:center; justify-content:center;
      z-index:300;
    `;
    const box = document.createElement('div');
    box.style.cssText = `
      background: linear-gradient(180deg, #FFE4B5, #FFF5E6);
      border: 6px solid #D4AC0D;
      border-radius: 24px;
      padding: 26px 30px; max-width: 480px;
      box-shadow: 0 8px 0 rgba(0,0,0,0.2);
      text-align: center;
    `;
    box.innerHTML = `
      <div style="font-size:42px; margin-bottom:6px;">📱</div>
      <div style="font-size:22px; font-weight:bold; color:#6B4423; margin-bottom:10px;">录屏准备</div>
      <div style="font-size:15px; color:#6B4423; line-height:1.6; text-align:left; margin-bottom:14px;">
        请大人用手机:
        <ol style="margin-left:22px; margin-top:6px; line-height:1.8;">
          <li>架在婉婉 <strong>侧后方 45°</strong></li>
          <li>画面拍到 <strong>屏幕 + 双手 + 上半身 + 桌面</strong></li>
          <li>开始录屏</li>
        </ol>
      </div>
      <div style="font-size:13px; color:#8B5A3C; margin-bottom:14px;">
        模考中:<br>
        ⛔ 不能用提示  ⛔ 不能重来  ⏱️ 60 分钟倒计时
      </div>
      <button id="btn-contest-start" style="padding:12px 30px; border:3px solid #6B4423; border-radius:12px; background:#66CC66; color:#FFF; font-size:18px; font-weight:bold; cursor:pointer;">
        准备好了,开始!
      </button>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    document.getElementById('btn-contest-start').onclick = () => {
      overlay.remove();
      resolve();
    };
  });
}

function enterContestMode() {
  // 隐藏 提示 / 重来 按钮
  const hintBtn = document.getElementById('btn-hint');
  const resetBtn = document.getElementById('btn-reset');
  if (hintBtn) hintBtn.style.display = 'none';
  if (resetBtn) resetBtn.style.display = 'none';

  // 插入或更新计时器
  let timer = document.getElementById('contest-timer');
  if (!timer) {
    timer = document.createElement('span');
    timer.id = 'contest-timer';
    timer.style.cssText = `
      margin-left: 16px; padding: 4px 12px;
      background: #E74C3C; color: #FFF;
      font-weight: bold; font-size: 16px;
      border-radius: 10px;
    `;
    const topbar = document.querySelector('#topbar .level-info');
    if (topbar) topbar.appendChild(timer);
  }
  if (G._contestTicker) clearInterval(G._contestTicker);
  const update = () => {
    if (!G.contest) return;
    const elapsed = Math.floor((Date.now() - G.contest.contestStartAt) / 1000);
    const remain = Math.max(0, G.contest.totalLimit - elapsed);
    const m = Math.floor(remain / 60);
    const s = remain % 60;
    timer.textContent = `⏱ ${m}:${String(s).padStart(2,'0')}`;
    // 最后 5 分钟变色
    timer.style.background = remain < 300 ? '#C0392B' : '#E67E22';
    if (remain === 0) {
      clearInterval(G._contestTicker);
      finishContest(true);
    }
  };
  update();
  G._contestTicker = setInterval(update, 1000);
}

function exitContestMode() {
  const hintBtn = document.getElementById('btn-hint');
  const resetBtn = document.getElementById('btn-reset');
  if (hintBtn) hintBtn.style.display = '';
  if (resetBtn) resetBtn.style.display = '';
  if (G._contestTicker) clearInterval(G._contestTicker);
  G._contestTicker = null;
  const timer = document.getElementById('contest-timer');
  if (timer) timer.remove();
}

function advanceContestStage() {
  if (!G.contest) return false;
  const dt = Math.floor((Date.now() - G.contest.stageStartAt) / 1000);
  G.contest.stageTimes.push(dt);
  G.contest.currentStageIndex += 1;
  if (G.contest.currentStageIndex >= G.contest.stages.length) {
    finishContest(false);
    return true;
  }
  G.contest.stageStartAt = Date.now();
  loadLevel(G.contest.stages[G.contest.currentStageIndex]);
  return true;
}

function finishContest(timeout) {
  const contest = G.contest;
  if (!contest) return;
  const totalSec = Math.floor((Date.now() - contest.contestStartAt) / 1000);
  const finished = contest.stageTimes.length;
  const total = contest.stages.length;

  exitContestMode();
  G.contest = null;

  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position:fixed; inset:0; background:rgba(0,0,0,0.6);
    display:flex; align-items:center; justify-content:center;
    z-index:400;
  `;
  const box = document.createElement('div');
  box.style.cssText = `
    background: linear-gradient(180deg, #FFFACD, #FFE4B5);
    border: 6px solid #D4AC0D; border-radius: 24px;
    padding: 26px 30px; max-width: 460px;
    box-shadow: 0 8px 0 rgba(0,0,0,0.2);
    text-align: center;
  `;
  const passed = !timeout && finished === total;
  const stageLis = contest.stages.map((sid, i) => {
    const t = contest.stageTimes[i];
    return `<li>第 ${i+1} 题 · ${sid}:${t !== undefined ? `${t} 秒 ✅` : '未完成 ⏳'}</li>`;
  }).join('');
  const mm = Math.floor(totalSec / 60);
  const ss = String(totalSec % 60).padStart(2,'0');
  box.innerHTML = `
    <div style="font-size:42px;">${passed ? '🏆' : '⏰'}</div>
    <div style="font-size:22px; font-weight:bold; color:#6B4423; margin:8px 0;">
      ${passed ? '模考通过!' : '时间到'}
    </div>
    <div style="font-size:16px; color:#8B5A3C;">
      总用时:<strong>${mm}:${ss}</strong>  ·  完成 ${finished}/${total}
    </div>
    <ul style="text-align:left; margin:16px 0; padding-left:22px; color:#6B4423;">
      ${stageLis}
    </ul>
    <div style="display:flex; gap:10px; justify-content:center;">
      <button id="btn-contest-back" style="padding:12px 20px; border:3px solid #6B4423; border-radius:12px; background:#FFF; font-weight:bold; cursor:pointer;">🗺️ 回地图</button>
      <button id="btn-contest-retry" style="padding:12px 20px; border:3px solid #6B4423; border-radius:12px; background:#FFE4B5; font-weight:bold; cursor:pointer;">🔄 再来一次</button>
    </div>
  `;
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  // 记录进度
  if (passed) {
    G.progress[contest.id] = {
      cleared: true,
      clearedAt: Date.now(),
      totalSeconds: totalSec,
      stageTimes: contest.stageTimes
    };
    saveProgress();
  }

  document.getElementById('btn-contest-back').onclick = () => {
    window.location.href = 'levels.html';
  };
  document.getElementById('btn-contest-retry').onclick = () => {
    overlay.remove();
    loadLevel(contest.id);
  };
}

// 应用预填队列(loadLevel 加载、重来按钮、再玩一次 都需要调用)
function applyPresetQueue() {
  const data = G.currentLevel;
  if (Array.isArray(data?.preset_queue)) {
    G.commandQueue = data.preset_queue.map(c => ({ ...c }));
  }
}

// ========== 指令卡渲染 ==========
function renderCommandCards(cards) {
  const container = document.getElementById('cmd-list');
  container.innerHTML = '';

  // 空指令手册:这是概念关(审视/修改预填队列),显示友好引导而不是空白
  if (!cards || cards.length === 0) {
    const tip = document.createElement('div');
    tip.style.cssText = 'padding:10px 8px; text-align:center; color:#6B4423; font-size:13px; line-height:1.6;';
    // 关卡 JSON 可以通过 manual_tip 字段自定义提示文字
    const customTip = G.currentLevel?.manual_tip;
    const defaultTip = `🔍 这一关要<br><strong>检查队列</strong><br>不用加新指令<br><br>看右边队列<br>删掉<strong>不对</strong>的指令<br>再按 ▶ 执行`;
    tip.innerHTML = customTip || defaultTip;
    container.appendChild(tip);
    return;
  }

  // 按类别分组
  const groups = {};
  cards.forEach(c => {
    if (!groups[c.category]) groups[c.category] = [];
    groups[c.category].push(c);
  });

  const categoryNames = {
    direction: '方向',
    color: '颜色',
    function: '功能',
    credential: '凭证',
    logic: '逻辑',
    social: '社交',
    time: '时间',
    guess: '询问',
    password: '密码',
    virus: '清理',
    gift: '礼物',
    backend: '后端'
  };

  for (const cat in groups) {
    const title = document.createElement('h3');
    title.textContent = categoryNames[cat] || cat;
    container.appendChild(title);

    groups[cat].forEach(card => {
      const div = document.createElement('div');
      div.className = 'cmd-card';
      div.dataset.cardId = card.id;
      const iconMap = {
        arrow_up: '⬆️', arrow_down: '⬇️',
        arrow_left: '⬅️', arrow_right: '➡️',
        hand_grab: '✋', hand_drop: '👐',
        color_red: '🔴', color_yellow: '🟡', color_green: '🟢',
        color_blue: '🔵', color_white: '⚪',
        credential_take: '🪪',
        water_drop: '💧', repeat_loop: '🔁',
        buy_milk: '🥛', buy_icecream: '🍦', buy_bread: '🍞',
        social_engineer: '🕴️', hourglass: '⏳',
        send_noise: '📢', press_button: '🔘',
        ask_hint: '❓', break_mirror: '🔨',
        keypad: '🔢', cable_cut: '✂️', inspect_gift: '🎁',
        keypad_letter: '🔤', choose_reply: '💬', clean_virus: '🧹',
        open_gift: '📦', deploy_backend: '🛠️'
      };
      div.innerHTML = `<span class="icon">${iconMap[card.icon] || '●'}</span> ${card.label}`;
      div.onclick = () => onCardClick(card);
      container.appendChild(div);
    });
  }
}

// ========== 卡片点击(6-9岁:点击比拖拽更友好) ==========
// 当前编辑目标:null = 主队列,或 {containerCmd} = 某个容器的 body
let _editTarget = null;

function getEditQueue() {
  return _editTarget ? _editTarget.body : G.commandQueue;
}

function onCardClick(card) {
  if (G.isRunning) return;
  // 不允许在容器里再放容器(低龄友好:避免嵌套复杂度)
  if (_editTarget && card.is_container) {
    return;
  }
  // E5 注入关:injectable 卡片不直接 push,而是进入"选位置"模式
  if (card.injectable && G.currentLevel?.inject_mode) {
    if (G.commandQueue.some(c => c.id === card.id)) {
      // 已经插过了;先删除再允许重插
      G.commandQueue = G.commandQueue.filter(c => c.id !== card.id);
    }
    G._pendingInject = card;
    renderQueue();
    return;
  }
  if (card.steps_input) {
    openStepInput(card);
  } else if (card.times_input) {
    openTimesInput(card);
  } else {
    getEditQueue().push({ ...card, steps: 1 });
    renderQueue();
  }
}

// ========== 步数输入弹窗 ==========
let _pendingCard = null;
let _pendingSteps = 1;

function openStepInput(card) {
  _pendingCard = card;
  _pendingSteps = 1;
  document.getElementById('step-input-title').textContent = `${card.label}——走几步？`;
  const btns = document.getElementById('step-buttons');
  btns.innerHTML = '';
  for (let i = 1; i <= 9; i++) {
    const b = document.createElement('button');
    b.className = 'step-btn' + (i === 1 ? ' active' : '');
    b.textContent = i;
    b.onclick = () => {
      _pendingSteps = i;
      btns.querySelectorAll('.step-btn').forEach(el => el.classList.remove('active'));
      b.classList.add('active');
    };
    btns.appendChild(b);
  }
  document.getElementById('step-input-overlay').classList.add('show');
}

function closeStepInput() {
  document.getElementById('step-input-overlay').classList.remove('show');
  _pendingCard = null;
}

// 次数输入:共用步数输入 UI,但确认时创建 container 卡
function openTimesInput(card) {
  _pendingCard = card;
  _pendingSteps = 2; // 默认 2 次,最小有意义的重复
  document.getElementById('step-input-title').textContent = `${card.label}——几次?`;
  const btns = document.getElementById('step-buttons');
  btns.innerHTML = '';
  for (let i = 2; i <= 9; i++) {
    const b = document.createElement('button');
    b.className = 'step-btn' + (i === 2 ? ' active' : '');
    b.textContent = i;
    b.onclick = () => {
      _pendingSteps = i;
      btns.querySelectorAll('.step-btn').forEach(el => el.classList.remove('active'));
      b.classList.add('active');
    };
    btns.appendChild(b);
  }
  // 打标记,让"确定"知道这是 times 不是 steps
  _pendingCard._asTimes = true;
  document.getElementById('step-input-overlay').classList.add('show');
}

document.getElementById('btn-step-cancel').onclick = closeStepInput;
document.getElementById('btn-step-confirm').onclick = () => {
  if (_pendingCard) {
    if (_pendingCard._asTimes) {
      // 创建容器卡(repeat)
      const { _asTimes, ...cardBase } = _pendingCard;
      getEditQueue().push({ ...cardBase, times: _pendingSteps, body: [] });
    } else {
      getEditQueue().push({ ..._pendingCard, steps: _pendingSteps });
    }
    renderQueue();
  }
  closeStepInput();
};

// ========== 队列渲染 ==========
function renderQueue() {
  const list = document.getElementById('queue-list');
  list.innerHTML = '';

  // E5 注入模式:待插入的卡和每两个指令之间的 "➕" 槽
  const inject = G._pendingInject;

  // 构建插入槽
  const makeSlot = (pos) => {
    const slot = document.createElement('div');
    slot.style.cssText = `
      min-width: 24px; height: 48px;
      border: 2px dashed #E67E22; border-radius: 8px;
      background: #FFF3E0;
      display:flex; align-items:center; justify-content:center;
      font-size: 18px; color:#E67E22; font-weight:bold;
      cursor:pointer; flex-shrink: 0;
    `;
    slot.textContent = '➕';
    slot.title = '在这里插入';
    slot.onclick = () => {
      G.commandQueue.splice(pos, 0, { ...inject, steps: 1 });
      G._pendingInject = null;
      renderQueue();
    };
    return slot;
  };

  // 如果是 inject_mode 且有待插卡,首位也放一个槽
  if (G.currentLevel?.inject_mode && inject) {
    list.appendChild(makeSlot(0));
  }

  // 主队列渲染
  G.commandQueue.forEach((item, idx) => {
    const div = document.createElement('div');
    div.className = 'queue-item';

    if (item.action === 'repeat') {
      // 容器卡:显示 "🔁 重复 N 次 [ 内容预览 ]"
      const bodyPreview = (item.body || []).length > 0
        ? (item.body.map(c => c.label + (c.action === 'move' && c.steps > 1 ? c.steps : '')).join('+'))
        : '空';
      const isBeingEdited = _editTarget === item;
      div.style.background = isBeingEdited ? '#FFE4B5' : '#FFFACD';
      div.style.border = isBeingEdited ? '3px solid #D4AC0D' : '2px solid #6B4423';
      div.innerHTML = `
        ${idx + 1}. 🔁 重复 ${item.times} 次
        <span class="repeat-body" style="margin-left:4px; padding:2px 6px; background:#FFF; border:2px dashed #CCC; border-radius:6px; font-size:12px;">${bodyPreview}</span>
        <span class="edit" title="${isBeingEdited ? '完成编辑' : '编辑内容'}" style="color:#3498DB; cursor:pointer; margin-left:6px; font-weight:bold;">${isBeingEdited ? '✓' : '✎'}</span>
        <span class="remove" title="删除">×</span>
      `;
      div.querySelector('.edit').onclick = (e) => {
        e.stopPropagation();
        _editTarget = (_editTarget === item) ? null : item;
        renderQueue();
        updateEditBanner();
      };
    } else {
      // 避免 label 已经含"步"时再重复追加
      const labelHasSteps = /\d+\s*步/.test(item.label || '');
      const stepText = (item.action === 'move' && item.steps > 1 && !labelHasSteps) ? ` ${item.steps} 步` : '';
      const iconMap = {
        arrow_up: '⬆️', arrow_down: '⬇️',
        arrow_left: '⬅️', arrow_right: '➡️',
        hand_grab: '✋', hand_drop: '👐',
        color_red: '🔴', color_yellow: '🟡', color_green: '🟢',
        color_blue: '🔵', color_white: '⚪',
        credential_take: '🪪',
        water_drop: '💧', repeat_loop: '🔁',
        buy_milk: '🥛', buy_icecream: '🍦', buy_bread: '🍞',
        social_engineer: '🕴️', hourglass: '⏳',
        send_noise: '📢', press_button: '🔘',
        ask_hint: '❓', break_mirror: '🔨',
        keypad: '🔢', cable_cut: '✂️', inspect_gift: '🎁',
        keypad_letter: '🔤', choose_reply: '💬', clean_virus: '🧹',
        open_gift: '📦', deploy_backend: '🛠️'
      };
      const iconStr = iconMap[item.icon] ? iconMap[item.icon] + ' ' : '';
      div.innerHTML = `
        ${idx + 1}. ${iconStr}${item.label}${stepText}
        <span class="remove" title="删除">×</span>
      `;
    }

    div.querySelector('.remove').onclick = (e) => {
      e.stopPropagation();
      // 如果正在编辑的就是这个容器,先取消编辑
      if (_editTarget === item) _editTarget = null;
      G.commandQueue.splice(idx, 1);
      renderQueue();
      updateEditBanner();
    };
    list.appendChild(div);

    // 注入模式:每个指令后也放一个插入槽
    if (G.currentLevel?.inject_mode && inject) {
      list.appendChild(makeSlot(idx + 1));
    }
  });

  // 如果正在编辑某个容器,把容器内部的指令也显示一行
  if (_editTarget) {
    const container = document.createElement('div');
    container.style.cssText = 'flex-basis:100%; margin-top:6px; padding:6px; background:#FFF8DC; border:2px dashed #D4AC0D; border-radius:8px;';
    container.innerHTML = `<div style="font-size:12px; color:#8B5A3C; margin-bottom:4px;">📦 重复 ${_editTarget.times} 次的内容(点左侧卡片加入):</div>`;
    const innerList = document.createElement('div');
    innerList.style.cssText = 'display:flex; gap:4px; flex-wrap:wrap;';
    (_editTarget.body || []).forEach((bItem, bIdx) => {
      const bDiv = document.createElement('div');
      bDiv.className = 'queue-item';
      bDiv.style.padding = '4px 8px';
      bDiv.style.fontSize = '12px';
      const labelHasSteps2 = /\d+\s*步/.test(bItem.label || '');
      const stepText = (bItem.action === 'move' && bItem.steps > 1 && !labelHasSteps2) ? ` ${bItem.steps}步` : '';
      bDiv.innerHTML = `${bItem.label}${stepText} <span class="remove" style="margin-left:4px;">×</span>`;
      bDiv.querySelector('.remove').onclick = (e) => {
        e.stopPropagation();
        _editTarget.body.splice(bIdx, 1);
        renderQueue();
      };
      innerList.appendChild(bDiv);
    });
    if ((_editTarget.body || []).length === 0) {
      const hint = document.createElement('span');
      hint.textContent = '(还没加内容)';
      hint.style.color = '#999';
      hint.style.fontSize = '12px';
      innerList.appendChild(hint);
    }
    container.appendChild(innerList);
    list.appendChild(container);
  }
}

// 让队列所有卡片黄色闪动一次,吸引孩子注意"要审视这里"
function flashQueueItems() {
  const items = document.querySelectorAll('#queue-list .queue-item');
  items.forEach((el, idx) => {
    setTimeout(() => {
      el.style.transition = 'background 0.3s, transform 0.3s';
      const origBg = el.style.background;
      el.style.background = '#FFF59D';
      el.style.transform = 'scale(1.1)';
      setTimeout(() => {
        el.style.background = origBg;
        el.style.transform = '';
      }, 400);
    }, idx * 150); // 依次闪烁,让孩子眼睛扫过每一条
  });
}

function updateEditBanner() {
  // 在 cmdbar 顶部提示当前是否在容器编辑模式
  const bar = document.getElementById('cmdbar');
  let banner = document.getElementById('edit-banner');
  if (_editTarget) {
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'edit-banner';
      banner.style.cssText = 'background:#FFE4B5; border:2px solid #D4AC0D; border-radius:6px; padding:6px; margin-bottom:6px; font-size:12px; color:#6B4423; text-align:center; font-weight:bold;';
      bar.insertBefore(banner, bar.firstChild);
    }
    banner.textContent = `📝 正在编辑「重复 ${_editTarget.times} 次」`;
  } else {
    if (banner) banner.remove();
  }
}

document.getElementById('btn-clear-queue').onclick = () => {
  if (G.isRunning) return;
  G.commandQueue = [];
  _editTarget = null;
  // 如果关卡有预填队列,恢复到初始预填状态(而不是完全空)
  applyPresetQueue();
  renderQueue();
  updateEditBanner();
};

// ========== 对话系统 ==========
let _dialogQueue = [];
let _dialogOnFinish = null;

function showDialog(lines, onFinish) {
  _dialogQueue = [...lines];
  _dialogOnFinish = onFinish;
  document.getElementById('dialog-overlay').classList.add('show');
  nextDialog();
}

// 把 **关键词** 替换成红色高亮 span;其余字符 HTML 转义
function formatDialogText(raw) {
  if (!raw) return '';
  const escaped = String(raw)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  // **xxx** → <span class="hl">xxx</span>
  return escaped.replace(/\*\*([^*]+?)\*\*/g, '<span class="hl">$1</span>');
}

function stripMarkup(raw) {
  return (raw || '').replace(/\*\*([^*]+?)\*\*/g, '$1');
}

function nextDialog() {
  if (_dialogQueue.length === 0) {
    document.getElementById('dialog-overlay').classList.remove('show');
    if (_dialogOnFinish) _dialogOnFinish();
    return;
  }
  const line = _dialogQueue.shift();
  document.getElementById('dialog-speaker').textContent = line.speaker;
  document.getElementById('dialog-text').innerHTML = formatDialogText(line.text);
  speak(stripMarkup(line.text)); // 朗读时去掉 ** 标记
}

document.getElementById('btn-dialog-next').onclick = nextDialog;
document.getElementById('btn-dialog-skip').onclick = () => {
  // 跳过:清空队列,直接调用收尾
  _dialogQueue = [];
  document.getElementById('dialog-overlay').classList.remove('show');
  // 取消未播完的朗读
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (_dialogOnFinish) _dialogOnFinish();
};
document.getElementById('btn-dialog-speak').onclick = () => {
  const t = document.getElementById('dialog-text').textContent;
  speak(t);
};

// ========== 提示按钮三分钟锁 ==========
// 全局:每关开局 3 分钟内隐藏提示按钮;3 分钟后自动出现,并在首次出现时弹气泡
const HINT_UNLOCK_MS = 3 * 60 * 1000;
let _hintUnlockTimer = null;
let _hintBubbleShown = false;

function armHintButtonLock() {
  const btn = document.getElementById('btn-hint');
  const bubble = document.getElementById('hint-bubble');
  if (!btn) return;
  // 每关开始:隐藏按钮,清掉之前的定时器
  btn.style.display = 'none';
  btn.classList.remove('new-hint');
  if (bubble) bubble.style.display = 'none';
  if (_hintUnlockTimer) { clearTimeout(_hintUnlockTimer); _hintUnlockTimer = null; }

  _hintUnlockTimer = setTimeout(() => {
    // 模考中:提示按钮一直藏着,不要被这个定时器拉出来
    if (G.contest) return;
    btn.style.display = '';
    btn.classList.add('new-hint');
    // 首次解锁才弹一次气泡;后续关卡不再弹,只闪一下
    if (!_hintBubbleShown && bubble) {
      _hintBubbleShown = true;
      // 定位到按钮下方
      const rect = btn.getBoundingClientRect();
      bubble.style.left = Math.max(10, rect.left + rect.width/2 - 110) + 'px';
      bubble.style.top = (rect.bottom + 8) + 'px';
      bubble.style.display = 'block';
      // 8 秒后自动消失
      setTimeout(() => { if (bubble) bubble.style.display = 'none'; }, 8000);
    }
    // 2.4 秒后取消闪烁高亮
    setTimeout(() => btn.classList.remove('new-hint'), 2400);
  }, HINT_UNLOCK_MS);
}

// ========== 提示系统(三级) ==========
document.getElementById('btn-hint').onclick = () => {
  if (!G.currentLevel || !G.currentLevel.hints) return;
  G.hintLevel = Math.min(G.hintLevel + 1, G.currentLevel.hints.length);
  const hint = G.currentLevel.hints[G.hintLevel - 1];
  showDialog([
    { speaker: '小天(提示)', text: hint.text }
  ]);
};

// ========== 重来 ==========
document.getElementById('btn-reset').onclick = () => {
  if (G.isRunning) return;
  G.commandQueue = [];
  _editTarget = null;
  G.giftsOpened = 0;
  G.trojanTriggered = 0;
  G.buttonPressed = false;
  applyPresetQueue();  // ⭐ 概念关重试后要恢复预填队列,否则 C1 等关卡会变空
  renderQueue();
  updateEditBanner();
  if (G.phaserScene) {
    _clearLoopTimers();
    G.phaserScene.scene.restart({ levelData: G.currentLevel });
  }
};

// ========== 执行 ==========
document.getElementById('btn-run').onclick = async () => {
  if (G.isRunning || G.commandQueue.length === 0) return;
  await runQueue();
};

// 递归执行指令序列;返回 true 表示被中断(如撞墙)
async function executeCommands(commands, scene) {
  for (const cmd of commands) {
    if (cmd.action === 'move') {
      for (let i = 0; i < (cmd.steps || 1); i++) {
        const ok = await scene.movePlayer(cmd.dir);
        if (!ok) {
          const msg = G.lastBlockMessage || '走不动了!';
          G.lastBlockMessage = null;
          await scene.showBubble(G.player, msg);
          return true; // 中断
        }
      }
    } else if (cmd.action === 'pickup') {
      await scene.pickupAction();
    } else if (cmd.action === 'drop') {
      await scene.dropAction();
    } else if (cmd.action === 'set_color') {
      await scene.setColorAction(cmd.color);
    } else if (cmd.action === 'take_credential') {
      await scene.takeCredentialAction();
    } else if (cmd.action === 'water') {
      await scene.waterAction();
    } else if (cmd.action === 'buy') {
      await scene.buyAction(cmd.item, cmd.label);
    } else if (cmd.action === 'social_engineer') {
      await scene.socialEngineerAction(cmd.persona || '水电工');
    } else if (cmd.action === 'wait') {
      await scene.waitAction(cmd.seconds || 3);
    } else if (cmd.action === 'send_noise') {
      await scene.sendNoiseAction();
    } else if (cmd.action === 'press_button') {
      await scene.pressButtonAction();
    } else if (cmd.action === 'ask_hint') {
      await scene.askHintAction();
    } else if (cmd.action === 'break_mirror') {
      await scene.breakMirrorAction();
    } else if (cmd.action === 'enter_password') {
      await scene.enterPasswordAction();
    } else if (cmd.action === 'choose_reply') {
      await scene.chooseReplyAction();
    } else if (cmd.action === 'clean_virus') {
      await scene.cleanVirusAction();
    } else if (cmd.action === 'inspect_gift') {
      await scene.inspectGiftAction();
    } else if (cmd.action === 'open_gift') {
      await scene.openGiftAction();
    } else if (cmd.action === 'deploy_backend') {
      await scene.deployBackendAction();
    } else if (cmd.action === 'repeat') {
      // 容器指令:展开执行 N 次
      const times = cmd.times || 1;
      const body = cmd.body || [];
      if (body.length === 0) {
        await scene.showBubble(G.player, '重复里面还是空的哦~');
        continue;
      }
      for (let i = 0; i < times; i++) {
        const aborted = await executeCommands(body, scene);
        if (aborted) return true;
      }
    }
  }
  return false;
}

async function runQueue() {
  G.isRunning = true;
  const scene = G.phaserScene;

  const aborted = await executeCommands(G.commandQueue, scene);
  if (aborted) { G.isRunning = false; return; }

  // 统一胜利判定
  if (scene.checkSuccess()) {
    await scene.playSuccessAnim();
    markLevelCleared(G.currentLevel.id);
    showDialog(G.currentLevel.on_clear_dialog, () => {
      showClearOverlay();
    });
  } else {
    // 按关卡类型给友好提示
    let hint = '好像还没完成任务...';
    const cond = G.currentLevel.success_condition;
    if (cond?.type === 'item_at_goal' && G.carriedItem) {
      hint = '东西还没放到地方哦...';
    } else if (cond?.type === 'color_sequence_matches') {
      const e = G.entities[cond.entity_id];
      const cur = e?.current_sequence?.length || 0;
      const need = e?.required_sequence?.length || 0;
      hint = cur === 0 ? '要靠近信号灯上色哦!' : `颜色顺序不对~ 试试看!`;
      // 重置当前序列便于重试
      if (e) e.current_sequence = [];
      if (e?.redraw) e.redraw(null);
    } else if (cond?.type === 'reach_credential_door') {
      const door = G.entities[cond.goal_id];
      if (!door) {
        hint = '还差一点...';
      } else if (G.player.gridX !== door.gridX || G.player.gridY !== door.gridY) {
        hint = '要走到门口哦!';
      } else if (!G.heldCredentials?.has(door.requires_credential)) {
        hint = '没有证件,进不去~';
      }
    } else if (cond?.type === 'all_watered') {
      const total = (cond.entity_ids || []).length;
      const done = (cond.entity_ids || []).filter(id => G.entities[id]?.watered).length;
      hint = done === 0 ? '还没浇花呢!' : `浇了 ${done}/${total},还差几盆~`;
    } else if (cond?.type === 'all_virus_cleaned') {
      const total = (cond.entity_ids || []).length;
      const done = (cond.entity_ids || []).filter(id => G.entities[id]?.cleaned).length;
      if (done < total) {
        hint = done === 0 ? '🦠 还没清病毒呢!' : `清了 ${done}/${total},还有病毒!`;
      } else {
        hint = '病毒都清了,到终点就赢!';
      }
    } else if (cond?.type === 'collect_safe_gifts') {
      if ((G.trojanTriggered || 0) > 0) {
        hint = '中了木马!先检查再拆哦~';
      } else {
        const got = G.giftsOpened || 0;
        const need = cond.required_count || 2;
        hint = got < need ? `才拆了 ${got}/${need} 个好礼物~` : '到终点去吧!';
      }
    } else if (cond?.type === 'execute_safe_queue') {
      const preset = G.currentLevel.preset_queue || [];
      const malIds = new Set(preset.filter(c => c.malicious).map(c => c.id));
      const stillHasMal = G.commandQueue.some(c => malIds.has(c.id));
      if (stillHasMal) {
        hint = '🚨 队列里还有坏指令,找出来删掉!';
      } else if (cond.reach_goal_id) {
        const goal = G.currentLevel.entities.find(e => e.id === cond.reach_goal_id);
        if (goal && (G.player.gridX !== goal.pos[0] || G.player.gridY !== goal.pos[1])) {
          // 这种情况通常是孩子不小心删了走路指令
          hint = '🙁 别删走路的指令,只删坏指令哦~';
        }
      }
    }
    await scene.showBubble(G.player, hint);
  }
  G.isRunning = false;
}

// ========== 密码盘 UI(D1 用)==========
function showPasswordKeypad(digitCount = 4) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed; inset:0; background:rgba(0,0,0,0.55);
      display:flex; align-items:center; justify-content:center;
      z-index:250;
    `;
    const box = document.createElement('div');
    box.style.cssText = `
      background: linear-gradient(180deg, #FFFACD, #FFE4B5);
      border: 6px solid #D4AC0D; border-radius: 24px;
      padding: 20px 22px; max-width: 340px;
      box-shadow: 0 8px 0 rgba(0,0,0,0.2); text-align:center;
    `;
    let input = '';
    const renderDisplay = () => {
      const slots = [];
      for (let i = 0; i < digitCount; i++) {
        slots.push(input[i] != null
          ? `<span style="color:#6B4423;font-weight:bold;">${input[i]}</span>`
          : '○');
      }
      return slots.join(' ');
    };

    box.innerHTML = `
      <div style="font-size:20px; font-weight:bold; color:#6B4423; margin-bottom:8px;">
        🔢 输入密码
      </div>
      <div id="kp-display" style="font-size:36px; font-family:monospace; color:#999; background:#FFF; border:3px solid #D4AC0D; border-radius:12px; padding:10px; margin-bottom:14px; letter-spacing:10px;">
        ${renderDisplay()}
      </div>
      <div id="kp-btns" style="display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin-bottom:10px;"></div>
      <div style="display:flex; gap:8px; justify-content:center;">
        <button id="kp-clear" style="padding:10px 14px; border:3px solid #6B4423; border-radius:12px; background:#FFE4B5; font-weight:bold; cursor:pointer;">清空</button>
        <button id="kp-cancel" style="padding:10px 14px; border:3px solid #6B4423; border-radius:12px; background:#FFF; font-weight:bold; cursor:pointer;">取消</button>
        <button id="kp-ok" style="padding:10px 18px; border:3px solid #339933; border-radius:12px; background:#66CC66; color:#FFF; font-weight:bold; cursor:pointer;">确定 ▶</button>
      </div>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const btns = document.getElementById('kp-btns');
    // 按钮顺序:1 2 3 / 4 5 6 / 7 8 9 / ← 0 OK(ok用下方)
    const keys = [1,2,3,4,5,6,7,8,9,'←',0,null];
    keys.forEach(k => {
      const b = document.createElement('button');
      if (k === null) {
        b.style.visibility = 'hidden';
      } else {
        b.textContent = k;
        b.style.cssText = `
          padding:14px 0; font-size:22px; font-weight:bold;
          border:3px solid #6B4423; border-radius:12px;
          background:#FFF; color:#6B4423; cursor:pointer;
        `;
        b.onclick = () => {
          if (k === '←') {
            input = input.slice(0, -1);
          } else if (input.length < digitCount) {
            input += String(k);
          }
          document.getElementById('kp-display').innerHTML = renderDisplay();
        };
      }
      btns.appendChild(b);
    });

    document.getElementById('kp-clear').onclick = () => {
      input = '';
      document.getElementById('kp-display').innerHTML = renderDisplay();
    };
    document.getElementById('kp-cancel').onclick = () => {
      overlay.remove();
      resolve(null);
    };
    document.getElementById('kp-ok').onclick = () => {
      if (input.length !== digitCount) {
        // 振动提示位数不够
        const d = document.getElementById('kp-display');
        d.style.color = '#E74C3C';
        setTimeout(() => d.style.color = '', 500);
        return;
      }
      overlay.remove();
      resolve(input);
    };
  });
}

// ========== 字母键盘 UI(E6 凯撒字母版)==========
function showLetterKeypad(length = 3) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed; inset:0; background:rgba(0,0,0,0.55);
      display:flex; align-items:center; justify-content:center;
      z-index:250;
    `;
    const box = document.createElement('div');
    box.style.cssText = `
      background: linear-gradient(180deg, #FFFACD, #FFE4B5);
      border: 6px solid #D4AC0D; border-radius: 24px;
      padding: 20px 22px; max-width: 420px;
      box-shadow: 0 8px 0 rgba(0,0,0,0.2); text-align:center;
    `;
    let input = '';
    const renderDisplay = () => {
      const slots = [];
      for (let i = 0; i < length; i++) {
        slots.push(input[i] != null
          ? `<span style="color:#6B4423;font-weight:bold;">${input[i]}</span>`
          : '○');
      }
      return slots.join(' ');
    };

    box.innerHTML = `
      <div style="font-size:20px; font-weight:bold; color:#6B4423; margin-bottom:8px;">
        🔤 输入字母
      </div>
      <div id="lkp-display" style="font-size:30px; font-family:monospace; color:#999; background:#FFF; border:3px solid #D4AC0D; border-radius:12px; padding:10px; margin-bottom:14px; letter-spacing:8px;">
        ${renderDisplay()}
      </div>
      <div id="lkp-btns" style="display:grid; grid-template-columns:repeat(7,1fr); gap:4px; margin-bottom:10px;"></div>
      <div style="display:flex; gap:8px; justify-content:center;">
        <button id="lkp-back" style="padding:8px 12px; border:3px solid #6B4423; border-radius:10px; background:#FFE4B5; font-weight:bold; cursor:pointer;">← 删除</button>
        <button id="lkp-clear" style="padding:8px 12px; border:3px solid #6B4423; border-radius:10px; background:#FFE4B5; font-weight:bold; cursor:pointer;">清空</button>
        <button id="lkp-cancel" style="padding:8px 12px; border:3px solid #6B4423; border-radius:10px; background:#FFF; font-weight:bold; cursor:pointer;">取消</button>
        <button id="lkp-ok" style="padding:8px 16px; border:3px solid #339933; border-radius:10px; background:#66CC66; color:#FFF; font-weight:bold; cursor:pointer;">确定 ▶</button>
      </div>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const btns = document.getElementById('lkp-btns');
    const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    LETTERS.forEach(L => {
      const b = document.createElement('button');
      b.textContent = L;
      b.style.cssText = `
        padding:8px 0; font-size:14px; font-weight:bold;
        border:2px solid #6B4423; border-radius:8px;
        background:#FFF; color:#6B4423; cursor:pointer;
      `;
      b.onclick = () => {
        if (input.length < length) {
          input += L;
          document.getElementById('lkp-display').innerHTML = renderDisplay();
        }
      };
      btns.appendChild(b);
    });

    document.getElementById('lkp-back').onclick = () => {
      input = input.slice(0, -1);
      document.getElementById('lkp-display').innerHTML = renderDisplay();
    };
    document.getElementById('lkp-clear').onclick = () => {
      input = '';
      document.getElementById('lkp-display').innerHTML = renderDisplay();
    };
    document.getElementById('lkp-cancel').onclick = () => {
      overlay.remove();
      resolve(null);
    };
    document.getElementById('lkp-ok').onclick = () => {
      if (input.length !== length) {
        const d = document.getElementById('lkp-display');
        d.style.color = '#E74C3C';
        setTimeout(() => d.style.color = '', 500);
        return;
      }
      overlay.remove();
      resolve(input);
    };
  });
}

// ========== 社工 3 选 1 对话框(E3 用)==========
function showReplyChoiceModal(prompt, replies) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed; inset:0; background:rgba(0,0,0,0.55);
      display:flex; align-items:center; justify-content:center;
      z-index:250;
    `;
    const box = document.createElement('div');
    box.style.cssText = `
      background: #FFF;
      border: 5px solid #6B4423; border-radius: 20px;
      padding: 20px; max-width: 420px; min-width: 300px;
      box-shadow: 0 8px 0 rgba(107, 68, 35, 0.3);
    `;
    const title = document.createElement('div');
    title.textContent = '🧔 守卫问:' + prompt;
    title.style.cssText = 'font-size:18px;font-weight:bold;color:#6B4423;margin-bottom:14px;';
    box.appendChild(title);

    replies.forEach((r, i) => {
      const btn = document.createElement('button');
      btn.textContent = `${'ABC'[i]}. ${r.text}`;
      btn.style.cssText = `
        display:block; width:100%; margin:8px 0;
        padding:12px 14px; border:3px solid #6B4423; border-radius:12px;
        background:#FFFACD; color:#6B4423;
        font-size:15px; font-weight:bold; text-align:left;
        cursor:pointer;
      `;
      btn.onmouseover = () => { btn.style.background = '#FFF8DC'; };
      btn.onmouseout = () => { btn.style.background = '#FFFACD'; };
      btn.onclick = () => {
        overlay.remove();
        resolve(i);
      };
      box.appendChild(btn);
    });

    const cancel = document.createElement('button');
    cancel.textContent = '取消';
    cancel.style.cssText = `
      margin-top:8px; padding:8px 14px;
      border:2px solid #999; border-radius:10px; background:#FFF;
      color:#666; cursor:pointer;
    `;
    cancel.onclick = () => { overlay.remove(); resolve(null); };
    box.appendChild(cancel);

    overlay.appendChild(box);
    document.body.appendChild(overlay);
  });
}

// ========== 通关弹窗 ==========
function showClearOverlay() {
  // 模考模式:不弹"通关啦"弹窗,直接进下一题
  if (G.contest) {
    advanceContestStage();
    return;
  }
  // 动态构建弹窗 DOM
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position:fixed; inset:0; background:rgba(0,0,0,0.5);
    display:flex; align-items:center; justify-content:center;
    z-index:200; animation:fadeIn 0.3s;
  `;

  const box = document.createElement('div');
  box.style.cssText = `
    background: linear-gradient(180deg, #FFFACD, #FFE4B5);
    border: 6px solid #D4AC0D;
    border-radius: 24px;
    padding: 30px 40px; text-align: center;
    box-shadow: 0 8px 0 rgba(0,0,0,0.2);
    max-width: 400px;
    animation: bounceIn 0.5s;
  `;

  const title = G.currentLevel.title;
  const stars = '⭐'.repeat(3); // 简单3星,后续按步数评级

  box.innerHTML = `
    <div style="font-size:48px; margin-bottom:10px;">🎉</div>
    <div style="font-size:28px; font-weight:bold; color:#6B4423; margin-bottom:6px;">通关啦!</div>
    <div style="font-size:18px; color:#8B5A3C; margin-bottom:12px;">${title}</div>
    <div style="font-size:32px; margin-bottom:20px;">${stars}</div>
    <div style="display:flex; gap:12px; justify-content:center; flex-wrap:wrap;">
      <button id="btn-clear-map"  style="padding:12px 20px; border:3px solid #6B4423; border-radius:12px; background:#FFF; font-size:16px; font-weight:bold; color:#6B4423; cursor:pointer;">🗺️ 回到地图</button>
      <button id="btn-clear-replay" style="padding:12px 20px; border:3px solid #6B4423; border-radius:12px; background:#FFE4B5; font-size:16px; font-weight:bold; color:#6B4423; cursor:pointer;">🔄 再玩一次</button>
    </div>
  `;

  // CSS 关键帧动画
  const style = document.createElement('style');
  style.textContent = `
    @keyframes fadeIn { from { opacity:0 } to { opacity:1 } }
    @keyframes bounceIn {
      0% { transform:scale(0.5); opacity:0 }
      60% { transform:scale(1.1); opacity:1 }
      100% { transform:scale(1); }
    }
  `;
  document.head.appendChild(style);

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  document.getElementById('btn-clear-map').onclick = () => {
    window.location.href = 'levels.html';
  };
  document.getElementById('btn-clear-replay').onclick = () => {
    overlay.remove();
    // 清队列、应用预填、restart场景
    G.commandQueue = [];
    _editTarget = null;
    applyPresetQueue();  // ⭐ 同重来按钮
    renderQueue();
    updateEditBanner();
    if (G.phaserScene) {
      G.phaserScene.scene.restart({ levelData: G.currentLevel });
    }
  };
}

class MainScene extends Phaser.Scene {
  constructor() { super({ key: 'MainScene' }); }

  init(data) {
    this.levelData = data.levelData || null;
  }

  preload() {
    // 暂时用 Phaser Graphics 绘制占位角色,后续替换为 sprite
  }

  create() {
    G.phaserScene = this;

    if (!this.levelData) return;

    const [cols, rows] = this.levelData.map.size;

    // 计算 tile 尺寸:
    // 窄屏(手机)追求大 —— 允许地图超出屏幕,靠 camera 跟随玩家
    // 宽屏(桌面)保持原先的"能装下就装下"
    const availW = this.scale.width;
    const availH = this.scale.height;
    const maxTileW = Math.floor(availW / cols);
    const maxTileH = Math.floor(availH / rows);
    const isNarrow = availW < 700;

    if (isNarrow) {
      // 手机:以"短边刚好装下"为下限,但上限拉到 110,再取两者较大 ——
      // 这样地图总有一边铺满屏幕,另一边用摄像机滚动
      const tightFit = Math.min(maxTileW, maxTileH);
      const looseFit = Math.max(maxTileW, maxTileH);
      G.tileSize = Math.max(tightFit, Math.min(looseFit, 110));
    } else {
      G.tileSize = Math.min(maxTileW, maxTileH, 64);
    }

    const mapPixW = cols * G.tileSize;
    const mapPixH = rows * G.tileSize;
    G.mapOriginX = Math.max(0, (availW - mapPixW) / 2);
    G.mapOriginY = Math.max(0, (availH - mapPixH) / 2);

    // 若地图超出屏幕,启用摄像机跟随玩家
    if (this.cameras && this.cameras.main) {
      const worldW = Math.max(availW, mapPixW + G.mapOriginX * 2);
      const worldH = Math.max(availH, mapPixH + G.mapOriginY * 2);
      this.cameras.main.setBounds(0, 0, worldW, worldH);
    }

    // ---- 登记墙壁(供 movePlayer 碰撞检测)----
    G.walls = new Set();
    (this.levelData.map.walls || []).forEach(w => {
      for (let dx = 0; dx < w.w; dx++) {
        for (let dy = 0; dy < w.h; dy++) {
          G.walls.add(`${w.x + dx},${w.y + dy}`);
        }
      }
    });

    // ---- 绘制地板 ----
    const floorG = this.add.graphics();
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const px = G.mapOriginX + x * G.tileSize;
        const py = G.mapOriginY + y * G.tileSize;
        const isWall = G.walls.has(`${x},${y}`);
        const color = isWall
          ? 0x8B5A3C  // 墙:深棕
          : (((x + y) % 2 === 0) ? 0xF4E4BC : 0xE8D4A0);
        floorG.fillStyle(color, 1);
        floorG.fillRect(px, py, G.tileSize - 1, G.tileSize - 1);
        // 墙壁加粗黑描边(明显感)
        if (isWall) {
          floorG.lineStyle(2, 0x2C3E50, 1);
          floorG.strokeRect(px + 1, py + 1, G.tileSize - 3, G.tileSize - 3);
          floorG.lineStyle(0);
        }
      }
    }

    // ---- 绘制家具 ----
    this.drawObjects(this.levelData.map.objects || []);

    // ---- 实体登记表 + 渲染 ----
    G.entities = {};       // id -> { type, gridX, gridY, sprite, ... }
    G.carriedItem = null;  // 婉婉手持的物品 id

    const entityList = this.levelData.entities || [];

    // 先处理 goal / goal_zone(让玩家视觉上知道目标在哪)
    entityList.filter(e => e.goal).forEach(e => {
      this.drawGoal(e);
    });

    // 处理 NPC(所有"角色类"实体)
    const NPC_TYPES = ['shuimu','durple','raddy','lime','gray','jevin','cikur',
                       'brud','simon','tunner','wenda','taiyang','sky','dashu',
                       'pinki','tengman','oren','blake','garnold','diannao','npc'];
    entityList.filter(e => NPC_TYPES.includes(e.type)).forEach(e => {
      const sprite = this.createNPC(e);
      // 第五幕起:带 hint_text 且不跟随 / 非循环的 NPC,在头顶持续显示线索
      let label = null;
      if (e.hint_text && e.role !== 'follower' && !e.loop_steps) {
        const lx = G.mapOriginX + e.pos[0] * G.tileSize + G.tileSize / 2;
        const ly = G.mapOriginY + e.pos[1] * G.tileSize - 2;
        label = this.add.text(lx, ly, e.hint_text, {
          fontSize: '12px', color: '#6B4423',
          backgroundColor: '#FFFACD',
          padding: { x: 5, y: 2 },
          wordWrap: { width: 120, useAdvancedWrap: true },
          align: 'center'
        }).setOrigin(0.5, 1).setDepth(18);
      }
      G.entities[e.id] = {
        type: e.type,
        gridX: e.pos[0], gridY: e.pos[1],
        sprite,
        role: e.role || null,         // 'follower' / 'guard' 等
        follows: e.follows || null,   // 跟随的目标 id(通常是 player)
        aside_pos: e.aside_pos || null,       // guard 被 bypass 后让去的格子
        noise_threshold: e.noise_threshold || 3, // DoS 需要噪音数
        block_message: e.block_message || null,  // 撞到时的定制消息
        hint_text: e.hint_text || null,   // 用 ask_hint 时会念出这句(D1 用)
        bypassed: false,
        _label: label
      };
    });

    // 处理可捡起物品
    entityList.filter(e => e.type === 'item').forEach(e => {
      const sprite = this.createItem(e);
      G.entities[e.id] = {
        type: 'item',
        sprite_type: e.sprite,
        gridX: e.pos[0],
        gridY: e.pos[1],
        sprite,
        pickupable: true,
        carried: false
      };
    });

    // 处理交互对象(信号灯等可着色对象)
    entityList.filter(e => e.type === 'traffic_light').forEach(e => {
      const { sprite, redraw } = this.createTrafficLight(e);
      G.entities[e.id] = {
        type: 'traffic_light',
        gridX: e.pos[0], gridY: e.pos[1],
        sprite,
        colorable: true,
        required_sequence: e.required_sequence || [],
        current_sequence: []
      };
      // redraw 闭包允许后续改变颜色
      G.entities[e.id].redraw = redraw;
    });

    // 处理凭证物品(如借书证)
    G.heldCredentials = new Set();  // 婉婉持有的凭证类型集合
    entityList.filter(e => e.type === 'credential').forEach(e => {
      const sprite = this.createCredential(e);
      G.entities[e.id] = {
        type: 'credential',
        credential_type: e.credential_type,
        gridX: e.pos[0], gridY: e.pos[1],
        sprite,
        taken: false
      };
    });

    // 处理凭证门(需要持有指定凭证才能通过/通关)
    entityList.filter(e => e.type === 'credential_door').forEach(e => {
      const sprite = this.createCredentialDoor(e);
      G.entities[e.id] = {
        type: 'credential_door',
        gridX: e.pos[0], gridY: e.pos[1],
        sprite,
        requires_credential: e.requires_credential
      };
    });

    // 处理花(T5 浇水关)
    entityList.filter(e => e.type === 'flower').forEach(e => {
      const state = { watered: e.watered || false };
      const { sprite, redraw } = this.createFlower(e, state);
      G.entities[e.id] = {
        type: 'flower',
        gridX: e.pos[0], gridY: e.pos[1],
        sprite, redraw,
        get watered() { return state.watered; },
        set watered(v) { state.watered = v; }
      };
    });

    // 处理货架(C1 超市关,shelf 是装饰性提示)
    entityList.filter(e => e.type === 'shelf').forEach(e => {
      const sprite = this.createShelf(e);
      G.entities[e.id] = {
        type: 'shelf',
        gridX: e.pos[0], gridY: e.pos[1],
        sprite,
        sprite_type: e.sprite
      };
    });

    // 处理 blocked_door(C5/C8:视觉是门,走上去会弹消息)
    entityList.filter(e => e.type === 'blocked_door').forEach(e => {
      const sprite = this.createBlockedDoor(e);
      G.entities[e.id] = {
        type: 'blocked_door',
        gridX: e.pos[0], gridY: e.pos[1],
        sprite,
        message: e.message || '这扇门进不去~',
        unlocked: !!e.unlocked,
        label: e.label || ''
      };
    });

    // 处理 color_gate(C6:颜色锁守卫,变蓝才能过)
    entityList.filter(e => e.type === 'color_gate').forEach(e => {
      const { sprite, redraw } = this.createColorGate(e);
      G.entities[e.id] = {
        type: 'color_gate',
        gridX: e.pos[0], gridY: e.pos[1],
        sprite, redraw,
        current_color: e.current_color || 'red',
        pass_color: e.pass_color || 'blue'
      };
    });

    // 处理 timed_gate(C9:定时门,需要 wait 后才开)
    entityList.filter(e => e.type === 'timed_gate').forEach(e => {
      const { sprite, redraw } = this.createTimedGate(e);
      G.entities[e.id] = {
        type: 'timed_gate',
        gridX: e.pos[0], gridY: e.pos[1],
        sprite, redraw,
        open: !!e.open,
        requires_wait_seconds: e.requires_wait_seconds || 3
      };
    });

    // 处理 info_stone(C8:踩上去显示提示 · 第五幕起 hint_text 持续显示在石头上方)
    entityList.filter(e => e.type === 'info_stone').forEach(e => {
      const sprite = this.createInfoStone(e);
      // 持续显示的浮动标签(只要 hint_text 非空就贴)
      let label = null;
      if (e.hint_text) {
        const lx = G.mapOriginX + e.pos[0] * G.tileSize + G.tileSize / 2;
        const ly = G.mapOriginY + e.pos[1] * G.tileSize - 2;
        label = this.add.text(lx, ly, e.hint_text, {
          fontSize: '12px', color: '#6B4423',
          backgroundColor: '#FFFACD',
          padding: { x: 5, y: 2 },
          wordWrap: { width: 120, useAdvancedWrap: true },
          align: 'center'
        }).setOrigin(0.5, 1).setDepth(18);
      }
      G.entities[e.id] = {
        type: 'info_stone',
        gridX: e.pos[0], gridY: e.pos[1],
        sprite,
        hint_text: e.hint_text || '',
        _label: label
      };
    });

    // 处理 button(C9:ATM 按钮,接 press_button)
    entityList.filter(e => e.type === 'button').forEach(e => {
      const sprite = this.createButton(e);
      G.entities[e.id] = {
        type: 'button',
        gridX: e.pos[0], gridY: e.pos[1],
        sprite,
        pressed: false,
        effect: e.effect || null,          // 'open_gate' | 'give_money'
        target_id: e.target_id || null
      };
    });

    // 处理 safe_box(D1 弱口令关:输对密码才解锁;E7 支持 initial_hidden,部署后才显示)
    entityList.filter(e => e.type === 'safe_box').forEach(e => {
      const { sprite, redraw } = this.createSafeBox(e);
      const hidden = !!e.initial_hidden;
      if (hidden) sprite.setVisible(false);
      G.entities[e.id] = {
        type: 'safe_box',
        gridX: e.pos[0], gridY: e.pos[1],
        sprite, redraw,
        correct_password: e.correct_password || '0000',
        password_kind: e.password_kind || 'number', // 'number' | 'letter'
        unlocked: !!e.unlocked,
        attempts: 0,
        hidden, // E7:未部署前隐藏,也不拦路
        unlock_reward: e.unlock_reward || null
      };
    });

    // ========== 第五幕新实体 ==========

    // E7:前端假门(视觉是门,不登记为墙,可直接穿过,穿过触发"识破"动画)
    entityList.filter(e => e.type === 'fake_check_door').forEach(e => {
      const { sprite, reveal } = this.createFakeCheckDoor(e);
      G.entities[e.id] = {
        type: 'fake_check_door',
        gridX: e.pos[0], gridY: e.pos[1],
        sprite, reveal,
        revealed: false,
        label: e.label || '请输入密码'
      };
    });

    // E7:部署按钮(按下去让目标 safe_box 从 hidden 变显示)
    entityList.filter(e => e.type === 'deploy_button').forEach(e => {
      const sprite = this.createDeployButton(e);
      G.entities[e.id] = {
        type: 'deploy_button',
        gridX: e.pos[0], gridY: e.pos[1],
        sprite,
        pressed: false,
        target_id: e.target_id || null   // 指向要部署的 safe_box 的 id
      };
    });

    // E8/E12:病毒格子
    entityList.filter(e => e.type === 'virus_tile').forEach(e => {
      const { sprite, redraw } = this.createVirusTile(e);
      G.entities[e.id] = {
        type: 'virus_tile',
        gridX: e.pos[0], gridY: e.pos[1],
        sprite, redraw,
        cleaned: false
      };
    });

    // E9/E12:礼物盒(可能是真礼物也可能是木马)
    entityList.filter(e => e.type === 'gift_box').forEach(e => {
      const { sprite, redraw } = this.createGiftBox(e);
      G.entities[e.id] = {
        type: 'gift_box',
        gridX: e.pos[0], gridY: e.pos[1],
        sprite, redraw,
        color: e.color || 'red',
        is_trojan: !!e.is_trojan,
        content_label: e.content_label || '一本书',
        inspected: false,
        opened: false
      };
    });

    // E3:带 3 选 1 对话的守卫
    entityList.filter(e => e.type === 'reply_guard').forEach(e => {
      const sprite = this.createReplyGuard(e);
      G.entities[e.id] = {
        type: 'reply_guard',
        gridX: e.pos[0], gridY: e.pos[1],
        sprite,
        replies: e.replies || [],       // [{text, correct, feedback}]
        prompt: e.prompt || '你是谁?',
        bypassed: false,
        aside_pos: e.aside_pos || [e.pos[0], e.pos[1] + 1],
        block_message: e.block_message || '站住!'
      };
    });

    // E4/E11:循环 NPC(每 N 秒走一轮预设路径)
    entityList.filter(e => e.type === 'loop_npc').forEach(e => {
      const sprite = this.createLoopNpc(e);
      G.entities[e.id] = {
        type: 'loop_npc',
        gridX: e.pos[0], gridY: e.pos[1],
        sprite,
        loop_steps: e.loop_steps || [],  // ['right','right','say:123','right']
        loop_period_ms: e.loop_period_ms || 5000,
        hint_text: e.hint_text || null,
        _loopTimer: null
      };
      // 启动循环
      this._startLoopAnim(G.entities[e.id]);
    });
    entityList.filter(e => e.type === 'mirror').forEach(e => {
      const sprite = this.createMirror(e);
      G.entities[e.id] = {
        type: 'mirror',
        gridX: e.pos[0], gridY: e.pos[1],
        sprite,
        broken: false
      };
      // mirror 本身登记进墙,不能走
      G.walls.add(`${e.pos[0]},${e.pos[1]}`);
    });

    // 最后处理玩家(放最上层)
    const player = entityList.find(e => e.id === 'player');
    if (player) {
      G.player = this.createWanwanSprite(player.start_pos[0], player.start_pos[1]);
      // 窄屏:地图可能超屏,让摄像机跟随婉婉,平滑过渡
      if (isNarrow && this.cameras && this.cameras.main) {
        const mapPixW = cols * G.tileSize;
        const mapPixH = rows * G.tileSize;
        if (mapPixW > availW || mapPixH > availH) {
          this.cameras.main.startFollow(G.player, true, 0.15, 0.15);
        }
      }
    }

    // ---- 开场对话 ----
    // 每次进入关卡都播放开场白(孩子可能已经忘了这关要干嘛)
    // 对话右上角有"跳过"按钮,熟练后可以自己跳过
    if (this.levelData.intro_dialog && this.levelData.intro_dialog.length > 0) {
      setTimeout(() => {
        showDialog(this.levelData.intro_dialog, () => {
          // 对话结束后,如果是预填队列关(概念关),闪烁队列吸引注意
          if (Array.isArray(this.levelData.preset_queue) && this.levelData.preset_queue.length > 0) {
            flashQueueItems();
          }
        });
      }, 300);
      // 记录一下首次观看(未来可以用来判断"熟手"展示跳过提示)
      if (!G.progress[this.levelData.id]?.introShown) {
        G.progress[this.levelData.id] = {
          ...(G.progress[this.levelData.id] || {}),
          introShown: true
        };
        saveProgress();
      }
    } else if (Array.isArray(this.levelData.preset_queue) && this.levelData.preset_queue.length > 0) {
      // 没有开场对话但有预填队列,闪一下吸引注意
      setTimeout(() => flashQueueItems(), 400);
    }
  }

  // 绘制目标(门 或 目标区域)
  drawGoal(e) {
    const gx = G.mapOriginX + e.pos[0] * G.tileSize;
    const gy = G.mapOriginY + e.pos[1] * G.tileSize;
    if (e.type === 'door') {
      const doorG = this.add.graphics();
      doorG.lineStyle(3, 0x2C3E50, 1);
      doorG.fillStyle(0x8B4513, 1);
      doorG.fillRoundedRect(gx + 4, gy + 2, G.tileSize - 8, G.tileSize - 4, 3);
      doorG.strokeRoundedRect(gx + 4, gy + 2, G.tileSize - 8, G.tileSize - 4, 3);
      doorG.fillStyle(0xFFD700, 1);
      doorG.fillCircle(gx + G.tileSize * 0.75, gy + G.tileSize * 0.5, 3);
    } else if (e.type === 'goal_zone') {
      // 目标区域:金色高亮 + 大箭头 + 可选label
      const zoneG = this.add.graphics();
      zoneG.lineStyle(4, 0xD4AC0D, 1);
      zoneG.fillStyle(0xFFFACD, 0.7);
      zoneG.fillRect(gx + 2, gy + 2, G.tileSize - 4, G.tileSize - 4);
      zoneG.strokeRect(gx + 2, gy + 2, G.tileSize - 4, G.tileSize - 4);

      // 区域内画一个收银台图标(紫黄色柜台)
      const cxPx = gx + G.tileSize / 2;
      const cyPx = gy + G.tileSize / 2;
      zoneG.lineStyle(2, 0x2C3E50, 1);
      zoneG.fillStyle(0xE67E22, 1);
      zoneG.fillRoundedRect(gx + 8, gy + G.tileSize * 0.55, G.tileSize - 16, G.tileSize * 0.25, 2);
      zoneG.strokeRoundedRect(gx + 8, gy + G.tileSize * 0.55, G.tileSize - 16, G.tileSize * 0.25, 2);
      // 收银机
      zoneG.fillStyle(0x2C3E50, 1);
      zoneG.fillRoundedRect(cxPx - 6, gy + G.tileSize * 0.35, 12, G.tileSize * 0.22, 1);
      // 屏幕
      zoneG.fillStyle(0x2ECC71, 1);
      zoneG.fillRect(cxPx - 4, gy + G.tileSize * 0.4, 8, G.tileSize * 0.08);

      // 闪动大箭头(在上方,更显眼)
      const arrow = this.add.text(cxPx, gy - 10, '⬇', {
        fontSize: '24px', color: '#D4AC0D', fontStyle: 'bold'
      }).setOrigin(0.5).setDepth(15);
      this.tweens.add({
        targets: arrow, y: arrow.y - 6, duration: 500, yoyo: true, repeat: -1
      });

      // 文字标签(如果 JSON 提供 label)
      if (e.label) {
        const labelText = this.add.text(cxPx, gy - 28, e.label, {
          fontSize: '12px',
          color: '#D4AC0D',
          fontStyle: 'bold',
          backgroundColor: '#FFF',
          padding: { x: 4, y: 2 }
        }).setOrigin(0.5).setDepth(16);
      }
    }
  }

  // 创建 NPC(遵循几何极简困困脸规范)
  createNPC(e) {
    const gx = e.pos[0], gy = e.pos[1];
    const px = G.mapOriginX + gx * G.tileSize + G.tileSize / 2;
    const py = G.mapOriginY + gy * G.tileSize + G.tileSize / 2;

    const container = this.add.container(px, py);
    container.gridX = gx;
    container.gridY = gy;
    container.setDepth(9); // 低于玩家

    switch (e.type) {
      case 'shuimu':  this.drawNPC_Shuimu(container); break;
      case 'durple':  this.drawNPC_Durple(container); break;
      case 'raddy':   this.drawNPC_Raddy(container); break;
      case 'lime':    this.drawNPC_Lime(container); break;
      default:        this.drawNPC_Generic(container, e.type); break;
    }
    return container;
  }

  // 水母妹妹(妈妈):水母造型占位
  drawNPC_Shuimu(container) {
    const g = this.add.graphics();
    g.lineStyle(2, 0x2C3E50, 1);
    // 伞盖(钟形)
    g.fillStyle(0xFFB6D5, 1);
    g.fillEllipse(0, -5, 26, 20);
    g.strokeEllipse(0, -5, 26, 20);
    // 顶部小绒球
    g.fillStyle(0xFF6B9D, 1);
    g.fillCircle(0, -16, 3);
    // 触手(4根)
    for (let i = -2; i <= 2; i++) {
      if (i === 0) continue;
      const x = i * 5;
      g.lineStyle(3, 0xFFB6D5, 1);
      g.beginPath();
      g.moveTo(x, 3);
      g.lineTo(x - 1, 14);
      g.strokePath();
    }
    g.lineStyle(2, 0x2C3E50, 1);
    // 眼睛(困困)
    g.fillStyle(0xFFFFFF, 1);
    g.fillEllipse(-5, -5, 5, 4);
    g.fillEllipse(5, -5, 5, 4);
    g.strokeEllipse(-5, -5, 5, 4);
    g.strokeEllipse(5, -5, 5, 4);
    g.fillStyle(0xFFB6D5, 1);
    g.fillRect(-8, -7, 6, 2);
    g.fillRect(2, -7, 6, 2);
    g.fillStyle(0x000000, 1);
    g.fillCircle(-5, -4, 1.3);
    g.fillCircle(5, -4, 1.3);
    // 嘴
    g.lineStyle(1.5, 0x2C3E50, 1);
    g.beginPath();
    g.arc(0, -1, 1.5, 0, Math.PI);
    g.strokePath();
    container.add(g);
  }

  // 德普勒(弟弟):紫色尖刺
  drawNPC_Durple(container) {
    const g = this.add.graphics();
    g.lineStyle(2, 0x2C3E50, 1);
    // 身体(梯形)
    g.fillStyle(0x9B59B6, 1);
    g.beginPath();
    g.moveTo(-7, 14);
    g.lineTo(7, 14);
    g.lineTo(5, 4);
    g.lineTo(-5, 4);
    g.closePath();
    g.fillPath();
    g.strokePath();
    // 头
    g.fillStyle(0x9B59B6, 1);
    g.fillCircle(0, -6, 11);
    g.strokeCircle(0, -6, 11);
    // 尖刺(4根)
    g.fillStyle(0x7D3C98, 1);
    [[-6, -16, -3, -18, -4, -14],
     [-2, -18, 1, -20, 0, -16],
     [2, -18, 5, -20, 3, -16],
     [6, -16, 9, -18, 7, -14]].forEach(([a,b,c,d,e,f]) => {
      g.fillTriangle(a, b, c, d, e, f);
    });
    // 眼睛(困困)
    g.fillStyle(0xFFFFFF, 1);
    g.fillEllipse(-4, -6, 5, 4);
    g.fillEllipse(4, -6, 5, 4);
    g.strokeEllipse(-4, -6, 5, 4);
    g.strokeEllipse(4, -6, 5, 4);
    g.fillStyle(0x9B59B6, 1);
    g.fillRect(-7, -8, 6, 2);
    g.fillRect(1, -8, 6, 2);
    g.fillStyle(0x000000, 1);
    g.fillCircle(-4, -5, 1.3);
    g.fillCircle(4, -5, 1.3);
    // 嘴(小歪嘴,顽皮)
    g.lineStyle(1.5, 0x2C3E50, 1);
    g.beginPath();
    g.moveTo(-1, -1);
    g.lineTo(2, 0);
    g.strokePath();
    container.add(g);
  }

  drawNPC_Generic(container, type) {
    // 参数化版本:按角色名自动配色/装饰
    const presets = {
      raddy:   { main: 0xE74C3C, accent: 0x922B21, deco: 'horns_three' },
      lime:    { main: 0xA4E04A, accent: 0xC2F54D, deco: 'flame_hair' },
      gray:    { main: 0x95A5A6, accent: 0xFF6B9D, deco: 'cat_ears' },
      jevin:   { main: 0x2C3E80, accent: 0xAEDDFF, deco: 'bald' },
      cikur:   { main: 0xBDC3C7, accent: 0x7F8C8D, deco: 'faucet' },
      brud:    { main: 0x8B5A3C, accent: 0xF5F5F5, deco: 'bucket' },
      simon:   { main: 0xF1C40F, accent: 0xD4AC0D, deco: 'antennae' },
      tunner:  { main: 0x7F8C8D, accent: 0x5D6970, deco: 'spikes_radial' },
      wenda:   { main: 0xF5DEB3, accent: 0x8B5A3C, deco: 'fedora' },
      pinki:   { main: 0xFF6B9D, accent: 0xFFB6D5, deco: 'rabbit_ears' },
      tengman: { main: 0x2ECC71, accent: 0xFF6B9D, deco: 'vine_hair' },
      oren:    { main: 0xE67E22, accent: 0xF5DEB3, deco: 'headphones' },
      dashu:   { main: 0x8B5A3C, accent: 0x2ECC71, deco: 'leaves' },
      blake:   { main: 0x1A1A2E, accent: 0xE74C3C, deco: 'jagged_spikes', evil: true },
      npc:     { main: 0x95A5A6, accent: 0x7F8C8D, deco: 'bald' }
    };
    const p = presets[type] || presets.npc;
    const g = this.add.graphics();
    g.lineStyle(2, 0x2C3E50, 1);
    // 身体梯形
    g.fillStyle(p.main, 1);
    g.beginPath();
    g.moveTo(-7, 14); g.lineTo(7, 14); g.lineTo(5, 4); g.lineTo(-5, 4);
    g.closePath(); g.fillPath(); g.strokePath();
    // 头
    g.fillStyle(p.main, 1);
    g.fillCircle(0, -6, 11);
    g.strokeCircle(0, -6, 11);
    // 装饰(按 preset 分发)
    this.drawHeadDeco(g, p);
    // 眼睛(困困)
    g.lineStyle(1.5, 0x2C3E50, 1);
    g.fillStyle(0xFFFFFF, 1);
    g.fillEllipse(-4, -6, 5, 4);
    g.fillEllipse(4, -6, 5, 4);
    g.strokeEllipse(-4, -6, 5, 4);
    g.strokeEllipse(4, -6, 5, 4);
    g.fillStyle(p.main, 1);
    g.fillRect(-7, -8, 6, 2);
    g.fillRect(1, -8, 6, 2);
    g.fillStyle(p.evil ? 0xE74C3C : 0x000000, 1);
    g.fillCircle(-4, -5, 1.3);
    g.fillCircle(4, -5, 1.3);
    // 小嘴
    g.lineStyle(1.5, 0x2C3E50, 1);
    g.beginPath();
    g.arc(0, -1, 1.3, 0, Math.PI);
    g.strokePath();
    container.add(g);
  }

  // 头顶装饰按 preset.deco 绘制
  drawHeadDeco(g, p) {
    switch (p.deco) {
      case 'horns_three':
        g.fillStyle(p.accent, 1);
        g.fillTriangle(-5, -16, -1, -20, -3, -14);
        g.fillTriangle(-1, -18, 2, -22, 0, -14);
        g.fillTriangle(2, -16, 6, -20, 4, -14);
        break;
      case 'flame_hair':
        g.fillStyle(p.accent, 1);
        g.fillTriangle(-6, -14, -3, -22, 0, -14);
        g.fillTriangle(-2, -14, 1, -24, 4, -14);
        g.fillTriangle(3, -14, 6, -20, 7, -14);
        break;
      case 'cat_ears':
        g.fillStyle(p.main, 1);
        g.fillTriangle(-10, -10, -5, -18, -4, -10);
        g.fillTriangle(4, -10, 5, -18, 10, -10);
        g.fillStyle(p.accent, 1);
        g.fillTriangle(-8, -11, -6, -15, -5, -11);
        g.fillTriangle(5, -11, 6, -15, 8, -11);
        break;
      case 'rabbit_ears':
        g.fillStyle(p.main, 1);
        g.fillEllipse(-5, -18, 4, 10);
        g.fillEllipse(5, -18, 4, 10);
        g.fillStyle(0xFF1493, 1);
        g.fillCircle(-2, -14, 1.5);
        g.fillCircle(2, -14, 1.5);
        g.fillTriangle(-4, -14, 4, -14, 0, -11);
        break;
      case 'headphones':
        g.lineStyle(3, p.accent, 1);
        g.beginPath();
        g.arc(0, -12, 12, Math.PI, 0);
        g.strokePath();
        g.fillStyle(p.accent, 1);
        g.fillEllipse(-11, -10, 4, 6);
        g.fillEllipse(11, -10, 4, 6);
        g.lineStyle(2, 0x2C3E50, 1);
        break;
      case 'vine_hair':
        g.fillStyle(p.main, 1);
        g.fillEllipse(-8, -4, 4, 10);
        g.fillEllipse(8, -4, 4, 10);
        g.fillStyle(0x27AE60, 1);
        g.fillTriangle(-2, -16, 2, -20, 4, -14);
        g.fillStyle(p.accent, 1);
        g.fillCircle(-8, -6, 1.5);
        g.fillCircle(9, -8, 1.5);
        g.fillCircle(-2, -10, 1.2);
        break;
      case 'bald':
        // 留白即装饰,只画头顶高光
        g.fillStyle(p.accent, 0.5);
        g.fillCircle(-3, -12, 3);
        break;
      case 'faucet':
        g.fillStyle(p.accent, 1);
        g.fillRect(-2, -18, 4, 4);
        g.fillRect(-3, -22, 6, 4);
        g.fillStyle(0xAEDDFF, 1);
        g.fillCircle(0, -12, 1.2);
        break;
      case 'bucket':
        g.fillStyle(p.accent, 1);
        g.fillTriangle(-9, -20, 9, -20, 8, -14);
        g.fillTriangle(-8, -14, 8, -14, -9, -20);
        g.lineStyle(2, 0x2C3E50, 1);
        g.strokeRect(-9, -20, 18, 0);
        break;
      case 'antennae':
        g.lineStyle(2, p.accent, 1);
        g.beginPath();
        g.moveTo(-4, -15); g.lineTo(-5, -20);
        g.moveTo(4, -15);  g.lineTo(5, -20);
        g.strokePath();
        g.fillStyle(p.accent, 1);
        g.fillCircle(-5, -21, 2);
        g.fillCircle(5, -21, 2);
        g.lineStyle(2, 0x2C3E50, 1);
        break;
      case 'spikes_radial':
        g.fillStyle(p.accent, 1);
        [[-12, -8], [-10, -14], [-4, -18], [4, -18], [10, -14], [12, -8]].forEach(([x, y]) => {
          g.fillTriangle(0, -6, x, y, 0, -6);
          g.fillTriangle(x, y, x - 2, y + 2, x + 2, y + 2);
        });
        // 简化起见,用直接三角
        g.fillTriangle(-3, -16, 0, -22, 3, -16);
        break;
      case 'fedora':
        g.fillStyle(p.accent, 1);
        g.fillEllipse(0, -15, 18, 4);
        g.fillRoundedRect(-7, -20, 14, 6, 2);
        g.lineStyle(2, 0x2C3E50, 1);
        break;
      case 'leaves':
        g.fillStyle(0x2ECC71, 1);
        g.fillCircle(-4, -16, 5);
        g.fillCircle(4, -16, 5);
        g.fillCircle(0, -20, 5);
        break;
      case 'jagged_spikes':
        g.fillStyle(p.main, 1);
        g.fillTriangle(-8, -14, -5, -22, -3, -14);
        g.fillTriangle(-2, -15, 1, -24, 3, -15);
        g.fillTriangle(3, -14, 6, -21, 8, -14);
        break;
    }
  }

  drawNPC_Raddy(container) { this.drawNPC_Generic(container, 'raddy'); }
  drawNPC_Lime(container)  { this.drawNPC_Generic(container, 'lime'); }

  // 信号灯:三个圆圈,可着色,返回 redraw 闭包
  createTrafficLight(e) {
    const gx = e.pos[0], gy = e.pos[1];
    const px = G.mapOriginX + gx * G.tileSize + G.tileSize / 2;
    const py = G.mapOriginY + gy * G.tileSize + G.tileSize / 2;
    const container = this.add.container(px, py);
    container.setDepth(8);

    // 杆
    const pole = this.add.graphics();
    pole.lineStyle(2, 0x2C3E50, 1);
    pole.fillStyle(0x7F8C8D, 1);
    pole.fillRect(-2, 2, 4, 14);
    pole.strokeRect(-2, 2, 4, 14);

    // 灯箱
    const box = this.add.graphics();
    box.lineStyle(2, 0x2C3E50, 1);
    box.fillStyle(0x2C3E50, 1);
    box.fillRoundedRect(-9, -18, 18, 24, 3);
    box.strokeRoundedRect(-9, -18, 18, 24, 3);

    container.add([pole, box]);

    // 三个灯泡(初始灰色)
    const bulbs = {
      red:    this.add.graphics(),
      yellow: this.add.graphics(),
      green:  this.add.graphics()
    };
    const slotPos = { red: -12, yellow: -6, green: 0 };
    const colorMap = {
      red:    { on: 0xE74C3C, off: 0x5D6D7E },
      yellow: { on: 0xF1C40F, off: 0x5D6D7E },
      green:  { on: 0x2ECC71, off: 0x5D6D7E }
    };

    const redraw = (colorBeingSet) => {
      // 依据 entity.current_sequence 重画三个灯
      const entity = G.entities[e.id];
      const seq = entity?.current_sequence || [];
      for (const c of ['red','yellow','green']) {
        const bulb = bulbs[c];
        bulb.clear();
        const on = seq.includes(c);
        bulb.lineStyle(1.5, 0x2C3E50, 1);
        bulb.fillStyle(on ? colorMap[c].on : colorMap[c].off, 1);
        bulb.fillCircle(0, slotPos[c], 3);
        bulb.strokeCircle(0, slotPos[c], 3);
      }
      // 本次正在设置的那个闪一下
      if (colorBeingSet && bulbs[colorBeingSet]) {
        this.tweens.add({
          targets: bulbs[colorBeingSet],
          scaleX: { from: 1.4, to: 1 },
          scaleY: { from: 1.4, to: 1 },
          duration: 300
        });
      }
    };
    redraw(null);
    container.add([bulbs.red, bulbs.yellow, bulbs.green]);
    return { sprite: container, redraw };
  }

  // 创建可捡起物品
  createItem(e) {
    const gx = e.pos[0], gy = e.pos[1];
    const px = G.mapOriginX + gx * G.tileSize + G.tileSize / 2;
    const py = G.mapOriginY + gy * G.tileSize + G.tileSize / 2;
    const container = this.add.container(px, py);
    container.setDepth(8);

    switch (e.sprite) {
      case 'breakfast': this.drawItem_Breakfast(container); break;
      default:          this.drawItem_Generic(container); break;
    }

    // 轻微浮动提示"可捡起"
    this.tweens.add({
      targets: container, y: py - 3,
      duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
    });
    return container;
  }

  drawItem_Breakfast(container) {
    const g = this.add.graphics();
    g.lineStyle(2, 0x2C3E50, 1);
    // 盘子
    g.fillStyle(0xFFFFFF, 1);
    g.fillEllipse(0, 3, 18, 6);
    g.strokeEllipse(0, 3, 18, 6);
    // 三明治面包
    g.fillStyle(0xF1C40F, 1);
    g.fillRoundedRect(-7, -5, 14, 6, 2);
    g.strokeRoundedRect(-7, -5, 14, 6, 2);
    // 生菜
    g.fillStyle(0x2ECC71, 1);
    g.fillRoundedRect(-6, -2, 12, 2, 1);
    // 小牛奶盒(旁边)
    g.fillStyle(0xAEDDFF, 1);
    g.fillRoundedRect(-10, -4, 3, 5, 1);
    g.strokeRoundedRect(-10, -4, 3, 5, 1);
    container.add(g);
  }

  drawItem_Generic(container) {
    const g = this.add.graphics();
    g.lineStyle(2, 0x2C3E50, 1);
    g.fillStyle(0xFFD700, 1);
    g.fillCircle(0, 0, 6);
    g.strokeCircle(0, 0, 6);
    container.add(g);
  }

  drawObjects(objects) {
    objects.forEach(obj => {
      const [x, y] = obj.pos;
      const px = G.mapOriginX + x * G.tileSize;
      const py = G.mapOriginY + y * G.tileSize;
      const w = (obj.size?.[0] || 1) * G.tileSize;
      const h = (obj.size?.[1] || 1) * G.tileSize;

      switch (obj.type) {
        case 'bed':       this.drawBed(px, py, w, h); break;
        case 'desk':      this.drawDesk(px, py, w, h); break;
        case 'tv':        this.drawTV(px, py, w, h); break;
        case 'rug':       this.drawRug(px, py, w, h); break;
        case 'window':    this.drawWindow(px, py, w, h); break;
        case 'lamp':      this.drawLamp(px, py, w, h); break;
        case 'plant':     this.drawPlant(px, py, w, h); break;
        case 'table':     this.drawTable(px, py, w, h); break;
        case 'stove':     this.drawStove(px, py, w, h); break;
        case 'tree':      this.drawTree(px, py, w, h); break;
        case 'crosswalk': this.drawCrosswalk(px, py, w, h); break;
        case 'bookshelf': this.drawBookshelf(px, py, w, h); break;
        case 'shop':      this.drawShop(px, py, w, h); break;
      }
    });
  }

  // ---------- 家具绘制(风格:粗黑描边+纯色,和困困脸角色对齐) ----------

  drawBed(px, py, w, h) {
    const bed = this.add.graphics();
    bed.lineStyle(3, 0x2C3E50, 1);
    bed.fillStyle(0xFFB6D5, 1);
    bed.fillRoundedRect(px + 3, py + 3, w - 6, h - 6, 8);
    bed.strokeRoundedRect(px + 3, py + 3, w - 6, h - 6, 8);
    bed.fillStyle(0xFFFFFF, 1);
    bed.fillRoundedRect(px + 6, py + 5, w - 12, h * 0.28, 6);
    bed.strokeRoundedRect(px + 6, py + 5, w - 12, h * 0.28, 6);
    const cx = px + w / 2;
    const cy = py + h * 0.65;
    bed.fillStyle(0xFF6B9D, 1);
    bed.fillCircle(cx - 4, cy - 2, 3);
    bed.fillCircle(cx + 4, cy - 2, 3);
    bed.fillTriangle(cx - 7, cy, cx + 7, cy, cx, cy + 7);
  }

  drawDesk(px, py, w, h) {
    const desk = this.add.graphics();
    desk.lineStyle(3, 0x2C3E50, 1);
    desk.fillStyle(0xC19A6B, 1);
    desk.fillRoundedRect(px + 3, py + 3, w - 6, h - 6, 4);
    desk.strokeRoundedRect(px + 3, py + 3, w - 6, h - 6, 4);
    const bookX = px + w * 0.25;
    const bookY = py + h * 0.3;
    const bookW = w * 0.5;
    const bookH = h * 0.18;
    const colors = [0xE74C3C, 0x3498DB, 0x2ECC71];
    colors.forEach((c, i) => {
      desk.fillStyle(c, 1);
      desk.fillRoundedRect(bookX, bookY + i * bookH, bookW, bookH, 2);
      desk.strokeRoundedRect(bookX, bookY + i * bookH, bookW, bookH, 2);
    });
  }

  drawTV(px, py, w, h) {
    const tv = this.add.graphics();
    tv.lineStyle(3, 0x2C3E50, 1);
    tv.fillStyle(0x2C3E50, 1);
    tv.fillRoundedRect(px + 2, py + 2, w - 4, h - 4, 6);
    tv.strokeRoundedRect(px + 2, py + 2, w - 4, h - 4, 6);
    tv.fillStyle(0xAEDDFF, 1);
    tv.fillRoundedRect(px + 6, py + 6, w - 12, h - 12, 3);
    const cx = px + w / 2;
    const cy = py + h / 2;
    const r = Math.min(w, h) * 0.22;
    const halo = this.add.graphics();
    halo.fillStyle(0xD4ECFF, 0.6);
    halo.fillCircle(cx, cy, r * 1.5);
    const xtBody = this.add.graphics();
    xtBody.lineStyle(2, 0x2C3E50, 1);
    xtBody.fillStyle(0xFFFFFF, 1);
    xtBody.fillCircle(cx, cy, r);
    xtBody.strokeCircle(cx, cy, r);
    xtBody.fillStyle(0x000000, 1);
    xtBody.fillCircle(cx - r * 0.35, cy - r * 0.1, r * 0.18);
    xtBody.fillCircle(cx + r * 0.35, cy - r * 0.1, r * 0.18);
    xtBody.lineStyle(2, 0x2C3E50, 1);
    xtBody.beginPath();
    xtBody.arc(cx, cy + r * 0.25, r * 0.25, 0.2 * Math.PI, 0.8 * Math.PI);
    xtBody.strokePath();
    this.tweens.add({
      targets: halo, alpha: 0.3, duration: 1200, yoyo: true, repeat: -1
    });
  }

  drawRug(px, py, w, h) {
    const rug = this.add.graphics();
    rug.lineStyle(2, 0xD4756B, 0.7);
    rug.fillStyle(0xFFB0C4, 0.5);
    rug.fillRoundedRect(px + 3, py + 3, w - 6, h - 6, 10);
    rug.strokeRoundedRect(px + 3, py + 3, w - 6, h - 6, 10);
    const teethCount = Math.floor((w - 6) / 8);
    for (let i = 0; i < teethCount; i++) {
      const tx = px + 3 + i * 8 + 4;
      rug.fillStyle(0xFFD4DC, 0.7);
      rug.fillTriangle(tx - 3, py + h - 3, tx + 3, py + h - 3, tx, py + h + 2);
    }
  }

  drawWindow(px, py, w, h) {
    const win = this.add.graphics();
    win.lineStyle(3, 0x2C3E50, 1);
    win.fillStyle(0xC19A6B, 1);
    win.fillRoundedRect(px + 3, py + 3, w - 6, h - 6, 2);
    win.strokeRoundedRect(px + 3, py + 3, w - 6, h - 6, 2);
    win.fillStyle(0xAEDDFF, 1);
    win.fillRect(px + 7, py + 7, w - 14, h - 14);
    win.lineStyle(2, 0xC19A6B, 1);
    win.beginPath();
    win.moveTo(px + w / 2, py + 7);
    win.lineTo(px + w / 2, py + h - 7);
    win.moveTo(px + 7, py + h / 2);
    win.lineTo(px + w - 7, py + h / 2);
    win.strokePath();
    win.fillStyle(0xFFFFFF, 0.9);
    win.fillCircle(px + w * 0.35, py + h * 0.35, Math.min(w, h) * 0.08);
    win.fillCircle(px + w * 0.45, py + h * 0.30, Math.min(w, h) * 0.10);
    win.fillCircle(px + w * 0.55, py + h * 0.35, Math.min(w, h) * 0.08);
  }

  drawLamp(px, py, w, h) {
    const lamp = this.add.graphics();
    lamp.lineStyle(3, 0x2C3E50, 1);
    lamp.fillStyle(0x8B5A3C, 1);
    lamp.fillRoundedRect(px + w * 0.3, py + h * 0.7, w * 0.4, h * 0.25, 3);
    lamp.strokeRoundedRect(px + w * 0.3, py + h * 0.7, w * 0.4, h * 0.25, 3);
    lamp.fillStyle(0xF1C40F, 1);
    lamp.fillTriangle(
      px + w * 0.2, py + h * 0.65,
      px + w * 0.8, py + h * 0.65,
      px + w * 0.5, py + h * 0.1
    );
    lamp.strokeTriangle(
      px + w * 0.2, py + h * 0.65,
      px + w * 0.8, py + h * 0.65,
      px + w * 0.5, py + h * 0.1
    );
  }

  drawPlant(px, py, w, h) {
    const plant = this.add.graphics();
    plant.lineStyle(3, 0x2C3E50, 1);
    plant.fillStyle(0xC19A6B, 1);
    plant.fillRoundedRect(px + w * 0.25, py + h * 0.6, w * 0.5, h * 0.35, 3);
    plant.strokeRoundedRect(px + w * 0.25, py + h * 0.6, w * 0.5, h * 0.35, 3);
    plant.fillStyle(0x2ECC71, 1);
    plant.fillCircle(px + w * 0.5, py + h * 0.3, Math.min(w, h) * 0.20);
    plant.fillCircle(px + w * 0.35, py + h * 0.45, Math.min(w, h) * 0.15);
    plant.fillCircle(px + w * 0.65, py + h * 0.45, Math.min(w, h) * 0.15);
    plant.strokeCircle(px + w * 0.5, py + h * 0.3, Math.min(w, h) * 0.20);
    plant.strokeCircle(px + w * 0.35, py + h * 0.45, Math.min(w, h) * 0.15);
    plant.strokeCircle(px + w * 0.65, py + h * 0.45, Math.min(w, h) * 0.15);
  }

  drawTable(px, py, w, h) {
    const t = this.add.graphics();
    t.lineStyle(3, 0x2C3E50, 1);
    // 桌面(浅棕圆角方形)
    t.fillStyle(0xD4A574, 1);
    t.fillRoundedRect(px + 3, py + 3, w - 6, h - 6, 6);
    t.strokeRoundedRect(px + 3, py + 3, w - 6, h - 6, 6);
    // 桌布格子(一条)
    t.lineStyle(1.5, 0xB8956C, 1);
    t.beginPath();
    t.moveTo(px + w / 2, py + 6);
    t.lineTo(px + w / 2, py + h - 6);
    t.strokePath();
  }

  drawStove(px, py, w, h) {
    const s = this.add.graphics();
    s.lineStyle(3, 0x2C3E50, 1);
    // 炉身
    s.fillStyle(0xBDC3C7, 1);
    s.fillRoundedRect(px + 3, py + 3, w - 6, h - 6, 4);
    s.strokeRoundedRect(px + 3, py + 3, w - 6, h - 6, 4);
    // 两个炉头
    s.fillStyle(0x2C3E50, 1);
    s.fillCircle(px + w * 0.3, py + h * 0.35, Math.min(w, h) * 0.12);
    s.fillCircle(px + w * 0.7, py + h * 0.35, Math.min(w, h) * 0.12);
    // 内圈(红色火圈提示)
    s.fillStyle(0xE74C3C, 1);
    s.fillCircle(px + w * 0.3, py + h * 0.35, Math.min(w, h) * 0.06);
    s.fillCircle(px + w * 0.7, py + h * 0.35, Math.min(w, h) * 0.06);
    // 控制旋钮
    s.fillStyle(0x2C3E50, 1);
    s.fillCircle(px + w * 0.3, py + h * 0.75, 2);
    s.fillCircle(px + w * 0.7, py + h * 0.75, 2);
  }

  drawTree(px, py, w, h) {
    const t = this.add.graphics();
    t.lineStyle(3, 0x2C3E50, 1);
    // 树干
    t.fillStyle(0x8B5A3C, 1);
    t.fillRoundedRect(px + w * 0.4, py + h * 0.55, w * 0.2, h * 0.4, 2);
    t.strokeRoundedRect(px + w * 0.4, py + h * 0.55, w * 0.2, h * 0.4, 2);
    // 树冠(三朵云泡泡)
    t.fillStyle(0x2ECC71, 1);
    t.fillCircle(px + w * 0.5, py + h * 0.25, Math.min(w, h) * 0.22);
    t.fillCircle(px + w * 0.3, py + h * 0.4,  Math.min(w, h) * 0.18);
    t.fillCircle(px + w * 0.7, py + h * 0.4,  Math.min(w, h) * 0.18);
    t.strokeCircle(px + w * 0.5, py + h * 0.25, Math.min(w, h) * 0.22);
    t.strokeCircle(px + w * 0.3, py + h * 0.4,  Math.min(w, h) * 0.18);
    t.strokeCircle(px + w * 0.7, py + h * 0.4,  Math.min(w, h) * 0.18);
    // 小苹果点缀
    t.fillStyle(0xE74C3C, 1);
    t.fillCircle(px + w * 0.45, py + h * 0.3, 2);
    t.fillCircle(px + w * 0.6, py + h * 0.38, 2);
  }

  drawCrosswalk(px, py, w, h) {
    const c = this.add.graphics();
    // 灰色底(马路)
    c.fillStyle(0x5D6D7E, 1);
    c.fillRect(px, py, w, h);
    // 白色斑马线条纹
    c.fillStyle(0xFFFFFF, 0.85);
    const stripeH = 4;
    const gap = 4;
    let yy = py + 4;
    while (yy + stripeH < py + h - 3) {
      c.fillRect(px + 4, yy, w - 8, stripeH);
      yy += stripeH + gap;
    }
  }

  drawBookshelf(px, py, w, h) {
    const b = this.add.graphics();
    b.lineStyle(3, 0x2C3E50, 1);
    // 书架木框
    b.fillStyle(0x8B5A3C, 1);
    b.fillRoundedRect(px + 3, py + 3, w - 6, h - 6, 2);
    b.strokeRoundedRect(px + 3, py + 3, w - 6, h - 6, 2);
    // 书本(按高度分 3 层)
    const shelfH = (h - 14) / 3;
    const colors = [
      [0xE74C3C, 0x3498DB, 0xF1C40F],
      [0x2ECC71, 0xE67E22, 0x9B59B6],
      [0xFF6B9D, 0x3498DB, 0xF1C40F]
    ];
    for (let s = 0; s < 3; s++) {
      const sy = py + 6 + s * (shelfH + 1);
      // 书本若干
      for (let i = 0; i < 3; i++) {
        const bx = px + 6 + i * ((w - 12) / 3);
        const bw = (w - 14) / 3;
        b.fillStyle(colors[s][i], 1);
        b.fillRect(bx, sy, bw, shelfH);
        b.lineStyle(1, 0x2C3E50, 1);
        b.strokeRect(bx, sy, bw, shelfH);
      }
      // 隔板
      b.lineStyle(2, 0x2C3E50, 1);
      b.beginPath();
      b.moveTo(px + 4, sy + shelfH + 0.5);
      b.lineTo(px + w - 4, sy + shelfH + 0.5);
      b.strokePath();
    }
  }

  // 超市门面(T1 一整块 2x2)
  drawShop(px, py, w, h) {
    const s = this.add.graphics();
    s.lineStyle(3, 0x2C3E50, 1);
    // 墙体(砖红)
    s.fillStyle(0xE0856A, 1);
    s.fillRect(px + 2, py + 2, w - 4, h - 4);
    s.strokeRect(px + 2, py + 2, w - 4, h - 4);
    // 顶棚(白+红条)
    s.fillStyle(0xE74C3C, 1);
    s.fillTriangle(px + 2, py + 8, px + w / 2, py + 2, px + w - 2, py + 8);
    // 招牌(白框,写"超市")
    s.fillStyle(0xFFFFFF, 1);
    s.fillRoundedRect(px + w * 0.2, py + h * 0.25, w * 0.6, h * 0.2, 2);
    s.strokeRoundedRect(px + w * 0.2, py + h * 0.25, w * 0.6, h * 0.2, 2);
    // 门(黄)
    s.fillStyle(0xF1C40F, 1);
    s.fillRect(px + w * 0.4, py + h * 0.55, w * 0.2, h * 0.4);
    s.strokeRect(px + w * 0.4, py + h * 0.55, w * 0.2, h * 0.4);
    // 招牌文字 — 用几个小方块表示"超市"
    s.fillStyle(0x2C3E50, 1);
    s.fillRect(px + w * 0.35, py + h * 0.32, 3, 6);
    s.fillRect(px + w * 0.45, py + h * 0.32, 3, 6);
    s.fillRect(px + w * 0.55, py + h * 0.32, 3, 6);
  }

  // 占位版婉婉:用图形+emoji 临时顶替,后续换 sprite
  createWanwanSprite(gx, gy) {
    const px = G.mapOriginX + gx * G.tileSize + G.tileSize / 2;
    const py = G.mapOriginY + gy * G.tileSize + G.tileSize / 2;

    const container = this.add.container(px, py);

    // 腿(左右分开,用于走路动画)
    const legL = this.add.graphics();
    legL.lineStyle(2, 0x2C3E50, 1);
    legL.fillStyle(0x3498DB, 1);
    legL.fillRoundedRect(-7, 12, 5, 8, 2);
    legL.strokeRoundedRect(-7, 12, 5, 8, 2);
    const legR = this.add.graphics();
    legR.lineStyle(2, 0x2C3E50, 1);
    legR.fillStyle(0x3498DB, 1);
    legR.fillRoundedRect(2, 12, 5, 8, 2);
    legR.strokeRoundedRect(2, 12, 5, 8, 2);

    // 身体(蓝色背带裤)
    const body = this.add.graphics();
    body.lineStyle(2, 0x2C3E50, 1);
    body.fillStyle(0xFFFFFF, 1);   // 白T恤部分
    body.fillRoundedRect(-9, -4, 18, 8, 3);
    body.strokeRoundedRect(-9, -4, 18, 8, 3);
    body.fillStyle(0x3498DB, 1);   // 蓝背带裤
    body.fillRoundedRect(-8, 2, 16, 12, 3);
    body.strokeRoundedRect(-8, 2, 16, 12, 3);
    // 背带
    body.fillStyle(0x3498DB, 1);
    body.fillRect(-6, -4, 3, 6);
    body.fillRect(3, -4, 3, 6);

    // 手(左右分开,用于走路摆臂)
    const armL = this.add.graphics();
    armL.lineStyle(2, 0x2C3E50, 1);
    armL.fillStyle(0xFDE3C3, 1);
    armL.fillRoundedRect(-12, 0, 4, 10, 2);
    armL.strokeRoundedRect(-12, 0, 4, 10, 2);
    const armR = this.add.graphics();
    armR.lineStyle(2, 0x2C3E50, 1);
    armR.fillStyle(0xFDE3C3, 1);
    armR.fillRoundedRect(8, 0, 4, 10, 2);
    armR.strokeRoundedRect(8, 0, 4, 10, 2);

    // 脸(肤色圆)
    const face = this.add.graphics();
    face.lineStyle(2, 0x2C3E50, 1);
    face.fillStyle(0xFDE3C3, 1);
    face.fillCircle(0, -14, 12);
    face.strokeCircle(0, -14, 12);

    // 头发(刘海,黑色)
    const hair = this.add.graphics();
    hair.fillStyle(0x1A1A1A, 1);
    hair.fillRoundedRect(-11, -22, 22, 8, 4);
    // 两侧短发
    hair.fillCircle(-10, -14, 4);
    hair.fillCircle(10, -14, 4);

    // 白鸭舌帽
    const cap = this.add.graphics();
    cap.lineStyle(2, 0x2C3E50, 1);
    cap.fillStyle(0xFFFFFF, 1);
    cap.fillRoundedRect(-12, -27, 24, 8, 4);
    cap.strokeRoundedRect(-12, -27, 24, 8, 4);
    // 帽檐
    cap.fillStyle(0xFFFFFF, 1);
    cap.fillRoundedRect(-16, -22, 16, 3, 2);
    cap.strokeRoundedRect(-16, -22, 16, 3, 2);
    // 帽子上的小粉心(身份标识)
    cap.fillStyle(0xFF6B9D, 1);
    cap.fillCircle(-2, -23, 1.5);
    cap.fillCircle(2, -23, 1.5);
    cap.fillTriangle(-4, -22, 4, -22, 0, -19);

    // 眼睛(困困风格:椭圆白眼白 + 上眼皮 + 黑瞳)
    const eyes = this.add.graphics();
    // 眼白
    eyes.lineStyle(1.5, 0x2C3E50, 1);
    eyes.fillStyle(0xFFFFFF, 1);
    eyes.fillEllipse(-4, -13, 5, 4);
    eyes.fillEllipse(4, -13, 5, 4);
    eyes.strokeEllipse(-4, -13, 5, 4);
    eyes.strokeEllipse(4, -13, 5, 4);
    // 上眼皮压下来
    eyes.fillStyle(0xFDE3C3, 1);
    eyes.fillRect(-7, -15, 6, 2);
    eyes.fillRect(1, -15, 6, 2);
    // 黑瞳
    eyes.fillStyle(0x000000, 1);
    eyes.fillCircle(-4, -12, 1.5);
    eyes.fillCircle(4, -12, 1.5);

    // 腮红
    const blush = this.add.graphics();
    blush.fillStyle(0xFF6B9D, 0.5);
    blush.fillCircle(-7, -11, 1.5);
    blush.fillCircle(7, -11, 1.5);

    // 小嘴
    const mouth = this.add.graphics();
    mouth.lineStyle(1.5, 0x2C3E50, 1);
    mouth.beginPath();
    mouth.arc(0, -9, 1.5, 0, Math.PI);
    mouth.strokePath();

    // 正确层叠:腿 → 身体 → 手 → 头部
    container.add([legL, legR, body, armL, armR, face, hair, cap, eyes, blush, mouth]);

    container.gridX = gx;
    container.gridY = gy;
    container.setDepth(10);

    // 把需要动画的部位挂到 container 上,便于访问
    container.legL = legL;
    container.legR = legR;
    container.armL = armL;
    container.armR = armR;
    container.isWalking = false;

    return container;
  }

  // 启动走路动画(左右腿 + 手交替摆)
  startWalkAnim(sprite) {
    if (sprite.isWalking) return;
    sprite.isWalking = true;
    const dur = 150;
    // 腿摆
    sprite.walkTweenLeg = this.tweens.add({
      targets: sprite.legL,
      y: { from: -2, to: -4 },
      duration: dur, yoyo: true, repeat: -1
    });
    this.tweens.add({
      targets: sprite.legR,
      y: { from: 0, to: 2 },
      duration: dur, yoyo: true, repeat: -1
    });
    // 手摆
    this.tweens.add({
      targets: sprite.armL,
      y: { from: 0, to: -2 },
      duration: dur, yoyo: true, repeat: -1
    });
    this.tweens.add({
      targets: sprite.armR,
      y: { from: 0, to: 2 },
      duration: dur, yoyo: true, repeat: -1
    });
    // 整体上下小幅弹跳
    this.tweens.add({
      targets: sprite,
      scaleY: { from: 1, to: 0.97 },
      duration: dur, yoyo: true, repeat: -1
    });
  }

  stopWalkAnim(sprite) {
    if (!sprite.isWalking) return;
    sprite.isWalking = false;
    // 停止所有 tween
    this.tweens.killTweensOf(sprite.legL);
    this.tweens.killTweensOf(sprite.legR);
    this.tweens.killTweensOf(sprite.armL);
    this.tweens.killTweensOf(sprite.armR);
    this.tweens.killTweensOf(sprite);
    // 复位
    sprite.legL.y = 0;
    sprite.legR.y = 0;
    sprite.armL.y = 0;
    sprite.armR.y = 0;
    sprite.scaleY = 1;
  }

  // 移动玩家一格
  movePlayer(dir) {
    return new Promise(resolve => {
      const dx = { left: -1, right: 1, up: 0, down: 0 }[dir];
      const dy = { up: -1, down: 1, left: 0, right: 0 }[dir];
      const nx = G.player.gridX + dx;
      const ny = G.player.gridY + dy;
      const [cols, rows] = G.currentLevel.map.size;

      // 边界检查
      if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) {
        resolve(false); return;
      }
      // 墙碰撞
      if (G.walls && G.walls.has(`${nx},${ny}`)) {
        resolve(false); return;
      }
      // NPC 占位(不能走到NPC身上,但follower/被bypass的不阻挡)
      if (G.entities) {
        const NPC_TYPES = ['shuimu','durple','raddy','lime','gray','jevin','cikur',
                           'brud','simon','tunner','wenda','dashu',
                           'pinki','tengman','oren','blake','garnold','diannao','npc'];
        const blocker = Object.values(G.entities).find(en =>
          (NPC_TYPES.includes(en.type) || en.type === 'reply_guard' || en.type === 'loop_npc') &&
          en.role !== 'follower' &&
          !en.bypassed &&
          en.gridX === nx && en.gridY === ny
        );
        if (blocker) {
          G.lastBlockMessage = blocker.block_message || null;
          resolve(false); return;
        }
      }
      // E8/E12:病毒格子未清理,拦路
      if (G.entities) {
        const virus = Object.values(G.entities).find(en =>
          en.type === 'virus_tile' && !en.cleaned &&
          en.gridX === nx && en.gridY === ny
        );
        if (virus) {
          G.lastBlockMessage = '这里有病毒,先清理!';
          resolve(false); return;
        }
      }
      // blocked_door(C5/C8 用)
      if (G.entities) {
        const door = Object.values(G.entities).find(en =>
          en.type === 'blocked_door' && !en.unlocked &&
          en.gridX === nx && en.gridY === ny
        );
        if (door) {
          G.lastBlockMessage = door.message || '这扇门进不去~';
          resolve(false); return;
        }
      }
      // color_gate(C6 用):只有当前颜色与要求一致才能通过
      if (G.entities) {
        const cgate = Object.values(G.entities).find(en =>
          en.type === 'color_gate' &&
          en.gridX === nx && en.gridY === ny
        );
        if (cgate && cgate.current_color !== cgate.pass_color) {
          G.lastBlockMessage = '守卫还是看到危险色!';
          resolve(false); return;
        }
      }
      // timed_gate(C9 用):关闭时不可通过
      if (G.entities) {
        const tgate = Object.values(G.entities).find(en =>
          en.type === 'timed_gate' && !en.open &&
          en.gridX === nx && en.gridY === ny
        );
        if (tgate) {
          G.lastBlockMessage = '门关着!要等时机~';
          resolve(false); return;
        }
      }
      // safe_box(D1 用):未解锁时不可通过;但 hidden=true(E7 未部署)不拦
      if (G.entities) {
        const safe = Object.values(G.entities).find(en =>
          en.type === 'safe_box' && !en.unlocked && !en.hidden &&
          en.gridX === nx && en.gridY === ny
        );
        if (safe) {
          G.lastBlockMessage = '保险箱锁着,先输密码~';
          resolve(false); return;
        }
      }

      const targetX = G.mapOriginX + nx * G.tileSize + G.tileSize / 2;
      const targetY = G.mapOriginY + ny * G.tileSize + G.tileSize / 2;

      // 记录玩家原位置(用于 follower 跟随)
      const oldGridX = G.player.gridX;
      const oldGridY = G.player.gridY;

      // 左右移动:翻转朝向
      if (dir === 'left') {
        G.player.scaleX = -1;
      } else if (dir === 'right') {
        G.player.scaleX = 1;
      }

      // 启动走路动画
      this.startWalkAnim(G.player);

      this.tweens.add({
        targets: G.player,
        x: targetX, y: targetY,
        duration: 300,
        onComplete: () => {
          G.player.gridX = nx;
          G.player.gridY = ny;
          this.stopWalkAnim(G.player);
          // 携带的物品也跟着走
          if (G.carriedItem && G.entities[G.carriedItem]) {
            const item = G.entities[G.carriedItem];
            item.sprite.x = G.player.x;
            item.sprite.y = G.player.y - 20;
          }
          // 持有的凭证跟随玩家
          Object.values(G.entities).forEach(en => {
            if (en.type === 'credential' && en.followsPlayer) {
              en.sprite.x = G.player.x + 10;
              en.sprite.y = G.player.y - 5;
            }
          });
          // Follower 跟随:移动到玩家刚才的位置
          Object.values(G.entities).forEach(en => {
            if (en.role === 'follower' && en.follows === 'player') {
              en.gridX = oldGridX;
              en.gridY = oldGridY;
              const fx = G.mapOriginX + oldGridX * G.tileSize + G.tileSize / 2;
              const fy = G.mapOriginY + oldGridY * G.tileSize + G.tileSize / 2;
              this.tweens.add({
                targets: en.sprite,
                x: fx, y: fy,
                duration: 280
              });
            }
          });
          // 自动提示:路过石头/NPC 会自动弹出它的线索(再等泡泡播完再继续)
          // E7:路过前端假门时,触发"贴纸被揭"视觉 + 气泡
          const fakeDoor = Object.values(G.entities || {}).find(en =>
            en.type === 'fake_check_door' && !en.revealed &&
            en.gridX === nx && en.gridY === ny
          );
          const afterHint = async () => {
            if (fakeDoor) {
              fakeDoor.revealed = true;
              if (fakeDoor.reveal) fakeDoor.reveal();
              await this.showBubble(G.player, '咦?没挡住!');
            }
            await this.autoShowNearbyHints();
            resolve(true);
          };
          afterHint();
        }
      });
    });
  }

  // 捡起
  async pickupAction() {
    if (G.carriedItem) {
      await this.showBubble(G.player, '手里已经有东西啦!');
      return true; // 动作算完成,别阻断队列
    }
    // 找同格的可捡物品
    const px = G.player.gridX, py = G.player.gridY;
    const itemEntry = Object.entries(G.entities || {}).find(([id, en]) =>
      en.type === 'item' && en.pickupable && !en.carried &&
      en.gridX === px && en.gridY === py
    );
    if (!itemEntry) {
      await this.showBubble(G.player, '这里没东西可捡...');
      return true;
    }
    const [id, item] = itemEntry;
    item.carried = true;
    G.carriedItem = id;
    // 物品移到婉婉头上
    this.tweens.add({
      targets: item.sprite,
      x: G.player.x, y: G.player.y - 20,
      duration: 200
    });
    await this.showBubble(G.player, '捡到啦!');
    return true;
  }

  // 放下
  async dropAction() {
    if (!G.carriedItem) {
      // E5 注入关:手里空也允许 drop(比喻上就是"放下不存在的盒子")
      await this.showBubble(G.player, '咚!(放下了)');
      return true;
    }
    const id = G.carriedItem;
    const item = G.entities[id];
    item.carried = false;
    G.carriedItem = null;
    // 物品放到婉婉脚边
    item.gridX = G.player.gridX;
    item.gridY = G.player.gridY;
    const tx = G.mapOriginX + item.gridX * G.tileSize + G.tileSize / 2;
    const ty = G.mapOriginY + item.gridY * G.tileSize + G.tileSize / 2;
    this.tweens.add({
      targets: item.sprite,
      x: tx, y: ty,
      duration: 200
    });
    await this.showBubble(G.player, '放下了!');
    return true;
  }

  // 给附近的可着色对象上色(颜色类指令)
  async setColorAction(color) {
    // 找玩家附近(当前格 / 上下左右相邻格)的可着色实体
    const px = G.player.gridX, py = G.player.gridY;
    const nearby = [[px,py],[px,py-1],[px,py+1],[px-1,py],[px+1,py]];

    // 先处理 color_gate(C6:直接变色)
    const gateEntry = Object.entries(G.entities || {}).find(([id, en]) =>
      en.type === 'color_gate' && nearby.some(([x,y]) => en.gridX === x && en.gridY === y)
    );
    if (gateEntry) {
      const [, gate] = gateEntry;
      gate.current_color = color;
      if (gate.redraw) gate.redraw(color);
      const word = { red:'红', blue:'蓝', green:'绿', yellow:'黄' }[color] || color;
      await this.showBubble(G.player, `变${word}色!`);
      return true;
    }

    const target = Object.entries(G.entities || {}).find(([id, en]) =>
      en.colorable && nearby.some(([x,y]) => en.gridX === x && en.gridY === y)
    );

    if (!target) {
      await this.showBubble(G.player, '旁边没有能上色的东西...');
      return true;
    }

    const [id, entity] = target;
    // 记录本次着色
    entity.current_sequence = entity.current_sequence || [];
    entity.current_sequence.push(color);

    // 视觉反馈:在信号灯上显示当前颜色的亮度
    if (entity.sprite && entity.redraw) {
      entity.redraw(color);
    }

    // 小小的反馈气泡
    const colorName = {red:'红',yellow:'黄',green:'绿',blue:'蓝',white:'白'}[color] || color;
    await this.showBubble(G.player, `涂上${colorName}色!`);
    return true;
  }

  // 取证件:从附近格子上拿起 credential 实体,记入 G.heldCredentials
  async takeCredentialAction() {
    const px = G.player.gridX, py = G.player.gridY;
    const nearby = [[px,py],[px,py-1],[px,py+1],[px-1,py],[px+1,py]];

    const target = Object.entries(G.entities || {}).find(([id, en]) =>
      en.type === 'credential' && !en.taken &&
      nearby.some(([x,y]) => en.gridX === x && en.gridY === y)
    );

    if (!target) {
      await this.showBubble(G.player, '这里没有证件...');
      return true;
    }
    const [id, cred] = target;
    cred.taken = true;
    G.heldCredentials = G.heldCredentials || new Set();
    G.heldCredentials.add(cred.credential_type);

    // 视觉:飞到婉婉身上
    this.tweens.add({
      targets: cred.sprite,
      x: G.player.x + 10, y: G.player.y - 5,
      alpha: 0.9,
      scaleX: 0.6, scaleY: 0.6,
      duration: 250
    });
    // 设为跟随玩家(用 setDepth 让它一直显示在玩家旁)
    cred.followsPlayer = true;
    cred.sprite.setDepth(11);

    await this.showBubble(G.player, '拿到证件啦!');
    return true;
  }

  // 胜利条件统一判定
  checkSuccess() {
    const cond = G.currentLevel.success_condition;
    if (!cond) return false;

    if (cond.type === 'reach_goal') {
      const goalId = cond.goal_id;
      const goal = G.currentLevel.entities.find(e => e.id === goalId);
      if (!goal) return false;
      return G.player.gridX === goal.pos[0] && G.player.gridY === goal.pos[1];
    }
    if (cond.type === 'item_at_goal') {
      const item = G.entities[cond.item_id];
      const goal = G.currentLevel.entities.find(e => e.id === cond.goal_id);
      if (!item || !goal) return false;
      if (item.carried) return false;
      return item.gridX === goal.pos[0] && item.gridY === goal.pos[1];
    }
    if (cond.type === 'color_sequence_matches') {
      const entity = G.entities[cond.entity_id];
      if (!entity || !entity.required_sequence) return false;
      const cur = entity.current_sequence || [];
      const req = entity.required_sequence;
      if (cur.length !== req.length) return false;
      return cur.every((c, i) => c === req[i]);
    }
    if (cond.type === 'reach_credential_door') {
      const door = G.entities[cond.goal_id];
      if (!door) return false;
      if (G.player.gridX !== door.gridX || G.player.gridY !== door.gridY) return false;
      return G.heldCredentials && G.heldCredentials.has(door.requires_credential);
    }
    if (cond.type === 'all_watered') {
      return (cond.entity_ids || []).every(id => {
        const f = G.entities[id];
        return f && f.watered;
      });
    }
    // E8/E12:所有指定病毒格清理完 + 玩家到达目标
    if (cond.type === 'all_virus_cleaned') {
      const allClean = (cond.entity_ids || []).every(id => {
        const v = G.entities[id];
        return v && v.cleaned;
      });
      if (!allClean) return false;
      if (cond.reach_goal_id) {
        const goal = G.currentLevel.entities.find(e => e.id === cond.reach_goal_id);
        if (!goal) return false;
        if (G.player.gridX !== goal.pos[0] || G.player.gridY !== goal.pos[1]) return false;
      }
      return true;
    }
    // E9:拆满 N 个真礼物,且**没中木马**;再到达终点
    if (cond.type === 'collect_safe_gifts') {
      const need = cond.required_count || 2;
      const got = G.giftsOpened || 0;
      const trojanHit = G.trojanTriggered || 0;
      if (got < need) return false;
      if (trojanHit > 0) return false;
      if (cond.reach_goal_id) {
        const goal = G.currentLevel.entities.find(e => e.id === cond.reach_goal_id);
        if (!goal) return false;
        if (G.player.gridX !== goal.pos[0] || G.player.gridY !== goal.pos[1]) return false;
      }
      return true;
    }
    if (cond.type === 'execute_safe_queue') {
      // 1) 队列里不能包含被标记 malicious 的指令
      const presetQueue = G.currentLevel.preset_queue || [];
      const maliciousIds = new Set(
        presetQueue.filter(c => c.malicious).map(c => c.id)
      );
      const queueHasMalicious = G.commandQueue.some(c => maliciousIds.has(c.id));
      if (queueHasMalicious) return false;
      // 2) 必须保留的动作,全部在队列里(用 "action:item" 格式匹配)
      const actsInQ = G.commandQueue.map(c =>
        c.action === 'buy' ? `buy:${c.item}` : c.action
      );
      const mustKeep = cond.must_keep_actions || [];
      for (const need of mustKeep) {
        if (!actsInQ.includes(need)) return false;
      }
      // 2b) 严格序列校验(E5 注入位置关):队列里必须按 required_order 的 action 顺序出现
      if (cond.required_order && Array.isArray(cond.required_order)) {
        const seq = cond.required_order.slice();
        let i = 0;
        for (const act of actsInQ) {
          if (i < seq.length && act === seq[i]) i++;
        }
        if (i !== seq.length) return false;
      }
      // 3) 最后到达目标格
      if (cond.reach_goal_id) {
        const goal = G.currentLevel.entities.find(e => e.id === cond.reach_goal_id);
        if (!goal) return false;
        if (G.player.gridX !== goal.pos[0] || G.player.gridY !== goal.pos[1]) {
          return false;
        }
      }
      return true;
    }
    return false;
  }

  // 浇水动作:找附近未浇水的花,播放动画,标记为已浇
  async waterAction() {
    const px = G.player.gridX, py = G.player.gridY;
    const nearby = [[px,py],[px,py-1],[px,py+1],[px-1,py],[px+1,py]];

    const target = Object.entries(G.entities || {}).find(([id, en]) =>
      en.type === 'flower' && !en.watered &&
      nearby.some(([x,y]) => en.gridX === x && en.gridY === y)
    );

    if (!target) {
      await this.showBubble(G.player, '这里没有要浇的花...');
      return;
    }
    const [id, flower] = target;
    flower.watered = true;
    if (flower.redraw) flower.redraw();
    for (let i = 0; i < 3; i++) {
      const drop = this.add.text(flower.sprite.x + (i-1)*4, flower.sprite.y - 20, '💧', {
        fontSize: '12px'
      }).setOrigin(0.5).setDepth(15);
      this.tweens.add({
        targets: drop, y: drop.y + 20, alpha: 0,
        duration: 500 + i * 50,
        onComplete: () => drop.destroy()
      });
    }
    await new Promise(r => setTimeout(r, 200));
  }

  // 购买动作(C1 注入关用):记录购买记录,恶意购买会触发失败剧情
  async buyAction(item, label) {
    G.purchaseLog = G.purchaseLog || [];
    G.purchaseLog.push(item);

    // 视觉:玩家头顶冒出商品图标
    const icon = { milk: '🥛', ice_cream: '🍦' }[item] || '🛒';
    const tag = this.add.text(G.player.x, G.player.y - 30, icon, {
      fontSize: '20px'
    }).setOrigin(0.5).setDepth(15);
    this.tweens.add({
      targets: tag, y: tag.y - 20, alpha: 0,
      duration: 800,
      onComplete: () => tag.destroy()
    });

    // 如果是恶意物品,提示(但不阻断执行,让玩家看到后果)
    if (G.currentLevel?.preset_queue) {
      const entry = G.currentLevel.preset_queue.find(c =>
        c.action === 'buy' && c.item === item && c.malicious
      );
      if (entry) {
        await this.showBubble(G.player, `啊!买了 ${label}...`);
      } else {
        await this.showBubble(G.player, `买到 ${label}!`);
      }
    }
  }

  // 凭证(借书证 / 红苹果冒充 / 工牌等)渲染
  createCredential(e) {
    const gx = e.pos[0], gy = e.pos[1];
    const px = G.mapOriginX + gx * G.tileSize + G.tileSize / 2;
    const py = G.mapOriginY + gy * G.tileSize + G.tileSize / 2;
    const container = this.add.container(px, py);
    container.setDepth(8);

    const g = this.add.graphics();
    g.lineStyle(2, 0x2C3E50, 1);

    const variant = e.sprite || 'card';
    if (variant === 'red_apple') {
      // 红苹果(C2 冒充红钥匙)
      g.fillStyle(0xE74C3C, 1);
      g.fillCircle(0, 1, 8);
      g.strokeCircle(0, 1, 8);
      // 苹果叶
      g.fillStyle(0x27AE60, 1);
      g.fillTriangle(0, -6, 4, -9, -2, -8);
      // 高光
      g.fillStyle(0xFFFFFF, 0.6);
      g.fillCircle(-3, -1, 2);
    } else if (variant === 'red_hat') {
      g.fillStyle(0xE74C3C, 1);
      g.fillEllipse(0, 0, 18, 8);
      g.strokeEllipse(0, 0, 18, 8);
      g.fillRoundedRect(-6, -8, 12, 8, 2);
      g.strokeRoundedRect(-6, -8, 12, 8, 2);
    } else if (variant === 'staff_badge') {
      // 工牌(蓝色)
      g.fillStyle(0x3498DB, 1);
      g.fillRoundedRect(-10, -6, 20, 12, 2);
      g.strokeRoundedRect(-10, -6, 20, 12, 2);
      g.fillStyle(0xFFFFFF, 1);
      g.fillCircle(-5, 0, 3);
      g.strokeCircle(-5, 0, 3);
      const tt = this.add.text(3, -6, '工', { fontSize: '9px', color: '#FFFFFF' });
      container.add(tt);
    } else {
      // 默认:金色借书证
      g.fillStyle(0xFFD700, 1);
      g.fillRoundedRect(-10, -6, 20, 12, 2);
      g.strokeRoundedRect(-10, -6, 20, 12, 2);
      g.fillStyle(0xFFFFFF, 1);
      g.fillCircle(-5, 0, 3);
      g.strokeCircle(-5, 0, 3);
      g.lineStyle(1, 0x2C3E50, 1);
      g.beginPath();
      g.moveTo(0, -2); g.lineTo(7, -2);
      g.moveTo(0, 1);  g.lineTo(7, 1);
      g.moveTo(0, 4);  g.lineTo(5, 4);
      g.strokePath();
    }
    container.add(g);

    // 浮动提示"可以拿"
    this.tweens.add({
      targets: container, y: py - 3,
      duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
    });
    return container;
  }

  // 凭证门:需要对应凭证才能进入的门
  createCredentialDoor(e) {
    const gx = e.pos[0], gy = e.pos[1];
    const px = G.mapOriginX + gx * G.tileSize;
    const py = G.mapOriginY + gy * G.tileSize;
    const container = this.add.container(px, py);
    container.setDepth(3);

    const g = this.add.graphics();
    g.lineStyle(3, 0x2C3E50, 1);
    // 门框(棕色)
    g.fillStyle(0x8B5A3C, 1);
    g.fillRoundedRect(4, 2, G.tileSize - 8, G.tileSize - 4, 3);
    g.strokeRoundedRect(4, 2, G.tileSize - 8, G.tileSize - 4, 3);
    // 小窗口
    g.fillStyle(0xAEDDFF, 1);
    g.fillRoundedRect(10, 8, G.tileSize - 20, 10, 2);
    // 把手
    g.fillStyle(0xFFD700, 1);
    g.fillCircle(G.tileSize * 0.75, G.tileSize * 0.5, 2.5);
    // 刷卡识别器(金色小方块,带感应符号)
    g.fillStyle(0xF1C40F, 1);
    g.fillRoundedRect(G.tileSize - 12, G.tileSize - 16, 6, 8, 1);
    g.strokeRoundedRect(G.tileSize - 12, G.tileSize - 16, 6, 8, 1);
    container.add(g);

    // 向下箭头提示这是目标
    const arrow = this.add.text(
      px + G.tileSize / 2, py - 10, '⬇',
      { fontSize: '14px', color: '#F1C40F' }
    ).setOrigin(0.5);
    this.tweens.add({
      targets: arrow, y: py - 14, duration: 600, yoyo: true, repeat: -1
    });

    return container;
  }

  // 花:浇水前是蔫的小花,浇水后变精神
  createFlower(e, state) {
    const gx = e.pos[0], gy = e.pos[1];
    const px = G.mapOriginX + gx * G.tileSize + G.tileSize / 2;
    const py = G.mapOriginY + gy * G.tileSize + G.tileSize / 2;
    const container = this.add.container(px, py);
    container.setDepth(7);

    const potG = this.add.graphics();
    const stemG = this.add.graphics();
    const flowerG = this.add.graphics();
    container.add([potG, stemG, flowerG]);

    const redraw = () => {
      potG.clear(); stemG.clear(); flowerG.clear();
      const watered = state.watered;

      // 花盆(始终一样)
      potG.lineStyle(2, 0x2C3E50, 1);
      potG.fillStyle(0xC19A6B, 1);
      potG.fillRoundedRect(-6, 4, 12, 8, 2);
      potG.strokeRoundedRect(-6, 4, 12, 8, 2);

      // 茎
      stemG.lineStyle(2, watered ? 0x2ECC71 : 0x7F8C8D, 1);
      stemG.beginPath();
      if (watered) {
        stemG.moveTo(0, 4); stemG.lineTo(0, -8); // 挺直
      } else {
        stemG.moveTo(0, 4); stemG.lineTo(2, -2); stemG.lineTo(-1, -6); // 弯曲
      }
      stemG.strokePath();

      // 花朵
      if (watered) {
        // 浇水后:饱满的花,5 瓣
        const pcolor = 0xFF6B9D;
        flowerG.lineStyle(1.5, 0x2C3E50, 1);
        flowerG.fillStyle(pcolor, 1);
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          const pxP = Math.cos(a) * 3.5;
          const pyP = Math.sin(a) * 3.5 - 9;
          flowerG.fillCircle(pxP, pyP, 2.5);
          flowerG.strokeCircle(pxP, pyP, 2.5);
        }
        flowerG.fillStyle(0xF1C40F, 1);
        flowerG.fillCircle(0, -9, 2);
        flowerG.strokeCircle(0, -9, 2);
        // 小叶子
        flowerG.fillStyle(0x2ECC71, 1);
        flowerG.fillTriangle(-4, -3, -1, -3, -3, -6);
      } else {
        // 浇水前:蔫的花,花瓣发灰
        flowerG.lineStyle(1.5, 0x2C3E50, 1);
        flowerG.fillStyle(0xBDC3C7, 1);
        flowerG.fillCircle(-2, -5, 2);
        flowerG.fillCircle(1, -7, 2);
        // 小叹气符号
        flowerG.fillStyle(0x95A5A6, 1);
        flowerG.fillCircle(5, -9, 0.8);
        flowerG.fillCircle(6.5, -10, 0.8);
      }
    };

    redraw();
    return { sprite: container, redraw };
  }

  // 货架:超市关的商品展示,带小商品图标
  createShelf(e) {
    const gx = e.pos[0], gy = e.pos[1];
    const px = G.mapOriginX + gx * G.tileSize + G.tileSize / 2;
    const py = G.mapOriginY + gy * G.tileSize + G.tileSize / 2;
    const container = this.add.container(px, py);
    container.setDepth(6);

    const g = this.add.graphics();
    g.lineStyle(2, 0x2C3E50, 1);
    // 货架金属层板
    g.fillStyle(0xBDC3C7, 1);
    g.fillRoundedRect(-14, -14, 28, 28, 3);
    g.strokeRoundedRect(-14, -14, 28, 28, 3);
    // 商品图标
    const icon = { milk: '🥛', ice_cream: '🍦', bread: '🍞', fruit: '🍎' }[e.sprite] || '📦';
    const text = this.add.text(0, 0, icon, {
      fontSize: '18px'
    }).setOrigin(0.5);
    container.add([g, text]);
    return container;
  }

  // ========== 新概念关:通用实体绘制 ==========

  // C5/C8:假门(看得见走不进,踩上去弹消息)
  createBlockedDoor(e) {
    const gx = e.pos[0], gy = e.pos[1];
    const px = G.mapOriginX + gx * G.tileSize;
    const py = G.mapOriginY + gy * G.tileSize;
    const container = this.add.container(px, py);
    container.setDepth(3);

    const g = this.add.graphics();
    g.lineStyle(3, 0x2C3E50, 1);
    // 红色门(禁止感)
    g.fillStyle(0xE74C3C, 1);
    g.fillRoundedRect(4, 2, G.tileSize - 8, G.tileSize - 4, 3);
    g.strokeRoundedRect(4, 2, G.tileSize - 8, G.tileSize - 4, 3);
    // 门锁图标
    g.fillStyle(0xF1C40F, 1);
    g.fillCircle(G.tileSize * 0.5, G.tileSize * 0.5, 5);
    g.strokeCircle(G.tileSize * 0.5, G.tileSize * 0.5, 5);
    container.add(g);

    // 小标签
    if (e.label) {
      const lbl = this.add.text(G.tileSize / 2, -2, e.label, {
        fontSize: '10px', color: '#FFFFFF',
        backgroundColor: '#E74C3C',
        padding: { x: 3, y: 1 }
      }).setOrigin(0.5, 1);
      container.add(lbl);
    }
    return container;
  }

  // C6:颜色守卫门(红=锁/蓝=开)
  createColorGate(e) {
    const gx = e.pos[0], gy = e.pos[1];
    const px = G.mapOriginX + gx * G.tileSize;
    const py = G.mapOriginY + gy * G.tileSize;
    const container = this.add.container(px, py);
    container.setDepth(3);

    const g = this.add.graphics();
    const redraw = (color) => {
      g.clear();
      g.lineStyle(3, 0x2C3E50, 1);
      const colorMap = { red: 0xE74C3C, blue: 0x3498DB, green: 0x27AE60, yellow: 0xF1C40F };
      g.fillStyle(colorMap[color] || 0xE74C3C, 1);
      g.fillRoundedRect(2, 2, G.tileSize - 4, G.tileSize - 4, 4);
      g.strokeRoundedRect(2, 2, G.tileSize - 4, G.tileSize - 4, 4);
      // 显眼的感应器圆环
      g.lineStyle(2, 0xFFFFFF, 0.8);
      g.strokeCircle(G.tileSize / 2, G.tileSize / 2, 10);
    };
    redraw(e.current_color || 'red');
    container.add(g);
    return { sprite: container, redraw };
  }

  // C9:定时门(开=绿透明 / 关=棕实心)
  createTimedGate(e) {
    const gx = e.pos[0], gy = e.pos[1];
    const px = G.mapOriginX + gx * G.tileSize;
    const py = G.mapOriginY + gy * G.tileSize;
    const container = this.add.container(px, py);
    container.setDepth(3);

    const g = this.add.graphics();
    const redraw = (isOpen) => {
      g.clear();
      g.lineStyle(3, 0x2C3E50, 1);
      if (isOpen) {
        // 开:绿色透明栏杆
        g.fillStyle(0x2ECC71, 0.4);
        g.fillRoundedRect(4, 2, G.tileSize - 8, G.tileSize - 4, 3);
        g.strokeRoundedRect(4, 2, G.tileSize - 8, G.tileSize - 4, 3);
        const tick = this.add.text(G.tileSize / 2, G.tileSize / 2, '✓', {
          fontSize: '18px', color: '#27AE60'
        }).setOrigin(0.5);
        // 旧 tick 清除
        if (container._tick) container._tick.destroy();
        container._tick = tick;
        container.add(tick);
      } else {
        g.fillStyle(0x8B5A3C, 1);
        g.fillRoundedRect(4, 2, G.tileSize - 8, G.tileSize - 4, 3);
        g.strokeRoundedRect(4, 2, G.tileSize - 8, G.tileSize - 4, 3);
        // 栏杆条
        g.lineStyle(2, 0x2C3E50, 1);
        for (let i = 0; i < 3; i++) {
          const lx = 10 + i * 8;
          g.beginPath();
          g.moveTo(lx, 6); g.lineTo(lx, G.tileSize - 6);
          g.strokePath();
        }
        if (container._tick) { container._tick.destroy(); container._tick = null; }
      }
    };
    redraw(!!e.open);
    container.add(g);
    return { sprite: container, redraw };
  }

  // C8:信息石(踩上去弹提示)
  createInfoStone(e) {
    const gx = e.pos[0], gy = e.pos[1];
    const px = G.mapOriginX + gx * G.tileSize + G.tileSize / 2;
    const py = G.mapOriginY + gy * G.tileSize + G.tileSize / 2;
    const container = this.add.container(px, py);
    container.setDepth(4);

    const g = this.add.graphics();
    g.lineStyle(2, 0x2C3E50, 1);
    g.fillStyle(0xBDC3C7, 1);
    g.fillRoundedRect(-14, -10, 28, 20, 4);
    g.strokeRoundedRect(-14, -10, 28, 20, 4);
    const qm = this.add.text(0, 0, '?', {
      fontSize: '18px', color: '#2C3E50', fontStyle: 'bold'
    }).setOrigin(0.5);
    container.add([g, qm]);
    return container;
  }

  // C9:按钮(ATM)
  createButton(e) {
    const gx = e.pos[0], gy = e.pos[1];
    const px = G.mapOriginX + gx * G.tileSize + G.tileSize / 2;
    const py = G.mapOriginY + gy * G.tileSize + G.tileSize / 2;
    const container = this.add.container(px, py);
    container.setDepth(4);

    const g = this.add.graphics();
    g.lineStyle(2, 0x2C3E50, 1);
    // 机箱
    g.fillStyle(0x34495E, 1);
    g.fillRoundedRect(-14, -14, 28, 28, 4);
    g.strokeRoundedRect(-14, -14, 28, 28, 4);
    // 屏幕
    g.fillStyle(0x2ECC71, 0.7);
    g.fillRoundedRect(-10, -10, 20, 10, 2);
    // 按钮
    g.fillStyle(0xE74C3C, 1);
    g.fillCircle(0, 4, 5);
    g.strokeCircle(0, 4, 5);
    container.add(g);
    return container;
  }

  // D1:保险箱(弱口令关,未解锁时阻挡,解锁后变 "OPEN")
  createSafeBox(e) {
    const gx = e.pos[0], gy = e.pos[1];
    const px = G.mapOriginX + gx * G.tileSize;
    const py = G.mapOriginY + gy * G.tileSize;
    const container = this.add.container(px, py);
    container.setDepth(3);

    const g = this.add.graphics();
    let label = null;

    const redraw = (isUnlocked) => {
      g.clear();
      if (label) { label.destroy(); label = null; }
      g.lineStyle(3, 0x2C3E50, 1);
      // 外壳:银灰
      g.fillStyle(isUnlocked ? 0x2ECC71 : 0x7F8C8D, 1);
      g.fillRoundedRect(2, 2, G.tileSize - 4, G.tileSize - 4, 4);
      g.strokeRoundedRect(2, 2, G.tileSize - 4, G.tileSize - 4, 4);
      // 密码转盘
      g.fillStyle(0x34495E, 1);
      g.fillCircle(G.tileSize / 2, G.tileSize / 2 - 3, 8);
      g.strokeCircle(G.tileSize / 2, G.tileSize / 2 - 3, 8);
      // 转盘指针
      g.lineStyle(2, 0xFFFFFF, 1);
      g.beginPath();
      g.moveTo(G.tileSize / 2, G.tileSize / 2 - 3);
      g.lineTo(G.tileSize / 2 + 5, G.tileSize / 2 - 7);
      g.strokePath();
      // 把手
      g.lineStyle(3, 0xFFD700, 1);
      g.beginPath();
      g.arc(G.tileSize / 2, G.tileSize - 10, 4, 0, Math.PI, false);
      g.strokePath();
      // 状态标签
      label = this.add.text(
        G.tileSize / 2, -4,
        isUnlocked ? '✓ 开' : '🔒 锁',
        { fontSize: '10px',
          color: '#FFFFFF',
          backgroundColor: isUnlocked ? '#27AE60' : '#E74C3C',
          padding: { x: 4, y: 1 }
        }
      ).setOrigin(0.5, 1);
      container.add(label);
    };
    redraw(!!e.unlocked);
    container.add(g);
    return { sprite: container, redraw };
  }

  // C3:镜子(装饰)
  createMirror(e) {
    const gx = e.pos[0], gy = e.pos[1];
    const px = G.mapOriginX + gx * G.tileSize + G.tileSize / 2;
    const py = G.mapOriginY + gy * G.tileSize + G.tileSize / 2;
    const container = this.add.container(px, py);
    container.setDepth(3);

    const g = this.add.graphics();
    g.lineStyle(3, 0x2C3E50, 1);
    g.fillStyle(0xECF0F1, 1);
    g.fillRoundedRect(-14, -14, 28, 28, 4);
    g.strokeRoundedRect(-14, -14, 28, 28, 4);
    // 反射高光
    g.fillStyle(0xAEDDFF, 0.8);
    g.fillTriangle(-12, -12, 12, -12, -12, 12);
    // 邮筒/监听图标
    const eye = this.add.text(0, 0, '👁', { fontSize: '16px' }).setOrigin(0.5);
    container.add([g, eye]);
    return container;
  }

  // ========== 第五幕:新实体绘制 ==========

  // E7:前端假门(视觉是锁门,但不拦路;穿过时"贴纸被揭"显示 ❌)
  createFakeCheckDoor(e) {
    const gx = e.pos[0], gy = e.pos[1];
    const px = G.mapOriginX + gx * G.tileSize;
    const py = G.mapOriginY + gy * G.tileSize;
    const container = this.add.container(px, py);
    container.setDepth(3);

    const g = this.add.graphics();
    g.lineStyle(3, 0x2C3E50, 1);
    // 门板:浅蓝色,看起来正经
    g.fillStyle(0xAED6F1, 1);
    g.fillRoundedRect(4, 2, G.tileSize - 8, G.tileSize - 4, 4);
    g.strokeRoundedRect(4, 2, G.tileSize - 8, G.tileSize - 4, 4);
    // "✔" 假闪灯
    g.fillStyle(0x27AE60, 1);
    g.fillCircle(G.tileSize - 10, 10, 4);
    container.add(g);

    // 文字:"🔒 密码"
    const label = this.add.text(G.tileSize / 2, G.tileSize / 2, '🔒\n密码', {
      fontSize: '11px', color: '#2C3E50', align: 'center', fontStyle: 'bold'
    }).setOrigin(0.5);
    container.add(label);

    // reveal():穿过后把 ✔ 变成 ❌,表明这是假的
    const reveal = () => {
      g.fillStyle(0xE74C3C, 1);
      g.fillCircle(G.tileSize - 10, 10, 4);
      label.setText('❌\n假门');
      label.setColor('#C0392B');
    };
    return { sprite: container, reveal };
  }

  // E7:部署按钮(🛠)
  createDeployButton(e) {
    const gx = e.pos[0], gy = e.pos[1];
    const px = G.mapOriginX + gx * G.tileSize + G.tileSize / 2;
    const py = G.mapOriginY + gy * G.tileSize + G.tileSize / 2;
    const container = this.add.container(px, py);
    container.setDepth(4);

    const g = this.add.graphics();
    g.lineStyle(2, 0x2C3E50, 1);
    g.fillStyle(0xF39C12, 1);
    g.fillCircle(0, 0, 14);
    g.strokeCircle(0, 0, 14);
    const icon = this.add.text(0, 0, '🛠', { fontSize: '16px' }).setOrigin(0.5);
    container.add([g, icon]);
    return container;
  }

  // E8/E12:病毒格子(绿色闪烁,清理后变普通地板)
  createVirusTile(e) {
    const gx = e.pos[0], gy = e.pos[1];
    const px = G.mapOriginX + gx * G.tileSize;
    const py = G.mapOriginY + gy * G.tileSize;
    const container = this.add.container(px, py);
    container.setDepth(3);

    const g = this.add.graphics();
    let icon = null;

    const redraw = (isCleaned) => {
      g.clear();
      if (icon) { icon.destroy(); icon = null; }
      if (isCleaned) {
        // 清除后:变透明(看地板)
        container.setVisible(false);
        return;
      }
      // 绿色粘液
      g.fillStyle(0x2ECC71, 0.85);
      g.fillRoundedRect(4, 4, G.tileSize - 8, G.tileSize - 8, 8);
      g.lineStyle(3, 0x27AE60, 1);
      g.strokeRoundedRect(4, 4, G.tileSize - 8, G.tileSize - 8, 8);
      icon = this.add.text(G.tileSize / 2, G.tileSize / 2, '🦠', {
        fontSize: '22px'
      }).setOrigin(0.5);
      container.add(icon);
    };
    container.add(g);
    redraw(false);

    // 脉冲动画
    this.tweens.add({
      targets: container, alpha: 0.7,
      yoyo: true, repeat: -1, duration: 600, ease: 'Sine.easeInOut'
    });
    return { sprite: container, redraw };
  }

  // E9/E12:礼物盒
  createGiftBox(e) {
    const gx = e.pos[0], gy = e.pos[1];
    const px = G.mapOriginX + gx * G.tileSize + G.tileSize / 2;
    const py = G.mapOriginY + gy * G.tileSize + G.tileSize / 2;
    const container = this.add.container(px, py);
    container.setDepth(4);

    const COLOR_MAP = {
      red: 0xE74C3C, blue: 0x3498DB, green: 0x2ECC71,
      yellow: 0xF1C40F, purple: 0x9B59B6, pink: 0xFF6B9D
    };
    let status = null;  // 检查后头顶的 ✔ / ⚠

    const g = this.add.graphics();
    const redraw = (st) => {
      g.clear();
      if (status) { status.destroy(); status = null; }
      const main = COLOR_MAP[e.color] || 0xE74C3C;
      // 盒身
      g.lineStyle(2, 0x2C3E50, 1);
      g.fillStyle(main, 1);
      g.fillRoundedRect(-14, -8, 28, 20, 3);
      g.strokeRoundedRect(-14, -8, 28, 20, 3);
      // 丝带
      g.fillStyle(0xFFD700, 1);
      g.fillRect(-14, -2, 28, 4);
      g.fillRect(-2, -8, 4, 20);
      // 蝴蝶结
      g.fillStyle(0xFFD700, 1);
      g.fillTriangle(-8, -12, 0, -8, -8, -4);
      g.fillTriangle(8, -12, 0, -8, 8, -4);

      // 顶部状态
      if (st === 'safe') {
        status = this.add.text(0, -20, '✔', { fontSize: '14px', color: '#27AE60', fontStyle: 'bold' }).setOrigin(0.5);
      } else if (st === 'trojan') {
        status = this.add.text(0, -20, '⚠', { fontSize: '14px', color: '#E74C3C', fontStyle: 'bold' }).setOrigin(0.5);
      }
      if (status) container.add(status);
    };
    container.add(g);
    redraw(null);

    return { sprite: container, redraw };
  }

  // E3:带 3 选 1 对话的守卫(视觉和普通 npc 类似,但加了"?"图标)
  createReplyGuard(e) {
    const gx = e.pos[0], gy = e.pos[1];
    const px = G.mapOriginX + gx * G.tileSize + G.tileSize / 2;
    const py = G.mapOriginY + gy * G.tileSize + G.tileSize / 2;
    const container = this.add.container(px, py);
    container.setDepth(5);

    const g = this.add.graphics();
    // 身体:深蓝
    g.lineStyle(3, 0x2C3E50, 1);
    g.fillStyle(0x34495E, 1);
    g.fillRoundedRect(-14, -6, 28, 22, 5);
    g.strokeRoundedRect(-14, -6, 28, 22, 5);
    // 头
    g.fillStyle(0xECF0F1, 1);
    g.fillCircle(0, -14, 10);
    g.strokeCircle(0, -14, 10);
    // 眼睛
    g.fillStyle(0x2C3E50, 1);
    g.fillCircle(-4, -14, 1.5);
    g.fillCircle(4, -14, 1.5);
    // 大胡子
    g.fillStyle(0x5D4037, 1);
    g.fillRect(-6, -10, 12, 3);

    container.add(g);
    // 问号气泡
    const q = this.add.text(14, -20, '?', {
      fontSize: '16px', color: '#E67E22', fontStyle: 'bold',
      backgroundColor: '#FFFACD', padding: { x: 3, y: 1 }
    }).setOrigin(0.5);
    container.add(q);
    return container;
  }

  // E4:循环 NPC(视觉是快递员:黄身子 + 红帽子)
  createLoopNpc(e) {
    const gx = e.pos[0], gy = e.pos[1];
    const px = G.mapOriginX + gx * G.tileSize + G.tileSize / 2;
    const py = G.mapOriginY + gy * G.tileSize + G.tileSize / 2;
    const container = this.add.container(px, py);
    container.setDepth(5);

    const g = this.add.graphics();
    g.lineStyle(3, 0x2C3E50, 1);
    // 身体:黄
    g.fillStyle(0xF39C12, 1);
    g.fillRoundedRect(-13, -6, 26, 22, 5);
    g.strokeRoundedRect(-13, -6, 26, 22, 5);
    // 头:白
    g.fillStyle(0xFDF6E3, 1);
    g.fillCircle(0, -14, 10);
    g.strokeCircle(0, -14, 10);
    // 红帽子
    g.fillStyle(0xE74C3C, 1);
    g.fillRect(-10, -22, 20, 5);
    g.strokeRect(-10, -22, 20, 5);
    // 眼睛
    g.fillStyle(0x2C3E50, 1);
    g.fillCircle(-4, -13, 1.5);
    g.fillCircle(4, -13, 1.5);
    container.add(g);

    // 头顶 "循环中" 指示
    const loop = this.add.text(0, -30, '🔁', { fontSize: '12px' }).setOrigin(0.5);
    container.add(loop);
    return container;
  }

  // E4:启动循环 NPC 的自动动画(简化版:仅做视觉循环,不真正移动格子)
  _startLoopAnim(entity) {
    if (!entity || !entity.sprite) return;
    // 节奏:每 loop_period_ms 显示一次 "say" 气泡,和原位轻微抖动
    const tick = () => {
      if (!entity.sprite || entity.sprite.scene !== this) return;
      // 轻微"跳"一下,表示在巡逻
      this.tweens.add({
        targets: entity.sprite,
        y: entity.sprite.y - 6,
        yoyo: true, duration: 180, repeat: 0
      });
      // 说台词(取 loop_steps 里的 say:xxx)
      const sayStep = (entity.loop_steps || []).find(s => typeof s === 'string' && s.startsWith('say:'));
      if (sayStep) {
        const text = sayStep.slice(4);
        this.showBubble(entity.sprite, text, 1400);
      }
    };
    tick();
    entity._loopTimer = setInterval(tick, entity.loop_period_ms || 5000);
  }

  // ========== 新概念关:动作方法 ==========

  // C4:社工 - 让附近带 role='guard' 的 NPC 让开
  async socialEngineerAction(persona) {
    const guard = Object.values(G.entities || {}).find(en =>
      en.role === 'guard' && !en.bypassed
    );
    if (!guard) {
      await this.showBubble(G.player, '附近没有守卫~');
      return;
    }
    await this.showBubble(G.player, `我是来修${persona}的!`);
    await new Promise(r => setTimeout(r, 300));
    // 守卫让到旁边
    const aside = guard.aside_pos || [guard.gridX, guard.gridY + 1];
    const tx = G.mapOriginX + aside[0] * G.tileSize + G.tileSize / 2;
    const ty = G.mapOriginY + aside[1] * G.tileSize + G.tileSize / 2;
    await new Promise(resolve => {
      this.tweens.add({
        targets: guard.sprite,
        x: tx, y: ty,
        duration: 400,
        onComplete: () => {
          guard.gridX = aside[0];
          guard.gridY = aside[1];
          guard.bypassed = true;
          resolve();
        }
      });
    });
    await this.showBubble(guard.sprite, '请进~');
  }

  // C9:等待 N 秒(同时可能触发 timed_gate 开启)
  async waitAction(seconds) {
    const sec = Math.max(1, Math.min(6, seconds || 3));
    // 头顶小沙漏
    const icon = this.add.text(G.player.x, G.player.y - 30, '⏳', {
      fontSize: '22px'
    }).setOrigin(0.5).setDepth(30);
    this.tweens.add({
      targets: icon,
      angle: 360, duration: 1000, repeat: sec - 1
    });

    // 相邻的 timed_gate 满足等待阈值则开
    const px = G.player.gridX, py = G.player.gridY;
    const adj = Object.values(G.entities || {}).filter(en =>
      en.type === 'timed_gate' && !en.open &&
      Math.abs(en.gridX - px) + Math.abs(en.gridY - py) <= 1
    );

    await new Promise(r => setTimeout(r, sec * 1000));
    icon.destroy();

    adj.forEach(gate => {
      if (sec >= (gate.requires_wait_seconds || 3)) {
        gate.open = true;
        if (gate.redraw) gate.redraw(true);
      }
    });
    if (adj.length > 0) {
      await this.showBubble(G.player, '时机到了!');
    }
  }

  // C7:发噪音(召唤假指令),多次叠加可以把 guard 冲散
  async sendNoiseAction() {
    // 找距离 <= 3 的 guard
    const px = G.player.gridX, py = G.player.gridY;
    const guard = Object.values(G.entities || {}).find(en =>
      en.role === 'guard' && !en.bypassed
    );
    // 视觉:玩家头顶冒个📢
    const puff = this.add.text(G.player.x, G.player.y - 30, '📢', {
      fontSize: '20px'
    }).setOrigin(0.5).setDepth(30);
    this.tweens.add({
      targets: puff, y: G.player.y - 60, alpha: 0,
      duration: 600,
      onComplete: () => puff.destroy()
    });
    await new Promise(r => setTimeout(r, 400));

    if (!guard) {
      await this.showBubble(G.player, '没人听到~');
      return;
    }
    guard.noise_count = (guard.noise_count || 0) + 1;
    const threshold = guard.noise_threshold || 3;
    await this.showBubble(guard.sprite, `太吵了!(${guard.noise_count}/${threshold})`);
    if (guard.noise_count >= threshold) {
      const aside = guard.aside_pos || [guard.gridX, guard.gridY + 1];
      const tx = G.mapOriginX + aside[0] * G.tileSize + G.tileSize / 2;
      const ty = G.mapOriginY + aside[1] * G.tileSize + G.tileSize / 2;
      await new Promise(resolve => {
        this.tweens.add({
          targets: guard.sprite,
          x: tx, y: ty,
          duration: 400,
          onComplete: () => {
            guard.gridX = aside[0];
            guard.gridY = aside[1];
            guard.bypassed = true;
            resolve();
          }
        });
      });
      await this.showBubble(guard.sprite, '我受不了啦!');
    }
  }

  // C9:按 ATM 按钮 —— 触发目标实体的 effect
  async pressButtonAction() {
    const px = G.player.gridX, py = G.player.gridY;
    const btn = Object.values(G.entities || {}).find(en =>
      en.type === 'button' &&
      Math.abs(en.gridX - px) + Math.abs(en.gridY - py) <= 1
    );
    if (!btn) {
      await this.showBubble(G.player, '这里没有按钮~');
      return;
    }
    btn.pressed = true;
    await this.showBubble(btn.sprite, '咔!');
    // 时序攻击:如果目标门是 timed_gate 且玩家刚刚 wait 过(open=true),成功;否则提示
    if (btn.effect === 'open_gate' && btn.target_id) {
      const tg = G.entities[btn.target_id];
      if (tg && tg.type === 'timed_gate' && tg.open) {
        await this.showBubble(G.player, '门开啦!');
      }
    }
    G.buttonPressed = true;
  }

  // C8/D1:询问 —— 先找 info_stone,再找带 hint_text 的 NPC
  async askHintAction() {
    const px = G.player.gridX, py = G.player.gridY;
    const stone = Object.values(G.entities || {}).find(en =>
      en.type === 'info_stone' &&
      Math.abs(en.gridX - px) + Math.abs(en.gridY - py) <= 1
    );
    if (stone?.hint_text) {
      await this.showBubble(G.player, stone.hint_text);
      return;
    }
    // D1:NPC 也可能带 hint_text
    const npc = Object.values(G.entities || {}).find(en =>
      en.hint_text && en.type !== 'info_stone' &&
      Math.abs(en.gridX - px) + Math.abs(en.gridY - py) <= 1
    );
    if (npc?.hint_text) {
      await this.showBubble(npc.sprite, npc.hint_text);
      return;
    }
    await this.showBubble(G.player, '附近没人回答~');
  }

  // D1:在 4 位数密码盘里输入密码,与附近保险箱对比;E6:字母版
  async enterPasswordAction() {
    const px = G.player.gridX, py = G.player.gridY;
    const safe = Object.values(G.entities || {}).find(en =>
      en.type === 'safe_box' && !en.unlocked && !en.hidden &&
      Math.abs(en.gridX - px) + Math.abs(en.gridY - py) <= 1
    );
    if (!safe) {
      await this.showBubble(G.player, '附近没有保险箱~');
      return;
    }
    const tries = (safe.correct_password || '').length;
    const kind = safe.password_kind || 'number';
    const input = kind === 'letter'
      ? await showLetterKeypad(tries || 3)
      : await showPasswordKeypad(tries || 4);
    if (input == null) {
      // 取消
      return;
    }
    safe.attempts += 1;
    // 字母版不区分大小写
    const match = kind === 'letter'
      ? input.toUpperCase() === (safe.correct_password || '').toUpperCase()
      : input === safe.correct_password;
    if (match) {
      safe.unlocked = true;
      if (safe.redraw) safe.redraw(true);
      await this.showBubble(safe.sprite, '咔!开了!');
    } else {
      await this.showBubble(G.player,
        `密码不对~再想想(第${safe.attempts}次)`);
    }
  }

  // ========== 第五幕:新动作方法 ==========

  // E3:社工辨识 —— 附近 reply_guard,弹出 3 选 1 对话框
  async chooseReplyAction() {
    const px = G.player.gridX, py = G.player.gridY;
    const guard = Object.values(G.entities || {}).find(en =>
      en.type === 'reply_guard' && !en.bypassed &&
      Math.abs(en.gridX - px) + Math.abs(en.gridY - py) <= 1
    );
    if (!guard) {
      await this.showBubble(G.player, '附近没有守卫~');
      return;
    }
    const picked = await showReplyChoiceModal(guard.prompt, guard.replies);
    if (picked == null) return; // 取消
    const chosen = guard.replies[picked];
    await this.showBubble(G.player, chosen.text);
    await new Promise(r => setTimeout(r, 300));
    if (chosen.correct) {
      // 守卫让开
      const aside = guard.aside_pos;
      const tx = G.mapOriginX + aside[0] * G.tileSize + G.tileSize / 2;
      const ty = G.mapOriginY + aside[1] * G.tileSize + G.tileSize / 2;
      await new Promise(resolve => {
        this.tweens.add({
          targets: guard.sprite, x: tx, y: ty, duration: 400,
          onComplete: () => {
            guard.gridX = aside[0]; guard.gridY = aside[1];
            guard.bypassed = true; resolve();
          }
        });
      });
      await this.showBubble(guard.sprite, chosen.feedback || '请进~');
    } else {
      // 说错话:守卫训一句,婉婉被"退回"起点
      await this.showBubble(guard.sprite, chosen.feedback || '胡说八道!');
      await new Promise(r => setTimeout(r, 400));
      const start = G.currentLevel.entities.find(en => en.id === 'player');
      if (start) {
        const sx = G.mapOriginX + start.start_pos[0] * G.tileSize + G.tileSize / 2;
        const sy = G.mapOriginY + start.start_pos[1] * G.tileSize + G.tileSize / 2;
        await new Promise(resolve => {
          this.tweens.add({
            targets: G.player, x: sx, y: sy, duration: 500,
            onComplete: () => {
              G.player.gridX = start.start_pos[0];
              G.player.gridY = start.start_pos[1];
              resolve();
            }
          });
        });
      }
      await this.showBubble(G.player, '哎!重来...');
    }
  }

  // E8:清病毒(附近 virus_tile)
  async cleanVirusAction() {
    const px = G.player.gridX, py = G.player.gridY;
    const virus = Object.values(G.entities || {}).find(en =>
      en.type === 'virus_tile' && !en.cleaned &&
      Math.abs(en.gridX - px) + Math.abs(en.gridY - py) <= 1
    );
    if (!virus) {
      await this.showBubble(G.player, '附近没有病毒~');
      return;
    }
    // 喷雾动画
    const spray = this.add.text(G.player.x, G.player.y - 30, '💨', {
      fontSize: '22px'
    }).setOrigin(0.5).setDepth(30);
    this.tweens.add({
      targets: spray, alpha: 0, y: G.player.y - 60,
      duration: 500, onComplete: () => spray.destroy()
    });
    virus.cleaned = true;
    if (virus.redraw) virus.redraw(true);
    // 清干净的 ✨
    const star = this.add.text(virus.sprite.x + G.tileSize/2, virus.sprite.y + G.tileSize/2, '✨', {
      fontSize: '24px'
    }).setOrigin(0.5).setDepth(30);
    this.tweens.add({
      targets: star, alpha: 0, scale: 1.8, duration: 600,
      onComplete: () => star.destroy()
    });
    await new Promise(r => setTimeout(r, 500));
    await this.showBubble(G.player, '病毒清掉啦!');
  }

  // E9:检查礼物(附近 gift_box)
  async inspectGiftAction() {
    const px = G.player.gridX, py = G.player.gridY;
    const gift = Object.values(G.entities || {}).find(en =>
      en.type === 'gift_box' && !en.inspected && !en.opened &&
      Math.abs(en.gridX - px) + Math.abs(en.gridY - py) <= 1
    );
    if (!gift) {
      await this.showBubble(G.player, '附近没有礼物~');
      return;
    }
    gift.inspected = true;
    if (gift.redraw) gift.redraw(gift.is_trojan ? 'trojan' : 'safe');
    if (gift.is_trojan) {
      await this.showBubble(gift.sprite, `⚠ 里面是病毒!别拆!`);
    } else {
      await this.showBubble(gift.sprite, `✔ 里面是${gift.content_label}。`);
    }
  }

  // E9:拆礼物;不检查直接拆 or 拆到木马 → 惩罚
  async openGiftAction() {
    const px = G.player.gridX, py = G.player.gridY;
    const gift = Object.values(G.entities || {}).find(en =>
      en.type === 'gift_box' && !en.opened &&
      Math.abs(en.gridX - px) + Math.abs(en.gridY - py) <= 1
    );
    if (!gift) {
      await this.showBubble(G.player, '附近没有礼物~');
      return;
    }
    gift.opened = true;
    if (gift.is_trojan) {
      // 中木马:冒一堆 🦠,回起点
      for (let i = 0; i < 6; i++) {
        const v = this.add.text(gift.sprite.x, gift.sprite.y, '🦠', {
          fontSize: '18px'
        }).setOrigin(0.5).setDepth(30);
        this.tweens.add({
          targets: v,
          x: v.x + (Math.random()-0.5)*80, y: v.y + (Math.random()-0.5)*80,
          alpha: 0, duration: 800,
          onComplete: () => v.destroy()
        });
      }
      await this.showBubble(gift.sprite, '哎呀!中木马啦!');
      await new Promise(r => setTimeout(r, 600));
      const start = G.currentLevel.entities.find(en => en.id === 'player');
      if (start) {
        const sx = G.mapOriginX + start.start_pos[0] * G.tileSize + G.tileSize / 2;
        const sy = G.mapOriginY + start.start_pos[1] * G.tileSize + G.tileSize / 2;
        G.player.gridX = start.start_pos[0];
        G.player.gridY = start.start_pos[1];
        G.player.x = sx; G.player.y = sy;
      }
      G.trojanTriggered = (G.trojanTriggered || 0) + 1;
    } else {
      // 好礼物
      await this.showBubble(gift.sprite, `🎉 ${gift.content_label}!`);
      G.giftsOpened = (G.giftsOpened || 0) + 1;
      // 视觉:盒盖飞起
      this.tweens.add({
        targets: gift.sprite, y: gift.sprite.y - 10, alpha: 0.6,
        duration: 300, yoyo: true
      });
    }
  }

  // E7:部署后端真门(把指定 safe_box 从 hidden 显示出来)
  async deployBackendAction() {
    const px = G.player.gridX, py = G.player.gridY;
    const btn = Object.values(G.entities || {}).find(en =>
      en.type === 'deploy_button' && !en.pressed &&
      Math.abs(en.gridX - px) + Math.abs(en.gridY - py) <= 1
    );
    if (!btn) {
      await this.showBubble(G.player, '附近没有部署按钮~');
      return;
    }
    btn.pressed = true;
    await this.showBubble(btn.sprite, '嗡——');
    const target = btn.target_id ? G.entities[btn.target_id] : null;
    if (target && target.type === 'safe_box' && target.hidden) {
      target.hidden = false;
      if (target.sprite) {
        target.sprite.setAlpha(0);
        target.sprite.setVisible(true);
        this.tweens.add({
          targets: target.sprite, alpha: 1, duration: 600
        });
      }
      await this.showBubble(G.player, '真门升起来啦!');
    }
  }

  // C3:打碎镜子(清掉一个 mirror 阻挡)
  async breakMirrorAction() {
    const px = G.player.gridX, py = G.player.gridY;
    const mirror = Object.values(G.entities || {}).find(en =>
      en.type === 'mirror' && !en.broken &&
      Math.abs(en.gridX - px) + Math.abs(en.gridY - py) <= 1
    );
    if (!mirror) {
      await this.showBubble(G.player, '旁边没有镜子~');
      return;
    }
    mirror.broken = true;
    G.walls.delete(`${mirror.gridX},${mirror.gridY}`);
    await this.showBubble(mirror.sprite, '咔嚓!');
    this.tweens.add({
      targets: mirror.sprite, alpha: 0,
      duration: 300,
      onComplete: () => mirror.sprite.destroy()
    });
  }

  showBubble(target, text, holdMs) {
    return new Promise(resolve => {
      // 自动根据文字长度计算停留时间(每字约 220ms,最少 1500ms,最多 5000ms)
      const autoHold = Math.max(1500, Math.min(5000, (text || '').length * 220));
      const hold = holdMs != null ? holdMs : autoHold;
      const fade = 400;

      const bubble = this.add.text(target.x, target.y - 40, text, {
        fontSize: '15px', color: '#6B4423',
        backgroundColor: '#FFFACD',
        padding: { x: 8, y: 5 },
        wordWrap: { width: 200, useAdvancedWrap: true }
      }).setOrigin(0.5).setDepth(20);

      // 等 hold ms 再开始淡出
      this.tweens.add({
        targets: bubble,
        y: target.y - 60, alpha: 0,
        duration: fade,
        delay: hold,
        onComplete: () => { bubble.destroy(); resolve(); }
      });
    });
  }

  // 在移动一步后,自动弹出附近未展示过的 info_stone / hint NPC 气泡
  async autoShowNearbyHints() {
    if (!G.entities) return;
    if (!G._hintShown) G._hintShown = new Set();
    const px = G.player.gridX, py = G.player.gridY;
    for (const [id, en] of Object.entries(G.entities)) {
      if (!en.hint_text) continue;
      if (G._hintShown.has(id)) continue;
      const dist = Math.abs(en.gridX - px) + Math.abs(en.gridY - py);
      // info_stone:踩上即触发 (dist=0);NPC:相邻即触发 (dist<=1)
      const threshold = en.type === 'info_stone' ? 0 : 1;
      if (dist <= threshold) {
        G._hintShown.add(id);
        await this.showBubble(en.sprite, en.hint_text);
      }
    }
  }

  playSuccessAnim() {
    return new Promise(resolve => {
      // 简单的跳跃 + 星星
      this.tweens.add({
        targets: G.player,
        y: G.player.y - 20,
        duration: 200, yoyo: true, repeat: 1,
        onComplete: resolve
      });
      // 撒星星
      for (let i = 0; i < 8; i++) {
        const star = this.add.text(
          G.player.x + (Math.random()-0.5)*60,
          G.player.y + (Math.random()-0.5)*60,
          '✨', { fontSize: '20px' }
        );
        this.tweens.add({
          targets: star,
          y: star.y - 40, alpha: 0,
          duration: 800,
          onComplete: () => star.destroy()
        });
      }
    });
  }
}

// ============================================================
// 启动
// ============================================================

window.addEventListener('DOMContentLoaded', async () => {
  const gameDiv = document.getElementById('game-canvas');

  // 等两帧,让 grid 布局(尤其 dvh)稳定下来再测量
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  const w = gameDiv.clientWidth || window.innerWidth;
  const h = gameDiv.clientHeight || 300;

  new Phaser.Game({
    type: Phaser.AUTO,
    width: w, height: h,
    parent: 'game-canvas',
    backgroundColor: '#E8F4F8',
    scene: MainScene,
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH
    }
  });

  // 加载关卡(URL 参数优先,否则默认 T1)
  const params = new URLSearchParams(window.location.search);
  const levelId = params.get('level') || 'T1';
  await loadLevel(levelId);

  // 窗口尺寸/朝向变化时,重算地图格子位置(关卡 restart)
  let _resizeTimer = null;
  const onResize = () => {
    if (_resizeTimer) clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(() => {
      if (G.currentLevel && G.phaserScene) {
        _clearLoopTimers();
        G.phaserScene.scene.restart({ levelData: G.currentLevel });
      }
    }, 250);
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
});
