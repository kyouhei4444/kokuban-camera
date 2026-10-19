/* ============================================================
   board.js  電子小黒板の描画
   プレビュー（画面）と保存画像の両方をこの1つの関数で描くので、
   見たままの位置・大きさで写真に焼き込まれる。
   寸法はすべて黒板の幅 W に比例させている。
   ============================================================ */
const Board = (() => {
  const THEMES = {
    green: { bg: '#1d4a2e', line: 'rgba(255,255,255,.85)', label: '#f4f1d0', text: '#ffffff', frame: '#7a5530' },
    black: { bg: '#1b1d1f', line: 'rgba(255,255,255,.8)', label: '#f4f1d0', text: '#ffffff', frame: '#555' },
    white: { bg: '#fbfbf6', line: '#2b2b2b', label: '#1d3d7a', text: '#111111', frame: '#9a9a9a' }
  };
  const FONT = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Noto Sans CJK JP","Yu Gothic","Meiryo",sans-serif';

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

  /** 黒板に載せる行を作る */
  function rows(site, b, set, date) {
    const show = set.rows || {};
    const out = [];
    const add = (key, label, value) => {
      if (show[key] === false) return;
      value = (value || '').trim();
      if (!value) return;
      out.push({ kind: 'row', label, value });
    };
    add('koji', '工事名', site && site.name);
    add('kousyu', '工　種', b.kousyu);
    add('shubetsu', '種　別', b.shubetsu);
    add('sokuten', '測　点', b.sokuten);
    if (show.naiyou !== false) {
      const lines = String(b.naiyou || '').replace(/\r/g, '').split('\n');
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      while (lines.length && !lines[0].trim()) lines.shift();
      if (lines.length) out.push({ kind: 'body', lines });
    }
    if (show.date !== false) out.push({ kind: 'row', label: '撮影日', value: formatDate(date || new Date(), set.dateFmt) });
    add('contractor', '受注者', site && site.contractor);
    return out;
  }

  function metrics(W) {
    const u = W / 24;
    return {
      u,
      frame: u * 0.42,
      rowH: u * 2.05,
      lineH: u * 1.75,
      labelW: W * 0.2,
      font: u * 1.08,
      lw: Math.max(1, u * 0.09)
    };
  }

  function bodyHeight(m, lines) { return lines.length * m.lineH + m.u * 0.3; }

  function measure(list, W) {
    const m = metrics(W);
    let h = m.frame * 2;
    for (const r of list) h += r.kind === 'row' ? m.rowH : bodyHeight(m, r.lines);
    if (!list.length) h += m.rowH;
    return Math.ceil(h);
  }

  function fitText(ctx, text, x, y, maxW, align) {
    ctx.textAlign = align || 'left';
    const w = ctx.measureText(text).width;
    if (w <= maxW) { ctx.fillText(text, x, y); return; }
    ctx.fillText(text, x, y, maxW); // 横方向に詰めて入れる
  }

  /** (x,y) を左上に幅 W で描く。描いた高さを返す */
  function draw(ctx, x, y, W, list, theme) {
    const t = THEMES[theme] || THEMES.green;
    const m = metrics(W);
    const H = measure(list, W);
    ctx.save();
    ctx.textBaseline = 'middle';

    // 枠と面
    ctx.fillStyle = t.frame;
    ctx.fillRect(x, y, W, H);
    const ix = x + m.frame, iy = y + m.frame, iw = W - m.frame * 2;
    ctx.fillStyle = t.bg;
    ctx.fillRect(ix, iy, iw, H - m.frame * 2);

    ctx.strokeStyle = t.line;
    ctx.lineWidth = m.lw;
    const pad = m.u * 0.55;
    let cy = iy;
    list.forEach((r, i) => {
      if (r.kind === 'row') {
        ctx.font = 'bold ' + (m.font * 0.92) + 'px ' + FONT;
        ctx.fillStyle = t.label;
        fitText(ctx, r.label, ix + m.labelW / 2, cy + m.rowH / 2, m.labelW - pad, 'center');
        ctx.font = 'bold ' + m.font + 'px ' + FONT;
        ctx.fillStyle = t.text;
        fitText(ctx, r.value, ix + m.labelW + pad, cy + m.rowH / 2, iw - m.labelW - pad * 2, 'left');
        line(ctx, ix + m.labelW, cy, ix + m.labelW, cy + m.rowH);
        cy += m.rowH;
      } else {
        const bh = bodyHeight(m, r.lines);
        let ly = cy + m.u * 0.15;
        ctx.font = 'bold ' + (m.font * 0.95) + 'px ' + FONT;
        ctx.fillStyle = t.text;
        r.lines.forEach((ln, k) => {
          const cells = ln.split(/[|｜]/);
          if (cells.length > 1) {
            // 「項目|設計|実測」のような表形式
            const first = iw * 0.3;
            const rest = (iw - first) / (cells.length - 1);
            cells.forEach((c, j) => {
              const cx0 = j === 0 ? ix : ix + first + rest * (j - 1);
              const cw = j === 0 ? first : rest;
              fitText(ctx, c.trim(), cx0 + cw / 2, ly + m.lineH / 2, cw - pad, 'center');
              if (j > 0) line(ctx, cx0, ly, cx0, ly + m.lineH);
            });
            if (k < r.lines.length - 1) line(ctx, ix, ly + m.lineH, ix + iw, ly + m.lineH);
            if (k > 0) line(ctx, ix, ly, ix + iw, ly);
          } else {
            fitText(ctx, ln, ix + pad, ly + m.lineH / 2, iw - pad * 2, 'left');
          }
          ly += m.lineH;
        });
        cy += bh;
      }
      if (i < list.length - 1) line(ctx, ix, cy, ix + iw, cy);
    });
    ctx.strokeRect(ix, iy, iw, H - m.frame * 2);
    ctx.restore();
    return H;
  }

  function line(ctx, x1, y1, x2, y2) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }

  return { rows, measure, draw, formatDate, THEMES };
})();
