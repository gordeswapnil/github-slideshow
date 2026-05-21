/* ===================================================================
   ocr.js — extract bill data from photo / PDF using Claude vision API.
   User provides an Anthropic API key (stored in localStorage). The app
   calls the Messages API directly from the browser; no backend.

   For PDF inputs, the first page is rendered to a PNG via pdf.js, then
   passed as an image.

   The model is asked to return strict JSON matching our bill schema.
   =================================================================== */
(function (global) {
  'use strict';

  const MODEL = 'claude-haiku-4-5';   // fast + cheap; plenty for OCR
  const ENDPOINT = 'https://api.anthropic.com/v1/messages';
  const TIMEOUT_MS = 45000;

  const SCHEMA_PROMPT = `You are a bill-extraction engine. Read the attached restaurant/party bill image and return STRICT JSON only — no prose, no markdown fences.

Use this exact shape:
{
  "meta": {
    "restName": "string",
    "restSub": "string (sub-title or location, may be empty)",
    "billNo": "string",
    "billDate": "YYYY-MM-DD",
    "billTable": "string",
    "billHall": "string (hall name + time, e.g. 'Garden 9:42 PM')"
  },
  "items": [
    { "name": "string", "rate": number, "qty": number, "amount": number, "section": "food" | "liquor" | "other" }
  ],
  "taxes": { "cgst": number, "sgst": number, "vat": number }
}

RULES
- Section assignment: food items → "food", alcoholic drinks → "liquor", service/guest charges/tips → "other".
- Numbers must be plain JSON numbers (no commas, no currency symbols).
- Tax fields are PERCENTAGES (2.5 not 0.025). If the bill shows only amounts, infer percentages.
- Omit fields you cannot read; never invent values.
- Output ONE JSON object and nothing else.`;

  async function fileToImageBase64(file) {
    if (file.type === 'application/pdf') {
      return await pdfFirstPageToBase64(file);
    }
    return await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        const s = r.result;
        const comma = s.indexOf(',');
        resolve({ media: file.type || 'image/jpeg', data: s.slice(comma + 1) });
      };
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  async function pdfFirstPageToBase64(file) {
    // pdf.js is loaded as an ES module on the page. Pull from the same CDN.
    const mod = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs');
    mod.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs';
    const buf = await file.arrayBuffer();
    const pdf = await mod.getDocument({ data: buf }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const dataUrl = canvas.toDataURL('image/png');
    return { media: 'image/png', data: dataUrl.split(',')[1] };
  }

  async function extractFromFile(file, apiKey) {
    if (!apiKey) throw new Error('Add your Anthropic API key in the menu to enable scanning.');
    const img = await fileToImageBase64(file);

    const body = {
      model: MODEL,
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: img.media, data: img.data } },
          { type: 'text',  text: SCHEMA_PROMPT },
        ],
      }],
    };

    // Hard timeout so a hung connection doesn't spin forever.
    const ctl = new AbortController();
    const to  = setTimeout(() => ctl.abort(), TIMEOUT_MS);

    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
    } catch (e) {
      clearTimeout(to);
      if (e.name === 'AbortError') {
        throw new Error('Scan timed out after ' + (TIMEOUT_MS / 1000) + 's. Check your internet connection and try again.');
      }
      // TypeError: Failed to fetch — Android WebView blocks file:// → https
      throw new Error('Network call to Claude failed (' + (e.message || e.name) +
        '). If you are on the older APK build, please update to the latest from GitHub Actions.');
    }
    clearTimeout(to);

    if (!res.ok) {
      const t = await res.text();
      throw new Error('Claude API error ' + res.status + ': ' + t.slice(0, 300));
    }
    const json = await res.json();
    const text = (json.content || []).map((c) => c.text || '').join('').trim();
    return parseJsonLoose(text);
  }

  /** Strip code fences / extract first JSON object. */
  function parseJsonLoose(s) {
    let t = s.trim();
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
    const start = t.indexOf('{');
    const end   = t.lastIndexOf('}');
    if (start >= 0 && end > start) t = t.slice(start, end + 1);
    return JSON.parse(t);
  }

  global.OCR = { extractFromFile };
})(window);
