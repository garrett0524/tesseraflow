import { useState, useRef, useEffect } from 'react'
import {
  bulkUpdateLeads,
  bulkDeleteLeads,
  enrichLead,
  getInstantlyCampaigns,
  pushToInstantly,
} from '../../api'

const STAGE_OPTIONS = [
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'interested', label: 'Interested' },
  { value: 'meeting_booked', label: 'Meeting Booked' },
  { value: 'technical_review', label: 'Technical Review' },
  { value: 'contract_sent', label: 'Contract Sent' },
  { value: 'onboarding', label: 'Onboarding' },
  { value: 'live', label: 'Live' },
  { value: 'closed', label: 'Closed' },
  { value: 'dead', label: 'Dead' },
];

const CATEGORY_OPTIONS = [
  'Bars', 'Restaurants', 'Gyms', 'Gambling & Casinos',
  'ISP', 'MSP', 'IT Services', 'WISP', 'Enterprise IT', 'Other',
];

const PRIORITY_OPTIONS = ['Hot', 'Warm', 'Cold', 'None'];

export default function BulkActionBar({
  selectedIds,
  onClearSelection,
  onComplete,
  isAdmin,
}) {
  const count = selectedIds.length;
  const [openMenu, setOpenMenu] = useState(null); // 'priority' | 'stage' | 'category' | 'campaign' | null
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null); // string or null
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [campaigns, setCampaigns] = useState([]);
  const [selectedCampaign, setSelectedCampaign] = useState('');
  const menuRef = useRef(null);

  // Close menus on outside click
  useEffect(() => {
    if (!openMenu) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpenMenu(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openMenu]);

  if (count === 0) return null;

  const finish = (msg) => {
    setBusy(false);
    setOpenMenu(null);
    setProgress(msg || null);
    if (onComplete) onComplete();
    setTimeout(() => setProgress(null), 2500);
  };

  const handleSetPriority = async (value) => {
    setBusy(true);
    try {
      // "None" maps to null on the server side
      const payload = value === 'None' ? null : value;
      await bulkUpdateLeads(selectedIds, { priority: payload });
      finish(`Priority set to ${value} on ${count} leads`);
    } catch (err) {
      setBusy(false);
      alert('Bulk update failed: ' + (err.message || ''));
    }
  };

  const handleSetStage = async (value) => {
    setBusy(true);
    try {
      await bulkUpdateLeads(selectedIds, { pipeline_stage: value });
      finish(`Stage updated on ${count} leads`);
    } catch (err) {
      setBusy(false);
      alert('Bulk update failed: ' + (err.message || ''));
    }
  };

  const handleSetCategory = async (value) => {
    setBusy(true);
    try {
      await bulkUpdateLeads(selectedIds, { category: value });
      finish(`Category set to ${value} on ${count} leads`);
    } catch (err) {
      setBusy(false);
      alert('Bulk update failed: ' + (err.message || ''));
    }
  };

  const handleEnrich = async () => {
    setBusy(true);
    let done = 0, failed = 0;
    for (const id of selectedIds) {
      try {
        await enrichLead(id);
        done++;
      } catch {
        failed++;
      }
      setProgress(`Enriching... ${done + failed} / ${count}`);
    }
    finish(`Enriched ${done}${failed ? `, ${failed} failed` : ''}`);
  };

  const handleOpenCampaignPush = async () => {
    setOpenMenu('campaign');
    setSelectedCampaign('');
    try {
      const res = await getInstantlyCampaigns();
      setCampaigns(res.data || []);
    } catch (err) {
      alert('Failed to load campaigns: ' + (err.message || ''));
      setOpenMenu(null);
    }
  };

  const handlePushToCampaign = async () => {
    if (!selectedCampaign) return;
    setBusy(true);
    try {
      const res = await pushToInstantly(selectedIds, selectedCampaign);
      finish(`Pushed ${res.pushed || 0}${res.skipped_no_email ? `, ${res.skipped_no_email} skipped (no email)` : ''}`);
    } catch (err) {
      setBusy(false);
      alert('Push failed: ' + (err.message || ''));
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    try {
      await bulkDeleteLeads(selectedIds);
      finish(`Deleted ${count} leads`);
      setConfirmDelete(false);
    } catch (err) {
      setBusy(false);
      alert('Delete failed: ' + (err.message || ''));
    }
  };

  const buttonStyle = {
    background: 'var(--bg-tertiary)',
    border: '1px solid var(--border-default)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--text-primary)',
    fontSize: '13px',
    padding: '6px 12px',
    cursor: 'pointer',
    fontWeight: 500,
  };

  return (
    <>
      <div style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'var(--bg-card-elevated)',
        border: '1px solid var(--accent-primary)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-md)',
        zIndex: 500,
        maxWidth: '95vw',
        flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--accent-primary)', whiteSpace: 'nowrap' }}>
          {count} lead{count !== 1 ? 's' : ''} selected
        </span>

        <div style={{ width: 1, height: 24, background: 'var(--border-default)' }} />

        <div ref={menuRef} style={{ display: 'flex', gap: 'var(--space-sm)', position: 'relative', flexWrap: 'wrap' }}>
          <BulkDropdown
            label="Set Priority"
            isOpen={openMenu === 'priority'}
            onToggle={() => setOpenMenu(openMenu === 'priority' ? null : 'priority')}
            options={PRIORITY_OPTIONS.map(p => ({ value: p, label: p }))}
            onPick={handleSetPriority}
            buttonStyle={buttonStyle}
            disabled={busy}
          />
          <BulkDropdown
            label="Set Stage"
            isOpen={openMenu === 'stage'}
            onToggle={() => setOpenMenu(openMenu === 'stage' ? null : 'stage')}
            options={STAGE_OPTIONS}
            onPick={handleSetStage}
            buttonStyle={buttonStyle}
            disabled={busy}
          />
          <BulkDropdown
            label="Set Category"
            isOpen={openMenu === 'category'}
            onToggle={() => setOpenMenu(openMenu === 'category' ? null : 'category')}
            options={CATEGORY_OPTIONS.map(c => ({ value: c, label: c }))}
            onPick={handleSetCategory}
            buttonStyle={buttonStyle}
            disabled={busy}
          />
          <button style={buttonStyle} onClick={handleEnrich} disabled={busy}>
            Enrich with Apollo
          </button>
          <button style={buttonStyle} onClick={handleOpenCampaignPush} disabled={busy}>
            Push to Instantly
          </button>
          {isAdmin && (
            <button
              style={{
                ...buttonStyle,
                background: 'rgba(239,68,68,0.08)',
                borderColor: 'rgba(239,68,68,0.3)',
                color: '#ef4444',
              }}
              onClick={() => setConfirmDelete(true)}
              disabled={busy}
            >
              Delete
            </button>
          )}
        </div>

        <div style={{ width: 1, height: 24, background: 'var(--border-default)' }} />

        <button
          style={{ ...buttonStyle, background: 'transparent', borderColor: 'transparent', color: 'var(--text-secondary)' }}
          onClick={onClearSelection}
          disabled={busy}
        >
          Clear
        </button>

        {progress && (
          <span style={{
            position: 'absolute',
            top: -28,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--bg-card-elevated)',
            padding: '4px 10px',
            borderRadius: 'var(--radius-full)',
            fontSize: '12px',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-default)',
            whiteSpace: 'nowrap',
          }}>
            {progress}
          </span>
        )}
      </div>

      {/* Campaign picker modal */}
      {openMenu === 'campaign' && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}
          onClick={() => !busy && setOpenMenu(null)}
        >
          <div
            className="card"
            style={{ maxWidth: 420, width: '100%', padding: 'var(--space-2xl)' }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ marginBottom: 'var(--space-md)' }}>Push {count} leads to Instantly</h3>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: 'var(--space-lg)' }}>
              Leads without email addresses will be skipped.
            </p>
            <select
              value={selectedCampaign}
              onChange={e => setSelectedCampaign(e.target.value)}
              style={{ width: '100%', marginBottom: 'var(--space-lg)' }}
              disabled={busy}
            >
              <option value="">Select a campaign...</option>
              {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setOpenMenu(null)} disabled={busy}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={handlePushToCampaign}
                disabled={!selectedCampaign || busy}
              >
                {busy ? 'Pushing...' : 'Push'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}
          onClick={() => !busy && setConfirmDelete(false)}
        >
          <div
            className="card"
            style={{ maxWidth: 420, width: '100%', padding: 'var(--space-2xl)' }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ marginBottom: 'var(--space-md)' }}>Delete {count} lead{count !== 1 ? 's' : ''}?</h3>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: 'var(--space-lg)' }}>
              This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setConfirmDelete(false)} disabled={busy}>
                Cancel
              </button>
              <button
                className="btn"
                style={{ background: '#ef4444', color: 'white', border: 'none' }}
                onClick={handleDelete}
                disabled={busy}
              >
                {busy ? 'Deleting...' : `Delete ${count} lead${count !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function BulkDropdown({ label, isOpen, onToggle, options, onPick, buttonStyle, disabled }) {
  return (
    <div style={{ position: 'relative' }}>
      <button style={buttonStyle} onClick={onToggle} disabled={disabled}>
        {label} ▾
      </button>
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            left: 0,
            background: 'var(--bg-card-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-elevated)',
            minWidth: 180,
            maxHeight: 280,
            overflowY: 'auto',
            padding: '4px 0',
            zIndex: 501,
          }}
        >
          {options.map(o => (
            <button
              key={o.value}
              onClick={() => onPick(o.value)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                background: 'none',
                border: 'none',
                padding: '8px 14px',
                color: 'var(--text-primary)',
                fontSize: '13px',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
