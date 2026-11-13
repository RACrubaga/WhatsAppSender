/* WhatsApp Sender: everything runs in the browser. Nothing is uploaded. */
(() => {
  "use strict";

  const DEFAULT_TPL = "Hello {Name}, I hope you are doing well. This is a friendly reminder about {Extra}. Looking forward to seeing you. Thank you!";
  const $ = id => document.getElementById(id);

  // ---------- storage (local to this browser only) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem("wasender_" + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("wasender_" + k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem("wasender_" + k); } catch (e) {} }
  };

  let contacts = store.get("contacts", []);
  let sent = store.get("sent", {});
  let flyer = null;          // { file: File, png: Blob, url: string }

  $("tpl").value = store.get("tpl", DEFAULT_TPL);
  $("cc").value = store.get("cc", "256");

  const isTouch = matchMedia("(pointer:coarse)").matches;
  const canClipImage = !!(navigator.clipboard && window.ClipboardItem);

  // ---------- helpers ----------
  const esc = s => String(s ?? "").replace(/[&<>"]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));

  function toast(msg, ms = 3200) {
    const t = $("toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), ms);
  }

  function cleanNumber(p) {
    const d = String(p ?? "").replace(/\D/g, "");
    const cc = $("cc").value.replace(/\D/g, "");
    if (!d) return "";
    if (d.startsWith("0")) return cc + d.slice(1);
    if (d.length <= 9) return cc + d;
    return d;
  }
  const personalise = c => $("tpl").value.split("{Name}").join((c.first || "").trim()).split("{Extra}").join(c.extra || "");
  const keyOf = c => cleanNumber(c.phone) + "|" + (c.first || "").trim().toLowerCase();
  const waLink = (num, msg) => "https://wa.me/" + num + "?text=" + encodeURIComponent(msg);

  function markSent(c, val = true) {
    const k = keyOf(c);
    if (val) sent[k] = Date.now(); else delete sent[k];
    store.set("sent", sent);
  }

  // ---------- load contacts ----------
  function parseRows(rows) {
    // Find header row and columns by name so slightly different sheets still work.
    let h = rows.findIndex(r => r.some(v => /first\s*name|^name/i.test(String(v))) && r.some(v => /phone|number|mobile/i.test(String(v))));
    let col = { first: 1, full: 2, phone: 3, extra: 4 };
    if (h >= 0) {
      const hdr = rows[h].map(v => String(v).toLowerCase());
      const find = (re, not) => hdr.findIndex(v => re.test(v) && !(not && not.test(v)));
      const f = find(/first\s*name/); col.first = f >= 0 ? f : find(/name/, /full/);
      col.full = find(/full\s*name/);
      col.phone = find(/phone|mobile|number/, /whatsapp|auto/);
      col.extra = find(/extra/);
    } else h = 0;
    const out = [];
    for (let i = h + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const first = String(r[col.first] ?? "").trim();
      const phone = String(r[col.phone] ?? "").trim();
      if (!first || !phone) continue;
      if (/example row/i.test(r.join(" ")) && /sarah/i.test(first)) continue; // skip template example
      out.push({ first, full: col.full >= 0 ? String(r[col.full] ?? "").trim() : "", phone, extra: col.extra >= 0 ? String(r[col.extra] ?? "").trim() : "" });
    }
    return out;
  }

  $("file").addEventListener("change", e => {
    const f = e.target.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const wb = XLSX.read(ev.target.result, { type: "array" });
        const ws = wb.Sheets["Contacts"] || wb.Sheets[wb.SheetNames.find(n => !/how to|settings/i.test(n)) || wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
        const list = parseRows(rows);
        const st = wb.Sheets["Settings"];
        if (st) {
          if (st.B5 && st.B5.v) { $("tpl").value = String(st.B5.v); store.set("tpl", $("tpl").value); }
          if (st.B3 && st.B3.v) { $("cc").value = String(st.B3.v).replace(/\D/g, ""); store.set("cc", $("cc").value); }
        }
        contacts = list; store.set("contacts", contacts);
        $("loadmsg").textContent = `Loaded ${list.length} contact${list.length === 1 ? "" : "s"} from ${f.name}.` + (st ? " Message and country code taken from the Settings tab." : "");
        render();
      } catch (err) {
        $("loadmsg").textContent = "Couldn't read that file: " + err.message;
      }
      e.target.value = "";
    };
    reader.readAsArrayBuffer(f);
  });

  $("clearAll").addEventListener("click", confirmClick($("clearAll"), "Click again to remove", () => {
    contacts = []; sent = {}; store.del("contacts"); store.del("sent");
    $("loadmsg").textContent = "List removed from this device.";
    render();
  }));

  // ---------- message ----------
  $("tpl").addEventListener("input", () => { store.set("tpl", $("tpl").value); render(); });
  $("cc").addEventListener("input", () => { store.set("cc", $("cc").value); render(); });
  document.querySelectorAll("[data-ins]").forEach(b => b.addEventListener("click", () => {
    const t = $("tpl"), s = t.selectionStart ?? t.value.length, e = t.selectionEnd ?? s;
    t.value = t.value.slice(0, s) + b.dataset.ins + t.value.slice(e);
    t.focus(); t.selectionStart = t.selectionEnd = s + b.dataset.ins.length;
    store.set("tpl", t.value); render();
  }));

  // ---------- flyer ----------
  function toPng(file) {
    return new Promise((resolve, reject) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const cv = document.createElement("canvas");
        cv.width = img.naturalWidth; cv.height = img.naturalHeight;
        cv.getContext("2d").drawImage(img, 0, 0);
        cv.toBlob(b => b ? resolve({ png: b, url }) : reject(new Error("convert failed")), "image/png");
      };
      img.onerror = () => reject(new Error("Not a readable image"));
      img.src = url;
    });
  }

  $("flyer").addEventListener("change", async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const { png, url } = await toPng(f);
      if (flyer) URL.revokeObjectURL(flyer.url);
      flyer = { file: f, png, url };
      $("flyerPreview").src = url; $("flyerPreview").hidden = false; $("flyerRemove").hidden = false;
      $("flyerHint").textContent = `Flyer ready: ${f.name}. ` + (isTouch ? "Use Share on each contact." : "Use Copy flyer & open chat, then paste with Ctrl+V (Cmd+V on Mac).");
      render();
    } catch (err) { toast("Couldn't load that image: " + err.message); }
    e.target.value = "";
  });
  $("flyerRemove").addEventListener("click", () => {
    if (flyer) URL.revokeObjectURL(flyer.url);
    flyer = null; $("flyerPreview").hidden = true; $("flyerRemove").hidden = true;
    $("flyerHint").innerHTML = "Add a flyer and each contact gets a <b>Copy flyer &amp; open chat</b> button on computers, or <b>Share</b> on phones.";
    render();
  });

  async function copyFlyerAndOpen(c, num, msg) {
    // Open the window first (inside the click) so pop-up blockers allow it, then copy.
    const w = window.open("about:blank", "_blank");
    let copied = false;
    try {
      window.focus();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": flyer.png })]);
      copied = true;
    } catch (err) { /* handled below */ }
    if (w) w.location.href = waLink(num, msg); else location.href = waLink(num, msg);
    markSent(c); render();
    toast(copied ? "Flyer copied. In the chat press Ctrl+V (Cmd+V on Mac), then Send." :
                   "Couldn't copy the flyer automatically. Use the Copy flyer button, then paste in the chat.", 5000);
  }

  async function copyFlyerOnly() {
    try { await navigator.clipboard.write([new ClipboardItem({ "image/png": flyer.png })]); toast("Flyer copied. Paste it in the chat with Ctrl+V."); }
    catch (err) { toast("Your browser blocked copying images. Try Chrome or Edge."); }
  }

  async function shareFlyer(c, msg) {
    const ext = (flyer.file.type.split("/")[1] || "png").replace("jpeg", "jpg");
    const file = new File([flyer.file], "flyer." + ext, { type: flyer.file.type || "image/png" });
    try {
      // Copy text too: some WhatsApp versions drop the shared text, so it can be pasted as a caption.
      try { await navigator.clipboard.writeText(msg); } catch (e) {}
      await navigator.share({ files: [file], text: msg });
      markSent(c); render();
    } catch (err) {
      if (err.name !== "AbortError") toast("Sharing isn't supported here. Use Send and attach the flyer in WhatsApp.");
    }
  }
  const canShareFiles = () => {
    if (!flyer || !navigator.canShare) return false;
    try { return navigator.canShare({ files: [new File([flyer.png], "f.png", { type: "image/png" })] }); } catch (e) { return false; }
  };

  // ---------- list ----------
  function render() {
    const list = $("list"); list.innerHTML = "";
    const hide = $("hide").checked;
    const q = $("search").value.trim().toLowerCase();
    $("clearAll").hidden = contacts.length === 0;

    let done = 0, shown = 0;
    const share = canShareFiles();
    contacts.forEach((c, i) => {
      const num = cleanNumber(c.phone), msg = personalise(c), isSent = !!sent[keyOf(c)];
      if (isSent) done++;
      if (hide && isSent) return;
      if (q && !(`${c.first} ${c.full} ${c.phone} ${num}`.toLowerCase().includes(q))) return;
      shown++;
      const bad = num.length < 10 || num.length > 15;
      const el = document.createElement("div");
      el.className = "c" + (isSent ? " sent" : "");

      let acts = "";
      if (flyer && share && isTouch) {
        acts += `<button class="btn btn-send" data-a="share">Share with flyer</button>`;
        acts += `<a class="btn" data-a="send" target="_blank" rel="noopener" href="${esc(waLink(num, msg))}">Text only</a>`;
      } else if (flyer && canClipImage) {
        acts += `<button class="btn btn-send" data-a="copyopen">Copy flyer &amp; open chat</button>`;
        acts += `<button class="btn small" data-a="copy">Copy flyer again</button>`;
      } else {
        acts += `<a class="btn btn-send" data-a="send" target="_blank" rel="noopener" href="${esc(waLink(num, msg))}">Send</a>`;
      }
      acts += `<button class="btn small" data-a="toggle">${isSent ? "Undo sent" : "Mark sent"}</button>`;

      el.innerHTML = `
        <div class="info">
          <div class="name">${i + 1}. ${esc(c.first)}${c.full ? ` <span class="num">(${esc(c.full)})</span>` : ""}
            ${isSent ? '<span class="tag">Sent</span>' : ""}${bad ? '<span class="tag warn">Check number</span>' : ""}</div>
          <div class="num">+${esc(num)}</div>
          <div class="msg">${esc(msg)}</div>
        </div>
        <div class="acts">${acts}</div>`;

      el.querySelectorAll("[data-a]").forEach(b => b.addEventListener("click", ev => {
        const a = b.dataset.a;
        if (a === "send") { markSent(c); setTimeout(render, 300); }
        else if (a === "copyopen") { ev.preventDefault(); copyFlyerAndOpen(c, num, msg); }
        else if (a === "copy") copyFlyerOnly();
        else if (a === "share") shareFlyer(c, msg);
        else if (a === "toggle") { markSent(c, !isSent); render(); }
      }));
      list.appendChild(el);
    });

    if (!contacts.length) list.innerHTML = `<div class="empty">Load your Excel contact list in step 1 to start.</div>`;
    else if (!shown) list.innerHTML = `<div class="empty">No contacts match.</div>`;

    $("progress").textContent = contacts.length ? `${done} of ${contacts.length} sent` : "No contacts loaded";
    $("barfill").style.width = contacts.length ? (done / contacts.length * 100) + "%" : "0";
  }

  function confirmClick(btn, armedText, fn) {
    const orig = btn.textContent;
    return () => {
      if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = orig; fn(); return; }
      btn.dataset.armed = "1"; btn.textContent = armedText;
      setTimeout(() => { delete btn.dataset.armed; btn.textContent = orig; }, 3000);
    };
  }
  $("reset").addEventListener("click", confirmClick($("reset"), "Click again to confirm", () => { sent = {}; store.set("sent", sent); render(); }));
  $("hide").addEventListener("change", render);
  $("search").addEventListener("input", render);

  if (contacts.length) $("loadmsg").textContent = `${contacts.length} contact${contacts.length === 1 ? "" : "s"} loaded from your last session (stored on this device only).`;
  render();
})();
