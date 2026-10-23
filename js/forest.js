// 森のヒーロー：キャラクターが歩き回ったり、ついばんだり、切り株で本を読んだりする
(() => {
  'use strict';

  // ===== 設定 =====
  // 座標は「世界の単位」で書く。ステージの高さを 420 とした値で、横幅は画面に合わせて変わる。
  // y は足元の位置（奥行き）。大きいほど手前で、手前のものが上に重なる。
  const WORLD_H = 420;
  const GROUND_TOP = 270;     // 歩ける範囲のいちばん奥
  const GROUND_BOTTOM = 405;  // 歩ける範囲のいちばん手前
  const FRAME_SEC = 0.25;     // パタパタの切り替え間隔（秒）

  // 置き物。x は横幅に対する割合（0〜1）、w は幅（世界の単位）
  // spot: 'stump' は本を読む場所、'flower' はちょうちょが止まる場所
  const SCENERY = [
    { img: 'imgs/forest/tree.svg',   x: 0.10, y: 290, w: 200 },
    { img: 'imgs/forest/tree.svg',   x: 0.88, y: 280, w: 180 },
    { img: 'imgs/forest/tree.svg',   x: 0.68, y: 392, w: 150 },  // 手前の木
    { img: 'imgs/forest/stump.svg',  x: 0.38, y: 335, w: 90, spot: 'stump' },
    { img: 'imgs/forest/flower.svg', x: 0.22, y: 372, w: 24, spot: 'flower' },
    { img: 'imgs/forest/flower.svg', x: 0.55, y: 300, w: 22, spot: 'flower' },
    { img: 'imgs/forest/flower.svg', x: 0.93, y: 398, w: 24, spot: 'flower' },
    { img: 'imgs/forest/grass.svg',  x: 0.30, y: 404, w: 50 },
    { img: 'imgs/forest/grass.svg',  x: 0.50, y: 360, w: 44 },
    { img: 'imgs/forest/grass.svg',  x: 0.80, y: 330, w: 44 },
  ];

  // キャラクター。絵は右向きで描く（左へ進むときは自動で反転する）
  // frames: 状態ごとのコマ画像（walk / idle / peck / read / fly / rest）。無い状態は idle のコマを使う
  // acts: やることの重み。大きいほどよく選ばれる
  const CAST = [
    {
      name: 'pochi', w: 80, speed: 70,
      frames: { idle: ['imgs/pochi.png'] },
      acts: { wander: 4, idle: 1, read: 1 },
    },
    {
      name: 'piyo', w: 50, speed: 50,
      frames: { idle: ['imgs/forest/chick.svg'] },
      acts: { wander: 3, peck: 4 },
    },
    {
      name: 'kaeru', w: 70, speed: 40,
      frames: { idle: ['imgs/forest/frog.svg'] },
      acts: { wander: 2, read: 3, idle: 1 },
    },
    {
      name: 'chocho', w: 40, speed: 60, fly: true, frameSec: 0.12,
      frames: {
        idle: ['imgs/forest/butterfly-1.svg', 'imgs/forest/butterfly-2.svg'],
        rest: ['imgs/forest/butterfly-1.svg', 'imgs/forest/butterfly-1.svg', 'imgs/forest/butterfly-1.svg', 'imgs/forest/butterfly-2.svg'],
      },
      acts: { fly: 3, rest: 2 },
    },
  ];

  const BOOK_IMG = 'imgs/forest/book.svg';

  // ===== ここから仕組み =====
  const stage = document.querySelector('.forest');
  if (!stage) return;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  let scale = 1;     // 1単位が何px か
  let worldW = 1000; // 今の横幅（世界の単位）
  const props = [];
  const actors = [];
  let stump = null;
  const flowers = [];

  function makeSprite(src, w) {
    const el = document.createElement('div');
    el.className = 'sprite';
    const pose = document.createElement('div');
    pose.className = 'pose';
    const anim = document.createElement('div');
    anim.className = 'anim';
    const img = document.createElement('img');
    img.className = 'frame';
    img.src = src;
    img.alt = '';
    img.draggable = false;
    anim.appendChild(img);
    pose.appendChild(anim);
    el.appendChild(pose);
    stage.appendChild(el);
    return { el, pose, anim, img, w };
  }

  function place(sprite, x, y, alt, front) {
    sprite.el.style.transform = `translate(${x * scale}px, ${(y - alt) * scale}px)`;
    // 同じ奥行きなら、キャラクターを置き物より手前に
    sprite.el.style.zIndex = Math.round(y) * 2 + (front ? 1 : 0);
  }

  function sizeSprite(sprite) {
    const px = sprite.w * scale;
    sprite.pose.style.width = px + 'px';
    sprite.pose.style.left = -px / 2 + 'px';
  }

  function depthScale(y) {
    return 0.85 + 0.15 * (y - GROUND_TOP) / (GROUND_BOTTOM - GROUND_TOP);
  }

  function layout() {
    const oldW = worldW;
    scale = stage.clientHeight / WORLD_H;
    worldW = stage.clientWidth / scale;
    const ratio = worldW / oldW;

    for (const p of props) {
      sizeSprite(p.sprite);
      place(p.sprite, p.x * worldW, p.y, 0, false);
    }
    for (const a of actors) {
      sizeSprite(a.sprite);
      a.x *= ratio;
      for (const k of [a.task, ...a.tasks]) if (k && k.x != null) k.x *= ratio;
      draw(a, 0);
    }
  }

  // ----- キャラクター -----
  function setState(a, state) {
    if (a.state === state) return;
    a.state = state;
    a.sprite.anim.className = 'anim is-' + state;
    a.frames = a.def.frames[state] || a.def.frames.idle;
    a.frameIdx = 0;
    a.frameT = 0;
    a.sprite.img.src = a.frames[0];
    a.book.hidden = state !== 'read';
  }

  function tickFrames(a, dt) {
    if (a.frames.length < 2) return;
    const sec = a.def.frameSec || FRAME_SEC;
    a.frameT += dt;
    if (a.frameT < sec) return;
    a.frameT = 0;
    a.frameIdx = (a.frameIdx + 1) % a.frames.length;
    const src = a.frames[a.frameIdx];
    if (a.sprite.img.getAttribute('src') !== src) a.sprite.img.src = src;
  }

  function draw(a, t) {
    let alt = a.alt;
    if (a.def.fly && a.state !== 'rest') alt += Math.sin(t * 5 + a.seed) * 8;
    place(a.sprite, a.x, a.y, alt, true);
    const d = depthScale(a.y);
    a.sprite.pose.style.transform = `scale(${a.facing * d}, ${d})`;
  }

  function weighted(acts) {
    const entries = Object.entries(acts);
    let r = Math.random() * entries.reduce((s, [, w]) => s + w, 0);
    for (const [name, w] of entries) if ((r -= w) < 0) return name;
    return entries[0][0];
  }

  const ACTS = {
    wander(a) {
      a.tasks.push(
        { type: 'move', x: clamp(a.x + rand(-250, 250), 30, worldW - 30), y: rand(GROUND_TOP, GROUND_BOTTOM) },
        { type: 'stay', state: 'idle', t: rand(0.8, 2.5) },
      );
    },
    idle(a) {
      a.tasks.push({ type: 'stay', state: 'idle', t: rand(2, 4) });
    },
    peck(a) {
      a.tasks.push(
        { type: 'stay', state: 'peck', t: rand(1.2, 2.4) },
        { type: 'stay', state: 'idle', t: 0.6 },
      );
    },
    read(a) {
      if (!stump || stump.user) return ACTS.wander(a);
      stump.user = a;
      // 切り株の左横に立って、切り株のほうを向いて読む
      a.tasks.push(
        { type: 'move', x: stump.x * worldW - stump.w / 2 - a.def.w * 0.3, y: stump.y + 3 },
        { type: 'stay', state: 'read', face: 1, t: rand(6, 10), onEnd: () => { stump.user = null; } },
        { type: 'stay', state: 'idle', t: 0.8 },
      );
    },
    fly(a) {
      a.tasks.push({
        type: 'move', x: rand(30, worldW - 30), y: rand(GROUND_TOP, GROUND_BOTTOM), alt: rand(80, 220),
      });
    },
    rest(a) {
      const free = flowers.filter((f) => !f.user);
      if (!free.length) return ACTS.fly(a);
      const f = pick(free);
      f.user = a;
      // 花びらの真ん中あたりに止まる
      a.tasks.push(
        { type: 'move', x: f.x * worldW, y: f.y + 1, alt: f.w * 1.25 * depthScale(f.y) },
        { type: 'stay', state: 'rest', t: rand(3, 6), onEnd: () => { f.user = null; } },
      );
    },
  };

  function startTask(a, k) {
    if (k.type === 'move') setState(a, a.def.fly ? 'fly' : 'walk');
    else setState(a, k.state);
    if (k.face) a.facing = k.face;
  }

  function update(a, dt) {
    if (!a.task) {
      if (!a.tasks.length) ACTS[weighted(a.def.acts)](a);
      a.task = a.tasks.shift();
      startTask(a, a.task);
    }
    const k = a.task;
    let done = false;
    if (k.type === 'move') {
      const tx = clamp(k.x, 0, worldW);
      const talt = k.alt ?? a.alt;
      const dx = tx - a.x, dy = k.y - a.y, dalt = talt - a.alt;
      const dist = Math.hypot(dx, dy, dalt);
      const step = a.def.speed * dt;
      if (dist <= step) {
        a.x = tx; a.y = k.y; a.alt = talt;
        done = true;
      } else {
        a.x += dx / dist * step;
        a.y += dy / dist * step;
        a.alt += dalt / dist * step;
        if (Math.abs(dx) > 2) a.facing = dx > 0 ? 1 : -1;
      }
    } else {
      k.t -= dt;
      done = k.t <= 0;
    }
    if (done) {
      if (k.onEnd) k.onEnd();
      a.task = null;
    }
  }

  // ----- 組み立て -----
  for (const p of SCENERY) {
    const prop = { ...p, sprite: makeSprite(p.img, p.w), user: null };
    props.push(prop);
    if (p.spot === 'stump') stump = prop;
    if (p.spot === 'flower') flowers.push(prop);
  }
  layout();

  for (const def of CAST) {
    const sprite = makeSprite(def.frames.idle[0], def.w);
    const book = document.createElement('img');
    book.className = 'book';
    book.src = BOOK_IMG;
    book.alt = '';
    book.hidden = true;
    sprite.anim.appendChild(book);
    const a = {
      def, sprite, book,
      x: rand(40, worldW - 40),
      y: rand(GROUND_TOP, GROUND_BOTTOM),
      alt: def.fly ? 120 : 0,
      facing: pick([1, -1]),
      seed: rand(0, 10),
      state: null, frames: def.frames.idle, frameIdx: 0, frameT: 0,
      task: null, tasks: [],
    };
    setState(a, 'idle');
    actors.push(a);
  }
  layout();

  // コマ画像を先読みしておく
  for (const def of CAST) for (const list of Object.values(def.frames)) for (const src of list) new Image().src = src;

  new ResizeObserver(layout).observe(stage);

  if (reduceMotion) return; // 動きを減らす設定の人には止まった森を見せる

  let raf = 0, last = 0, t = 0;
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    t += dt;
    for (const a of actors) {
      update(a, dt);
      tickFrames(a, dt);
      draw(a, t);
    }
    raf = requestAnimationFrame(frame);
  }
  function start() {
    if (raf) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
  }
  // 画面の外に出たら止める
  new IntersectionObserver(([e]) => (e.isIntersecting ? start() : stop())).observe(stage);
})();
