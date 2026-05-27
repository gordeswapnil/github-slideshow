const fs = require('fs');

// Industry (un)levered betas in the spirit of Aswath Damodaran's freely
// published NYU Stern dataset. Beta is NOT in SEC data and a single-stock
// regression beta is noisy, so for teaching we use an INDUSTRY unlevered beta
// and re-lever it with the company's own capital structure and tax rate.
//
// IMPORTANT: the values below are APPROXIMATE seed values for offline use. For
// real analysis, download the current "Levered and Unlevered Betas by Industry
// (US)" table from https://pages.stern.nyu.edu/~adamodar/ and point
// DAMODARAN_DATA_PATH at a JSON file of { "Industry Name": unleveredBeta, ... }.
const SEED = {
  vintage: 'approximate seed (~2024) — replace with official Damodaran data',
  region: 'US',
  // unlevered (asset) betas by industry
  unlevered: {
    'Total Market': 0.78,
    Entertainment: 1.1,
    'Software (System & Application)': 1.13,
    'Software (Internet)': 1.4,
    'Computers/Peripherals': 1.05,
    'Semiconductor': 1.55,
    'Drugs (Pharmaceutical)': 1.05,
    'Healthcare Products': 0.9,
    'Retail (General)': 1.1,
    'Retail (Online)': 1.45,
    'Bank (Money Center)': 0.45,
    'Insurance (General)': 0.55,
    'Auto & Truck': 1.3,
    'Aerospace/Defense': 1.05,
    'Telecom Services': 0.8,
    'Food Processing': 0.55,
    'Beverage (Soft)': 0.6,
    'Oil/Gas (Production)': 0.95,
    'Utility (General)': 0.4,
    'Hotel/Gaming': 1.25,
    'Restaurant/Dining': 1.25,
    'Apparel': 1.05,
    'Advertising': 1.1,
    'Air Transport': 1.2,
    'Chemical (Basic)': 0.95,
    'Real Estate (REIT)': 0.7,
    'Machinery': 1.05,
    'Household Products': 0.7,
  },
};

// Map an SIC code to one of the industries above. Coarse but reasonable.
function sicToIndustry(sic) {
  const code = Number(String(sic || '').trim());
  if (!Number.isFinite(code) || code === 0) return null;
  const inRange = (lo, hi) => code >= lo && code <= hi;

  if (inRange(7800, 7899) || inRange(7900, 7999)) return 'Entertainment';
  if (inRange(7370, 7379)) return 'Software (System & Application)';
  if (code === 7370 || inRange(5961, 5961)) return 'Retail (Online)';
  if (inRange(3570, 3579) || inRange(3680, 3689)) return 'Computers/Peripherals';
  if (inRange(3670, 3679) || code === 3674) return 'Semiconductor';
  if (inRange(2830, 2836) || code === 2834) return 'Drugs (Pharmaceutical)';
  if (inRange(3840, 3851)) return 'Healthcare Products';
  if (inRange(5200, 5999)) return 'Retail (General)';
  if (inRange(6020, 6099)) return 'Bank (Money Center)';
  if (inRange(6300, 6411)) return 'Insurance (General)';
  if (inRange(3710, 3716)) return 'Auto & Truck';
  if (inRange(3720, 3728) || inRange(3760, 3769)) return 'Aerospace/Defense';
  if (inRange(4810, 4899)) return 'Telecom Services';
  if (inRange(2000, 2099)) return 'Food Processing';
  if (inRange(2080, 2086)) return 'Beverage (Soft)';
  if (inRange(1310, 1389) || inRange(2900, 2999)) return 'Oil/Gas (Production)';
  if (inRange(4900, 4991)) return 'Utility (General)';
  if (inRange(7000, 7021)) return 'Hotel/Gaming';
  if (inRange(5812, 5813)) return 'Restaurant/Dining';
  if (inRange(2200, 2399) || inRange(3100, 3199)) return 'Apparel';
  if (inRange(7310, 7319)) return 'Advertising';
  if (inRange(4500, 4581)) return 'Air Transport';
  if (inRange(2800, 2899)) return 'Chemical (Basic)';
  if (inRange(6500, 6553)) return 'Real Estate (REIT)';
  if (inRange(3500, 3569)) return 'Machinery';
  if (inRange(2840, 2844) || code === 2840) return 'Household Products';
  return null;
}

function loadDataset() {
  const path = process.env.DAMODARAN_DATA_PATH;
  if (path) {
    try {
      const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
      // Accept either { unlevered: {...} } or a flat { industry: beta } map.
      const unlevered = raw.unlevered || raw;
      return {
        vintage: raw.vintage || `custom (${path})`,
        region: raw.region || 'US',
        unlevered,
      };
    } catch (_) {
      /* fall back to seed */
    }
  }
  return SEED;
}

// Re-lever an industry asset beta with the firm's capital structure:
//   beta_levered = beta_unlevered * (1 + (1 - taxRate) * (D / E))
function relever(unlevered, { de, taxRate }) {
  if (unlevered == null) return null;
  if (de == null || !Number.isFinite(de) || de < 0) return unlevered;
  const t = Number.isFinite(taxRate) ? taxRate : 0;
  return unlevered * (1 + (1 - t) * de);
}

// Resolve an industry beta for a company.
function getIndustryBeta({ sic, de, taxRate, dataset = loadDataset() } = {}) {
  let industry = sicToIndustry(sic);
  let matchedBy = 'sic';
  if (!industry || dataset.unlevered[industry] == null) {
    industry = 'Total Market';
    matchedBy = 'fallback';
  }
  const unleveredBeta = dataset.unlevered[industry];
  const releveredBeta = relever(unleveredBeta, { de, taxRate });
  return {
    industry,
    matchedBy,
    unleveredBeta,
    releveredBeta,
    deRatioUsed: de != null && Number.isFinite(de) ? de : null,
    taxRateUsed: Number.isFinite(taxRate) ? taxRate : null,
    vintage: dataset.vintage,
    region: dataset.region,
    source: 'damodaran-industry',
  };
}

module.exports = { getIndustryBeta, sicToIndustry, relever, loadDataset, SEED };
