(() => {
  'use strict';
  if (window.__fapGradeLoaded) return;
  window.__fapGradeLoaded = true;

  const STORE_KEY = 'fapGrade.v1';
  const GPA_STORE_KEY = 'fapGpa.v2'; // dùng chung với content.js (trang Bảng điểm)
  const RESIT = /\s*\(resit\)\s*$/i;
  const FINAL_GROUP = /final|^fe\b|^te\b|^pe\b/i;

  let course = null; // { code, name, comps, bonus, late, fapTotal }
  let all = {}; // toàn bộ state, key theo mã môn
  let root, host;

  // ---------- storage ----------
  const hasStorage = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  async function loadAll() {
    if (!hasStorage) return;
    const r = await chrome.storage.local.get(STORE_KEY);
    all = r[STORE_KEY] || {};
  }
  function save() {
    if (hasStorage) chrome.storage.local.set({ [STORE_KEY]: all });
  }
  const cs = () => (all[course.code] ||= { overrides: {}, custom: [], bonus: null, target: '5' });

  // ---------- helpers ----------
  const parseNum = (s) => {
    const t = String(s ?? '').trim().replace(',', '.').replace('%', '');
    return /^\d+(\.\d+)?$/.test(t) ? parseFloat(t) : null;
  };
  const fmt = (n, d = 2) => (n == null || !isFinite(n) ? '–' : n.toFixed(d).replace('.', ','));
  // FAP làm tròn điểm tổng đến 1 chữ số thập phân (vd 9,55 → 9,6; 7,765 → 7,8)
  const round1 = (n) => Math.round(n * 10 + 1e-9) / 10;
  const fmtG = (n) => (n == null ? '' : String(n).replace('.', ','));
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const gradeClass = (g) => (g == null ? '' : g >= 9 ? 'g-ex' : g >= 8 ? 'g-gd' : g >= 7 ? 'g-ok' : g >= 5 ? 'g-av' : 'g-bad');

  // ---------- parse ----------
  function parsePage() {
    const table = document.querySelector('table.student-mark-sheet');
    if (!table) return null;
    const codeEl = document.querySelector('.fap-result-card__code');
    const titleEl = document.querySelector('.fap-result-card__title');
    const code = codeEl ? codeEl.textContent.trim() : '';
    if (!code) return null;
    const name = titleEl ? titleEl.textContent.replace(code, '').replace(/\s+/g, ' ').trim() : code;

    const comps = [];
    let group = '';
    let bonus = null, late = 0, fapTotal = null;
    for (const row of table.tBodies[0].rows) {
      const cells = [...row.cells];
      const text = (c) => (c ? c.textContent.replace(/\s+/g, ' ').trim() : '');
      if (row.classList.contains('sheet-grand-total')) {
        const label = text(cells[1]);
        if (/bonus/i.test(label)) bonus = parseNum(text(cells[2]));
        else if (/muộn/i.test(label)) late = parseNum(text(cells[2])) || 0;
        else if (/tổng môn/i.test(label)) fapTotal = parseNum(text(cells[3]));
        continue;
      }
      if (row.classList.contains('sheet-row-total')) continue;
      const groupCell = cells.find((c) => c.classList.contains('sheet-group-cell'));
      if (groupCell) group = text(groupCell);
      const rest = cells.filter((c) => c !== groupCell);
      const [nameC, weightC, scoreC, noteC] = rest;
      const weight = parseNum(text(weightC));
      if (weight == null) continue;
      const cname = text(nameC);
      const note = text(noteC);
      comps.push({
        key: `${group}|${cname}`,
        group,
        name: cname,
        weight,
        real: parseNum(text(scoreC)),
        note: note === '-' ? '' : note,
        custom: false,
      });
    }
    return { code, name, comps, bonus, late, fapTotal };
  }

  // ---------- calculation ----------
  function components() {
    return course.comps.concat(
      cs().custom.map((c) => ({ ...c, real: null, note: '', custom: true }))
    );
  }
  const isResit = (c) => RESIT.test(c.group) || RESIT.test(c.name);
  const eff = (c, useOverride) => (useOverride ? cs().overrides[c.key] ?? c.real : c.real);

  function calc(useOverride) {
    const list = components();
    const main = list.filter((c) => !isResit(c));
    const resits = list.filter(isResit);
    let known = 0, pendingW = 0, totalW = 0;
    const used = []; // { comp, value, fromResit }
    for (const c of main) {
      totalW += c.weight;
      const base = c.name.replace(RESIT, '');
      const r = resits.find((x) => x.name.replace(RESIT, '') === base && eff(x, useOverride) != null);
      const v = r ? eff(r, useOverride) : eff(c, useOverride);
      if (v == null) pendingW += c.weight;
      else known += (c.weight * v) / 100;
      used.push({ comp: c, value: v, fromResit: !!r });
    }
    const bonusV = useOverride ? cs().bonus ?? course.bonus : course.bonus;
    const complete = pendingW === 0 && totalW > 0;
    const raw = complete ? Math.min(10, known + (bonusV || 0)) : null;
    return { known, pendingW, totalW, used, bonus: bonusV, complete, raw, total: raw == null ? null : round1(raw) };
  }

  // Điều kiện qua môn (tham khảo theo quy chế FPT): tổng >= 5, không cột nào = 0, nhóm thi cuối kỳ >= 4
  function passChecks(r) {
    const checks = [];
    if (r.complete) checks.push(['Điểm tổng ≥ 5', r.total >= 5]);
    const zero = r.used.filter((u) => u.value === 0);
    if (r.used.some((u) => u.value != null)) {
      checks.push([zero.length ? `Có cột bằng 0: ${zero.map((u) => u.comp.name).join(', ')}` : 'Không có cột điểm 0', !zero.length]);
    }
    const finals = r.used.filter((u) => FINAL_GROUP.test(u.comp.group));
    const fw = finals.reduce((x, u) => x + u.comp.weight, 0);
    if (finals.length && finals.every((u) => u.value != null) && fw) {
      const avg = finals.reduce((x, u) => x + u.value * u.comp.weight, 0) / fw;
      checks.push([`Điểm thi cuối kỳ ≥ 4 (đang ${fmt(avg, 1)})`, avg >= 4]);
    }
    return checks;
  }

  // ---------- styles ----------
  const STYLE = `
    :host { all: initial; display: block; margin: 0 0 20px; }
    * { box-sizing: border-box; }
    .wrap {
      --bg:#ffffff; --fg:#111827; --muted:#6b7280; --faint:#9ca3af; --border:#e8eaee; --soft:#f6f7f9; --soft2:#eef0f3;
      --accent:#f36f21; --accent2:#ff9a3c; --accent-soft:#fff2e9; --hl:#fff6d6; --hl-border:#f5c542;
      --bad:#dc2626; --good:#16a34a; --shadow:0 1px 2px rgba(16,24,40,.05), 0 4px 16px rgba(16,24,40,.06);
      font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      color: var(--fg); background: var(--bg); border: 1px solid var(--border);
      border-radius: 16px; box-shadow: var(--shadow); overflow: clip;
    }
    .wrap.dark {
      --bg:#1b1f27; --fg:#e7e9ee; --muted:#a0a7b4; --faint:#6b7280; --border:#2e3440; --soft:#232833; --soft2:#2b313d;
      --accent-soft:#3a271b; --hl:#3d3313; --hl-border:#b8901f; --bad:#f87171; --good:#4ade80; --shadow:0 4px 16px rgba(0,0,0,.35);
    }
    button { font: inherit; cursor: pointer; }
    input { font: inherit; color: var(--fg); }

    .hero { background: linear-gradient(135deg, var(--accent) 0%, var(--accent2) 100%); color:#fff; padding:16px 20px; }
    .hero-top { display:flex; align-items:center; justify-content:space-between; gap:12px; }
    .title { font-size:17px; font-weight:700; }
    .subtitle { font-size:12px; opacity:.85; margin-top:2px; }
    .icon-btn { width:34px; height:34px; border-radius:10px; border:0; background:rgba(255,255,255,.18); color:#fff;
      display:grid; place-items:center; font-size:20px; line-height:1; transition: background .15s, transform .2s; }
    .icon-btn:hover { background:rgba(255,255,255,.3); }
    .collapsed .icon-btn { transform: rotate(180deg); }
    .collapsed .main { display:none; }
    .metrics { display:grid; grid-template-columns: repeat(3, 1fr); gap:12px; margin-top:14px; }
    .metric { background:rgba(255,255,255,.14); border:1px solid rgba(255,255,255,.22); border-radius:14px; padding:10px 14px; }
    .m-label { font-size:12px; opacity:.9; }
    .m-value { font-size:28px; font-weight:800; line-height:1.15; margin:2px 0 6px; font-variant-numeric: tabular-nums; }
    .m-value small { font-size:13px; font-weight:600; opacity:.85; }
    .pill { display:inline-flex; align-items:center; gap:4px; font-size:12px; font-weight:600; padding:2px 9px; border-radius:999px; background:rgba(255,255,255,.95); color:#4b5563; }
    .pill.up { color:#166534; } .pill.down { color:#b91c1c; }
    .m-sub { font-size:12px; opacity:.9; }

    .body { padding:16px 20px 20px; display:grid; gap:14px; }
    .target-card { display:flex; align-items:center; gap:12px; flex-wrap:wrap; padding:12px 14px; border-radius:14px;
      background:var(--accent-soft); border:1px solid color-mix(in srgb, var(--accent) 35%, transparent); }
    .lbl { font-weight:700; }
    .need { font-weight:600; font-size:13px; }
    .need.good { color:var(--good); } .need.bad { color:var(--bad); } .need.muted { color:var(--muted); font-weight:500; }
    .toolbar { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
    .field { height:34px; padding:0 12px; border:1px solid var(--border); border-radius:10px; background:var(--bg); outline:none; transition:border-color .15s, box-shadow .15s; }
    .field:focus { border-color:var(--accent); box-shadow:0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent); }
    .small { width:68px; text-align:center; }
    .chips { display:flex; gap:6px; flex-wrap:wrap; }
    .chip { height:30px; padding:0 12px; border-radius:999px; border:1px solid var(--border); background:var(--bg); color:var(--fg); font-size:13px; transition: all .15s; }
    .chip:hover { border-color:var(--accent); color:var(--accent); }
    .chip.active { background:var(--accent); border-color:var(--accent); color:#fff; }
    .btn { height:34px; padding:0 14px; border-radius:10px; border:1px solid var(--border); background:var(--bg); color:var(--fg); font-weight:600; font-size:13px; transition: all .15s; }
    .btn:hover { border-color:var(--accent); color:var(--accent); }
    .btn.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
    .btn.primary:hover { filter:brightness(1.05); color:#fff; }
    .btn:disabled { opacity:.5; cursor:not-allowed; }
    .spacer { flex:1; }
    .muted { color:var(--muted); font-size:13px; }

    .group { border:1px solid var(--border); border-radius:14px; overflow:hidden; }
    .group-head { display:flex; align-items:center; gap:10px; padding:9px 14px; background:var(--soft); border-bottom:1px solid var(--border); }
    .group-name { font-weight:700; }
    .group-info { margin-left:auto; font-size:12.5px; color:var(--muted); }
    .group-info b { color:var(--fg); }
    .tag { font-size:10.5px; font-weight:600; padding:1px 7px; border-radius:999px; background:var(--soft2); color:var(--muted); }
    .comp { display:grid; grid-template-columns: minmax(0,1fr) 64px 64px 108px; align-items:center; gap:10px; padding:8px 14px; }
    .comp + .comp { border-top:1px solid var(--border); }
    .comp:hover { background:var(--soft); }
    .comp.replaced .c-name, .comp.replaced .real { opacity:.45; text-decoration: line-through; }
    .c-name { font-weight:600; font-size:13px; }
    .c-note { color:var(--muted); font-size:12px; font-weight:400; margin-left:6px; }
    .w { font-size:12.5px; color:var(--muted); text-align:right; }
    .real { text-align:right; }
    .grade { display:inline-block; min-width:40px; text-align:center; padding:2px 8px; border-radius:8px; font-weight:700; font-size:13px; background:var(--soft2); }
    .g-ex { background:#dcfce7; color:#15803d; } .g-gd { background:#ccfbf1; color:#0f766e; }
    .g-ok { background:#dbeafe; color:#1d4ed8; } .g-av { background:#fef3c7; color:#b45309; } .g-bad { background:#fee2e2; color:#b91c1c; }
    .wrap.dark .g-ex { background:#14532d; color:#86efac; } .wrap.dark .g-gd { background:#134e4a; color:#5eead4; }
    .wrap.dark .g-ok { background:#1e3a8a; color:#93c5fd; } .wrap.dark .g-av { background:#78350f; color:#fcd34d; } .wrap.dark .g-bad { background:#7f1d1d; color:#fca5a5; }
    .try { display:flex; align-items:center; justify-content:flex-end; gap:4px; }
    .g { width:70px; height:32px; text-align:center; border:1px dashed var(--border); border-radius:9px; background:var(--bg); outline:none; font-weight:600; transition: all .15s; }
    .g::placeholder { color:var(--faint); font-weight:500; }
    .g:focus { border-style:solid; border-color:var(--accent); box-shadow:0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent); }
    .ovr .g { background:var(--hl); border:1px solid var(--hl-border); }
    .g.invalid, .field.invalid { border:1px solid var(--bad) !important; }
    .clr { width:24px; height:24px; border:0; border-radius:6px; background:none; color:var(--faint); font-size:16px; line-height:1; visibility:hidden; }
    .clr:hover { background:var(--soft2); color:var(--fg); }
    .ovr .clr, .custom .clr { visibility:visible; }

    .add-card { border:1px dashed var(--border); border-radius:14px; padding:12px 14px; display:grid; gap:10px; }
    .add-card .field.name { flex:1; min-width:160px; }
    .empty { text-align:center; color:var(--muted); padding:18px; }
    .checks { display:flex; gap:8px; flex-wrap:wrap; }
    .check { font-size:12.5px; font-weight:600; padding:4px 10px; border-radius:999px; }
    .check.ok { background:#dcfce7; color:#15803d; } .check.no { background:#fee2e2; color:#b91c1c; }
    .wrap.dark .check.ok { background:#14532d; color:#86efac; } .wrap.dark .check.no { background:#7f1d1d; color:#fca5a5; }
    .toast { font-size:12.5px; color:var(--good); font-weight:600; }

    @media (max-width: 760px) {
      .metrics { grid-template-columns: 1fr; }
      .comp { grid-template-columns: minmax(0,1fr) 56px 92px; }
      .comp .real { display:none; }
    }
  `;

  // ---------- render ----------
  function renderShell() {
    const st = cs();
    root.innerHTML = `
      <div class="wrap ${all.__collapsed ? 'collapsed' : ''}">
        <div class="hero">
          <div class="hero-top">
            <div>
              <div class="title">🧮 Ước lượng điểm môn · ${esc(course.code)}</div>
              <div class="subtitle">Nhập điểm thử cho từng cột để xem điểm tổng · Lưu riêng cho từng môn</div>
            </div>
            <button class="icon-btn" data-act="toggle" title="Thu gọn / mở rộng">▴</button>
          </div>
          <div class="metrics"></div>
        </div>
        <div class="main">
          <div class="body">
            <div class="target-card">
              <span class="lbl">🎯 Muốn đạt điểm tổng</span>
              <input class="field small target" inputmode="decimal" value="${esc(st.target || '')}">
              <div class="chips">${['5', '7', '8', '9'].map((v) => `<button class="chip" data-target="${v}">${v}</button>`).join('')}</div>
              <span class="need"></span>
            </div>
            <div class="checks"></div>
            <div class="groups"></div>
            <div class="add-card">
              <div class="muted">${
                course.comps.length
                  ? 'Thêm cột điểm chưa hiện trên FAP (vd cột chưa có điểm):'
                  : 'FAP chưa hiện cột điểm nào cho môn này. Thêm các cột theo syllabus để ước lượng:'
              }</div>
              <div class="toolbar">
                <input class="field name new-name" placeholder="Tên cột (vd Final Exam)">
                <input class="field small new-weight" inputmode="decimal" placeholder="%">
                <input class="field new-group" placeholder="Nhóm (tuỳ chọn)" style="width:150px">
                <button class="btn" data-act="add">+ Thêm cột</button>
              </div>
            </div>
            <div class="toolbar">
              <span class="muted">Bonus:</span>
              <input class="field small bonus" inputmode="decimal" placeholder="${esc(fmtG(course.bonus) || '0')}" value="${
                st.bonus != null ? esc(fmtG(st.bonus)) : ''
              }">
              <span class="muted">· Điền nhanh cột trống:</span>
              <input class="field small fillv" inputmode="decimal" value="8">
              <button class="btn" data-act="fill">Áp dụng</button>
              <button class="btn" data-act="reset">↺ Khôi phục</button>
              <span class="spacer"></span>
              <span class="toast"></span>
              <button class="btn primary" data-act="push" title="Dùng điểm tổng dự tính làm điểm thử cho môn này ở trang Bảng điểm">→ Dùng cho GPA</button>
            </div>
          </div>
        </div>
      </div>`;
    applyTheme();
    renderGroups();
    renderSummary();
  }

  function applyTheme() {
    const wrap = root && root.querySelector('.wrap');
    if (!wrap) return;
    const html = document.documentElement;
    const theme = html.getAttribute('data-bs-theme') || html.getAttribute('data-theme') || '';
    wrap.classList.toggle('dark', theme === 'dark');
  }

  function groupsOf(list) {
    const map = new Map();
    for (const c of list) {
      const g = c.group || 'Khác';
      if (!map.has(g)) map.set(g, []);
      map.get(g).push(c);
    }
    return [...map.entries()];
  }

  function renderGroups() {
    const st = cs();
    const html = groupsOf(components())
      .map(([g, list]) => {
        const w = list.reduce((x, c) => x + c.weight, 0);
        return `<section class="group">
          <div class="group-head"><span class="group-name">${esc(g)}</span>
            ${RESIT.test(g) ? '<span class="tag">Thay cho điểm thi chính nếu có điểm</span>' : ''}
            <span class="group-info" data-group="${esc(g)}">${w}%</span></div>
          ${list
            .map((c) => {
              const ovr = st.overrides[c.key];
              return `<div class="comp ${ovr != null ? 'ovr' : ''} ${c.custom ? 'custom' : ''}" data-key="${esc(c.key)}">
                <div class="c-name">${esc(c.name)}${c.custom ? ' <span class="tag">tự thêm</span>' : ''}${
                  c.note ? `<span class="c-note">${esc(c.note)}</span>` : ''
                }</div>
                <div class="w">${fmtG(c.weight)}%</div>
                <div class="real">${c.real == null ? '<span class="muted">–</span>' : `<span class="grade ${gradeClass(c.real)}">${fmt(c.real, 1)}</span>`}</div>
                <div class="try">
                  <input class="g" inputmode="decimal" placeholder="${c.real == null ? 'Nhập' : fmt(c.real, 1)}" value="${ovr != null ? esc(fmtG(ovr)) : ''}" aria-label="Điểm thử ${esc(c.name)}">
                  <button class="clr" data-act="${c.custom ? 'remove' : 'clear'}" title="${c.custom ? 'Xoá cột tự thêm' : 'Bỏ điểm thử'}">×</button>
                </div>
              </div>`;
            })
            .join('')}
        </section>`;
      })
      .join('');
    root.querySelector('.groups').innerHTML = html || '<div class="empty">Chưa có cột điểm nào — thêm cột ở bên dưới</div>';
  }

  function renderSummary() {
    const st = cs();
    const real = calc(false);
    const pred = calc(true);
    const status = pred.complete ? (passChecks(pred).every((c) => c[1]) ? 'Đạt' : 'Chưa đạt') : null;

    let delta = '';
    if (pred.total != null && real.total != null && Math.abs(pred.total - real.total) >= 0.05) {
      const d = pred.total - real.total;
      delta = `<span class="pill ${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${fmt(Math.abs(d), 1)} so với thật</span>`;
    } else if (pred.total != null && real.total != null) delta = '<span class="pill">= điểm thật</span>';

    const fapMatch =
      course.fapTotal != null && real.total != null
        ? Math.abs(course.fapTotal - real.total) < 0.051
          ? 'Khớp với FAP ✓'
          : `FAP ghi ${fmt(course.fapTotal, 1)}`
        : 'Chưa đủ điểm';

    root.querySelector('.metrics').innerHTML = `
      <div class="metric">
        <div class="m-label">Điểm tổng thật</div>
        <div class="m-value">${fmt(real.total, 1)}</div>
        <div class="m-sub">${esc(fapMatch)}</div>
      </div>
      <div class="metric">
        <div class="m-label">Điểm tổng dự tính</div>
        <div class="m-value">${pred.complete ? fmt(pred.total, 1) : `${fmt(pred.known + (pred.bonus || 0), 1)}<small> + ?</small>`}</div>
        ${pred.complete ? delta : `<div class="m-sub">Còn ${fmtG(pred.pendingW)}% chưa có điểm</div>`}
      </div>
      <div class="metric">
        <div class="m-label">Trạng thái dự tính</div>
        <div class="m-value" style="font-size:22px">${status ? (status === 'Đạt' ? '✓ Đạt' : '✗ Chưa đạt') : '…'}</div>
        <div class="m-sub">Tổng trọng số ${fmtG(pred.totalW)}%${pred.totalW !== 100 ? ' ⚠️ chưa đủ 100%' : ''}</div>
      </div>`;

    // điểm trung bình cần cho các cột còn trống
    const box = root.querySelector('.need');
    const target = parseNum(st.target);
    root.querySelectorAll('[data-target]').forEach((b) => b.classList.toggle('active', parseNum(b.dataset.target) === target));
    if (target == null) {
      box.className = 'need muted';
      box.textContent = 'Nhập điểm tổng mong muốn';
    } else if (pred.complete) {
      const ok = pred.total >= target;
      box.className = `need ${ok ? 'good' : 'bad'}`;
      box.textContent = ok ? `✓ Đạt (${fmt(pred.total, 1)})` : `✗ Chỉ được ${fmt(pred.total, 1)} — xoá bớt điểm thử để xem cần bao nhiêu`;
    } else {
      // điểm tổng được làm tròn 1 chữ số → chỉ cần chạm target - 0,05
      const need = ((target - 0.05 - (pred.bonus || 0) - pred.known) * 100) / pred.pendingW;
      if (need > 10) {
        box.className = 'need bad';
        box.textContent = `✗ Không thể đạt (cần TB ${fmt(need)} cho ${fmtG(pred.pendingW)}% còn lại)`;
      } else if (need <= 0) {
        box.className = 'need good';
        box.textContent = '✓ Chắc chắn đạt (nếu các cột còn lại > 0)';
      } else {
        box.className = 'need';
        box.textContent = `→ Cần trung bình ${fmt(need)} cho ${fmtG(pred.pendingW)}% còn lại`;
      }
    }

    root.querySelector('.checks').innerHTML = passChecks(pred)
      .map(([t, ok]) => `<span class="check ${ok ? 'ok' : 'no'}">${ok ? '✓' : '✗'} ${esc(t)}</span>`)
      .join('');

    // gạch cột thi chính đã bị điểm thi lại thay thế, cập nhật điểm nhóm
    const replaced = new Set(pred.used.filter((u) => u.fromResit).map((u) => u.comp.key));
    root.querySelectorAll('.comp').forEach((el) => el.classList.toggle('replaced', replaced.has(el.dataset.key)));
    for (const [g, list] of groupsOf(components())) {
      const el = root.querySelector(`.group-info[data-group="${CSS.escape(g)}"]`);
      if (!el) continue;
      const w = list.reduce((x, c) => x + c.weight, 0);
      const vals = list.map((c) => [c.weight, eff(c, true)]).filter(([, v]) => v != null);
      const vw = vals.reduce((x, [cw]) => x + cw, 0);
      const avg = vw ? vals.reduce((x, [cw, v]) => x + cw * v, 0) / vw : null;
      el.innerHTML = `${fmtG(w)}%${avg != null ? ` · TB <b>${fmt(avg, 1)}</b>` : ''}`;
    }
    root.querySelector('[data-act=push]').disabled = !pred.complete;
  }

  function toast(msg) {
    const el = root.querySelector('.toast');
    el.textContent = msg;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (el.textContent = ''), 3500);
  }

  // ---------- events ----------
  function bindEvents() {
    root.addEventListener('input', (e) => {
      const t = e.target;
      const st = cs();
      if (t.classList.contains('target')) {
        st.target = t.value.trim();
        save();
        return renderSummary();
      }
      if (t.classList.contains('bonus')) {
        const v = parseNum(t.value);
        if (t.value.trim() === '') st.bonus = null;
        else if (v == null) return t.classList.add('invalid');
        else st.bonus = v;
        t.classList.remove('invalid');
        save();
        return renderSummary();
      }
      if (!t.classList.contains('g')) return;
      const row = t.closest('.comp');
      const key = row.dataset.key;
      const raw = t.value.trim();
      const v = parseNum(raw);
      if (raw === '') delete st.overrides[key];
      else if (v == null || v > 10) return t.classList.add('invalid');
      else st.overrides[key] = v;
      t.classList.remove('invalid');
      row.classList.toggle('ovr', st.overrides[key] != null);
      save();
      renderSummary();
    });

    root.addEventListener('keydown', (e) => {
      const t = e.target;
      if (t.classList.contains('new-name') || t.classList.contains('new-weight') || t.classList.contains('new-group')) {
        if (e.key === 'Enter') root.querySelector('[data-act=add]').click();
        return;
      }
      if (!t.classList.contains('g') || !['Enter', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
      e.preventDefault();
      const inputs = [...root.querySelectorAll('.g')];
      const i = inputs.indexOf(t) + (e.key === 'ArrowUp' ? -1 : 1);
      if (inputs[i]) {
        inputs[i].focus();
        inputs[i].select();
      }
    });

    root.addEventListener('click', async (e) => {
      const el = e.target.closest('button');
      if (!el) return;
      const st = cs();
      if (el.dataset.target) {
        st.target = el.dataset.target;
        root.querySelector('.target').value = st.target;
        save();
        return renderSummary();
      }
      const act = el.dataset.act;
      if (act === 'toggle') {
        all.__collapsed = !all.__collapsed;
        root.querySelector('.wrap').classList.toggle('collapsed', all.__collapsed);
        save();
      } else if (act === 'clear') {
        const row = el.closest('.comp');
        delete st.overrides[row.dataset.key];
        row.classList.remove('ovr');
        row.querySelector('.g').value = '';
        save();
        renderSummary();
      } else if (act === 'remove') {
        const key = el.closest('.comp').dataset.key;
        st.custom = st.custom.filter((c) => c.key !== key);
        delete st.overrides[key];
        save();
        renderGroups();
        renderSummary();
      } else if (act === 'add') {
        const nameI = root.querySelector('.new-name');
        const wI = root.querySelector('.new-weight');
        const gI = root.querySelector('.new-group');
        const name = nameI.value.trim();
        const w = parseNum(wI.value);
        nameI.classList.toggle('invalid', !name);
        wI.classList.toggle('invalid', w == null || w <= 0 || w > 100);
        if (!name || w == null || w <= 0 || w > 100) return;
        const group = gI.value.trim() || name;
        st.custom.push({ key: `custom:${Date.now()}`, group, name, weight: w });
        nameI.value = wI.value = gI.value = '';
        save();
        renderGroups();
        renderSummary();
        nameI.focus();
      } else if (act === 'fill') {
        const inp = root.querySelector('.fillv');
        const v = parseNum(inp.value);
        if (v == null || v > 10) return inp.classList.add('invalid');
        inp.classList.remove('invalid');
        for (const c of components()) {
          if (!isResit(c) && c.real == null && st.overrides[c.key] == null) st.overrides[c.key] = v;
        }
        save();
        renderGroups();
        renderSummary();
      } else if (act === 'reset') {
        st.overrides = {};
        st.bonus = null;
        root.querySelector('.bonus').value = '';
        save();
        renderGroups();
        renderSummary();
      } else if (act === 'push') {
        const pred = calc(true);
        if (!pred.complete || !hasStorage) return;
        const r = await chrome.storage.local.get(GPA_STORE_KEY);
        const gpa = r[GPA_STORE_KEY] || {};
        gpa.overrides = gpa.overrides || {};
        gpa.overrides[course.code] = pred.total;
        await chrome.storage.local.set({ [GPA_STORE_KEY]: gpa });
        toast(`✓ Đã đặt ${course.code} = ${fmt(pred.total, 1)} ở trang Bảng điểm`);
      }
    });
  }

  // ---------- boot ----------
  function mount() {
    const parsed = parsePage();
    if (!parsed) return;
    if (course && host && host.isConnected && parsed.code === course.code) return;
    course = parsed;
    if (host) host.remove();
    // Đặt ở đầu trang, trên khung chọn Học kỳ / Lớp học (giống trang Bảng điểm)
    const table = document.querySelector('table.student-mark-sheet');
    const filter = document.querySelector('#grade-report-term');
    const anchor = (filter && filter.closest('.card')) || table.closest('.card') || table;
    host = document.createElement('div');
    host.id = 'fap-grade-estimator';
    anchor.parentNode.insertBefore(host, anchor);
    root = host.attachShadow({ mode: 'open' });
    // FAP chặn thẻ <style> inline bằng CSP, nên nạp CSS qua constructable stylesheet
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(STYLE);
    root.adoptedStyleSheets = [sheet];
    bindEvents();
    renderShell();
  }

  async function init() {
    await loadAll();
    mount();
    // Đổi môn/học kỳ có thể chỉ thay nội dung trang → theo dõi để dựng lại khung
    let timer;
    new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(mount, 150);
    }).observe(document.body, { childList: true, subtree: true });
    new MutationObserver(applyTheme).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-bs-theme', 'data-theme'],
    });
  }

  init();
})();
