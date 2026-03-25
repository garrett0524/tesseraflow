/**
 * Instantly.ai Campaign Push Service
 *
 * Pushes enriched leads into Instantly email campaigns.
 */

const { query } = require('../database/pg');

const INSTANTLY_BASE = 'https://api.instantly.ai/api/v1';

async function getApiKey() {
  const { rows: [setting] } = await query("SELECT value FROM settings WHERE key = 'instantly_api_key'");
  const key = setting?.value;
  if (!key) {
    throw new Error('Instantly.ai API key not configured. Add it in Settings.');
  }
  return key;
}

/**
 * List available Instantly campaigns.
 */
async function getCampaigns() {
  const apiKey = await getApiKey();

  const response = await fetch(`${INSTANTLY_BASE}/campaign/list?api_key=${encodeURIComponent(apiKey)}`);
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Instantly API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const campaigns = Array.isArray(data) ? data : (data.data || data.campaigns || []);

  return campaigns.map(c => ({
    id: c.id,
    name: c.name || c.campaign_name || 'Unnamed',
  }));
}

/**
 * Push specific leads to an Instantly campaign.
 */
async function pushLeadsToCampaign(leadIds, campaignId) {
  const apiKey = await getApiKey();

  const { rows: leads } = await query(
    'SELECT id, email, contact_name, business_name, city, phone FROM leads WHERE id = ANY($1)',
    [leadIds]
  );

  const stats = { pushed: 0, skipped_no_email: 0, errors: 0 };

  for (const lead of leads) {
    if (!lead.email || lead.email.trim() === '') {
      stats.skipped_no_email++;
      continue;
    }

    // Split contact_name into first/last
    const nameParts = (lead.contact_name || '').trim().split(/\s+/);
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    try {
      const response = await fetch(`${INSTANTLY_BASE}/lead/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          campaign_id: campaignId,
          skip_if_in_workspace: true,
          leads: [{
            email: lead.email,
            first_name: firstName,
            last_name: lastName,
            company_name: lead.business_name || '',
            variables: {
              city: lead.city || '',
              phone: lead.phone || '',
            },
          }],
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error(`Instantly push error for lead ${lead.id}:`, errText);
        stats.errors++;
        continue;
      }

      // Update lead record
      await query(
        `UPDATE leads SET instantly_campaign_id = $1, email_status = 'sent', last_email_at = NOW(), updated_at = NOW() WHERE id = $2`,
        [campaignId, lead.id]
      );

      stats.pushed++;
    } catch (err) {
      console.error(`Instantly push error for lead ${lead.id}:`, err.message);
      stats.errors++;
    }
  }

  return stats;
}

/**
 * Push filtered leads to a campaign.
 */
async function pushFilteredLeads(filter, campaignId) {
  let rows;

  if (filter === 'has_email_not_sent') {
    const result = await query(
      "SELECT id FROM leads WHERE email IS NOT NULL AND email != '' AND (email_status = 'none' OR email_status IS NULL)"
    );
    rows = result.rows;
  } else {
    throw new Error(`Unknown push filter: ${filter}`);
  }

  if (rows.length === 0) {
    return { pushed: 0, skipped_no_email: 0, errors: 0 };
  }

  const leadIds = rows.map(r => r.id);
  return pushLeadsToCampaign(leadIds, campaignId);
}

module.exports = {
  getCampaigns,
  pushLeadsToCampaign,
  pushFilteredLeads,
};
