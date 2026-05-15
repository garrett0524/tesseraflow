/**
 * Instantly Campaign Push & Sync Routes
 *
 * GET  /campaigns      — List available Instantly campaigns
 * POST /push           — Push leads to a campaign
 * POST /push-filtered  — Push filtered leads to a campaign
 * POST /sync           — Manual sync of email statuses
 */

const express = require('express');
const { getCampaigns, pushLeadsToCampaign, pushFilteredLeads } = require('../services/instantly-push');
const { syncEmailStatuses, syncEmailLog, handleWebhook } = require('../services/instantly-sync');

const router = express.Router();

// GET /api/instantly/campaigns
router.get('/campaigns', async (req, res) => {
  try {
    const campaigns = await getCampaigns();
    res.json({ data: campaigns });
  } catch (err) {
    const status = err.message.includes('not configured') ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// POST /api/instantly/push
router.post('/push', async (req, res) => {
  try {
    const { leadIds, campaignId } = req.body;
    if (!leadIds || !campaignId) {
      return res.status(400).json({ error: 'leadIds and campaignId are required' });
    }
    const result = await pushLeadsToCampaign(leadIds, campaignId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/instantly/push-filtered
// Body shape (one of):
//   { filter: 'has_email_not_sent', campaignId }     — legacy named filter
//   { selectAll: true, filters: {...}, campaignId }  — lead-table filter set
//                                                       from the bulk action bar
router.post('/push-filtered', async (req, res) => {
  try {
    const { filter, selectAll, filters, campaignId } = req.body;
    if (!campaignId) {
      return res.status(400).json({ error: 'campaignId is required' });
    }
    let resolvedFilter;
    if (selectAll === true) {
      resolvedFilter = filters || {};
    } else if (filter) {
      resolvedFilter = filter;
    } else {
      return res.status(400).json({ error: 'filter or selectAll is required' });
    }
    const result = await pushFilteredLeads(resolvedFilter, campaignId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/instantly/sync — Manual sync of email statuses and email log
router.post('/sync', async (req, res) => {
  try {
    const [statusResult, logResult] = await Promise.allSettled([
      syncEmailStatuses(),
      syncEmailLog(),
    ]);
    res.json({
      lead_status: statusResult.status === 'fulfilled' ? statusResult.value : { error: statusResult.reason?.message },
      email_log: logResult.status === 'fulfilled' ? logResult.value : { error: logResult.reason?.message },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
