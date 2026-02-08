/**
 * WarsztatCRM — demo CRM z zapisem tylko w sessionStorage (dane znikają po zamknięciu karty / nowej sesji).
 * - Zakładki: Pulpit, Klienci, Zlecenia, Faktury, Magazyn, Raporty, Moduły, Ustawienia
 * - Dodawanie własnych modułów (dynamiczne pola) — moduł automatycznie wskakuje do górnego paska.
 * - Tryb jasny/ciemny (bez zapisu lub z zapisem — patrz THEME_PERSIST).
 */
(() => {
  const APP_NAME = "WarsztatCRM";
  const STORAGE_KEY = "warsztatcrm_state_v1";
  const THEME_KEY = "warsztatcrm_theme_v1";
  const THEME_PERSIST = true; // ustaw na false jeśli chcesz „pełny reset” także trybu po ponownym wejściu

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const nowIso = () => new Date().toISOString();
  const uid = () => Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);

  const slugify = (s) =>
    (s || "")
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "modul";

  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 1600);
  }

  // ---------- State ----------
  function initialState() {
    return {
      meta: { createdAt: nowIso(), version: 1 },
      clients: [],
      orders: [],
      invoices: [],
      stock: [],
      customModules: [],          // [{ slug, name, fields:[{key,label,type,required,options?}], icon? }]
      customData: {},             // { [slug]: [{id, ...fields}] }
    };
  }

  function loadState() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return initialState();
      const parsed = JSON.parse(raw);
      // minimal migration / repair
      return {
        ...initialState(),
        ...parsed,
        customData: parsed.customData || {},
        customModules: parsed.customModules || [],
      };
    } catch {
      return initialState();
    }
  }

  function saveState() {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function resetState() {
    sessionStorage.removeItem(STORAGE_KEY);
    state = initialState();
    saveState();
    routeTo("#/dashboard");
    toast("Sesja wyczyszczona.");
  }

  let state = loadState();
  saveState();

  // ---------- Theme ----------
  function getTheme() {
    if (!THEME_PERSIST) return "light";
    return localStorage.getItem(THEME_KEY) || "light";
  }
  function setTheme(theme) {
    const t = theme === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = t;
    if (THEME_PERSIST) localStorage.setItem(THEME_KEY, t);
  }
  setTheme(getTheme());

  // ---------- Routing ----------
  const baseTabs = [
    { key: "dashboard", label: "Pulpit", href: "#/dashboard" },
    { key: "clients", label: "Klienci", href: "#/clients" },
    { key: "orders", label: "Zlecenia", href: "#/orders" },
    { key: "invoices", label: "Faktury", href: "#/invoices" },
    { key: "stock", label: "Magazyn", href: "#/stock" },
    { key: "reports", label: "Raporty", href: "#/reports" },
    { key: "modules", label: "Moduły", href: "#/modules" },
    { key: "settings", label: "Ustawienia", href: "#/settings" },
  ];

  function getAllTabs() {
    const custom = (state.customModules || []).map((m) => ({
      key: `m:${m.slug}`,
      label: `${m.name}`,
      href: `#/module/${m.slug}`,
      isCustom: true,
    }));

    // custom modules right after "Moduły"
    const idx = baseTabs.findIndex(t => t.key === "modules");
    const before = baseTabs.slice(0, idx + 1);
    const after = baseTabs.slice(idx + 1);
    return [...before, ...custom, ...after];
  }

  function renderNav() {
    const nav = $("#nav");
    const tabs = getAllTabs();
    const active = location.hash || "#/dashboard";

    nav.innerHTML = tabs
      .map((t) => {
        const isActive = active === t.href || active.startsWith(t.href + "/");
        return `<a href="${t.href}" class="${isActive ? "active" : ""}">${escapeHtml(t.label)}</a>`;
      })
      .join("");
  }

  function routeTo(hash) {
    location.hash = hash;
  }

  window.addEventListener("hashchange", () => {
    render();
  });

  // ---------- Quick search (Ctrl+K) ----------
  let quickSearchOpen = false;
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openQuickSearch();
    }
    if (e.key === "Escape") {
      closeModal();
    }
  });

  function openQuickSearch() {
    if (quickSearchOpen) return;
    quickSearchOpen = true;
    const html = `
      <div class="modal-backdrop" data-modal="1">
        <div class="modal" role="dialog" aria-modal="true" aria-label="Wyszukaj">
          <header>
            <h3>Wyszukaj</h3>
            <button class="btn btn-ghost" data-action="close">✕</button>
          </header>
          <div class="body">
            <div class="label">Wpisz frazę (klient / zlecenie / faktura / magazyn)</div>
            <input class="input" id="qsInput" placeholder="np. Kowalski / ZL-001 / 2026..." />
            <div class="small" style="margin-top:10px">
              Podpowiedź: wyszukujemy po imieniu/nazwie, telefonie, e-mailu, numerach dokumentów i notatkach.
            </div>
            <div style="margin-top:12px" id="qsResults"></div>
          </div>
          <footer>
            <button class="btn" data-action="close">Zamknij</button>
          </footer>
        </div>
      </div>
    `;
    $("#modalRoot").innerHTML = html;
    const input = $("#qsInput");
    input.focus();
    input.addEventListener("input", () => renderQuickSearch(input.value));
    $("#modalRoot").addEventListener("click", (e) => {
      if (e.target?.dataset?.action === "close" || e.target?.dataset?.modal) closeModal();
    }, { once: true });
    renderQuickSearch("");
  }

  function renderQuickSearch(q) {
    const term = (q || "").trim().toLowerCase();
    const out = $("#qsResults");
    if (!term) {
      out.innerHTML = `<div class="small muted">Zacznij pisać…</div>`;
      return;
    }

    const hits = [];
    const addHit = (type, title, sub, href) => hits.push({ type, title, sub, href });

    for (const c of state.clients) {
      const hay = `${c.name||""} ${c.phone||""} ${c.email||""} ${c.note||""}`.toLowerCase();
      if (hay.includes(term)) addHit("Klient", c.name || "(bez nazwy)", c.phone || c.email || "", "#/clients");
    }
    for (const o of state.orders) {
      const hay = `${o.code||""} ${o.status||""} ${o.title||""} ${o.note||""}`.toLowerCase();
      if (hay.includes(term)) addHit("Zlecenie", o.code || "(bez numeru)", o.title || "", "#/orders");
    }
    for (const i of state.invoices) {
      const hay = `${i.number||""} ${i.status||""} ${i.note||""}`.toLowerCase();
      if (hay.includes(term)) addHit("Faktura", i.number || "(bez numeru)", i.status || "", "#/invoices");
    }
    for (const s of state.stock) {
      const hay = `${s.sku||""} ${s.name||""} ${s.location||""}`.toLowerCase();
      if (hay.includes(term)) addHit("Magazyn", s.name || "(pozycja)", s.sku || "", "#/stock");
    }

    // custom modules
    for (const m of state.customModules || []) {
      const rows = state.customData?.[m.slug] || [];
      for (const r of rows) {
        const hay = Object.values(r).join(" ").toLowerCase();
        if (hay.includes(term)) addHit(m.name, `Rekord`, `moduł: ${m.slug}`, `#/module/${m.slug}`);
      }
    }

    const limited = hits.slice(0, 20);
    out.innerHTML = limited.length
      ? `<div class="card" style="padding:0">
          <table class="table">
            <thead><tr><th>Typ</th><th>Wynik</th><th>Szczegóły</th><th></th></tr></thead>
            <tbody>
              ${limited.map(h => `
                <tr>
                  <td><span class="pill">${escapeHtml(h.type)}</span></td>
                  <td>${escapeHtml(h.title)}</td>
                  <td class="muted">${escapeHtml(h.sub)}</td>
                  <td class="actions">
                    <button class="btn btn-primary" data-go="${escapeAttr(h.href)}">Otwórz</button>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>`
      : `<div class="small muted">Brak wyników.</div>`;

    $$("#qsResults [data-go]").forEach(btn => {
      btn.addEventListener("click", () => {
        closeModal();
        routeTo(btn.dataset.go);
      });
    });
  }

  function closeModal() {
    $("#modalRoot").innerHTML = "";
    quickSearchOpen = false;
  }

  // ---------- UI helpers ----------
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[m]));
  }
  function escapeAttr(s){ return escapeHtml(s).replace(/"/g, "&quot;"); }

  function fmtDate(iso) {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      return d.toLocaleDateString("pl-PL");
    } catch { return ""; }
  }

  function money(n) {
    const val = Number(n || 0);
    return val.toLocaleString("pl-PL", { style: "currency", currency: "PLN" });
  }

  function getClientName(clientId) {
    const c = state.clients.find(x => x.id === clientId);
    return c ? c.name : "(brak klienta)";
  }

  function confirmDialog({ title, body, confirmText = "Usuń", danger = true }) {
    return new Promise((resolve) => {
      const html = `
        <div class="modal-backdrop" data-modal="1">
          <div class="modal" role="dialog" aria-modal="true" aria-label="${escapeAttr(title)}">
            <header>
              <h3>${escapeHtml(title)}</h3>
              <button class="btn btn-ghost" data-action="close">✕</button>
            </header>
            <div class="body">
              <div>${body}</div>
            </div>
            <footer>
              <button class="btn" data-action="close">Anuluj</button>
              <button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-action="confirm">${escapeHtml(confirmText)}</button>
            </footer>
          </div>
        </div>
      `;
      $("#modalRoot").innerHTML = html;
      const onClose = () => { closeModal(); resolve(false); };
      const onConfirm = () => { closeModal(); resolve(true); };
      $("#modalRoot").addEventListener("click", (e) => {
        const a = e.target?.dataset?.action;
        if (a === "close" || e.target?.dataset?.modal) onClose();
        if (a === "confirm") onConfirm();
      }, { once: true });
    });
  }

  function openFormModal({ title, fields, initial = {}, onSave }) {
    const formId = uid();
    const html = `
      <div class="modal-backdrop" data-modal="1">
        <div class="modal" role="dialog" aria-modal="true" aria-label="${escapeAttr(title)}">
          <header>
            <h3>${escapeHtml(title)}</h3>
            <button class="btn btn-ghost" data-action="close">✕</button>
          </header>
          <div class="body">
            <form id="${escapeAttr(formId)}">
              ${fields.map(f => renderField(f, initial[f.key])).join("")}
              <div class="small" style="margin-top:10px">* wymagane</div>
            </form>
          </div>
          <footer>
            <button class="btn" type="button" data-action="close">Anuluj</button>
            <button class="btn btn-primary" type="submit" form="${escapeAttr(formId)}">Zapisz</button>
          </footer>
        </div>
      </div>
    `;
    $("#modalRoot").innerHTML = html;

    $("#modalRoot").addEventListener("click", (e) => {
      const a = e.target?.dataset?.action;
      if (a === "close" || e.target?.dataset?.modal) closeModal();
    }, { once: true });

    const form = document.getElementById(formId);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const data = {};
      let ok = true;

      for (const f of fields) {
        const el = form.querySelector(`[name="${CSS.escape(f.key)}"]`);
        if (!el) continue;
        let val = el.value;

        if (f.type === "number") val = val === "" ? "" : Number(val);
        if (f.type === "checkbox") val = el.checked;

        if (f.required && (val === "" || val === null || val === undefined)) ok = false;
        data[f.key] = val;
      }

      if (!ok) {
        toast("Uzupełnij pola wymagane.");
        return;
      }

      closeModal();
      onSave(data);
    });
  }

  function renderField(field, value) {
    const v = value ?? "";
    const req = field.required ? `<span class="muted"> *</span>` : "";
    const label = `<div class="label">${escapeHtml(field.label)}${req}</div>`;
    const name = escapeAttr(field.key);

    if (field.type === "select") {
      const opts = (field.options || []).map(o => {
        const val = (typeof o === "object" && o !== null) ? (o.value ?? "") : o;
        const lab = (typeof o === "object" && o !== null) ? (o.label ?? o.value ?? "") : o;
        const selected = String(val) === String(v) ? " selected" : "";
        return `<option value="${escapeAttr(val)}"${selected}>${escapeHtml(lab)}</option>`;
      }).join("");
      return `${label}<select name="${name}"><option value=""></option>${opts}</select>`;
    }

    if (field.type === "textarea") {
      return `${label}<textarea class="input" style="min-height:120px" name="${name}" placeholder="${escapeAttr(field.placeholder||"")}">${escapeHtml(v)}</textarea>`;
    }

    if (field.type === "checkbox") {
      const checked = v ? "checked" : "";
      return `${label}<label style="display:flex;align-items:center;gap:10px">
        <input type="checkbox" name="${name}" ${checked} />
        <span class="muted">${escapeHtml(field.placeholder||"")}</span>
      </label>`;
    }

    const type = field.type === "date" ? "date" : field.type === "number" ? "number" : "text";
    return `${label}<input class="input" name="${name}" type="${type}" value="${escapeAttr(v)}" placeholder="${escapeAttr(field.placeholder||"")}" />`;
  }

  // ---------- Generic CRUD renderer ----------
  function renderCrudPage({
    title,
    entityKey,
    columns,
    formFields,
    subtitle,
    rowToSearchText,
    beforeTableHtml = "",
    afterTableHtml = "",
    emptyHint = "Brak rekordów.",
    addLabel = "Dodaj",
  }) {
    const app = $("#app");
    const list = state[entityKey] || [];

    const searchId = "search-" + entityKey;
    const html = `
      <section class="card">
        <div class="toolbar">
          <div>
            <h2>${escapeHtml(title)}</h2>
            ${subtitle ? `<div class="small">${subtitle}</div>` : ""}
          </div>
<div class="toolbar-actions">
<input class="input input-search" id="${escapeAttr(searchId)}" placeholder="Szukaj..." />
            <button class="btn btn-primary" id="add-${escapeAttr(entityKey)}">${escapeHtml(addLabel)}</button>
          </div>
        </div>

        ${beforeTableHtml}

        <div class="card" style="background:transparent;border:none;padding:0">
          ${list.length ? `
            <table class="table">
              <thead>
                <tr>
                  ${columns.map(c => `<th>${escapeHtml(c.label)}</th>`).join("")}
                  <th></th>
                </tr>
              </thead>
              <tbody id="tbody-${escapeAttr(entityKey)}"></tbody>
            </table>
          ` : `<div class="small muted">${escapeHtml(emptyHint)}</div>`}
        </div>

        ${afterTableHtml}
      </section>
    `;
    app.innerHTML = html;

    const tbody = $(`#tbody-${entityKey}`);
    const search = $(`#${searchId}`);

    const renderRows = (term) => {
      if (!tbody) return;
      const t = (term || "").trim().toLowerCase();
      const filtered = t
        ? list.filter(r => (rowToSearchText ? rowToSearchText(r) : JSON.stringify(r)).toLowerCase().includes(t))
        : list;

      tbody.innerHTML = filtered
        .map((row) => `
          <tr>
            ${columns.map(c => `<td>${c.render ? c.render(row) : escapeHtml(row[c.key] ?? "")}</td>`).join("")}
            <td class="actions">
              <button class="btn" data-edit="${escapeAttr(row.id)}">Edytuj</button>
              <button class="btn btn-danger" data-del="${escapeAttr(row.id)}">Usuń</button>
            </td>
          </tr>
        `)
        .join("");
    };

    renderRows("");

    if (search) {
      search.addEventListener("input", () => renderRows(search.value));
    }

    $(`#add-${entityKey}`)?.addEventListener("click", () => {
      openFormModal({
        title: `${addLabel}: ${title}`,
        fields: formFields,
        initial: {},
        onSave: (data) => {
          const row = { id: uid(), createdAt: nowIso(), updatedAt: nowIso(), ...data };
          state[entityKey] = [row, ...(state[entityKey] || [])];
          saveState();
          toast("Dodano.");
          render();
        },
      });
    });

    // edit / delete
    app.querySelectorAll("[data-edit]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.edit;
        const row = (state[entityKey] || []).find(r => r.id === id);
        if (!row) return;
        openFormModal({
          title: `Edytuj: ${title}`,
          fields: formFields,
          initial: row,
          onSave: (data) => {
            const next = (state[entityKey] || []).map(r => r.id === id ? { ...r, ...data, updatedAt: nowIso() } : r);
            state[entityKey] = next;
            saveState();
            toast("Zapisano.");
            render();
          },
        });
      });
    });

    app.querySelectorAll("[data-del]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.del;
        const ok = await confirmDialog({
          title: "Usunąć rekord?",
          body: `<div class="small muted">Tej operacji nie da się cofnąć (w tej sesji).</div>`,
          confirmText: "Usuń",
          danger: true
        });
        if (!ok) return;
        state[entityKey] = (state[entityKey] || []).filter(r => r.id !== id);
        saveState();
        toast("Usunięto.");
        render();
      });
    });
  }

  // ---------- Pages ----------
    function pageDashboard() {
    const app = $("#app");
    const created = state?.meta?.createdAt ? fmtDate(state.meta.createdAt) : "—";

    const kpis = [
      { label: "Klienci", value: state.clients.length, sub: "Baza kontaktów" },
      { label: "Zlecenia", value: state.orders.length, sub: "Wszystkie statusy" },
      { label: "Faktury", value: state.invoices.length, sub: "Wystawione dokumenty" },
      { label: "Magazyn", value: state.stock.length, sub: "Pozycje" },
      { label: "Moduły", value: (state.customModules || []).length, sub: "Własne zakładki" },
    ];

    // Orders by status (for mini progress bars)
    const byStatus = {};
    for (const o of state.orders || []) byStatus[o.status || "—"] = (byStatus[o.status || "—"] || 0) + 1;
    const statusRows = Object.entries(byStatus).sort((a,b)=>b[1]-a[1]);
    const totalOrders = (state.orders || []).length || 0;

    const recentOrders = (state.orders || []).slice(0, 6);
    const recentClients = (state.clients || []).slice(0, 6);

    const totalInvoice = (state.invoices || []).reduce((acc, x) => acc + Number(x.amount || 0), 0);
    const totalOrdersAmount = (state.orders || []).reduce((acc, x) => acc + Number(x.amount || 0), 0);

    const quickLinks = [
      { href: "#/clients", label: "+ Klient", cls: "btn-primary" },
      { href: "#/orders", label: "+ Zlecenie", cls: "btn-primary" },
      { href: "#/invoices", label: "+ Faktura", cls: "btn-primary" },
      { href: "#/modules", label: "+ Własny moduł", cls: "" },
    ];

    app.innerHTML = `
      <section class="grid2">
        <div class="card">
          <div class="toolbar">
            <div>
              <h2>Pulpit</h2>
              <div class="small muted">
                Panel zarządzania warsztatem — szybki podgląd danych i statusów.
                
              </div>
            </div>
            <div class="small muted">Sesja: <span class="kbd">${escapeHtml(created)}</span></div>
          </div>

          <div class="kpi-grid">
            ${kpis.map(k => `
              <div class="kpi">
                <div class="kpi-label">${escapeHtml(k.label)}</div>
                <div class="kpi-value">${escapeHtml(k.value)}</div>
                <div class="kpi-sub">${escapeHtml(k.sub)}</div>
              </div>
            `).join("")}
          </div>

          <div class="divider"></div>

          <div class="card" style="background:var(--surface);">
            <h3>Szybkie akcje</h3>
            <div style="display:flex;gap:10px;flex-wrap:wrap">
              ${quickLinks.map(l => `<a class="btn ${l.cls}" href="${escapeAttr(l.href)}">${escapeHtml(l.label)}</a>`).join("")}
            </div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
            <div class="card" style="background:var(--surface);">
              <h3>Statusy zleceń</h3>
              ${statusRows.length ? statusRows.map(([s, n]) => {
                const pct = totalOrders ? Math.round((n / totalOrders) * 100) : 0;
                return `
                  <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;margin:10px 0 6px">
                    <div><span class="pill ok">${escapeHtml(s)}</span></div>
                    <div class="small muted"><strong>${escapeHtml(n)}</strong> • ${escapeHtml(pct)}%</div>
                  </div>
                  <div class="progress"><span style="width:${pct}%"></span></div>
                `;
              }).join("") : `<div class="small muted">Brak zleceń.</div>`}
            </div>

            <div class="card" style="background:var(--surface);">
              <h3>Podsumowanie kwot</h3>
              <div class="small muted">Na podstawie pól „Kwota” w zleceniach i fakturach.</div>
              <div style="display:grid;gap:10px;margin-top:10px">
                <div class="kpi" style="padding:12px">
                  <div class="kpi-label">Suma wycen zleceń</div>
                  <div class="kpi-value" style="font-size:18px">${escapeHtml(money(totalOrdersAmount))}</div>
                </div>
                <div class="kpi" style="padding:12px">
                  <div class="kpi-label">Suma faktur</div>
                  <div class="kpi-value" style="font-size:18px">${escapeHtml(money(totalInvoice))}</div>
                </div>
              </div>
            
            </div>
          </div>
        </div>

        <div class="card">
          <h2>Podgląd</h2>

          <div class="card" style="background:var(--surface);">
            <h3>Ostatnie zlecenia</h3>
            ${recentOrders.length ? `
              <table class="table">
                <thead><tr><th>Nr</th><th>Opis</th><th>Status</th></tr></thead>
                <tbody>
                  ${recentOrders.map(o => `
                    <tr>
                      <td><strong>${escapeHtml(o.code || "")}</strong></td>
                      <td>${escapeHtml(o.title || "")}</td>
                      <td><span class="pill ok">${escapeHtml(o.status || "—")}</span></td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            ` : `<div class="small muted">Brak.</div>`}
          </div>

          <div class="card" style="background:var(--surface);margin-top:12px">
            <h3>Ostatni klienci</h3>
            ${recentClients.length ? `
              <table class="table">
                <thead><tr><th>Nazwa</th><th>Kontakt</th></tr></thead>
                <tbody>
                  ${recentClients.map(c => `
                    <tr>
                      <td><strong>${escapeHtml(c.name || "")}</strong></td>
                      <td class="muted">${escapeHtml(c.phone || c.email || "—")}</td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            ` : `<div class="small muted">Brak.</div>`}
          </div>

          <div class="card" style="background:var(--surface);margin-top:12px">
            <h3>Wskazówki</h3>
<ul class="small muted">
              <li>Użyj <span class="kbd">Ctrl</span>+<span class="kbd">K</span> do szybkiego wyszukiwania.</li>
              <li>W zakładce <span class="kbd">Moduły</span> dodasz własne rekordy i pola.</li>
              <li>Przycisk <span class="kbd">Wyczyść sesję</span> usuwa dane tylko z tej sesji.</li>
            </ul>
          </div>
        </div>
      </section>
    `;
  }

  function pageClients() {
    renderCrudPage({
      title: "Klienci",
      entityKey: "clients",
      subtitle: "Baza klientów: kontakt, adres, notatki.",
      addLabel: "Dodaj klienta",
      columns: [
        { key: "name", label: "Nazwa / Imię" },
        { key: "phone", label: "Telefon" },
        { key: "email", label: "E-mail" },
        { key: "city", label: "Miasto" },
        { key: "updatedAt", label: "Aktualizacja", render: r => `<span class="muted">${escapeHtml(fmtDate(r.updatedAt))}</span>` },
      ],
      formFields: [
        { key: "name", label: "Nazwa / Imię", type: "text", required: true, placeholder: "np. Jan Kowalski / Firma XYZ" },
        { key: "phone", label: "Telefon", type: "text", required: false, placeholder: "+48 ..." },
        { key: "email", label: "E-mail", type: "text", required: false, placeholder: "mail@..." },
        { key: "city", label: "Miasto", type: "text", required: false, placeholder: "np. Warszawa" },
        { key: "address", label: "Adres", type: "text", required: false, placeholder: "ul. ..." },
        { key: "note", label: "Notatka", type: "textarea", required: false, placeholder: "Uwagi, preferencje, historia kontaktu..." },
      ],
      rowToSearchText: (r) => `${r.name||""} ${r.phone||""} ${r.email||""} ${r.city||""} ${r.note||""}`,
      emptyHint: "Brak klientów. Dodaj pierwszego klienta.",
    });
  }

  function pageOrders() {
    const clientOptions = state.clients.map(c => c.name).filter(Boolean);

    renderCrudPage({
      title: "Zlecenia",
      entityKey: "orders",
      subtitle: "Statusy, opis prac, klient, wycena, notatki.",
      addLabel: "Dodaj zlecenie",
      columns: [
        { key: "code", label: "Nr", render: r => `<strong>${escapeHtml(r.code || "")}</strong>` },
        { key: "title", label: "Tytuł" },
        { key: "clientId", label: "Klient", render: r => escapeHtml(getClientName(r.clientId)) },
        { key: "status", label: "Status", render: r => `<span class="pill ok">${escapeHtml(r.status || "—")}</span>` },
        { key: "amount", label: "Kwota", render: r => `<span class="muted">${escapeHtml(money(r.amount))}</span>` },
      ],
      formFields: [
        { key: "code", label: "Numer zlecenia", type: "text", required: true, placeholder: "np. ZL-0001" },
        { key: "title", label: "Opis / tytuł", type: "text", required: true, placeholder: "np. Wymiana klocków + diagnostyka" },
        { key: "clientId", label: "Klient", type: "select", required: false, options: state.clients.map(c => ({ value: c.id, label: c.name || c.id })) },
        { key: "status", label: "Status", type: "select", required: true, options: ["Nowe", "W toku", "Czeka na części", "Gotowe", "Anulowane"] },
        { key: "amount", label: "Wycena (PLN)", type: "number", required: false, placeholder: "0" },
        { key: "deadline", label: "Termin", type: "date", required: false },
        { key: "note", label: "Notatka", type: "textarea", required: false, placeholder: "Szczegóły, ustalenia, części..." },
      ],
      rowToSearchText: (r) => `${r.code||""} ${r.title||""} ${r.status||""} ${r.note||""}`,
      emptyHint: "Brak zleceń. Dodaj pierwsze zlecenie.",
      beforeTableHtml: `
      `
    });
  }

  function pageInvoices() {
    renderCrudPage({
      title: "Faktury",
      entityKey: "invoices",
      subtitle: "Numer, status, kwota, notatki.",
      addLabel: "Dodaj fakturę",
      columns: [
        { key: "number", label: "Numer", render: r => `<strong>${escapeHtml(r.number || "")}</strong>` },
        { key: "status", label: "Status", render: r => `<span class="pill">${escapeHtml(r.status || "")}</span>` },
        { key: "amount", label: "Kwota", render: r => escapeHtml(money(r.amount)) },
        { key: "issuedAt", label: "Data", render: r => `<span class="muted">${escapeHtml(fmtDate(r.issuedAt))}</span>` },
      ],
      formFields: [
        { key: "number", label: "Numer faktury", type: "text", required: true, placeholder: "np. FV/01/2026" },
        { key: "status", label: "Status", type: "select", required: true, options: ["Wystawiona", "Opłacona", "Przeterminowana", "Anulowana"] },
        { key: "amount", label: "Kwota (PLN)", type: "number", required: true, placeholder: "0" },
        { key: "issuedAt", label: "Data wystawienia", type: "date", required: false },
        { key: "note", label: "Notatka", type: "textarea", required: false, placeholder: "Uwagi do faktury..." },
      ],
      rowToSearchText: (r) => `${r.number||""} ${r.status||""} ${r.note||""}`,
      emptyHint: "Brak faktur.",
    });
  }

  function pageStock() {
    renderCrudPage({
      title: "Magazyn",
      entityKey: "stock",
      subtitle: "Proste pozycje magazynowe: SKU, nazwa, ilość, lokalizacja.",
      addLabel: "Dodaj pozycję",
      columns: [
        { key: "sku", label: "SKU" },
        { key: "name", label: "Nazwa" },
        { key: "qty", label: "Ilość", render: r => `<strong>${escapeHtml(r.qty ?? 0)}</strong>` },
        { key: "location", label: "Lokalizacja" },
      ],
      formFields: [
        { key: "sku", label: "SKU / Kod", type: "text", required: true, placeholder: "np. OIL-5W30" },
        { key: "name", label: "Nazwa", type: "text", required: true, placeholder: "np. Olej 5W30" },
        { key: "qty", label: "Ilość", type: "number", required: true, placeholder: "0" },
        { key: "location", label: "Lokalizacja", type: "text", required: false, placeholder: "np. Regał A2" },
        { key: "note", label: "Notatka", type: "textarea", required: false, placeholder: "Uwagi..." },
      ],
      rowToSearchText: (r) => `${r.sku||""} ${r.name||""} ${r.location||""} ${r.note||""}`,
      emptyHint: "Magazyn pusty.",
    });
  }

  function pageReports() {
    const app = $("#app");
    const ordersByStatus = {};
    for (const o of state.orders) {
      ordersByStatus[o.status || "—"] = (ordersByStatus[o.status || "—"] || 0) + 1;
    }

    const totalInvoice = (state.invoices || []).reduce((acc, x) => acc + Number(x.amount || 0), 0);
    const totalOrders = (state.orders || []).reduce((acc, x) => acc + Number(x.amount || 0), 0);

    app.innerHTML = `
      <section class="grid2">
        <div class="card">
          <h2>Raporty</h2>
          <div class="small muted">Mini raporty do demo (bez backendu).</div>

          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-top:12px">
            <div class="card" style="background:var(--bg)">
              <div class="small muted">Suma wycen zleceń</div>
              <div style="font-size:20px;font-weight:900;margin-top:2px">${escapeHtml(money(totalOrders))}</div>
            </div>
            <div class="card" style="background:var(--bg)">
              <div class="small muted">Suma faktur</div>
              <div style="font-size:20px;font-weight:900;margin-top:2px">${escapeHtml(money(totalInvoice))}</div>
            </div>
          </div>

          <div class="card" style="background:var(--bg);margin-top:12px">
            <h3>Zlecenia wg statusu</h3>
            ${Object.keys(ordersByStatus).length ? `
              <table class="table">
                <thead><tr><th>Status</th><th>Ilość</th></tr></thead>
                <tbody>
                  ${Object.entries(ordersByStatus).map(([k,v]) => `<tr><td>${escapeHtml(k)}</td><td><strong>${escapeHtml(v)}</strong></td></tr>`).join("")}
                </tbody>
              </table>
            ` : `<div class="small muted">Brak danych.</div>`}
          </div>
        </div>

        <div class="card">
          <h2>Eksport / Import (opcjonalnie)</h2>
          <div class="small muted">Jeśli chcesz przenosić dane między sesjami, możesz je wyeksportować do JSON.</div>

          <div class="card" style="background:var(--bg)">
            <div class="toolbar">
              <button class="btn btn-primary" id="btnExport">Eksport JSON</button>
              <button class="btn" id="btnImport">Import JSON</button>
            </div>
            <textarea class="input" id="jsonBox" style="min-height:260px" placeholder="Tu pojawi się JSON lub wklej tu swój..."></textarea>
            <div class="small muted" style="margin-top:8px">
              Uwaga: import nadpisuje dane w aktualnej sesji.
            </div>
          </div>
        </div>
      </section>
    `;

    $("#btnExport").addEventListener("click", () => {
      $("#jsonBox").value = JSON.stringify(state, null, 2);
      toast("Wyeksportowano.");
    });
    $("#btnImport").addEventListener("click", async () => {
      const raw = $("#jsonBox").value.trim();
      if (!raw) return toast("Wklej JSON.");
      try {
        const parsed = JSON.parse(raw);
        const ok = await confirmDialog({
          title: "Zaimportować dane?",
          body: `<div class="small muted">Nadpisze bieżącą sesję.</div>`,
          confirmText: "Importuj",
          danger: false
        });
        if (!ok) return;
        state = { ...initialState(), ...parsed };
        saveState();
        toast("Zaimportowano.");
        render();
      } catch {
        toast("Niepoprawny JSON.");
      }
    });
  }

  // ---------- Custom modules ----------
  const fieldTypes = [
    { value: "text", label: "Tekst" },
    { value: "number", label: "Liczba" },
    { value: "date", label: "Data" },
    { value: "textarea", label: "Długi tekst" },
    { value: "select", label: "Lista (select)" },
    { value: "checkbox", label: "Checkbox" },
  ];

  function pageModules() {
    const app = $("#app");
    const mods = state.customModules || [];

    app.innerHTML = `
      <section class="grid2">
        <div class="card">
          <h2>Moduły</h2>
          <div class="small muted">
            Dodaj dodatkową zakładkę dopasowaną do Twoich potrzeb (np. Pojazdy, Leady, Reklamacje).
          </div>

          <div class="card" style="background:var(--bg);margin-top:12px">
            <h3>Nowy moduł</h3>

            <div>
              <div class="label">Nazwa modułu *</div>
              <input class="input" id="mName" placeholder="np. Pojazdy" />
            </div>

            <div class="label">Pola (format)</div>
            <div class="small muted">Wpisz pola w formacie: <span class="kbd">klucz:typ:label:wymagane</span>, po przecinku.</div><br>
            <textarea class="input" id="mFields" style="min-height:120px" placeholder="np. vin:text:VIN:true, marka:text:Marka:false, rok:number:Rok:false, notatka:textarea:Notatka:false"></textarea>
            <div class="small muted" style="margin-top:6px">Typy: text, number, date, textarea, select, checkbox. Dla select dodaj opcje: <span class="kbd">select[Opcja1|Opcja2]</span>.</div>

            <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">
              <button class="btn btn-primary" id="btnAddModule">Dodaj moduł</button>
              <button class="btn" id="btnExample">Wstaw przykład</button>
            </div>
          </div>
</div>
        </div>

        <div class="card">
          <h2>Twoje moduły</h2>
          ${mods.length ? `
            <table class="table">
              <thead><tr><th>Nazwa</th><th>Pola</th><th></th></tr></thead>
              <tbody>
                ${mods.map(m => `
                  <tr>
                    <td><strong>${escapeHtml(m.name)}</strong></td>
                    <td class="muted">${escapeHtml((m.fields||[]).map(f => f.label || f.key).join(", "))}</td>
                    <td class="actions">
                      <button class="btn" data-open="${escapeAttr(m.slug)}">Otwórz</button>
                      <button class="btn btn-danger" data-delmod="${escapeAttr(m.slug)}">Usuń</button>
                    </td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          ` : `<div class="small muted">Brak modułów. Dodaj pierwszy po lewej.</div>`}
        </div>
      </section>
    `;

    $("#btnExample").addEventListener("click", () => {
      $("#mName").value = "Pojazdy";
            $("#mFields").value = "vin:text:VIN:true, marka:text:Marka:false, model:text:Model:false, rok:number:Rok:false, status:select[Aktywny|W serwisie|Zakończony]:Status:false, notatka:textarea:Notatka:false";
      toast("Wstawiono przykład.");
    });

    $("#btnAddModule").addEventListener("click", () => {
      const name = $("#mName").value.trim();
      const icon = "";
      const fieldsRaw = $("#mFields").value.trim();

      if (!name) return toast("Podaj nazwę modułu.");

      let slugBase = slugify(name);
      let slug = slugBase;
      let i = 2;
      while ((state.customModules || []).some(m => m.slug === slug)) {
        slug = `${slugBase}-${i++}`;
      }

      const fields = parseFields(fieldsRaw);
      if (!fields.length) {
        // default fields if empty
        fields.push(
          { key: "name", label: "Nazwa", type: "text", required: true },
          { key: "note", label: "Notatka", type: "textarea", required: false },
        );
      }

      const mod = { slug, name, fields };
      state.customModules = [mod, ...(state.customModules || [])];
      state.customData[slug] = state.customData[slug] || [];
      saveState();
      toast("Dodano moduł.");
      routeTo(`#/module/${slug}`);
    });

    $$("[data-open]").forEach(btn => btn.addEventListener("click", () => routeTo(`#/module/${btn.dataset.open}`)));

    $$("[data-delmod]").forEach(btn => btn.addEventListener("click", async () => {
      const slug = btn.dataset.delmod;
      const m = (state.customModules || []).find(x => x.slug === slug);
      const ok = await confirmDialog({
        title: "Usunąć moduł?",
        body: `<div class="small muted">Usuniesz moduł <strong>${escapeHtml(m?.name || slug)}</strong> i jego dane (w tej sesji).</div>`,
        confirmText: "Usuń moduł",
        danger: true
      });
      if (!ok) return;
      state.customModules = (state.customModules || []).filter(x => x.slug !== slug);
      delete state.customData[slug];
      saveState();
      toast("Usunięto moduł.");
      render();
    }));
  }

  function parseFields(raw) {
    const out = [];
    if (!raw) return out;

    // field format: key:type:label:required
    // select options: select[Opt1|Opt2]
    const parts = raw.split(",").map(x => x.trim()).filter(Boolean);
    for (const p of parts) {
      const seg = p.split(":").map(x => x.trim());
      if (seg.length < 2) continue;

      const key = slugify(seg[0]).replace(/-/g, "_");
      let type = seg[1] || "text";
      let label = seg[2] || seg[0];
      let required = String(seg[3] || "false").toLowerCase() === "true";

      let options = null;
      const m = type.match(/^select\[(.+)\]$/i);
      if (m) {
        type = "select";
        options = m[1].split("|").map(s => s.trim()).filter(Boolean);
      }

      if (!["text","number","date","textarea","select","checkbox"].includes(type)) type = "text";

      out.push({ key, label, type, required, options });
    }
    // ensure unique keys
    const seen = new Set();
    return out.filter(f => {
      if (!f.key || seen.has(f.key)) return false;
      seen.add(f.key);
      return true;
    });
  }

  function pageCustomModule(slug) {
    const mod = (state.customModules || []).find(m => m.slug === slug);
    if (!mod) {
      $("#app").innerHTML = `<div class="card"><h2>Nie znaleziono modułu</h2><div class="small muted">Moduł "${escapeHtml(slug)}" nie istnieje.</div></div>`;
      return;
    }

    const entityKey = `custom:${slug}`;
    const list = state.customData[slug] || [];

    // map generic renderer to customData
    const columns = (mod.fields || []).slice(0, 5).map(f => ({
      key: f.key,
      label: f.label,
      render: (r) => {
        const val = r[f.key];
        if (f.type === "checkbox") return val ? "✅" : "—";
        return escapeHtml(val ?? "");
      }
    }));

    const formFields = (mod.fields || []).map(f => ({
      key: f.key,
      label: f.label,
      type: f.type,
      required: !!f.required,
      options: f.options || [],
      placeholder: f.type === "checkbox" ? "Tak/Nie" : ""
    }));

    // local helper that works on customData
    const app = $("#app");
    const searchId = "search-" + slug;

    app.innerHTML = `
      <section class="card">
        <div class="toolbar">
          <div>
            <h2>${escapeHtml(mod.name)}</h2>
            <div class="small muted">Moduł dodatkowy</div>
          </div>
<div class="toolbar-actions">
<input class="input input-search" id="${escapeAttr(searchId)}" placeholder="Szukaj..." />
            <button class="btn btn-primary" id="add-${escapeAttr(slug)}">Dodaj rekord</button>
          </div>
        </div>

        ${list.length ? `
          <table class="table">
            <thead>
              <tr>
                ${columns.map(c => `<th>${escapeHtml(c.label)}</th>`).join("")}
                <th></th>
              </tr>
            </thead>
            <tbody id="tbody-${escapeAttr(slug)}"></tbody>
          </table>
        ` : `<div class="small muted">Brak rekordów w module.</div>`}

        <div class="card" style="background:var(--bg);margin-top:12px">
          <div class="small muted">Chcesz, żebym dodał widoki typu Kanban / Kalendarz / Pipeline? Da się to zrobić per moduł.</div>
        </div>
      </section>
    `;

    const tbody = $(`#tbody-${slug}`);
    const search = $(`#${searchId}`);

    const rowToText = (r) => {
      let t = "";
      for (const f of mod.fields || []) t += " " + (r[f.key] ?? "");
      return t;
    };

    const renderRows = (term) => {
      if (!tbody) return;
      const t = (term || "").trim().toLowerCase();
      const filtered = t ? list.filter(r => rowToText(r).toLowerCase().includes(t)) : list;

      tbody.innerHTML = filtered.map((row) => `
        <tr>
          ${columns.map(c => `<td>${c.render ? c.render(row) : escapeHtml(row[c.key] ?? "")}</td>`).join("")}
          <td class="actions">
            <button class="btn" data-edit="${escapeAttr(row.id)}">Edytuj</button>
            <button class="btn btn-danger" data-del="${escapeAttr(row.id)}">Usuń</button>
          </td>
        </tr>
      `).join("");
    };

    renderRows("");

    search?.addEventListener("input", () => renderRows(search.value));

    $(`#add-${slug}`)?.addEventListener("click", () => {
      openFormModal({
        title: `Dodaj rekord — ${mod.name}`,
        fields: formFields,
        initial: {},
        onSave: (data) => {
          const row = { id: uid(), createdAt: nowIso(), updatedAt: nowIso(), ...data };
          state.customData[slug] = [row, ...(state.customData[slug] || [])];
          saveState();
          toast("Dodano.");
          render();
        }
      });
    });

    app.querySelectorAll("[data-edit]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.edit;
        const row = (state.customData[slug] || []).find(r => r.id === id);
        if (!row) return;
        openFormModal({
          title: `Edytuj rekord — ${mod.name}`,
          fields: formFields,
          initial: row,
          onSave: (data) => {
            state.customData[slug] = (state.customData[slug] || []).map(r => r.id === id ? { ...r, ...data, updatedAt: nowIso() } : r);
            saveState();
            toast("Zapisano.");
            render();
          }
        });
      });
    });

    app.querySelectorAll("[data-del]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.del;
        const ok = await confirmDialog({
          title: "Usunąć rekord?",
          body: `<div class="small muted">Tej operacji nie da się cofnąć (w tej sesji).</div>`,
          confirmText: "Usuń",
          danger: true
        });
        if (!ok) return;
        state.customData[slug] = (state.customData[slug] || []).filter(r => r.id !== id);
        saveState();
        toast("Usunięto.");
        render();
      });
    });
  }

    function pageSettings() {
    const app = $("#app");
    const theme = document.documentElement.dataset.theme || "light";

    app.innerHTML = `
      <section class="card">
        <div class="toolbar">
          <div>
            <h2>Ustawienia</h2>
            <div class="small muted">Preferencje wyglądu.</div>
          </div>
        </div>

        <div class="row">
          <div>
            <div class="label">Motyw</div>
            <select id="themeSelect">
              <option value="light"${theme==="light"?" selected":""}>Jasny</option>
              <option value="dark"${theme==="dark"?" selected":""}>Ciemny</option>
            </select>
          </div>
          <div>
            <div class="label">Wskazówka</div>
            <div class="small muted">Możesz też przełączyć motyw przyciskiem w prawym górnym rogu.</div>
          </div>
        </div>
      </section>
    `;

    $("#themeSelect").addEventListener("change", (e) => {
      setTheme(e.target.value);
      toast("Zmieniono motyw.");
    });
  }

function applyCentering() {
  const appEl = $("#app");
  const topbar = document.querySelector(".topbar");
  const footer = document.querySelector(".footer");
  if (!appEl || !topbar || !footer) return;

  const topH = topbar.getBoundingClientRect().height;
  const footH = footer.getBoundingClientRect().height;
  const padding = 44; // approx container vertical padding
  const available = Math.max(240, window.innerHeight - topH - footH - padding);

  // 1) Najpierw mierz realną wysokość treści BEZ minHeight i bez centrowania
  appEl.classList.remove("centered");
  const prevMinH = appEl.style.minHeight;
  appEl.style.minHeight = "0px";

  // ważne: mierzemy wysokość pierwszego dziecka (realna treść), a nie scrollHeight kontenera
  const content = appEl.firstElementChild;
  const contentH = content ? content.getBoundingClientRect().height : 0;

  // 2) Dopiero teraz ustawiamy minHeight, żeby było “miejsce” na wyśrodkowanie
  appEl.style.minHeight = available + "px";

  // 3) Decyzja: jeśli treść jest wyraźnie krótsza niż dostępna przestrzeń → centruj
  const shouldCenter = contentH > 0 && contentH < (available - 80);
  appEl.classList.toggle("centered", shouldCenter);

  // (opcjonalnie) jeśli chcesz przywracać poprzednie minHeight, usuń dwie linie wyżej
  // appEl.style.minHeight = prevMinH;
}

window.addEventListener("resize", () => requestAnimationFrame(applyCentering));


// ---------- Render ----------
  function render() {
    // default route
    if (!location.hash) routeTo("#/dashboard");

    renderNav();

    const hash = location.hash || "#/dashboard";
    const [_, route, p1, p2] = hash.split("/"); // "#", "dashboard"...

    // highlight active nav by rerenderNav; already done.

    let rendered = false;
    switch (route) {
      case "dashboard": pageDashboard(); rendered = true; break;
      case "clients": pageClients(); rendered = true; break;
      case "orders": pageOrders(); rendered = true; break;
      case "invoices": pageInvoices(); rendered = true; break;
      case "stock": pageStock(); rendered = true; break;
      case "reports": pageReports(); rendered = true; break;
      case "modules": pageModules(); rendered = true; break;
      case "module": pageCustomModule(p1 || ""); rendered = true; break;
      case "settings": pageSettings(); rendered = true; break;
      default:
        $("#app").innerHTML = `<div class="card"><h2>404</h2><div class="small muted">Nie znaleziono strony.</div></div>`;
        rendered = true;
    }
    if (rendered) requestAnimationFrame(applyCentering);
  }

  // ---------- Topbar actions ----------
  $("#btnTheme").addEventListener("click", () => {
    const cur = document.documentElement.dataset.theme || "light";
    setTheme(cur === "dark" ? "light" : "dark");
    toast("Zmieniono tryb.");
  });

  $("#btnReset").addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Wyczyścić sesję?",
      body: `<div class="small muted">Usunie wszystkie dane wprowadzone w tej sesji (sessionStorage). Po zatwierdzeniu wrócisz na Pulpit.</div>`,
      confirmText: "Wyczyść",
      danger: true
    });
    if (ok) resetState();
  });

  // first render
  render();
})();
