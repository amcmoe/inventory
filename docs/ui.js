// ui.js - search page UI interactions (drawer, theme, table helpers, toasts)

const $ = (sel) => document.querySelector(sel);

const drawer = $("#drawer");
const overlay = $("#drawerOverlay");
const closeDrawerBtn = $("#closeDrawerBtn");
const toastEl = $("#toast");
const themeBtn = $("#themeBtn");

const searchInput = $("#searchInput");
const statusFilter = $("#statusFilter");
const clearFiltersBtn = $("#clearFiltersBtn");
const assetTbody = $("#assetTbody");

const kpiTotal = $("#kpiTotal");
const kpiAssigned = $("#kpiAssigned");
const kpiAvailable = $("#kpiAvailable");
const kpiAttention = $("#kpiAttention");
const navCount = $("#navCount");

const drawerPrimary = $("#drawerPrimary");
const drawerSecondary = $("#drawerSecondary");
const drawerDetails = $("#drawerDetails");
const drawerNotes = $("#drawerNotes");
const printLabelBtn = $("#printLabelBtn");
const editBtn = $("#editBtn");

let currentRowData = null;

function showToast(msg) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  window.clearTimeout(showToast._t);
  showToast._t = window.setTimeout(() => toastEl.classList.remove("show"), 1800);
}

function openDrawer() {
  if (!overlay || !drawer) return;
  overlay.classList.add("open");
  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
}

function closeDrawer() {
  if (!overlay || !drawer) return;
  overlay.classList.remove("open");
  drawer.classList.remove("open");
  drawer.setAttribute("aria-hidden", "true");
  document.querySelectorAll("tbody tr.selected").forEach((tr) => tr.classList.remove("selected"));
}

overlay?.addEventListener("click", closeDrawer);
closeDrawerBtn?.addEventListener("click", closeDrawer);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeDrawer();
  if ((e.key === "k" || e.key === "K") && !e.metaKey && !e.ctrlKey && !e.altKey) {
    const tag = document.activeElement?.tagName?.toLowerCase();
    if (tag !== "input" && tag !== "textarea" && tag !== "select") {
      e.preventDefault();
      searchInput?.focus();
      showToast("Search focused");
    }
  }
});

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);
}

themeBtn?.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  setTheme(current === "dark" ? "light" : "dark");
});

(function initTheme() {
  const saved = localStorage.getItem("theme");
  if (saved) setTheme(saved);
})();

function statusBadge(status) {
  const s = String(status || "").toLowerCase();
  let cls = "info";
  if (s.includes("available")) cls = "ok";
  else if (s.includes("assigned") || s.includes("in service") || s.includes("checked_out")) cls = "info";
  else if (s.includes("repair") || s.includes("maintenance")) cls = "warn";
  else if (s.includes("retire")) cls = "danger";
  return `<span class="badge ${cls}"><span class="dot"></span>${escapeHtml(status || "-")}</span>`;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function qrDataUrl(value) {
  if (window.QRCode?.toDataURL) {
    return window.QRCode.toDataURL(value, { width: 110, margin: 1 });
  }
  const encoded = encodeURIComponent(value);
  return `https://api.qrserver.com/v1/create-qr-code/?size=110x110&data=${encoded}`;
}

async function printCurrentLabel(printWin) {
  if (!currentRowData?.serial) {
    showToast("Select an asset first");
    if (printWin && !printWin.closed) printWin.close();
    return;
  }
  const qrUrl = await qrDataUrl(currentRowData.serial);
  const assignee = currentRowData.assignedTo || "Unassigned";
  const serial = currentRowData.serial;
  const html = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Asset Label</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #f2f2f2; }
    .page { padding: 16px; }
    .actions { margin-bottom: 10px; display: flex; gap: 8px; }
    .actions button { border: 1px solid #111; background: #fff; color: #111; border-radius: 8px; padding: 6px 10px; font-weight: 600; cursor: pointer; }
    .label-preview { display: inline-block; padding: 10px; background: #fff; border-radius: 10px; box-shadow: 0 2px 8px rgba(0,0,0,0.14); }
    .label-size { font-size: 12px; color: #333; margin-bottom: 8px; font-weight: 600; }
    .label { width: 2.125in; height: 1in; box-sizing: border-box; border: 1.5px solid #111; border-radius: 9px; padding: 8px; display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: center; background: #fff; }
    .assignee-title { font-size: 12px; font-weight: 800; line-height: 1.15; margin-bottom: 4px; }
    .org { font-size: 11px; font-weight: 700; }
    .serial { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11.5px; font-weight: 700; margin-top: 6px; }
    img { width: 74px; height: 74px; }
    @media print { .actions { display: none; } .page { padding: 0; background: #fff; } .label-preview { box-shadow: none; padding: 0; } .label-size { display: none; } }
  </style>
</head>
<body>
  <div class="page">
    <div class="actions">
      <button type="button" onclick="window.print()">Print</button>
      <button type="button" onclick="window.close()">Close</button>
    </div>
    <div class="label-preview">
      <div class="label-size">Label Preview (2 1/8in x 1in)</div>
      <div class="label">
        <div>
          <div class="assignee-title">${escapeHtml(assignee)}</div>
          <div class="org">South Middleton SD</div>
          <div class="serial">Serial: ${escapeHtml(serial)}</div>
        </div>
        <img src="${qrUrl}" alt="QR code">
      </div>
    </div>
  </div>
</body>
</html>`;
  printWin.document.open();
  printWin.document.write(html);
  printWin.document.close();
}

function enhanceAssetTable() {
  if (!assetTbody) return;
  const rows = Array.from(assetTbody.querySelectorAll("tr"));
  const fmtDate = (v) => {
    const raw = String(v || "").trim();
    if (!raw) return "-";
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? raw : d.toLocaleDateString();
  };
  rows.forEach((tr) => {
    tr.addEventListener("click", () => {
      rows.forEach((r) => r.classList.remove("selected"));
      tr.classList.add("selected");

      const cells = Array.from(tr.querySelectorAll("td")).map((td) => td.textContent.trim());
      const [serial, model, assignedTo, status, buildingCell] = cells;
      const assetTag = tr.dataset.assetTag || serial || "";
      const manufacturer = tr.dataset.manufacturer || "";
      const equipmentType = tr.dataset.equipmentType || "";
      const building = tr.dataset.building || "";
      const room = tr.dataset.room || "";
      const serviceStartDate = tr.dataset.serviceStartDate || "";
      const ownership = tr.dataset.ownership || "";
      const warrantyExpirationDate = tr.dataset.warrantyExpirationDate || "";
      const obsolete = tr.dataset.obsolete || "No";
      currentRowData = {
        serial, assetTag, model, assignedTo, status,
        building: buildingCell,
        manufacturer, equipmentType, building, room, serviceStartDate,
        ownership, warrantyExpirationDate, obsolete
      };

      if (drawerPrimary) drawerPrimary.textContent = serial || "Asset";
      if (drawerSecondary) drawerSecondary.textContent = model || "-";
      if (drawerDetails) {
        drawerDetails.innerHTML = `
          <div class="detail"><div class="k">Serial</div><div class="v mono">${escapeHtml(serial || "-")}</div></div>
          <div class="detail"><div class="k">Manufacturer</div><div class="v">${escapeHtml(manufacturer || "-")}</div></div>
          <div class="detail"><div class="k">Model</div><div class="v">${escapeHtml(model || "-")}</div></div>
          <div class="detail"><div class="k">Equipment Type</div><div class="v">${escapeHtml(equipmentType || "-")}</div></div>
          <div class="detail"><div class="k">Building</div><div class="v">${escapeHtml(building || "-")}</div></div>
          <div class="detail"><div class="k">Room</div><div class="v">${escapeHtml(room || "-")}</div></div>
          <div class="detail"><div class="k">In Service Since</div><div class="v">${escapeHtml(fmtDate(serviceStartDate))}</div></div>
          <div class="detail"><div class="k">Owned or Leased</div><div class="v">${escapeHtml(ownership || "-")}</div></div>
          <div class="detail"><div class="k">Warranty Expiration</div><div class="v">${escapeHtml(fmtDate(warrantyExpirationDate))}</div></div>
          <div class="detail"><div class="k">Obsolete</div><div class="v">${escapeHtml(obsolete || "No")}</div></div>
          <div class="detail"><div class="k">Assigned To</div><div class="v">${escapeHtml(assignedTo || "-")}</div></div>
          <div class="detail"><div class="k">Status</div><div class="v">${statusBadge(status)}</div></div>
        `;
      }
      if (drawerNotes) drawerNotes.textContent = tr.dataset.notes || "-";
      window.dispatchEvent(new CustomEvent("asset-row-selected", { detail: currentRowData }));
      openDrawer();
    });

    const tds = tr.querySelectorAll("td");
    const statusTd = tds[3];
    if (statusTd && !statusTd.querySelector(".badge")) {
      const raw = statusTd.textContent.trim();
      statusTd.innerHTML = statusBadge(raw);
    }
    const serialTd = tds[0];
    if (serialTd) serialTd.classList.add("mono");
    const locTd = tds[4];
    if (locTd) locTd.classList.add("dim");
  });

  updateKpisFromTable();
}

function applyFilters() {
  if (!assetTbody) return;
  const q = (searchInput?.value || "").toLowerCase().trim();
  const status = statusFilter?.value || "";
  const rows = Array.from(assetTbody.querySelectorAll("tr"));
  rows.forEach((tr) => {
    const cells = Array.from(tr.querySelectorAll("td")).map((td) => td.textContent.toLowerCase());
    const rowText = cells.join(" | ");
    const rowStatus = cells[3] || "";
    const matchQ = !q || rowText.includes(q);
    const matchStatus = !status || rowStatus.includes(status.toLowerCase());
    tr.style.display = (matchQ && matchStatus) ? "" : "none";
  });
}

searchInput?.addEventListener("input", () => applyFilters());
statusFilter?.addEventListener("change", () => applyFilters());
clearFiltersBtn?.addEventListener("click", () => {
  if (searchInput) searchInput.value = "";
  if (statusFilter) statusFilter.value = "";
  applyFilters();
  showToast("Filters cleared");
});

function updateKpisFromTable() {
  if (!assetTbody) return;
  const rows = Array.from(assetTbody.querySelectorAll("tr"));
  const visible = rows.filter((r) => r.style.display !== "none");
  const total = visible.length;
  const assigned = visible.filter((r) => (r.querySelectorAll("td")[3]?.textContent || "").toLowerCase().includes("assigned")).length;
  const available = visible.filter((r) => (r.querySelectorAll("td")[3]?.textContent || "").toLowerCase().includes("available")).length;
  const attention = visible.filter((r) => {
    const s = (r.querySelectorAll("td")[3]?.textContent || "").toLowerCase();
    return s.includes("repair") || s.includes("maintenance") || s.includes("retired");
  }).length;
  if (kpiTotal) kpiTotal.textContent = total.toLocaleString();
  if (kpiAssigned) kpiAssigned.textContent = assigned.toLocaleString();
  if (kpiAvailable) kpiAvailable.textContent = available.toLocaleString();
  if (kpiAttention) kpiAttention.textContent = attention.toLocaleString();
  if (navCount) navCount.textContent = total.toLocaleString();
}

window.enhanceAssetTable = enhanceAssetTable;
window.updateKpisFromTable = updateKpisFromTable;

document.addEventListener("DOMContentLoaded", () => {
  if (assetTbody?.children?.length) enhanceAssetTable();
});

printLabelBtn?.addEventListener("click", () => {
  const printWin = window.open("", "_blank", "width=1100,height=820,resizable=yes,scrollbars=yes");
  if (!printWin) {
    showToast("Pop-up blocked. Allow pop-ups to print.");
    return;
  }
  printWin.document.open();
  printWin.document.write("<!doctype html><html><body style='font-family:Arial,sans-serif;padding:16px;'>Preparing label...</body></html>");
  printWin.document.close();
  printCurrentLabel(printWin).catch((err) => {
    showToast(err.message);
    if (!printWin.closed) printWin.close();
  });
});

editBtn?.addEventListener("click", () => {
  const assetTag = currentRowData?.assetTag || currentRowData?.serial;
  if (!assetTag) {
    showToast("Select an asset first");
    return;
  }
  window.location.href = `./admin.html?tag=${encodeURIComponent(assetTag)}`;
});
