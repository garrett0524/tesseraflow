import { useState, useEffect, useCallback, useRef } from 'react'
import { getLeads, getMeetings, uploadMeeting, applyMeetingSuggestions, deleteMeeting } from '../api'

const STATUS_COLORS = {
  uploading: { bg: 'rgba(107,114,128,0.15)', color: '#9ca3af' },
  transcribing: { bg: 'rgba(96,165,250,0.15)', color: '#60a5fa' },
  analyzing: { bg: 'rgba(168,85,247,0.15)', color: '#a855f7' },
  complete: { bg: 'rgba(34,197,94,0.15)', color: '#22c55e' },
  error: { bg: 'rgba(239,68,68,0.15)', color: '#ef4444' },
};

export default function MeetingNotesPage() {
  const [meetings, setMeetings] = useState([]);
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [selectedLead, setSelectedLead] = useState('');
  const fileInputRef = useRef(null);
  const pollRef = useRef(null);

  const fetchMeetings = useCallback(async () => {
    try {
      const result = await getMeetings();
      setMeetings(result.data || []);
    } catch (err) {
      console.error('Failed to load meetings:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchLeads = useCallback(async () => {
    try {
      const result = await getLeads();
      setLeads(result.data || []);
    } catch (err) {
      console.error('Failed to load leads:', err);
    }
  }, []);

  useEffect(() => {
    fetchMeetings();
    fetchLeads();
  }, [fetchMeetings, fetchLeads]);

  // Poll while any meeting is still processing
  useEffect(() => {
    const inFlight = meetings.some(m =>
      m.status === 'uploading' || m.status === 'transcribing' || m.status === 'analyzing'
    );
    if (inFlight) {
      pollRef.current = setInterval(fetchMeetings, 5000);
    } else if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [meetings, fetchMeetings]);

  const handleFile = async (file) => {
    if (!file) return;
    setUploading(true);
    setUploadError('');
    try {
      await uploadMeeting(selectedLead || null, file);
      await fetchMeetings();
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      setUploadError(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleApply = async (id, what) => {
    try {
      await applyMeetingSuggestions(id, what);
      await fetchMeetings();
    } catch (err) {
      alert('Failed to apply: ' + (err.message || ''));
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this meeting recording? This cannot be undone.')) return;
    try {
      await deleteMeeting(id);
      await fetchMeetings();
    } catch (err) {
      alert('Failed to delete: ' + (err.message || ''));
    }
  };

  return (
    <div style={{ animation: 'fadeInContent 0.3s ease' }}>
      <div className="page-header">
        <h1>Meeting Notes</h1>
        <p>Upload recorded Zoom / Google Meet calls for AI transcription and MSP-focused analysis</p>
      </div>

      <div className="card" style={{
        padding: 'var(--space-lg)',
        marginBottom: 'var(--space-xl)',
        background: 'rgba(99, 102, 241, 0.05)',
        border: '1px solid rgba(99, 102, 241, 0.2)',
      }}>
        <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          <strong style={{ color: 'var(--text-primary)' }}>Record your Google Meet or Zoom calls locally, then upload the audio here for AI analysis.</strong>
          {' '}Whisper transcribes the recording, then Claude extracts MSP-specific signals — locations managed, hardware discussed, interest level, concerns, and suggested next steps.
        </div>
      </div>

      {/* Upload form */}
      <div className="card" style={{ padding: 'var(--space-xl)', marginBottom: 'var(--space-xl)' }}>
        <h3 style={{ marginBottom: 'var(--space-md)' }}>Upload Recording</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
          <div>
            <label style={labelStyle}>Associate with Lead</label>
            <select value={selectedLead} onChange={e => setSelectedLead(e.target.value)} style={{ width: '100%' }}>
              <option value="">— Unassigned —</option>
              {leads.map(l => (
                <option key={l.id} value={l.id}>
                  {l.business_name}{l.category ? ` (${l.category})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Audio File</label>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,.mp3,.wav,.m4a,.webm"
              onChange={e => handleFile(e.target.files?.[0])}
              disabled={uploading}
              style={{ width: '100%' }}
            />
          </div>
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
          Supported formats: mp3, wav, m4a, webm. Max 500MB. Transcription may take several minutes for longer meetings.
        </div>
        {uploading && (
          <div style={{ marginTop: 'var(--space-md)', fontSize: '13px', color: 'var(--color-info)' }}>
            Uploading...
          </div>
        )}
        {uploadError && (
          <div style={{ marginTop: 'var(--space-md)', fontSize: '13px', color: 'var(--color-error)' }}>
            {uploadError}
          </div>
        )}
      </div>

      {/* List */}
      <h3 style={{ marginBottom: 'var(--space-md)' }}>Past Meetings</h3>
      {loading ? (
        <div style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 'var(--space-3xl)' }}>
          Loading meetings...
        </div>
      ) : meetings.length === 0 ? (
        <div className="card" style={{ padding: 'var(--space-2xl)', textAlign: 'center', color: 'var(--text-tertiary)' }}>
          No meeting recordings yet. Upload one above.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          {meetings.map(m => (
            <MeetingCard
              key={m.id}
              meeting={m}
              onApply={handleApply}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MeetingCard({ meeting, onApply, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const status = STATUS_COLORS[meeting.status] || STATUS_COLORS.uploading;

  return (
    <div className="card" style={{ padding: 'var(--space-lg)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: '4px', flexWrap: 'wrap' }}>
            <div style={{ fontWeight: 600, fontSize: '15px', color: 'var(--text-primary)' }}>
              {meeting.business_name || 'Unassigned'}
            </div>
            <span style={{
              padding: '2px 8px',
              borderRadius: 'var(--radius-full)',
              fontSize: '11px',
              fontWeight: 600,
              background: status.bg,
              color: status.color,
              textTransform: 'uppercase',
            }}>
              {meeting.status}
            </span>
            {meeting.ai_interest_level != null && (
              <span style={{
                padding: '2px 8px',
                borderRadius: 'var(--radius-full)',
                fontSize: '11px',
                fontWeight: 600,
                background: 'rgba(251,191,36,0.12)',
                color: '#fbbf24',
              }}>
                Interest: {meeting.ai_interest_level}/10
              </span>
            )}
            {meeting.ai_deal_potential && (
              <span style={{
                padding: '2px 8px',
                borderRadius: 'var(--radius-full)',
                fontSize: '11px',
                fontWeight: 600,
                background: 'rgba(34,197,94,0.12)',
                color: '#22c55e',
              }}>
                Deal: {meeting.ai_deal_potential}
              </span>
            )}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
            {meeting.original_filename || meeting.audio_path?.split('/').pop()}
            {' • '}{meeting.created_at ? new Date(meeting.created_at).toLocaleString() : ''}
            {meeting.duration_seconds ? ` • ${Math.round(meeting.duration_seconds / 60)} min` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
          <button className="btn btn-sm btn-secondary" onClick={() => setExpanded(v => !v)}>
            {expanded ? 'Hide' : 'View'}
          </button>
          <button
            className="btn btn-sm"
            onClick={() => onDelete(meeting.id)}
            style={{ background: 'transparent', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444' }}
          >
            Delete
          </button>
        </div>
      </div>

      {meeting.error_message && (
        <div style={{ marginTop: 'var(--space-sm)', fontSize: '12px', color: 'var(--color-error)' }}>
          {meeting.error_message}
        </div>
      )}

      {expanded && (
        <div style={{ marginTop: 'var(--space-lg)', paddingTop: 'var(--space-lg)', borderTop: '1px solid var(--border-default)' }}>
          {meeting.ai_summary && (
            <Section title="Summary">
              <p style={{ color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.6 }}>{meeting.ai_summary}</p>
            </Section>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-md)', marginTop: 'var(--space-md)' }}>
            {meeting.ai_outcome && <Field label="Outcome" value={meeting.ai_outcome} />}
            {meeting.ai_timeline_discussed && <Field label="Timeline" value={meeting.ai_timeline_discussed} />}
            {meeting.ai_locations_discussed && <Field label="Locations Discussed" value={meeting.ai_locations_discussed} />}
            {meeting.ai_hardware_mentioned && <Field label="Hardware Mentioned" value={meeting.ai_hardware_mentioned} />}
          </div>

          {Array.isArray(meeting.ai_concerns) && meeting.ai_concerns.length > 0 && (
            <Section title="Concerns Raised">
              <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.6 }}>
                {meeting.ai_concerns.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </Section>
          )}

          {Array.isArray(meeting.ai_next_steps) && meeting.ai_next_steps.length > 0 && (
            <Section title="Next Steps">
              <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.6 }}>
                {meeting.ai_next_steps.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </Section>
          )}

          {(meeting.ai_suggested_stage || meeting.ai_suggested_notes) && meeting.lead_id && (
            <div style={{
              marginTop: 'var(--space-lg)',
              padding: 'var(--space-md)',
              background: 'rgba(99, 102, 241, 0.08)',
              border: '1px solid rgba(99, 102, 241, 0.2)',
              borderRadius: 'var(--radius-md)',
            }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-sm)', textTransform: 'uppercase' }}>
                Suggested Updates
              </div>
              {meeting.ai_suggested_stage && (
                <div style={{ marginBottom: 'var(--space-sm)' }}>
                  <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>Stage</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-sm)' }}>
                    <span style={{ color: 'var(--text-primary)', fontSize: '14px' }}>{meeting.ai_suggested_stage}</span>
                    <button className="btn btn-sm btn-primary" onClick={() => onApply(meeting.id, { apply_stage: true })}>
                      Apply Stage
                    </button>
                  </div>
                </div>
              )}
              {meeting.ai_suggested_notes && (
                <div>
                  <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>Notes</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-sm)' }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '13px', flex: 1, whiteSpace: 'pre-wrap' }}>
                      {meeting.ai_suggested_notes}
                    </span>
                    <button className="btn btn-sm btn-primary" onClick={() => onApply(meeting.id, { apply_notes: true })}>
                      Apply Notes
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {meeting.transcript && (
            <details style={{ marginTop: 'var(--space-lg)' }}>
              <summary style={{ cursor: 'pointer', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Transcript
              </summary>
              <pre style={{
                marginTop: 'var(--space-sm)',
                padding: 'var(--space-md)',
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-md)',
                fontSize: '12px',
                color: 'var(--text-secondary)',
                whiteSpace: 'pre-wrap',
                fontFamily: 'var(--font-mono)',
                maxHeight: '400px',
                overflowY: 'auto',
              }}>
                {meeting.transcript}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginTop: 'var(--space-md)' }}>
      <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ color: 'var(--text-primary)', fontSize: '14px' }}>{value}</div>
    </div>
  );
}

const labelStyle = {
  display: 'block',
  fontSize: '12px',
  fontWeight: 600,
  color: 'var(--text-secondary)',
  marginBottom: 'var(--space-xs)',
  textTransform: 'uppercase',
};
