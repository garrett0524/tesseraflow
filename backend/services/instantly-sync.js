/**
 * Instantly.ai Email Status Sync Service (v2 API)
 *
 * Syncs email statuses from Instantly campaigns back to TesseraFlow leads.
 * Handles both manual sync and webhook-based real-time updates.
 * API key passed via Authorization header (Bearer token).
 */

const { query } = require('../database/pg');

const INSTANTLY_BASE = 'https://api.instantly.ai/api/v2';

async function getApiKey() {
  const { rows: [setting] } = await query("SELECT value FROM settings WHERE key = 'instantly_api_key'");
  return setting?.value || null;
}

/**
 * Sync email statuses from Instantly for all leads that have been pushed to a campaign.
 * v2: POST /leads/list with body { campaign_id, search }
 */
async function syncEmailStatuses() {
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error('Instantly.ai API key not configured.');
  }

  // Get all leads that have been pushed to a campaign
  const { rows: leads } = await query(
    "SELECT id, email, instantly_campaign_id, email_status, pipeline_stage FROM leads WHERE instantly_campaign_id IS NOT NULL AND email IS NOT NULL AND email != ''"
  );

  const stats = { synced: 0, updated: 0, errors: 0 };

  for (const lead of leads) {
    try {
      const response = await fetch(`${INSTANTLY_BASE}/leads/list`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          campaign_id: lead.instantly_campaign_id,
          search: lead.email,
          limit: 1,
        }),
      });
      if (!response.ok) {
        stats.errors++;
        continue;
      }

      const data = await response.json();
      const leadData = data.items?.[0] || data.data?.[0] || (Array.isArray(data) ? data[0] : data);
      if (!leadData || (Array.isArray(leadData) && leadData.length === 0)) {
        continue;
      }
      stats.synced++;

      // Determine new status from Instantly data
      let newStatus = lead.email_status;
      if (leadData.replied || leadData.has_replied) {
        newStatus = 'replied';
      } else if (leadData.bounced || leadData.has_bounced) {
        newStatus = 'bounced';
      } else if (leadData.opened || leadData.has_opened) {
        newStatus = 'opened';
      } else if (leadData.sent || leadData.email_sent) {
        newStatus = 'sent';
      }

      if (newStatus !== lead.email_status) {
        const updates = [`email_status = $1`, `updated_at = NOW()`];
        const params = [newStatus];
        let paramIdx = 2;

        // Auto-update pipeline stage when replied
        if (newStatus === 'replied' && (lead.pipeline_stage === 'new' || lead.pipeline_stage === 'contacted')) {
          updates.push(`pipeline_stage = $${paramIdx++}`);
          params.push('interested');
        }

        params.push(lead.id);
        await query(`UPDATE leads SET ${updates.join(', ')} WHERE id = $${paramIdx}`, params);
        stats.updated++;
      }
    } catch (err) {
      console.error(`Instantly sync error for lead ${lead.id}:`, err.message);
      stats.errors++;
    }
  }

  return stats;
}

/**
 * Handle incoming Instantly webhook events.
 */
async function handleWebhook(payload) {
  if (!payload || !payload.email) {
    return { processed: false, reason: 'No email in payload' };
  }

  const eventType = payload.event_type || payload.event || '';
  const email = payload.email;

  // Find lead by email
  const { rows: [lead] } = await query(
    'SELECT id, email_status, pipeline_stage FROM leads WHERE email = $1',
    [email]
  );

  if (!lead) {
    return { processed: false, reason: 'Lead not found for email' };
  }

  let newStatus = lead.email_status;

  if (eventType.includes('replied') || eventType.includes('reply')) {
    newStatus = 'replied';
  } else if (eventType.includes('bounced') || eventType.includes('bounce')) {
    newStatus = 'bounced';
  } else if (eventType.includes('opened') || eventType.includes('open')) {
    newStatus = 'opened';
  } else if (eventType.includes('sent')) {
    newStatus = 'sent';
  }

  if (newStatus !== lead.email_status) {
    const updates = [`email_status = $1`, `updated_at = NOW()`];
    const params = [newStatus];
    let paramIdx = 2;

    // Auto-update pipeline stage when replied (align with manual sync logic)
    if (newStatus === 'replied' && (lead.pipeline_stage === 'new' || lead.pipeline_stage === 'contacted')) {
      updates.push(`pipeline_stage = $${paramIdx++}`);
      params.push('interested');
    }

    params.push(lead.id);
    await query(`UPDATE leads SET ${updates.join(', ')} WHERE id = $${paramIdx}`, params);
  }

  return { processed: true, lead_id: lead.id, new_status: newStatus };
}

/**
 * Sync sent emails from Instantly's Unibox into the local email_log so the
 * Email Hub log isn't blank. v2: GET /emails?email_type=sent (paginated).
 * Matches each email to a lead by recipient address; rows whose recipient
 * doesn't map to a lead are skipped (counted in no_lead_match).
 */
async function syncEmailLog({ maxPages = 20, pageLimit = 100 } = {}) {
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error('Instantly.ai API key not configured.');
  }

  const stats = { fetched: 0, inserted: 0, updated: 0, no_lead_match: 0, errors: 0 };
  let startingAfter = null;

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      limit: String(pageLimit),
      email_type: 'sent',
    });
    if (startingAfter) params.set('starting_after', startingAfter);

    const response = await fetch(`${INSTANTLY_BASE}/emails?${params.toString()}`, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Instantly emails fetch failed (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const items = data.items || data.data || (Array.isArray(data) ? data : []);
    if (!items.length) break;
    stats.fetched += items.length;

    for (const email of items) {
      try {
        const messageId = email.id;
        if (!messageId) continue;

        const toRaw = email.to_address_email_list || email.to_address_email
          || (Array.isArray(email.to) ? email.to[0] : email.to);
        if (!toRaw) continue;

        // to_address_email_list can be "Name <addr@x>" or comma-separated
        const firstRecipient = String(toRaw).split(',')[0].trim();
        const angleMatch = firstRecipient.match(/<([^>]+)>/);
        const recipient = (angleMatch ? angleMatch[1] : firstRecipient).toLowerCase();
        if (!recipient) continue;

        const { rows: [lead] } = await query(
          'SELECT id FROM leads WHERE LOWER(email) = $1 LIMIT 1',
          [recipient]
        );
        if (!lead) {
          stats.no_lead_match++;
          continue;
        }

        const sentAt = email.timestamp_email || email.timestamp_created || new Date().toISOString();
        let status = 'sent';
        if (email.replied || email.is_reply) status = 'replied';
        else if (email.bounced) status = 'bounced';
        else if (email.opened) status = 'opened';

        const { rows: [existing] } = await query(
          'SELECT id, status FROM email_log WHERE instantly_message_id = $1',
          [messageId]
        );

        if (existing) {
          if (existing.status !== status) {
            await query(
              `UPDATE email_log SET status = $1 WHERE instantly_message_id = $2`,
              [status, messageId]
            );
            stats.updated++;
          }
        } else {
          await query(
            `INSERT INTO email_log (lead_id, instantly_message_id, status, sent_at, sequence_name, step_number)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [lead.id, messageId, status, sentAt, email.subject || null, email.step || null]
          );
          stats.inserted++;
        }
      } catch (err) {
        console.error('Instantly email log sync row error:', err.message);
        stats.errors++;
      }
    }

    const nextCursor = data.next_starting_after || data.starting_after;
    if (!nextCursor || items.length < pageLimit) break;
    startingAfter = nextCursor;
  }

  return stats;
}

module.exports = {
  syncEmailStatuses,
  syncEmailLog,
  handleWebhook,
};
