"use strict";

const PDFJS_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build";

// Loaded with a dynamic import so this file can stay a classic script,
// which keeps the page working when opened straight from disk (file://)
const pdfjsReady = import(`${PDFJS_URL}/pdf.min.mjs`).then((lib) => {
  lib.GlobalWorkerOptions.workerSrc = `${PDFJS_URL}/pdf.worker.min.mjs`;
  return lib;
});

// 1 PDF point = 1/72 inch
const UNITS = {
  mm: { perPt: 25.4 / 72, digits: 1 },
  cm: { perPt: 2.54 / 72, digits: 2 },
  in: { perPt: 1 / 72, digits: 2 },
  pt: { perPt: 1, digits: 0 },
  px: { perPt: 96 / 72, digits: 0 },
};

// Standard sizes in points (portrait)
const PAPER = [
  ["A0", 2384, 3370], ["A1", 1684, 2384], ["A2", 1191, 1684], ["A3", 842, 1191],
  ["A4", 595, 842], ["A5", 420, 595], ["A6", 298, 420],
  ["B4", 709, 1001], ["B5", 499, 709],
  ["Letter", 612, 792], ["Legal", 612, 1008], ["Tabloid", 792, 1224],
  ["Executive", 522, 756],
];

const ICON_X = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>`;

let unit = localStorage.getItem("pdfUnit") || "mm";
let nextId = 1;
const files = []; // { id, name, pages: [{w,h}] | null, error }

const $ = (s) => document.querySelector(s);
const drop = $("#drop"), input = $("#file"), results = $("#results"), toolbar = $("#toolbar");

const paperName = (w, h) => {
  const [a, b] = w <= h ? [w, h] : [h, w];
  const hit = PAPER.find(([, pw, ph]) => Math.abs(pw - a) <= 3 && Math.abs(ph - b) <= 3);
  return hit ? hit[0] : null;
};
const orientation = (w, h) => Math.abs(w - h) < 1 ? "Square" : w > h ? "Landscape" : "Portrait";
const num = (pt, u = unit) => {
  const v = pt * UNITS[u].perPt;
  return UNITS[u].digits ? +v.toFixed(UNITS[u].digits) + "" : Math.round(v) + "";
};
const dims = (w, h, u = unit) => `${num(w, u)} × ${num(h, u)}`;
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const shape = (w, h, max) => {
  const s = max / Math.max(w, h);
  return `<span class="shape" style="width:${Math.max(4, w * s).toFixed(0)}px;height:${Math.max(4, h * s).toFixed(0)}px"></span>`;
};

// Collapse consecutive same-size pages into ranges
function groupPages(pages) {
  const groups = [];
  pages.forEach((p, i) => {
    const last = groups[groups.length - 1];
    if (last && Math.abs(last.w - p.w) < 0.01 && Math.abs(last.h - p.h) < 0.01) last.to = i + 1;
    else groups.push({ from: i + 1, to: i + 1, w: p.w, h: p.h });
  });
  return groups;
}

function cardHtml(f) {
  const head = `<div class="card-head">
    <span class="fname" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
    <button class="icon-btn" data-remove="${f.id}" aria-label="Remove ${escapeHtml(f.name)}">${ICON_X}</button>
  </div>`;

  if (f.error) return `<div class="card">${head}<div class="status error">${escapeHtml(f.error)}</div></div>`;
  if (!f.pages) return `<div class="card">${head}<div class="status"><span class="spinner"></span>Reading PDF…</div></div>`;

  const n = f.pages.length;
  const pagesLabel = `${n} page${n === 1 ? "" : "s"}`;
  const groups = groupPages(f.pages);
  const uniqueSizes = new Set(groups.map((g) => g.w.toFixed(1) + "x" + g.h.toFixed(1)));
  const altUnit = unit === "in" ? "mm" : "in";

  if (uniqueSizes.size === 1) {
    const { w, h } = groups[0];
    const paper = paperName(w, h);
    return `<div class="card">${head}
      <div class="main">
        <div class="shape-box">${shape(w, h, 64)}</div>
        <div>
          <div class="size">${dims(w, h)}<span class="u">${unit}</span></div>
          <div class="alt">${dims(w, h, altUnit)} ${altUnit}</div>
          <div class="chips">
            ${paper ? `<span class="chip paper">${paper}</span>` : ""}
            <span class="chip">${orientation(w, h)}</span>
            <span class="chip">${n === 1 ? "1 page" : `All ${n} pages`}</span>
          </div>
        </div>
      </div>
      <button class="copy" data-copy="${dims(w, h)} ${unit}">Copy size</button>
    </div>`;
  }

  const rows = groups.map((g) => {
    const paper = paperName(g.w, g.h);
    const range = g.from === g.to ? `Page ${g.from}` : `Pages ${g.from}–${g.to}`;
    return `<div class="row">
      <span class="shape-box" style="width:28px;height:28px">${shape(g.w, g.h, 22)}</span>
      <span class="pg">${range}</span>
      <span class="dim">${dims(g.w, g.h)} ${unit}</span>
      ${paper ? `<span class="chip paper">${paper}</span>` : `<span class="chip">${orientation(g.w, g.h)}</span>`}
    </div>`;
  }).join("");

  return `<div class="card">${head}
    <p class="mixed-note">${pagesLabel} · ${uniqueSizes.size} different sizes</p>
    <div class="rows">${rows}</div>
  </div>`;
}

function render() {
  const has = files.length > 0;
  toolbar.hidden = !has;
  drop.classList.toggle("compact", has);
  drop.querySelector(".title").textContent = has ? "Add another PDF" : "Drop a PDF here or click to choose";
  document.querySelectorAll("#units button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.unit === unit));
  results.innerHTML = files.map(cardHtml).join("");
}

async function readPdf(file) {
  const entry = { id: nextId++, name: file.name, pages: null, error: null };
  files.unshift(entry);
  render();
  try {
    const pdfjsLib = await pdfjsReady.catch(() => {
      throw Object.assign(new Error(), { name: "LoadError" });
    });
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      // Viewport at scale 1 is in points and accounts for page rotation
      const vp = (await doc.getPage(i)).getViewport({ scale: 1 });
      pages.push({ w: vp.width, h: vp.height });
    }
    entry.pages = pages;
    doc.destroy();
  } catch (e) {
    entry.error =
      e?.name === "PasswordException" ? "This PDF is password-protected, so its size can't be read."
      : e?.name === "LoadError" ? "Couldn't load the PDF reader. Check your internet connection and reload the page."
      : "This file couldn't be opened. Is it a valid PDF?";
  }
  render();
}

function handle(list) {
  const pdfs = [...list].filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
  if (!pdfs.length && list.length) {
    files.unshift({ id: nextId++, name: list[0].name, pages: null, error: "That's not a PDF file. Please choose a .pdf file." });
    render();
  }
  pdfs.forEach(readPdf);
}

drop.addEventListener("click", () => input.click());
input.addEventListener("change", () => { handle(input.files); input.value = ""; });

// Tools: each registers a drop zone and a handler for dropped files
const tools = { size: { zone: drop, handle } };
let activeTool = "size";

function showTool() {
  const name = location.hash.slice(1);
  activeTool = tools[name] ? name : "size";
  document.querySelectorAll("[data-tool]").forEach((s) => (s.hidden = s.dataset.tool !== activeTool));
  document.querySelectorAll("[data-tab]").forEach((t) => t.setAttribute("aria-selected", t.dataset.tab === activeTool));
}
window.addEventListener("hashchange", showTool);
// Run after all tool scripts have registered themselves
window.addEventListener("DOMContentLoaded", showTool);

// Accept file drops anywhere on the page; ignore drags that aren't files (like reordering a list)
const isFileDrag = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
let dragDepth = 0;
const zone = () => tools[activeTool].zone;
window.addEventListener("dragenter", (e) => { if (!isFileDrag(e)) return; e.preventDefault(); dragDepth++; zone().classList.add("over"); });
window.addEventListener("dragleave", (e) => { if (!isFileDrag(e)) return; if (--dragDepth <= 0) { dragDepth = 0; zone().classList.remove("over"); } });
window.addEventListener("dragover", (e) => { if (isFileDrag(e)) e.preventDefault(); });
window.addEventListener("drop", (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault(); dragDepth = 0; zone().classList.remove("over");
  tools[activeTool].handle(e.dataTransfer.files);
});

$("#units").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  unit = b.dataset.unit;
  localStorage.setItem("pdfUnit", unit);
  render();
});

results.addEventListener("click", async (e) => {
  const rm = e.target.closest("[data-remove]");
  if (rm) {
    const i = files.findIndex((f) => f.id === +rm.dataset.remove);
    if (i >= 0) files.splice(i, 1);
    render();
    return;
  }
  const cp = e.target.closest("[data-copy]");
  if (cp) {
    try {
      await navigator.clipboard.writeText(cp.dataset.copy);
      cp.textContent = "Copied ✓";
    } catch {
      cp.textContent = "Couldn't copy";
    }
    setTimeout(() => (cp.textContent = "Copy size"), 1500);
  }
});
