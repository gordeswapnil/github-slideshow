/* ===================================================================
   calculator.js — pure functions for splitting a bill.
   No DOM, no storage. Returned object is consumed by the renderer/exporter.

   PHILOSOPHY
   ----------
   1. Each item produces a per-person share array that sums (cents-exact) to
      its line total. Five rules supported: equal / assigned / percent / amount.
   2. Pre-tax subtotals per person are tallied per section (food / liquor / other).
   3. Each tax line is distributed proportionally to its base section's share.
      e.g. Food CGST is split in proportion to each person's Food pre-tax share;
      Liquor VAT in proportion to Liquor share; Others untaxed by default.
   4. Rounding residue (from 2dp truncation) is added back onto the person
      with the largest base — so the per-person totals reconcile exactly to
      the bill total. This is what the sample PDF means by "minor rounding".
   =================================================================== */
(function (global) {
  'use strict';

  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

  /** Compute total for an item: prefer explicit amount if rate*qty differs. */
  function itemTotal(item) {
    if (typeof item.amount === 'number' && !Number.isNaN(item.amount) && item.amount > 0) {
      return round2(item.amount);
    }
    return round2((item.rate || 0) * (item.qty || 0));
  }

  /**
   * Split a single item across people according to its allocation rule.
   * @returns { [personId]: shareInRupees }   — sums to itemTotal(item)
   */
  function splitItem(item, alloc, people) {
    const total = itemTotal(item);
    const shares = Object.fromEntries(people.map((p) => [p.id, 0]));
    if (total <= 0) return shares;

    const a = alloc || { rule: 'equal', values: {} };
    const rule = a.rule || 'equal';
    const values = a.values || {};

    if (rule === 'equal') {
      const ids = people.map((p) => p.id).filter((id) => values[id]);
      const list = ids.length ? ids : people.map((p) => p.id); // default: everyone
      const each = total / list.length;
      list.forEach((id) => (shares[id] = round2(each)));
      reconcile(shares, list, total);
      return shares;
    }

    if (rule === 'assigned') {
      const id = Object.keys(values).find((k) => values[k]);
      if (id && shares.hasOwnProperty(id)) shares[id] = total;
      return shares;
    }

    if (rule === 'percent') {
      const sumPct = Object.values(values).reduce((s, v) => s + (+v || 0), 0) || 100;
      const ids = [];
      Object.entries(values).forEach(([id, pct]) => {
        if (shares.hasOwnProperty(id) && +pct > 0) {
          shares[id] = round2(total * (+pct / sumPct));
          ids.push(id);
        }
      });
      reconcile(shares, ids, total);
      return shares;
    }

    if (rule === 'amount') {
      Object.entries(values).forEach(([id, amt]) => {
        if (shares.hasOwnProperty(id)) shares[id] = round2(+amt || 0);
      });
      // amount rule trusts the user; no reconciliation. (Validation flags mismatch.)
      return shares;
    }

    return shares;
  }

  /** Push rounding residue onto the largest share so the sum is exact. */
  function reconcile(shares, ids, target) {
    if (!ids.length) return;
    const sum = ids.reduce((s, id) => s + shares[id], 0);
    const diff = round2(target - sum);
    if (Math.abs(diff) < 0.005) return;
    // give residue to the largest payer for the most natural look
    let biggest = ids[0];
    ids.forEach((id) => { if (shares[id] > shares[biggest]) biggest = id; });
    shares[biggest] = round2(shares[biggest] + diff);
  }

  /** Human-readable label for a rule (used in the master table's "Split Rule" column). */
  function ruleLabel(item, alloc, people, shares) {
    if (!alloc) return 'Equal ÷ ' + people.length;
    const rule = alloc.rule;
    if (rule === 'equal') {
      const selected = people.filter((p) => alloc.values && alloc.values[p.id]);
      const n = selected.length || people.length;
      if (n === people.length) return 'Equal ÷ ' + n;
      return 'Equal ÷ ' + n + ' (' + selected.map((p) => p.name).join(', ') + ')';
    }
    if (rule === 'assigned') {
      const id = alloc.values && Object.keys(alloc.values).find((k) => alloc.values[k]);
      const who = people.find((p) => p.id === id);
      return '100% → ' + (who ? who.name : '?');
    }
    if (rule === 'percent') {
      return Object.entries(alloc.values || {})
        .filter(([, v]) => +v > 0)
        .map(([id, v]) => {
          const who = people.find((p) => p.id === id);
          return (who ? who.name : '?') + ': ' + v + '%';
        })
        .join(' + ');
    }
    if (rule === 'amount') {
      return Object.entries(shares || {})
        .filter(([, v]) => v > 0)
        .map(([id, v]) => {
          const who = people.find((p) => p.id === id);
          return (who ? who.name : '?') + ': ₹' + (+v).toFixed(0);
        })
        .join(' | ');
    }
    return '—';
  }

  /**
   * Distribute a tax amount across people proportional to a per-person base.
   * @param tax    target total (₹) to distribute
   * @param base   { personId: baseAmount }
   * @returns      { personId: tax share }
   */
  function distributeTax(tax, base) {
    const ids = Object.keys(base);
    const sum = ids.reduce((s, id) => s + (base[id] || 0), 0);
    const out = Object.fromEntries(ids.map((id) => [id, 0]));
    if (sum <= 0 || tax <= 0) return out;
    ids.forEach((id) => { out[id] = round2(tax * (base[id] / sum)); });
    // reconcile to exact tax total
    const inSum = ids.reduce((s, id) => s + out[id], 0);
    const diff  = round2(tax - inSum);
    if (Math.abs(diff) >= 0.005) {
      let biggest = ids[0];
      ids.forEach((id) => { if (base[id] > base[biggest]) biggest = id; });
      out[biggest] = round2(out[biggest] + diff);
    }
    return out;
  }

  /**
   * Master compute function.
   * @returns {
   *   people, items, taxes,
   *   itemShares: { [itemId]: { [personId]: amount } },
   *   itemRules:  { [itemId]: ruleLabelString },
   *   itemTotals: { [itemId]: number },
   *   preTaxBySection: { food, liquor, other, total } by person,
   *   taxByPerson: { foodCgst, foodSgst, liquorVat } by person,
   *   taxTotals:   { food, liquorVat, foodCgst, foodSgst, foodTotal, liquorTotal, otherTotal },
   *   grand: { perPerson: {pid: total}, total }
   * }
   */
  function compute(bill) {
    const people = bill.people || [];
    const items  = bill.items  || [];
    const taxes  = bill.taxes  || { cgst: 0, sgst: 0, vat: 0 };

    const itemShares = {};
    const itemRules  = {};
    const itemTotals = {};

    // Pre-tax subtotals by person, segmented by section
    const baseFood   = Object.fromEntries(people.map((p) => [p.id, 0]));
    const baseLiquor = Object.fromEntries(people.map((p) => [p.id, 0]));
    const baseOther  = Object.fromEntries(people.map((p) => [p.id, 0]));

    items.forEach((it) => {
      const alloc  = bill.allocations[it.id];
      const shares = splitItem(it, alloc, people);
      itemShares[it.id] = shares;
      itemTotals[it.id] = itemTotal(it);
      itemRules[it.id]  = ruleLabel(it, alloc, people, shares);
      const bucket = it.section === 'liquor' ? baseLiquor : it.section === 'other' ? baseOther : baseFood;
      people.forEach((p) => { bucket[p.id] = round2(bucket[p.id] + shares[p.id]); });
    });

    const foodSubtotal   = sum(baseFood);
    const liquorSubtotal = sum(baseLiquor);
    const otherSubtotal  = sum(baseOther);

    const foodCgstTotal = round2(foodSubtotal * (taxes.cgst || 0) / 100);
    const foodSgstTotal = round2(foodSubtotal * (taxes.sgst || 0) / 100);
    const liquorVatTotal = round2(liquorSubtotal * (taxes.vat  || 0) / 100);

    const foodCgst = distributeTax(foodCgstTotal,  baseFood);
    const foodSgst = distributeTax(foodSgstTotal,  baseFood);
    const liquorVat = distributeTax(liquorVatTotal, baseLiquor);

    const taxByPerson = Object.fromEntries(people.map((p) => [p.id, {
      foodCgst: foodCgst[p.id]  || 0,
      foodSgst: foodSgst[p.id]  || 0,
      liquorVat: liquorVat[p.id] || 0,
    }]));

    const grandPer = {};
    people.forEach((p) => {
      const g = round2(
        baseFood[p.id] + baseLiquor[p.id] + baseOther[p.id] +
        foodCgst[p.id] + foodSgst[p.id]   + liquorVat[p.id]
      );
      grandPer[p.id] = g;
    });
    const grandTotal = round2(sum(grandPer));

    return {
      people, items, taxes,
      itemShares, itemRules, itemTotals,
      preTaxBySection: {
        food: baseFood, liquor: baseLiquor, other: baseOther,
        totals: { food: foodSubtotal, liquor: liquorSubtotal, other: otherSubtotal },
      },
      taxByPerson,
      taxTotals: { foodCgst: foodCgstTotal, foodSgst: foodSgstTotal, liquorVat: liquorVatTotal },
      grand: { perPerson: grandPer, total: grandTotal },
    };
  }

  function sum(map) {
    return Object.values(map).reduce((s, v) => s + v, 0);
  }

  /** Validation — returns array of human-readable warnings. */
  function validate(bill) {
    const out = [];
    if (!bill.people || bill.people.length === 0) out.push('Add at least one person.');
    if (!bill.items  || bill.items.length  === 0) out.push('Add at least one item.');
    (bill.items || []).forEach((it) => {
      const t = itemTotal(it);
      if (t <= 0) out.push('Item "' + (it.name || 'untitled') + '" has zero amount.');
      const a = bill.allocations[it.id];
      if (a && a.rule === 'amount') {
        const s = round2(Object.values(a.values || {}).reduce((s, v) => s + (+v || 0), 0));
        if (Math.abs(s - t) >= 0.5) {
          out.push('"' + (it.name || 'item') + '": custom amounts sum to ₹' + s.toFixed(2) +
                   ' but item total is ₹' + t.toFixed(2) + '.');
        }
      }
      if (a && a.rule === 'percent') {
        const s = Object.values(a.values || {}).reduce((s, v) => s + (+v || 0), 0);
        if (s > 0 && Math.abs(s - 100) >= 0.5) {
          out.push('"' + (it.name || 'item') + '": percentages sum to ' + s + '% (need 100%).');
        }
      }
      if (a && a.rule === 'assigned') {
        const n = Object.values(a.values || {}).filter(Boolean).length;
        if (n === 0) out.push('"' + (it.name || 'item') + '": no person assigned.');
      }
    });
    return out;
  }

  global.Calc = { round2, itemTotal, compute, validate, splitItem, ruleLabel };
})(window);
