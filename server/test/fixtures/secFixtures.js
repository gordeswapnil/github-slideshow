// Hand-built fixtures that mirror the shape of the real SEC EDGAR JSON APIs,
// crafted to exercise filtering, fallbacks, restatement handling and missing
// data. Values are illustrative, not real Netflix figures.

const tickers = {
  0: { cik_str: 1065280, ticker: 'NFLX', title: 'NETFLIX INC' },
  1: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
};

const submissions = {
  cik: '1065280',
  name: 'NETFLIX INC',
  tickers: ['NFLX'],
  exchanges: ['NASDAQ'],
  sic: '7841',
  sicDescription: 'Services-Video Tape Rental',
  fiscalYearEnd: '1231',
  stateOfIncorporation: 'DE',
  category: 'Large accelerated filer',
  formerNames: [{ name: 'NETFLIX COM INC' }],
  addresses: {
    business: {
      street1: '121 Albright Way',
      city: 'Los Gatos',
      stateOrCountry: 'CA',
    },
  },
  filings: {
    recent: {
      form: ['10-K', '10-Q', '10-K'],
      filingDate: ['2025-01-27', '2024-10-18', '2024-01-26'],
      reportDate: ['2024-12-31', '2024-09-30', '2023-12-31'],
      accessionNumber: ['A-2024', 'Q3-2024', 'A-2023'],
      primaryDocument: ['nflx-20241231.htm', 'nflx-20240930.htm', 'nflx-20231231.htm'],
    },
  },
};

// Helper to keep fact entries terse.
const dur = (start, end, val, fy, accn, filed, form = '10-K', fp = 'FY') => ({
  start,
  end,
  val,
  accn,
  fy,
  fp,
  form,
  filed,
});
const inst = (end, val, fy, accn, filed, form = '10-K', fp = 'FY') => ({
  end,
  val,
  accn,
  fy,
  fp,
  form,
  filed,
});

const companyfacts = {
  cik: 1065280,
  entityName: 'NETFLIX INC',
  facts: {
    'us-gaap': {
      Revenues: {
        label: 'Revenues',
        units: {
          USD: [
            dur('2022-01-01', '2022-12-31', 31616, 2022, 'A-2022', '2023-01-26'),
            dur('2023-01-01', '2023-12-31', 33723, 2023, 'A-2023', '2024-01-26'),
            // Restated comparative for 2023 inside the FY2024 10-K. The original
            // (fy 2023) filing should win.
            dur('2023-01-01', '2023-12-31', 33723, 2024, 'A-2024', '2025-01-27'),
            // Quarterly 10-Q entry -> must be filtered out.
            dur('2024-01-01', '2024-03-31', 9370, 2024, 'Q-2024', '2024-04-18', '10-Q', 'Q1'),
            // Partial-year 10-K duration -> must be filtered out.
            dur('2024-01-01', '2024-06-30', 18000, 2024, 'A-2024', '2025-01-27'),
          ],
        },
      },
      // 2024 full-year revenue only available under the newer tag -> fallback.
      RevenueFromContractWithCustomerExcludingAssessedTax: {
        units: {
          USD: [dur('2024-01-01', '2024-12-31', 39000, 2024, 'A-2024', '2025-01-27')],
        },
      },
      // CostOfRevenue absent entirely -> costOfRevenue must use the fallback tag.
      CostOfGoodsAndServicesSold: {
        units: {
          USD: [
            dur('2023-01-01', '2023-12-31', 19715, 2023, 'A-2023', '2024-01-26'),
            dur('2024-01-01', '2024-12-31', 21038, 2024, 'A-2024', '2025-01-27'),
          ],
        },
      },
      OperatingIncomeLoss: {
        units: {
          USD: [dur('2024-01-01', '2024-12-31', 10000, 2024, 'A-2024', '2025-01-27')],
        },
      },
      NetIncomeLoss: {
        units: {
          USD: [
            dur('2022-01-01', '2022-12-31', 4492, 2022, 'A-2022', '2023-01-26'),
            dur('2023-01-01', '2023-12-31', 5408, 2023, 'A-2023', '2024-01-26'),
            dur('2024-01-01', '2024-12-31', 8712, 2024, 'A-2024', '2025-01-27'),
          ],
        },
      },
      Assets: {
        units: {
          USD: [
            inst('2022-12-31', 48595, 2022, 'A-2022', '2023-01-26'),
            inst('2023-12-31', 48732, 2023, 'A-2023', '2024-01-26'),
            // Comparative restatement of 2023 inside FY2024 10-K.
            inst('2023-12-31', 48732, 2024, 'A-2024', '2025-01-27'),
            inst('2024-12-31', 53630, 2024, 'A-2024', '2025-01-27'),
          ],
        },
      },
      AssetsCurrent: {
        units: { USD: [inst('2024-12-31', 9000, 2024, 'A-2024', '2025-01-27')] },
      },
      CashAndCashEquivalentsAtCarryingValue: {
        units: { USD: [inst('2024-12-31', 7800, 2024, 'A-2024', '2025-01-27')] },
      },
      // No direct `Liabilities` tag -> must be derived from current + noncurrent.
      LiabilitiesCurrent: {
        units: { USD: [inst('2024-12-31', 10000, 2024, 'A-2024', '2025-01-27')] },
      },
      LiabilitiesNoncurrent: {
        units: { USD: [inst('2024-12-31', 18000, 2024, 'A-2024', '2025-01-27')] },
      },
      StockholdersEquity: {
        units: { USD: [inst('2024-12-31', 24743, 2024, 'A-2024', '2025-01-27')] },
      },
      NetCashProvidedByUsedInOperatingActivities: {
        units: { USD: [dur('2024-01-01', '2024-12-31', 7000, 2024, 'A-2024', '2025-01-27')] },
      },
      PaymentsToAcquirePropertyPlantAndEquipment: {
        units: { USD: [dur('2024-01-01', '2024-12-31', 300, 2024, 'A-2024', '2025-01-27')] },
      },
      EarningsPerShareDiluted: {
        units: {
          'USD/shares': [dur('2024-01-01', '2024-12-31', 19.83, 2024, 'A-2024', '2025-01-27')],
        },
      },
      WeightedAverageNumberOfDilutedSharesOutstanding: {
        units: {
          shares: [dur('2024-01-01', '2024-12-31', 439000000, 2024, 'A-2024', '2025-01-27')],
        },
      },
      // GrossProfit intentionally absent -> field stays null.
    },
  },
};

module.exports = { tickers, submissions, companyfacts };
