const express = require('express');

// Wraps async route handlers so rejected promises reach the error middleware.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function createRouter({ service }) {
  const router = express.Router();

  router.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  router.get(
    '/company',
    asyncHandler(async (req, res) => {
      res.json(await service.getCompany(req.query.ticker));
    })
  );

  router.get(
    '/companyfacts',
    asyncHandler(async (req, res) => {
      res.json(await service.getCompanyFacts(req.query.ticker));
    })
  );

  router.get(
    '/model-data',
    asyncHandler(async (req, res) => {
      res.json(await service.getModelData(req.query.ticker, { years: req.query.years }));
    })
  );

  router.get(
    '/profile',
    asyncHandler(async (req, res) => {
      res.json(await service.getProfile(req.query.ticker));
    })
  );

  router.get(
    '/ratios',
    asyncHandler(async (req, res) => {
      res.json(await service.getRatios(req.query.ticker, { years: req.query.years }));
    })
  );

  router.get(
    '/wacc',
    asyncHandler(async (req, res) => {
      const q = req.query;
      const overrides = {};
      // Accept student overrides; ignore blanks/non-numerics.
      const map = {
        beta: 'beta',
        rf: 'riskFreeRate',
        riskFreeRate: 'riskFreeRate',
        erp: 'equityRiskPremium',
        equityRiskPremium: 'equityRiskPremium',
        marketCap: 'marketCap',
        costOfDebt: 'costOfDebt',
        taxRate: 'taxRate',
        totalDebt: 'totalDebt',
      };
      for (const [param, key] of Object.entries(map)) {
        if (q[param] !== undefined && q[param] !== '' && Number.isFinite(Number(q[param]))) {
          overrides[key] = Number(q[param]);
        }
      }
      res.json(await service.getWacc(q.ticker, overrides));
    })
  );

  router.get(
    '/all-facts',
    asyncHandler(async (req, res) => {
      res.json(await service.getAllFacts(req.query.ticker, { years: req.query.years }));
    })
  );

  router.get('/fields', (req, res) => {
    res.json(service.getFields());
  });

  router.get(
    '/concept',
    asyncHandler(async (req, res) => {
      res.json(await service.getConcept(req.query.ticker, req.query.tag, req.query.taxonomy));
    })
  );

  return router;
}

module.exports = { createRouter, asyncHandler };
