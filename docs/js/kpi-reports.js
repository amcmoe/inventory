import { supabase, requireConfig } from './supabase-client.js';
import { getSession, getCurrentProfile, requireAuth, signOut, ensureSessionFresh } from './auth.js';
import { qs, toast, setRoleVisibility, initTheme, bindThemeToggle, bindSignOut, initAdminNav, initConnectionBadgeMonitor, loadSiteBrandingFromServer } from './ui.js';

const topbar = qs('#kpiReportsTopbar');
const nav = qs('#kpiReportsNav');
const loadingPanel = qs('#kpiReportsLoadingPanel');
const mainSection = qs('#kpiReportsMainSection');

const kpiTotal = qs('#kpiTotal');
const kpiAssigned = qs('#kpiAssigned');
const kpiAvailable = qs('#kpiAvailable');
const kpiAttention = qs('#kpiAttention');
const lifecycleAvgAge = qs('#lifecycleAvgAge');
const lifecycleRefreshSoon = qs('#lifecycleRefreshSoon');
const lifecycleRefreshOverdue = qs('#lifecycleRefreshOverdue');
const lifecycleMissingDate = qs('#lifecycleMissingDate');
const lifecycleBarChart = qs('#lifecycleBarChart');
const lifecycleDonut = qs('#lifecycleDonut');
const lifecycleDonutTotal = qs('#lifecycleDonutTotal');
const lifecycleLegend = qs('#lifecycleLegend');
const damageRateKpi = qs('#damageRateKpi');
const damageRateHint = qs('#damageRateHint');
const damageReportsKpi = qs('#damageReportsKpi');
const damageReportsHint = qs('#damageReportsHint');
const damageRecent30Kpi = qs('#damageRecent30Kpi');
const damageRecentKpi = qs('#damageRecentKpi');
const damagePerAssetKpi = qs('#damagePerAssetKpi');
const damageTrendChart = qs('#damageTrendChart');
const damageBuildingRateChart = qs('#damageBuildingRateChart');
const warrantyExpiryBand = qs('#warrantyExpiryBand');
const warrantyBuildingList = qs('#warrantyBuildingList');
const churn90Count = qs('#churn90Count');
const churnRepeatAssets = qs('#churnRepeatAssets');
const churnMonthlySpark = qs('#churnMonthlySpark');
const churnTopAssets = qs('#churnTopAssets');
const damageByUserBars = qs('#damageByUserBars');
const damageBySerialBars = qs('#damageBySerialBars');
const utilAssignedPct = qs('#utilAssignedPct');
const utilAvailablePct = qs('#utilAvailablePct');
const utilIdle60 = qs('#utilIdle60');
const utilDonutChart = qs('#utilDonutChart');
const utilDonutMeta = qs('#utilDonutMeta');
const utilIdleAssets = qs('#utilIdleAssets');
const dqMissingCritical = qs('#dqMissingCritical');
const dqDuplicateSerials = qs('#dqDuplicateSerials');
const dqStatusMismatch = qs('#dqStatusMismatch');
const dqIssueBands = qs('#dqIssueBands');
const repairAvgDays = qs('#repairAvgDays');
const repairMedianDays = qs('#repairMedianDays');
const repairOpenIncidents = qs('#repairOpenIncidents');
const repairTurnaroundSpark = qs('#repairTurnaroundSpark');
const repairRecentList = qs('#repairRecentList');

let stopConnectionBadgeMonitor = null;
let cachedAssets = [];
let cachedDamageReports = [];
let cachedTransactions = [];
let cachedAssetCurrent = [];
let utilDonutChartInstance = null;
let lifecycleDonutAnimFrame = 0;

function isLaptopAsset(asset) {
  const type = normalizeText(asset?.equipment_type).toLowerCase();
  const model = normalizeText(asset?.model).toLowerCase();
  if (type.includes('laptop') || type.includes('notebook') || type.includes('chromebook')) return true;
  if (!type && /(laptop|notebook|chromebook|thinkpad|latitude|elitebook|macbook)/.test(model)) return true;
  return false;
}

function updateSummaryKpis(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const total = list.length;
  const assigned = list.filter((r) => String(r.status || '').toLowerCase() === 'checked_out').length;
  const available = list.filter((r) => String(r.status || '').toLowerCase() === 'available').length;
  const attention = list.filter((r) => {
    const s = String(r.status || '').toLowerCase();
    return s === 'repair' || s === 'retired' || s === 'maintenance';
  }).length;

  if (kpiTotal) kpiTotal.textContent = total.toLocaleString();
  if (kpiAssigned) kpiAssigned.textContent = assigned.toLocaleString();
  if (kpiAvailable) kpiAvailable.textContent = available.toLocaleString();
  if (kpiAttention) kpiAttention.textContent = attention.toLocaleString();
}

function yearsInService(value) {
  if (!value) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  const ms = Date.now() - dt.getTime();
  if (ms < 0) return 0;
  return ms / (365.25 * 24 * 60 * 60 * 1000);
}

function renderLifecycleCharts(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const ages = [];
  let missingDates = 0;

  const barBuckets = [
    { label: '<1y', min: 0, max: 1, count: 0 },
    { label: '1-2y', min: 1, max: 2, count: 0 },
    { label: '2-3y', min: 2, max: 3, count: 0 },
    { label: '3-4y', min: 3, max: 4, count: 0 },
    { label: '4-5y', min: 4, max: 5, count: 0 },
    { label: '5-6y', min: 5, max: 6, count: 0 },
    { label: '6y+', min: 6, max: Number.POSITIVE_INFINITY, count: 0 }
  ];
  const segmentBuckets = [
    { key: 'new', label: 'New (<2y)', min: 0, max: 2, color: '#4f86f7', count: 0 },
    { key: 'mid', label: 'Standard (2-4y)', min: 2, max: 4, color: '#1f9d8a', count: 0 },
    { key: 'aging', label: 'Aging (4-6y)', min: 4, max: 6, color: '#e59f3a', count: 0 },
    { key: 'overdue', label: 'Refresh Due (6y+)', min: 6, max: Number.POSITIVE_INFINITY, color: '#d55a4f', count: 0 }
  ];

  list.forEach((row) => {
    const age = yearsInService(row?.service_start_date);
    if (age == null) {
      missingDates += 1;
      return;
    }
    ages.push(age);
    const bar = barBuckets.find((b) => age >= b.min && age < b.max);
    if (bar) bar.count += 1;
    const seg = segmentBuckets.find((s) => age >= s.min && age < s.max);
    if (seg) seg.count += 1;
  });

  const datedTotal = ages.length;
  const avgAge = datedTotal ? (ages.reduce((sum, v) => sum + v, 0) / datedTotal) : 0;
  const refreshSoon = ages.filter((v) => v >= 4).length;
  const refreshOverdue = ages.filter((v) => v >= 6).length;
  const maxBar = Math.max(1, ...barBuckets.map((b) => b.count));

  if (lifecycleAvgAge) lifecycleAvgAge.textContent = `${avgAge.toFixed(1)}y`;
  if (lifecycleRefreshSoon) lifecycleRefreshSoon.textContent = refreshSoon.toLocaleString();
  if (lifecycleRefreshOverdue) lifecycleRefreshOverdue.textContent = refreshOverdue.toLocaleString();
  if (lifecycleMissingDate) lifecycleMissingDate.textContent = missingDates.toLocaleString();

  if (lifecycleBarChart) {
    lifecycleBarChart.innerHTML = barBuckets.map((bucket) => {
      const h = (bucket.count / maxBar) * 100;
      return `
        <div class="lifecycle-bar-col">
          <div class="lifecycle-bar-value">${bucket.count.toLocaleString()}</div>
          <div class="lifecycle-bar-track">
            <div class="lifecycle-bar-fill" style="height:${h.toFixed(1)}%"></div>
          </div>
          <div class="lifecycle-bar-label">${bucket.label}</div>
        </div>
      `;
    }).join('');
    animateFillDimension(lifecycleBarChart, '.lifecycle-bar-fill', 'height', { duration: 980, stagger: 55 });
  }

  const totalSegment = segmentBuckets.reduce((sum, b) => sum + b.count, 0);
  animateLifecycleDonut(segmentBuckets, totalSegment, datedTotal);
  if (lifecycleLegend) {
    lifecycleLegend.innerHTML = segmentBuckets.map((bucket) => {
      const pct = totalSegment ? Math.round((bucket.count / totalSegment) * 100) : 0;
      return `
        <div class="lifecycle-legend-item">
          <span class="lifecycle-legend-dot" style="background:${bucket.color}"></span>
          <span>${bucket.label}</span>
          <strong>${bucket.count.toLocaleString()} (${pct}%)</strong>
        </div>
      `;
    }).join('');
  }
}

function normalizeText(value) {
  return String(value || '').trim();
}

function pct(value, total) {
  if (!total) return 0;
  return (value / total) * 100;
}

function monthKey(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function monthLabel(dateObj) {
  return dateObj.toLocaleDateString(undefined, { month: 'short' });
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDays(value) {
  return `${Number(value || 0).toFixed(1)}d`;
}

function safeDate(value) {
  const dt = new Date(value || '');
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function textOrDash(value) {
  return String(value || '').trim() || '-';
}

function serialForAsset(asset) {
  return textOrDash(asset?.serial || asset?.asset_tag);
}

function prefersReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function animateFillDimension(container, selector, dimension, {
  duration = 860,
  stagger = 45,
  delay = 0,
  easing = 'cubic-bezier(0.22, 1, 0.36, 1)'
} = {}) {
  if (!container) return;
  const nodes = Array.from(container.querySelectorAll(selector));
  if (!nodes.length) return;
  const reduceMotion = prefersReducedMotion();
  nodes.forEach((node, index) => {
    const target = String(node.style?.[dimension] || '').trim();
    if (!target) return;
    if (reduceMotion) {
      node.style[dimension] = target;
      return;
    }
    const startDelay = delay + Math.min(index * stagger, 380);
    node.style.transition = 'none';
    node.style[dimension] = '0%';
    // Force initial style commit before transition.
    void node.offsetHeight;
    node.style.transition = `${dimension} ${duration}ms ${easing} ${startDelay}ms`;
    requestAnimationFrame(() => {
      node.style[dimension] = target;
    });
  });
}

function buildLifecycleDonutGradient(segmentBuckets, total, progress = 1) {
  const safeTotal = Math.max(total, 1);
  const clamped = Math.max(0, Math.min(1, Number(progress) || 0));
  let start = 0;
  const slices = [];
  segmentBuckets.forEach((bucket) => {
    const pct = ((Number(bucket?.count || 0) * clamped) / safeTotal) * 100;
    const end = start + pct;
    slices.push(`${bucket.color} ${start.toFixed(2)}% ${end.toFixed(2)}%`);
    start = end;
  });
  if (start < 100) {
    slices.push(`rgba(125, 140, 165, 0.18) ${start.toFixed(2)}% 100%`);
  }
  return `conic-gradient(${slices.join(', ')})`;
}

function animateLifecycleDonut(segmentBuckets, totalSegment, datedTotal) {
  if (!lifecycleDonut) return;
  if (lifecycleDonutAnimFrame) {
    cancelAnimationFrame(lifecycleDonutAnimFrame);
    lifecycleDonutAnimFrame = 0;
  }

  const finalTotal = Number(datedTotal || 0);
  const reduceMotion = prefersReducedMotion();
  if (reduceMotion || typeof performance === 'undefined') {
    lifecycleDonut.style.background = buildLifecycleDonutGradient(segmentBuckets, totalSegment, 1);
    if (lifecycleDonutTotal) lifecycleDonutTotal.textContent = finalTotal.toLocaleString();
    return;
  }

  const startedAt = performance.now();
  const duration = 1050;
  const tick = (now) => {
    const t = Math.min((now - startedAt) / duration, 1);
    const eased = 1 - ((1 - t) ** 3);
    lifecycleDonut.style.background = buildLifecycleDonutGradient(segmentBuckets, totalSegment, eased);
    if (lifecycleDonutTotal) {
      lifecycleDonutTotal.textContent = Math.round(finalTotal * eased).toLocaleString();
    }
    if (t < 1) {
      lifecycleDonutAnimFrame = requestAnimationFrame(tick);
      return;
    }
    lifecycleDonutAnimFrame = 0;
    if (lifecycleDonutTotal) lifecycleDonutTotal.textContent = finalTotal.toLocaleString();
  };
  lifecycleDonut.style.background = buildLifecycleDonutGradient(segmentBuckets, totalSegment, 0);
  lifecycleDonutAnimFrame = requestAnimationFrame(tick);
}

function animateLineTrendSvg(container) {
  if (!container) return;
  const line = container.querySelector('.trend-line');
  const area = container.querySelector('.trend-area');
  if (!line || typeof line.getTotalLength !== 'function') return;
  if (prefersReducedMotion()) {
    line.style.strokeDasharray = '';
    line.style.strokeDashoffset = '0';
    if (area) {
      area.style.opacity = '1';
      area.style.transform = 'none';
    }
    return;
  }
  const length = line.getTotalLength();
  line.style.strokeDasharray = `${length.toFixed(1)}`;
  line.style.strokeDashoffset = `${length.toFixed(1)}`;
  line.style.transition = 'stroke-dashoffset 960ms cubic-bezier(0.22, 1, 0.36, 1) 80ms';
  if (area) {
    area.style.opacity = '0';
    area.style.transformOrigin = '50% 100%';
    area.style.transformBox = 'fill-box';
    area.style.transform = 'scaleY(0.15)';
    area.style.transition = 'transform 860ms cubic-bezier(0.22, 1, 0.36, 1) 120ms, opacity 620ms ease 120ms';
  }
  requestAnimationFrame(() => {
    line.style.strokeDashoffset = '0';
    if (area) {
      area.style.opacity = '1';
      area.style.transform = 'scaleY(1)';
    }
  });
}

function renderMiniBars(container, items, valueKey = 'value') {
  if (!container) return;
  const list = Array.isArray(items) ? items : [];
  if (!list.length) {
    container.innerHTML = '<div class="muted">No data available.</div>';
    return;
  }
  const max = Math.max(1, ...list.map((item) => Number(item?.[valueKey] || 0)));
  container.innerHTML = list.map((item, idx) => {
    const value = Number(item?.[valueKey] || 0);
    const width = (value / max) * 100;
    const labelHtml = item?.href
      ? `<a class="mini-bar-link" href="${escapeHtml(item.href)}">${escapeHtml(item.label || '-')}</a>`
      : `<span>${escapeHtml(item.label || '-')}</span>`;
    return `
      <div class="mini-bar-row anim-item" style="--a:${Math.min(idx * 55, 500)}ms">
        <div class="mini-bar-top">
          ${labelHtml}
          <strong>${escapeHtml(String(item.display ?? value))}</strong>
        </div>
        <div class="mini-bar-track"><div class="mini-bar-fill" style="width:${width.toFixed(1)}%"></div></div>
      </div>
    `;
  }).join('');
  animateFillDimension(container, '.mini-bar-fill', 'width', { duration: 820, stagger: 50 });
}

function renderSparkBars(container, points) {
  if (!container) return;
  const list = Array.isArray(points) ? points : [];
  if (!list.length) {
    container.innerHTML = '<div class="muted">No data available.</div>';
    return;
  }
  const max = Math.max(1, ...list.map((p) => Number(p?.value || 0)));
  container.innerHTML = list.map((p, idx) => {
    const h = (Number(p?.value || 0) / max) * 100;
    return `
      <div class="spark-col anim-item" style="--a:${Math.min(idx * 45, 500)}ms">
        <div class="spark-value">${Number(p?.value || 0)}</div>
        <div class="spark-track"><div class="spark-fill" style="height:${h.toFixed(1)}%"></div></div>
        <div class="spark-label">${escapeHtml(p?.label || '-')}</div>
      </div>
    `;
  }).join('');
  animateFillDimension(container, '.spark-fill', 'height', { duration: 820, stagger: 42 });
}

function renderDotMatrix(container, rows) {
  if (!container) return;
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    container.innerHTML = '<div class="muted">No hotspot data available.</div>';
    return;
  }
  container.innerHTML = list.map((row, idx) => {
    const dots = Math.min(12, Math.max(1, Number(row.count || 0)));
    const dotsHtml = new Array(dots).fill(0).map((_, idx) => `<span class="dot dot-${(idx % 6) + 1}"></span>`).join('');
    return `
      <div class="dot-row anim-item" style="--a:${Math.min(idx * 45, 500)}ms">
        <div class="dot-row-label">${escapeHtml(row.label || '-')}</div>
        <div class="dot-row-dots">${dotsHtml}</div>
        <div class="dot-row-value">${Number(row.count || 0)}</div>
      </div>
    `;
  }).join('');
}

function renderInsightList(container, rows, emptyText = 'No items') {
  if (!container) return;
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    container.innerHTML = `<div class="muted">${escapeHtml(emptyText)}</div>`;
    return;
  }
  container.innerHTML = list.map((row, idx) => `
    <div class="insight-item anim-item" style="--a:${Math.min(idx * 45, 500)}ms">
      <div class="insight-main">${
        row?.mainHref
          ? `<a class="insight-main-link" href="${escapeHtml(row.mainHref)}">${escapeHtml(row.main || '-')}</a>`
          : escapeHtml(row.main || '-')
      }</div>
      <div class="insight-sub">${escapeHtml(row.sub || '')}</div>
      <div class="insight-value">${escapeHtml(row.value || '')}</div>
    </div>
  `).join('');
}

function renderRankTable(container, headers, rows, emptyText = 'No rows') {
  if (!container) return;
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    container.innerHTML = `<div class="muted">${escapeHtml(emptyText)}</div>`;
    return;
  }
  const headHtml = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
  const bodyHtml = list.map((row, idx) => `
    <tr class="anim-item" style="--a:${Math.min(idx * 45, 500)}ms">
      ${row.map((cell) => `<td>${escapeHtml(String(cell ?? ''))}</td>`).join('')}
    </tr>
  `).join('');
  container.innerHTML = `
    <table class="mini-table">
      <thead><tr>${headHtml}</tr></thead>
      <tbody>${bodyHtml}</tbody>
    </table>
  `;
}

function renderBubbleCloud(container, rows, emptyText = 'No hotspot data available.') {
  if (!container) return;
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    container.innerHTML = `<div class="muted">${escapeHtml(emptyText)}</div>`;
    return;
  }
  const maxCount = Math.max(1, ...list.map((r) => Number(r.count || 0)));
  container.innerHTML = `
    <div class="bubble-cloud">
      ${list.map((row, idx) => {
        const size = 34 + Math.round((Number(row.count || 0) / maxCount) * 52);
        return `
          <div class="bubble anim-item" style="--a:${Math.min(idx * 40, 500)}ms;width:${size}px;height:${size}px" data-kpi-tooltip="${escapeHtml(row.label)}: ${row.count}">
            <span class="bubble-label">${escapeHtml(row.label)}</span>
            <strong>${row.count}</strong>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderRepairTimeline(container, rows, emptyText = 'No repair turnaround records.') {
  if (!container) return;
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    container.innerHTML = `<div class="muted">${escapeHtml(emptyText)}</div>`;
    return;
  }
  const closed = list.filter((r) => Number.isFinite(r?.days));
  const max = Math.max(1, ...closed.map((r) => Number(r.days || 0)));
  container.innerHTML = list.map((row, idx) => {
    const isOpen = !Number.isFinite(row?.days);
    const width = isOpen ? 100 : (Number(row.days || 0) / max) * 100;
    return `
      <div class="timeline-row anim-item" style="--a:${Math.min(idx * 45, 500)}ms">
        <div class="timeline-top">
          <span>${escapeHtml(row.label || '-')}</span>
          <strong>${isOpen ? 'Open' : formatDays(row.days)}</strong>
        </div>
        <div class="timeline-track ${isOpen ? 'is-open' : ''}">
          <div class="timeline-fill" style="width:${width.toFixed(1)}%"></div>
        </div>
      </div>
    `;
  }).join('');
  animateFillDimension(container, '.timeline-fill', 'width', { duration: 820, stagger: 45 });
}

function renderHorizontalBars(container, rows, emptyText = 'No data available.') {
  if (!container) return;
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    container.innerHTML = `<div class="muted">${escapeHtml(emptyText)}</div>`;
    return;
  }
  const max = Math.max(1, ...list.map((r) => Number(r?.value || 0)));
  container.innerHTML = `
    <div class="hbar-list">
      ${list.map((row, idx) => {
        const value = Number(row?.value || 0);
        const w = (value / max) * 100;
        return `
          <div class="hbar-row anim-item" style="--a:${Math.min(idx * 55, 500)}ms">
            <div class="hbar-top">
              <span class="hbar-label">${escapeHtml(row?.label || '-')}</span>
              <strong>${value.toLocaleString()}</strong>
            </div>
            <div class="hbar-track" data-kpi-tooltip="${escapeHtml(`${row?.label || '-'}: ${value}`)}">
              <div class="hbar-fill" style="width:${w.toFixed(1)}%"></div>
            </div>
            ${row?.sub ? `<div class="hbar-sub">${escapeHtml(String(row.sub))}</div>` : ''}
          </div>
        `;
      }).join('')}
    </div>
  `;
  animateFillDimension(container, '.hbar-fill', 'width', { duration: 880, stagger: 52 });
}

function renderLineTrend(container, points, emptyText = 'No trend data available.') {
  if (!container) return;
  const list = Array.isArray(points) ? points : [];
  if (!list.length) {
    container.innerHTML = `<div class="muted">${escapeHtml(emptyText)}</div>`;
    return;
  }
  const max = Math.max(1, ...list.map((p) => Number(p?.value || 0)));
  const width = 1000;
  const height = 196;
  const padX = 18;
  const padTop = 18;
  const padBottom = 32;
  const innerW = width - (padX * 2);
  const innerH = height - (padTop + padBottom);
  const step = list.length > 1 ? (innerW / (list.length - 1)) : 0;
  const coords = list.map((p, idx) => {
    const v = Number(p?.value || 0);
    const x = padX + (idx * step);
    const y = padTop + ((1 - (v / max)) * innerH);
    return { x, y, v, label: p?.label || '-' };
  });
  const line = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const baselineY = height - padBottom;
  const area = `${padX},${baselineY} ${line} ${padX + innerW},${baselineY}`;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((r) => padTop + ((1 - r) * innerH));

  container.innerHTML = `
    <div class="trend-line-wrap">
      <svg class="trend-line-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Assignment churn monthly trend">
        ${yTicks.map((y) => `<line x1="${padX}" y1="${y.toFixed(1)}" x2="${padX + innerW}" y2="${y.toFixed(1)}" class="trend-grid-line"></line>`).join('')}
        <line x1="${padX}" y1="${baselineY}" x2="${padX + innerW}" y2="${baselineY}" class="trend-baseline"></line>
        <polygon points="${area}" class="trend-area"></polygon>
        <polyline points="${line}" class="trend-line"></polyline>
        ${coords.map((c, idx) => `
          <g class="trend-point-group">
            <circle class="trend-hit-dot" data-kpi-tooltip="${escapeHtml(`${c.label}: ${c.v}`)}" cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="12"></circle>
            <circle class="trend-dot anim-item" style="--a:${Math.min(idx * 45, 500)}ms" cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="4.5"></circle>
          </g>
        `).join('')}
      </svg>
      <div class="trend-x-labels" style="--cols:${coords.length}">
        ${coords.map((c) => `<span>${escapeHtml(c.label)}</span>`).join('')}
      </div>
    </div>
  `;
  animateLineTrendSvg(container);
}

function initMouseFollowTooltips() {
  if (typeof document === 'undefined') return;
  let tooltip = document.getElementById('kpiMouseTooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = 'kpiMouseTooltip';
    tooltip.className = 'kpi-mouse-tooltip';
    tooltip.hidden = true;
    document.body.appendChild(tooltip);
  }

  const move = (event) => {
    const target = event.target.closest?.('[data-kpi-tooltip]');
    if (!target) {
      tooltip.hidden = true;
      return;
    }
    const text = String(target.getAttribute('data-kpi-tooltip') || '').trim();
    if (!text) {
      tooltip.hidden = true;
      return;
    }
    tooltip.textContent = text;
    tooltip.hidden = false;
    const x = event.clientX + 14;
    const y = event.clientY + 14;
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
  };
  const hide = () => {
    tooltip.hidden = true;
  };

  document.removeEventListener('pointermove', move);
  document.removeEventListener('pointerleave', hide);
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerleave', hide);
}

function renderDamageInsights() {
  const filteredAssets = cachedAssets;
  const filteredAssetIds = new Set(filteredAssets.map((a) => a.id).filter(Boolean));
  const filteredReports = cachedDamageReports.filter((row) => filteredAssetIds.has(row.asset_id));
  const assetById = new Map(filteredAssets.map((asset) => [asset.id, asset]));
  const damagedAssetIds = new Set(filteredReports.map((row) => row.asset_id).filter(Boolean));
  const damagedCount = damagedAssetIds.size;
  const totalAssets = filteredAssets.length;
  const reportsCount = filteredReports.length;
  const rate = pct(damagedCount, totalAssets);
  const perDamagedAsset = damagedCount ? (reportsCount / damagedCount) : 0;

  const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
  const recent30Reports = filteredReports.filter((row) => {
    const ts = new Date(row?.created_at || '').getTime();
    return Number.isFinite(ts) && ts >= thirtyDaysAgo;
  }).length;

  const ninetyDaysAgo = Date.now() - (90 * 24 * 60 * 60 * 1000);
  const recentReports = filteredReports.filter((row) => {
    const ts = new Date(row?.created_at || '').getTime();
    return Number.isFinite(ts) && ts >= ninetyDaysAgo;
  }).length;

  if (damageRateKpi) damageRateKpi.textContent = `${rate.toFixed(1)}%`;
  if (damageRateHint) damageRateHint.textContent = `${damagedCount.toLocaleString()} of ${totalAssets.toLocaleString()} assets have reports`;
  if (damageReportsKpi) damageReportsKpi.textContent = reportsCount.toLocaleString();
  if (damageReportsHint) {
    damageReportsHint.textContent = 'All buildings scope';
  }
  if (damageRecent30Kpi) damageRecent30Kpi.textContent = recent30Reports.toLocaleString();
  if (damageRecentKpi) damageRecentKpi.textContent = recentReports.toLocaleString();
  if (damagePerAssetKpi) damagePerAssetKpi.textContent = perDamagedAsset.toFixed(1);

  const monthPoints = [];
  const now = new Date();
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthPoints.push({
      key: monthKey(d),
      label: monthLabel(d),
      count: 0,
      buildingCounts: new Map()
    });
  }
  const monthMap = new Map(monthPoints.map((point) => [point.key, point]));
  filteredReports.forEach((row) => {
    const dt = new Date(row?.created_at || '');
    if (Number.isNaN(dt.getTime())) return;
    const key = monthKey(new Date(dt.getFullYear(), dt.getMonth(), 1));
    const point = monthMap.get(key);
    if (!point) return;
    point.count += 1;
    const buildingName = normalizeText(assetById.get(row.asset_id)?.building) || 'Unspecified';
    point.buildingCounts.set(buildingName, (point.buildingCounts.get(buildingName) || 0) + 1);
  });
  const maxTrend = Math.max(1, ...monthPoints.map((point) => point.count));
  if (damageTrendChart) {
    damageTrendChart.innerHTML = monthPoints.map((point) => {
      const h = (point.count / maxTrend) * 100;
      const buildingRows = [...point.buildingCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([buildingName, count]) => `<div class="damage-month-row"><span>${escapeHtml(buildingName)}</span><strong>${count}</strong></div>`)
        .join('');
      return `
        <div class="damage-trend-col" tabindex="0">
          <div class="damage-trend-value">${point.count}</div>
          <div class="damage-month-menu" role="tooltip" aria-label="${escapeHtml(point.label)} building totals">
            <div class="damage-month-title">${escapeHtml(point.label)}: ${point.count}</div>
            ${buildingRows || '<div class="damage-month-empty">No reports</div>'}
          </div>
          <div class="damage-trend-track">
            <div class="damage-trend-fill" style="height:${h.toFixed(1)}%"></div>
          </div>
          <div class="damage-trend-label">${point.label}</div>
        </div>
      `;
    }).join('');
    animateFillDimension(damageTrendChart, '.damage-trend-fill', 'height', { duration: 920, stagger: 38 });
  }

  const buildingGroups = new Map();
  cachedAssets.forEach((asset) => {
    const b = normalizeText(asset?.building) || 'Unspecified';
    if (!buildingGroups.has(b)) {
      buildingGroups.set(b, { total: 0, damagedIds: new Set() });
    }
    buildingGroups.get(b).total += 1;
  });
  cachedDamageReports.forEach((row) => {
    const asset = assetById.get(row.asset_id);
    if (!asset) return;
    const b = normalizeText(asset?.building) || 'Unspecified';
    const group = buildingGroups.get(b);
    if (!group) return;
    group.damagedIds.add(row.asset_id);
  });
  const buildingRows = [...buildingGroups.entries()].map(([label, g]) => {
    const damaged = g.damagedIds.size;
    const rateValue = pct(damaged, g.total);
    return { label, damaged, total: g.total, rate: rateValue };
  }).sort((a, b) => b.rate - a.rate).slice(0, 8);
  const maxRate = Math.max(1, ...buildingRows.map((row) => row.rate));
  if (damageBuildingRateChart) {
    if (!buildingRows.length) {
      damageBuildingRateChart.innerHTML = '<div class="muted">No building data available.</div>';
    } else {
      damageBuildingRateChart.innerHTML = buildingRows.map((row) => {
        const w = (row.rate / maxRate) * 100;
        return `
          <div class="damage-rate-row">
            <div class="damage-rate-top">
              <span>${row.label}</span>
              <strong>${row.rate.toFixed(1)}%</strong>
            </div>
            <div class="damage-rate-track">
              <div class="damage-rate-fill" style="width:${w.toFixed(1)}%"></div>
            </div>
            <div class="damage-rate-meta">${row.damaged}/${row.total} damaged</div>
          </div>
        `;
      }).join('');
      animateFillDimension(damageBuildingRateChart, '.damage-rate-fill', 'width', { duration: 860, stagger: 45 });
    }
  }
}

function renderWarrantyInsights() {
  const now = Date.now();
  const in60 = now + (60 * 24 * 60 * 60 * 1000);
  const in365 = now + (365 * 24 * 60 * 60 * 1000);
  const assets = cachedAssets;
  const validWarranty = assets.filter((a) => safeDate(a?.warranty_expiration_date));
  const out = validWarranty.filter((a) => safeDate(a.warranty_expiration_date).getTime() < now);
  const expiring60 = validWarranty.filter((a) => {
    const ts = safeDate(a.warranty_expiration_date).getTime();
    return ts >= now && ts <= in60;
  });
  const expiring365 = validWarranty.filter((a) => {
    const ts = safeDate(a.warranty_expiration_date).getTime();
    return ts >= now && ts <= in365;
  });

  renderMiniBars(warrantyExpiryBand, [
    { label: 'Out of warranty', value: out.length, display: out.length.toLocaleString() },
    { label: 'Expiring within 60 days', value: expiring60.length, display: expiring60.length.toLocaleString() },
    { label: 'Expiring within 365 days', value: expiring365.length, display: expiring365.length.toLocaleString() }
  ]);

  const buildingTotal = new Map();
  const buildingOut = new Map();
  assets.forEach((a) => {
    const b = normalizeText(a?.building) || 'Unspecified';
    buildingTotal.set(b, (buildingTotal.get(b) || 0) + 1);
  });
  out.forEach((a) => {
    const b = normalizeText(a?.building) || 'Unspecified';
    buildingOut.set(b, (buildingOut.get(b) || 0) + 1);
  });
  const rows = [...buildingTotal.entries()]
    .map(([label, total]) => {
      const uncovered = buildingOut.get(label) || 0;
      return {
        main: label,
        sub: `${uncovered}/${total} out of warranty`,
        value: `${pct(uncovered, total).toFixed(1)}%`,
        sort: uncovered
      };
    })
    .sort((a, b) => b.sort - a.sort)
    .slice(0, 8);
  renderInsightList(warrantyBuildingList, rows, 'No building warranty data.');
}

function renderAssignmentChurnInsights() {
  const now = Date.now();
  const txOut = cachedTransactions.filter((t) => String(t?.action || '').toLowerCase() === 'out');
  const tx90 = txOut.filter((t) => {
    const ts = safeDate(t?.occurred_at)?.getTime();
    return Number.isFinite(ts) && ts >= (now - 90 * 24 * 60 * 60 * 1000);
  });
  const tx120 = txOut.filter((t) => {
    const ts = safeDate(t?.occurred_at)?.getTime();
    return Number.isFinite(ts) && ts >= (now - 120 * 24 * 60 * 60 * 1000);
  });
  const counts90 = new Map();
  tx90.forEach((t) => counts90.set(t.asset_id, (counts90.get(t.asset_id) || 0) + 1));
  const counts120 = new Map();
  tx120.forEach((t) => counts120.set(t.asset_id, (counts120.get(t.asset_id) || 0) + 1));
  const repeatedAssets = [...counts120.values()].filter((n) => n >= 3).length;

  if (churn90Count) churn90Count.textContent = tx90.length.toLocaleString();
  if (churnRepeatAssets) churnRepeatAssets.textContent = repeatedAssets.toLocaleString();

  const monthPoints = [];
  const monthMap = new Map();
  const nowDate = new Date();
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(nowDate.getFullYear(), nowDate.getMonth() - i, 1);
    const key = monthKey(d);
    const point = { key, label: monthLabel(d), value: 0 };
    monthPoints.push(point);
    monthMap.set(key, point);
  }
  txOut.forEach((t) => {
    const dt = safeDate(t?.occurred_at);
    if (!dt) return;
    const point = monthMap.get(monthKey(new Date(dt.getFullYear(), dt.getMonth(), 1)));
    if (point) point.value += 1;
  });
  renderLineTrend(churnMonthlySpark, monthPoints);

  const assetById = new Map(cachedAssets.map((a) => [a.id, a]));
  const top = [...counts90.entries()]
    .map(([assetId, count]) => {
      const asset = assetById.get(assetId);
      return {
        serial: serialForAsset(asset),
        model: textOrDash(asset?.model),
        count,
        sort: count
      };
    })
    .sort((a, b) => b.sort - a.sort)
    .slice(0, 3);
  renderRankTable(
    churnTopAssets,
    ['Device', 'Model', 'Reassign (90d)'],
    top.map((r) => [r.serial, r.model, String(r.count)]),
    'No churn activity in last 90 days.'
  );
}

function renderDamageLeaderboards() {
  const byUser = new Map();
  const byAsset = new Map();
  const assetById = new Map(cachedAssets.map((a) => [a.id, a]));

  cachedDamageReports.forEach((r) => {
    const user = normalizeText(r?.assignee_name) || normalizeText(r?.reported_by_name) || 'Unassigned';
    byUser.set(user, (byUser.get(user) || 0) + 1);
    if (r?.asset_id) byAsset.set(r.asset_id, (byAsset.get(r.asset_id) || 0) + 1);
  });

  const userRows = [...byUser.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);
  renderHorizontalBars(damageByUserBars, userRows, 'No damage reports available.');

  const assetRows = [...byAsset.entries()]
    .map(([assetId, value]) => {
      const asset = assetById.get(assetId);
      return {
        label: serialForAsset(asset),
        value,
        sub: textOrDash(asset?.model)
      };
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);
  renderHorizontalBars(damageBySerialBars, assetRows, 'No damaged devices available.');
}

function renderUtilizationInsights() {
  const laptopAssets = cachedAssets.filter((a) => isLaptopAsset(a));
  const total = laptopAssets.length;
  const assigned = laptopAssets.filter((a) => String(a?.status || '').toLowerCase() === 'checked_out').length;
  const availableAssets = laptopAssets.filter((a) => String(a?.status || '').toLowerCase() === 'available');
  const available = availableAssets.length;
  const other = Math.max(0, total - assigned - available);
  const txByAsset = new Map();
  cachedTransactions.forEach((tx) => {
    if (!tx?.asset_id) return;
    const ts = safeDate(tx?.occurred_at)?.getTime();
    if (!Number.isFinite(ts)) return;
    const prev = txByAsset.get(tx.asset_id) || 0;
    if (ts > prev) txByAsset.set(tx.asset_id, ts);
  });
  const now = Date.now();
  const idle60Assets = availableAssets.filter((a) => {
    const lastTs = txByAsset.get(a.id) || 0;
    return !lastTs || lastTs < (now - 60 * 24 * 60 * 60 * 1000);
  });

  if (utilAssignedPct) utilAssignedPct.textContent = assigned.toLocaleString();
  if (utilAvailablePct) utilAvailablePct.textContent = available.toLocaleString();
  if (utilIdle60) utilIdle60.textContent = idle60Assets.length.toLocaleString();

  if (utilDonutChart && typeof window !== 'undefined' && window.Chart) {
    const data = [assigned, available, other];
    const labels = ['Assigned', 'Available', 'Other Status'];
    const colors = ['#6ea8ff', '#88f0c6', '#ffb36e'];
    if (utilDonutChartInstance) {
      utilDonutChartInstance.destroy();
    }
    utilDonutChartInstance = new window.Chart(utilDonutChart, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: colors,
          borderColor: 'rgba(20,26,36,0.14)',
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        animation: {
          duration: prefersReducedMotion() ? 0 : 1250,
          easing: 'easeOutQuart',
          animateRotate: true,
          animateScale: true
        },
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#6d7890',
              boxWidth: 10,
              boxHeight: 10,
              usePointStyle: true,
              pointStyle: 'circle'
            }
          },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const value = Number(ctx.parsed || 0);
                return `${ctx.label}: ${value.toLocaleString()} (${pct(value, total).toFixed(1)}%)`;
              }
            }
          }
        }
      }
    });
  }

  if (utilDonutMeta) {
    utilDonutMeta.innerHTML = '';
  }

}

function initPanelRevealAnimations() {
  if (typeof window === 'undefined') return;
  const panels = Array.from(document.querySelectorAll('#kpiReportsMainSection .panel'));
  if (!panels.length) return;
  if (!('IntersectionObserver' in window)) {
    panels.forEach((panel) => panel.classList.add('is-visible'));
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.12 });
  panels.forEach((panel) => observer.observe(panel));
}

function renderDataQualityInsights() {
  const missingSerial = cachedAssets.filter((a) => !normalizeText(a?.serial) && !normalizeText(a?.asset_tag)).length;
  const missingModel = cachedAssets.filter((a) => !normalizeText(a?.model)).length;
  const missingBuilding = cachedAssets.filter((a) => !normalizeText(a?.building)).length;
  const missingService = cachedAssets.filter((a) => !safeDate(a?.service_start_date)).length;
  const missingWarranty = cachedAssets.filter((a) => !safeDate(a?.warranty_expiration_date)).length;

  const serialMap = new Map();
  cachedAssets.forEach((a) => {
    const serial = normalizeText(a?.serial || a?.asset_tag).toLowerCase();
    if (!serial) return;
    serialMap.set(serial, (serialMap.get(serial) || 0) + 1);
  });
  const duplicateSerials = [...serialMap.values()].filter((n) => n > 1).length;

  const currentAssignedSet = new Set(cachedAssetCurrent.filter((r) => r?.asset_id && r?.assignee_person_id).map((r) => r.asset_id));
  const mismatchCheckedOutNoAssignee = cachedAssets.filter((a) => String(a?.status || '').toLowerCase() === 'checked_out' && !currentAssignedSet.has(a.id)).length;
  const mismatchAvailableHasAssignee = cachedAssets.filter((a) => String(a?.status || '').toLowerCase() === 'available' && currentAssignedSet.has(a.id)).length;
  const statusMismatch = mismatchCheckedOutNoAssignee + mismatchAvailableHasAssignee;
  const missingCritical = missingSerial + missingModel + missingBuilding + missingService + missingWarranty;

  if (dqMissingCritical) dqMissingCritical.textContent = missingCritical.toLocaleString();
  if (dqDuplicateSerials) dqDuplicateSerials.textContent = duplicateSerials.toLocaleString();
  if (dqStatusMismatch) dqStatusMismatch.textContent = statusMismatch.toLocaleString();

  renderMiniBars(dqIssueBands, [
    { label: 'Missing serial/tag', value: missingSerial, display: missingSerial.toLocaleString(), href: './reports.html?kpi_custom=missing_serial_tag' },
    { label: 'Missing model', value: missingModel, display: missingModel.toLocaleString(), href: './reports.html?kpi_custom=missing_model' },
    { label: 'Missing building', value: missingBuilding, display: missingBuilding.toLocaleString(), href: './reports.html?kpi_custom=missing_building' },
    { label: 'Missing service date', value: missingService, display: missingService.toLocaleString(), href: './reports.html?kpi_custom=missing_service_date' },
    { label: 'Missing warranty', value: missingWarranty, display: missingWarranty.toLocaleString(), href: './reports.html?kpi_custom=missing_warranty_date' },
    { label: 'Status mismatch', value: statusMismatch, display: statusMismatch.toLocaleString() }
  ]);
}

function renderRepairTurnaroundInsights() {
  const checkinByAsset = new Map();
  cachedTransactions
    .filter((t) => String(t?.action || '').toLowerCase() === 'in')
    .forEach((tx) => {
      if (!tx?.asset_id) return;
      const ts = safeDate(tx?.occurred_at)?.getTime();
      if (!Number.isFinite(ts)) return;
      if (!checkinByAsset.has(tx.asset_id)) checkinByAsset.set(tx.asset_id, []);
      checkinByAsset.get(tx.asset_id).push(ts);
    });
  checkinByAsset.forEach((arr) => arr.sort((a, b) => a - b));

  const assetById = new Map(cachedAssets.map((a) => [a.id, a]));
  const enriched = cachedDamageReports
    .map((r) => {
      const createdTs = safeDate(r?.created_at)?.getTime();
      if (!Number.isFinite(createdTs)) return null;
      const checks = checkinByAsset.get(r.asset_id) || [];
      const closeTs = checks.find((ts) => ts >= createdTs);
      const days = closeTs ? (closeTs - createdTs) / (24 * 60 * 60 * 1000) : null;
      return {
        asset: assetById.get(r.asset_id),
        createdTs,
        days,
        open: days == null
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.createdTs - a.createdTs);

  const closedDays = enriched.filter((e) => !e.open).map((e) => e.days).sort((a, b) => a - b);
  const avg = closedDays.length ? (closedDays.reduce((s, v) => s + v, 0) / closedDays.length) : 0;
  const median = closedDays.length ? closedDays[Math.floor(closedDays.length / 2)] : 0;
  const openCount = enriched.filter((e) => e.open).length;

  if (repairAvgDays) repairAvgDays.textContent = formatDays(avg);
  if (repairMedianDays) repairMedianDays.textContent = formatDays(median);
  if (repairOpenIncidents) repairOpenIncidents.textContent = openCount.toLocaleString();

  const timelineRows = enriched.slice(0, 12).map((e) => {
    const dt = new Date(e.createdTs);
    return {
      label: `${serialForAsset(e.asset)} • ${monthLabel(dt)} ${dt.getDate()}`,
      days: e.open ? null : Number(e.days.toFixed(1))
    };
  });
  renderRepairTimeline(repairTurnaroundSpark, timelineRows, 'No repair turnaround records.');

  const list = enriched.slice(0, 10).map((e) => {
    const dt = new Date(e.createdTs);
    return [serialForAsset(e.asset), `${monthLabel(dt)} ${dt.getDate()}, ${dt.getFullYear()}`, e.open ? 'Open' : formatDays(e.days)];
  });
  renderRankTable(repairRecentList, ['Device', 'Reported', 'Turnaround'], list, 'No repair turnaround records.');
}

async function loadKpis() {
  await ensureSessionFresh();
  const { data: assetData, error: assetError } = await supabase
    .from('assets')
    .select('id, asset_tag, serial, model, status, service_start_date, warranty_expiration_date, building, equipment_type')
    .limit(5000);
  if (assetError) {
    toast(assetError.message || 'Failed to load KPIs.', true);
    return;
  }

  const { data: damageData, error: damageError } = await supabase
    .from('damage_reports')
    .select('id, asset_id, created_at, assignee_name, reported_by_name')
    .limit(20000);
  if (damageError) {
    toast(damageError.message || 'Failed to load damage insights.', true);
    return;
  }

  const { data: transactionData, error: transactionError } = await supabase
    .from('transactions')
    .select('id, asset_id, action, occurred_at, assignee_person_id')
    .limit(30000);
  if (transactionError) {
    toast(transactionError.message || 'Failed to load assignment history analytics.', true);
    return;
  }

  const { data: assetCurrentData, error: assetCurrentError } = await supabase
    .from('asset_current')
    .select('asset_id, assignee_person_id')
    .limit(10000);
  if (assetCurrentError) {
    toast(assetCurrentError.message || 'Failed to load assignment state analytics.', true);
    return;
  }

  const rows = assetData || [];
  cachedAssets = rows;
  cachedDamageReports = damageData || [];
  cachedTransactions = transactionData || [];
  cachedAssetCurrent = assetCurrentData || [];

  updateSummaryKpis(rows);
  renderLifecycleCharts(rows);
  renderDamageInsights();
  renderWarrantyInsights();
  renderAssignmentChurnInsights();
  renderDamageLeaderboards();
  renderUtilizationInsights();
  renderDataQualityInsights();
}

async function init() {
  initTheme();
  bindThemeToggle();
  bindSignOut(signOut);

  if (!requireConfig()) {
    toast('Update config.js with Supabase config.', true);
    return;
  }

  const session = await getSession();
  if (!requireAuth(session)) return;

  const profile = await getCurrentProfile();
  setRoleVisibility(profile.role);
  initAdminNav();
  await loadSiteBrandingFromServer({
    supabaseClient: supabase,
    ensureSessionFreshFn: ensureSessionFresh
  });
  stopConnectionBadgeMonitor = initConnectionBadgeMonitor({
    supabaseClient: supabase,
    ensureSessionFreshFn: ensureSessionFresh,
    badgeSelector: '#connectionBadge'
  });

  loadingPanel.hidden = true;
  topbar.hidden = false;
  nav.hidden = false;
  mainSection.hidden = false;
  initPanelRevealAnimations();
  initMouseFollowTooltips();

  await loadKpis();

  window.addEventListener('beforeunload', () => {
    if (stopConnectionBadgeMonitor) stopConnectionBadgeMonitor();
  });
}

init().catch((err) => toast(err.message, true));
