(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) {
    root.PhonePKDashboard = api;
    const start = function () { api.mount(root); };
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const METRICS = [
    { key: 'oa_dial', label: 'OA拨打次数 / 在班', short: 'OA拨打' },
    { key: 'oa_connect', label: 'OA接通次数 / 在班', short: 'OA接通' },
    { key: 'wecom_dial', label: '企微拨打次数 / 在班', short: '企微拨打' },
    { key: 'wecom_connect', label: '企微接通次数 / 在班', short: '企微接通' }
  ];
  const GRADES = ['1年级', '2年级', '3年级', '4年级', '5年级'];
  const escapeHTML = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const numeric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  // Match Python Decimal(str(value)).quantize(Decimal('0.1'), ROUND_HALF_UP).
  // Round the decimal text, so values such as 1.15 do not inherit toFixed's binary tie behavior.
  function fixedOne(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    const [mantissa, exponentText = '0'] = Math.abs(value).toString().toLowerCase().split('e');
    const [integer, fraction = ''] = mantissa.split('.');
    const shift = Number(exponentText) - fraction.length + 1;
    let tenths = BigInt(integer + fraction);
    if (shift >= 0) tenths *= 10n ** BigInt(shift);
    else {
      const divisor = 10n ** BigInt(-shift);
      tenths = tenths / divisor + (tenths % divisor * 2n >= divisor ? 1n : 0n);
    }
    const digits = tenths.toString().padStart(2, '0');
    return (value < 0 && tenths !== 0n ? '-' : '') + digits.slice(0, -1) + '.' + digits.slice(-1);
  }
  const percent = value => fixedOne(value) == null ? '—' : fixedOne(value) + '%';
  function gap(value) {
    const rounded = fixedOne(value);
    return rounded == null ? '—' : (value > 0 && rounded !== '0.0' ? '+' : '') + rounded + 'pp';
  }

  function sum(rows, field) {
    if (!rows.length || rows.some(row => !numeric(row[field]))) return null;
    return rows.reduce((value, row) => value + row[field], 0);
  }

  function aggregate(rows, mode) {
    const enrollment = sum(rows, 'enrollment');
    const counts = {}, rates = {};
    METRICS.forEach(metric => {
      counts[metric.key] = sum(rows, (mode === 'today' ? 'today_' : '') + metric.key);
      rates[metric.key] = enrollment > 0 && counts[metric.key] != null ? counts[metric.key] / enrollment * 100 : null;
    });
    return { rows: rows.length, enrollment, counts, rates };
  }

  function groups(rows, mode) {
    return {
      business: aggregate(rows.filter(row => row.team_key === 'shi' || row.team_key === 'cui'), mode),
      peer: aggregate(rows.filter(row => row.team_key === 'peer'), mode),
      shi: aggregate(rows.filter(row => row.team_key === 'shi'), mode),
      cui: aggregate(rows.filter(row => row.team_key === 'cui'), mode)
    };
  }

  function compare(snapshot, period, mode) {
    mode = mode === 'today' ? 'today' : 'cumulative';
    const rows = (snapshot.records || []).filter(row => row.period === period && GRADES.includes(row.grade));
    const totals = groups(rows, mode), grades = {};
    GRADES.forEach(grade => { grades[grade] = groups(rows.filter(row => row.grade === grade), mode); });
    return { period, mode, totals, grades, rowCount: rows.length };
  }

  function periods(snapshot) {
    const available = new Set((snapshot.records || []).map(row => row.period).filter(Boolean));
    const order = Array.from(new Set([...(snapshot.period_order || []), ...available])).filter(period => available.has(period));
    const unknown = Array.isArray(snapshot.schedule_unknown) ? snapshot.schedule_unknown : [];
    const active = Array.isArray(snapshot.active_periods) ? snapshot.active_periods.filter(period => available.has(period) && !unknown.includes(period)) : [];
    return { order, active, known: snapshot.schedule_resolved === true };
  }

  function periodStage(snapshot, period) {
    const selection = periods(snapshot);
    const explicitlyUnknown = Array.isArray(snapshot.schedule_unknown) && snapshot.schedule_unknown.includes(period);
    if (explicitlyUnknown) return { active: false, known: false, label: '阶段待确认' };
    if (selection.active.includes(period)) {
      const day = (snapshot.active_stages || {})[period];
      const phase = Number.isInteger(day) && day >= 1 && day <= 13 ? ` · ${day <= 7 ? '课前' : day <= 12 ? '课中' : '课后'} D${day}` : '';
      return { active: true, known: true, label: '进行中' + phase };
    }
    return { active: false, known: selection.known, label: selection.known ? '非进行期次' : '阶段待确认' };
  }

  function validateSnapshot(snapshot) {
    if (!snapshot || snapshot.schema_version !== 1 || !Array.isArray(snapshot.records)) return '电话数据尚未更新，请先导入D表。';
    if (!snapshot.records.length) return 'D表暂无可用电话记录。';
    if (snapshot.records.some(row => !['shi', 'cui', 'peer'].includes(row.team_key) || !GRADES.includes(row.grade) || !row.period)) return '电话数据格式有误，请重新导入D表。';
    return '';
  }

  function gradeCell(group) {
    if (!group.rows) return '<span class="pp-no-data">—</span>';
    return `<div class="pp-contact-cell"><div><span class="pp-medium">OA</span><span>拨 <b>${percent(group.rates.oa_dial)}</b></span><span>接 <b>${percent(group.rates.oa_connect)}</b></span></div>
      <div><span class="pp-medium">企微</span><span>拨 <b>${percent(group.rates.wecom_dial)}</b></span><span>接 <b>${percent(group.rates.wecom_connect)}</b></span></div></div>`;
  }

  function content(snapshot, state) {
    const data = compare(snapshot, state.period, state.mode), selection = periods(snapshot);
    const status = periodStage(snapshot, state.period), active = status.active, stage = status.label;
    const sourceDate = /^\d{4}-\d{2}-\d{2}$/.test(snapshot.source_date || '') ? snapshot.source_date : '日期待确认';
    const options = selection.order.slice().reverse().map(period => `<option value="${escapeHTML(period)}"${state.period === period ? ' selected' : ''}>${escapeHTML(period)} · ${periodStage(snapshot, period).label}</option>`).join('');
    const totalRows = METRICS.map(metric => {
      const a = data.totals.business.rates[metric.key], b = data.totals.peer.rates[metric.key];
      const delta = a == null || b == null ? null : a - b;
      const deltaText = gap(delta);
      return `<tr><th scope="row">${metric.label}</th><td data-label="商务组" class="pp-business-value">${percent(a)}</td><td data-label="学部组" class="pp-peer-value">${percent(b)}</td><td data-label="差值" class="${delta == null || Math.abs(delta) < .05 ? 'pp-neutral' : delta > 0 ? 'pp-positive' : 'pp-negative'}">${deltaText}</td></tr>`;
    }).join('');
    const gradeRows = GRADES.map(grade => `<tr><th scope="row">${grade}</th><td class="pp-peer-cell">${gradeCell(data.grades[grade].peer)}</td><td>${gradeCell(data.grades[grade].shi)}</td><td>${gradeCell(data.grades[grade].cui)}</td></tr>`).join('');
    return `<div class="pp-heading"><div><h1>电话拨打对比</h1><p class="pp-source-date">数据日期 ${escapeHTML(sourceDate)} <span class="pp-stage ${active ? 'pp-stage-active' : ''}">${stage}</span></p></div>
      <div class="pp-controls"><label for="phonePkPeriod">期次<select id="phonePkPeriod">${options}</select></label><div><span class="pp-control-label">统计口径</span><div class="pp-mode" role="group" aria-label="统计口径"><button type="button" data-phone-mode="cumulative" aria-pressed="${state.mode === 'cumulative'}">累计</button><button type="button" data-phone-mode="today" aria-pressed="${state.mode === 'today'}">当日</button></div></div></div></div>
      <section class="pp-panel"><h2>总计</h2><div class="pp-table-scroll"><table class="pp-total-table"><thead><tr><th scope="col">指标</th><th scope="col" class="pp-business-header">商务组</th><th scope="col" class="pp-peer-header">学部组</th><th scope="col" title="商务组 − 学部组">差值（pp）</th></tr></thead><tbody>${totalRows}</tbody></table></div></section>
      <section class="pp-panel"><h2>分年级</h2><p class="pp-mobile-hint">左右滑动查看完整表格</p><div class="pp-table-scroll" tabindex="0" aria-label="分年级电话明细，可横向滚动"><table class="pp-grade-table"><thead><tr><th scope="col">年级</th><th scope="col" class="pp-peer-header">学部组</th><th scope="col" class="pp-business-header">商务组 · 史春晶</th><th scope="col" class="pp-business-header">商务组 · 崔国锋</th></tr></thead><tbody>${gradeRows}<tr class="pp-total-row"><th scope="row">总计</th><td class="pp-peer-cell">${gradeCell(data.totals.peer)}</td><td>${gradeCell(data.totals.shi)}</td><td>${gradeCell(data.totals.cui)}</td></tr></tbody></table></div></section>`;
  }

  function mount(win) {
    if (win.__phonePkMounted) return;
    const doc = win.document, bar = doc.getElementById('tabBar');
    if (!bar || typeof win.switchTab !== 'function' || typeof win.renderAll !== 'function') return;
    win.__phonePkMounted = true;
    const button = doc.createElement('button');
    button.type = 'button'; button.id = 'phonePkTab'; button.className = 'tab-btn'; button.textContent = '电话拨打对比';
    button.setAttribute('onclick', "switchTab('phonepk')");
    const reference = Array.from(bar.querySelectorAll('button')).find(node => (node.getAttribute('onclick') || '').includes("'fullfunnel'"));
    if (reference) reference.after(button); else bar.appendChild(button);
    const panel = doc.createElement('section');
    panel.id = 'tabPhonePk'; panel.className = 'tab-content phone-pk'; panel.setAttribute('aria-label', '电话拨打对比');
    bar.after(panel);
    let active = false;
    const selection = periods(win.PHONE_PK_DATA || {});
    const state = { period: selection.active[selection.active.length - 1] || selection.order[selection.order.length - 1] || '', mode: 'cumulative' };
    const oldSwitch = win.switchTab, oldRender = win.renderAll;

    function render() {
      const snapshot = win.PHONE_PK_DATA;
      const error = validateSnapshot(snapshot);
      panel.innerHTML = error ? `<div class="pp-empty"><h1>电话拨打对比</h1><p>${escapeHTML(error)}</p></div>` : content(snapshot, state);
      const select = panel.querySelector('#phonePkPeriod');
      if (select) select.addEventListener('change', function () { state.period = this.value; render(); });
      panel.querySelectorAll('[data-phone-mode]').forEach(node => node.addEventListener('click', function () { state.mode = this.dataset.phoneMode; render(); }));
    }

    win.renderAll = function () { if (active) { render(); return; } return oldRender.apply(this, arguments); };
    win.switchTab = function (name) {
      active = name === 'phonepk';
      doc.body.classList.toggle('phone-pk-active', active);
      const result = oldSwitch.apply(this, arguments);
      if (active) { panel.classList.add('active'); button.classList.add('active'); render(); }
      return result;
    };
    win.PhonePKDashboard.refresh = function () { if (active) render(); };
    if (win.location.hash === '#phone-pk' || win.location.hash === '#phonepk') win.switchTab('phonepk');
  }

  return { METRICS, GRADES, aggregate, compare, periods, periodStage, fixedOne, percent, gap, validateSnapshot, content, mount };
});
