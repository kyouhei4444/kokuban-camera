/* ============================================================
   board.js  電子小黒板の描画
   プレビュー（画面）と保存画像の両方をこの1つの関数で描くので、
   見たままの位置・大きさで写真に焼き込まれる。
   寸法はすべて黒板の幅 W に比例させている。

   形は現場で使っている黒板写真（1280×960 で幅 296・高さ 396px）に合わせた：
     深緑の面、外周から少し内側に白い枠線、
     左に見出し列（工事名・工種・測点）、下に大きな内容欄（中央に大きな文字）。
   ============================================================ */
const Board = (() => {
  const THEMES = {
    green: { bg: '#0b4c2a', line: '#ffffff', label: '#ffffff', text: '#ffffff' },
    black: { bg: '#1b1d1f', line: '#ffffff', label: '#ffffff', text: '#ffffff' },
    white: { bg: '#fbfbf6', line: '#222222', label: '#222222', text: '#111111' }
  };
  const FONT = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Noto Sans CJK JP","Yu Gothic","Meiryo",sans-serif';

  // 寸法（幅 W に対する比）… 元写真の実測から
  const R = {
    aspect: 396 / 296,   // 高さ / 幅
    margin: 6 / 296,     // 外周〜白枠
    lw: 2 / 296,         // 線の太さ
    labelW: 79 / 296,    // 見出し列の幅
    rowKoji: 46 / 296,   // 工事名の行（2行まで折り返す）
    row: 40 / 296,       // そのほかの行
    label: 15 / 296,     // 見出しの文字
    value: 15 / 296,     // 値の文字
    koji: 13.5 / 296,    // 工事名の文字
    body: 38 / 296,      // 内容欄の文字（最大）
    bodyMin: 0.36        // 内容欄の最小の高さ（W 比）
  };

  function wareki(d) {
    const y = d.getFullYear();
    // 令和は 2019/5/1 から
    const r = (y > 2019 || (y === 2019 && d.getMonth() >= 4)) ? '令和' + (y - 2018 === 1 ? '元' : y - 2018) : '平成' + (y - 1988);
    return r + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }
  function formatDate(d, fmt) {
    if (fmt === 'seireki') return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
    if (fmt === 'slash') return d.getFullYear() + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0');
    return wareki(d);
  }

  /** 黒板に載せる内容 → { heads: [{label,value,koji}], body: [行…] } */
  function rows(site, b, set, date) {
    const show = set.rows || {};
    const heads = [];
    const add = (key, label, value, always) => {
      if (show[key] === false) return;
      value = (value || '').trim();
      if (!value && !always) return;
      heads.push({ label, value, koji: key === 'koji' });
    };
    add('koji', '工事名', site && site.name, true);
    add('kousyu', '工　種', b.kousyu, true);
    add('shubetsu', '種　別', b.shubetsu, false);
    add('sokuten', '測　点', b.sokuten, true);
    if (show.date) add('date', '撮影日', formatDate(date || new Date(), set.dateFmt), true);
    add('contractor', '受注者', site && site.contractor, false);
    let body = [];
    if (show.naiyou !== false) {
      body = String(b.naiyou || '').replace(/\r/g, '').split('\n');
      while (body.length && !body[body.length - 1].trim()) body.pop();
      while (body.length && !body[0].trim()) body.shift();
    }
    return { heads, body };
  }

  function headsHeight(data, W) {
    return data.heads.reduce((h, r) => h + (r.koji ? R.rowKoji : R.row) * W, 0);
  }

  function measure(data, W) {
    // 基本は元写真の縦横比。項目や内容の行が多いときだけ下に伸ばす
    const needBody = Math.max(W * R.bodyMin, data.body.length * W * 0.1 + W * 0.04);
    return Math.ceil(Math.max(W * R.aspect, W * R.margin * 2 + headsHeight(data, W) + needBody));
  }

  function font(px) { return 'bold ' + px.toFixed(2) + 'px ' + FONT; }

  /** 幅に入らなければ文字を小さくし、それでもだめなら横に詰める */
  function fitText(ctx, text, x, y, maxW, px, align, minRatio) {
    ctx.font = font(px);
    let w = ctx.measureText(text).width;
    if (w > maxW) {
      const k = Math.max(minRatio || 0.75, maxW / w);
      ctx.font = font(px * k);
      w = ctx.measureText(text).width;
    }
    ctx.textAlign = align || 'left';
    if (w <= maxW) ctx.fillText(text, x, y);
    else ctx.fillText(text, x, y, maxW);
  }

  /** 文字単位で折り返す（最大 n 行） */
  function wrap(ctx, text, maxW, n) {
    const out = [];
    let cur = '';
    for (const ch of text) {
      if (ctx.measureText(cur + ch).width > maxW && cur) {
        out.push(cur); cur = ch;
        if (out.length === n - 1) { cur = text.slice(out.join('').length); break; }
      } else cur += ch;
    }
    out.push(cur);
    return out;
  }

  function line(ctx, x1, y1, x2, y2) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }

  /** (x,y) を左上に幅 W で描く。描いた高さを返す */
  function draw(ctx, x, y, W, data, theme) {
    const t = THEMES[theme] || THEMES.green;
    const H = measure(data, W);
    const m = W * R.margin;
    const ix = x + m, iy = y + m, iw = W - 2 * m, ih = H - 2 * m;
    const lw = Math.max(1, W * R.lw);
    const labW = W * R.labelW;
    const pad = W * 0.03;

    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.fillStyle = t.bg;
    ctx.fillRect(x, y, W, H);
    ctx.strokeStyle = t.line;
    ctx.lineWidth = lw;

    // 見出し行
    let cy = iy;
    data.heads.forEach(r => {
      const rh = (r.koji ? R.rowKoji : R.row) * W;
      ctx.fillStyle = t.label;
      fitText(ctx, r.label, ix + labW / 2, cy + rh / 2, labW - pad, W * R.label, 'center');
      ctx.fillStyle = t.text;
      const vx = ix + labW + pad, vw = iw - labW - pad * 1.5;
      if (r.koji) {
        ctx.font = font(W * R.value);
        if (ctx.measureText(r.value).width <= vw) {
          fitText(ctx, r.value, vx, cy + rh / 2, vw, W * R.value);
        } else {
          ctx.font = font(W * R.koji);
          const ls = wrap(ctx, r.value, vw, 2);
          const lh = rh / 2.15;
          ls.forEach((s, i) => fitText(ctx, s, vx, cy + rh / 2 + (i - (ls.length - 1) / 2) * lh, vw, W * R.koji, 'left', 0.6));
        }
      } else {
        fitText(ctx, r.value, vx, cy + rh / 2, vw, W * R.value);
      }
      cy += rh;
      line(ctx, ix, cy, ix + iw, cy);
    });
    if (data.heads.length) line(ctx, ix + labW, iy, ix + labW, cy);

    // 内容欄
    const by = cy, bh = iy + ih - cy;
    const body = data.body;
    if (body.length) {
      const isTable = body.map(s => /[|｜]/.test(s));
      const anyTable = isTable.some(Boolean);
      const lh = Math.min(bh * 0.92 / body.length, anyTable ? W * 0.15 : W * R.body * 1.5);
      let px = Math.min(W * R.body, lh / 1.3);
      // いちばん長い行が幅に収まる大きさまで下げる
      ctx.font = font(px);
      const longest = Math.max(...body.map((s, i) => isTable[i] ? 0 : ctx.measureText(s).width));
      if (longest > iw * 0.92) px = Math.max(px * (iw * 0.92) / longest, W * 0.05);
      const top = by + (bh - lh * body.length) / 2;
      ctx.fillStyle = t.text;
      body.forEach((s, i) => {
        const ly = top + lh * i;
        if (isTable[i]) {
          const cells = s.split(/[|｜]/);
          const cw = iw / cells.length;
          const tpx = Math.min(px, lh / 1.5);
          cells.forEach((c, j) => {
            fitText(ctx, c.trim(), ix + cw * j + cw / 2, ly + lh / 2, cw - pad, tpx, 'center', 0.6);
            if (j > 0) line(ctx, ix + cw * j, ly, ix + cw * j, ly + lh);
          });
          if (i === 0 || !isTable[i - 1]) line(ctx, ix, ly, ix + iw, ly);
          line(ctx, ix, ly + lh, ix + iw, ly + lh);
        } else {
          fitText(ctx, s, ix + iw / 2, ly + lh / 2, iw - pad * 2, px, 'center', 0.5);
        }
      });
    }
    ctx.strokeRect(ix, iy, iw, ih);
    ctx.restore();
    return H;
  }

  return { rows, measure, draw, formatDate, THEMES };
})();
