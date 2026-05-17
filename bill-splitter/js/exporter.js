/* ===================================================================
   exporter.js — render the result to a stand-alone HTML payload, then
   convert to PDF (via html2pdf) or PNG (via html2canvas) on demand.

   The exported HTML is fully self-contained (inline CSS) so it opens
   correctly in any browser and looks identical to the sample.
   =================================================================== */
(function (global) {
  'use strict';

  /** Returns CSS used by the exported standalone HTML. */
  function exportCss() {
    return `
      *{ box-sizing:border-box; }
      body{ margin:0; padding:24px; font:14px/1.45 -apple-system,Segoe UI,Roboto,sans-serif; color:#1f2937; background:#fff; }
      .rpt{ max-width:820px; margin:0 auto; border:1px solid #e5e7eb; border-radius:8px; overflow:hidden; }
      .rpt table{ width:100%; border-collapse:collapse; }
      .rpt th,.rpt td{ padding:8px 10px; border-bottom:1px solid #e5e7eb; text-align:left; vertical-align:top; }
      .rpt th{ background:#f1f5f9; font-weight:600; font-size:12px; color:#334155; }
      .rpt td.num,.rpt th.num{ text-align:right; font-variant-numeric:tabular-nums; }
      .rpt .ttl-band{ background:#d84315; color:#fff; padding:12px 14px; font-weight:700; font-size:16px; text-align:center; }
      .rpt .sub-band{ padding:8px 14px; font-size:12px; color:#475569; background:#fafafa; text-align:center; font-style:italic; }
      .rpt .grp{ background:#fef3ed; padding:7px 10px; font-weight:700; font-size:12px; color:#9a3412; }
      .rpt .grp.liquor{ background:#fef2f2; color:#991b1b; }
      .rpt .grp.other{ background:#eff6ff; color:#1d4ed8; }
      .rpt .tax-row td{ background:#fffbeb; color:#92400e; font-style:italic; }
      .rpt .grand-row td{ background:#b91c1c; color:#fff; font-weight:800; font-size:14px; padding:12px 10px; }
      .rpt .person-band{ padding:11px 14px; font-weight:800; color:#fff; }
      .rpt .person-total td{ font-weight:800; background:#f8fafc; }
      .rpt .ftr{ padding:9px 14px; font-size:11px; color:#6b7280; font-style:italic; text-align:center; }
      .rpt + .rpt{ margin-top:18px; }
      .qp .qp-row{ display:grid; grid-template-columns:1fr 130px 100px; padding:11px 14px; align-items:center; border-bottom:1px solid #e5e7eb; }
      .qp .qp-row .qp-name{ font-weight:700; }
      .qp .qp-row .qp-amt,.qp .qp-row .qp-round{ font-variant-numeric:tabular-nums; text-align:right; }
      .qp .qp-row.qp-total{ background:#b91c1c; color:#fff; border:0; font-weight:800; }
      .qp .qp-head{ background:#f1f5f9; font-size:12px; color:#334155; font-weight:700; padding:8px 14px; display:grid; grid-template-columns:1fr 130px 100px; }
      .qp .qp-head>div:not(:first-child){ text-align:right; }
      @page{ size:A4; margin:14mm; }
    `;
  }

  /** Build the standalone HTML string for the full report (all 3 views). */
  function buildStandaloneHtml(bill, calc, renderFns) {
    const masterHtml   = renderFns.renderMaster(bill, calc, { forExport: true });
    const personHtml   = renderFns.renderPerPerson(bill, calc, { forExport: true });
    const quickHtml    = renderFns.renderQuickPay(bill, calc, { forExport: true });

    return `<!doctype html><html><head><meta charset="utf-8" />
<title>${escapeHtml(bill.meta.restName || 'Bill Split')} — Split</title>
<style>${exportCss()}</style></head>
<body>
  ${masterHtml}
  ${personHtml}
  ${quickHtml}
</body></html>`;
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 200);
  }

  function fileBaseName(bill) {
    const name = (bill.meta.restName || 'bill').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const no   = (bill.meta.billNo || bill.id || '').toString().slice(-8);
    return [name, 'split', no].filter(Boolean).join('-');
  }

  /** Export as standalone HTML file. */
  function exportHtml(bill, calc, renderFns) {
    const html = buildStandaloneHtml(bill, calc, renderFns);
    downloadBlob(new Blob([html], { type: 'text/html' }), fileBaseName(bill) + '.html');
    return html;
  }

  /** Export as PDF (via html2pdf — present on page). */
  async function exportPdf(bill, calc, renderFns) {
    if (!global.html2pdf) throw new Error('PDF library not loaded yet — try again in a moment.');
    const html = buildStandaloneHtml(bill, calc, renderFns);
    const holder = document.createElement('div');
    holder.style.position = 'fixed'; holder.style.left = '-99999px'; holder.style.top = '0';
    holder.style.width = '820px'; holder.style.background = '#fff';
    holder.innerHTML = html;
    document.body.appendChild(holder);
    try {
      await global.html2pdf().set({
        margin:      [10, 10, 10, 10],
        filename:    fileBaseName(bill) + '.pdf',
        image:       { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2, backgroundColor: '#ffffff', useCORS: true },
        jsPDF:       { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak:   { mode: ['avoid-all', 'css', 'legacy'] },
      }).from(holder).save();
    } finally {
      holder.remove();
    }
  }

  /** Export as PNG image (single tall image). html2canvas ships inside html2pdf bundle. */
  async function exportPng(bill, calc, renderFns) {
    let h2c = global.html2canvas;
    if (!h2c) {
      // Fallback: dynamic import from CDN
      const mod = await import('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/+esm');
      h2c = mod.default || mod;
    }
    if (!h2c) throw new Error('Image library not loaded yet — try again in a moment.');
    const html = buildStandaloneHtml(bill, calc, renderFns);
    const holder = document.createElement('div');
    holder.style.position = 'fixed'; holder.style.left = '-99999px'; holder.style.top = '0';
    holder.style.width = '820px'; holder.style.background = '#fff';
    holder.innerHTML = html;
    document.body.appendChild(holder);
    try {
      const canvas = await h2c(holder, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
      await new Promise((resolve) => canvas.toBlob((blob) => {
        downloadBlob(blob, fileBaseName(bill) + '.png');
        resolve();
      }, 'image/png'));
    } finally {
      holder.remove();
    }
  }

  /** Web Share — falls back to copying a summary if share API absent. */
  async function shareSummary(bill, calc) {
    const lines = [];
    lines.push((bill.meta.restName || 'Bill Split'));
    if (bill.meta.billNo) lines.push('Bill: ' + bill.meta.billNo);
    if (bill.meta.billDate) lines.push('Date: ' + bill.meta.billDate);
    lines.push('');
    bill.people.forEach((p) => {
      const amt = (calc.grand.perPerson[p.id] || 0).toFixed(2);
      lines.push(p.name + ': ₹' + amt + '  (≈ ₹' + Math.round(calc.grand.perPerson[p.id] || 0) + ')');
    });
    lines.push('—');
    lines.push('Total: ₹' + calc.grand.total.toFixed(2));
    const text = lines.join('\n');
    if (navigator.share) {
      try { await navigator.share({ title: 'Bill Split', text }); return 'shared'; }
      catch (_) { /* user cancelled */ return 'cancelled'; }
    }
    await navigator.clipboard.writeText(text);
    return 'copied';
  }

  global.Exporter = { exportHtml, exportPdf, exportPng, shareSummary, buildStandaloneHtml };
})(window);
