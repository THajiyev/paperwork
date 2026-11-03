"use strict";

// Images to PDF tool: turns photos and pictures into one PDF, one image per page
(() => {

// Page sizes in points, portrait
const PAGE_SIZES = { a4: [595.28, 841.89], letter: [612, 792] };
const MARGINS = { none: 0, small: 18, large: 36 }; // 0, ¼ in, ½ in
const PX_TO_PT = 0.75; // "Fit image" pages treat pixels as 96 dpi, like browsers do

// Letter is the default where it's the local paper size, A4 everywhere else
const LETTER_REGIONS = /-(US|CA|MX|PH|CL|CO|VE|GT|CR|PA|DO|PR|SV|NI)$/i;
const opts = { size: LETTER_REGIONS.test(navigator.language) ? "letter" : "a4", orient: "auto", margin: "small" };
try { Object.assign(opts, JSON.parse(localStorage.getItem("imgPdfOpts"))); } catch { /* keep defaults */ }

const images = []; // { id, name, size, url, img: { bytes, type, w, h } | null, error } in page order
let building = false;

const drop = $("#idrop"), panel = $("#images-panel"), btn = $("#images-btn");

const output = outputCard({ name: $("#img-out-name"), button: btn, status: $("#images-status"), fallback: "images" });

const list = fileList($("#images-list"), {
  items: images,
  thumb: (f) => `<span class="thumb">${f.error ? "" : `<img src="${f.url}" alt="">`}</span>`,
  meta: (f) => f.img ? `${f.img.w} × ${f.img.h} px · ${fmtBytes(f.size)}` : `<span class="spinner small"></span>Reading…`,
  busy: () => building,
  onChange: () => { output.clear(); render(); },
  onRemove: (f) => f.url && URL.revokeObjectURL(f.url),
  controls: { sort: $("#img-sort-name"), reverse: $("#img-reverse"), clear: $("#img-clear") },
});

function render() {
  const has = images.length > 0;
  panel.hidden = !has;
  drop.classList.toggle("compact", has);
  drop.querySelector(".title").textContent = has ? "Add more images" : "Drop images here or click to choose";
  list.render();
  $("#images-summary").textContent = plural(images.length, "image");

  document.querySelectorAll("#image-opts [data-opt]").forEach((group) => {
    group.querySelectorAll("button").forEach((b) => {
      b.setAttribute("aria-pressed", b.dataset.value === opts[group.dataset.opt]);
      // Orientation only applies to fixed page sizes
      b.disabled = group.dataset.opt === "orient" && opts.size === "fit";
    });
  });

  const ready = images.filter((f) => f.img).length;
  const loading = images.some((f) => !f.img && !f.error);
  const broken = images.some((f) => f.error);
  btn.disabled = building || loading || broken || ready < 1;
  btn.textContent = building ? "Creating PDF…" : "Create PDF";
  if (!building && !output.hasResult()) {
    output.set(broken ? "Remove the images that couldn't be read to continue." : "", broken ? "error" : "");
  }
}

// EXIF orientation of a JPEG (1 = upright), so sideways phone photos can be straightened
function jpegOrientation(bytes) {
  try {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let p = 2; p + 4 < bytes.length; p += 2 + v.getUint16(p + 2)) {
      if (bytes[p] !== 0xff || bytes[p + 1] === 0xda) return 1; // bad marker or start of image data
      if (bytes[p + 1] === 0xe1 && v.getUint32(p + 4) === 0x45786966) { // APP1 "Exif"
        const tiff = p + 10, le = v.getUint16(tiff) === 0x4949;
        const ifd = tiff + v.getUint32(tiff + 4, le);
        for (let i = 0, n = v.getUint16(ifd, le); i < n; i++) {
          const entry = ifd + 2 + i * 12;
          if (v.getUint16(entry, le) === 0x0112) return v.getUint16(entry + 8, le);
        }
        return 1;
      }
    }
  } catch { /* malformed EXIF: treat as upright */ }
  return 1;
}

// Returns image data pdf-lib can embed. JPEG and PNG are kept as they are (no quality loss);
// rotated JPEGs and other formats (WebP, GIF, BMP…) are redrawn through a canvas.
async function prepare(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  // Decoding also validates the file; the bitmap is already turned upright per EXIF
  const bitmap = await createImageBitmap(file);
  const w = bitmap.width, h = bitmap.height;
  try {
    if (isPng) return { bytes, type: "png", w, h };
    if (isJpg && jpegOrientation(bytes) === 1) return { bytes, type: "jpg", w, h };
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    const type = isJpg ? "jpg" : "png";
    const blob = await new Promise((r) => canvas.toBlob(r, type === "jpg" ? "image/jpeg" : "image/png", 0.92));
    return { bytes: new Uint8Array(await blob.arrayBuffer()), type, w, h };
  } finally {
    bitmap.close();
  }
}

async function read(file) {
  const entry = { id: nextId++, name: file.name, size: file.size, url: URL.createObjectURL(file), img: null, error: null };
  images.push(entry);
  output.clear();
  render();
  try {
    entry.img = await prepare(file);
  } catch {
    entry.error = /\.hei[cf]$/i.test(file.name)
      ? "HEIC photos aren't supported by this browser. Export as JPG first."
      : "This image couldn't be read. Try JPG or PNG.";
  }
  render();
}

function handle(list) {
  const all = [...list];
  const pics = all.filter((f) => f.type.startsWith("image/") || /\.(jpe?g|png|gif|webp|bmp|avif|hei[cf])$/i.test(f.name));
  all.filter((f) => !pics.includes(f)).forEach((f) =>
    images.push({ id: nextId++, name: f.name, size: f.size, url: null, img: null, error: "Not an image file." }));
  if (pics.length < all.length) render();
  pics.forEach(read);
}

// Page size and image placement for one image, in points
function layout(img) {
  const m = MARGINS[opts.margin];
  const iw = img.w * PX_TO_PT, ih = img.h * PX_TO_PT;
  if (opts.size === "fit") return { pw: iw + 2 * m, ph: ih + 2 * m, x: m, y: m, w: iw, h: ih };
  let [pw, ph] = PAGE_SIZES[opts.size];
  if (opts.orient === "landscape" || (opts.orient === "auto" && iw > ih)) [pw, ph] = [ph, pw];
  // Scale to fit inside the margins, centered
  const s = Math.min((pw - 2 * m) / iw, (ph - 2 * m) / ih);
  return { pw, ph, x: (pw - iw * s) / 2, y: (ph - ih * s) / 2, w: iw * s, h: ih * s };
}

async function build() {
  let failed = false;
  building = true;
  output.clear();
  render();
  try {
    const PDFLib = await loadPdfLib();
    const out = await PDFLib.PDFDocument.create();
    for (const [i, f] of images.entries()) {
      output.set(`<span class="spinner"></span>Adding image ${i + 1} of ${images.length}…`);
      const embedded = f.img.type === "jpg" ? await out.embedJpg(f.img.bytes) : await out.embedPng(f.img.bytes);
      const { pw, ph, x, y, w, h } = layout(f.img);
      out.addPage([pw, ph]).drawImage(embedded, { x, y, width: w, height: h });
      await new Promise((r) => setTimeout(r)); // let the status repaint
    }
    output.set(`<span class="spinner"></span>Saving…`);
    output.done(await out.save(), out.getPageCount());
  } catch {
    failed = true;
  }
  building = false;
  render();
  if (failed) output.set("Something went wrong while creating the PDF. One of the images may be damaged.", "error");
}

$("#image-opts").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-value]");
  if (!b || building) return;
  opts[b.closest("[data-opt]").dataset.opt] = b.dataset.value;
  localStorage.setItem("imgPdfOpts", JSON.stringify(opts));
  output.clear();
  render();
});

registerTool("images", { zone: drop, input: $("#ifile"), handle });
btn.addEventListener("click", build);
render();

})();
