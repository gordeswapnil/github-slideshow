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

    if (rule === 'quantity') {
      // values = { personId: qty }. Per-person amount = (qty / totalQty) * total.
      // If user entered no qty at all, fall back to equal split for safety.
      const totalQty = +item.qty || 0;
      const sumQty = Object.values(values).reduce((s, v) => s + (+v || 0), 0);
      const base = totalQty > 0 ? totalQty : sumQty;
      if (base <= 0) {
        const each = total / people.length;
        people.forEach((p) => (shares[p.id] = round2(each)));
        reconcile(shares, people.map((p) => p.id), total);
        return shares;
      }
      const ids = [];
      Object.entries(values).forEach(([id, qty]) => {
        if (shares.hasOwnProperty(id) && +qty > 0) {
          shares[id] = round2(total * (+qty / base));
          ids.push(id);
        }
      });
      reconcile(shares, ids, total);
      return shares;
    }

    if (rule === 'mixed') {
      // Hybrid of amount + quantity:
      //   values  = { personId: qty }      (qty share per person)
      //   amounts = { personId: ₹fixed }   (fixed amount per person)
      // Fixed amounts are paid first; the remainder of the line total is
      // distributed in proportion to qty values.
      const amounts = a.amounts || {};
      const fixedSum = Object.values(amounts).reduce((s, v) => s + (+v || 0), 0);
      const remainder = round2(total - fixedSum);
      // First: assign fixed amounts
      Object.entries(amounts).forEach(([id, amt]) => {
        if (shares.hasOwnProperty(id)) shares[id] = round2(+amt || 0);
      });
      // Then: split the remainder by qty (if any qty entered and remainder positive)
      const qtySum = Object.values(values).reduce((s, v) => s + (+v || 0), 0);
      if (qtySum > 0 && remainder > 0.005) {
        const ids = [];
        Object.entries(values).forEach(([id, qty]) => {
          if (shares.hasOwnProperty(id) && +qty > 0) {
            shares[id] = round2(shares[id] + remainder * (+qty / qtySum));
            ids.push(id);
          }
        });
        // Reconcile remainder rounding only across the qty-bearing payers
        const distributedSum = ids.reduce((s, id) => s + (shares[id] - (+amounts[id] || 0)), 0);
        const diff = round2(remainder - distributedSum);
        if (Math.abs(diff) >= 0.005 && ids.length) {
          let biggest = ids[0];
          ids.forEach((id) => { if ((+values[id] || 0) > (+values[biggest] || 0)) biggest = id; });
          shares[biggest] = round2(shares[biggest] + diff);
        }
      }
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
    if (rule === 'quantity') {
      return Object.entries(alloc.values || {})
        .filter(([, v]) => +v > 0)
        .map(([id, v]) => {
          const who = people.find((p) => p.id === id);
          return (who ? who.name : '?') + ': ' + v;
        })
        .join(' + ') + ' qty';
    }
    if (rule === 'mixed') {
      const parts = [];
      const amounts = alloc.amounts || {};
      people.forEach((p) => {
        const q = +(alloc.values || {})[p.id] || 0;
        const a = +amounts[p.id] || 0;
        if (q > 0 || a > 0) {
          const bits = [];
          if (a > 0) bits.push('₹' + a.toFixed(0));
          if (q > 0) bits.push('qty ' + q);
          parts.push(p.name + ': ' + bits.join('+'));
        }
      });
      return parts.join(' | ') || '—';
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
    // Taxes are always an array now; tolerate legacy object form by leaning on
    // Store.normaliseTaxes when it's available.
    const taxes  = Array.isArray(bill.taxes) ? bill.taxes
                  : (window.Store && window.Store.normaliseTaxes) ? window.Store.normaliseTaxes(bill.taxes)
                  : [];

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
    const baseAll        = Object.fromEntries(people.map((p) => [p.id,
      round2((baseFood[p.id] || 0) + (baseLiquor[p.id] || 0) + (baseOther[p.id] || 0))
    ]));

    // -----------------------------------------------------------
    // Generic tax distribution: each tax line is applied to its own
    // base (food / liquor / other / all), proportional to each person's
    // share of that base.
    // -----------------------------------------------------------
    function baseFor(t) {
      switch (t && t.base) {
        case 'food':   return baseFood;
        case 'liquor': return baseLiquor;
        case 'other':  return baseOther;
        case 'all':    return baseAll;
        default:       return baseFood;
      }
    }
    function baseSubtotalFor(t) {
      switch (t && t.base) {
        case 'food':   return foodSubtotal;
        case 'liquor': return liquorSubtotal;
        case 'other':  return otherSubtotal;
        case 'all':    return foodSubtotal + liquorSubtotal + otherSubtotal;
        default:       return foodSubtotal;
      }
    }

    // taxByPerson[personId][taxId]  = share of that tax for that person
    // taxTotals[taxId]              = total of that tax
    const taxByPerson = Object.fromEntries(people.map((p) => [p.id, {}]));
    const taxTotals   = {};
    taxes.forEach((t) => {
      const subtotal = baseSubtotalFor(t);
      const total    = round2(subtotal * (+t.rate || 0) / 100);
      taxTotals[t.id] = total;
      const distributed = distributeTax(total, baseFor(t));
      people.forEach((p) => { taxByPerson[p.id][t.id] = distributed[p.id] || 0; });
    });

    const grandPer = {};
    people.forEach((p) => {
      let g = (baseFood[p.id] || 0) + (baseLiquor[p.id] || 0) + (baseOther[p.id] || 0);
      taxes.forEach((t) => { g += taxByPerson[p.id][t.id] || 0; });
      grandPer[p.id] = round2(g);
    });
    const grandTotal = round2(sum(grandPer));

    // -----------------------------------------------------------
    // Paid-by / Settlement.
    //
    // Items with an explicit `paidBy` create a reimbursement loop:
    //   - the payer fronted the full (item + applicable tax)
    //   - every consumer (including the payer) owes their tax-inclusive
    //     share to that payer
    //
    // Items WITHOUT `paidBy` are assumed split at the counter — each
    // person pays their share directly to the merchant; no reimbursement
    // is generated for them.
    //
    // settlementConsumedPerPerson  = consumer's share, but only for
    //                                items that have a payer (gross of tax)
    // paidByPerson                 = total fronted by each payer (gross of tax)
    // net = settlementConsumedPerPerson − paidByPerson
    //   net > 0  → owes that much to the group of payers
    //   net < 0  → group owes them that much (they fronted more than they ate)
    // -----------------------------------------------------------
    // Sum of all tax rates that apply to a given section, used to grow each
    // item's "what the payer actually fronted" amount.
    function rateSumFor(section) {
      let r = 0;
      taxes.forEach((t) => {
        if (t.base === section || t.base === 'all') r += +t.rate || 0;
      });
      return r / 100;
    }
    const taxFactorFor = (section) => 1 + rateSumFor(section);
    const paidByPerson              = Object.fromEntries(people.map((p) => [p.id, 0]));
    const settlementConsumedPerPerson = Object.fromEntries(people.map((p) => [p.id, 0]));
    items.forEach((it) => {
      if (!it.paidBy) return;
      const tf      = taxFactorFor(it.section);
      const gross   = itemTotal(it) * tf;
      if (paidByPerson.hasOwnProperty(it.paidBy)) {
        paidByPerson[it.paidBy] = round2(paidByPerson[it.paidBy] + gross);
      }
      const shares = itemShares[it.id] || {};
      people.forEach((p) => {
        settlementConsumedPerPerson[p.id] = round2(
          settlementConsumedPerPerson[p.id] + (shares[p.id] || 0) * tf
        );
      });
    });
    const netPerPerson = Object.fromEntries(people.map((p) => [
      p.id,
      round2((settlementConsumedPerPerson[p.id] || 0) - (paidByPerson[p.id] || 0)),
    ]));
    const settlement = computeSettlement(people, netPerPerson);

    return {
      people, items, taxes,
      itemShares, itemRules, itemTotals,
      preTaxBySection: {
        food: baseFood, liquor: baseLiquor, other: baseOther,
        totals: { food: foodSubtotal, liquor: liquorSubtotal, other: otherSubtotal },
      },
      taxByPerson,
      taxTotals,
      grand: { perPerson: grandPer, total: grandTotal },
      paidByPerson,
      settlementConsumedPerPerson,
      netPerPerson,
      settlement,
    };
  }

  function sum(map) {
    return Object.values(map).reduce((s, v) => s + v, 0);
  }

  /**
   * Greedy settlement: given each person's net (positive = owes, negative =
   * is owed), produce a list of pairwise transfers that zero everyone out.
   * Algorithm: repeatedly pair the largest debtor with the largest creditor
   * and transfer min(|debt|, |credit|). Produces at most N-1 transfers for
   * N people — the minimum possible without splitting cents oddly.
   */
  function computeSettlement(people, netPerPerson) {
    const epsilon = 0.5;
    // Build mutable lists of debtors (>0) and creditors (<0)
    const debtors   = [];
    const creditors = [];
    people.forEach((p) => {
      const n = netPerPerson[p.id] || 0;
      if (n >  epsilon) debtors.push({ id: p.id, name: p.name, amount: n });
      if (n < -epsilon) creditors.push({ id: p.id, name: p.name, amount: -n });
    });
    debtors.sort((a, b)   => b.amount - a.amount);
    creditors.sort((a, b) => b.amount - a.amount);

    const transfers = [];
    let i = 0, j = 0;
    while (i < debtors.length && j < creditors.length) {
      const pay = Math.min(debtors[i].amount, creditors[j].amount);
      transfers.push({
        fromId: debtors[i].id,   from: debtors[i].name,
        toId:   creditors[j].id, to:   creditors[j].name,
        amount: round2(pay),
      });
      debtors[i].amount   = round2(debtors[i].amount   - pay);
      creditors[j].amount = round2(creditors[j].amount - pay);
      if (debtors[i].amount   < epsilon) i++;
      if (creditors[j].amount < epsilon) j++;
    }
    return transfers;
  }

  /** Validation — returns array of human-readable warnings. */
  function validate(bill) {
    const out = [];
    // Surface OCR-side warnings as informational items so the user sees them
    // again on the Result screen even if they dismissed the banner.
    if (Array.isArray(bill._scanWarnings)) {
      bill._scanWarnings.forEach((w) => out.push('Scan: ' + w));
    }
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
      if (a && a.rule === 'quantity') {
        const totalQty = +it.qty || 0;
        const s = Object.values(a.values || {}).reduce((s, v) => s + (+v || 0), 0);
        if (totalQty > 0 && Math.abs(s - totalQty) >= 0.001) {
          out.push('"' + (it.name || 'item') + '": quantities sum to ' + s + ' but item qty is ' + totalQty + '.');
        }
        if (totalQty <= 0 && s <= 0) {
          out.push('"' + (it.name || 'item') + '": no quantities entered.');
        }
      }
      if (a && a.rule === 'mixed') {
        const fixedSum = Object.values(a.amounts || {}).reduce((s, v) => s + (+v || 0), 0);
        const qtySum   = Object.values(a.values  || {}).reduce((s, v) => s + (+v || 0), 0);
        if (fixedSum > t + 0.5) {
          out.push('"' + (it.name || 'item') + '": fixed amounts (₹' + fixedSum.toFixed(2) +
                   ') exceed item total ₹' + t.toFixed(2) + '.');
        }
        if (fixedSum < t - 0.5 && qtySum <= 0) {
          out.push('"' + (it.name || 'item') + '": ₹' + round2(t - fixedSum).toFixed(2) +
                   ' is unallocated — set a qty for the sharers or raise the fixed amounts.');
        }
        if (fixedSum === 0 && qtySum === 0) {
          out.push('"' + (it.name || 'item') + '": no qty or amount entered.');
        }
      }
    });
    return out;
  }

  global.Calc = { round2, itemTotal, compute, validate, splitItem, ruleLabel };
})(window);
