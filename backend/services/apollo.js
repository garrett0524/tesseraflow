/**
 * Apollo.io Integration Service
 *
 * Enriches leads with contact information (name, email, title, phone)
 * using Apollo's People Search API. Supports single and bulk enrichment.
 */

const { query } = require('../database/pg');

const APOLLO_BASE = 'https://api.apollo.io/api/v1';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Reads the Apollo API key from the settings table.
 * @returns {Promise<string>} The API key
 * @throws {Error} If the key is not configured
 */
async function getApiKey() {
  const { rows: [setting] } = await query(
    "SELECT value FROM settings WHERE key = 'apollo_api_key'"
  );
  const key = setting?.value;
  if (!key) {
    throw new Error(
      'Apollo API key not configured. Add it in Settings > Integrations.'
    );
  }
  return key;
}

/**
 * Small utility – pause execution for `ms` milliseconds.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// enrichLead – single lead enrichment
// ---------------------------------------------------------------------------

/**
 * Enrich a single lead by querying Apollo's People Search API.
 *
 * @param {number} leadId - The leads.id to enrich
 * @returns {Promise<object>} The enrichment result
 */
async function enrichLead(leadId) {
  const apiKey = await getApiKey();

  // 1. Read the lead from the database
  const { rows: [lead] } = await query(
    'SELECT id, business_name, city, address, website FROM leads WHERE id = $1',
    [leadId]
  );

  if (!lead) {
    throw new Error(`Lead with id ${leadId} not found.`);
  }

  // 2. Call Apollo People Search API (key in header per Apollo docs)
  const searchBody = {
    q_organization_name: lead.business_name,
    person_locations: [
      `${lead.city || 'New York'}, New York`,
    ],
    person_titles: [
      'owner',
      'general manager',
      'manager',
      'proprietor',
      'partner',
    ],
    page: 1,
    per_page: 5,
  };

  const response = await fetch(`${APOLLO_BASE}/mixed_people/api_search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': apiKey,
    },
    body: JSON.stringify(searchBody),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Apollo API error (${response.status}): ${errorBody}`
    );
  }

  const data = await response.json();
  const people = data.people || [];

  if (people.length === 0) {
    return { found: false, leadId };
  }

  // 3. Take the best match (first result)
  const person = people[0];
  const contactName = [person.first_name, person.last_name]
    .filter(Boolean)
    .join(' ');
  const contactEmail = person.email || null;
  const contactTitle = person.title || null;
  const contactPhone = person.direct_phone || person.mobile_phone || null;
  const apolloId = person.id || null;

  // 4. Update the lead in the database
  const { rows: [updated] } = await query(
    `UPDATE leads
        SET email       = COALESCE($1, email),
            contact_name  = COALESCE($2, contact_name),
            contact_title = COALESCE($3, contact_title),
            direct_phone  = COALESCE($4, direct_phone),
            apollo_id     = $5,
            enriched_at   = NOW(),
            updated_at    = NOW()
      WHERE id = $6
      RETURNING *`,
    [contactEmail, contactName, contactTitle, contactPhone, apolloId, leadId]
  );

  return {
    found: true,
    leadId,
    contact_name: contactName,
    email: contactEmail,
    contact_title: contactTitle,
    direct_phone: contactPhone,
    apollo_id: apolloId,
    lead: updated,
  };
}

// ---------------------------------------------------------------------------
// enrichBulk – batch enrichment with rate-limit pacing
// ---------------------------------------------------------------------------

/**
 * Enrich multiple leads in batches of 10 with a 1-second delay between
 * batches to stay within Apollo rate limits.
 *
 * @param {object}   options
 * @param {number[]} [options.leadIds]  - Explicit list of lead IDs to enrich
 * @param {string}   [options.filter]   - Preset filter: "no_email" | "high_score"
 * @returns {Promise<object>} Summary counts
 */
async function enrichBulk({ leadIds, filter } = {}) {
  // Ensure the API key is valid before we start a long batch
  await getApiKey();

  // 1. Determine which leads to process
  let leads;

  if (leadIds && leadIds.length > 0) {
    const { rows } = await query(
      'SELECT id, email FROM leads WHERE id = ANY($1) ORDER BY id',
      [leadIds]
    );
    leads = rows;
  } else if (filter === 'no_email') {
    const { rows } = await query(
      "SELECT id, email FROM leads WHERE email IS NULL OR email = '' ORDER BY id"
    );
    leads = rows;
  } else if (filter === 'high_score') {
    const { rows } = await query(
      "SELECT id, email FROM leads WHERE lead_score >= 70 AND (email IS NULL OR email = '') ORDER BY id"
    );
    leads = rows;
  } else {
    throw new Error(
      'enrichBulk requires either a leadIds array or a filter ("no_email" | "high_score").'
    );
  }

  // 2. Process in batches of 10
  const BATCH_SIZE = 10;
  const stats = { enriched: 0, not_found: 0, already_had_email: 0, errors: 0 };

  for (let i = 0; i < leads.length; i += BATCH_SIZE) {
    // Pause between batches (skip pause before the first batch)
    if (i > 0) {
      await sleep(1000);
    }

    const batch = leads.slice(i, i + BATCH_SIZE);

    for (const lead of batch) {
      // Skip leads that already have an email (relevant when leadIds are explicit)
      if (lead.email && lead.email.trim() !== '') {
        stats.already_had_email++;
        continue;
      }

      try {
        const result = await enrichLead(lead.id);
        if (result.found) {
          stats.enriched++;
        } else {
          stats.not_found++;
        }
      } catch (err) {
        console.error(`Apollo enrichBulk error for lead ${lead.id}:`, err.message);
        stats.errors++;
      }
    }
  }

  return stats;
}

// ---------------------------------------------------------------------------
// checkStatus – validate Apollo API key
// ---------------------------------------------------------------------------

/**
 * Validates the stored Apollo API key by making a lightweight search request.
 *
 * @returns {Promise<{valid: boolean, message: string}>}
 */
async function checkStatus() {
  let apiKey;
  try {
    apiKey = await getApiKey();
  } catch {
    return { valid: false, message: 'Apollo API key is not configured.' };
  }

  try {
    const response = await fetch(`${APOLLO_BASE}/mixed_people/api_search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify({
        q_organization_name: 'Apollo.io',
        page: 1,
        per_page: 1,
      }),
    });

    if (response.ok) {
      return { valid: true, message: 'Apollo API key is valid and working.' };
    }

    const errorBody = await response.text();
    return {
      valid: false,
      message: `Apollo API returned ${response.status}: ${errorBody}`,
    };
  } catch (err) {
    return {
      valid: false,
      message: `Failed to reach Apollo API: ${err.message}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  enrichLead,
  enrichBulk,
  checkStatus,
};
