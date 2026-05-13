const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { query } = require('../database/pg');
const { scoreLead, scoreAllLeads } = require('../services/scoring');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Configure multer for CSV upload
const upload = multer({
  dest: path.join(__dirname, '..', '..', 'data', 'uploads'),
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  }
});

// Build the WHERE clause shared by list + count so the two stay in lockstep.
function buildLeadsWhere(qs, startIdx = 1) {
  const params = [];
  let idx = startIdx;
  let sql = '';

  if (qs.category) {
    sql += ` AND category = $${idx++}`;
    params.push(qs.category);
  }
  if (qs.stage) {
    sql += ` AND pipeline_stage = $${idx++}`;
    params.push(qs.stage);
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
  if (qs.email_status) {
    if (qs.email_status === 'no_email') {
      sql += ` AND (email IS NULL OR email = '')`;
    } else if (qs.email_status === 'has_email') {
      sql += ` AND email IS NOT NULL AND email <> ''`;
    } else {
      sql += ` AND email_status = $${idx++}`;
      params.push(qs.email_status);
    }
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

const SORTABLE_COLUMNS = new Set([
  'business_name', 'category', 'pipeline_stage', 'lead_score',
  'last_contact_date', 'contact_attempts', 'created_at',
  'estimated_locations',
]);

// GET /api/leads - List leads with filters + server-side pagination
router.get('/', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 50));
    const page = Math.max(1, Number(req.query.page) || 1);
    const offset = (page - 1) * limit;

    const sortField = SORTABLE_COLUMNS.has(req.query.sort) ? req.query.sort : 'created_at';
    const sortDir = String(req.query.sort_dir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const where = buildLeadsWhere(req.query, 1);
    const listSql = `SELECT * FROM leads WHERE 1=1${where.sql} ORDER BY ${sortField} ${sortDir} NULLS LAST, id DESC LIMIT $${where.nextIdx} OFFSET $${where.nextIdx + 1}`;
    const listParams = [...where.params, limit, offset];

    const countSql = `SELECT COUNT(*)::int AS total FROM leads WHERE 1=1${where.sql}`;

    const [{ rows: leads }, { rows: [countRow] }] = await Promise.all([
      query(listSql, listParams),
      query(countSql, where.params),
    ]);

    const total = countRow ? Number(countRow.total) : 0;
    const totalPages = Math.max(1, Math.ceil(total / limit));

    res.json({
      data: leads,
      total,
      page,
      limit,
      totalPages,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch leads', message: err.message });
  }
});

// GET /api/leads/kanban - Lightweight preview for the kanban: first N leads
// per stage plus the full per-stage count, in a single round-trip.
router.get('/kanban', async (req, res) => {
  try {
    const perStage = Math.max(1, Math.min(100, Number(req.query.per_stage) || 20));

    // Per-stage totals (drives Show More button visibility)
    const { rows: countRows } = await query(
      'SELECT pipeline_stage, COUNT(*)::int AS total FROM leads GROUP BY pipeline_stage'
    );
    const totals = {};
    for (const r of countRows) totals[r.pipeline_stage] = Number(r.total);

    // First N leads per stage, in one query via window function (PostgreSQL).
    // Only select the columns the kanban card actually renders to keep the
    // payload small for 200+ visible cards.
    const { rows: leads } = await query(
      `SELECT id, business_name, category, pipeline_stage, lead_score,
              contact_attempts, last_contact_date, created_at,
              estimated_locations, hardware_vendors
       FROM (
         SELECT l.*, ROW_NUMBER() OVER (
           PARTITION BY pipeline_stage ORDER BY created_at DESC, id DESC
         ) AS rn
         FROM leads l
       ) sub
       WHERE rn <= $1
       ORDER BY pipeline_stage, created_at DESC`,
      [perStage]
    );

    const byStage = {};
    for (const lead of leads) {
      if (!byStage[lead.pipeline_stage]) byStage[lead.pipeline_stage] = [];
      byStage[lead.pipeline_stage].push(lead);
    }

    res.json({
      data: byStage,
      totals,
      per_stage: perStage,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch kanban data', message: err.message });
  }
});

// GET /api/leads/by-stage/:stage - Paginated leads for a single stage
// (used by the kanban "Show more" button).
router.get('/by-stage/:stage', async (req, res) => {
  try {
    const stage = req.params.stage;
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 20));
    const page = Math.max(1, Number(req.query.page) || 1);
    const offset = (page - 1) * limit;

    const [{ rows: leads }, { rows: [countRow] }] = await Promise.all([
      query(
        `SELECT id, business_name, category, pipeline_stage, lead_score,
                contact_attempts, last_contact_date, created_at,
                estimated_locations, hardware_vendors
         FROM leads
         WHERE pipeline_stage = $1
         ORDER BY created_at DESC, id DESC
         LIMIT $2 OFFSET $3`,
        [stage, limit, offset]
      ),
      query('SELECT COUNT(*)::int AS total FROM leads WHERE pipeline_stage = $1', [stage]),
    ]);

    const total = countRow ? Number(countRow.total) : 0;
    res.json({
      data: leads,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stage', message: err.message });
  }
});

// GET /api/leads/:id - Single lead detail
router.get('/:id', async (req, res) => {
  try {
    const { rows: [lead] } = await query('SELECT * FROM leads WHERE id = $1', [Number(req.params.id)]);
    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const { rows: calls } = await query('SELECT * FROM call_log WHERE lead_id = $1 ORDER BY created_at DESC', [lead.id]);
    const { rows: emails } = await query('SELECT * FROM email_log WHERE lead_id = $1 ORDER BY sent_at DESC', [lead.id]);
    const { rows: outreach } = await query('SELECT * FROM outreach_queue WHERE lead_id = $1 ORDER BY created_at DESC', [lead.id]);

    res.json({ data: { ...lead, calls, emails, outreach } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch lead', message: err.message });
  }
});

// POST /api/leads - Create a new lead
router.post('/', async (req, res) => {
  try {
    const {
      business_name, category, address, city, state, zip,
      phone, website, google_rating, review_count, place_id,
      owner_name, pipeline_stage, lead_score, notes
    } = req.body;

    if (!business_name) {
      return res.status(400).json({ error: 'business_name is required' });
    }

    const { rows: [newRow] } = await query(
      `INSERT INTO leads (business_name, category, address, city, state, zip,
        phone, website, google_rating, review_count, place_id, owner_name,
        pipeline_stage, lead_score, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING id`,
      [
        business_name, category || null, address || null, city || null,
        state || 'NY', zip || null, phone || null, website || null,
        google_rating || null, review_count || 0, place_id || null,
        owner_name || null, pipeline_stage || 'new', lead_score || 0,
        notes || null
      ]
    );

    // Auto-calculate lead score
    await scoreLead(newRow.id);

    const { rows: [newLead] } = await query('SELECT * FROM leads WHERE id = $1', [newRow.id]);
    res.status(201).json({ data: newLead });
  } catch (err) {
    if (err.message && err.message.includes('unique')) {
      return res.status(409).json({ error: 'Lead with this place_id already exists' });
    }
    res.status(500).json({ error: 'Failed to create lead', message: err.message });
  }
});

// PUT /api/leads/:id - Update a lead
router.put('/:id', async (req, res) => {
  try {
    const { rows: [lead] } = await query('SELECT * FROM leads WHERE id = $1', [Number(req.params.id)]);
    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const fields = [
      'business_name', 'category', 'address', 'city', 'state', 'zip',
      'phone', 'website', 'google_rating', 'review_count', 'place_id',
      'owner_name', 'pipeline_stage', 'lead_score', 'contact_attempts',
      'last_contact_date', 'last_contact_method', 'notes',
      'email', 'contact_name', 'contact_title', 'direct_phone', 'apollo_id',
      'enriched_at', 'email_status', 'instantly_campaign_id', 'last_email_at',
      'country', 'company_size', 'linkedin_url',
      // MSP/ISP fields
      'estimated_locations', 'hardware_vendors', 'manages_wifi',
      'geographic_reach', 'discovery_score', 'compatible_hardware',
      'deployment_timeline', 'auto_score', 'responded_to_outreach',
      'decision_maker_engaged',
    ];

    const updates = [];
    const params = [];
    let paramIdx = 1;

    for (const field of fields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = $${paramIdx++}`);
        params.push(req.body[field]);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push('updated_at = NOW()');
    params.push(Number(req.params.id));

    await query(`UPDATE leads SET ${updates.join(', ')} WHERE id = $${paramIdx}`, params);

    // Auto-create calendar events when pipeline stage changes
    const newStage = req.body.pipeline_stage;
    const oldStage = lead.pipeline_stage;
    if (newStage && newStage !== oldStage) {
      try {
        await autoCreateCalendarFromStageChange(Number(req.params.id), lead, newStage, req.body.notes || lead.notes);
      } catch (calErr) {
        console.error('Calendar auto-creation from stage change failed:', calErr.message);
      }
    }

    // Re-score whenever any scoring inputs changed (auto OR discovery side)
    const scoringFields = [
      'category', 'email', 'website', 'company_size',
      'estimated_locations', 'compatible_hardware', 'manages_wifi',
      'deployment_timeline', 'responded_to_outreach', 'decision_maker_engaged',
      'discovery_score', 'pipeline_stage',
    ];
    const touchedScoring = scoringFields.some(f => req.body[f] !== undefined);
    if (touchedScoring) {
      try {
        await scoreLead(Number(req.params.id));
      } catch (e) {
        console.error('Auto-rescore on update failed:', e.message);
      }
    }

    const { rows: [updatedLead] } = await query('SELECT * FROM leads WHERE id = $1', [Number(req.params.id)]);
    res.json({ data: updatedLead });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update lead', message: err.message });
  }
});

// DELETE /api/leads/:id - Delete a lead (admin only)
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const { rows: [lead] } = await query('SELECT * FROM leads WHERE id = $1', [Number(req.params.id)]);
    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await query('DELETE FROM leads WHERE id = $1', [Number(req.params.id)]);
    res.json({ message: 'Lead deleted', data: lead });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete lead', message: err.message });
  }
});

// POST /api/leads/import - Bulk CSV import (admin only)
router.post('/import', requireAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No CSV file provided' });
    }

    const csvContent = fs.readFileSync(req.file.path, 'utf-8');
    const records = parseCSV(csvContent);

    if (records.length === 0) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'CSV file is empty or has no data rows' });
    }

    let imported = 0;
    let updated = 0;
    let skipped = 0;
    let errors = [];

    for (let i = 0; i < records.length; i++) {
      try {
        const row = records[i];

        // Apollo CSV column mapping. Only the fields below are imported —
        // anything else in the file is intentionally ignored so we never
        // insert into columns that don't exist on the leads table.
        const pick = (...keys) => {
          for (const k of keys) {
            const v = row[k];
            if (v !== undefined && v !== null && v !== '') return v;
          }
          return null;
        };

        const firstName = pick('First Name', 'first_name', 'firstname');
        const lastName = pick('Last Name', 'last_name', 'lastname');
        const combinedName = (firstName || lastName)
          ? `${firstName || ''} ${lastName || ''}`.trim()
          : null;

        const lead = {
          // "Company Name" / "Company Name for Emails" → business_name
          business_name: pick(
            'Company Name', 'Company Name for Emails',
            'business_name', 'name', 'businessname', 'name_for_emails',
            'company', 'company_name', 'companyname', 'companynameforemails'
          ),
          // "Industry" → category (normalized to MSP/ISP/IT Services/WISP when possible)
          category: mapIndustryToCategory(pick('Industry', 'industry', 'category')),
          // "Company Address" → address
          address: pick('Company Address', 'address', 'companyaddress'),
          // "Company City" → city
          city: pick('Company City', 'city', 'companycity'),
          // "Company State" → state
          state: pick('Company State', 'state', 'state_code', 'companystate') || 'NY',
          // "Company Phone" / "Corporate Phone" → phone
          phone: pick(
            'Company Phone', 'Corporate Phone',
            'phone', 'phone_number', 'corporate_phone',
            'companyphone', 'corporatephone'
          ),
          // "Work Direct Phone" / "Mobile Phone" → direct_phone
          direct_phone: pick(
            'Work Direct Phone', 'Mobile Phone',
            'direct_phone', 'mobile_phone',
            'workdirectphone', 'mobilephone'
          ),
          // "Website" → website
          website: pick('Website', 'website', 'url', 'company_website'),
          // "Email" → email
          email: pick('Email', 'email', 'email_address'),
          // "First Name" + "Last Name" → contact_name
          contact_name: pick('contact_name') || combinedName,
          // "Title" → contact_title
          contact_title: pick('Title', 'contact_title', 'title'),
          // "# Employees" → company_size (mapped to 1-10 | 11-50 | 51-200 | 200+)
          company_size: mapEmployeeCount(pick('# Employees', 'employees', 'company_size')),
        };

        if (!lead.business_name) {
          skipped++;
          continue;
        }

        if (lead.state && lead.state.length > 2) {
          if (row.state_code && row.state_code.length === 2) {
            lead.state = row.state_code;
          }
        }

        // Dedupe by business_name + city to merge Apollo rows for the same company
        let existingId = null;
        if (lead.business_name && lead.city) {
          const { rows: [existing] } = await query(
            'SELECT id FROM leads WHERE LOWER(business_name) = LOWER($1) AND LOWER(city) = LOWER($2) LIMIT 1',
            [lead.business_name, lead.city]
          );
          if (existing) existingId = existing.id;
        }

        if (existingId) {
          // Merge: only update fields we have new values for, and only fields
          // that map to real columns. No country/linkedin_url/technologies.
          const updateFields = [];
          const updateParams = [];
          let pIdx = 1;
          if (lead.email) { updateFields.push(`email = $${pIdx++}`); updateParams.push(lead.email); }
          if (lead.contact_name) { updateFields.push(`contact_name = $${pIdx++}`); updateParams.push(lead.contact_name); }
          if (lead.contact_title) { updateFields.push(`contact_title = $${pIdx++}`); updateParams.push(lead.contact_title); }
          if (lead.direct_phone) { updateFields.push(`direct_phone = $${pIdx++}`); updateParams.push(lead.direct_phone); }
          if (lead.phone) { updateFields.push(`phone = COALESCE(NULLIF(phone, ''), $${pIdx++})`); updateParams.push(lead.phone); }
          if (lead.website) { updateFields.push(`website = COALESCE(NULLIF(website, ''), $${pIdx++})`); updateParams.push(lead.website); }
          if (lead.address) { updateFields.push(`address = COALESCE(NULLIF(address, ''), $${pIdx++})`); updateParams.push(lead.address); }
          if (lead.category) { updateFields.push(`category = COALESCE(NULLIF(category, ''), $${pIdx++})`); updateParams.push(lead.category); }
          if (lead.company_size) { updateFields.push(`company_size = $${pIdx++}`); updateParams.push(lead.company_size); }
          if (updateFields.length > 0) {
            updateFields.push('updated_at = NOW()');
            updateParams.push(existingId);
            await query(`UPDATE leads SET ${updateFields.join(', ')} WHERE id = $${pIdx}`, updateParams);
            await scoreLead(existingId);
            updated++;
          } else {
            skipped++;
          }
          continue;
        }

        // Insert: only the 12 spec'd columns (+ state default). Anything else
        // is left to defaults so we don't touch optional columns that may not
        // exist on every install.
        const { rows: [inserted] } = await query(
          `INSERT INTO leads (
             business_name, category, address, city, state,
             phone, direct_phone, website, email,
             contact_name, contact_title, company_size
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           RETURNING id`,
          [
            lead.business_name, lead.category, lead.address, lead.city, lead.state,
            lead.phone, lead.direct_phone, lead.website, lead.email,
            lead.contact_name, lead.contact_title, lead.company_size,
          ]
        );

        if (inserted) await scoreLead(inserted.id);
        imported++;
      } catch (rowErr) {
        errors.push({ line: i + 2, error: String(rowErr.message || rowErr) });
      }
    }

    fs.unlinkSync(req.file.path);

    res.json({
      message: 'Import complete',
      imported,
      updated,
      skipped,
      errors: errors.length,
      errorDetails: errors.slice(0, 10)
    });
  } catch (err) {
    res.status(500).json({ error: 'Import failed', message: err.message });
  }
});

// GET /api/leads/export/csv - Export leads as CSV
router.get('/export/csv', async (req, res) => {
  try {
    const { rows: leads } = await query('SELECT * FROM leads ORDER BY created_at DESC');

    const headers = [
      'id', 'business_name', 'category', 'address', 'city', 'state', 'zip',
      'phone', 'website', 'google_rating', 'review_count', 'place_id',
      'owner_name', 'pipeline_stage', 'lead_score', 'contact_attempts',
      'last_contact_date', 'last_contact_method', 'notes',
      'email', 'contact_name', 'contact_title', 'direct_phone', 'email_status',
      'country', 'company_size', 'linkedin_url',
      'created_at'
    ];

    let csv = headers.join(',') + '\n';
    for (const lead of leads) {
      const row = headers.map(h => {
        const val = lead[h];
        if (val === null || val === undefined) return '';
        const str = String(val);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
      });
      csv += row.join(',') + '\n';
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=tesseraflow-leads.csv');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: 'Export failed', message: err.message });
  }
});

// POST /api/leads/rescore - Bulk re-score all leads (admin only)
router.post('/rescore', requireAdmin, async (req, res) => {
  try {
    const result = await scoreAllLeads();
    res.json({ message: `Re-scored ${result.updated} leads`, ...result });
  } catch (err) {
    res.status(500).json({ error: 'Re-scoring failed', message: err.message });
  }
});

/**
 * Auto-create calendar events when a lead's pipeline stage changes.
 */
async function autoCreateCalendarFromStageChange(leadId, lead, newStage, notes) {
  const businessName = lead.business_name || 'Unknown';
  const category = (lead.category || '').toLowerCase();
  const isGym = category.includes('gym') || category.includes('fitness') || category.includes('crossfit') || category.includes('yoga');
  const now = new Date();

  if (newStage === 'meeting_booked') {
    const nextBiz = getNextBusinessDay(now);
    const eventDate = formatDate(nextBiz);

    await query(
      `INSERT INTO calendar_events (lead_id, event_type, title, description, event_date, event_time, duration_minutes, auto_created)
       VALUES ($1, 'site_visit', $2, $3, $4, '10:00', 30, true)`,
      [
        leadId,
        `Site Visit: ${businessName}`,
        `Auto-created when lead moved to Meeting Booked stage. Please confirm date/time with lead.`,
        eventDate,
      ]
    );
    console.log(`Calendar: Created site visit event for ${businessName} on ${eventDate}`);
  }

  if (newStage === 'contacted') {
    const notesLower = (notes || '').toLowerCase();
    if (notesLower.includes('call back') || notesLower.includes('callback')) {
      const nextBiz = getNextBusinessDay(now);
      const eventDate = formatDate(nextBiz);
      const eventTime = isGym ? '10:00' : '14:00';

      await query(
        `INSERT INTO calendar_events (lead_id, event_type, title, description, event_date, event_time, duration_minutes, auto_created)
         VALUES ($1, 'callback', $2, $3, $4, $5, 15, true)`,
        [
          leadId,
          `Callback: ${businessName}`,
          'Auto-created when lead moved to Contacted stage with callback mention in notes.',
          eventDate,
          eventTime,
        ]
      );
      console.log(`Calendar: Created callback event for ${businessName} on ${eventDate}`);
    }
  }
}

function getNextBusinessDay(fromDate) {
  const d = new Date(fromDate);
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

function formatDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Map raw "# Employees" cell to one of the four MSP-profile ranges:
 * "1-10" | "11-50" | "51-200" | "200+". Apollo may export either a raw
 * number ("47") or a pre-formatted range ("11-50", "1,000-5,000").
 */
function mapEmployeeCount(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const str = String(raw).trim();

  // If it's already a range, extract the upper bound and re-bucket
  const rangeMatch = str.match(/(\d[\d,]*)\s*-\s*(\d[\d,]*)/);
  if (rangeMatch) {
    const upper = parseInt(rangeMatch[2].replace(/,/g, ''), 10);
    return bucketSize(upper);
  }

  // Pre-formatted "200+" / "10000+" / "5,000+"
  const plusMatch = str.match(/(\d[\d,]*)\s*\+/);
  if (plusMatch) {
    return bucketSize(parseInt(plusMatch[1].replace(/,/g, ''), 10));
  }

  // Plain number ("47" or "1,234")
  const n = parseInt(str.replace(/[^0-9]/g, ''), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return bucketSize(n);
}

function bucketSize(n) {
  if (n <= 10) return '1-10';
  if (n <= 50) return '11-50';
  if (n <= 200) return '51-200';
  return '200+';
}

/**
 * Normalize Apollo's free-text "Industry" to one of our known categories.
 * Falls back to the original value if nothing matches so the data is still
 * preserved (the user can filter on it from the table).
 */
function mapIndustryToCategory(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase();

  // MSP-style buckets — order matters: check the more specific ones first
  if (s.includes('managed services') || s.includes('managed it') || s.includes('msp')) return 'MSP';
  if (s.includes('wisp') || (s.includes('wireless') && s.includes('isp'))) return 'WISP';
  if (s.includes('internet service') || s.includes('isp') || s.includes('telecom') || s.includes('telecommunication') || s.includes('broadband')) return 'ISP';
  if (s.includes('information technology') || s.includes('it services') || s.includes('it consulting') || s.includes('computer & network') || s.includes('network security') || s.includes('computer networking')) return 'IT Services';

  // Hospitality / fitness fallbacks for non-MSP leads
  if (s.includes('restaurant') || s.includes('food & beverage')) return 'Restaurant';
  if (s.includes('bar') || s.includes('tavern') || s.includes('pub') || s.includes('nightclub')) return 'Bar';
  if (s.includes('gym') || s.includes('crossfit')) return 'Gym';
  if (s.includes('fitness') || s.includes('health, wellness') || s.includes('yoga') || s.includes('martial')) return 'Fitness Center';

  // Preserve the original value if it doesn't match any known bucket
  return String(raw).trim();
}

/**
 * RFC 4180-compliant CSV parser
 */
function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  const rows = [];
  let i = 0;
  const len = text.length;

  function parseField() {
    if (i >= len) return '';

    if (text[i] === '"') {
      i++;
      let field = '';
      while (i < len) {
        if (text[i] === '"') {
          if (i + 1 < len && text[i + 1] === '"') {
            field += '"';
            i += 2;
          } else {
            i++;
            break;
          }
        } else {
          field += text[i];
          i++;
        }
      }
      return field;
    }

    let field = '';
    while (i < len && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r') {
      field += text[i];
      i++;
    }
    return field;
  }

  function parseRow() {
    const fields = [];
    while (i < len) {
      fields.push(parseField());

      if (i >= len) break;
      if (text[i] === ',') {
        i++;
      } else {
        if (text[i] === '\r') i++;
        if (i < len && text[i] === '\n') i++;
        break;
      }
    }
    return fields;
  }

  const rawHeaders = parseRow();
  const headers = rawHeaders.map(h => {
    const original = h.trim();
    return {
      original,
      normalized: original.toLowerCase().replace(/[^a-z0-9_]/g, ''),
    };
  });

  while (i < len) {
    if (text[i] === '\n' || text[i] === '\r') {
      if (text[i] === '\r') i++;
      if (i < len && text[i] === '\n') i++;
      continue;
    }
    const values = parseRow();
    if (values.length === 0 || (values.length === 1 && values[0] === '')) continue;

    const obj = {};
    headers.forEach(({ original, normalized }, idx) => {
      const val = (idx < values.length && values[idx] !== '') ? values[idx] : null;
      obj[normalized] = val;
      if (original && original !== normalized) {
        obj[original] = val;
      }
    });
    rows.push(obj);
  }

  return rows;
}

module.exports = router;
