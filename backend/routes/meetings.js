const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { query } = require('../database/pg');
const { transcribeAudio } = require('../services/transcription');
const { analyzeMeetingTranscript } = require('../services/analysis');

const router = express.Router();

const MEETINGS_DIR = path.join(__dirname, '..', 'recordings', 'meetings');
if (!fs.existsSync(MEETINGS_DIR)) {
  fs.mkdirSync(MEETINGS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, MEETINGS_DIR),
  filename: (req, file, cb) => {
    const leadId = req.body.lead_id || 'unassigned';
    const timestamp = Date.now();
    const ext = path.extname(file.originalname) || '.mp3';
    cb(null, `meeting_${leadId}_${timestamp}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
  fileFilter: (req, file, cb) => {
    const ok = /\.(mp3|wav|m4a|webm|ogg|mp4)$/i.test(file.originalname)
      || /^audio\//.test(file.mimetype)
      || file.mimetype === 'video/mp4'
      || file.mimetype === 'video/webm';
    if (ok) cb(null, true);
    else cb(new Error('Only audio files (mp3, wav, m4a, webm) are allowed'));
  },
});

// GET /api/meetings — list all meeting recordings with lead info
router.get('/', async (req, res) => {
  try {
    const { rows: meetings } = await query(
      `SELECT m.*, l.business_name, l.category
       FROM meeting_recordings m
       LEFT JOIN leads l ON m.lead_id = l.id
       ORDER BY m.created_at DESC`
    );
    for (const m of meetings) {
      m.ai_concerns = safeParseJSON(m.ai_concerns, []);
      m.ai_next_steps = safeParseJSON(m.ai_next_steps, []);
    }
    res.json({ data: meetings });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch meetings', message: err.message });
  }
});

// GET /api/meetings/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows: [meeting] } = await query(
      `SELECT m.*, l.business_name, l.category
       FROM meeting_recordings m
       LEFT JOIN leads l ON m.lead_id = l.id
       WHERE m.id = $1`,
      [Number(req.params.id)]
    );
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    meeting.ai_concerns = safeParseJSON(meeting.ai_concerns, []);
    meeting.ai_next_steps = safeParseJSON(meeting.ai_next_steps, []);
    res.json({ data: meeting });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch meeting', message: err.message });
  }
});

// POST /api/meetings/upload
router.post('/upload', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No audio file provided' });

    const { lead_id } = req.body;
    const leadId = lead_id ? Number(lead_id) : null;

    if (leadId) {
      const { rows: [lead] } = await query('SELECT id FROM leads WHERE id = $1', [leadId]);
      if (!lead) {
        fs.unlinkSync(req.file.path);
        return res.status(404).json({ error: 'Lead not found' });
      }
    }

    const relativePath = path.relative(path.join(__dirname, '..'), req.file.path).replace(/\\/g, '/');

    const { rows: [created] } = await query(
      `INSERT INTO meeting_recordings (lead_id, user_id, audio_path, original_filename, status)
       VALUES ($1, $2, $3, $4, 'transcribing') RETURNING id`,
      [leadId, req.user ? req.user.id : null, relativePath, req.file.originalname]
    );

    const meetingId = created.id;
    const { rows: [meeting] } = await query('SELECT * FROM meeting_recordings WHERE id = $1', [meetingId]);
    res.status(201).json({ data: meeting });

    // Background pipeline
    processMeetingPipeline(meetingId, req.file.path);
  } catch (err) {
    if (req.file) {
      try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }
    }
    res.status(500).json({ error: 'Upload failed', message: err.message });
  }
});

// POST /api/meetings/:id/apply — push suggested stage and/or notes back to the lead
router.post('/:id/apply', async (req, res) => {
  try {
    const { rows: [meeting] } = await query('SELECT * FROM meeting_recordings WHERE id = $1', [Number(req.params.id)]);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    if (!meeting.lead_id) return res.status(400).json({ error: 'Meeting is not linked to a lead' });

    const { apply_stage, apply_notes } = req.body || {};

    if (apply_stage && meeting.ai_suggested_stage) {
      await query(
        "UPDATE leads SET pipeline_stage = $1, updated_at = NOW() WHERE id = $2",
        [meeting.ai_suggested_stage, meeting.lead_id]
      );
    }

    if (apply_notes && meeting.ai_suggested_notes) {
      const { rows: [lead] } = await query('SELECT notes FROM leads WHERE id = $1', [meeting.lead_id]);
      const currentNotes = lead ? (lead.notes || '') : '';
      const newNotes = currentNotes
        ? `${currentNotes}\n\n--- Meeting Notes (${new Date().toISOString().split('T')[0]}) ---\n${meeting.ai_suggested_notes}`
        : `--- Meeting Notes (${new Date().toISOString().split('T')[0]}) ---\n${meeting.ai_suggested_notes}`;
      await query(
        "UPDATE leads SET notes = $1, updated_at = NOW() WHERE id = $2",
        [newNotes, meeting.lead_id]
      );
    }

    const { rows: [updatedLead] } = await query('SELECT * FROM leads WHERE id = $1', [meeting.lead_id]);
    res.json({ message: 'Applied', data: updatedLead });
  } catch (err) {
    res.status(500).json({ error: 'Failed to apply', message: err.message });
  }
});

// DELETE /api/meetings/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rows: [meeting] } = await query('SELECT * FROM meeting_recordings WHERE id = $1', [Number(req.params.id)]);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

    if (meeting.audio_path) {
      const fullPath = path.join(__dirname, '..', meeting.audio_path);
      if (fs.existsSync(fullPath)) {
        try { fs.unlinkSync(fullPath); } catch (e) { /* ignore */ }
      }
    }
    await query('DELETE FROM meeting_recordings WHERE id = $1', [Number(req.params.id)]);
    res.json({ message: 'Meeting deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete', message: err.message });
  }
});

async function processMeetingPipeline(meetingId, audioPath) {
  try {
    const whisperModel = await getSettingValue('whisper_model_size', 'base');

    let transcriptResult;
    try {
      transcriptResult = await transcribeAudio(audioPath, whisperModel);
    } catch (err) {
      console.error('Meeting transcription failed:', err.message);
      await query(
        "UPDATE meeting_recordings SET status = 'error', error_message = $1 WHERE id = $2",
        [`Transcription failed: ${err.message}`, meetingId]
      );
      return;
    }

    await query(
      "UPDATE meeting_recordings SET transcript = $1, duration_seconds = $2, status = 'analyzing' WHERE id = $3",
      [transcriptResult.transcript, transcriptResult.duration, meetingId]
    );

    const apiKey = await getSettingValue('anthropic_api_key', '');
    if (!apiKey) {
      await query("UPDATE meeting_recordings SET status = 'complete' WHERE id = $1", [meetingId]);
      return;
    }

    try {
      const analysis = await analyzeMeetingTranscript(transcriptResult.transcript);
      await query(
        `UPDATE meeting_recordings SET
          ai_summary = $1,
          ai_outcome = $2,
          ai_locations_discussed = $3,
          ai_hardware_mentioned = $4,
          ai_interest_level = $5,
          ai_concerns = $6,
          ai_next_steps = $7,
          ai_timeline_discussed = $8,
          ai_deal_potential = $9,
          ai_suggested_stage = $10,
          ai_suggested_notes = $11,
          status = 'complete',
          error_message = NULL
        WHERE id = $12`,
        [
          analysis.summary || null,
          analysis.outcome || null,
          analysis.locations_discussed != null ? String(analysis.locations_discussed) : null,
          analysis.hardware_mentioned || null,
          analysis.interest_level != null ? Number(analysis.interest_level) : null,
          JSON.stringify(analysis.concerns || []),
          JSON.stringify(analysis.next_steps || []),
          analysis.timeline_discussed || null,
          analysis.deal_potential || null,
          analysis.suggested_stage || null,
          analysis.suggested_notes || null,
          meetingId,
        ]
      );
    } catch (err) {
      console.error('Meeting AI analysis failed:', err.message);
      await query(
        "UPDATE meeting_recordings SET status = 'complete', error_message = $1 WHERE id = $2",
        [`AI analysis failed: ${err.message}`, meetingId]
      );
    }
  } catch (err) {
    console.error('Meeting pipeline error:', err.message);
    await query(
      "UPDATE meeting_recordings SET status = 'error', error_message = $1 WHERE id = $2",
      [err.message, meetingId]
    );
  }
}

async function getSettingValue(key, defaultValue) {
  const { rows: [setting] } = await query('SELECT value FROM settings WHERE key = $1', [key]);
  return setting ? (setting.value || defaultValue) : defaultValue;
}

function safeParseJSON(str, fallback) {
  if (!str) return fallback;
  if (typeof str === 'object') return str;
  try { return JSON.parse(str); } catch { return fallback; }
}

module.exports = router;
