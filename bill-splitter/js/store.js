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

  global.Store = {
    uid,
    blankBill,
    defaultPrefs,
    normalisePrefs,
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
