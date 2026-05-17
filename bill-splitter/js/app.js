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
      bill.taxes = Object.assign(bill.taxes, parsed.taxes || {});
      bill.items = (parsed.items || []).map((it) => ({
        id: Store.uid(),
        name: String(it.name || ''),
        rate: +it.rate || 0,
        qty:  +it.qty  || 1,
        amount: +it.amount || 0,
        section: ['food', 'liquor', 'other'].includes(it.section) ? it.section : 'food',
      }));
      setBill(bill);
      m.close();
      toast('Scanned ' + bill.items.length + ' items — review and continue.');
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
    $('#restName').value  = b.meta.restName || '';
    $('#restSub').value   = b.meta.restSub  || '';
    $('#billNo').value    = b.meta.billNo   || '';
    $('#billDate').value  = b.meta.billDate || '';
    $('#billTable').value = b.meta.billTable|| '';
    $('#billHall').value  = b.meta.billHall || '';
    $('#taxCgst').value   = b.taxes.cgst ?? '';
    $('#taxSgst').value   = b.taxes.sgst ?? '';
    $('#taxVat').value    = b.taxes.vat  ?? '';

    const writeMeta = (k, v) => { b.meta[k] = v; persist(); refreshTotals(); };
    $('#restName').addEventListener('input',  (e) => writeMeta('restName',  e.target.value));
    $('#restSub').addEventListener('input',   (e) => writeMeta('restSub',   e.target.value));
    $('#billNo').addEventListener('input',    (e) => writeMeta('billNo',    e.target.value));
    $('#billDate').addEventListener('change', (e) => writeMeta('billDate',  e.target.value));
    $('#billTable').addEventListener('input', (e) => writeMeta('billTable', e.target.value));
    $('#billHall').addEventListener('input',  (e) => writeMeta('billHall',  e.target.value));
    $('#taxCgst').addEventListener('input',   (e) => { b.taxes.cgst = +e.target.value || 0; persist(); refreshTotals(); });
    $('#taxSgst').addEventListener('input',   (e) => { b.taxes.sgst = +e.target.value || 0; persist(); refreshTotals(); });
    $('#taxVat').addEventListener('input',    (e) => { b.taxes.vat  = +e.target.value || 0; persist(); refreshTotals(); });

    $$('#sectionSeg .seg-btn').forEach((btn) => btn.addEventListener('click', () => {
      $$('#sectionSeg .seg-btn').forEach((x) => x.classList.toggle('active', x === btn));
      App.section = btn.dataset.section;
      renderItems();
    }));
    $('#addItemBtn').addEventListener('click', addItem);
    renderItems();
    refreshTotals();
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
    list.forEach((it) => wrap.appendChild(itemRow(it)));
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
    $('.delbtn', node).addEventListener('click', () => {
      App.bill.items = App.bill.items.filter((x) => x.id !== it.id);
      delete App.bill.allocations[it.id];
      persist(); renderItems(); refreshTotals();
    });
    return node;
  }

  function addItem() {
    const it = { id: Store.uid(), name: '', rate: 0, qty: 1, amount: 0, section: App.section };
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
    const food   = sumSection(b, 'food');
    const liquor = sumSection(b, 'liquor');
    const other  = sumSection(b, 'other');
    const cgst  = Calc.round2(food   * (b.taxes.cgst || 0) / 100);
    const sgst  = Calc.round2(food   * (b.taxes.sgst || 0) / 100);
    const vat   = Calc.round2(liquor * (b.taxes.vat  || 0) / 100);
    const grand = Calc.round2(food + liquor + other + cgst + sgst + vat);
    $('#totalsCard').innerHTML = `
      <div class="tline"><span>Food subtotal</span><span>${fmtINR(food)}</span></div>
      <div class="tline"><span>Liquor subtotal</span><span>${fmtINR(liquor)}</span></div>
      <div class="tline"><span>Others subtotal</span><span>${fmtINR(other)}</span></div>
      <div class="tline"><span>Food CGST ${b.taxes.cgst || 0}%</span><span>${fmtINR(cgst)}</span></div>
      <div class="tline"><span>Food SGST ${b.taxes.sgst || 0}%</span><span>${fmtINR(sgst)}</span></div>
      <div class="tline"><span>Liquor VAT ${b.taxes.vat || 0}%</span><span>${fmtINR(vat)}</span></div>
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
    return node;
  }
  function addPerson() {
    const i = App.bill.people.length;
    const p = { id: Store.uid(), name: '', color: PALETTE[i % PALETTE.length] };
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

  function allocCard(it) {
    const node = $('#tpl-alloc-card').content.firstElementChild.cloneNode(true);
    node.dataset.id = it.id;
    $('.alloc-name', node).textContent = (it.name || '(untitled)') + '  · ' + (it.section).toUpperCase();
    $('.alloc-amt',  node).textContent = fmtINR(Calc.itemTotal(it));
    const ruleSel = $('.alloc-rule', node);
    const peopleWrap = $('.alloc-people', node);
    const status = $('.alloc-status', node);

    if (!App.bill.allocations[it.id]) {
      // default: equal split across everyone
      App.bill.allocations[it.id] = { rule: 'equal', values: Object.fromEntries(App.bill.people.map((p) => [p.id, 1])) };
    }
    const alloc = App.bill.allocations[it.id];
    ruleSel.value = alloc.rule;
    renderRule();

    ruleSel.addEventListener('change', () => {
      alloc.rule = ruleSel.value;
      // reset values sensibly when rule changes
      if (alloc.rule === 'equal')    alloc.values = Object.fromEntries(App.bill.people.map((p) => [p.id, 1]));
      if (alloc.rule === 'assigned') alloc.values = Object.fromEntries([[App.bill.people[0].id, 1]]);
      if (alloc.rule === 'percent')  alloc.values = Object.fromEntries(App.bill.people.map((p) => [p.id, Math.round(100 / App.bill.people.length)]));
      if (alloc.rule === 'amount') {
        const total = Calc.itemTotal(it);
        const each  = Calc.round2(total / App.bill.people.length);
        alloc.values = Object.fromEntries(App.bill.people.map((p) => [p.id, each]));
      }
      persist(); renderRule(); renderRunningTotals();
    });

    function renderRule() {
      peopleWrap.innerHTML = '';
      App.bill.people.forEach((p, i) => {
        const row = document.createElement('div');
        row.className = 'alloc-prow';
        const chip = document.createElement('span'); chip.className = 'pchip';
        chip.style.background = colorFor(p.color, i);
        const name = document.createElement('span'); name.className = 'pname'; name.textContent = p.name || '(no name)';
        row.appendChild(chip); row.appendChild(name);

        if (alloc.rule === 'equal') {
          if (alloc.values[p.id]) chip.classList.add('on');
          chip.addEventListener('click', () => {
            alloc.values[p.id] = alloc.values[p.id] ? 0 : 1;
            persist(); renderRule(); renderRunningTotals();
          });
          const share = document.createElement('span'); share.className = 'pshare';
          const shares = Calc.splitItem(it, alloc, App.bill.people);
          share.textContent = fmtINR(shares[p.id] || 0);
          row.appendChild(share);
        }
        else if (alloc.rule === 'assigned') {
          const onId = Object.keys(alloc.values).find((k) => alloc.values[k]);
          if (onId === p.id) chip.classList.add('on');
          chip.addEventListener('click', () => {
            alloc.values = { [p.id]: 1 };
            persist(); renderRule(); renderRunningTotals();
          });
          const share = document.createElement('span'); share.className = 'pshare';
          share.textContent = onId === p.id ? fmtINR(Calc.itemTotal(it)) : '—';
          row.appendChild(share);
        }
        else if (alloc.rule === 'percent') {
          const input = document.createElement('input');
          input.className = 'pinput'; input.type = 'number'; input.step = '0.5';
          input.value = alloc.values[p.id] || 0;
          input.addEventListener('input', () => {
            alloc.values[p.id] = +input.value || 0;
            persist(); renderRunningTotals();
            updateAllocStatus();
          });
          row.appendChild(input);
          const suffix = document.createElement('span'); suffix.className = 'pshare';
          suffix.textContent = '%';
          row.appendChild(suffix);
        }
        else if (alloc.rule === 'amount') {
          const input = document.createElement('input');
          input.className = 'pinput'; input.type = 'number'; input.step = '0.5'; input.inputMode = 'decimal';
          input.value = alloc.values[p.id] || 0;
          input.addEventListener('input', () => {
            alloc.values[p.id] = +input.value || 0;
            persist(); renderRunningTotals();
            updateAllocStatus();
          });
          row.appendChild(input);
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
      } else {
        status.textContent = '';
        status.classList.remove('warn', 'ok');
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

    // Tax rows
    const tx = calc.taxByPerson;
    function taxRow(label, perPersonField, totalField) {
      return `<tr class="tax-row">
        <td colspan="3">${label}</td>
        <td class="num">${fmt(calc.taxTotals[totalField])}</td>
        ${people.map((p) => `<td class="num">${fmt(tx[p.id][perPersonField])}</td>`).join('')}
        <td><i style="color:#6b7280">Proportional to pre-tax share</i></td>
      </tr>`;
    }
    html += taxRow('Food CGST @ ' + b.taxes.cgst + '%', 'foodCgst',  'foodCgst');
    html += taxRow('Food SGST @ ' + b.taxes.sgst + '%', 'foodSgst',  'foodSgst');
    html += taxRow('Liquor VAT @ ' + b.taxes.vat + '%', 'liquorVat', 'liquorVat');

    // Grand total row
    html += `<tr class="grand-row">
      <td colspan="3">★ GRAND TOTAL (₹)</td>
      <td class="num">${fmt(calc.grand.total)}</td>
      ${people.map((p) => `<td class="num">${fmt(calc.grand.perPerson[p.id])}</td>`).join('')}
      <td>Total: ₹${fmt(calc.grand.total)}</td>
    </tr>`;

    html += `</tbody></table>`;
    html += `<div class="ftr">Note: Tax shares are proportional to each person's pre-tax section share. Minor rounding in individual shares is normal.</div>`;
    return `<div class="rpt">${html}</div>`;
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
      const t = calc.taxByPerson[p.id];
      if (t.foodCgst > 0)  rows += `<tr><td>Food CGST ${b.taxes.cgst}%</td><td class="num">${fmt(t.foodCgst)}</td><td><i style="color:#6b7280">Proportional</i></td></tr>`;
      if (t.foodSgst > 0)  rows += `<tr><td>Food SGST ${b.taxes.sgst}%</td><td class="num">${fmt(t.foodSgst)}</td><td><i style="color:#6b7280">Proportional</i></td></tr>`;
      if (t.liquorVat > 0) rows += `<tr><td>Liquor VAT ${b.taxes.vat}%</td><td class="num">${fmt(t.liquorVat)}</td><td><i style="color:#6b7280">Proportional</i></td></tr>`;
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
    return html;
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
    return '';
  }

  function renderQuickPay(b, calc, opts) {
    const forExport = !!(opts && opts.forExport);
    const people = b.people;
    let html = `<div class="rpt"><div class="ttl-band">💳 QUICK PAY CARD — ${esc(b.meta.restName || '')}</div>`;
    html += `<div class="sub-band">${b.meta.billNo ? 'No: ' + esc(b.meta.billNo) : ''} ${b.meta.billTable ? '| Table ' + esc(b.meta.billTable) : ''} ${b.meta.billDate ? '| ' + esc(b.meta.billDate) : ''} | Grand Total: ${fmtINR(calc.grand.total)}</div>`;

    html += `<div class="qp">
      <div class="qp-head"><div>Name</div><div>Amount to Pay (₹)</div><div>Rounded</div></div>`;
    people.forEach((p, i) => {
      const amt = calc.grand.perPerson[p.id] || 0;
      const idx = slotIndex(p.color, i);
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
