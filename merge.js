"use strict";

// Merge tool. Relies on helpers from script.js ($, escapeHtml, ICON_X, tools).

const PDFLIB_URL = "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js";

// Loaded on first use so the size tool doesn't pay for it
let pdfLibReady = null;
const loadPdfLib = () => pdfLibReady ||= new Promise((resolve, reject) => {
  const s = document.createElement("script");
  s.src = PDFLIB_URL;
  s.onload = () => resolve(window.PDFLib);
  s.onerror = () => { pdfLibReady = null; s.remove(); reject(Object.assign(new Error(), { name: "LoadError" })); };
  document.head.append(s);
});

const ICON_UP = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>`;
const ICON_DOWN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;
const ICON_GRIP = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>`;

const mfiles = []; // { id, name, bytes, doc, pages, error } in merge order
let merging = false;
let resultUrl = null;

const mdrop = $("#mdrop"), minput = $("#mfile"), mpanel = $("#merge-panel"), mlist = $("#merge-list");
const mstatus = $("#merge-status"), mbtn = $("#merge-btn"), outName = $("#out-name");

const fmtBytes = (n) =>
  n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`;

// Windows-safe file name, always ending in .pdf
function outputFileName() {
  const base = outName.value.trim().replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|\x00-\x1f]/g, "-").trim();
  return (base || "merged") + ".pdf";
}

function setStatus(html, kind = "") {
  mstatus.className = `status ${kind}`;
  mstatus.innerHTML = html;
}

function clearResult() {
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  resultUrl = null;
  setStatus("");
}

function itemHtml(f, i) {
  const meta = f.error ? `<span class="item-meta error">${escapeHtml(f.error)}</span>`
    : !f.doc ? `<span class="item-meta"><span class="spinner small"></span>Reading…</span>`
    : `<span class="item-meta">${f.pages} page${f.pages === 1 ? "" : "s"} · ${fmtBytes(f.bytes.byteLength)}</span>`;
  const name = escapeHtml(f.name);
  return `<li class="item${f.error ? " has-error" : ""}" draggable="true" data-id="${f.id}">
    <span class="grip" title="Drag to reorder">${ICON_GRIP}</span>
    <span class="idx">${i + 1}</span>
    <span class="item-text">
      <span class="item-name" title="${name}">${name}</span>
      ${meta}
    </span>
    <span class="item-btns">
      <button class="icon-btn" data-up="${f.id}" aria-label="Move ${name} up" ${i === 0 ? "disabled" : ""}>${ICON_UP}</button>
      <button class="icon-btn" data-down="${f.id}" aria-label="Move ${name} down" ${i === mfiles.length - 1 ? "disabled" : ""}>${ICON_DOWN}</button>
      <button class="icon-btn" data-remove="${f.id}" aria-label="Remove ${name}">${ICON_X}</button>
    </span>
  </li>`;
}

function renderMerge() {
  const has = mfiles.length > 0;
  mpanel.hidden = !has;
  mdrop.classList.toggle("compact", has);
  mdrop.querySelector(".title").textContent = has ? "Add more PDFs" : "Drop PDFs here or click to choose";
  mlist.innerHTML = mfiles.map(itemHtml).join("");

  const ready = mfiles.filter((f) => f.doc);
  const pages = ready.reduce((n, f) => n + f.pages, 0);
  $("#merge-summary").textContent =
    `${mfiles.length} file${mfiles.length === 1 ? "" : "s"}` + (pages ? ` · ${pages} pages total` : "");

  const loading = mfiles.some((f) => !f.doc && !f.error);
  const broken = mfiles.some((f) => f.error);
  mbtn.disabled = merging || loading || broken || ready.length < 2;
  mbtn.textContent = merging ? "Merging…" : `Merge ${ready.length >= 2 ? ready.length + " " : ""}PDFs`;
  if (!merging && !resultUrl) {
    if (broken) setStatus("Remove the files that couldn't be read to continue.", "error");
    else if (!loading && ready.length === 1) setStatus("Add at least one more PDF to merge.");
    else setStatus("");
  }
}

async function readForMerge(file) {
  const entry = { id: nextId++, name: file.name, bytes: null, doc: null, pages: 0, error: null };
  mfiles.push(entry);
  clearResult();
  renderMerge();
  try {
    entry.bytes = await file.arrayBuffer();
    const PDFLib = await loadPdfLib();
    entry.doc = await PDFLib.PDFDocument.load(entry.bytes);
    entry.pages = entry.doc.getPageCount();
  } catch (e) {
    entry.error =
      e?.name === "LoadError" ? "Couldn't load the PDF library. Check your connection and try again."
      : /encrypt/i.test(e?.message || "") ? "This PDF is encrypted or password-protected, so it can't be merged."
      : "This file couldn't be opened. Is it a valid PDF?";
  }
  renderMerge();
}

function handleMerge(list) {
  const all = [...list];
  const pdfs = all.filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
  all.filter((f) => !pdfs.includes(f)).forEach((f) =>
    mfiles.push({ id: nextId++, name: f.name, bytes: null, doc: null, pages: 0, error: "Not a PDF file." }));
  if (pdfs.length < all.length) renderMerge();
  pdfs.forEach(readForMerge);
}

function move(id, to) {
  const from = mfiles.findIndex((f) => f.id === id);
  if (from < 0 || to < 0 || to >= mfiles.length || from === to) return false;
  mfiles.splice(to, 0, mfiles.splice(from, 1)[0]);
  clearResult();
  return true;
}

async function merge() {
  let failed = false;
  merging = true;
  clearResult();
  renderMerge();
  try {
    const PDFLib = await loadPdfLib();
    const out = await PDFLib.PDFDocument.create();
    for (const [i, f] of mfiles.entries()) {
      setStatus(`<span class="spinner"></span>Adding file ${i + 1} of ${mfiles.length}…`);
      const pages = await out.copyPages(f.doc, f.doc.getPageIndices());
      pages.forEach((p) => out.addPage(p));
      await new Promise((r) => setTimeout(r)); // let the status repaint
    }
    setStatus(`<span class="spinner"></span>Saving…`);
    const bytes = await out.save();
    const name = outputFileName();
    resultUrl = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    setStatus(`<span>Done: <strong>${escapeHtml(name)}</strong> · ${out.getPageCount()} pages · ${fmtBytes(bytes.byteLength)}</span>
      <a class="link-btn" href="${resultUrl}" download="${escapeHtml(name)}">Download again</a>`, "done");
    const a = Object.assign(document.createElement("a"), { href: resultUrl, download: name });
    document.body.append(a);
    a.click();
    a.remove();
  } catch {
    failed = true;
  }
  merging = false;
  renderMerge();
  if (failed) setStatus("Something went wrong while merging. One of the files may be damaged.", "error");
}

mdrop.addEventListener("click", () => minput.click());
minput.addEventListener("change", () => { handleMerge(minput.files); minput.value = ""; });
tools.merge = { zone: mdrop, handle: handleMerge };

mbtn.addEventListener("click", merge);
outName.addEventListener("input", clearResult);
outName.addEventListener("keydown", (e) => { if (e.key === "Enter" && !mbtn.disabled) merge(); });

$("#sort-name").addEventListener("click", () => {
  mfiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  clearResult();
  renderMerge();
});
$("#reverse").addEventListener("click", () => { mfiles.reverse(); clearResult(); renderMerge(); });
$("#clear").addEventListener("click", () => { mfiles.length = 0; clearResult(); renderMerge(); });

mlist.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b || merging) return;
  if (b.dataset.remove) {
    const i = mfiles.findIndex((f) => f.id === +b.dataset.remove);
    if (i >= 0) mfiles.splice(i, 1);
    clearResult();
    renderMerge();
    return;
  }
  const id = +(b.dataset.up || b.dataset.down);
  const dir = b.dataset.up ? -1 : 1;
  if (!move(id, mfiles.findIndex((f) => f.id === id) + dir)) return;
  renderMerge();
  // Keep focus on the moved file so arrows can be pressed repeatedly
  const again = mlist.querySelector(`[data-${b.dataset.up ? "up" : "down"}="${id}"]`);
  (again && !again.disabled ? again : mlist.querySelector(`[data-${b.dataset.up ? "down" : "up"}="${id}"]`))?.focus();
});

// Drag to reorder
let dragId = null, dropTarget = null;
const clearMarkers = () => mlist.querySelectorAll(".drop-before, .drop-after")
  .forEach((el) => el.classList.remove("drop-before", "drop-after"));

mlist.addEventListener("dragstart", (e) => {
  const li = e.target.closest("li");
  if (!li || merging) return e.preventDefault();
  dragId = +li.dataset.id;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", li.querySelector(".item-name").textContent);
  requestAnimationFrame(() => li.classList.add("dragging"));
});
mlist.addEventListener("dragover", (e) => {
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
mlist.addEventListener("drop", (e) => {
  if (dragId === null) return;
  e.preventDefault();
  if (dropTarget) {
    const from = mfiles.findIndex((f) => f.id === dragId);
    let to = mfiles.findIndex((f) => f.id === dropTarget.id) + (dropTarget.after ? 1 : 0);
    if (from < to) to--; // removing the dragged item shifts the target up
    move(dragId, to);
  }
});
mlist.addEventListener("dragend", () => {
  dragId = dropTarget = null;
  renderMerge();
});
