/**
 * TesseraFlow Lead Scoring Engine
 *
 * Two-phase scoring (0-100 total):
 *   auto_score      (0-50) — derived automatically from lead data
 *   discovery_score (0-50) — set manually after a discovery call/meeting
 *
 * For MSP/ISP/IT/WISP categories, auto_score follows the MSP rubric.
 * For everything else (restaurants, bars, gyms) the legacy rubric runs
 * and is capped at 50 so the cumulative range stays 0-100.
 */

const { query } = require('../database/pg');

const MSP_CATEGORY_KEYWORDS = ['msp', 'isp', 'wisp', 'it service', 'managed service', 'managed it'];

function isMspCategory(category) {
  if (!category) return false;
  const cat = String(category).toLowerCase();
  return MSP_CATEGORY_KEYWORDS.some(k => cat.includes(k));
}

function parseCompanySize(raw) {
  if (raw === null || raw === undefined || raw === '') return 0;
  const str = String(raw).trim();
  // Handle ranges like "51-200", "200+", "1-10"
  const rangeMatch = str.match(/^(\d+)\s*-\s*(\d+)/);
  if (rangeMatch) return parseInt(rangeMatch[2], 10);
  const plusMatch = str.match(/^(\d+)\s*\+/);
  if (plusMatch) return parseInt(plusMatch[1], 10);
  const n = parseInt(str.replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

function isNearTermTimeline(timeline) {
  if (!timeline) return false;
  const t = String(timeline).toLowerCase();
  return t.includes('immediate') || t.includes('30');
}

/**
 * Phase 1: auto_score (0-50)
 * MSP rubric: has email (10), has website (5), company size 51+ (10),
 *             category MSP/ISP (10), responded to outreach (15)
 * Legacy rubric (non-MSP): existing scoring, capped at 50.
 */
function calculateAutoScore(lead, engagement = {}) {
  if (isMspCategory(lead.category)) {
    let score = 0;
    if (lead.email && String(lead.email).trim() !== '') score += 10;
    if (lead.website && String(lead.website).trim() !== '') score += 5;
    if (parseCompanySize(lead.company_size) >= 51) score += 10;
    score += 10; // category is MSP/ISP
    if (lead.responded_to_outreach || engagement.email_replied || engagement.callback_requested) {
      score += 15;
    }
    return Math.min(50, score);
  }

  // Legacy (restaurant/bar/gym/etc) — capped at 50
  let score = 0;
  if (lead.category) {
    const cat = String(lead.category).toLowerCase();
    if (cat.includes('bar') || cat.includes('restaurant') || cat.includes('pub') ||
        cat.includes('tavern') || cat.includes('grill') || cat.includes('sports bar')) {
      score += 15;
    } else if (cat.includes('gym') || cat.includes('fitness') || cat.includes('crossfit') ||
               cat.includes('yoga') || cat.includes('martial')) {
      score += 15;
    } else if (cat.includes('casino') || cat.includes('gaming') || cat.includes('gambling')) {
      score += 15;
    } else if (cat.includes('hotel') || cat.includes('lodging') || cat.includes('resort') || cat.includes('hospitality')) {
      score += 15;
    } else {
      score += 5;
    }
  }
  if (lead.google_rating) {
    if (lead.google_rating >= 4.5) score += 10;
    else if (lead.google_rating >= 4.0) score += 7;
    else if (lead.google_rating >= 3.5) score += 3;
  }
  if (lead.review_count) {
    if (lead.review_count >= 100) score += 10;
    else if (lead.review_count >= 50) score += 6;
    else if (lead.review_count >= 20) score += 3;
  }
  if (lead.phone && String(lead.phone).trim() !== '') score += 5;
  if (lead.website && String(lead.website).trim() !== '') score += 5;
  if (lead.owner_name && String(lead.owner_name).trim() !== '') score += 5;
  if (engagement.callback_requested) score += 10;
  else if (engagement.email_replied) score += 7;
  else if (engagement.call_answered) score += 5;
  else if (engagement.email_opened) score += 2;

  return Math.min(50, score);
}

/**
 * Phase 2: discovery_score (0-50)
 * 50+ locations (15), compatible hardware (10), manages Wi-Fi (10),
 * decision maker engaged (10), near-term timeline (5).
 *
 * Returns the auto-calculated value. The DB column may have been
 * manually overridden — callers decide whether to overwrite.
 */
function calculateDiscoveryScore(lead) {
  let score = 0;
  if ((lead.estimated_locations || 0) >= 50) score += 15;
  if (lead.compatible_hardware) score += 10;
  if (lead.manages_wifi) score += 10;
  if (lead.decision_maker_engaged) score += 10;
  if (isNearTermTimeline(lead.deployment_timeline)) score += 5;
  return Math.min(50, score);
}

/**
 * Back-compat shim: callers may still pass calculateScore expecting 0-100.
 */
function calculateScore(lead, engagement = {}) {
  const auto = calculateAutoScore(lead, engagement);
  const discovery = (lead.discovery_score !== null && lead.discovery_score !== undefined)
    ? Number(lead.discovery_score) || 0
    : calculateDiscoveryScore(lead);
  return Math.min(100, auto + discovery);
}

async function scoreLead(leadId) {
  const { rows: [lead] } = await query('SELECT * FROM leads WHERE id = $1', [leadId]);
  if (!lead) return 0;

  const { rows: [callbackResult] } = await query("SELECT COUNT(*) as count FROM call_log WHERE lead_id = $1 AND outcome = 'callback'", [leadId]);
  const { rows: [callAnsweredResult] } = await query("SELECT COUNT(*) as count FROM call_log WHERE lead_id = $1 AND outcome IN ('interested', 'not_interested', 'callback')", [leadId]);
  const { rows: [emailRepliedResult] } = await query("SELECT COUNT(*) as count FROM email_log WHERE lead_id = $1 AND status = 'replied'", [leadId]);
  const { rows: [emailOpenedResult] } = await query("SELECT COUNT(*) as count FROM email_log WHERE lead_id = $1 AND status IN ('opened', 'replied')", [leadId]);

  const engagement = {
    callback_requested: parseInt(callbackResult?.count || 0) > 0,
    call_answered: parseInt(callAnsweredResult?.count || 0) > 0,
    email_replied: parseInt(emailRepliedResult?.count || 0) > 0,
    email_opened: parseInt(emailOpenedResult?.count || 0) > 0,
  };

  const autoScore = calculateAutoScore(lead, engagement);

  // discovery_score is manually authoritative if set above zero; otherwise
  // compute from current data.
  const storedDiscovery = lead.discovery_score === null || lead.discovery_score === undefined
    ? null
    : Number(lead.discovery_score);
  const computedDiscovery = calculateDiscoveryScore(lead);
  const discoveryScore = storedDiscovery && storedDiscovery > 0 ? storedDiscovery : computedDiscovery;

  const total = Math.min(100, autoScore + discoveryScore);

  await query(
    "UPDATE leads SET auto_score = $1, discovery_score = $2, lead_score = $3, updated_at = NOW() WHERE id = $4",
    [autoScore, discoveryScore, total, leadId]
  );

  return total;
}

async function scoreAllLeads() {
  const { rows: leads } = await query('SELECT id FROM leads');
  let updated = 0;

  for (const lead of leads) {
    await scoreLead(lead.id);
    updated++;
  }

  return { updated, total: leads.length };
}

module.exports = {
  calculateScore,
  calculateAutoScore,
  calculateDiscoveryScore,
  scoreLead,
  scoreAllLeads,
  isMspCategory,
};
