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
    '/concept',
    asyncHandler(async (req, res) => {
      res.json(await service.getConcept(req.query.ticker, req.query.tag, req.query.taxonomy));
    })
  );

  return router;
}

module.exports = { createRouter, asyncHandler };
