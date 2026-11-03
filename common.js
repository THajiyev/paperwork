"use strict";

// Shared helpers and page shell. Each tool lives in its own file, wrapped in an
// IIFE so its names stay private, and registers itself with registerTool().

const $ = (s) => document.querySelector(s);
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtBytes = (n) =>
  n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
let nextId = 1;

const ICON_X = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>`;
const ICON_UP = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>`;
const ICON_DOWN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;
const ICON_GRIP = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>`;

const LoadError = () => Object.assign(new Error(), { name: "LoadError" });

// pdf-lib (for writing PDFs) is loaded on first use so tools that don't need it don't pay for it
const PDFLIB_URL = "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js";
let pdfLibReady = null;
const loadPdfLib = () => pdfLibReady ||= new Promise((resolve, reject) => {
  const s = document.createElement("script");
  s.src = PDFLIB_URL;
  s.onload = () => resolve(window.PDFLib);
  s.onerror = () => { pdfLibReady = null; s.remove(); reject(LoadError()); };
  document.head.append(s);
});

/* ---------- Tools and tabs ---------- */

// name -> { zone, handle }; the first tab in the nav is the default tool
const tools = {};
let activeTool = null;

function registerTool(name, { zone, input, handle }) {
  tools[name] = { zone, handle };
  zone.addEventListener("click", () => input.click());
  input.addEventListener("change", () => { handle(input.files); input.value = ""; });
}

function showTool() {
  const name = location.hash.slice(1);
  activeTool = tools[name] ? name : $("[data-tab]").dataset.tab;
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

/* ---------- Reorderable file list ---------- */

// Renders `items` (the tool's array, kept in output order) into `el` with drag, arrow and
// remove controls. Items need { id, name, error }. `meta(item)` gives the second line,
// `thumb(item)` an optional preview. `onChange` runs after the user changes the list.
function fileList(el, { items, meta, thumb, busy = () => false, onChange, onRemove = () => {}, controls = {} }) {
  const itemHtml = (f, i) => {
    const name = escapeHtml(f.name);
    return `<li class="item${f.error ? " has-error" : ""}" draggable="true" data-id="${f.id}">
      <span class="grip" title="Drag to reorder">${ICON_GRIP}</span>
      <span class="idx">${i + 1}</span>
      ${thumb ? thumb(f) : ""}
      <span class="item-text">
        <span class="item-name" title="${name}">${name}</span>
        ${f.error ? `<span class="item-meta error">${escapeHtml(f.error)}</span>` : `<span class="item-meta">${meta(f)}</span>`}
      </span>
      <span class="item-btns">
        <button class="icon-btn" data-up="${f.id}" aria-label="Move ${name} up" ${i === 0 ? "disabled" : ""}>${ICON_UP}</button>
        <button class="icon-btn" data-down="${f.id}" aria-label="Move ${name} down" ${i === items.length - 1 ? "disabled" : ""}>${ICON_DOWN}</button>
        <button class="icon-btn" data-remove="${f.id}" aria-label="Remove ${name}">${ICON_X}</button>
      </span>
    </li>`;
  };
  const render = () => { el.innerHTML = items.map(itemHtml).join(""); };
  const indexOf = (id) => items.findIndex((f) => f.id === id);

  function move(id, to) {
    const from = indexOf(id);
    if (from < 0 || to < 0 || to >= items.length || from === to) return false;
    items.splice(to, 0, items.splice(from, 1)[0]);
    return true;
  }

  el.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || busy()) return;
    if (b.dataset.remove) {
      const i = indexOf(+b.dataset.remove);
      if (i >= 0) onRemove(items.splice(i, 1)[0]);
      onChange();
      return;
    }
    const id = +(b.dataset.up || b.dataset.down);
    const dir = b.dataset.up ? "up" : "down";
    if (!move(id, indexOf(id) + (dir === "up" ? -1 : 1))) return;
    onChange();
    // Keep focus on the moved file so arrows can be pressed repeatedly
    const again = el.querySelector(`[data-${dir}="${id}"]`);
    (again && !again.disabled ? again : el.querySelector(`[data-${dir === "up" ? "down" : "up"}="${id}"]`))?.focus();
  });

  // Drag to reorder
  let dragId = null, dropTarget = null, moved = false;
  const clearMarkers = () => el.querySelectorAll(".drop-before, .drop-after")
    .forEach((li) => li.classList.remove("drop-before", "drop-after"));

  el.addEventListener("dragstart", (e) => {
    const li = e.target.closest("li");
    if (!li || busy()) return e.preventDefault();
    dragId = +li.dataset.id;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", li.querySelector(".item-name").textContent);
    requestAnimationFrame(() => li.classList.add("dragging"));
  });
  el.addEventListener("dragover", (e) => {
    if (dragId === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const li = e.target.closest("li");
    if (!li) return;
    const r = li.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    clearMarkers();
    dropTarget = null;
    if (+li.dataset.id === dragId) return;
    li.classList.add(after ? "drop-after" : "drop-before");
    dropTarget = { id: +li.dataset.id, after };
  });
  el.addEventListener("drop", (e) => {
    if (dragId === null) return;
    e.preventDefault();
    if (!dropTarget) return;
    const from = indexOf(dragId);
    let to = indexOf(dropTarget.id) + (dropTarget.after ? 1 : 0);
    if (from < to) to--; // removing the dragged item shifts the target up
    moved = move(dragId, to);
  });
  el.addEventListener("dragend", () => {
    dragId = dropTarget = null;
    if (moved) onChange(); else render(); // render clears drag styling
    moved = false;
  });

  // Optional list-wide buttons
  const act = (btn, fn) => btn?.addEventListener("click", () => { if (!busy()) { fn(); onChange(); } });
  act(controls.sort, () => items.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })));
  act(controls.reverse, () => items.reverse());
  act(controls.clear, () => items.splice(0).forEach(onRemove));

  return { render };
}

/* ---------- Output card ---------- */

// File name field, action button and status line for tools that produce a PDF.
// Typing a new name invalidates the last result; Enter in the name field runs the action.
function outputCard({ name, button, status, fallback }) {
  let url = null;

  // Windows-safe file name, always ending in .pdf
  const fileName = () => {
    const base = name.value.trim().replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|\x00-\x1f]/g, "-").trim();
    return (base || fallback) + ".pdf";
  };
  const set = (html, kind = "") => {
    status.className = `status ${kind}`;
    status.innerHTML = html;
  };
  const clear = () => {
    if (url) URL.revokeObjectURL(url);
    url = null;
    set("");
  };
  // Show the result and start the download
  const done = (bytes, pages) => {
    clear();
    const file = fileName();
    url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    set(`<span>Done: <strong>${escapeHtml(file)}</strong> · ${plural(pages, "page")} · ${fmtBytes(bytes.byteLength)}</span>
      <a class="link-btn" href="${url}" download="${escapeHtml(file)}">Download again</a>`, "done");
    const a = Object.assign(document.createElement("a"), { href: url, download: file });
    document.body.append(a);
    a.click();
    a.remove();
  };

  name.addEventListener("input", clear);
  name.addEventListener("keydown", (e) => { if (e.key === "Enter" && !button.disabled) button.click(); });

  return { set, clear, done, hasResult: () => url !== null };
}
