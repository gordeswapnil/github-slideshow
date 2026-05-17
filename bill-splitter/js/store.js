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
      // tax percentages
      taxes: { cgst: 2.5, sgst: 2.5, vat: 10 },
      // person: { id, name, color, prefs: { isVeg: bool, isDrinker: bool } }
      people: [],
      // map: itemId -> { rule, values }
      // 'equal':    values = { personId: 1 } means person is included
      // 'assigned': values = { personId: 1 } (one entry)
      // 'percent':  values = { personId: % } (sum to 100)
      // 'amount':   values = { personId: ₹ } (sum to item total)
      // 'quantity': values = { personId: qty } (sum to item qty)
      allocations: {},
    };
  }

  /** Default person preferences. */
  function defaultPrefs() {
    return { isVeg: false, isDrinker: true };
  }

  /** Given an item and the people list, return the set of person ids that
      are eligible by dietary preference. Used to seed default allocations. */
  function eligiblePeople(item, people) {
    const tag = item && item.dietary;
    return people.filter((p) => {
      const prefs = p.prefs || defaultPrefs();
      if (tag === 'liquor') return prefs.isDrinker !== false;
      if (tag === 'nonveg') return prefs.isVeg !== true;
      return true; // 'veg' / 'any' / undefined → everyone
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

  global.Store = {
    uid,
    blankBill,
    defaultPrefs,
    eligiblePeople,
    loadBills,
    saveBills,
    loadSettings,
    saveSettings,
    loadCurrent,
    saveCurrent,
    upsertBill,
    deleteBill,
  };
})(window);
