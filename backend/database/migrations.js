/**
 * Runtime PostgreSQL Migrations
 *
 * Runs on server startup. Idempotent — uses IF NOT EXISTS guards.
 * Adds MSP/ISP support columns and expands pipeline stages.
 */

const { query } = require('./pg');

const MIGRATIONS = [
  // MSP/ISP profile columns
  'ALTER TABLE leads ADD COLUMN IF NOT EXISTS estimated_locations INTEGER',
  'ALTER TABLE leads ADD COLUMN IF NOT EXISTS hardware_vendors TEXT',
  'ALTER TABLE leads ADD COLUMN IF NOT EXISTS manages_wifi BOOLEAN DEFAULT false',
  'ALTER TABLE leads ADD COLUMN IF NOT EXISTS geographic_reach VARCHAR(100)',
  'ALTER TABLE leads ADD COLUMN IF NOT EXISTS company_size VARCHAR(50)',
  'ALTER TABLE leads ADD COLUMN IF NOT EXISTS discovery_score INTEGER DEFAULT 0',
  'ALTER TABLE leads ADD COLUMN IF NOT EXISTS compatible_hardware BOOLEAN DEFAULT false',
  'ALTER TABLE leads ADD COLUMN IF NOT EXISTS deployment_timeline VARCHAR(100)',
  'ALTER TABLE leads ADD COLUMN IF NOT EXISTS auto_score INTEGER DEFAULT 0',
  'ALTER TABLE leads ADD COLUMN IF NOT EXISTS responded_to_outreach BOOLEAN DEFAULT false',
  'ALTER TABLE leads ADD COLUMN IF NOT EXISTS decision_maker_engaged BOOLEAN DEFAULT false',
];

// Pipeline stage CHECK constraint must be widened to allow the new stages
// (technical_review, contract_sent, onboarding, live). Drop and re-add.
const STAGE_CONSTRAINT_NAME = 'leads_pipeline_stage_check';

async function widenPipelineStageCheck() {
  // Find any existing CHECK constraint on pipeline_stage and drop it (name may vary)
  const { rows } = await query(`
    SELECT con.conname
    FROM pg_constraint con
    INNER JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'leads' AND con.contype = 'c'
  `);
  for (const row of rows) {
    // Only drop if it references pipeline_stage
    const { rows: defRows } = await query(
      `SELECT pg_get_constraintdef(oid) as def FROM pg_constraint WHERE conname = $1`,
      [row.conname]
    );
    const def = defRows[0]?.def || '';
    if (def.includes('pipeline_stage')) {
      try {
        await query(`ALTER TABLE leads DROP CONSTRAINT ${row.conname}`);
      } catch (e) {
        // ignore
      }
    }
  }

  // Re-add with expanded stage set
  try {
    await query(`
      ALTER TABLE leads ADD CONSTRAINT ${STAGE_CONSTRAINT_NAME}
      CHECK (pipeline_stage IN (
        'new', 'contacted', 'interested', 'meeting_booked',
        'closed', 'dead',
        'technical_review', 'contract_sent', 'onboarding', 'live'
      ))
    `);
  } catch (e) {
    // already exists or PG version older — log only
    if (!/already exists/i.test(e.message)) {
      console.warn('Pipeline stage constraint add warning:', e.message);
    }
  }
}

// Meeting recordings (separate from call recordings; same transcribe+analyze
// pipeline but tuned for MSP discovery calls).
const MEETINGS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS meeting_recordings (
    id SERIAL PRIMARY KEY,
    lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
    user_id INTEGER,
    audio_path TEXT,
    original_filename TEXT,
    duration_seconds INTEGER DEFAULT 0,
    transcript TEXT,
    ai_summary TEXT,
    ai_outcome TEXT,
    ai_locations_discussed TEXT,
    ai_hardware_mentioned TEXT,
    ai_interest_level INTEGER,
    ai_concerns TEXT,
    ai_next_steps TEXT,
    ai_timeline_discussed TEXT,
    ai_deal_potential TEXT,
    ai_suggested_stage TEXT,
    ai_suggested_notes TEXT,
    status TEXT DEFAULT 'uploading' CHECK(status IN ('uploading', 'transcribing', 'analyzing', 'complete', 'error')),
    error_message TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  )
`;

const MEETINGS_INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_meeting_recordings_lead_id ON meeting_recordings(lead_id)',
  'CREATE INDEX IF NOT EXISTS idx_meeting_recordings_created_at ON meeting_recordings(created_at)',
];

async function runMigrations() {
  console.log('Running runtime migrations...');

  for (const sql of MIGRATIONS) {
    try {
      await query(sql);
    } catch (e) {
      if (!/already exists|duplicate/i.test(e.message)) {
        console.warn('Migration warning:', e.message);
      }
    }
  }

  try {
    await query(MEETINGS_TABLE_SQL);
  } catch (e) {
    console.warn('meeting_recordings create warning:', e.message);
  }

  for (const idx of MEETINGS_INDEXES) {
    try {
      await query(idx);
    } catch (e) {
      // ignore
    }
  }

  try {
    await widenPipelineStageCheck();
  } catch (e) {
    console.warn('Pipeline stage constraint migration warning:', e.message);
  }

  // One-off data migration: normalize category names to the canonical
  // plural set. Idempotent — only matches the old values.
  const categoryUpdates = [
    // Spec'd: fitness centers + existing gyms collapse to "Gyms"
    { to: 'Gyms', match: ['fitness centers', 'fitness center', 'gym', 'gyms'] },
    // Plural canonicals: pre-existing data used "Bar" / "Restaurant" — line
    // them up with the new dropdown values so filtering works.
    { to: 'Bars', match: ['bar', 'bars'] },
    { to: 'Restaurants', match: ['restaurant', 'restaurants'] },
    // Casinos / Hotels / Hospitality all collapse into a single
    // "Gambling & Casinos" bucket.
    { to: 'Gambling & Casinos', match: [
      'casinos', 'casino', 'gambling & casinos', 'gambling and casinos',
      'gaming', 'gambling',
      'hotels', 'hotel', 'lodging', 'motels', 'resorts', 'resort',
      'hospitality', 'event venues', 'event venue',
    ]},
  ];

  for (const { to, match } of categoryUpdates) {
    try {
      const placeholders = match.map((_, i) => `$${i + 2}`).join(', ');
      await query(
        `UPDATE leads SET category = $1 WHERE LOWER(category) IN (${placeholders}) AND category <> $1`,
        [to, ...match]
      );
    } catch (e) {
      console.warn(`Category normalization to "${to}" warning:`, e.message);
    }
  }

  console.log('Runtime migrations complete.');
}

module.exports = { runMigrations };
