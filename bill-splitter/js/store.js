/* ===================================================================
   store.js — localStorage persistence + in-memory state
   Schema:
     bills: [{ id, meta, items, taxes, people, allocations, createdAt }]
     settings: { apiKey?: string }
   =================================================================== */
(function (global) {
  'use strict';

  const KEY_BILLS    = 'bsp.bills.v1';
  const KEY_SETTINGS = 'bsp.settings.v1';
  const KEY_CURRENT  = 'bsp.current.v1';
  const KEY_USAGE    = 'bsp.usage.v1';     // [{ ts, costInr, costUsd, inTok, outTok }]

  const uid = () =>
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  function blankBill() {
    return {
      id: uid(),
      createdAt: Date.now(),
      meta: {
        restName: '',
        restSub: '',
        billNo: '',
        billDate: '',
        billTable: '',
        billHall: '',
      },
      // section: 'food' | 'liquor' | 'other'
      // dietary (food items): 'any' | 'veg' | 'nonveg'
      // dietary (liquor items): always 'liquor'
      items: [],
      // Taxes are an arbitrary list — empty for a new bill, populated either
      // by OCR from a scanned bill or manually by the user.
      // Each tax: { id, name, rate, base }
      //   base: 'food'   → distributed proportionally to each person's food share
      //         'liquor' → liquor share
      //         'other'  → other share
      //         'all'    → total pre-tax share (e.g. service charge on full bill)
      taxes: [],
      // person: { id, name, color, prefs: { diet, isDrinker } }
      people: [],
      // Bill-level payer (single person who paid the whole bill at the
      // counter). If null, the bill is treated as Dutch at the counter.
      // Per-item `paidBy` can override this for specific items (e.g. an
      // ice-cream someone bought separately after the meal).
      paidBy: null,
      // map: itemId -> { rule, values }
      allocations: {},
    };
  }

  /** Migrate a legacy {cgst, sgst, vat} taxes object to the new array form. */
  function normaliseTaxes(taxes) {
    if (Array.isArray(taxes)) return taxes;
    if (!taxes || typeof taxes !== 'object') return [];
    const out = [];
    if (+taxes.cgst > 0) out.push({ id: 'cgst', name: 'CGST', rate: +taxes.cgst, base: 'food'   });
    if (+taxes.sgst > 0) out.push({ id: 'sgst', name: 'SGST', rate: +taxes.sgst, base: 'food'   });
    if (+taxes.vat  > 0) out.push({ id: 'vat',  name: 'VAT',  rate: +taxes.vat,  base: 'liquor' });
    return out;
  }

  /** Default person preferences.
   *  diet: 'both' (default — eats anything) | 'veg' (pure veg) | 'nonveg' (only non-veg)
   */
  function defaultPrefs() {
    return { diet: 'both', isDrinker: true };
  }

  /** Migrate legacy { isVeg: bool } to the new { diet } enum, in place. */
  function normalisePrefs(prefs) {
    if (!prefs) return defaultPrefs();
    if (prefs.diet) return prefs;
    // Old format: isVeg true → 'veg'; isVeg false → 'both' (eats anything)
    return {
      diet:      prefs.isVeg ? 'veg' : 'both',
      isDrinker: prefs.isDrinker !== false,
    };
  }

  /** Given an item and the people list, return the set of person ids that
      are eligible by dietary preference. Used to seed default allocations. */
  function eligiblePeople(item, people) {
    const tag = item && item.dietary;
    return people.filter((p) => {
      const prefs = normalisePrefs(p.prefs);
      if (tag === 'liquor') return prefs.isDrinker !== false;
      // Pure-veg people are excluded from non-veg items
      if (tag === 'nonveg') return prefs.diet !== 'veg';
      // Pure non-veg people (rare) are excluded from veg-only items
      if (tag === 'veg')    return prefs.diet !== 'nonveg';
      return true; // 'any' / undefined → everyone
    });
  }

  function loadBills() {
    try { return JSON.parse(localStorage.getItem(KEY_BILLS) || '[]'); }
    catch { return []; }
  }
  function saveBills(arr) {
    localStorage.setItem(KEY_BILLS, JSON.stringify(arr));
  }
  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(KEY_SETTINGS) || '{}'); }
    catch { return {}; }
  }
  function saveSettings(s) {
    localStorage.setItem(KEY_SETTINGS, JSON.stringify(s));
  }
  function loadCurrent() {
    try { return JSON.parse(localStorage.getItem(KEY_CURRENT) || 'null'); }
    catch { return null; }
  }
  function saveCurrent(bill) {
    if (!bill) localStorage.removeItem(KEY_CURRENT);
    else localStorage.setItem(KEY_CURRENT, JSON.stringify(bill));
  }

  function upsertBill(bill) {
    const all = loadBills();
    const idx = all.findIndex((b) => b.id === bill.id);
    if (idx >= 0) all[idx] = bill;
    else all.unshift(bill);
    saveBills(all);
  }
  function deleteBill(id) {
    saveBills(loadBills().filter((b) => b.id !== id));
  }

  // ---------- API-usage tracking (cost meter + monthly cap) ----------

  function loadUsage() {
    try { return JSON.parse(localStorage.getItem(KEY_USAGE) || '[]'); }
    catch { return []; }
  }
  function saveUsage(arr) {
    // Keep at most last 1000 events — bounds storage if user scans daily forever
    if (arr.length > 1000) arr = arr.slice(-1000);
    localStorage.setItem(KEY_USAGE, JSON.stringify(arr));
  }
  function recordUsage(usage) {
    if (!usage || !usage.costInr) return;
    const all = loadUsage();
    all.push({
      ts:    Date.now(),
      costInr: +usage.costInr.toFixed(4),
      costUsd: +usage.costUsd.toFixed(6),
      inTok:  usage.inputTokens,
      outTok: usage.outputTokens,
    });
    saveUsage(all);
  }
  /** Total INR spent in the current calendar month (local time). */
  function monthSpend() {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    return loadUsage().reduce((s, e) => {
      const d = new Date(e.ts);
      return (d.getFullYear() === y && d.getMonth() === m) ? s + (e.costInr || 0) : s;
    }, 0);
  }
  function clearUsage() {
    localStorage.removeItem(KEY_USAGE);
  }

  global.Store = {
    uid,
    blankBill,
    defaultPrefs,
    normalisePrefs,
    normaliseTaxes,
    eligiblePeople,
    loadBills,
    saveBills,
    loadSettings,
    saveSettings,
    loadCurrent,
    saveCurrent,
    upsertBill,
    deleteBill,
    loadUsage,
    recordUsage,
    monthSpend,
    clearUsage,
  };
})(window);
