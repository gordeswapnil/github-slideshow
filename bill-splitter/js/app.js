/* ===================================================================
   app.js — UI controller. No frameworks; small templating helpers.
   ===================================================================
   Screens:  home  bill  people  allocate  result
   State lives in Store.loadCurrent() / saveCurrent().
   =================================================================== */
(function () {
  'use strict';

  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const fmt = (n) => (typeof n === 'number' ? n.toFixed(2) : '0.00');
  const fmtINR = (n) => '₹' + fmt(n);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // 8-slot palette (matches CSS vars); cycles beyond 8 with HSL fallback.
  const PALETTE = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
  const PALETTE_HEX = {
    p1: '#1e63d9', p2: '#6a3fbf', p3: '#1f8a3d', p4: '#d97706',
    p5: '#c2185b', p6: '#0f766e', p7: '#4338ca', p8: '#a16207',
  };
  const PALETTE_BG = {
    p1: '#e8f0fc', p2: '#f0eaf9', p3: '#e8f6ec', p4: '#fdf2e3',
    p5: '#fceaf1', p6: '#defaf6', p7: '#ebe9fb', p8: '#fbf4dd',
  };

  function colorFor(slot, fallbackIndex = 0) {
    if (slot && PALETTE_HEX[slot]) return PALETTE_HEX[slot];
    // beyond 8 people, generate from index
    const h = (fallbackIndex * 47) % 360;
    return `hsl(${h} 65% 42%)`;
  }
  function bgFor(slot, fallbackIndex = 0) {
    if (slot && PALETTE_BG[slot]) return PALETTE_BG[slot];
    const h = (fallbackIndex * 47) % 360;
    return `hsl(${h} 65% 92%)`;
  }
  function slotIndex(slot, fallbackIndex = 0) {
    const idx = PALETTE.indexOf(slot);
    return idx >= 0 ? idx + 1 : (fallbackIndex % 8) + 1;
  }

  // ============== Global app state =============

  const App = {
    bill: null,          // active bill
    screen: 'home',      // current screen id
    section: 'food',     // current section tab on Bill screen
    resultView: 'master',
  };

  function setBill(b) { App.bill = b; Store.saveCurrent(b); }
  function persist()  { if (App.bill) { Store.saveCurrent(App.bill); Store.upsertBill(App.bill); } }

  // ============== Toasts =============

  function toast(msg, ms = 1800) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms);
  }

  // ============== Modal =============

  function openModal(content) {
    const root = $('#modalRoot');
    const back = document.createElement('div'); back.className = 'modal-backdrop';
    const box  = document.createElement('div'); box.className = 'modal';
    box.innerHTML = content;
    back.appendChild(box);
    root.appendChild(back);
    back.addEventListener('click', (e) => { if (e.target === back) back.remove(); });
    return { back, box, close: () => back.remove() };
  }

  // ============== Routing =============

  function go(screen) {
    if (screen !== 'home' && !App.bill) {
      // any screen except home needs an active bill
      App.bill = Store.blankBill();
      setBill(App.bill);
    }
    App.screen = screen;
    $$('.navbtn').forEach((b) => b.classList.toggle('active', b.dataset.screen === screen));
    const tplId = 'tpl-' + screen;
    const node  = $('#' + tplId).content.firstElementChild.cloneNode(true);
    $('#main').replaceChildren(node);
    $('#backBtn').hidden = screen === 'home';
    $('#appbarTitle').textContent = ({
      home: 'Bill Splitter', bill: 'Bill Details', people: 'People',
      allocate: 'Allocate', result: 'Result',
    })[screen] || 'Bill Splitter';
    ({
      home: bindHome, bill: bindBill, people: bindPeople,
      allocate: bindAllocate, result: bindResult,
    })[screen]();
  }

  // ============================================================
  // HOME
  // ============================================================
  function bindHome() {
    $('#newBillBtn').addEventListener('click', () => {
      App.bill = Store.blankBill();
      // seed: empty people list — user will add
      setBill(App.bill);
      go('bill');
    });
    $('#scanBillBtn').addEventListener('click', () => $('#scanInput').click());
    $('#scanInput').addEventListener('change', onScanFile);

    const list = $('#savedList');
    const bills = Store.loadBills();
    if (bills.length === 0) {
      list.innerHTML = '<div class="empty">No saved bills yet. Tap <b>+ New Bill</b> to begin, or <b>Scan Bill</b> to import a photo or PDF.</div>';
      return;
    }
    list.innerHTML = '';
    bills.forEach((b) => {
      const calc = Calc.compute(b);
      const row  = document.createElement('div');
      row.className = 'saved-row';
      const date = b.meta.billDate || new Date(b.createdAt).toISOString().slice(0, 10);
      row.innerHTML = `
        <div class="meta">
          <div class="title">${esc(b.meta.restName || 'Untitled')}</div>
          <div class="sub">${esc(date)} · ${b.people.length} ppl · ${b.items.length} items</div>
        </div>
        <div class="amt">${fmtINR(calc.grand.total)}</div>
        <button class="del" aria-label="Delete">&times;</button>`;
      row.addEventListener('click', (e) => {
        if (e.target.classList.contains('del')) {
          if (confirm('Delete this bill?')) { Store.deleteBill(b.id); bindHome(); }
          return;
        }
        setBill(b); go('bill');
      });
      list.appendChild(row);
    });
  }

  async function onScanFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = ''; // reset
    const settings = Store.loadSettings();
    if (!settings.apiKey) {
      promptForApiKey(() => onScanFileResume(file));
      return;
    }
    await onScanFileResume(file);
  }

  async function onScanFileResume(file) {
    const settings = Store.loadSettings();
    const m = openModal(`<h3>Scanning bill…</h3><div class="spinner"></div><p class="muted" style="text-align:center;margin:0">Reading items from your image. This may take 10–20 seconds.</p>`);
    try {
      const parsed = await OCR.extractFromFile(file, settings.apiKey);
      const bill = Store.blankBill();
      bill.meta = Object.assign(bill.meta, parsed.meta || {});
      const restType = (parsed.meta && parsed.meta.restaurantType) || 'both';
      bill.items = (parsed.items || []).map((it) => {
        const section = ['food', 'liquor', 'other'].includes(it.section) ? it.section : 'food';
        let dietary = it.dietary;
        if (section === 'liquor') dietary = 'liquor';
        else if (restType === 'veg') dietary = 'veg';
        else if (!['veg', 'nonveg', 'any'].includes(dietary)) dietary = 'any';
        const category = ['starter','main','dessert','beverage','drink','accompaniment','extra'].includes(it.category)
          ? it.category : (section === 'liquor' ? 'drink' : section === 'other' ? 'extra' : 'main');
        return {
          id: Store.uid(),
          name: String(it.name || ''),
          rate: +it.rate || 0,
          qty:  +it.qty  || 1,
          amount: +it.amount || 0,
          section,
          dietary,
          category,
          isParcel: !!it.isParcel,
        };
      }).filter((it) => !(restType === 'veg' && it.section === 'liquor'));
      const taxesIn = Array.isArray(parsed.taxes)
        ? parsed.taxes
        : Store.normaliseTaxes(parsed.taxes);
      bill.taxes = taxesIn
        .filter((t) => +t.rate > 0)
        .map((t) => ({
          id:   Store.uid(),
          name: String(t.name || 'Tax'),
          rate: +t.rate || 0,
          base: ['food', 'liquor', 'other', 'all'].includes(t.base) ? t.base : 'food',
        }));
      // Stash scan-only metadata for the Bill screen banner
      bill._scanWarnings    = Array.isArray(parsed.warnings) ? parsed.warnings.slice() : [];
      bill._hasServiceCharge = !!parsed.hasServiceCharge;
      // Auto-allocate parcels to a single (placeholder) person at allocation time.
      // We can't pick a person yet (people list is empty after scan); the Allocate
      // screen will surface a hint per-parcel.
      setBill(bill);
      m.close();
      let toastMsg = 'Scanned ' + bill.items.length + ' items';
      if (bill._scanWarnings.length) toastMsg += ' · ' + bill._scanWarnings.length + ' warning(s)';
      toast(toastMsg + ' — review and continue.');
      go('bill');
    } catch (err) {
      m.close();
      alert('Scan failed: ' + (err.message || err));
    }
  }

  function promptForApiKey(after) {
    const settings = Store.loadSettings();
    const m = openModal(`
      <h3>Add Anthropic API key</h3>
      <p class="muted" style="margin:0">Scanning uses Claude's vision API. Your key is stored only on this device (localStorage).
      Get one at <b>console.anthropic.com</b>.</p>
      <label class="field"><span>API key</span><input id="apiKeyInput" type="password" placeholder="sk-ant-…" value="${esc(settings.apiKey || '')}" /></label>
      <div class="modal-actions">
        <button class="ghost" id="cancelKey">Cancel</button>
        <button class="primary" id="saveKey">Save</button>
      </div>`);
    $('#cancelKey', m.box).addEventListener('click', m.close);
    $('#saveKey', m.box).addEventListener('click', () => {
      const v = $('#apiKeyInput', m.box).value.trim();
      if (!v) return toast('Enter a key first.');
      Store.saveSettings(Object.assign(settings, { apiKey: v }));
      m.close();
      if (typeof after === 'function') after();
    });
  }

  // ============================================================
  // BILL (items + tax)
  // ============================================================
  function bindBill() {
    const b = App.bill;
    // Migrate legacy {cgst,sgst,vat} object to array form
    b.taxes = Store.normaliseTaxes(b.taxes);

    $('#restName').value  = b.meta.restName || '';
    $('#restSub').value   = b.meta.restSub  || '';
    $('#billNo').value    = b.meta.billNo   || '';
    $('#billDate').value  = b.meta.billDate || '';
    $('#billTable').value = b.meta.billTable|| '';
    $('#billHall').value  = b.meta.billHall || '';

    const writeMeta = (k, v) => { b.meta[k] = v; persist(); refreshTotals(); };
    $('#restName').addEventListener('input',  (e) => writeMeta('restName',  e.target.value));
    $('#restSub').addEventListener('input',   (e) => writeMeta('restSub',   e.target.value));
    $('#billNo').addEventListener('input',    (e) => writeMeta('billNo',    e.target.value));
    $('#billDate').addEventListener('change', (e) => writeMeta('billDate',  e.target.value));
    $('#billTable').addEventListener('input', (e) => writeMeta('billTable', e.target.value));
    $('#billHall').addEventListener('input',  (e) => writeMeta('billHall',  e.target.value));

    $$('#sectionSeg .seg-btn').forEach((btn) => btn.addEventListener('click', () => {
      $$('#sectionSeg .seg-btn').forEach((x) => x.classList.toggle('active', x === btn));
      App.section = btn.dataset.section;
      renderItems();
    }));
    $('#addItemBtn').addEventListener('click', addItem);
    $('#addTaxBtn').addEventListener('click', () => {
      b.taxes.push({ id: Store.uid(), name: '', rate: 0, base: 'food' });
      persist(); renderTaxes(); refreshTotals();
      setTimeout(() => {
        const last = $$('#taxesList .tax-row').pop();
        if (last) last.querySelector('.tax-name').focus();
      }, 40);
    });
    $('#addTipBtn').addEventListener('click', () => promptTip());
    renderScanWarnings();
    renderBillPaidBy();
    renderItems();
    renderTaxes();
    refreshTotals();
  }

  function renderBillPaidBy() {
    const sel = $('#billPaidBy'); if (!sel) return;
    const b = App.bill;
    sel.innerHTML = '<option value="">— Split at the counter (everyone pays Dutch) —</option>';
    (b.people || []).forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name || '(unnamed)';
      sel.appendChild(opt);
    });
    sel.value = b.paidBy || '';
    // Keep handler attached (re-render is safe; we always re-add)
    sel.onchange = () => {
      b.paidBy = sel.value || null;
      persist();
      // Item per-row dropdowns inherit from this; re-render items section
      renderItems();
    };
  }

  function promptTip() {
    const existing = (App.bill.taxes || []).find((t) =>
      /tip|service|gratuity/i.test(t.name || ''));
    const presets = [5, 10, 15];
    const m = openModal(`
      <h3>Add service charge / tip</h3>
      <p class="muted" style="margin:0">${App.bill._hasServiceCharge
        ? 'A service charge already appears on the bill — adding another will charge the group twice.'
        : 'Adds a charge on the whole bill, split proportionally.'}</p>
      <div class="tip-presets">
        ${presets.map((p) => `<button class="ghost tip-preset" data-pct="${p}">${p}%</button>`).join('')}
      </div>
      <label class="field"><span>Custom %</span><input id="tipPct" type="number" step="0.5" min="0" placeholder="e.g. 12.5" /></label>
      <div class="modal-actions">
        <button class="ghost" id="closeTip">Cancel</button>
        <button class="primary" id="applyTip">Apply</button>
      </div>`);
    function apply(pct) {
      if (!(pct > 0)) return toast('Enter a positive percentage.');
      if (existing) { existing.rate = +pct; existing.base = 'all'; }
      else App.bill.taxes.push({ id: Store.uid(), name: 'Service / Tip', rate: +pct, base: 'all' });
      persist(); renderTaxes(); refreshTotals(); m.close();
      toast('Added ' + pct + '% service / tip.');
    }
    $$('.tip-preset', m.box).forEach((b) =>
      b.addEventListener('click', () => apply(+b.dataset.pct)));
    $('#applyTip', m.box).addEventListener('click', () => apply(+$('#tipPct', m.box).value));
    $('#closeTip', m.box).addEventListener('click', m.close);
  }

  function renderScanWarnings() {
    const main = $('#main');
    const existing = $('.scan-warn-banner', main);
    if (existing) existing.remove();
    const b = App.bill;
    if (!b._scanWarnings || b._scanWarnings.length === 0) return;
    const banner = document.createElement('div');
    banner.className = 'scan-warn-banner';
    banner.innerHTML = `
      <div class="scan-warn-head">⚠️ Scan warnings — please verify</div>
      <ul>${b._scanWarnings.map((w) => '<li>' + esc(w) + '</li>').join('')}</ul>
      <button class="link-btn" id="dismissWarn">Dismiss</button>`;
    // Insert just below the page heading
    const screen = $('.screen', main);
    const h2 = screen.querySelector('h2');
    screen.insertBefore(banner, h2.nextSibling);
    $('#dismissWarn', banner).addEventListener('click', () => {
      b._scanWarnings = []; persist(); banner.remove();
    });
  }

  function renderTaxes() {
    const wrap = $('#taxesList'); if (!wrap) return;
    wrap.innerHTML = '';
    if (!App.bill.taxes || App.bill.taxes.length === 0) {
      const e = document.createElement('div');
      e.className = 'empty';
      e.textContent = 'No taxes on this bill yet. Tap "+ Add Tax / Charge" if your bill has GST, VAT, service charge, etc.';
      wrap.appendChild(e);
      return;
    }
    App.bill.taxes.forEach((t) => wrap.appendChild(taxRow(t)));
  }

  function taxRow(t) {
    const node = $('#tpl-tax-row').content.firstElementChild.cloneNode(true);
    node.dataset.id = t.id;
    const nameI = $('.tax-name', node);
    const rateI = $('.tax-rate', node);
    const baseS = $('.tax-base', node);
    nameI.value = t.name || '';
    rateI.value = t.rate ?? '';
    baseS.value = t.base || 'food';
    nameI.addEventListener('input',  () => { t.name = nameI.value;          persist(); });
    rateI.addEventListener('input',  () => { t.rate = +rateI.value || 0;    persist(); refreshTotals(); });
    baseS.addEventListener('change', () => { t.base = baseS.value;          persist(); refreshTotals(); });
    $('.delbtn', node).addEventListener('click', () => {
      App.bill.taxes = App.bill.taxes.filter((x) => x.id !== t.id);
      persist(); renderTaxes(); refreshTotals();
    });
    return node;
  }

  function renderItems() {
    const wrap = $('#itemList'); wrap.innerHTML = '';
    const list = App.bill.items.filter((i) => i.section === App.section);
    if (list.length === 0) {
      const e = document.createElement('div');
      e.className = 'empty';
      e.textContent = 'No items in this section yet. Tap "+ Add Item".';
      wrap.appendChild(e);
      return;
    }
    // Group by category for readability
    const order = ['starter', 'main', 'accompaniment', 'dessert', 'beverage', 'drink', 'extra'];
    const labels = {
      starter:'🥗 Starters', main:'🍛 Mains', accompaniment:'🌿 Sides',
      dessert:'🍨 Desserts', beverage:'🥤 Beverages', drink:'🍺 Drinks',
      extra:'📋 Extras',
    };
    const byCat = {};
    list.forEach((it) => {
      const c = it.category || 'main';
      (byCat[c] = byCat[c] || []).push(it);
    });
    order.forEach((cat) => {
      const items = byCat[cat] || [];
      if (items.length === 0) return;
      const head = document.createElement('div');
      head.className = 'cat-head';
      head.textContent = labels[cat] || cat;
      wrap.appendChild(head);
      items.forEach((it) => wrap.appendChild(itemRow(it)));
    });
  }

  function itemRow(it) {
    const node = $('#tpl-item-row').content.firstElementChild.cloneNode(true);
    node.dataset.id = it.id;
    const nameI = $('.it-name', node); const rateI = $('.it-rate', node);
    const qtyI  = $('.it-qty', node);  const amtI  = $('.it-amt', node);
    nameI.value = it.name || '';
    rateI.value = it.rate ?? '';
    qtyI.value  = it.qty  ?? 1;
    amtI.value  = it.amount || (Calc.itemTotal(it) || '');

    nameI.addEventListener('input', () => { it.name = nameI.value; persist(); });
    const recomputeAmt = () => {
      const auto = (+rateI.value || 0) * (+qtyI.value || 0);
      if (!it._amountTouched) { amtI.value = auto ? Calc.round2(auto) : ''; it.amount = 0; }
      else it.amount = +amtI.value || 0;
      it.rate = +rateI.value || 0; it.qty = +qtyI.value || 0;
      persist(); refreshTotals();
    };
    rateI.addEventListener('input', recomputeAmt);
    qtyI.addEventListener('input',  recomputeAmt);
    amtI.addEventListener('input', () => {
      it._amountTouched = true; it.amount = +amtI.value || 0;
      persist(); refreshTotals();
    });

    // Parcel chip — toggleable
    const ttagsParent = $('.it-tags', node).parentNode;
    const parcelChip = document.createElement('button');
    parcelChip.className = 'parcel-chip';
    parcelChip.type = 'button';
    parcelChip.setAttribute('aria-pressed', it.isParcel ? 'true' : 'false');
    parcelChip.innerHTML = '📦 Parcel';
    parcelChip.addEventListener('click', () => {
      it.isParcel = !it.isParcel;
      parcelChip.setAttribute('aria-pressed', it.isParcel ? 'true' : 'false');
      // When marking as parcel, reset allocation so the smart default re-applies
      delete App.bill.allocations[it.id];
      persist();
    });
    ttagsParent.insertBefore(parcelChip, $('.it-tags', node));

    // Dietary tags — Food/Other items get any/veg/nonveg; Liquor items
    // always show a single 'liquor' tag (not user-toggleable).
    const tagsWrap = $('.it-tags', node);
    if (it.section === 'liquor') {
      tagsWrap.innerHTML = '<button class="tag-btn" data-tag="liquor" aria-pressed="true">🥃 Liquor</button>';
      it.dietary = 'liquor';
    } else {
      if (!it.dietary || it.dietary === 'liquor') it.dietary = 'any';
      $$('.tag-btn', tagsWrap).forEach((btn) => {
        const isOn = btn.dataset.tag === it.dietary;
        btn.setAttribute('aria-pressed', isOn ? 'true' : 'false');
        btn.addEventListener('click', () => {
          it.dietary = btn.dataset.tag;
          $$('.tag-btn', tagsWrap).forEach((b) =>
            b.setAttribute('aria-pressed', b.dataset.tag === it.dietary ? 'true' : 'false'));
          // Invalidate this item's allocation so smart default re-applies on Allocate screen
          delete App.bill.allocations[it.id];
          persist();
        });
      });
    }

    // Per-item "Paid by" — used as an OVERRIDE only. By default an item
    // inherits the bill-level payer (set on the Bill Details screen).
    // Most users will leave this on "Inherits from bill"; override only
    // for the rare post-bill ice-cream-bought-separately case.
    const paidSel = $('.it-paidby-sel', node);
    const billPayer = App.bill.people.find((p) => p.id === App.bill.paidBy);
    const inheritLabel = billPayer
      ? '— Inherits from bill: ' + (billPayer.name || 'unnamed') + ' —'
      : '— Inherits from bill (currently Dutch) —';
    paidSel.innerHTML = '<option value="">' + esc(inheritLabel) + '</option>';
    App.bill.people.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = 'Override: ' + (p.name || 'unnamed');
      paidSel.appendChild(opt);
    });
    paidSel.value = it.paidBy || '';
    paidSel.addEventListener('change', () => {
      it.paidBy = paidSel.value || null;
      persist();
    });

    $('.delbtn', node).addEventListener('click', () => {
      App.bill.items = App.bill.items.filter((x) => x.id !== it.id);
      delete App.bill.allocations[it.id];
      persist(); renderItems(); refreshTotals();
    });
    return node;
  }

  function addItem() {
    const it = {
      id: Store.uid(), name: '', rate: 0, qty: 1, amount: 0,
      section: App.section,
      dietary: App.section === 'liquor' ? 'liquor' : 'any',
    };
    App.bill.items.push(it);
    persist(); renderItems(); refreshTotals();
    setTimeout(() => {
      const last = $$('#itemList .item-row').pop();
      if (last) last.querySelector('.it-name').focus();
    }, 50);
  }

  function refreshTotals() {
    if (!$('#totalsCard')) return;
    const b = App.bill;
    b.taxes = Store.normaliseTaxes(b.taxes);
    const food   = sumSection(b, 'food');
    const liquor = sumSection(b, 'liquor');
    const other  = sumSection(b, 'other');
    const all    = food + liquor + other;
    const baseFor = (t) =>
      t.base === 'liquor' ? liquor :
      t.base === 'other'  ? other :
      t.base === 'all'    ? all :
                            food;
    let taxRows = '';
    let taxSum  = 0;
    b.taxes.forEach((t) => {
      const amt = Calc.round2(baseFor(t) * (+t.rate || 0) / 100);
      taxSum += amt;
      const label = (t.name || 'Tax') + ' ' + (+t.rate || 0) + '%';
      taxRows += `<div class="tline"><span>${esc(label)} <i style="color:#94a3b8">(on ${t.base})</i></span><span>${fmtINR(amt)}</span></div>`;
    });
    const grand = Calc.round2(all + taxSum);
    $('#totalsCard').innerHTML = `
      <div class="tline"><span>Food subtotal</span><span>${fmtINR(food)}</span></div>
      <div class="tline"><span>Liquor subtotal</span><span>${fmtINR(liquor)}</span></div>
      <div class="tline"><span>Others subtotal</span><span>${fmtINR(other)}</span></div>
      ${taxRows}
      <div class="tline grand"><span>Grand Total</span><span>${fmtINR(grand)}</span></div>`;
  }
  function sumSection(b, sec) {
    return Calc.round2((b.items || [])
      .filter((i) => i.section === sec)
      .reduce((s, i) => s + Calc.itemTotal(i), 0));
  }

  // ============================================================
  // PEOPLE
  // ============================================================
  function bindPeople() {
    $('#addPersonBtn').addEventListener('click', addPerson);
    renderPeople();
  }
  function renderPeople() {
    const wrap = $('#peopleList'); wrap.innerHTML = '';
    if (App.bill.people.length === 0) {
      const e = document.createElement('div');
      e.className = 'empty';
      e.textContent = 'No people added yet. Tap "+ Add Person".';
      wrap.appendChild(e);
      return;
    }
    App.bill.people.forEach((p, i) => wrap.appendChild(personRow(p, i)));
  }
  function personRow(p, i) {
    const node = $('#tpl-person-row').content.firstElementChild.cloneNode(true);
    node.dataset.id = p.id;
    const chip = $('.color-chip', node);
    chip.style.background = colorFor(p.color, i);
    const nameI = $('.pname', node);
    nameI.value = p.name || '';
    nameI.addEventListener('input', () => { p.name = nameI.value; persist(); });
    chip.addEventListener('click', () => pickColor(p, () => renderPeople()));
    $('.delbtn', node).addEventListener('click', () => {
      App.bill.people = App.bill.people.filter((x) => x.id !== p.id);
      // remove this person from every allocation
      Object.values(App.bill.allocations).forEach((a) => { if (a && a.values) delete a.values[p.id]; });
      persist(); renderPeople();
    });

    // Preferences (diet tri-state + drinker toggle).
    // Migrate legacy { isVeg } to the new { diet } enum on first render.
    p.prefs = Store.normalisePrefs(p.prefs);
    const pillWrap = $('.diet-pill', node);
    const setDiet = (val) => {
      p.prefs.diet = val;
      $$('.diet-opt', pillWrap).forEach((b) =>
        b.classList.toggle('active', b.dataset.diet === val));
      pillWrap.dataset.diet = val;
      persist();
    };
    setDiet(p.prefs.diet || 'both');
    $$('.diet-opt', pillWrap).forEach((b) =>
      b.addEventListener('click', () => setDiet(b.dataset.diet)));

    const drinkBtn = $('.pref-btn[data-pref="drink"]', node);
    drinkBtn.setAttribute('aria-pressed', p.prefs.isDrinker ? 'true' : 'false');
    drinkBtn.addEventListener('click', () => {
      p.prefs.isDrinker = !p.prefs.isDrinker;
      drinkBtn.setAttribute('aria-pressed', p.prefs.isDrinker ? 'true' : 'false');
      persist();
    });
    return node;
  }
  function addPerson() {
    const i = App.bill.people.length;
    const p = { id: Store.uid(), name: '', color: PALETTE[i % PALETTE.length], prefs: Store.defaultPrefs() };
    App.bill.people.push(p);
    persist(); renderPeople();
    setTimeout(() => {
      const last = $$('#peopleList .person-row').pop();
      if (last) last.querySelector('.pname').focus();
    }, 50);
  }
  function pickColor(p, after) {
    const m = openModal(`
      <h3>Pick a color</h3>
      <div class="swatches">
        ${PALETTE.map((slot) => `<button class="swatch" data-slot="${slot}" style="background:${PALETTE_HEX[slot]}"></button>`).join('')}
      </div>
      <div class="modal-actions"><button class="ghost" id="closePick">Close</button></div>`);
    $('#closePick', m.box).addEventListener('click', m.close);
    $$('.swatch', m.box).forEach((b) => b.addEventListener('click', () => {
      p.color = b.dataset.slot; persist(); m.close(); after && after();
    }));
  }

  // ============================================================
  // ALLOCATE
  // ============================================================
  function bindAllocate() {
    if (App.bill.people.length === 0) {
      $('#allocList').innerHTML = '<div class="empty">Add people first.</div>';
      $('#runningTotals').innerHTML = '';
      return;
    }
    if (App.bill.items.length === 0) {
      $('#allocList').innerHTML = '<div class="empty">Add items first.</div>';
      $('#runningTotals').innerHTML = '';
      return;
    }
    renderAllocCards();
    renderRunningTotals();
  }

  function renderAllocCards() {
    const wrap = $('#allocList'); wrap.innerHTML = '';
    App.bill.items.forEach((it) => wrap.appendChild(allocCard(it)));
  }

  // Build a sensible default allocation for an item using person preferences.
  function defaultAllocationFor(it) {
    const eligible = Store.eligiblePeople(it, App.bill.people).map((p) => p.id);
    const ids = eligible.length > 0 ? eligible : App.bill.people.map((p) => p.id);
    // Parcels default to single-person assignment — the user just picks who.
    if (it.isParcel) {
      return { rule: 'assigned', values: { [ids[0]]: 1 } };
    }
    return { rule: 'equal', values: Object.fromEntries(ids.map((id) => [id, 1])) };
  }

  function allocCard(it) {
    const node = $('#tpl-alloc-card').content.firstElementChild.cloneNode(true);
    node.dataset.id = it.id;
    const tag = it.dietary && it.dietary !== 'any'
      ? ' · ' + ({ veg: 'VEG', nonveg: 'NON-VEG', liquor: 'LIQUOR' }[it.dietary] || '')
      : '';
    $('.alloc-name', node).textContent = (it.name || '(untitled)') + '  · ' + (it.section).toUpperCase() + tag;
    $('.alloc-amt',  node).textContent = fmtINR(Calc.itemTotal(it));
    const ruleSel    = $('.alloc-rule',   node);
    const hintEl     = $('.alloc-hint',   node);
    const quickEl    = $('.alloc-quick',  node);
    const peopleWrap = $('.alloc-people', node);
    const status     = $('.alloc-status', node);

    if (!App.bill.allocations[it.id]) {
      App.bill.allocations[it.id] = defaultAllocationFor(it);
    }
    const alloc = App.bill.allocations[it.id];
    ruleSel.value = alloc.rule;

    ruleSel.addEventListener('change', () => {
      alloc.rule = ruleSel.value;
      // reset values sensibly when rule changes — but seed by preferences
      const eligible = Store.eligiblePeople(it, App.bill.people).map((p) => p.id);
      const useIds = eligible.length > 0 ? eligible : App.bill.people.map((p) => p.id);
      if (alloc.rule === 'equal')    alloc.values = Object.fromEntries(useIds.map((id) => [id, 1]));
      if (alloc.rule === 'assigned') alloc.values = { [useIds[0]]: 1 };
      if (alloc.rule === 'percent')  alloc.values = Object.fromEntries(useIds.map((id) => [id, +(100 / useIds.length).toFixed(2)]));
      if (alloc.rule === 'amount') {
        const total = Calc.itemTotal(it);
        const each  = Calc.round2(total / useIds.length);
        alloc.values = Object.fromEntries(useIds.map((id) => [id, each]));
      }
      if (alloc.rule === 'quantity') {
        // Pre-fill quantities so they sum to item.qty, distributed equally among eligible
        const qty = +it.qty || useIds.length;
        const each = qty / useIds.length;
        alloc.values = Object.fromEntries(useIds.map((id) => [id, +each.toFixed(2)]));
      }
      if (alloc.rule === 'mixed') {
        // Pre-fill: no fixed amounts, qty distributed equally among eligible
        const qty = +it.qty || useIds.length;
        const each = qty / useIds.length;
        alloc.values  = Object.fromEntries(useIds.map((id) => [id, +each.toFixed(2)]));
        alloc.amounts = Object.fromEntries(App.bill.people.map((p) => [p.id, 0]));
      }
      persist(); renderRule(); renderRunningTotals();
    });

    // Quick-action buttons
    $$('.link-btn', quickEl).forEach((btn) => btn.addEventListener('click', () => {
      const act = btn.dataset.act;
      if (act === 'all')    App.bill.people.forEach((p) => (alloc.values[p.id] = 1));
      if (act === 'none')   App.bill.people.forEach((p) => (alloc.values[p.id] = 0));
      if (act === 'suggest') {
        const eligible = new Set(Store.eligiblePeople(it, App.bill.people).map((p) => p.id));
        App.bill.people.forEach((p) => (alloc.values[p.id] = eligible.has(p.id) ? 1 : 0));
      }
      if (act === 'auto-remainder') {
        // Quantity / Mixed rules: spread the unallocated qty equally among
        // people whose qty input is currently 0.
        const totalQty = +it.qty || 0;
        const assigned = App.bill.people.reduce((s, p) => s + (+alloc.values[p.id] || 0), 0);
        const remaining = Math.max(0, totalQty - assigned);
        const empty = App.bill.people.filter((p) => !(+alloc.values[p.id] > 0));
        if (empty.length === 0) { toast('Everyone already has a qty — clear one first.'); return; }
        const each = remaining / empty.length;
        empty.forEach((p) => (alloc.values[p.id] = +each.toFixed(2)));
      }
      persist(); renderRule(); renderRunningTotals();
    }));

    renderRule();

    function renderRule() {
      ruleSel.value = alloc.rule;
      // Hint + quick-action visibility per rule
      const showAllNone = (alloc.rule === 'equal');
      const showSuggest = showAllNone && it.dietary && it.dietary !== 'any';
      const showRem     = (alloc.rule === 'quantity' || alloc.rule === 'mixed');
      quickEl.hidden = !(showAllNone || showRem);
      $('.link-btn[data-act="all"]',  quickEl).hidden = !showAllNone;
      $('.link-btn[data-act="none"]', quickEl).hidden = !showAllNone;
      $('.link-btn[data-act="suggest"]', quickEl).hidden = !showSuggest;
      $('.link-btn[data-act="auto-remainder"]', quickEl).hidden = !showRem;

      hintEl.textContent = ({
        equal:    'Tap a person below to include / exclude them from this split.',
        assigned: 'Tap the person who paid 100% of this item.',
        quantity: 'Enter how many ' + ((+it.qty) || 'units') + ' each person had. Sum must equal ' + (it.qty || '?') + '.',
        percent:  'Enter each person\'s share %. Must total 100%.',
        amount:   'Enter each person\'s exact ₹ amount. Must total ' + fmtINR(Calc.itemTotal(it)) + '.',
        mixed:    'Per-person fixed ₹ + qty share. Fixed amounts are paid first; the remainder is split by qty.',
      })[alloc.rule] || '';

      peopleWrap.innerHTML = '';
      App.bill.people.forEach((p, i) => {
        const row = document.createElement('div');
        row.className = 'alloc-prow';
        const chip = document.createElement('span'); chip.className = 'pchip';
        chip.style.background = colorFor(p.color, i);
        const name = document.createElement('span'); name.className = 'pname'; name.textContent = p.name || '(no name)';
        row.appendChild(chip); row.appendChild(name);

        if (alloc.rule === 'equal') {
          const on = !!alloc.values[p.id];
          chip.classList.toggle('on', on); chip.classList.toggle('off', !on);
          chip.addEventListener('click', () => {
            alloc.values[p.id] = on ? 0 : 1;
            persist(); renderRule(); renderRunningTotals();
          });
          const share = document.createElement('span'); share.className = 'pshare';
          const shares = Calc.splitItem(it, alloc, App.bill.people);
          share.textContent = on ? fmtINR(shares[p.id] || 0) : '—';
          row.appendChild(share);
        }
        else if (alloc.rule === 'assigned') {
          const onId = Object.keys(alloc.values).find((k) => alloc.values[k]);
          const on = onId === p.id;
          chip.classList.toggle('on', on); chip.classList.toggle('off', !on);
          chip.addEventListener('click', () => {
            alloc.values = { [p.id]: 1 };
            persist(); renderRule(); renderRunningTotals();
          });
          const share = document.createElement('span'); share.className = 'pshare';
          share.textContent = on ? fmtINR(Calc.itemTotal(it)) : '—';
          row.appendChild(share);
        }
        else if (alloc.rule === 'percent') {
          const input = document.createElement('input');
          input.className = 'pinput'; input.type = 'number'; input.step = '0.5';
          input.value = alloc.values[p.id] || 0;
          input.addEventListener('input', () => {
            alloc.values[p.id] = +input.value || 0;
            persist(); renderRunningTotals(); updateAllocStatus();
          });
          row.appendChild(input);
          const suffix = document.createElement('span'); suffix.className = 'pshare'; suffix.textContent = '%';
          row.appendChild(suffix);
        }
        else if (alloc.rule === 'amount') {
          const input = document.createElement('input');
          input.className = 'pinput'; input.type = 'number'; input.step = '0.5'; input.inputMode = 'decimal';
          input.value = alloc.values[p.id] || 0;
          input.addEventListener('input', () => {
            alloc.values[p.id] = +input.value || 0;
            persist(); renderRunningTotals(); updateAllocStatus();
          });
          row.appendChild(input);
        }
        else if (alloc.rule === 'quantity') {
          const qrow = document.createElement('span'); qrow.className = 'pqtyrow';
          const minus = document.createElement('button'); minus.className = 'qty-step'; minus.textContent = '−';
          const input = document.createElement('input');
          input.className = 'pinput'; input.type = 'number'; input.step = '1'; input.min = '0'; input.inputMode = 'decimal';
          input.style.width = '60px';
          input.value = alloc.values[p.id] || 0;
          const plus  = document.createElement('button'); plus.className  = 'qty-step'; plus.textContent  = '+';
          minus.addEventListener('click', () => { input.value = Math.max(0, (+input.value || 0) - 1); input.dispatchEvent(new Event('input')); });
          plus.addEventListener( 'click', () => { input.value = (+input.value || 0) + 1;             input.dispatchEvent(new Event('input')); });
          input.addEventListener('input', () => {
            alloc.values[p.id] = +input.value || 0;
            // Recompute the share preview
            const shares = Calc.splitItem(it, alloc, App.bill.people);
            shareLabel.textContent = (+input.value > 0) ? fmtINR(shares[p.id] || 0) : '—';
            persist(); renderRunningTotals(); updateAllocStatus();
          });
          qrow.appendChild(minus); qrow.appendChild(input); qrow.appendChild(plus);
          row.appendChild(qrow);
          const shareLabel = document.createElement('span'); shareLabel.className = 'pshare';
          const shares = Calc.splitItem(it, alloc, App.bill.people);
          shareLabel.textContent = (+alloc.values[p.id] > 0) ? fmtINR(shares[p.id] || 0) : '—';
          row.appendChild(shareLabel);
        }
        else if (alloc.rule === 'mixed') {
          if (!alloc.amounts) alloc.amounts = {};
          // Two inputs: ₹ fixed (left)  and  qty (right). Plus a per-person share preview.
          const fixed = document.createElement('input');
          fixed.className = 'pinput'; fixed.type = 'number'; fixed.step = '0.5'; fixed.inputMode = 'decimal';
          fixed.style.width = '78px'; fixed.placeholder = '₹';
          fixed.value = alloc.amounts[p.id] || '';
          const qty = document.createElement('input');
          qty.className = 'pinput'; qty.type = 'number'; qty.step = '1'; qty.min = '0'; qty.inputMode = 'decimal';
          qty.style.width = '60px'; qty.placeholder = 'qty';
          qty.value = alloc.values[p.id] || '';
          const recalc = () => {
            alloc.amounts[p.id] = +fixed.value || 0;
            alloc.values[p.id]  = +qty.value   || 0;
            const shares = Calc.splitItem(it, alloc, App.bill.people);
            shareLabel.textContent = (shares[p.id] || 0) > 0 ? fmtINR(shares[p.id]) : '—';
            persist(); renderRunningTotals(); updateAllocStatus();
          };
          fixed.addEventListener('input', recalc);
          qty.addEventListener('input', recalc);
          const wrap2 = document.createElement('span'); wrap2.className = 'pqtyrow';
          wrap2.appendChild(fixed);
          const plus = document.createElement('span'); plus.textContent = '+'; plus.style.color = '#94a3b8'; plus.style.fontWeight = '700';
          wrap2.appendChild(plus);
          wrap2.appendChild(qty);
          row.appendChild(wrap2);
          const shareLabel = document.createElement('span'); shareLabel.className = 'pshare';
          const shares = Calc.splitItem(it, alloc, App.bill.people);
          shareLabel.textContent = (shares[p.id] || 0) > 0 ? fmtINR(shares[p.id]) : '—';
          row.appendChild(shareLabel);
        }
        peopleWrap.appendChild(row);
      });
      updateAllocStatus();
    }

    function updateAllocStatus() {
      const total = Calc.itemTotal(it);
      if (alloc.rule === 'percent') {
        const s = Object.values(alloc.values || {}).reduce((s, v) => s + (+v || 0), 0);
        status.classList.toggle('warn', Math.abs(s - 100) >= 0.5);
        status.classList.toggle('ok',   Math.abs(s - 100) <  0.5);
        status.textContent = 'Sum: ' + s + '% ' + (Math.abs(s - 100) < 0.5 ? '✓' : '(should be 100%)');
      } else if (alloc.rule === 'amount') {
        const s = Calc.round2(Object.values(alloc.values || {}).reduce((s, v) => s + (+v || 0), 0));
        status.classList.toggle('warn', Math.abs(s - total) >= 0.5);
        status.classList.toggle('ok',   Math.abs(s - total) <  0.5);
        status.textContent = 'Sum: ' + fmtINR(s) + ' / ' + fmtINR(total) + (Math.abs(s - total) < 0.5 ? ' ✓' : ' (must match item total)');
      } else if (alloc.rule === 'quantity') {
        const totalQty = +it.qty || 0;
        const s = Object.values(alloc.values || {}).reduce((s, v) => s + (+v || 0), 0);
        const ok = totalQty > 0 && Math.abs(s - totalQty) < 0.001;
        status.classList.toggle('warn', !ok);
        status.classList.toggle('ok',   ok);
        status.textContent = 'Allocated: ' + s + ' / ' + totalQty + (ok ? ' ✓' : ' (must match item qty)');
      } else if (alloc.rule === 'mixed') {
        const fixedSum = Object.values(alloc.amounts || {}).reduce((s, v) => s + (+v || 0), 0);
        const qtySum   = Object.values(alloc.values  || {}).reduce((s, v) => s + (+v || 0), 0);
        const remainder = Calc.round2(total - fixedSum);
        let msg = 'Fixed: ' + fmtINR(fixedSum) + ' · Remainder: ' + fmtINR(remainder);
        if (remainder > 0.5 && qtySum > 0) msg += ' (split across ' + qtySum + ' qty units)';
        if (fixedSum > total + 0.5)          { status.classList.add('warn'); status.classList.remove('ok'); msg = 'Fixed amounts exceed total ' + fmtINR(total); }
        else if (remainder > 0.5 && qtySum <= 0) { status.classList.add('warn'); status.classList.remove('ok'); msg += ' — set qty for sharers'; }
        else                                  { status.classList.add('ok');   status.classList.remove('warn'); msg += ' ✓'; }
        status.textContent = msg;
      } else if (alloc.rule === 'equal') {
        const n = Object.values(alloc.values || {}).filter((v) => v).length;
        status.textContent = n === 0 ? 'No one selected.' : 'Equal split across ' + n + ' ' + (n === 1 ? 'person' : 'people');
        status.classList.toggle('warn', n === 0); status.classList.remove('ok');
      } else {
        status.textContent = ''; status.classList.remove('warn', 'ok');
      }
    }

    return node;
  }

  function renderRunningTotals() {
    const wrap = $('#runningTotals'); if (!wrap) return;
    const calc = Calc.compute(App.bill);
    let html = '';
    App.bill.people.forEach((p, i) => {
      html += `<div class="rrow"><span><span class="pchip" style="background:${colorFor(p.color, i)}"></span>${esc(p.name || '(no name)')}</span><b>${fmtINR(calc.grand.perPerson[p.id] || 0)}</b></div>`;
    });
    html += `<div class="rrow" style="border-top:1px solid #e5e7eb;margin-top:6px;padding-top:8px;"><b>Grand Total</b><b>${fmtINR(calc.grand.total)}</b></div>`;
    wrap.innerHTML = html;
  }

  // ============================================================
  // RESULT (render + export)
  // ============================================================
  function bindResult() {
    const warnings = Calc.validate(App.bill);
    if (warnings.length > 0) {
      $('#resultView').innerHTML = '<div class="empty"><b>Fix the following:</b><br/>' + warnings.map(esc).join('<br/>') + '</div>';
      return;
    }
    $$('#resultSeg .seg-btn').forEach((btn) => btn.addEventListener('click', () => {
      $$('#resultSeg .seg-btn').forEach((x) => x.classList.toggle('active', x === btn));
      App.resultView = btn.dataset.view; renderResult();
    }));
    renderResult();
    $('#exportPdf').addEventListener('click',  () => doExport('pdf'));
    $('#exportPng').addEventListener('click',  () => doExport('png'));
    $('#exportHtml').addEventListener('click', () => doExport('html'));
    $('#exportShare').addEventListener('click', async () => {
      const calc = Calc.compute(App.bill);
      const r = await Exporter.shareSummary(App.bill, calc);
      if (r === 'copied') toast('Summary copied to clipboard.');
    });
  }

  async function doExport(kind) {
    const calc = Calc.compute(App.bill);
    const fns  = { renderMaster, renderPerPerson, renderQuickPay };
    try {
      if (kind === 'pdf')      { toast('Building PDF…');  await Exporter.exportPdf(App.bill,  calc, fns); }
      else if (kind === 'png') { toast('Building PNG…');  await Exporter.exportPng(App.bill,  calc, fns); }
      else if (kind === 'html'){ Exporter.exportHtml(App.bill, calc, fns); toast('HTML downloaded.'); }
    } catch (e) {
      alert('Export failed: ' + (e.message || e));
    }
  }

  function renderResult() {
    const calc = Calc.compute(App.bill);
    const view = App.resultView;
    if (view === 'master')   $('#resultView').innerHTML = renderMaster(App.bill, calc);
    if (view === 'person')   $('#resultView').innerHTML = renderPerPerson(App.bill, calc);
    if (view === 'quickpay') $('#resultView').innerHTML = renderQuickPay(App.bill, calc);
  }

  // ============== Renderers (also used by Exporter) ==============

  function metaLine(b) {
    const bits = [];
    if (b.meta.billNo)    bits.push('Bill: ' + b.meta.billNo);
    if (b.meta.billDate)  bits.push('Date: ' + b.meta.billDate);
    if (b.meta.billTable) bits.push('Table: ' + b.meta.billTable);
    if (b.meta.billHall)  bits.push(b.meta.billHall);
    return bits.join('  |  ');
  }

  function renderMaster(b, calc, opts) {
    const forExport = !!(opts && opts.forExport);
    const people = b.people;
    const npeople = people.length;
    const groups = { food: [], liquor: [], other: [] };
    b.items.forEach((it) => groups[it.section || 'food'].push(it));

    const colsHeader = people.map((p, i) =>
      `<th class="num h-${slotIndex(p.color, i)}" style="${forExport ? `color:${colorFor(p.color, i)}` : ''}">${esc(p.name || ('P' + (i + 1)))} (₹)</th>`
    ).join('');

    let html = '';
    html += `<div class="ttl-band">${esc(b.meta.restName || 'BILL')}${b.meta.restSub ? ' — ' + esc(b.meta.restSub) : ''} &middot; Bill Split (${npeople} People)</div>`;
    html += `<div class="sub-band"><span>${people.map((p) => esc(p.name || '?')).join(' | ')}</span><span>${esc(metaLine(b))}</span></div>`;
    html += `<table><thead><tr>
      <th>Item</th><th class="num">Rate</th><th class="num">Qty</th><th class="num">Total (₹)</th>
      ${colsHeader}
      <th>Split Rule</th>
    </tr></thead><tbody>`;

    function groupRows(title, list, klass) {
      if (list.length === 0) return '';
      let s = `<tr><td colspan="${4 + npeople + 1}" class="grp ${klass || ''}">${title}</td></tr>`;
      list.forEach((it) => {
        const shares = calc.itemShares[it.id] || {};
        const tot    = calc.itemTotals[it.id] || 0;
        s += `<tr>
          <td>${esc(it.name)}</td>
          <td class="num">${fmt(it.rate)}</td>
          <td class="num">${it.qty}</td>
          <td class="num">${fmt(tot)}</td>
          ${people.map((p, i) => `<td class="num" style="${forExport ? `color:${colorFor(p.color, i)}` : ''}">${shares[p.id] ? fmt(shares[p.id]) : '-'}</td>`).join('')}
          <td><i style="color:#6b7280">${esc(calc.itemRules[it.id] || '')}</i></td>
        </tr>`;
      });
      return s;
    }

    html += groupRows('🍽 FOOD (Pre-tax)',    groups.food, 'food');
    html += groupRows('🥃 LIQUOR (Pre-tax)',  groups.liquor, 'liquor');
    html += groupRows('📋 OTHERS',            groups.other, 'other');

    // Tax rows — one row per tax line on the bill
    const tx = calc.taxByPerson;
    (b.taxes || []).forEach((t) => {
      const label = (t.name || 'Tax') + ' @ ' + (+t.rate || 0) + '% on ' + t.base;
      html += `<tr class="tax-row">
        <td colspan="3">${esc(label)}</td>
        <td class="num">${fmt(calc.taxTotals[t.id] || 0)}</td>
        ${people.map((p) => `<td class="num">${fmt(tx[p.id][t.id] || 0)}</td>`).join('')}
        <td><i style="color:#6b7280">Proportional to ${t.base} share</i></td>
      </tr>`;
    });

    // Grand total row
    html += `<tr class="grand-row">
      <td colspan="3">★ GRAND TOTAL (₹)</td>
      <td class="num">${fmt(calc.grand.total)}</td>
      ${people.map((p) => `<td class="num">${fmt(calc.grand.perPerson[p.id])}</td>`).join('')}
      <td>Total: ₹${fmt(calc.grand.total)}</td>
    </tr>`;

    html += `</tbody></table>`;
    html += `<div class="ftr">Note: Tax shares are proportional to each person's pre-tax section share. Minor rounding in individual shares is normal.</div>`;
    const wrapped = `<div class="rpt">${html}</div>`;
    // Append settlement panel if anyone fronted cash
    return wrapped + renderSettlement(b, calc, forExport);
  }

  function renderPerPerson(b, calc, opts) {
    const forExport = !!(opts && opts.forExport);
    const people = b.people;
    let html = '';
    html += `<div class="rpt"><div class="ttl-band">BILL SPLIT — PER PERSON SUMMARY</div>`;
    html += `<div class="sub-band"><span>${esc((b.meta.restName || '') + (b.meta.restSub ? ' · ' + b.meta.restSub : ''))}</span><span>${esc(metaLine(b))}</span></div></div>`;

    people.forEach((p, i) => {
      const idx = slotIndex(p.color, i);
      const hex = colorFor(p.color, i);
      const bgx = bgFor(p.color, i);

      let rows = '';
      let subtotalPre = 0;
      b.items.forEach((it) => {
        const share = (calc.itemShares[it.id] || {})[p.id] || 0;
        if (share <= 0) return;
        subtotalPre += share;
        const ruleNote = noteForRule(b.allocations[it.id], it, p);
        rows += `<tr>
          <td>${esc(it.name)}</td>
          <td class="num">${fmt(share)}</td>
          <td><i style="color:#6b7280">${esc(ruleNote)}</i></td>
        </tr>`;
      });
      const tx = calc.taxByPerson[p.id] || {};
      (b.taxes || []).forEach((t) => {
        const v = tx[t.id] || 0;
        if (v > 0) {
          const label = (t.name || 'Tax') + ' ' + (+t.rate || 0) + '%';
          rows += `<tr><td>${esc(label)}</td><td class="num">${fmt(v)}</td><td><i style="color:#6b7280">on ${t.base}</i></td></tr>`;
        }
      });
      const tot = calc.grand.perPerson[p.id] || 0;

      const bandStyle = forExport ? `background:${hex}` : '';
      const totStyle  = forExport ? `background:${bgx};color:${hex}` : '';

      html += `<div class="rpt pcard-${idx}" style="margin-top:14px">
        <div class="person-band pband-${idx}" style="${bandStyle}">👤 ${esc((p.name || 'Person').toUpperCase())}</div>
        <table>
          <thead><tr><th>Charge</th><th class="num">Amount (₹)</th><th>Notes</th></tr></thead>
          <tbody>
            ${rows || '<tr><td colspan="3" style="color:#94a3b8;text-align:center">No charges</td></tr>'}
            <tr class="person-total"><td style="${totStyle}">TOTAL — ${esc(p.name || 'Person')}</td><td class="num" style="${totStyle}">${fmt(tot)}</td><td style="${totStyle}"></td></tr>
          </tbody>
        </table>
      </div>`;
    });

    // Grand-total footer card
    html += `<div class="rpt" style="margin-top:14px"><table><tr class="grand-row">
      <td>★ GRAND TOTAL</td><td class="num">${fmt(calc.grand.total)}</td>
    </tr></table></div>`;

    // Settlement panel — only show when someone fronted cash
    html += renderSettlement(b, calc, forExport);
    return html;
  }

  /**
   * Render the "Who pays whom" settlement section.
   * Shows: each person's net, then a list of pairwise transfers.
   *
   * IMPORTANT: the columns here are about REIMBURSEMENT only. They include
   * just the items that someone fronted (`paidBy` set). Items split Dutch
   * at the counter are NOT in the settlement — those amounts each person
   * already pays directly to the merchant.
   */
  function renderSettlement(b, calc, forExport) {
    const anyPaid = Object.values(calc.paidByPerson || {}).some((v) => v > 0);
    if (!anyPaid) return '';   // nothing to settle — group went Dutch

    const people = b.people;
    // Detect whether there are also Dutch items in the bill, so we can warn
    // the user that the settlement covers ONLY the items someone fronted.
    const hasDutchItems = (b.items || []).some((it) => !it.paidBy && Calc.itemTotal(it) > 0);

    let rows = '';
    rows += `<table style="margin:0">
      <thead><tr>
        <th>Person</th>
        <th class="num">Share to repay (₹)</th>
        <th class="num">Paid by them (₹)</th>
        <th class="num">Net (₹)</th>
      </tr></thead><tbody>`;
    people.forEach((p) => {
      // Settlement-relevant numbers only (paid-by items + their taxes).
      const consumed = (calc.settlementConsumedPerPerson || {})[p.id] || 0;
      const paid     = calc.paidByPerson[p.id]   || 0;
      const net      = calc.netPerPerson[p.id]   || 0;
      const netLabel = net >  0.005 ? `<span style="color:#b91c1c">owes ${fmt(net)}</span>`
                     : net < -0.005 ? `<span style="color:#16a34a">+${fmt(-net)} to receive</span>`
                                    : `<span style="color:#6b7280">settled</span>`;
      rows += `<tr>
        <td><b>${esc(p.name || '?')}</b></td>
        <td class="num">${fmt(consumed)}</td>
        <td class="num">${fmt(paid)}</td>
        <td class="num">${netLabel}</td>
      </tr>`;
    });
    rows += `</tbody></table>`;

    let transfers = '';
    if (!calc.settlement || calc.settlement.length === 0) {
      transfers = `<div class="settle-empty">No transfers needed — everyone is settled.</div>`;
    } else {
      transfers = calc.settlement.map((t) =>
        `<div class="settle-row">
           <span class="from">${esc(t.from || '?')}</span>
           <span class="arrow">→ pays →</span>
           <span class="to">${esc(t.to || '?')}</span>
           <span class="amt">${fmtINR(t.amount)}</span>
         </div>`
      ).join('');
    }

    const dutchNote = hasDutchItems
      ? `<div class="sub-band" style="background:#fffbeb;color:#78350f;font-style:normal">
           <b>Note:</b> Some items on this bill have no "Paid by" — those are assumed to be split at the counter directly, and are <i>not</i> included in the settlement below. The numbers here cover ONLY the reimbursement needed for items someone fronted.
         </div>`
      : '';

    return `<div class="rpt" style="margin-top:14px">
      <div class="ttl-band">💸 SETTLEMENT — Who pays whom</div>
      <div class="sub-band">Per-person reimbursement. <b>Share to repay</b> = their portion of items someone fronted (incl. tax). <b>Paid by them</b> = how much they fronted. <b>Net</b> = transfer needed.</div>
      ${dutchNote}
      ${rows}
    </div>
    <div class="settle-card">${transfers}</div>`;
  }

  function noteForRule(alloc, it, p) {
    if (!alloc) return 'Equal ÷ all';
    if (alloc.rule === 'equal') {
      const selected = Object.keys(alloc.values || {}).filter((k) => alloc.values[k]).length;
      return 'Equal ÷ ' + selected;
    }
    if (alloc.rule === 'assigned') return 'Assigned';
    if (alloc.rule === 'percent')  return 'Custom %';
    if (alloc.rule === 'amount')   return 'Custom split';
    if (alloc.rule === 'quantity') {
      const q = +(alloc.values || {})[p.id] || 0;
      const total = +it.qty || 0;
      return 'Qty ' + q + ' of ' + total;
    }
    if (alloc.rule === 'mixed') {
      const q = +(alloc.values  || {})[p.id] || 0;
      const a = +(alloc.amounts || {})[p.id] || 0;
      const bits = [];
      if (a > 0) bits.push('₹' + a.toFixed(0) + ' fixed');
      if (q > 0) bits.push('qty ' + q);
      return bits.join(' + ') || '—';
    }
    return '';
  }

  function renderQuickPay(b, calc, opts) {
    const forExport = !!(opts && opts.forExport);
    const people = b.people;
    const anyPaid = Object.values(calc.paidByPerson || {}).some((v) => v > 0);

    let html = `<div class="rpt"><div class="ttl-band">💳 QUICK PAY CARD — ${esc(b.meta.restName || '')}</div>`;
    html += `<div class="sub-band">${b.meta.billNo ? 'No: ' + esc(b.meta.billNo) : ''} ${b.meta.billTable ? '| Table ' + esc(b.meta.billTable) : ''} ${b.meta.billDate ? '| ' + esc(b.meta.billDate) : ''} | Grand Total: ${fmtINR(calc.grand.total)}</div>`;

    if (!anyPaid) {
      // Original simple display — group went Dutch
      html += `<div class="qp">
        <div class="qp-head"><div>Name</div><div>Amount to Pay (₹)</div><div>Rounded</div></div>`;
      people.forEach((p, i) => {
        const amt = calc.grand.perPerson[p.id] || 0;
        const bgx = bgFor(p.color, i);
        const hex = colorFor(p.color, i);
        const rowStyle = forExport ? `background:${bgx};color:${hex}` : '';
        html += `<div class="qp-row" style="${rowStyle}">
          <div class="qp-name">${esc(p.name || ('P' + (i + 1)))}</div>
          <div class="qp-amt">${fmt(amt)}</div>
          <div class="qp-round">${Math.round(amt).toLocaleString('en-IN')}</div>
        </div>`;
      });
      html += `<div class="qp-row qp-total">
        <div class="qp-name">TOTAL</div>
        <div class="qp-amt">${fmt(calc.grand.total)}</div>
        <div class="qp-round">${Math.round(calc.grand.total).toLocaleString('en-IN')}</div>
      </div>`;
      html += `</div></div>`;
      return html;
    }

    // Net display — someone fronted cash; show each person's net position
    html += `<div class="qp">
      <div class="qp-head"><div>Name</div><div>Net (₹)</div><div>Status</div></div>`;
    people.forEach((p, i) => {
      const net = calc.netPerPerson[p.id] || 0;
      const bgx = bgFor(p.color, i);
      const hex = colorFor(p.color, i);
      const rowStyle = forExport ? `background:${bgx};color:${hex}` : '';
      let status;
      if      (net >  0.005) status = '<b style="color:#b91c1c">PAY</b>';
      else if (net < -0.005) status = '<b style="color:#16a34a">RECEIVE</b>';
      else                   status = '<span style="color:#6b7280">settled</span>';
      html += `<div class="qp-row" style="${rowStyle}">
        <div class="qp-name">${esc(p.name || ('P' + (i + 1)))}</div>
        <div class="qp-amt">${fmt(Math.abs(net))}</div>
        <div class="qp-round">${status}</div>
      </div>`;
    });
    html += `</div></div>`;
    // Transfer instructions
    html += renderSettlement(b, calc, forExport);
    return html;
  }

  // ============================================================
  // Menu (API key, clear data)
  // ============================================================
  function openMenu() {
    const settings = Store.loadSettings();
    const m = openModal(`
      <h3>Settings</h3>
      <button class="primary" id="setKey">Set Anthropic API key</button>
      <button class="ghost"   id="clrCurrent">Discard current bill</button>
      <button class="ghost"   id="clrAll" style="border-color:#dc2626;color:#dc2626">Clear all data</button>
      <div class="modal-actions"><button class="ghost" id="closeMenu">Close</button></div>
      <p class="muted" style="font-size:11px;margin:0">Bills are stored locally on this device. API key (if set) is used only to call Anthropic from your browser.</p>`);
    $('#closeMenu', m.box).addEventListener('click', m.close);
    $('#setKey', m.box).addEventListener('click', () => { m.close(); promptForApiKey(); });
    $('#clrCurrent', m.box).addEventListener('click', () => {
      if (confirm('Discard the current bill (saved bills remain)?')) {
        Store.saveCurrent(null); App.bill = null; m.close(); go('home');
      }
    });
    $('#clrAll', m.box).addEventListener('click', () => {
      if (confirm('Delete ALL bills and settings from this device?')) {
        localStorage.clear(); App.bill = null; m.close(); go('home');
      }
    });
  }

  // ============================================================
  // Boot
  // ============================================================
  window.addEventListener('DOMContentLoaded', () => {
    $$('.navbtn').forEach((b) => b.addEventListener('click', () => go(b.dataset.screen)));
    $('#backBtn').addEventListener('click', () => go('home'));
    $('#menuBtn').addEventListener('click', openMenu);

    App.bill = Store.loadCurrent();
    go(App.bill ? 'home' : 'home');

    // Register PWA service worker (optional; ignored when not served over https)
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  });
})();
