/* WhatsApp Sender · Rotaract Club of Rubaga
   Everything runs in the browser. Contact lists, messages and flyers are never uploaded. */
(() => {
  "use strict";

  const DEFAULT_TPL = "Hello {Name} 👋\n\nI hope you are doing well. This is a friendly reminder about our upcoming fellowship.\n\nLooking forward to seeing you! 🙏";
  const $ = id => document.getElementById(id);
  const P = "wasender2_";
  const store = {
    get(k, d) { try { const v = localStorage.getItem(P + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(P + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(P + k); } catch (e) {} }
  };

  // ---------------- state ----------------
  let data = store.get("data", null);        // {fileName, headers, rows, mapName, mapPhone, loadedAt}
  let sent = store.get("sent", {});          // {number: timestamp}
  let flyerCopied = {};                      // {number: true} for this session
  let flyer = null;                          // {file, png, url, name, w, h}
  let filter = "all", query = "", pvIndex = 0;
  let contacts = [];                         // derived from data

  const isTouch = matchMedia("(pointer:coarse)").matches;
  const canClipImage = !!(navigator.clipboard && window.ClipboardItem);

  $("tpl").value = store.get("tpl", DEFAULT_TPL);
  $("cc").value = store.get("cc", "256");

  // ---------------- helpers ----------------
  const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const fmtTime = ts => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const fmtSize = b => b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB";
  const PALETTE = ["#00A884", "#1A73E8", "#E37400", "#9334E6", "#D93025", "#00897B", "#C5221F", "#188038", "#5F6368", "#B06000"];
  const colorFor = s => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };
  const initials = s => String(s || "?").trim().split(/\s+/).slice(0, 2).map(w => w[0] || "").join("").toUpperCase() || "?";

  function toast(msg, ms = 3400) {
    const t = $("toast"); t.innerHTML = msg; t.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), ms);
  }

  function cleanNumber(p) {
    const d = String(p ?? "").replace(/\D/g, "");
    const cc = $("cc").value.replace(/\D/g, "");
    if (!d) return "";
    if (d.startsWith("00")) return d.slice(2);
    if (d.startsWith("0")) return cc + d.slice(1);
    if (d.length <= 9) return cc + d;
    return d;
  }
  const prettyNum = n => "+" + (n.length === 12 ? n.replace(/^(\d{3})(\d{3})(\d{3})(\d{3})$/, "$1 $2 $3 $4") : n);
  const waLink = (num, msg) => "https://wa.me/" + num + "?text=" + encodeURIComponent(msg);

  const cleanHeader = (h, i) => {
    const s = String(h ?? "").replace(/\*/g, "").replace(/\((optional|auto|required)\)/ig, "").replace(/\s+/g, " ").trim();
    return s || "Column " + String.fromCharCode(65 + (i % 26));
  };
  const isAutoCol = h => /^no\.?$|\(auto\)|^sent\??$|^#$/i.test(String(h).trim());

  // ---------------- contacts ----------------
  function placeholderDefs() {
    const defs = [{ token: "Name", get: c => c.name }, { token: "First Name", get: c => c.first }];
    if (!data) return defs;
    const seen = new Set(defs.map(d => d.token.toLowerCase()));
    data.headers.forEach((h, i) => {
      if (i === data.mapPhone || i === data.mapName || isAutoCol(h)) return;
      const t = cleanHeader(h, i);
      if (seen.has(t.toLowerCase())) return;
      seen.add(t.toLowerCase());
      defs.push({ token: t, get: c => c.row[i] ?? "" });
    });
    return defs;
  }

  function buildContacts() {
    contacts = [];
    if (!data) return;
    const seen = {};
    data.rows.forEach(row => {
      const name = String(row[data.mapName] ?? "").trim();
      const phone = String(row[data.mapPhone] ?? "").trim();
      if (!name && !phone) return;
      const num = cleanNumber(phone);
      const valid = num.length >= 10 && num.length <= 15;
      const c = { i: contacts.length, row, name: name || "(no name)", first: (name.split(/\s+/)[0] || ""), phone, num, valid, dupOf: null };
      if (valid) { if (seen[num] !== undefined) c.dupOf = seen[num]; else seen[num] = c.i; }
      contacts.push(c);
    });
  }
  const sendable = c => c.valid && c.dupOf === null;
  const isSent = c => sendable(c) && !!sent[c.num];

  // All tokens the message may use: the chips plus short aliases (e.g. {Extra} for "Extra Info").
  function tokenMap() {
    const defs = placeholderDefs(), map = {};
    defs.forEach(d => map[d.token.toLowerCase()] = d);
    defs.forEach(d => { const a = d.token.split(" ")[0].toLowerCase(); if (!map[a]) map[a] = d; });
    return map;
  }
  function personalise(c) {
    const map = tokenMap();
    return $("tpl").value.replace(/\{([^{}\n]+)\}/g, (m, t) => { const d = map[t.trim().toLowerCase()]; return d ? String(d.get(c)) : m; });
  }

  // ---------------- file loading ----------------
  function detectHeaderRow(rows) {
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const txt = (rows[i] || []).join(" | ");
      if (/name/i.test(txt) && /phone|mobile|number|contact|tel|whatsapp/i.test(txt)) return i;
    }
    return -1;
  }
  function guessCols(headers) {
    const H = headers.map(h => String(h).toLowerCase());
    const find = (re, not) => H.findIndex(h => re.test(h) && !(not && not.test(h)));
    let n = find(/first\s*name/); if (n < 0) n = find(/name/, /full|last|sur/); if (n < 0) n = find(/name/);
    let p = find(/phone|mobile|tel|contact/, /auto/); if (p < 0) p = find(/number|whatsapp/, /auto|^no\.?$/);
    return { n: n < 0 ? 0 : n, p: p < 0 ? Math.min(1, headers.length - 1) : p };
  }

  function loadFile(f) {
    if (!f) return;
    if (typeof XLSX === "undefined") { toast("The Excel reader failed to load. Refresh the page and try again."); return; }
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const wb = XLSX.read(ev.target.result, { type: "array" });
        const sheetName = wb.SheetNames.includes("Contacts") ? "Contacts" : (wb.SheetNames.find(n => !/how to|settings|instructions/i.test(n)) || wb.SheetNames[0]);
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: false, defval: "" })
          .map(r => r.map(v => String(v ?? "").trim()));
        let h = detectHeaderRow(rows), headers, body;
        if (h >= 0) { headers = rows[h]; body = rows.slice(h + 1); }
        else { const w = Math.max(2, ...rows.map(r => r.length)); headers = Array.from({ length: w }, (_, i) => "Column " + String.fromCharCode(65 + i)); body = rows; }
        // drop empty rows and the untouched template example (Sarah, 0772 123 456)
        body = body.filter(r => r.some(v => v) && !(/example row/i.test(r.join(" ")) && r.includes("Sarah") && r.includes("0772 123 456")));
        const g = guessCols(headers);
        data = { fileName: f.name, headers, rows: body, mapName: g.n, mapPhone: g.p, loadedAt: Date.now() };
        if (!store.set("data", data)) toast("List loaded, but it's too large to remember after you close this page.");

        // Take the message from the template's Settings tab only if the composer hasn't been edited.
        const st = wb.Sheets["Settings"];
        if (st) {
          const cur = $("tpl").value.trim();
          if (st.B5 && st.B5.v && (!cur || cur === DEFAULT_TPL.trim())) { $("tpl").value = String(st.B5.v); store.set("tpl", $("tpl").value); }
          if (st.B3 && st.B3.v) { $("cc").value = String(st.B3.v).replace(/\D/g, ""); store.set("cc", $("cc").value); }
        }
        pvIndex = 0;
        refreshAll();
        const n = contacts.length;
        toast(`<b>${n}</b> contact${n === 1 ? "" : "s"} loaded from ${esc(f.name)}`);
      } catch (err) { toast("Couldn't read that file: " + esc(err.message)); }
    };
    reader.readAsArrayBuffer(f);
  }

  function setupDrop(zone, input, handler) {
    ["dragenter", "dragover"].forEach(e => zone.addEventListener(e, ev => { ev.preventDefault(); zone.classList.add("drag"); }));
    ["dragleave", "drop"].forEach(e => zone.addEventListener(e, ev => { ev.preventDefault(); zone.classList.remove("drag"); }));
    zone.addEventListener("drop", ev => { const f = ev.dataTransfer.files[0]; if (f) handler(f); });
    input.addEventListener("change", e => { handler(e.target.files[0]); e.target.value = ""; });
  }
  setupDrop($("dropzone"), $("file"), loadFile);
  $("replaceBtn").addEventListener("click", () => $("file").click());

  $("clearAll").addEventListener("click", confirmClick($("clearAll"), '<span class="ms">delete</span> Click to confirm', () => {
    data = null; sent = {}; flyerCopied = {};
    store.del("data"); store.del("sent");
    refreshAll(); toast("Contact list removed from this device.");
  }));

  function renderUpload() {
    const has = !!data;
    $("dropzone").hidden = has; $("fileBar").hidden = !has; $("mapping").hidden = !has;
    if (!has) return;
    $("fileName").textContent = data.fileName;
    $("fileMeta").textContent = `${contacts.length} contact${contacts.length === 1 ? "" : "s"} · ${data.headers.length} columns · loaded ${new Date(data.loadedAt).toLocaleDateString()} ${fmtTime(data.loadedAt)}`;
    const opts = data.headers.map((h, i) => `<option value="${i}">${esc(cleanHeader(h, i))}</option>`).join("");
    $("mapName").innerHTML = opts; $("mapPhone").innerHTML = opts;
    $("mapName").value = data.mapName; $("mapPhone").value = data.mapPhone;
  }
  ["mapName", "mapPhone"].forEach(id => $(id).addEventListener("change", () => {
    data[id] = +$(id).value; store.set("data", data); refreshAll();
  }));
  $("cc").addEventListener("input", () => { store.set("cc", $("cc").value); refreshAll(); });

  // ---------------- composer ----------------
  function renderChips() {
    $("phChips").innerHTML = placeholderDefs().map(d =>
      `<button class="chip" data-token="${esc(d.token)}"><span class="ms">add</span>{${esc(d.token)}}</button>`).join("");
    $("phChips").querySelectorAll(".chip").forEach(b => b.addEventListener("click", () => insertAtCursor("{" + b.dataset.token + "}")));
  }
  function insertAtCursor(text) {
    const t = $("tpl"), s = t.selectionStart ?? t.value.length, e = t.selectionEnd ?? s;
    t.value = t.value.slice(0, s) + text + t.value.slice(e);
    t.focus(); t.selectionStart = t.selectionEnd = s + text.length;
    onTplChange();
  }
  function wrapSelection(mark) {
    const t = $("tpl"), s = t.selectionStart, e = t.selectionEnd;
    const sel = t.value.slice(s, e) || "text";
    t.value = t.value.slice(0, s) + mark + sel + mark + t.value.slice(e);
    t.focus(); t.selectionStart = s + 1; t.selectionEnd = s + 1 + sel.length;
    onTplChange();
  }
  document.querySelectorAll(".tb[data-wrap]").forEach(b => b.addEventListener("click", () => wrapSelection(b.dataset.wrap)));
  document.querySelectorAll(".tb[data-ins]").forEach(b => b.addEventListener("click", () => insertAtCursor(b.dataset.ins)));
  $("resetMsg").addEventListener("click", confirmClick($("resetMsg"), '<span class="ms">check</span>', () => { $("tpl").value = DEFAULT_TPL; onTplChange(); }));

  let tplTimer;
  function onTplChange() {
    store.set("tpl", $("tpl").value);
    renderTplMeta(); renderPreview();
    clearTimeout(tplTimer); tplTimer = setTimeout(renderList, 250);
  }
  $("tpl").addEventListener("input", onTplChange);

  function renderTplMeta() {
    const v = $("tpl").value;
    $("charCount").textContent = `${[...v].length} characters`;
    const known = new Set(Object.keys(tokenMap()));
    const unknown = [...new Set([...v.matchAll(/\{([^{}\n]+)\}/g)].map(m => m[1].trim()).filter(t => !known.has(t.toLowerCase())))];
    $("tplWarn").innerHTML = unknown.length ? `<span class="ms tiny">warning</span> Unknown placeholder${unknown.length > 1 ? "s" : ""}: ${unknown.map(u => "{" + esc(u) + "}").join(", ")}` : "";
  }

  // ---------------- preview ----------------
  function waFormat(text) {
    let h = esc(text);
    h = h.replace(/\{([^{}\n]+)\}/g, '<span class="ph-miss">{$1}</span>');
    const B = "(^|[\\s>(])", A = "(?=[\\s.,!?:;)<]|$)";
    h = h.replace(new RegExp(B + "\\*([^*\\n]+)\\*" + A, "gm"), "$1<b>$2</b>")
         .replace(new RegExp(B + "_([^_\\n]+)_" + A, "gm"), "$1<i>$2</i>")
         .replace(new RegExp(B + "~([^~\\n]+)~" + A, "gm"), "$1<s>$2</s>");
    return h;
  }
  function sampleContact() {
    const row = data ? data.headers.map((h, i) => "‹" + cleanHeader(h, i) + "›") : [];
    return { name: "Sarah Nakato", first: "Sarah", num: "256700000000", row };
  }
  function renderPreview() {
    const list = contacts.filter(sendable);
    if (pvIndex >= list.length) pvIndex = 0;
    const c = list.length ? list[pvIndex] : sampleContact();
    $("pvIdx").textContent = list.length ? `${pvIndex + 1} of ${list.length}` : "Sample";
    $("pvName").textContent = c.name;
    $("pvNum").textContent = prettyNum(c.num);
    $("pvAvatar").textContent = initials(c.name);
    $("pvAvatar").style.background = colorFor(c.name);
    $("pvText").innerHTML = waFormat(personalise(c)) || '<span class="muted">Your message will appear here…</span>';
    $("pvTime").textContent = fmtTime(Date.now());
    if (flyer) { $("pvImg").src = flyer.url; $("pvImg").hidden = false; } else $("pvImg").hidden = true;
  }
  function bump() { const b = $("pvBubble"); b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop"); }
  $("pvPrev").addEventListener("click", () => { const n = contacts.filter(sendable).length; if (n) { pvIndex = (pvIndex - 1 + n) % n; renderPreview(); bump(); } });
  $("pvNext").addEventListener("click", () => { const n = contacts.filter(sendable).length; if (n) { pvIndex = (pvIndex + 1) % n; renderPreview(); bump(); } });

  // ---------------- flyer ----------------
  function toPng(blob) {
    return new Promise((resolve, reject) => {
      const img = new Image(), url = URL.createObjectURL(blob);
      img.onload = () => {
        const cv = document.createElement("canvas");
        cv.width = img.naturalWidth; cv.height = img.naturalHeight;
        cv.getContext("2d").drawImage(img, 0, 0);
        cv.toBlob(b => b ? resolve({ png: b, url, w: img.naturalWidth, h: img.naturalHeight }) : reject(new Error("Could not convert the image")), "image/png");
      };
      img.onerror = () => reject(new Error("That file isn't a readable image"));
      img.src = url;
    });
  }
  async function setFlyer(file, persist = true) {
    if (!file) return;
    try {
      const r = await toPng(file);
      if (flyer) URL.revokeObjectURL(flyer.url);
      flyer = { file, png: r.png, url: r.url, name: file.name || "flyer.png", w: r.w, h: r.h };
      flyerCopied = {};
      if (persist) {
        const fr = new FileReader();
        fr.onload = () => { if (!store.set("flyer", { name: flyer.name, type: file.type, data: fr.result })) store.del("flyer"); };
        fr.readAsDataURL(file);
      }
      renderFlyer(); renderPreview(); renderList();
    } catch (err) { toast(esc(err.message)); }
  }
  function renderFlyer() {
    $("flyerThumb").hidden = !flyer;
    $("flyerTip").innerHTML = flyer
      ? (isTouch && canShareFiles() ? "Use <b>Share</b> to send the flyer with the message." : "Click <b>Copy flyer</b>, then <b>Send message</b>, and paste the flyer in the chat with <b>Ctrl+V</b>.")
      : "Add a flyer to get a <b>Copy flyer</b> button per contact.";
    if (!flyer) return;
    $("flyerImg").src = flyer.url;
    $("flyerName").textContent = flyer.name;
    $("flyerMeta").textContent = `${flyer.w} × ${flyer.h}px · ${fmtSize(flyer.file.size)}`;
  }
  setupDrop($("flyerDrop"), $("flyer"), f => setFlyer(f));
  $("flyerRemove").addEventListener("click", () => {
    if (flyer) URL.revokeObjectURL(flyer.url);
    flyer = null; flyerCopied = {}; store.del("flyer");
    renderFlyer(); renderPreview(); renderList();
  });
  $("flyerCopyTest").addEventListener("click", () => copyFlyer());

  async function copyFlyer(c) {
    if (!flyer) return false;
    if (!canClipImage) { toast("This browser can't copy images. Try Chrome or Edge, or use Share on a phone."); return false; }
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": flyer.png })]);
      if (c) { flyerCopied[c.num] = true; renderList(); }
      toast(`<span class="ms tiny">check_circle</span> Flyer copied. Paste it in the chat with <b>Ctrl+V</b> (Cmd+V on Mac).`);
      return true;
    } catch (err) { toast("Your browser blocked copying the image. Click the page once and try again."); return false; }
  }
  function canShareFiles() {
    if (!flyer || !navigator.canShare) return false;
    try { return navigator.canShare({ files: [new File([flyer.png], "flyer.png", { type: "image/png" })] }); } catch (e) { return false; }
  }
  async function shareFlyer(c) {
    const msg = personalise(c);
    const type = flyer.file.type || "image/png";
    const file = new File([flyer.file], "flyer." + (type.split("/")[1] || "png").replace("jpeg", "jpg"), { type });
    try { await navigator.clipboard.writeText(msg); } catch (e) {}
    try { await navigator.share({ files: [file], text: msg }); markSent(c, true); }
    catch (err) { if (err.name !== "AbortError") toast("Sharing isn't available here. Use Send message and attach the flyer in WhatsApp."); }
  }

  // ---------------- sending ----------------
  function markSent(c, val) {
    if (val) sent[c.num] = Date.now(); else delete sent[c.num];
    store.set("sent", sent);
    renderStats(); renderList();
  }
  $("sendNext").addEventListener("click", () => {
    const c = contacts.find(x => sendable(x) && !sent[x.num]);
    if (!c) { toast(contacts.length ? "🎉 Everyone has been sent the message." : "Upload your contacts first."); return; }
    if (filter === "sent") setFilter("all");
    const copying = flyer && canClipImage ? copyFlyer(c) : null;   // starts while this page still has focus
    window.open(waLink(c.num, personalise(c)), "_blank", "noopener");
    markSent(c, true);
    const el = document.querySelector(`.item[data-i="${c.i}"]`);
    if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.classList.add("flash"); }
    if (!copying) toast(`Opened chat with <b>${esc(c.name)}</b>`);
  });

  function setFilter(f) {
    filter = f;
    document.querySelectorAll("#filters button").forEach(b => b.classList.toggle("on", b.dataset.f === f));
    renderList();
  }
  document.querySelectorAll("#filters button").forEach(b => b.addEventListener("click", () => setFilter(b.dataset.f)));
  $("search").addEventListener("input", e => { query = e.target.value.trim().toLowerCase(); renderList(); });
  $("resetSent").addEventListener("click", confirmClick($("resetSent"), '<span class="ms">history</span> Click to confirm', () => {
    sent = {}; flyerCopied = {}; store.set("sent", sent); renderStats(); renderList(); toast("Progress reset.");
  }));

  const EMPTY_SVG = `<svg viewBox="0 0 150 110" aria-hidden="true"><ellipse cx="75" cy="98" rx="52" ry="7" fill="#E3EAE7"/><rect x="38" y="18" width="74" height="74" rx="16" fill="#E7F8F2"/><rect x="50" y="34" width="50" height="8" rx="4" fill="#BFE0D4"/><rect x="50" y="50" width="38" height="8" rx="4" fill="#BFE0D4"/><rect x="50" y="66" width="44" height="8" rx="4" fill="#BFE0D4"/><circle cx="108" cy="24" r="14" fill="#00A884"/><path d="M102 24h12M108 18v12" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>`;

  function renderList() {
    const list = $("list");
    const counts = { all: contacts.length, pending: 0, sent: 0, issues: 0 };
    contacts.forEach(c => { if (!sendable(c)) counts.issues++; else if (sent[c.num]) counts.sent++; else counts.pending++; });
    $("fAll").textContent = counts.all; $("fPending").textContent = counts.pending; $("fSent").textContent = counts.sent; $("fIssues").textContent = counts.issues;

    if (!contacts.length) {
      list.innerHTML = `<div class="empty">${EMPTY_SVG}<b>No contacts yet</b>Upload an Excel file with names and phone numbers to start.<div class="mt8"><a class="btn btn-tonal sm" href="#upload"><span class="ms">upload_file</span> Upload contacts</a></div></div>`;
      return;
    }
    const share = isTouch && canShareFiles();
    const rows = contacts.filter(c => {
      if (filter === "pending" && !(sendable(c) && !sent[c.num])) return false;
      if (filter === "sent" && !isSent(c)) return false;
      if (filter === "issues" && sendable(c)) return false;
      if (query && !(`${c.name} ${c.phone} ${c.num}`.toLowerCase().includes(query))) return false;
      return true;
    });
    if (!rows.length) { list.innerHTML = `<div class="empty">${EMPTY_SVG}<b>Nothing here</b>No contacts match this view.</div>`; return; }

    list.innerHTML = rows.map(c => {
      const ok = sendable(c), done = ok && !!sent[c.num];
      let pills = "";
      if (!c.valid) pills += `<span class="pill bad"><span class="ms">error</span>Invalid number</span>`;
      else if (c.dupOf !== null) pills += `<span class="pill dup"><span class="ms">content_copy</span>Duplicate of #${c.dupOf + 1}</span>`;
      else if (done) pills += `<span class="pill ok"><span class="ms">done_all</span>Sent ${fmtTime(sent[c.num])}</span>`;
      else pills += `<span class="pill pend"><span class="ms">schedule</span>Pending</span>`;
      if (flyer && flyerCopied[c.num]) pills += `<span class="pill fly"><span class="ms">image</span>Flyer copied</span>`;
      const msg = personalise(c);
      let acts = "";
      if (ok) {
        if (flyer && share) acts += `<button class="btn btn-outline sm" data-a="share"><span class="ms">share</span> Share</button>`;
        else if (flyer) acts += `<button class="btn btn-outline sm${flyerCopied[c.num] ? " done" : ""}" data-a="copy"><span class="ms">${flyerCopied[c.num] ? "check" : "content_copy"}</span> Copy flyer</button>`;
        acts += `<a class="btn btn-send sm" data-a="send" href="${esc(waLink(c.num, msg))}" target="_blank" rel="noopener"><span class="ms">send</span> Send message</a>`;
        acts += `<button class="icon-btn" data-a="toggle" title="${done ? "Mark as not sent" : "Mark as sent"}"><span class="ms">${done ? "undo" : "check_circle"}</span></button>`;
      } else {
        acts += `<span class="btn btn-send sm disabled"><span class="ms">block</span> ${c.valid ? "Already listed" : "Fix number"}</span>`;
      }
      return `<div class="item${done ? " sent" : ""}" data-i="${c.i}">
        <span class="avatar" style="background:${colorFor(c.name)}">${esc(initials(c.name))}</span>
        <div class="who">
          <div class="who-top"><b>${esc(c.name)}</b>${pills}</div>
          <span class="num">${c.valid ? prettyNum(c.num) : esc(c.phone || "No number")}</span>
          <div class="msg-snip" title="Click to expand">${esc(msg)}</div>
        </div>
        <div class="acts">${acts}</div>
      </div>`;
    }).join("");

    list.querySelectorAll(".item").forEach(el => {
      const c = contacts[+el.dataset.i];
      el.querySelector(".msg-snip").addEventListener("click", e => e.currentTarget.classList.toggle("open"));
      el.querySelectorAll("[data-a]").forEach(b => b.addEventListener("click", () => {
        const a = b.dataset.a;
        if (a === "send") setTimeout(() => markSent(c, true), 200);
        else if (a === "copy") copyFlyer(c);
        else if (a === "share") shareFlyer(c);
        else if (a === "toggle") markSent(c, !sent[c.num]);
      }));
    });
  }

  // ---------------- statistics ----------------
  function renderStats() {
    const total = contacts.length;
    const ok = contacts.filter(sendable);
    const sentList = ok.filter(c => sent[c.num]);
    $("stTotal").textContent = total;
    $("stValid").textContent = ok.length;
    $("stSent").textContent = sentList.length;
    $("stPending").textContent = ok.length - sentList.length;
    $("stIssues").textContent = total - ok.length;
    const pct = ok.length ? Math.round(sentList.length / ok.length * 100) : 0;
    $("ringPct").textContent = pct + "%";
    $("ringFg").style.strokeDashoffset = 314.16 * (1 - pct / 100);

    const ts = sentList.map(c => sent[c.num]).sort((a, b) => a - b);
    const svg = $("actChart"), N = 24, W = 300, H = 70;
    if (!ts.length) {
      svg.innerHTML = Array.from({ length: N }, (_, i) => `<rect x="${i * (W / N) + 2}" y="${H - 4}" width="${W / N - 4}" height="4" rx="2" fill="#E3EAE7"/>`).join("");
      $("paceTxt").textContent = "No messages sent yet"; $("actFrom").textContent = ""; $("etaTxt").textContent = "";
      return;
    }
    const end = Math.max(Date.now(), ts[ts.length - 1]);
    const start = Math.min(ts[0], end - 20 * 60000);
    const step = (end - start) / N;
    const buckets = new Array(N).fill(0);
    ts.forEach(t => buckets[Math.min(N - 1, Math.max(0, Math.floor((t - start) / step)))]++);
    const max = Math.max(...buckets, 1);
    svg.innerHTML = buckets.map((v, i) => {
      const h = v ? Math.max(6, (v / max) * (H - 6)) : 4;
      return `<rect x="${i * (W / N) + 2}" y="${H - h}" width="${W / N - 4}" height="${h}" rx="3" fill="${v ? "#00A884" : "#E3EAE7"}"><title>${v} sent</title></rect>`;
    }).join("");
    const mins = (ts[ts.length - 1] - ts[0]) / 60000;
    const pace = ts.length > 1 && mins > 0.2 ? ts.length / mins : null;
    $("paceTxt").textContent = pace ? `${pace.toFixed(1)} messages per minute` : `${ts.length} sent`;
    $("actFrom").textContent = "Started " + fmtTime(ts[0]);
    const left = ok.length - sentList.length;
    $("etaTxt").textContent = left === 0 ? "All done 🎉" : pace ? `About ${Math.max(1, Math.ceil(left / pace))} min left` : `${left} to go`;
  }

  $("exportBtn").addEventListener("click", () => {
    if (!contacts.length) { toast("Upload contacts first."); return; }
    const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [["No.", "Name", "Phone (as entered)", "WhatsApp number", "Status", "Sent at", "Message"].map(q).join(",")];
    contacts.forEach(c => {
      const status = !c.valid ? "Invalid number" : c.dupOf !== null ? "Duplicate" : sent[c.num] ? "Sent" : "Pending";
      lines.push([c.i + 1, c.name, c.phone, c.valid ? "+" + c.num : "", status, sendable(c) && sent[c.num] ? new Date(sent[c.num]).toLocaleString() : "", personalise(c)].map(q).join(","));
    });
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `whatsapp-report-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });

  // ---------------- misc ----------------
  function confirmClick(btn, armedHtml, fn) {
    const orig = btn.innerHTML;
    return () => {
      if (btn.dataset.armed) { delete btn.dataset.armed; btn.innerHTML = orig; fn(); return; }
      btn.dataset.armed = "1"; btn.innerHTML = armedHtml;
      setTimeout(() => { if (btn.dataset.armed) { delete btn.dataset.armed; btn.innerHTML = orig; } }, 3000);
    };
  }

  function refreshAll() {
    buildContacts();
    renderUpload(); renderChips(); renderTplMeta(); renderPreview(); renderFlyer(); renderStats(); renderList();
  }

  (async () => {
    const f = store.get("flyer", null);
    if (f && f.data) {
      try { const blob = await (await fetch(f.data)).blob(); await setFlyer(new File([blob], f.name, { type: f.type || blob.type }), false); } catch (e) { store.del("flyer"); }
    }
  })();

  refreshAll();
  setInterval(renderStats, 60000);
})();
