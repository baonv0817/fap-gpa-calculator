(() => {
  'use strict';
  if (window.__fapGpaLoaded) return;
  window.__fapGpaLoaded = true;

  const STORE_KEY = 'fapGpa.v2';
  // Môn không tính GPA theo quy định: định hướng, tiếng Anh dự bị, Vovinam, LAB, OJT
  const NON_GPA = /^(OTP|TRS|VOV|LAB|OJT)/i;
  const OUTSIDE = 'outside'; // nhóm "Những môn ngoài khung chương trình"

  let subjects = [];
  let state = { overrides: {}, include: {}, target: '', collapsed: false, tab: 'overview', filter: 'all', fill: '8' };
  let query = '';
  let root;

  // ---------- storage ----------
  const hasStorage = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  async function loadState() {
    if (!hasStorage) return;
    const r = await chrome.storage.local.get(STORE_KEY);
    state = Object.assign(state, r[STORE_KEY] || {});
  }
  function saveState() {
    if (hasStorage) chrome.storage.local.set({ [STORE_KEY]: state });
  }

  // ---------- helpers ----------
  const parseNum = (s) => {
    const t = String(s ?? '').trim().replace(',', '.');
    return /^\d+(\.\d+)?$/.test(t) ? parseFloat(t) : null;
  };
  const fmt = (n) => (n == null || !isFinite(n) ? '–' : n.toFixed(2).replace('.', ','));
  const fmtGrade = (n) => (n == null ? '' : String(n).replace('.', ','));
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const isIncluded = (s) => state.include[s.key] ?? s.defaultInclude;
  const effGrade = (s) => state.overrides[s.key] ?? s.grade;
  const termLabel = (t) => (t === OUTSIDE ? 'Ngoài khung chương trình' : `Kỳ ${t}`);

  function rank(g) {
    if (g == null) return null;
    if (g >= 9) return ['Xuất sắc', 'r-ex'];
    if (g >= 8) return ['Giỏi', 'r-gd'];
    if (g >= 7) return ['Khá', 'r-ok'];
    if (g >= 5) return ['Trung bình', 'r-av'];
    return ['Yếu', 'r-bad'];
  }
  const gradeClass = (g) => (g == null ? '' : g >= 9 ? 'g-ex' : g >= 8 ? 'g-gd' : g >= 7 ? 'g-ok' : g >= 5 ? 'g-av' : 'g-bad');

  // ---------- parse ----------
  function headers(t) {
    const r = (t.tHead && t.tHead.rows[0]) || t.rows[0];
    return r ? [...r.cells].map((c) => c.textContent.trim().toUpperCase()) : [];
  }

  function findTables() {
    const all = [...document.querySelectorAll('table')];
    const main = all.find((t) => {
      const h = headers(t);
      return h.includes('MÃ MÔN') && h.includes('KỲ') && h.includes('ĐIỂM');
    });
    const outside = all.find((t) => {
      if (t === main || !headers(t).includes('MÃ MÔN')) return false;
      const card = t.closest('.card');
      return /ngoài khung/i.test(card ? card.textContent.slice(0, 300) : '');
    });
    return { main, outside };
  }

  function parseTable(t, isOutside, seen) {
    const h = headers(t);
    const get = (row, label) => {
      const c = row.querySelector(`td[data-label="${label}"]`) || row.cells[h.indexOf(label)];
      return c ? c.textContent.trim() : '';
    };
    return [...((t.tBodies[0] && t.tBodies[0].rows) || [])]
      .map((row) => {
        const code = get(row, 'MÃ MÔN');
        const base = (isOutside ? 'x:' : '') + code;
        seen[base] = (seen[base] || 0) + 1;
        const credit = parseNum(get(row, 'TÍN CHỈ')) ?? 0;
        const grade = parseNum(get(row, 'ĐIỂM'));
        const status = get(row, 'TRẠNG THÁI');
        let reason = null;
        if (isOutside) reason = 'Ngoài khung';
        else if (NON_GPA.test(code)) reason = 'Không tính GPA';
        else if (grade == null && /đạt|exempt|miễn|pass/i.test(status)) reason = 'Không có điểm số';
        else if (credit <= 0) reason = '0 tín chỉ';
        return {
          key: seen[base] > 1 ? `${base}#${seen[base]}` : base,
          code,
          term: isOutside ? OUTSIDE : get(row, 'KỲ'),
          semester: get(row, 'HỌC KỲ'),
          name: get(row, 'TÊN MÔN'),
          credit,
          grade,
          status,
          reason,
          defaultInclude: !reason,
        };
      })
      .filter((s) => s.code);
  }

  // ---------- calculation ----------
  function calc(list, predicted) {
    let pts = 0, cr = 0, pending = 0;
    for (const s of list) {
      if (!isIncluded(s)) continue;
      const g = predicted ? effGrade(s) : s.grade;
      if (g == null) {
        pending += s.credit;
        continue;
      }
      pts += g * s.credit;
      cr += s.credit;
    }
    return { gpa: cr ? pts / cr : null, pts, cr, pending };
  }

  function termGroups(list = subjects) {
    const map = new Map();
    for (const s of list) {
      if (!map.has(s.term)) map.set(s.term, []);
      map.get(s.term).push(s);
    }
    const order = (t) => (t === OUTSIDE ? 1e9 : parseFloat(t) || 0);
    return [...map.entries()].sort((a, b) => order(a[0]) - order(b[0]));
  }

  const semestersOf = (list) => [...new Set(list.map((s) => s.semester).filter((x) => x && x !== '-'))].join(', ');

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
      --accent-soft:#3a271b; --hl:#3d3313; --hl-border:#b8901f; --bad:#f87171; --good:#4ade80;
      --shadow:0 4px 16px rgba(0,0,0,.35);
    }
    button { font: inherit; cursor: pointer; }
    input { font: inherit; color: var(--fg); }

    /* ---- hero ---- */
    .hero { background: linear-gradient(135deg, var(--accent) 0%, var(--accent2) 100%); color: #fff; padding: 18px 20px 20px; }
    .hero-top { display:flex; align-items:center; justify-content:space-between; gap:12px; }
    .title { font-size:18px; font-weight:700; letter-spacing:.2px; display:flex; align-items:center; gap:8px; }
    .subtitle { font-size:12px; opacity:.85; margin-top:2px; }
    .icon-btn { width:34px; height:34px; border-radius:10px; border:0; background:rgba(255,255,255,.18); color:#fff;
      display:grid; place-items:center; font-size:20px; line-height:1; transition: background .15s, transform .2s; }
    .icon-btn:hover { background:rgba(255,255,255,.3); }
    .collapsed .icon-btn { transform: rotate(180deg); }
    .metrics { display:grid; grid-template-columns: repeat(3, 1fr); gap:12px; margin-top:16px; }
    .metric { background:rgba(255,255,255,.14); border:1px solid rgba(255,255,255,.22); border-radius:14px; padding:12px 14px; backdrop-filter: blur(4px); }
    .m-label { font-size:12px; opacity:.9; }
    .m-value { font-size:30px; font-weight:800; line-height:1.15; margin:2px 0 6px; font-variant-numeric: tabular-nums; }
    .m-value small { font-size:15px; font-weight:600; opacity:.8; }
    .pill { display:inline-flex; align-items:center; gap:4px; font-size:12px; font-weight:600; padding:2px 9px; border-radius:999px; background:rgba(255,255,255,.95); color:#7c2d12; }
    .pill.up { color:#166534; } .pill.down { color:#b91c1c; } .pill.flat { color:#4b5563; }
    .progress { height:6px; background:rgba(255,255,255,.3); border-radius:99px; overflow:hidden; margin-top:4px; }
    .progress i { display:block; height:100%; background:#fff; border-radius:99px; transition: width .3s; }
    .m-sub { font-size:12px; opacity:.9; margin-top:5px; }

    .collapsed .main { display:none; }

    /* ---- tabs ---- */
    .tabs { display:flex; gap:4px; padding:10px 16px 0; border-bottom:1px solid var(--border); background:var(--bg); }
    .tab { border:0; background:none; color:var(--muted); padding:10px 14px; font-weight:600; border-bottom:2px solid transparent; margin-bottom:-1px; }
    .tab:hover { color:var(--fg); }
    .tab.active { color:var(--accent); border-bottom-color:var(--accent); }
    .pane { display:none; padding:16px 20px 20px; }
    .pane.active { display:block; }
    h4 { font-size:13px; font-weight:700; margin:0 0 10px; color:var(--fg); }
    .section + .section { margin-top:20px; }

    /* ---- chart ---- */
    .chart-card { border:1px solid var(--border); border-radius:14px; padding:14px 14px 8px; background:var(--soft); }
    svg { display:block; width:100%; height:auto; }
    .grid line { stroke: var(--border); }
    .grid text, .xlab { fill: var(--faint); font-size:10px; }
    .bar { fill: var(--accent); }
    .bar.pred { fill: var(--accent); opacity:.35; }
    .bar-val { fill: var(--fg); font-size:10.5px; font-weight:700; }
    .cum { fill:none; stroke:#2563eb; stroke-width:2; }
    .cum-dot { fill: var(--bg); stroke:#2563eb; stroke-width:2; }
    .legend { display:flex; gap:16px; flex-wrap:wrap; font-size:12px; color:var(--muted); padding:6px 4px 4px; }
    .legend span::before { content:""; display:inline-block; width:10px; height:10px; border-radius:3px; margin-right:6px; vertical-align:-1px; background:var(--accent); }
    .legend .l-pred::before { opacity:.35; }
    .legend .l-cum::before { height:2px; width:14px; border-radius:0; vertical-align:3px; background:#2563eb; }

    /* ---- tables ---- */
    .tbl-wrap { overflow-x:auto; border:1px solid var(--border); border-radius:14px; }
    table { border-collapse:collapse; width:100%; }
    th, td { padding:9px 14px; text-align:left; white-space:nowrap; font-variant-numeric: tabular-nums; }
    thead th { font-size:11.5px; text-transform:uppercase; letter-spacing:.4px; color:var(--muted); background:var(--soft); font-weight:600; }
    tbody tr + tr td { border-top:1px solid var(--border); }
    tbody tr:hover td { background:var(--soft); }
    .num { text-align:right; }
    .strong { font-weight:700; }

    /* ---- plan tools ---- */
    .tools { display:grid; gap:12px; margin-bottom:16px; }
    .target-card { display:flex; align-items:center; gap:14px; flex-wrap:wrap; padding:12px 14px; border-radius:14px;
      background:var(--accent-soft); border:1px solid color-mix(in srgb, var(--accent) 35%, transparent); }
    .target-card .lbl { font-weight:700; }
    .need { font-weight:600; font-size:13px; }
    .need.good { color:var(--good); } .need.bad { color:var(--bad); } .need.muted { color:var(--muted); font-weight:500; }
    .toolbar { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
    .field { height:34px; padding:0 12px; border:1px solid var(--border); border-radius:10px; background:var(--bg); outline:none; transition:border-color .15s, box-shadow .15s; }
    .field:focus { border-color:var(--accent); box-shadow:0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent); }
    .search { flex:1; min-width:180px; }
    .small { width:68px; text-align:center; }
    .chips { display:flex; gap:6px; flex-wrap:wrap; }
    .chip { height:30px; padding:0 12px; border-radius:999px; border:1px solid var(--border); background:var(--bg); color:var(--fg); font-size:13px; transition: all .15s; }
    .chip:hover { border-color:var(--accent); color:var(--accent); }
    .chip.active { background:var(--accent); border-color:var(--accent); color:#fff; }
    .chip .count { opacity:.7; margin-left:4px; font-size:12px; }
    .btn { height:34px; padding:0 14px; border-radius:10px; border:1px solid var(--border); background:var(--bg); color:var(--fg); font-weight:600; font-size:13px; transition: all .15s; }
    .btn:hover { border-color:var(--accent); color:var(--accent); }
    .btn.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
    .btn.primary:hover { filter:brightness(1.05); color:#fff; }
    .spacer { flex:1; }
    .muted { color:var(--muted); font-size:13px; }

    /* ---- subject list ---- */
    .term { border:1px solid var(--border); border-radius:14px; overflow:hidden; }
    .term + .term { margin-top:12px; }
    .term-head { display:flex; align-items:center; gap:10px; padding:10px 14px; background:var(--soft); border-bottom:1px solid var(--border); }
    .term-name { font-weight:700; }
    .term-sem { color:var(--muted); font-size:12px; }
    .term-gpa { margin-left:auto; font-size:12.5px; color:var(--muted); }
    .term-gpa b { color:var(--fg); font-size:14px; }
    .subj { display:grid; grid-template-columns: 42px minmax(0,1fr) 56px 64px 108px; align-items:center; gap:10px; padding:9px 14px; transition: background .15s; }
    .subj + .subj { border-top:1px solid var(--border); }
    .subj:hover { background:var(--soft); }
    .subj.off .info, .subj.off .cr, .subj.off .real { opacity:.45; }
    .code { font-weight:700; font-size:13px; display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
    .name { color:var(--muted); font-size:12.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .tag { font-size:10.5px; font-weight:600; padding:1px 7px; border-radius:999px; background:var(--soft2); color:var(--muted); }
    .tag.warn { background:#fee2e2; color:#b91c1c; }
    .tag.info { background:#dbeafe; color:#1d4ed8; }
    .wrap.dark .tag.warn { background:#4c1d1d; color:#fca5a5; }
    .wrap.dark .tag.info { background:#1e2b4d; color:#93c5fd; }
    .cr { font-size:12.5px; color:var(--muted); text-align:right; }
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
    .g.invalid { border:1px solid var(--bad) !important; box-shadow:0 0 0 3px color-mix(in srgb, var(--bad) 18%, transparent); }
    .clr { width:24px; height:24px; border:0; border-radius:6px; background:none; color:var(--faint); font-size:16px; line-height:1; visibility:hidden; }
    .clr:hover { background:var(--soft2); color:var(--fg); }
    .ovr .clr { visibility:visible; }

    /* switch */
    .switch { position:relative; display:inline-block; width:36px; height:20px; }
    .switch input { opacity:0; width:0; height:0; position:absolute; }
    .switch span { position:absolute; inset:0; background:var(--soft2); border:1px solid var(--border); border-radius:99px; transition:.2s; cursor:pointer; }
    .switch span::after { content:""; position:absolute; width:14px; height:14px; left:2px; top:2px; background:#fff; border-radius:50%; box-shadow:0 1px 2px rgba(0,0,0,.25); transition:.2s; }
    .switch input:checked + span { background:var(--accent); border-color:var(--accent); }
    .switch input:checked + span::after { transform: translateX(16px); }
    .switch input:focus-visible + span { box-shadow:0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent); }

    .empty { text-align:center; color:var(--muted); padding:28px; border:1px dashed var(--border); border-radius:14px; }

    /* sticky summary */
    .sticky { position:sticky; bottom:12px; margin-top:16px; display:flex; align-items:center; gap:12px; flex-wrap:wrap;
      padding:10px 16px; border-radius:14px; background:var(--fg); color:var(--bg); box-shadow:0 8px 24px rgba(0,0,0,.18); font-size:13px; z-index:2; }
    .sticky b { font-size:18px; }
    .sticky .sep { opacity:.4; }
    .sticky .d-up { color:#4ade80; } .sticky .d-down { color:#f87171; }
    .wrap.dark .sticky .d-up { color:#15803d; } .wrap.dark .sticky .d-down { color:#b91c1c; }

    @media (max-width: 760px) {
      .metrics { grid-template-columns: 1fr; }
      .subj { grid-template-columns: 42px minmax(0,1fr) 92px; }
      .subj .cr, .subj .real { display:none; }
      .pane { padding:14px; }
    }
  `;

  // ---------- render ----------
  function renderShell() {
    root.innerHTML = `
      <div class="wrap">
        <div class="hero">
          <div class="hero-top">
            <div>
              <div class="title">🎓 GPA Calculator</div>
              <div class="subtitle">Tự động đọc từ bảng điểm FAP · Điểm thử được lưu lại trên máy bạn</div>
            </div>
            <button class="icon-btn" data-act="toggle" title="Thu gọn / mở rộng">▴</button>
          </div>
          <div class="metrics"></div>
        </div>
        <div class="main">
          <div class="tabs">
            <button class="tab" data-tab="overview">📊 Tổng quan</button>
            <button class="tab" data-tab="plan">🧮 Dự tính GPA</button>
          </div>
          <div class="pane" data-pane="overview">
            <div class="section">
              <h4>GPA từng kỳ</h4>
              <div class="chart-card">
                <div class="chart"></div>
                <div class="legend"><span>GPA kỳ (điểm thật)</span><span class="l-pred">Có điểm thử</span><span class="l-cum">GPA tích luỹ</span></div>
              </div>
            </div>
            <div class="section">
              <h4>Chi tiết theo kỳ</h4>
              <div class="tbl-wrap terms"></div>
            </div>
          </div>
          <div class="pane" data-pane="plan">
            <div class="tools">
              <div class="target-card">
                <span class="lbl">🎯 Mục tiêu GPA tốt nghiệp</span>
                <input class="field small target" inputmode="decimal" placeholder="8,5" value="${esc(state.target || '')}">
                <div class="chips">
                  ${['8', '8.5', '9', '9.5'].map((v) => `<button class="chip" data-target="${v}">${v.replace('.', ',')}</button>`).join('')}
                </div>
                <span class="need"></span>
              </div>
              <div class="toolbar">
                <input class="field search" placeholder="🔍 Tìm mã hoặc tên môn…" value="${esc(query)}">
                <div class="chips filters"></div>
              </div>
              <div class="toolbar">
                <span class="muted">Điền nhanh cho môn chưa có điểm:</span>
                <input class="field small fillv" inputmode="decimal" value="${esc(state.fill)}">
                <button class="btn primary" data-act="fill">Áp dụng</button>
                <span class="spacer"></span>
                <button class="btn" data-act="reset">↺ Khôi phục điểm thật</button>
              </div>
            </div>
            <div class="list"></div>
            <div class="sticky"></div>
          </div>
        </div>
      </div>`;
    applyTheme();
    applyCollapsed();
    applyTab();
    renderList();
    renderSummary();
  }

  function applyCollapsed() {
    root.querySelector('.wrap').classList.toggle('collapsed', !!state.collapsed);
  }

  function applyTab() {
    root.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.tab));
    root.querySelectorAll('.pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === state.tab));
  }

  function applyTheme() {
    const wrap = root && root.querySelector('.wrap');
    if (!wrap) return;
    const html = document.documentElement;
    const theme = html.getAttribute('data-bs-theme') || html.getAttribute('data-theme') || '';
    wrap.classList.toggle('dark', theme === 'dark');
  }

  function deltaPill(pred, actual) {
    if (pred == null || actual == null) return '';
    const d = pred - actual;
    if (Math.abs(d) < 0.005) return `<span class="pill flat">= so với hiện tại</span>`;
    return `<span class="pill ${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${fmt(Math.abs(d))} so với hiện tại</span>`;
  }

  function renderSummary() {
    const actual = calc(subjects, false);
    const pred = calc(subjects, true);
    const totalCr = subjects.filter(isIncluded).reduce((x, s) => x + s.credit, 0);
    const r = rank(actual.gpa);
    const pct = totalCr ? Math.round((actual.cr / totalCr) * 100) : 0;

    root.querySelector('.metrics').innerHTML = `
      <div class="metric">
        <div class="m-label">GPA hiện tại</div>
        <div class="m-value">${fmt(actual.gpa)}</div>
        ${r ? `<span class="pill">${r[0]}</span>` : ''}
      </div>
      <div class="metric">
        <div class="m-label">GPA dự tính${pred.pending ? '' : ' tốt nghiệp'}</div>
        <div class="m-value">${fmt(pred.gpa)}</div>
        ${deltaPill(pred.gpa, actual.gpa)}
      </div>
      <div class="metric">
        <div class="m-label">Tín chỉ tính GPA đã có điểm</div>
        <div class="m-value">${actual.cr}<small> / ${totalCr}</small></div>
        <div class="progress"><i style="width:${pct}%"></i></div>
        <div class="m-sub">Hoàn thành ${pct}% chương trình</div>
      </div>`;

    renderTarget(pred);
    renderTerms();
    renderChart();
    renderTermHeads();
    renderFilters();
    renderSticky(actual, pred);
  }

  function renderTarget(pred) {
    const box = root.querySelector('.need');
    const target = parseNum(state.target);
    root.querySelectorAll('[data-target]').forEach((b) => b.classList.toggle('active', parseNum(b.dataset.target) === target));
    if (target == null) {
      box.className = 'need muted';
      box.textContent = 'Chọn hoặc nhập mục tiêu để biết cần đạt bao nhiêu';
      return;
    }
    if (!pred.pending) {
      const ok = pred.gpa >= target;
      box.className = `need ${ok ? 'good' : 'bad'}`;
      box.textContent = ok ? '✓ Đạt mục tiêu với điểm hiện tại' : '✗ Chưa đạt — hãy xoá bớt điểm thử để xem cần bao nhiêu';
      return;
    }
    const need = (target * (pred.cr + pred.pending) - pred.pts) / pred.pending;
    if (need > 10) {
      box.className = 'need bad';
      box.textContent = `✗ Không thể đạt (cần TB ${fmt(need)} cho ${pred.pending} TC còn lại)`;
    } else if (need <= 0) {
      box.className = 'need good';
      box.textContent = '✓ Chắc chắn đạt';
    } else {
      box.className = `need ${need <= 9 ? 'good' : ''}`;
      box.textContent = `→ Cần trung bình ${fmt(need)} cho ${pred.pending} tín chỉ còn trống`;
    }
  }

  function gpaTerms() {
    return termGroups().filter(([t, list]) => t !== OUTSIDE && list.some(isIncluded));
  }

  function renderTerms() {
    let rows = '';
    const cum = [];
    for (const [term, list] of gpaTerms()) {
      cum.push(...list);
      const a = calc(list, false);
      const p = calc(list, true);
      const c = calc(cum, true);
      const credits = list.filter(isIncluded).reduce((x, s) => x + s.credit, 0);
      const changed = p.gpa != null && (a.gpa == null || Math.abs(p.gpa - a.gpa) > 1e-9);
      rows += `<tr>
        <td class="strong">${termLabel(term)}</td><td>${esc(semestersOf(list) || '–')}</td>
        <td class="num">${credits}</td>
        <td class="num"><span class="grade ${gradeClass(a.gpa)}">${fmt(a.gpa)}</span></td>
        <td class="num">${changed ? `<span class="grade ${gradeClass(p.gpa)}">${fmt(p.gpa)}</span>` : '<span class="muted">–</span>'}</td>
        <td class="num strong">${fmt(c.gpa)}</td></tr>`;
    }
    root.querySelector('.terms').innerHTML = `<table>
      <thead><tr><th>Kỳ</th><th>Học kỳ</th><th class="num">Tín chỉ</th><th class="num">GPA thật</th>
      <th class="num">Với điểm thử</th><th class="num">Tích luỹ</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
  }

  function renderChart() {
    const data = [];
    const cum = [];
    for (const [term, list] of gpaTerms()) {
      cum.push(...list);
      const a = calc(list, false).gpa;
      const p = calc(list, true).gpa;
      data.push({ term, a, p, c: calc(cum, true).gpa });
    }
    const vals = data.flatMap((d) => [d.p, d.c]).filter((v) => v != null);
    if (!vals.length) {
      root.querySelector('.chart').innerHTML = '<div class="empty">Chưa có dữ liệu điểm</div>';
      return;
    }
    const W = 900, H = 220, L = 30, R = 10, T = 20, B = 26;
    const yMin = Math.max(0, Math.floor(Math.min(...vals)) - 1), yMax = 10;
    const y = (v) => T + (H - T - B) * (1 - (v - yMin) / (yMax - yMin));
    const step = (W - L - R) / data.length;
    const bw = Math.min(44, step * 0.55);
    let grid = '';
    for (let v = yMin; v <= yMax; v++) {
      grid += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 8}" y="${y(v) + 3}" text-anchor="end">${v}</text>`;
    }
    let bars = '', pts = [];
    data.forEach((d, i) => {
      const cx = L + step * i + step / 2;
      if (d.p != null) {
        const isPred = d.a == null || Math.abs(d.p - d.a) > 1e-9;
        bars += `<rect class="bar ${isPred ? 'pred' : ''}" x="${cx - bw / 2}" y="${y(d.p)}" width="${bw}" height="${y(yMin) - y(d.p)}" rx="5"/>
          <text class="bar-val" x="${cx}" y="${y(d.p) - 5}" text-anchor="middle">${fmt(d.p)}</text>`;
      }
      bars += `<text class="xlab" x="${cx}" y="${H - 8}" text-anchor="middle">K${esc(d.term)}</text>`;
      if (d.c != null) pts.push([cx, y(d.c)]);
    });
    const line = pts.length > 1 ? `<polyline class="cum" points="${pts.map((p) => p.join(',')).join(' ')}"/>` : '';
    const dots = pts.map(([px, py]) => `<circle class="cum-dot" cx="${px}" cy="${py}" r="3.5"/>`).join('');
    root.querySelector('.chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Biểu đồ GPA theo kỳ">
      <g class="grid">${grid}</g>${bars}${line}${dots}</svg>`;
  }

  function renderTermHeads() {
    for (const [term, list] of termGroups()) {
      const el = root.querySelector(`.term-gpa[data-term="${CSS.escape(term)}"]`);
      if (!el) continue;
      const p = calc(list, true);
      const credits = list.filter(isIncluded).reduce((x, s) => x + s.credit, 0);
      el.innerHTML = credits ? `GPA <b>${fmt(p.gpa)}</b> · ${credits} TC` : 'Không tính GPA';
    }
  }

  const FILTERS = [
    ['all', 'Tất cả', () => true],
    ['pending', 'Chưa có điểm', (s) => isIncluded(s) && s.grade == null],
    ['edited', 'Đã sửa điểm', (s) => state.overrides[s.key] != null],
    ['off', 'Không tính GPA', (s) => !isIncluded(s)],
  ];

  function renderFilters() {
    root.querySelector('.filters').innerHTML = FILTERS.map(
      ([id, label, fn]) =>
        `<button class="chip ${state.filter === id ? 'active' : ''}" data-filter="${id}">${label}<span class="count">${
          subjects.filter(fn).length
        }</span></button>`
    ).join('');
  }

  function renderSticky(actual, pred) {
    const edited = Object.keys(state.overrides).length;
    let delta = '';
    if (pred.gpa != null && actual.gpa != null && Math.abs(pred.gpa - actual.gpa) >= 0.005) {
      const d = pred.gpa - actual.gpa;
      delta = `<span class="${d > 0 ? 'd-up' : 'd-down'}">${d > 0 ? '▲' : '▼'} ${fmt(Math.abs(d))}</span>`;
    }
    root.querySelector('.sticky').innerHTML = `
      <span>GPA dự tính</span> <b>${fmt(pred.gpa)}</b> ${delta}
      <span class="sep">|</span><span>${pred.cr} TC có điểm${pred.pending ? ` · còn ${pred.pending} TC trống` : ''}</span>
      ${edited ? `<span class="sep">|</span><span>${edited} điểm thử</span>` : ''}`;
  }

  function subjectRow(s) {
    const inc = isIncluded(s);
    const ovr = state.overrides[s.key];
    const tags = [];
    if (s.reason) tags.push(`<span class="tag">${esc(s.reason)}</span>`);
    if (/đang học/i.test(s.status)) tags.push('<span class="tag info">Đang học</span>');
    else if (!s.status || s.status === '-') tags.push('<span class="tag">Chưa học</span>');
    else if (/không đạt|fail/i.test(s.status)) tags.push(`<span class="tag warn">${esc(s.status)}</span>`);
    return `<div class="subj ${inc ? '' : 'off'} ${ovr != null ? 'ovr' : ''}" data-key="${esc(s.key)}">
      <label class="switch" title="${inc ? 'Đang tính vào GPA' : 'Không tính vào GPA'}"><input type="checkbox" class="inc" ${inc ? 'checked' : ''}><span></span></label>
      <div class="info"><div class="code">${esc(s.code)}${tags.join('')}</div><div class="name" title="${esc(s.name)}">${esc(s.name)}</div></div>
      <div class="cr">${s.credit} TC</div>
      <div class="real">${s.grade == null ? '<span class="muted">–</span>' : `<span class="grade ${gradeClass(s.grade)}">${esc(fmtGrade(s.grade))}</span>`}</div>
      <div class="try">
        <input class="g" inputmode="decimal" placeholder="${s.grade == null ? 'Nhập' : esc(fmtGrade(s.grade))}" value="${ovr != null ? esc(fmtGrade(ovr)) : ''}" aria-label="Điểm thử ${esc(s.code)}">
        <button class="clr" data-act="clear" title="Bỏ điểm thử">×</button>
      </div>
    </div>`;
  }

  function renderList() {
    const fn = FILTERS.find((f) => f[0] === state.filter)?.[2] || (() => true);
    const q = query.trim().toLowerCase();
    const visible = subjects.filter((s) => fn(s) && (!q || s.code.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)));
    const html = termGroups(visible)
      .map(
        ([term, list]) => `<section class="term">
          <div class="term-head"><span class="term-name">${termLabel(term)}</span>
            <span class="term-sem">${esc(semestersOf(list))}</span><span class="term-gpa" data-term="${esc(term)}"></span></div>
          ${list.map(subjectRow).join('')}
        </section>`
      )
      .join('');
    root.querySelector('.list').innerHTML = html || '<div class="empty">Không có môn nào khớp bộ lọc</div>';
    renderTermHeads();
  }

  // ---------- events ----------
  function setTarget(v) {
    state.target = v;
    saveState();
    renderTarget(calc(subjects, true));
  }

  function bindEvents() {
    root.addEventListener('input', (e) => {
      const t = e.target;
      if (t.classList.contains('target')) return setTarget(t.value.trim());
      if (t.classList.contains('search')) {
        query = t.value;
        return renderList();
      }
      if (t.classList.contains('fillv')) {
        state.fill = t.value.trim();
        return saveState();
      }
      if (!t.classList.contains('g')) return;
      const row = t.closest('.subj');
      const key = row.dataset.key;
      const raw = t.value.trim();
      const v = parseNum(raw);
      if (raw === '') delete state.overrides[key];
      else if (v == null || v > 10) return t.classList.add('invalid');
      else state.overrides[key] = v;
      t.classList.remove('invalid');
      row.classList.toggle('ovr', state.overrides[key] != null);
      saveState();
      renderSummary();
    });

    root.addEventListener('change', (e) => {
      const t = e.target;
      if (!t.classList.contains('inc')) return;
      const row = t.closest('.subj');
      const s = subjects.find((x) => x.key === row.dataset.key);
      if (t.checked === s.defaultInclude) delete state.include[s.key];
      else state.include[s.key] = t.checked;
      row.classList.toggle('off', !t.checked);
      t.closest('.switch').title = t.checked ? 'Đang tính vào GPA' : 'Không tính vào GPA';
      saveState();
      renderSummary();
    });

    root.addEventListener('keydown', (e) => {
      // Enter / mũi tên lên-xuống để nhảy giữa các ô điểm thử
      if (!e.target.classList.contains('g') || !['Enter', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
      e.preventDefault();
      const inputs = [...root.querySelectorAll('.g')];
      const i = inputs.indexOf(e.target) + (e.key === 'ArrowUp' ? -1 : 1);
      if (inputs[i]) {
        inputs[i].focus();
        inputs[i].select();
      }
    });

    root.addEventListener('click', (e) => {
      const el = e.target.closest('button');
      if (!el) return;
      if (el.dataset.tab) {
        state.tab = el.dataset.tab;
        applyTab();
        return saveState();
      }
      if (el.dataset.filter) {
        state.filter = el.dataset.filter;
        saveState();
        renderFilters();
        return renderList();
      }
      if (el.dataset.target) {
        root.querySelector('.target').value = el.dataset.target.replace('.', ',');
        return setTarget(el.dataset.target);
      }
      const act = el.dataset.act;
      if (act === 'toggle') {
        state.collapsed = !state.collapsed;
        applyCollapsed();
        saveState();
      } else if (act === 'clear') {
        const row = el.closest('.subj');
        delete state.overrides[row.dataset.key];
        row.classList.remove('ovr');
        const inp = row.querySelector('.g');
        inp.value = '';
        inp.classList.remove('invalid');
        saveState();
        renderSummary();
      } else if (act === 'reset') {
        if (!Object.keys(state.overrides).length) return;
        if (!confirm('Xoá toàn bộ điểm thử và quay về điểm thật?')) return;
        state.overrides = {};
        saveState();
        renderList();
        renderSummary();
      } else if (act === 'fill') {
        const inp = root.querySelector('.fillv');
        const v = parseNum(inp.value);
        if (v == null || v > 10) {
          inp.classList.add('invalid');
          return inp.focus();
        }
        inp.classList.remove('invalid');
        for (const s of subjects) {
          if (isIncluded(s) && s.grade == null && state.overrides[s.key] == null) state.overrides[s.key] = v;
        }
        saveState();
        renderList();
        renderSummary();
      }
    });
  }

  // ---------- boot ----------
  async function init(main, outside) {
    const seen = {};
    subjects = parseTable(main, false, seen).concat(outside ? parseTable(outside, true, seen) : []);
    if (!subjects.length) return;
    await loadState();

    const host = document.createElement('div');
    host.id = 'fap-gpa-calculator';
    const anchor = main.closest('.card') || main;
    anchor.parentNode.insertBefore(host, anchor);
    root = host.attachShadow({ mode: 'open' });
    // FAP chặn thẻ <style> inline bằng CSP, nên nạp CSS qua constructable stylesheet
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(STYLE);
    root.adoptedStyleSheets = [sheet];
    bindEvents();
    renderShell();

    new MutationObserver(applyTheme).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-bs-theme', 'data-theme'],
    });
  }

  function waitForTable() {
    const start = () => {
      const { main, outside } = findTables();
      if (!main) return false;
      init(main, outside);
      return true;
    };
    if (start()) return;
    const obs = new MutationObserver(() => start() && obs.disconnect());
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => obs.disconnect(), 20000);
  }

  waitForTable();
})();
