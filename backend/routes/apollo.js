/**
 * Apollo Enrichment Routes
 *
 * POST /enrich/:leadId  — Enrich a single lead
 * POST /enrich-bulk     — Bulk enrich leads
 * GET  /status          — Check Apollo API key validity
 */

const express = require('express');
const { enrichLead, enrichBulk, checkStatus } = require('../services/apollo');

const router = express.Router();

// POST /api/apollo/enrich/:leadId
router.post('/enrich/:leadId', async (req, res) => {
  try {
    const result = await enrichLead(Number(req.params.leadId));
    res.json({ data: result });
  } catch (err) {
    const status = err.message.includes('not configured') ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// POST /api/apollo/enrich-bulk
// Pass dryRun: true in body to preview credit usage without calling Apollo
router.post('/enrich-bulk', async (req, res) => {
  try {
    const { leadIds, filter, dryRun } = req.body;
    const result = await enrichBulk({ leadIds, filter, dryRun: !!dryRun });
    res.json(result);
  } catch (err) {
    const status = err.message.includes('not configured') ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// GET /api/apollo/status
router.get('/status', async (req, res) => {
  try {
    const result = await checkStatus();
    res.json({ data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
