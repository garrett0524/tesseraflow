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

// GET /api/leads - List all leads with filters
router.get('/', async (req, res) => {
  try {
    let sql = 'SELECT * FROM leads WHERE 1=1';
    const params = [];
    let paramIdx = 1;

    if (req.query.category) {
      sql += ` AND category = $${paramIdx++}`;
      params.push(req.query.category);
    }
    if (req.query.stage) {
      sql += ` AND pipeline_stage = $${paramIdx++}`;
      params.push(req.query.stage);
    }
    if (req.query.score_min) {
      sql += ` AND lead_score >= $${paramIdx++}`;
      params.push(Number(req.query.score_min));
    }
    if (req.query.score_max) {
      sql += ` AND lead_score <= $${paramIdx++}`;
      params.push(Number(req.query.score_max));
    }
    if (req.query.date_from) {
      sql += ` AND created_at >= $${paramIdx++}`;
      params.push(req.query.date_from);
    }
    if (req.query.date_to) {
      sql += ` AND created_at <= $${paramIdx++}`;
      params.push(req.query.date_to);
    }
    if (req.query.search) {
      sql += ` AND (business_name ILIKE $${paramIdx} OR address ILIKE $${paramIdx} OR owner_name ILIKE $${paramIdx})`;
      params.push(`%${req.query.search}%`);
      paramIdx++;
    }

    sql += ' ORDER BY created_at DESC';

    if (req.query.limit) {
      sql += ` LIMIT $${paramIdx++}`;
      params.push(Number(req.query.limit));
    }
    if (req.query.offset) {
      sql += ` OFFSET $${paramIdx++}`;
      params.push(Number(req.query.offset));
    }

    const { rows: leads } = await query(sql, params);

    // Get total count for pagination
    let countSql = 'SELECT COUNT(*) as total FROM leads WHERE 1=1';
    const countParams = [];
    let countIdx = 1;
    if (req.query.category) {
      countSql += ` AND category = $${countIdx++}`;
      countParams.push(req.query.category);
    }
    if (req.query.stage) {
      countSql += ` AND pipeline_stage = $${countIdx++}`;
      countParams.push(req.query.stage);
    }
    const { rows: [countResult] } = await query(countSql, countParams);

    res.json({
      data: leads,
      total: countResult ? parseInt(countResult.total) : leads.length
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch leads', message: err.message });
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

        // Support both TesseraFlow and Apollo CSV column names.
        // Apollo exports with capitalized headers like "Company Name"; the parser
        // keeps both the original-case key and a normalized lowercase form.
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

        const technologies = pick('Technologies', 'technologies');
        const baseNotes = pick('notes', 'Notes');
        const noteParts = [];
        if (baseNotes) noteParts.push(baseNotes);
        if (technologies) noteParts.push(`Technologies: ${technologies}`);

        const lead = {
          business_name: pick(
            'Company Name', 'Company Name for Emails',
            'business_name', 'name', 'businessname', 'name_for_emails',
            'company', 'company_name', 'companyname', 'companynameforemails'
          ),
          category: pick('Industry', 'industry', 'category', 'type', 'subtypes'),
          address: pick('Company Address', 'address', 'full_address', 'street', 'companyaddress'),
          city: pick('Company City', 'city', 'town', 'companycity'),
          state: pick('Company State', 'state', 'state_code', 'companystate') || 'NY',
          zip: pick('zip', 'zipcode', 'postal', 'postal_code'),
          country: pick('Company Country', 'country', 'companycountry'),
          phone: pick(
            'Company Phone', 'Corporate Phone',
            'phone', 'phone_number', 'corporate_phone',
            'companyphone', 'corporatephone'
          ),
          direct_phone: pick(
            'Work Direct Phone', 'Mobile Phone',
            'direct_phone', 'mobile_phone', 'personal_phone',
            'workdirectphone', 'mobilephone'
          ),
          website: pick('Website', 'website', 'url', 'company_website'),
          google_rating: parseFloat(pick('google_rating', 'rating')) || null,
          review_count: parseInt(pick('review_count', 'reviews'), 10) || 0,
          place_id: pick('place_id', 'placeid'),
          owner_name: pick('owner_name', 'owner', 'contact', 'owner_title'),
          email: pick('Email', 'email', 'email_address'),
          contact_name: pick('contact_name', 'name') || combinedName,
          contact_title: pick('Title', 'contact_title', 'title'),
          company_size: mapEmployeeCount(pick('# Employees', 'employees', 'company_size')),
          linkedin_url: pick(
            'Person Linkedin Url', 'Person LinkedIn Url',
            'personlinkedinurl', 'person_linkedin_url', 'linkedin_url'
          ),
          notes: noteParts.length > 0 ? noteParts.join('\n') : null,
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

        // Check for existing lead by place_id OR by business_name + city (for Apollo merge)
        let existingId = null;
        if (lead.place_id) {
          const { rows: [existing] } = await query('SELECT id FROM leads WHERE place_id = $1', [lead.place_id]);
          if (existing) existingId = existing.id;
        }
        if (!existingId && lead.business_name && lead.city) {
          const { rows: [existing] } = await query(
            'SELECT id FROM leads WHERE LOWER(business_name) = LOWER($1) AND LOWER(city) = LOWER($2) LIMIT 1',
            [lead.business_name, lead.city]
          );
          if (existing) existingId = existing.id;
        }

        if (existingId) {
          // Update existing lead with new email/contact info (merge)
          const updateFields = [];
          const updateParams = [];
          let pIdx = 1;
          if (lead.email) { updateFields.push(`email = $${pIdx++}`); updateParams.push(lead.email); }
          if (lead.contact_name) { updateFields.push(`contact_name = $${pIdx++}`); updateParams.push(lead.contact_name); }
          if (lead.contact_title) { updateFields.push(`contact_title = $${pIdx++}`); updateParams.push(lead.contact_title); }
          if (lead.direct_phone) { updateFields.push(`direct_phone = $${pIdx++}`); updateParams.push(lead.direct_phone); }
          if (lead.phone && !lead.direct_phone) { updateFields.push(`phone = $${pIdx++}`); updateParams.push(lead.phone); }
          if (lead.country) { updateFields.push(`country = $${pIdx++}`); updateParams.push(lead.country); }
          if (lead.company_size) { updateFields.push(`company_size = $${pIdx++}`); updateParams.push(lead.company_size); }
          if (lead.linkedin_url) { updateFields.push(`linkedin_url = $${pIdx++}`); updateParams.push(lead.linkedin_url); }
          if (lead.notes) {
            updateFields.push(`notes = CASE WHEN notes IS NULL OR notes = '' THEN $${pIdx} ELSE notes || E'\\n' || $${pIdx} END`);
            updateParams.push(lead.notes);
            pIdx++;
          }
          if (updateFields.length > 0) {
            updateFields.push('updated_at = NOW()');
            updateParams.push(existingId);
            await query(`UPDATE leads SET ${updateFields.join(', ')} WHERE id = $${pIdx}`, updateParams);
            updated++;
          } else {
            skipped++;
          }
          continue;
        }

        const { rows: [inserted] } = await query(
          `INSERT INTO leads (business_name, category, address, city, state, zip, country,
            phone, website, google_rating, review_count, place_id, owner_name,
            email, contact_name, contact_title, direct_phone,
            company_size, linkedin_url, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
           RETURNING id`,
          [
            lead.business_name, lead.category, lead.address, lead.city,
            lead.state, lead.zip, lead.country, lead.phone, lead.website,
            lead.google_rating, lead.review_count, lead.place_id, lead.owner_name,
            lead.email, lead.contact_name, lead.contact_title, lead.direct_phone,
            lead.company_size, lead.linkedin_url, lead.notes
          ]
        );

        if (inserted) await scoreLead(inserted.id);
        imported++;
      } catch (rowErr) {
        if (rowErr.message && rowErr.message.includes('unique')) {
          skipped++;
        } else {
          errors.push({ line: i + 2, error: String(rowErr.message || rowErr) });
        }
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

function mapEmployeeCount(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const str = String(raw).trim();
  // Pass through values that already look like a range (e.g. "51-200", "10001+")
  if (/^\d+\s*[-+]/.test(str) || /[a-z]/i.test(str)) return str;
  const n = parseInt(str.replace(/[^0-9]/g, ''), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n <= 10) return '1-10';
  if (n <= 50) return '11-50';
  if (n <= 200) return '51-200';
  if (n <= 500) return '201-500';
  if (n <= 1000) return '501-1000';
  if (n <= 5000) return '1001-5000';
  if (n <= 10000) return '5001-10000';
  return '10001+';
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
