/**
 * Shared WHERE-clause builder used by GET /api/leads, the bulk-update /
 * bulk-delete endpoints, and the Instantly push-filtered endpoint. Keeping
 * one implementation guarantees that the row set a user *sees* in the lead
 * table is the same row set a bulk action operates on.
 */

// Split a query-string value into an array of distinct values. Accepts
// either a comma-separated string ("Bars,Restaurants") or an already-parsed
// array (Express does this when the same key appears multiple times).
function multi(value) {
  if (value === undefined || value === null || value === '') return [];
  const arr = Array.isArray(value) ? value : String(value).split(',');
  return arr.map(v => String(v).trim()).filter(Boolean);
}

// Build the shared WHERE clause. Supports multi-value filters: pass
// `category=A,B,C` to match any of A/B/C.
function buildLeadsWhere(qs, startIdx = 1) {
  const params = [];
  let idx = startIdx;
  let sql = '';

  const categories = multi(qs.category);
  if (categories.length === 1) {
    sql += ` AND category = $${idx++}`;
    params.push(categories[0]);
  } else if (categories.length > 1) {
    const placeholders = categories.map(() => `$${idx++}`).join(',');
    sql += ` AND category IN (${placeholders})`;
    params.push(...categories);
  }

  const stages = multi(qs.stage);
  if (stages.length === 1) {
    sql += ` AND pipeline_stage = $${idx++}`;
    params.push(stages[0]);
  } else if (stages.length > 1) {
    const placeholders = stages.map(() => `$${idx++}`).join(',');
    sql += ` AND pipeline_stage IN (${placeholders})`;
    params.push(...stages);
  }

  const priorities = multi(qs.priority);
  if (priorities.length > 0) {
    // Treat "None" as either NULL or the literal string "None"
    const wantsNone = priorities.some(p => p.toLowerCase() === 'none');
    const named = priorities.filter(p => p.toLowerCase() !== 'none');
    const clauses = [];
    if (named.length > 0) {
      const placeholders = named.map(() => `$${idx++}`).join(',');
      clauses.push(`priority IN (${placeholders})`);
      params.push(...named);
    }
    if (wantsNone) {
      clauses.push(`(priority IS NULL OR priority = '' OR LOWER(priority) = 'none')`);
    }
    sql += ` AND (${clauses.join(' OR ')})`;
  }

  if (qs.score_min) {
    sql += ` AND lead_score >= $${idx++}`;
    params.push(Number(qs.score_min));
  }
  if (qs.score_max) {
    sql += ` AND lead_score <= $${idx++}`;
    params.push(Number(qs.score_max));
  }
  if (qs.date_from) {
    sql += ` AND created_at >= $${idx++}`;
    params.push(qs.date_from);
  }
  if (qs.date_to) {
    sql += ` AND created_at <= $${idx++}`;
    params.push(qs.date_to);
  }

  const emailStatuses = multi(qs.email_status);
  if (emailStatuses.length > 0) {
    const clauses = [];
    const named = [];
    for (const v of emailStatuses) {
      if (v === 'no_email') {
        clauses.push(`(email IS NULL OR email = '')`);
      } else if (v === 'has_email') {
        clauses.push(`(email IS NOT NULL AND email <> '')`);
      } else {
        named.push(v);
      }
    }
    if (named.length > 0) {
      const placeholders = named.map(() => `$${idx++}`).join(',');
      clauses.push(`email_status IN (${placeholders})`);
      params.push(...named);
    }
    sql += ` AND (${clauses.join(' OR ')})`;
  }

  if (qs.attempts) {
    if (qs.attempts === '0') {
      sql += ` AND COALESCE(contact_attempts, 0) = 0`;
    } else if (qs.attempts === '1-3') {
      sql += ` AND contact_attempts BETWEEN 1 AND 3`;
    } else if (qs.attempts === '4+') {
      sql += ` AND contact_attempts >= 4`;
    }
  }
  if (qs.search) {
    sql += ` AND (
      business_name ILIKE $${idx} OR
      address ILIKE $${idx} OR
      owner_name ILIKE $${idx} OR
      contact_name ILIKE $${idx} OR
      contact_title ILIKE $${idx} OR
      email ILIKE $${idx} OR
      city ILIKE $${idx}
    )`;
    params.push(`%${qs.search}%`);
    idx++;
  }

  return { sql, params, nextIdx: idx };
}

// Translate the camelCase filter payload sent by the frontend's selectAll
// flow into the query-string shape buildLeadsWhere expects.
function selectAllFiltersToQs(filters) {
  if (!filters || typeof filters !== 'object') return {};
  const qs = {};
  if (filters.category !== undefined) qs.category = filters.category;
  if (filters.stage !== undefined) qs.stage = filters.stage;
  if (filters.priority !== undefined) qs.priority = filters.priority;
  if (filters.emailStatus !== undefined) qs.email_status = filters.emailStatus;
  if (filters.search !== undefined && filters.search !== '') qs.search = filters.search;
  if (filters.scoreMin !== undefined && filters.scoreMin !== '' && filters.scoreMin !== null) qs.score_min = filters.scoreMin;
  if (filters.scoreMax !== undefined && filters.scoreMax !== '' && filters.scoreMax !== null) qs.score_max = filters.scoreMax;
  if (filters.attempts !== undefined && filters.attempts !== '') qs.attempts = filters.attempts;
  return qs;
}

module.exports = {
  multi,
  buildLeadsWhere,
  selectAllFiltersToQs,
};
