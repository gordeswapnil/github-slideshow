// Maps each financial-modelling field to the US-GAAP XBRL tags that may carry
// it, in priority order. The first tag with data for a given fiscal year wins.
// `unit` is the preferred XBRL unit (the normalizer falls back to whatever the
// company actually reported, and records it for auditability). `statement` and
// `label` drive grouping/labels in the UI and the /api/sec/fields endpoint.
//
// Insertion order here also defines the field order in the normalized output.
//
// This is a curated set covering the standard three statements. It is NOT
// exhaustive — companies tag hundreds of concepts (and custom extensions). Use
// the /api/sec/all-facts endpoint to retrieve every annual concept a company
// reported.
module.exports = {
  // ---- Income statement --------------------------------------------------
  revenue: {
    statement: 'income',
    label: 'Revenue',
    unit: 'USD',
    tags: [
      'Revenues',
      'RevenueFromContractWithCustomerExcludingAssessedTax',
      'RevenueFromContractWithCustomerIncludingAssessedTax',
      'SalesRevenueNet',
    ],
  },
  costOfRevenue: {
    statement: 'income',
    label: 'Cost of Revenue',
    unit: 'USD',
    tags: ['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfGoodsSold'],
  },
  grossProfit: { statement: 'income', label: 'Gross Profit', unit: 'USD', tags: ['GrossProfit'] },
  researchAndDevelopment: {
    statement: 'income',
    label: 'R&D Expense',
    unit: 'USD',
    tags: ['ResearchAndDevelopmentExpense'],
  },
  sellingAndMarketing: {
    statement: 'income',
    label: 'Selling & Marketing',
    unit: 'USD',
    tags: ['SellingAndMarketingExpense', 'MarketingExpense'],
  },
  generalAndAdministrative: {
    statement: 'income',
    label: 'General & Administrative',
    unit: 'USD',
    tags: ['GeneralAndAdministrativeExpense'],
  },
  sellingGeneralAndAdministrative: {
    statement: 'income',
    label: 'SG&A (combined)',
    unit: 'USD',
    tags: ['SellingGeneralAndAdministrativeExpense'],
  },
  totalOperatingExpenses: {
    statement: 'income',
    label: 'Total Operating Expenses',
    unit: 'USD',
    tags: ['OperatingExpenses', 'CostsAndExpenses'],
  },
  operatingIncome: {
    statement: 'income',
    label: 'Operating Income',
    unit: 'USD',
    tags: ['OperatingIncomeLoss'],
  },
  interestExpense: {
    statement: 'income',
    label: 'Interest Expense',
    unit: 'USD',
    tags: [
      'InterestExpense',
      'InterestExpenseDebt',
      'InterestAndDebtExpense',
      'InterestExpenseNonoperating',
      'InterestIncomeExpenseNonoperatingNet',
    ],
  },
  interestIncome: {
    statement: 'income',
    label: 'Interest / Investment Income',
    unit: 'USD',
    tags: ['InvestmentIncomeInterest', 'InterestAndOtherIncome'],
  },
  otherIncomeExpense: {
    statement: 'income',
    label: 'Other Non-Operating Income',
    unit: 'USD',
    tags: ['NonoperatingIncomeExpense', 'OtherNonoperatingIncomeExpense'],
  },
  pretaxIncome: {
    statement: 'income',
    label: 'Pre-Tax Income',
    unit: 'USD',
    tags: [
      'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest',
      'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments',
    ],
  },
  incomeTaxExpense: {
    statement: 'income',
    label: 'Income Tax Expense',
    unit: 'USD',
    tags: ['IncomeTaxExpenseBenefit'],
  },
  netIncome: {
    statement: 'income',
    label: 'Net Income',
    unit: 'USD',
    tags: ['NetIncomeLoss', 'ProfitLoss'],
  },

  // ---- Per share ---------------------------------------------------------
  // preferLatestFiling: use the most recently filed value for each year so the
  // series is split-adjusted (a later 10-K restates prior years for splits).
  epsBasic: {
    statement: 'pershare',
    label: 'EPS (Basic)',
    unit: 'USD/shares',
    preferLatestFiling: true,
    tags: ['EarningsPerShareBasic'],
  },
  dilutedEPS: {
    statement: 'pershare',
    label: 'EPS (Diluted)',
    unit: 'USD/shares',
    preferLatestFiling: true,
    tags: ['EarningsPerShareDiluted'],
  },
  sharesBasic: {
    statement: 'pershare',
    label: 'Shares (Basic)',
    unit: 'shares',
    preferLatestFiling: true,
    tags: ['WeightedAverageNumberOfSharesOutstandingBasic'],
  },
  dilutedShares: {
    statement: 'pershare',
    label: 'Shares (Diluted)',
    unit: 'shares',
    preferLatestFiling: true,
    tags: ['WeightedAverageNumberOfDilutedSharesOutstanding'],
  },
  dividendsPerShare: {
    statement: 'pershare',
    label: 'Dividends per Share',
    unit: 'USD/shares',
    tags: ['CommonStockDividendsPerShareDeclared', 'CommonStockDividendsPerShareCashPaid'],
  },

  // ---- Balance sheet -----------------------------------------------------
  cashAndEquivalents: {
    statement: 'balance',
    label: 'Cash & Equivalents',
    unit: 'USD',
    tags: [
      'CashAndCashEquivalentsAtCarryingValue',
      'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents',
    ],
  },
  shortTermInvestments: {
    statement: 'balance',
    label: 'Short-Term Investments',
    unit: 'USD',
    tags: ['ShortTermInvestments', 'MarketableSecuritiesCurrent', 'AvailableForSaleSecuritiesCurrent'],
  },
  accountsReceivable: {
    statement: 'balance',
    label: 'Accounts Receivable',
    unit: 'USD',
    tags: ['AccountsReceivableNetCurrent', 'ReceivablesNetCurrent'],
  },
  inventory: { statement: 'balance', label: 'Inventory', unit: 'USD', tags: ['InventoryNet'] },
  otherCurrentAssets: {
    statement: 'balance',
    label: 'Other Current Assets',
    unit: 'USD',
    tags: ['OtherAssetsCurrent'],
  },
  currentAssets: {
    statement: 'balance',
    label: 'Total Current Assets',
    unit: 'USD',
    tags: ['AssetsCurrent'],
  },
  propertyPlantEquipmentNet: {
    statement: 'balance',
    label: 'PP&E, Net',
    unit: 'USD',
    tags: ['PropertyPlantAndEquipmentNet'],
  },
  goodwill: { statement: 'balance', label: 'Goodwill', unit: 'USD', tags: ['Goodwill'] },
  intangibleAssets: {
    statement: 'balance',
    label: 'Intangible Assets',
    unit: 'USD',
    tags: ['IntangibleAssetsNetExcludingGoodwill', 'FiniteLivedIntangibleAssetsNet'],
  },
  otherNoncurrentAssets: {
    statement: 'balance',
    label: 'Other Non-Current Assets',
    unit: 'USD',
    tags: ['OtherAssetsNoncurrent'],
  },
  totalAssets: { statement: 'balance', label: 'Total Assets', unit: 'USD', tags: ['Assets'] },
  accountsPayable: {
    statement: 'balance',
    label: 'Accounts Payable',
    unit: 'USD',
    tags: ['AccountsPayableCurrent'],
  },
  accruedLiabilities: {
    statement: 'balance',
    label: 'Accrued Liabilities',
    unit: 'USD',
    tags: ['AccruedLiabilitiesCurrent', 'AccountsPayableAndAccruedLiabilitiesCurrent'],
  },
  otherCurrentLiabilities: {
    statement: 'balance',
    label: 'Other Current Liabilities',
    unit: 'USD',
    tags: ['OtherLiabilitiesCurrent'],
  },
  shortTermDebt: {
    statement: 'balance',
    label: 'Short-Term / Current Debt',
    unit: 'USD',
    tags: ['LongTermDebtCurrent', 'DebtCurrent', 'ShortTermBorrowings'],
  },
  deferredRevenueCurrent: {
    statement: 'balance',
    label: 'Deferred Revenue (Current)',
    unit: 'USD',
    tags: ['ContractWithCustomerLiabilityCurrent', 'DeferredRevenueCurrent'],
  },
  currentLiabilities: {
    statement: 'balance',
    label: 'Total Current Liabilities',
    unit: 'USD',
    tags: ['LiabilitiesCurrent'],
  },
  longTermDebt: {
    statement: 'balance',
    label: 'Long-Term Debt',
    unit: 'USD',
    tags: ['LongTermDebtNoncurrent', 'LongTermDebt'],
  },
  otherNoncurrentLiabilities: {
    statement: 'balance',
    label: 'Other Non-Current Liabilities',
    unit: 'USD',
    tags: ['OtherLiabilitiesNoncurrent'],
  },
  deferredTaxLiabilities: {
    statement: 'balance',
    label: 'Deferred Tax Liabilities',
    unit: 'USD',
    tags: ['DeferredIncomeTaxLiabilitiesNet', 'DeferredTaxLiabilitiesNoncurrent'],
  },
  totalLiabilities: {
    statement: 'balance',
    label: 'Total Liabilities',
    unit: 'USD',
    // A computed fallback (LiabilitiesCurrent + LiabilitiesNoncurrent) is
    // applied in the normalizer when this direct tag is absent.
    tags: ['Liabilities'],
  },
  commonStockValue: {
    statement: 'balance',
    label: 'Common Stock',
    unit: 'USD',
    tags: ['CommonStockValue'],
  },
  additionalPaidInCapital: {
    statement: 'balance',
    label: 'Additional Paid-In Capital',
    unit: 'USD',
    tags: ['AdditionalPaidInCapital', 'AdditionalPaidInCapitalCommonStock'],
  },
  retainedEarnings: {
    statement: 'balance',
    label: 'Retained Earnings',
    unit: 'USD',
    tags: ['RetainedEarningsAccumulatedDeficit'],
  },
  treasuryStock: {
    statement: 'balance',
    label: 'Treasury Stock',
    unit: 'USD',
    // Reported as a positive contra amount; normalize to negative so equity
    // components sum to total equity.
    negate: true,
    tags: ['TreasuryStockValue', 'TreasuryStockCommonValue'],
  },
  accumulatedOCI: {
    statement: 'balance',
    label: 'Accumulated OCI',
    unit: 'USD',
    tags: ['AccumulatedOtherComprehensiveIncomeLossNetOfTax'],
  },
  stockholdersEquity: {
    statement: 'balance',
    label: "Stockholders' Equity",
    unit: 'USD',
    tags: [
      'StockholdersEquity',
      'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest',
    ],
  },

  // ---- Cash flow ---------------------------------------------------------
  depreciationAmortization: {
    statement: 'cashflow',
    label: 'Depreciation & Amortization',
    unit: 'USD',
    tags: [
      'DepreciationDepletionAndAmortization',
      'DepreciationAmortizationAndAccretionNet',
      'DepreciationAndAmortization',
    ],
  },
  amortizationOfIntangibles: {
    statement: 'cashflow',
    label: 'Amortization of Intangibles/Content',
    unit: 'USD',
    tags: ['AmortizationOfIntangibleAssets', 'AmortizationOfDeferredCharges'],
  },
  stockBasedCompensation: {
    statement: 'cashflow',
    label: 'Stock-Based Compensation',
    unit: 'USD',
    tags: ['ShareBasedCompensation'],
  },
  deferredIncomeTaxes: {
    statement: 'cashflow',
    label: 'Deferred Income Taxes',
    unit: 'USD',
    tags: ['DeferredIncomeTaxExpenseBenefit', 'DeferredIncomeTaxesAndTaxCredits'],
  },
  otherNoncashItems: {
    statement: 'cashflow',
    label: 'Other Non-Cash Items',
    unit: 'USD',
    tags: ['OtherNoncashIncomeExpense'],
  },
  changeInWorkingCapital: {
    statement: 'cashflow',
    label: 'Change in Working Capital',
    unit: 'USD',
    tags: ['IncreaseDecreaseInOperatingCapital'],
  },
  operatingCashFlow: {
    statement: 'cashflow',
    label: 'Operating Cash Flow',
    unit: 'USD',
    tags: [
      'NetCashProvidedByUsedInOperatingActivities',
      'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations',
    ],
  },
  capitalExpenditure: {
    statement: 'cashflow',
    label: 'Capital Expenditure',
    unit: 'USD',
    tags: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets'],
  },
  acquisitions: {
    statement: 'cashflow',
    label: 'Acquisitions, Net',
    unit: 'USD',
    tags: ['PaymentsToAcquireBusinessesNetOfCashAcquired'],
  },
  investingCashFlow: {
    statement: 'cashflow',
    label: 'Investing Cash Flow',
    unit: 'USD',
    tags: [
      'NetCashProvidedByUsedInInvestingActivities',
      'NetCashProvidedByUsedInInvestingActivitiesContinuingOperations',
    ],
  },
  debtIssued: {
    statement: 'cashflow',
    label: 'Debt Issued',
    unit: 'USD',
    tags: ['ProceedsFromIssuanceOfLongTermDebt'],
  },
  debtRepaid: {
    statement: 'cashflow',
    label: 'Debt Repaid',
    unit: 'USD',
    tags: ['RepaymentsOfLongTermDebt'],
  },
  stockRepurchased: {
    statement: 'cashflow',
    label: 'Stock Repurchased',
    unit: 'USD',
    tags: ['PaymentsForRepurchaseOfCommonStock'],
  },
  stockIssued: {
    statement: 'cashflow',
    label: 'Stock Issued',
    unit: 'USD',
    tags: ['ProceedsFromIssuanceOfCommonStock', 'ProceedsFromStockOptionsExercised'],
  },
  dividendsPaid: {
    statement: 'cashflow',
    label: 'Dividends Paid',
    unit: 'USD',
    tags: ['PaymentsOfDividendsCommonStock', 'PaymentsOfDividends'],
  },
  financingCashFlow: {
    statement: 'cashflow',
    label: 'Financing Cash Flow',
    unit: 'USD',
    tags: [
      'NetCashProvidedByUsedInFinancingActivities',
      'NetCashProvidedByUsedInFinancingActivitiesContinuingOperations',
    ],
  },
  effectOfExchangeRate: {
    statement: 'cashflow',
    label: 'Effect of Exchange Rate on Cash',
    unit: 'USD',
    tags: [
      'EffectOfExchangeRateOnCashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents',
      'EffectOfExchangeRateOnCashAndCashEquivalents',
    ],
  },
  netChangeInCash: {
    statement: 'cashflow',
    label: 'Net Change in Cash',
    unit: 'USD',
    tags: [
      'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsPeriodIncreaseDecreaseIncludingExchangeRateEffect',
      'CashAndCashEquivalentsPeriodIncreaseDecrease',
    ],
  },
};
