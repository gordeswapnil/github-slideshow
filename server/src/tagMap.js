// Maps each financial-modelling field to the US-GAAP XBRL tags that may carry
// it, in priority order. The first tag that has data for a given fiscal year
// wins. `unit` is the preferred XBRL unit; if absent the normalizer falls back
// to whatever unit the company actually reported (recorded for auditability).
//
// Insertion order here also defines the field order in the normalized output.
module.exports = {
  revenue: {
    unit: 'USD',
    tags: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax'],
  },
  costOfRevenue: {
    unit: 'USD',
    tags: ['CostOfRevenue', 'CostOfGoodsAndServicesSold'],
  },
  grossProfit: {
    unit: 'USD',
    tags: ['GrossProfit'],
  },
  operatingIncome: {
    unit: 'USD',
    tags: ['OperatingIncomeLoss'],
  },
  netIncome: {
    unit: 'USD',
    tags: ['NetIncomeLoss'],
  },
  totalAssets: {
    unit: 'USD',
    tags: ['Assets'],
  },
  currentAssets: {
    unit: 'USD',
    tags: ['AssetsCurrent'],
  },
  cashAndEquivalents: {
    unit: 'USD',
    tags: [
      'CashAndCashEquivalentsAtCarryingValue',
      'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents',
    ],
  },
  totalLiabilities: {
    unit: 'USD',
    // Direct tag only. A computed fallback (LiabilitiesCurrent +
    // LiabilitiesNoncurrent) is applied in the normalizer when this is absent.
    tags: ['Liabilities'],
  },
  stockholdersEquity: {
    unit: 'USD',
    tags: [
      'StockholdersEquity',
      'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest',
    ],
  },
  operatingCashFlow: {
    unit: 'USD',
    tags: ['NetCashProvidedByUsedInOperatingActivities'],
  },
  capitalExpenditure: {
    unit: 'USD',
    tags: ['PaymentsToAcquirePropertyPlantAndEquipment'],
  },
  dilutedEPS: {
    unit: 'USD/shares',
    tags: ['EarningsPerShareDiluted'],
  },
  dilutedShares: {
    unit: 'shares',
    tags: ['WeightedAverageNumberOfDilutedSharesOutstanding'],
  },
};
