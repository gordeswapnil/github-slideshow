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

  // Anthropic public pricing for claude-haiku-4-5 (USD per million tokens).
  // Used only for the in-app cost meter; kept in one place so it's easy to
  // update if pricing changes.
  const PRICE_INPUT_PER_MTOK_USD  = 1.00;
  const PRICE_OUTPUT_PER_MTOK_USD = 5.00;
  const USD_TO_INR = 85;   // rough; user can override in settings later

  function computeUsage(json) {
    const u = (json && json.usage) || {};
    const inputTokens  = +u.input_tokens  || 0;
    const outputTokens = +u.output_tokens || 0;
    const usd =
      (inputTokens  / 1e6) * PRICE_INPUT_PER_MTOK_USD +
      (outputTokens / 1e6) * PRICE_OUTPUT_PER_MTOK_USD;
    return {
      inputTokens, outputTokens,
      costUsd: usd,
      costInr: usd * USD_TO_INR,
    };
  }

  const SCHEMA_PROMPT = `You are a bill-extraction engine. Read the attached restaurant/party bill image and return STRICT JSON only — no prose, no markdown fences.

Use this exact shape:
{
  "meta": {
    "restName": "string",
    "restSub": "string (sub-title or location, may be empty)",
    "billNo": "string",
    "billDate": "YYYY-MM-DD",
    "billTable": "string",
    "billHall": "string (hall name + time, e.g. 'Garden 9:42 PM')",
    "restaurantType": "veg" | "nonveg" | "both" | "bar",
    "cuisine": "string (e.g. 'Indian', 'Chinese', 'Continental', 'Cafe')",
    "currency": "string (e.g. 'INR', 'USD' — default 'INR')"
  },
  "items": [
    { "name": "string",
      "rate": number,
      "qty": number,
      "amount": number,
      "section": "food" | "liquor" | "other",
      "dietary": "veg" | "nonveg" | "any" | "liquor",
      "category": "starter" | "main" | "dessert" | "beverage" | "drink" | "accompaniment" | "extra",
      "isParcel": boolean }
  ],
  "taxes": [
    { "name": "string (e.g. CGST, SGST, VAT, Service Charge)", "rate": number, "base": "food" | "liquor" | "other" | "all" }
  ],
  "warnings": [ "string" ],
  "hasServiceCharge": boolean
}

CRITICAL RULES — item extraction

1. MULTI-LINE ITEM NAMES. Restaurant receipts often wrap long item names across
   two or three text lines because of narrow columns. A single item is ALWAYS
   identified by the line that contains its qty AND its price; lines immediately
   above or below that — which contain ONLY text (no qty, no price) — belong to
   that item's name.

   Examples of wrapped names that MUST be combined into one item:
     "Sabudana"             ↘
     "Khichadi  1 100 100"  → one item: name "Sabudana Khichadi", qty 1, rate 100, amount 100
     "Maysur Masala"        ↘
     "Dosa      1 130 130"  → one item: name "Maysur Masala Dosa", qty 1, rate 130, amount 130
     "Kesari Bhath"         ↘
     "(sheera)  1 100 100"  → one item: name "Kesari Bhath (sheera)", qty 1, rate 100, amount 100

   NEVER emit an item whose qty or rate is invented from an adjacent row.

2. SANITY CHECK. After extracting items, sum their amounts. The sum MUST equal
   the bill's printed subtotal (pre-tax total). If they don't match, you have
   either split a wrapped name OR missed an item — re-read the receipt before
   answering.

3. SECTION ASSIGNMENT. Food → "food"; alcoholic drinks → "liquor"; service /
   guest charges / tips → "other".

4. NUMBERS. Plain JSON numbers, no commas, no currency symbols.

5. TAX FIELDS. The "taxes" array contains ONLY the taxes/charges that the bill
   actually prints. Do NOT add taxes that aren't on the receipt.
   - "rate" is a percentage (2.5, not 0.025). If only an amount is shown,
     compute rate as amount ÷ subtotal × 100.
   - "base" is the section the tax is computed on. CGST/SGST/GST on a food
     subtotal → "food". VAT/excise on alcohol → "liquor". A service charge on
     the entire bill → "all". A tax on the non-food/non-liquor subtotal → "other".
   - If the bill has NO taxes (rare), return "taxes": [].

6. RESTAURANT TYPE INFERENCE — use the restaurant's name and content to set
   meta.restaurantType and each item's dietary tag intelligently:
   - "VEG", "PURE VEG", "SHAKAHARI", "SATTVIC", "JAIN" in the restaurant name
     → restaurantType: "veg". EVERY food item's dietary MUST be "veg".
     The bill cannot contain liquor — do not emit any liquor items.
   - "NON-VEG", "MUTTON", "CHICKEN" obvious in the restaurant name
     → restaurantType: "nonveg". Tag each food item by its own type
     (chicken/mutton/fish/egg → "nonveg"; explicit veg dishes → "veg";
     ambiguous like dal/rice/roti → "any").
   - "BAR", "WINES", "DISTILLERY" prominent → restaurantType: "bar".
     Items in the LIQUOR section get dietary "liquor". Food items same logic
     as above for nonveg.
   - Otherwise → restaurantType: "both". Tag items individually.
   For every individual food item, when in doubt between veg/any, prefer "veg"
   if the dish is unambiguously vegetarian (idli, dosa, sambar, dal, paneer,
   khichadi, etc.). Use "nonveg" only for clearly non-veg dishes.

7. ITEM CATEGORY — tag each item with what KIND of dish it is, so the UI can
   group related items:
   - starter        : appetizers, soups, salads, papad, masala papad, pakoda, samosa
   - main           : biryani, curry, dal, rice, roti, naan, sabji, thali, dosa,
                      idli, khichadi, pasta, sandwich, burger — the bulk dish
   - dessert        : ice cream, kulfi, halwa, kheer, gulab jamun, kesari bhath, etc.
   - beverage       : water, soft drinks, juice, tea, coffee, lassi, butter milk
   - drink          : alcoholic only (overrides if item is in liquor section)
   - accompaniment  : pickle, raita, chutney, side salad
   - extra          : guest charges, paan, mints, anything that doesn't fit

8. PARCEL / TAKEAWAY DETECTION — set isParcel: true if the item line contains
   "PARCEL", "TO GO", "TAKE AWAY", "TAKEAWAY", "PACKED", or similar markers.
   These items typically belong to one person; the app will default such items
   to a single-person assignment.

9. MATH VALIDATION — before emitting your response, sum the item amounts and
   verify it equals the printed subtotal (pre-tax). If they DIFFER by more
   than 1 unit of currency, re-read the bill. If you still cannot reconcile,
   add a clear warning string to "warnings" describing the discrepancy
   (e.g. "Items sum to ₹453 but bill prints subtotal ₹455. Likely a missed
   item — please verify."). The "warnings" array MUST be empty when the
   numbers reconcile.

10. SERVICE CHARGE — set hasServiceCharge: true if the bill prints any line
    matching "Service Charge", "Service Tax", "Tip", "Gratuity", "Service Fee".
    Whether or not it's there, the user can add one in-app afterwards. If a
    service charge IS present, include it as one of the taxes (base "all" if
    on the whole bill, "food" if explicitly only on food).

11. CURRENCY — set meta.currency to the 3-letter ISO code (INR, USD, EUR,
    GBP, AED, etc.) based on the printed currency symbol or locale.
    Default to "INR" only if you genuinely cannot determine it.

12. Omit any field you genuinely cannot read; never invent values. Output ONE
    JSON object and nothing else.`;

  async function fileToImageBase64(file) {
    if (file.type === 'application/pdf') {
      return await pdfFirstPageToBase64(file);
    }
    // For ordinary photos we MUST downscale and re-encode:
    //   - Anthropic's vision endpoint rejects images > 5 MB base64
    //   - Modern phone cameras routinely produce 4-10 MB JPEGs even for a
    //     simple receipt photo
    //   - For OCR of a receipt, ~1800 px on the long edge is plenty; text
    //     is comfortably above the resolving threshold
    return await imageToCompressedBase64(file);
  }

  /** Resize + re-encode an image File so the API payload stays under 4 MB. */
  async function imageToCompressedBase64(file) {
    const MAX_LONG_EDGE = 1800;
    const TARGET_BYTES  = 4 * 1024 * 1024; // 4 MB leaves headroom for base64 expansion + JSON envelope

    // Step 1: load into an Image element
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload  = () => resolve(im);
      im.onerror = reject;
      im.src = dataUrl;
    });

    // Step 2: pick target dimensions
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    const longEdge = Math.max(w, h);
    if (longEdge > MAX_LONG_EDGE) {
      const scale = MAX_LONG_EDGE / longEdge;
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }

    // Step 3: draw to canvas
    const canvas = document.createElement('canvas');
    canvas.width  = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    // White background — many JPEGs have implicit transparency that becomes
    // black on canvas; white is much friendlier for OCR contrast.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    // Step 4: encode as JPEG at decreasing quality until under target size
    let quality = 0.85;
    let blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    while (blob.size > TARGET_BYTES && quality > 0.4) {
      quality -= 0.15;
      blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    }

    // Step 5: blob → base64 (strip the data:image/jpeg;base64, prefix)
    const finalDataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
    return { media: 'image/jpeg', data: finalDataUrl.split(',')[1] };
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
  }

  async function pdfFirstPageToBase64(file) {
    const mod = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs');
    mod.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs';
    const buf = await file.arrayBuffer();
    const pdf = await mod.getDocument({ data: buf }).promise;
    const page = await pdf.getPage(1);
    // Pick a scale that keeps the long edge ~1800 px (same target as photos).
    const baseViewport = page.getViewport({ scale: 1 });
    const longEdge = Math.max(baseViewport.width, baseViewport.height);
    const scale = Math.min(2, 1800 / longEdge);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width  = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;

    // Encode as JPEG, dropping quality if the resulting payload is too big.
    let quality = 0.85;
    let blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    while (blob.size > 4 * 1024 * 1024 && quality > 0.4) {
      quality -= 0.15;
      blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    }
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
    return { media: 'image/jpeg', data: dataUrl.split(',')[1] };
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

    // Inside the Android APK we hand the call to the Java bridge to bypass
    // WebView CORS restrictions on cross-origin browser fetch. In a plain
    // browser (or PWA) we fall back to fetch.
    const useBridge = (typeof window !== 'undefined'
        && window.HisaabNative
        && typeof window.HisaabNative.callAnthropic === 'function');
    const { text, raw } = useBridge
      ? await callViaBridge(apiKey, body)
      : await callViaFetch(apiKey, body);

    const parsed = parseJsonLoose(text);
    // Attach usage metadata so the caller can track cost without re-fetching.
    parsed._usage = computeUsage(raw);
    return parsed;
  }

  /** Browser fetch path (PWA / single-file build / dev).
   *  Retries 429 / 502 / 503 / 504 / 529 up to 3 times with 2/4/8s backoff. */
  async function callViaFetch(apiKey, body) {
    const backoff = [0, 2000, 4000, 8000];
    let lastErr = null;
    let lastRes = null;
    for (let attempt = 0; attempt < backoff.length; attempt++) {
      if (backoff[attempt] > 0) await new Promise((r) => setTimeout(r, backoff[attempt]));
      const ctl = new AbortController();
      const to  = setTimeout(() => ctl.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(ENDPOINT, {
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
        clearTimeout(to);
        if (res.ok) {
          const json = await res.json();
          return {
            raw: json,
            text: (json.content || []).map((c) => c.text || '').join('').trim(),
          };
        }
        // HTTP error — retry transient codes, surface immediately otherwise
        lastRes = { status: res.status, body: await res.text() };
        if (!isTransientHttp(res.status) || attempt === backoff.length - 1) {
          throw friendlyHttpError(lastRes.status, lastRes.body);
        }
      } catch (e) {
        clearTimeout(to);
        if (e instanceof Error && e.message && (e.message.includes('Claude API') || e.message.includes('temporarily'))) {
          throw e;
        }
        if (e.name === 'AbortError') {
          if (attempt === backoff.length - 1) {
            throw new Error('Scan timed out after ' + (TIMEOUT_MS / 1000) + 's. Check your internet connection.');
          }
          continue;
        }
        lastErr = e;
        if (attempt === backoff.length - 1) {
          throw new Error('Network call to Claude failed (' + (e.message || e.name) + ').');
        }
      }
    }
    throw lastErr || new Error('Scan failed after several retries.');
  }

  function isTransientHttp(code) {
    return code === 429 || code === 502 || code === 503 || code === 504 || code === 529;
  }

  function friendlyHttpError(status, bodyText) {
    if (status === 529 || status === 503) {
      return new Error("Anthropic's servers are overloaded right now. Tried 4 times. Please retry in a minute.");
    }
    if (status === 429) {
      return new Error('Rate limited by Anthropic — too many requests. Wait a minute and try again.');
    }
    if (status === 401 || status === 403) {
      return new Error('Anthropic rejected the API key (' + status + '). Check it in Settings.');
    }
    return new Error('Claude API error ' + status + ': ' + (bodyText || '').slice(0, 300));
  }

  /** Android-only path via the WebAppInterface Java bridge. */
  function callViaBridge(apiKey, body) {
    return new Promise((resolve, reject) => {
      if (!window.HisaabBridge) {
        window.HisaabBridge = {
          _pending: Object.create(null),
          _resolve(id, resultJson) {
            const cb = this._pending[id];
            if (!cb) return;
            delete this._pending[id];
            try {
              const r = JSON.parse(resultJson);
              cb(r);
            } catch (e) {
              cb({ status: -1, error: 'Bridge returned malformed JSON' });
            }
          },
        };
      }
      const cbId = 'cb_' + Math.random().toString(36).slice(2);
      const timer = setTimeout(() => {
        if (window.HisaabBridge._pending[cbId]) {
          delete window.HisaabBridge._pending[cbId];
          reject(new Error('Scan timed out after ' + (TIMEOUT_MS / 1000) + 's.'));
        }
      }, TIMEOUT_MS);

      window.HisaabBridge._pending[cbId] = (r) => {
        clearTimeout(timer);
        if (r.status < 0) {
          reject(new Error('Network error: ' + (r.error || 'unknown')));
          return;
        }
        if (r.status < 200 || r.status >= 300) {
          // The native bridge has already retried transient errors, so this
          // is the final result. Just present a friendly message.
          reject(friendlyHttpError(r.status, r.body || ''));
          return;
        }
        try {
          const j = JSON.parse(r.body);
          resolve({
            raw: j,
            text: (j.content || []).map((c) => c.text || '').join('').trim(),
          });
        } catch (e) {
          reject(new Error('Could not parse Claude response: ' + e.message));
        }
      };

      try {
        window.HisaabNative.callAnthropic(apiKey, JSON.stringify(body), cbId);
      } catch (e) {
        clearTimeout(timer);
        delete window.HisaabBridge._pending[cbId];
        reject(new Error('Failed to invoke native bridge: ' + (e.message || e)));
      }
    });
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
