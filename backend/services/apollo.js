/**
 * Apollo.io Integration Service
 *
 * Enriches leads with contact information (name, email, title, phone)
 * using Apollo's People Search API. Supports single and bulk enrichment.
 *
 * Nginx note: if proxying to this backend, add these timeouts to your
 * location block to avoid gateway timeouts during bulk enrichment:
 *
 *   proxy_read_timeout    120s;
 *   proxy_connect_timeout 120s;
 *   proxy_send_timeout    120s;
 */

const { query } = require('../database/pg');

const APOLLO_BASE = 'https://api.apollo.io/api/v1';
const FETCH_TIMEOUT_MS = 30_000; // 30 seconds per API call

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wrapper around fetch with a 30-second AbortController timeout.
 * Throws a clean error message on timeout instead of hanging.
 */
async function apolloFetch(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Apollo API request timed out after 30 seconds. Try again later.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extract a bare domain from a website URL.
 * "https://www.joesbar.com/menu" → "joesbar.com"
 */
function extractDomain(website) {
  if (!website) return null;
  try {
    let url = website.trim();
    if (!url.startsWith('http')) url = 'https://' + url;
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Extract the best person from an Apollo people array.
 */
function pickBestPerson(people) {
  if (!people || people.length === 0) return null;
  return people[0];
}

// ---------------------------------------------------------------------------
// Search strategies (each returns an array of people or [])
// ---------------------------------------------------------------------------

/**
 * Strategy 1: Search by company name + location + title keywords.
 * Best for businesses with a recognizable brand name in Apollo.
 */
async function searchByName(apiKey, lead) {
  const response = await apolloFetch(`${APOLLO_BASE}/mixed_people/api_search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': apiKey,
    },
    body: JSON.stringify({
      q_organization_name: lead.business_name,
      person_locations: [`${lead.city || 'New York'}, New York`],
      person_titles: ['owner', 'general manager', 'manager', 'proprietor', 'partner'],
      page: 1,
      per_page: 5,
    }),
  });

  if (!response.ok) return [];
  const data = await response.json();
  return data.people || [];
}

/**
 * Strategy 2: Search by company domain (extracted from the lead's website).
 * Drops the title filter to cast a wider net — many small businesses
 * list contacts without formal titles in Apollo.
 */
async function searchByDomain(apiKey, lead) {
  const domain = extractDomain(lead.website);
  if (!domain) return [];

  const response = await apolloFetch(`${APOLLO_BASE}/mixed_people/api_search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': apiKey,
    },
    body: JSON.stringify({
      q_organization_domains: domain,
      person_locations: [`${lead.city || 'New York'}, New York`],
      page: 1,
      per_page: 5,
    }),
  });

  if (!response.ok) return [];
  const data = await response.json();
  return data.people || [];
}

/**
 * Strategy 3: Use the organization enrichment endpoint to find the company
 * first, then grab any associated contacts. Works for businesses that have
 * an Apollo org record but whose people aren't indexed by name search.
 */
async function searchByOrgEnrichment(apiKey, lead) {
  const domain = extractDomain(lead.website);

  // Try org enrichment by domain first, fall back to name
  const orgBody = domain
    ? { domain }
    : { name: lead.business_name };

  const orgResponse = await apolloFetch(`${APOLLO_BASE}/organizations/enrich`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': apiKey,
    },
    body: JSON.stringify(orgBody),
  });

  if (!orgResponse.ok) return [];
  const orgData = await orgResponse.json();
  const org = orgData.organization;
  if (!org || !org.id) return [];

  // Now search for people at this org ID
  const peopleResponse = await apolloFetch(`${APOLLO_BASE}/mixed_people/api_search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': apiKey,
    },
    body: JSON.stringify({
      organization_ids: [org.id],
      page: 1,
      per_page: 5,
    }),
  });

  if (!peopleResponse.ok) return [];
  const peopleData = await peopleResponse.json();
  return peopleData.people || [];
}

// ---------------------------------------------------------------------------
// enrichLead – single lead enrichment with fallback strategies
// ---------------------------------------------------------------------------

async function enrichLead(leadId) {
  const apiKey = await getApiKey();

  const { rows: [lead] } = await query(
    'SELECT id, business_name, city, address, website FROM leads WHERE id = $1',
    [leadId]
  );

  if (!lead) {
    throw new Error(`Lead with id ${leadId} not found.`);
  }

  // Try strategies in order: name search → domain search → org enrichment
  let people = await searchByName(apiKey, lead);

  if (people.length === 0) {
    people = await searchByDomain(apiKey, lead);
  }

  if (people.length === 0) {
    people = await searchByOrgEnrichment(apiKey, lead);
  }

  const person = pickBestPerson(people);

  if (!person) {
    return { found: false, leadId };
  }

  const contactName = [person.first_name, person.last_name]
    .filter(Boolean)
    .join(' ');
  const contactEmail = person.email || null;
  const contactTitle = person.title || null;
  const contactPhone = person.direct_phone || person.mobile_phone || null;
  const apolloId = person.id || null;

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

async function enrichBulk({ leadIds, filter } = {}) {
  await getApiKey();

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

  const BATCH_SIZE = 10;
  const stats = { enriched: 0, not_found: 0, already_had_email: 0, errors: 0 };

  for (let i = 0; i < leads.length; i += BATCH_SIZE) {
    if (i > 0) {
      await sleep(1000);
    }

    const batch = leads.slice(i, i + BATCH_SIZE);

    for (const lead of batch) {
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

async function checkStatus() {
  let apiKey;
  try {
    apiKey = await getApiKey();
  } catch {
    return { valid: false, message: 'Apollo API key is not configured.' };
  }

  try {
    const response = await apolloFetch(`${APOLLO_BASE}/mixed_people/api_search`, {
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
