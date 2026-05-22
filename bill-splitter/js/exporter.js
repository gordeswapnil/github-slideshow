/* ===================================================================
   exporter.js — render the result to a stand-alone HTML payload, then
   convert to PDF (via html2pdf) or PNG (via html2canvas) on demand.

   In the Android APK we route the final blob through the native bridge:
     - "save" → window.HisaabNative.saveToDownloads → public Downloads folder
     - "share" → window.HisaabNative.shareFile → Android share sheet
   In a plain browser / PWA we fall back to a normal <a download> click.

   The exported HTML is fully self-contained (inline CSS) so it opens
   correctly in any browser and looks identical to the sample.
   =================================================================== */
(function (global) {
  'use strict';

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

  function buildStandaloneHtml(bill, calc, renderFns) {
    const masterHtml = renderFns.renderMaster(bill, calc, { forExport: true });
    const personHtml = renderFns.renderPerPerson(bill, calc, { forExport: true });
    const quickHtml  = renderFns.renderQuickPay(bill, calc, { forExport: true });
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

  function fileBaseName(bill) {
    const name = (bill.meta.restName || 'bill').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const no   = (bill.meta.billNo || bill.id || '').toString().slice(-8);
    return [name, 'split', no].filter(Boolean).join('-');
  }

  function hasBridge() {
    return typeof window !== 'undefined'
      && window.HisaabNative
      && typeof window.HisaabNative.saveToDownloads === 'function';
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        const url = r.result || '';
        const comma = url.indexOf(',');
        resolve(comma >= 0 ? url.slice(comma + 1) : '');
      };
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  /** Setup the JS side of the bridge promise resolver if not yet set. */
  function ensureBridge() {
    if (window.HisaabBridge) return;
    window.HisaabBridge = {
      _pending: Object.create(null),
      _resolve(id, resultJson) {
        const cb = this._pending[id];
        if (!cb) return;
        delete this._pending[id];
        try { cb(JSON.parse(resultJson)); }
        catch (e) { cb({ ok: false, error: 'Bridge malformed JSON' }); }
      },
    };
  }

  /** Save a blob via the native bridge (Downloads folder) or, in a browser,
   *  fall back to the standard <a download> click. */
  async function saveBlob(blob, filename, mimeType) {
    if (hasBridge()) {
      ensureBridge();
      const base64 = await blobToBase64(blob);
      return new Promise((resolve, reject) => {
        const id = 'sv_' + Math.random().toString(36).slice(2);
        window.HisaabBridge._pending[id] = (r) => {
          if (r.ok) resolve(r);
          else reject(new Error(r.error || 'Save failed'));
        };
        try { window.HisaabNative.saveToDownloads(filename, mimeType, base64, id); }
        catch (e) { reject(new Error('Bridge call failed: ' + (e.message || e))); }
      });
    }
    // Browser fallback
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 200);
    return { ok: true, path: filename };
  }

  /** Open Android's share sheet for the given blob. In a browser falls
   *  back to Web Share API when available, else a normal download. */
  async function shareBlob(blob, filename, mimeType) {
    if (hasBridge() && typeof window.HisaabNative.shareFile === 'function') {
      const base64 = await blobToBase64(blob);
      window.HisaabNative.shareFile(filename, mimeType, base64);
      return { ok: true };
    }
    // Browser: try Web Share with files
    if (navigator.canShare && navigator.share) {
      try {
        const file = new File([blob], filename, { type: mimeType });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: filename });
          return { ok: true };
        }
      } catch (_) { /* user cancelled */ }
    }
    // Last resort: download
    return saveBlob(blob, filename, mimeType);
  }

  // ===================================================================
  //                     File-builder helpers
  // ===================================================================

  function buildHtmlBlob(bill, calc, renderFns) {
    const html = buildStandaloneHtml(bill, calc, renderFns);
    return new Blob([html], { type: 'text/html' });
  }

  /** Render the full report into a hidden div, return the holder. Caller
   *  must remove() it after html2canvas / html2pdf finishes. */
  function makeHolder(bill, calc, renderFns) {
    const html = buildStandaloneHtml(bill, calc, renderFns);
    const holder = document.createElement('div');
    holder.style.position = 'fixed';
    holder.style.left = '-99999px';
    holder.style.top = '0';
    holder.style.width = '820px';
    holder.style.background = '#fff';
    holder.innerHTML = html;
    document.body.appendChild(holder);
    return holder;
  }

  async function buildPdfBlob(bill, calc, renderFns) {
    if (!global.html2pdf) throw new Error('PDF library not loaded — check your internet connection.');
    const holder = makeHolder(bill, calc, renderFns);
    try {
      const worker = global.html2pdf().set({
        margin:      [10, 10, 10, 10],
        image:       { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2, backgroundColor: '#ffffff', useCORS: true },
        jsPDF:       { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak:   { mode: ['avoid-all', 'css', 'legacy'] },
      }).from(holder);
      return await worker.outputPdf('blob');
    } finally {
      holder.remove();
    }
  }

  async function buildPngBlob(bill, calc, renderFns) {
    let h2c = global.html2canvas;
    if (!h2c) {
      try {
        const mod = await import('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/+esm');
        h2c = mod.default || mod;
      } catch (_) {}
    }
    if (!h2c) throw new Error('Image library not loaded — check your internet connection.');
    const holder = makeHolder(bill, calc, renderFns);
    try {
      const canvas = await h2c(holder, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
      return await new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
    } finally {
      holder.remove();
    }
  }

  // ===================================================================
  //                  Public actions: save / share
  // ===================================================================

  async function exportHtml(bill, calc, renderFns) {
    const blob = buildHtmlBlob(bill, calc, renderFns);
    return saveBlob(blob, fileBaseName(bill) + '.html', 'text/html');
  }

  async function exportPdf(bill, calc, renderFns) {
    const blob = await buildPdfBlob(bill, calc, renderFns);
    return saveBlob(blob, fileBaseName(bill) + '.pdf', 'application/pdf');
  }

  async function exportPng(bill, calc, renderFns) {
    const blob = await buildPngBlob(bill, calc, renderFns);
    return saveBlob(blob, fileBaseName(bill) + '.png', 'image/png');
  }

  async function shareHtml(bill, calc, renderFns) {
    const blob = buildHtmlBlob(bill, calc, renderFns);
    return shareBlob(blob, fileBaseName(bill) + '.html', 'text/html');
  }
  async function sharePdf(bill, calc, renderFns) {
    const blob = await buildPdfBlob(bill, calc, renderFns);
    return shareBlob(blob, fileBaseName(bill) + '.pdf', 'application/pdf');
  }
  async function sharePng(bill, calc, renderFns) {
    const blob = await buildPngBlob(bill, calc, renderFns);
    return shareBlob(blob, fileBaseName(bill) + '.png', 'image/png');
  }

  function buildTextSummary(bill, calc) {
    const lines = [];
    lines.push(bill.meta.restName || 'Bill Split');
    if (bill.meta.billNo) lines.push('Bill: ' + bill.meta.billNo);
    if (bill.meta.billDate) lines.push('Date: ' + bill.meta.billDate);
    lines.push('');
    bill.people.forEach((p) => {
      const amt = (calc.grand.perPerson[p.id] || 0).toFixed(2);
      lines.push(p.name + ': ₹' + amt + '  (≈ ₹' + Math.round(calc.grand.perPerson[p.id] || 0) + ')');
    });
    lines.push('—');
    lines.push('Total: ₹' + calc.grand.total.toFixed(2));
    return lines.join('\n');
  }

  /** Quick text-only share via the native bridge (or Web Share / clipboard). */
  async function shareText(bill, calc) {
    const text = buildTextSummary(bill, calc);
    if (hasBridge() && typeof window.HisaabNative.shareText === 'function') {
      window.HisaabNative.shareText(text, bill.meta.restName || 'Bill Split');
      return 'shared';
    }
    if (navigator.share) {
      try { await navigator.share({ title: 'Bill Split', text }); return 'shared'; }
      catch (_) { return 'cancelled'; }
    }
    await navigator.clipboard.writeText(text);
    return 'copied';
  }

  global.Exporter = {
    exportHtml, exportPdf, exportPng,
    shareHtml,  sharePdf,  sharePng,  shareText,
    buildStandaloneHtml, buildTextSummary,
  };
})(window);
