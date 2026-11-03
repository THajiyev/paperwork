"use strict";

// Merge tool: combines several PDFs into one, in the order the user picks
(() => {

const files = []; // { id, name, bytes, doc, pages, error } in merge order
let merging = false;

const drop = $("#mdrop"), panel = $("#merge-panel"), btn = $("#merge-btn");

const output = outputCard({ name: $("#out-name"), button: btn, status: $("#merge-status"), fallback: "merged" });

const list = fileList($("#merge-list"), {
  items: files,
  meta: (f) => f.doc ? `${plural(f.pages, "page")} · ${fmtBytes(f.bytes.byteLength)}` : `<span class="spinner small"></span>Reading…`,
  busy: () => merging,
  onChange: () => { output.clear(); render(); },
  controls: { sort: $("#sort-name"), reverse: $("#reverse"), clear: $("#clear") },
});

function render() {
  const has = files.length > 0;
  panel.hidden = !has;
  drop.classList.toggle("compact", has);
  drop.querySelector(".title").textContent = has ? "Add more PDFs" : "Drop PDFs here or click to choose";
  list.render();

  const ready = files.filter((f) => f.doc);
  const pages = ready.reduce((n, f) => n + f.pages, 0);
  $("#merge-summary").textContent = plural(files.length, "file") + (pages ? ` · ${pages} pages total` : "");

  const loading = files.some((f) => !f.doc && !f.error);
  const broken = files.some((f) => f.error);
  btn.disabled = merging || loading || broken || ready.length < 2;
  btn.textContent = merging ? "Merging…" : `Merge ${ready.length >= 2 ? ready.length + " " : ""}PDFs`;
  if (!merging && !output.hasResult()) {
    if (broken) output.set("Remove the files that couldn't be read to continue.", "error");
    else if (!loading && ready.length === 1) output.set("Add at least one more PDF to merge.");
    else output.set("");
  }
}

async function read(file) {
  const entry = { id: nextId++, name: file.name, bytes: null, doc: null, pages: 0, error: null };
  files.push(entry);
  output.clear();
  render();
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
  render();
}

function handle(list) {
  const all = [...list];
  const pdfs = all.filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
  all.filter((f) => !pdfs.includes(f)).forEach((f) =>
    files.push({ id: nextId++, name: f.name, bytes: null, doc: null, pages: 0, error: "Not a PDF file." }));
  if (pdfs.length < all.length) render();
  pdfs.forEach(read);
}

async function merge() {
  let failed = false;
  merging = true;
  output.clear();
  render();
  try {
    const PDFLib = await loadPdfLib();
    const out = await PDFLib.PDFDocument.create();
    for (const [i, f] of files.entries()) {
      output.set(`<span class="spinner"></span>Adding file ${i + 1} of ${files.length}…`);
      const pages = await out.copyPages(f.doc, f.doc.getPageIndices());
      pages.forEach((p) => out.addPage(p));
      await new Promise((r) => setTimeout(r)); // let the status repaint
    }
    output.set(`<span class="spinner"></span>Saving…`);
    output.done(await out.save(), out.getPageCount());
  } catch {
    failed = true;
  }
  merging = false;
  render();
  if (failed) output.set("Something went wrong while merging. One of the files may be damaged.", "error");
}

registerTool("merge", { zone: drop, input: $("#mfile"), handle });
btn.addEventListener("click", merge);

})();
