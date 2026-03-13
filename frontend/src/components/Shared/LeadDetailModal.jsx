import { useState, useEffect } from 'react'
import { getLeadRecordings, createCalendarEvent } from '../../api'
import RecordingWidget from '../Recording/RecordingWidget'
import CallAnalysis from '../Recording/CallAnalysis'

const STAGES = [
  { key: 'new', label: 'New' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'interested', label: 'Interested' },
  { key: 'meeting_booked', label: 'Meeting Booked' },
  { key: 'closed', label: 'Closed' },
  { key: 'dead', label: 'Dead' },
];

const TABS = [
  { key: 'details', label: 'Details' },
  { key: 'calls', label: 'Calls' },
];

const EVENT_TYPES = [
  { key: 'callback', label: 'Callback' },
  { key: 'site_visit', label: 'Site Visit' },
  { key: 'follow_up_call', label: 'Follow-Up Call' },
  { key: 'follow_up_email', label: 'Follow-Up Email' },
  { key: 'custom', label: 'Custom' },
];

export default function LeadDetailModal({ lead, onClose, onSave }) {
  const [stage, setStage] = useState(lead.pipeline_stage || 'new');
  const [notes, setNotes] = useState(lead.notes || '');
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('details');
  const [recordings, setRecordings] = useState([]);
  const [loadingRecordings, setLoadingRecordings] = useState(false);

  // Schedule form state
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleForm, setScheduleForm] = useState(getDefaultScheduleForm());
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleMsg, setScheduleMsg] = useState(null);

  function getDefaultScheduleForm() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return {
      event_type: 'callback',
      event_date: tomorrow.toISOString().split('T')[0],
      event_time: '14:00',
      duration_minutes: 15,
      description: '',
    };
  }

  useEffect(() => {
    if (activeTab === 'calls') {
      loadRecordings();
    }
  }, [activeTab, lead.id]);

  const loadRecordings = async () => {
    setLoadingRecordings(true);
    try {
      const result = await getLeadRecordings(lead.id);
      setRecordings(result.data || []);
    } catch (err) {
      console.error('Failed to load recordings:', err);
    } finally {
      setLoadingRecordings(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    await onSave(lead.id, { pipeline_stage: stage, notes });
    setSaving(false);
  };

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleRecordingComplete = (recording) => {
    setRecordings(prev => [recording, ...prev]);
  };

  const handleLeadUpdated = (updatedLead) => {
    if (updatedLead.pipeline_stage) setStage(updatedLead.pipeline_stage);
    if (updatedLead.notes) setNotes(updatedLead.notes);
  };

  const handleScheduleChange = (field, value) => {
    setScheduleForm(prev => ({ ...prev, [field]: value }));
  };

  const handleScheduleSubmit = async () => {
    if (!scheduleForm.event_date || !scheduleForm.event_time) {
      setScheduleMsg({ type: 'error', text: 'Date and time are required' });
      return;
    }

    setScheduleSaving(true);
    setScheduleMsg(null);
    try {
      const typeLabel = EVENT_TYPES.find(t => t.key === scheduleForm.event_type)?.label || 'Event';
      await createCalendarEvent({
        lead_id: lead.id,
        event_type: scheduleForm.event_type,
        title: `${typeLabel} - ${lead.business_name}`,
        description: scheduleForm.description,
        event_date: scheduleForm.event_date,
        event_time: scheduleForm.event_time,
        duration_minutes: scheduleForm.duration_minutes,
        auto_created: 0,
      });
      setScheduleMsg({ type: 'success', text: 'Event scheduled!' });
      setScheduleForm(getDefaultScheduleForm());
      setTimeout(() => {
        setShowSchedule(false);
        setScheduleMsg(null);
      }, 1200);
    } catch (err) {
      setScheduleMsg({ type: 'error', text: err.message || 'Failed to create event' });
    } finally {
      setScheduleSaving(false);
    }
  };

  const inputStyle = {
    background: 'var(--bg-tertiary)', border: '1px solid var(--border-default)',
    borderRadius: 'var(--radius-md)', padding: 'var(--space-sm) var(--space-md)',
    color: 'var(--text-primary)', fontSize: '14px', colorScheme: 'dark', width: '100%',
  };

  const labelStyle = {
    display: 'block', color: 'var(--text-secondary)', fontSize: '11px',
    fontWeight: 600, marginBottom: '3px', textTransform: 'uppercase',
  };

  // ── Schedule quick-add panel (shared across tabs) ──
  const schedulePanel = showSchedule && (
    <div style={{
      background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)',
      padding: 'var(--space-lg)', marginBottom: 'var(--space-lg)',
      border: '1px solid var(--border-default)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
          Schedule Event for {lead.business_name}
        </span>
        <button onClick={() => { setShowSchedule(false); setScheduleMsg(null); }} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '16px' }}>
          &#10005;
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
        <div>
          <label style={labelStyle}>Event Type</label>
          <select value={scheduleForm.event_type} onChange={e => handleScheduleChange('event_type', e.target.value)} style={inputStyle}>
            {EVENT_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Duration (min)</label>
          <input type="number" value={scheduleForm.duration_minutes} onChange={e => handleScheduleChange('duration_minutes', Number(e.target.value))} min={5} max={480} style={inputStyle} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
        <div>
          <label style={labelStyle}>Date</label>
          <input type="date" value={scheduleForm.event_date} onChange={e => handleScheduleChange('event_date', e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Time</label>
          <input type="time" value={scheduleForm.event_time} onChange={e => handleScheduleChange('event_time', e.target.value)} style={inputStyle} />
        </div>
      </div>

      <div style={{ marginBottom: 'var(--space-md)' }}>
        <label style={labelStyle}>Notes</label>
        <textarea
          value={scheduleForm.description}
          onChange={e => handleScheduleChange('description', e.target.value)}
          placeholder="Optional notes..."
          rows={2}
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      </div>

      {scheduleMsg && (
        <div style={{
          fontSize: '13px', marginBottom: 'var(--space-sm)',
          color: scheduleMsg.type === 'success' ? 'var(--color-success)' : 'var(--color-error)',
        }}>
          {scheduleMsg.text}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-sm)' }}>
        <button className="btn btn-secondary btn-sm" onClick={() => { setShowSchedule(false); setScheduleMsg(null); }}>Cancel</button>
        <button className="btn btn-primary btn-sm" onClick={handleScheduleSubmit} disabled={scheduleSaving}>
          {scheduleSaving ? 'Scheduling...' : 'Schedule'}
        </button>
      </div>
    </div>
  );

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal-content" style={{ maxWidth: '720px' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-lg)' }}>
          <div>
            <h2>{lead.business_name}</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginTop: '4px' }}>
              {lead.category || 'Uncategorized'} {lead.city && ` | ${lead.city}, ${lead.state || 'NY'}`}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' }}>
            <button
              className="btn btn-sm"
              onClick={() => setShowSchedule(!showSchedule)}
              style={{
                background: showSchedule ? 'var(--accent-primary)' : 'transparent',
                color: showSchedule ? 'white' : 'var(--accent-primary)',
                border: `1px solid var(--accent-primary)`,
                fontWeight: 600,
                fontSize: '13px',
                padding: '6px 14px',
              }}
            >
              Schedule
            </button>
            <button className="btn btn-ghost" onClick={onClose} style={{ fontSize: '18px', padding: '4px 8px' }}>
              &#10005;
            </button>
          </div>
        </div>

        {/* Schedule panel (visible on both tabs) */}
        {schedulePanel}

        {/* Tab bar */}
        <div style={{
          display: 'flex',
          gap: 'var(--space-xs)',
          marginBottom: 'var(--space-xl)',
          borderBottom: '1px solid var(--border-default)',
          paddingBottom: 0
        }}>
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`tab-button ${activeTab === tab.key ? 'active' : ''}`}
            >
              {tab.label}
              {tab.key === 'calls' && recordings.length > 0 && (
                <span style={{
                  marginLeft: '6px',
                  fontSize: '11px',
                  background: 'var(--gradient-primary)',
                  color: 'white',
                  borderRadius: 'var(--radius-full)',
                  padding: '1px 6px',
                  fontWeight: 600
                }}>
                  {recordings.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* DETAILS TAB */}
        {activeTab === 'details' && (
          <>
            {/* Info Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-lg)', marginBottom: 'var(--space-xl)' }}>
              <InfoField label="Address" value={lead.address ? `${lead.address}, ${lead.city || ''} ${lead.state || ''} ${lead.zip || ''}` : '-'} />
              <InfoField label="Phone" value={lead.phone || '-'} />
              <InfoField label="Website" value={lead.website ? <a href={lead.website} target="_blank" rel="noreferrer">{lead.website}</a> : '-'} />
              <InfoField label="Owner/Manager" value={lead.owner_name || '-'} />
              <InfoField label="Google Rating" value={lead.google_rating ? `${lead.google_rating} stars` : '-'} />
              <InfoField label="Reviews" value={lead.review_count || 0} />
              <InfoField label="Lead Score" value={
                <span style={{
                  fontWeight: 700, fontSize: '18px',
                  color: lead.lead_score >= 70 ? 'var(--color-success)' :
                         lead.lead_score >= 40 ? 'var(--color-warning)' : 'var(--text-secondary)'
                }}>
                  {lead.lead_score || 0}
                </span>
              } />
              <InfoField label="Contact Attempts" value={lead.contact_attempts || 0} />
              <InfoField label="Last Contact" value={
                lead.last_contact_date
                  ? `${lead.last_contact_date.split('T')[0]} via ${lead.last_contact_method || 'unknown'}`
                  : 'Never'
              } />
              <InfoField label="Added" value={lead.created_at ? lead.created_at.split('T')[0] : '-'} />
            </div>

            {/* Pipeline Stage */}
            <div style={{ marginBottom: 'var(--space-lg)' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 'var(--space-xs)', textTransform: 'uppercase' }}>
                Pipeline Stage
              </label>
              <select value={stage} onChange={e => setStage(e.target.value)}>
                {STAGES.map(s => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
            </div>

            {/* Notes */}
            <div style={{ marginBottom: 'var(--space-xl)' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 'var(--space-xs)', textTransform: 'uppercase' }}>
                Notes
              </label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={4}
                placeholder="Add notes about this lead..."
                style={{ resize: 'vertical' }}
              />
            </div>

            {/* Contact History */}
            {(lead.calls?.length > 0 || lead.emails?.length > 0) && (
              <div style={{ marginBottom: 'var(--space-xl)' }}>
                <h3 style={{ marginBottom: 'var(--space-md)' }}>Contact History</h3>
                {lead.calls?.map(call => (
                  <div key={call.id} style={{ padding: 'var(--space-sm)', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)', marginBottom: 'var(--space-sm)', fontSize: '13px' }}>
                    Call: {call.outcome || 'unknown'} | {call.duration_seconds || 0}s | {call.created_at?.split('T')[0]}
                  </div>
                ))}
                {lead.emails?.map(email => (
                  <div key={email.id} style={{ padding: 'var(--space-sm)', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)', marginBottom: 'var(--space-sm)', fontSize: '13px' }}>
                    Email: {email.status} | {email.sequence_name || 'direct'} | {email.sent_at?.split('T')[0]}
                  </div>
                ))}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </>
        )}

        {/* CALLS TAB */}
        {activeTab === 'calls' && (
          <div>
            {/* Recording Widget */}
            <RecordingWidget
              leadId={lead.id}
              onRecordingComplete={handleRecordingComplete}
            />

            {/* Recordings list */}
            {loadingRecordings ? (
              <div style={{ textAlign: 'center', padding: 'var(--space-xl)', color: 'var(--text-secondary)' }}>
                Loading recordings...
              </div>
            ) : recordings.length === 0 ? (
              <div style={{
                textAlign: 'center',
                padding: 'var(--space-3xl)',
                color: 'var(--text-tertiary)',
                fontSize: '13px'
              }}>
                No recordings yet. Click "Start Recording" above to record a call.
              </div>
            ) : (
              <div>
                <h4 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 'var(--space-md)' }}>
                  Previous Recordings ({recordings.length})
                </h4>
                {recordings.map(rec => (
                  <CallAnalysis
                    key={rec.id}
                    recording={rec}
                    onLeadUpdated={handleLeadUpdated}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function InfoField({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: '2px' }}>
        {label}
      </div>
      <div style={{ color: 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}
