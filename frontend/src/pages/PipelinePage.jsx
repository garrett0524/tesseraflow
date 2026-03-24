import { useState, useEffect, useCallback } from 'react'
import StatsBar from '../components/Shared/StatsBar'
import KanbanBoard from '../components/Pipeline/KanbanBoard'
import LeadTable from '../components/Pipeline/LeadTable'
import LeadDetailModal from '../components/Shared/LeadDetailModal'
import TodayScheduleWidget from '../components/Calendar/TodayScheduleWidget'
import { getLeads, updateLead, createLead } from '../api'

export default function PipelinePage() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedLead, setSelectedLead] = useState(null);
  const [sortField, setSortField] = useState('created_at');
  const [sortDir, setSortDir] = useState('desc');
  const [showAddLead, setShowAddLead] = useState(false);

  const fetchLeads = useCallback(async () => {
    try {
      const result = await getLeads();
      setLeads(result.data || []);
    } catch (err) {
      console.error('Failed to load leads:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  const handleStageChange = async (leadId, newStage) => {
    try {
      await updateLead(leadId, { pipeline_stage: newStage });
      setLeads(prev => prev.map(l =>
        l.id === leadId ? { ...l, pipeline_stage: newStage } : l
      ));
    } catch (err) {
      console.error('Failed to update stage:', err);
    }
  };

  const handleSort = (field) => {
    if (field === sortField) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const sortedLeads = [...leads].sort((a, b) => {
    const aVal = a[sortField] ?? '';
    const bVal = b[sortField] ?? '';
    const cmp = typeof aVal === 'number'
      ? aVal - bVal
      : String(aVal).localeCompare(String(bVal));
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const handleCardClick = (lead) => {
    setSelectedLead(lead);
  };

  const handleLeadUpdate = async (id, data) => {
    try {
      await updateLead(id, data);
      await fetchLeads();
      setSelectedLead(null);
    } catch (err) {
      console.error('Failed to update lead:', err);
    }
  };

  const handleAddLead = async (data) => {
    try {
      await createLead(data);
      await fetchLeads();
      setShowAddLead(false);
    } catch (err) {
      console.error('Failed to create lead:', err);
      throw err;
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh', color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)', fontSize: '14px' }}>
        Loading pipeline...
      </div>
    );
  }

  return (
    <div style={{ animation: 'fadeInContent 0.3s ease' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Pipeline</h1>
          <p>Lead pipeline overview</p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => setShowAddLead(true)}
          style={{ flexShrink: 0 }}
        >
          + Add Lead
        </button>
      </div>

      <TodayScheduleWidget />

      <StatsBar />

      <KanbanBoard
        leads={leads}
        onStageChange={handleStageChange}
        onCardClick={handleCardClick}
      />

      <LeadTable
        leads={sortedLeads}
        onRowClick={handleCardClick}
        onSort={handleSort}
        sortField={sortField}
        sortDir={sortDir}
      />

      {selectedLead && (
        <LeadDetailModal
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
          onSave={handleLeadUpdate}
        />
      )}

      {showAddLead && (
        <AddLeadModal
          onClose={() => setShowAddLead(false)}
          onSave={handleAddLead}
        />
      )}
    </div>
  );
}

function AddLeadModal({ onClose, onSave }) {
  const [form, setForm] = useState({
    business_name: '',
    category: '',
    owner_name: '',
    phone: '',
    address: '',
    city: '',
    state: 'NY',
    zip: '',
    website: '',
    notes: '',
    pipeline_stage: 'new',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.business_name.trim()) {
      setError('Business name is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave(form);
    } catch (err) {
      setError(err.message || 'Failed to create lead');
      setSaving(false);
    }
  };

  const fieldStyle = { width: '100%', marginBottom: 0 };
  const labelStyle = {
    display: 'block',
    fontSize: '12px',
    fontWeight: 600,
    color: 'var(--text-secondary)',
    marginBottom: 'var(--space-xs)',
    textTransform: 'uppercase',
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ width: '100%', maxWidth: '520px', maxHeight: '85vh', overflow: 'auto', padding: 'var(--space-2xl)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ marginBottom: 'var(--space-lg)' }}>Add Lead</h3>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gap: 'var(--space-md)' }}>
            <div>
              <label style={labelStyle}>Business Name *</label>
              <input
                type="text"
                value={form.business_name}
                onChange={(e) => handleChange('business_name', e.target.value)}
                placeholder="e.g. Joe's Pizza"
                autoFocus
                required
                style={fieldStyle}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
              <div>
                <label style={labelStyle}>Category</label>
                <input
                  type="text"
                  value={form.category}
                  onChange={(e) => handleChange('category', e.target.value)}
                  placeholder="e.g. Restaurant"
                  style={fieldStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Owner Name</label>
                <input
                  type="text"
                  value={form.owner_name}
                  onChange={(e) => handleChange('owner_name', e.target.value)}
                  placeholder="e.g. Joe Smith"
                  style={fieldStyle}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
              <div>
                <label style={labelStyle}>Phone</label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => handleChange('phone', e.target.value)}
                  placeholder="(555) 123-4567"
                  style={fieldStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Website</label>
                <input
                  type="text"
                  value={form.website}
                  onChange={(e) => handleChange('website', e.target.value)}
                  placeholder="www.example.com"
                  style={fieldStyle}
                />
              </div>
            </div>

            <div>
              <label style={labelStyle}>Address</label>
              <input
                type="text"
                value={form.address}
                onChange={(e) => handleChange('address', e.target.value)}
                placeholder="123 Main St"
                style={fieldStyle}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 'var(--space-md)' }}>
              <div>
                <label style={labelStyle}>City</label>
                <input
                  type="text"
                  value={form.city}
                  onChange={(e) => handleChange('city', e.target.value)}
                  placeholder="City"
                  style={fieldStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>State</label>
                <input
                  type="text"
                  value={form.state}
                  onChange={(e) => handleChange('state', e.target.value)}
                  style={fieldStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Zip</label>
                <input
                  type="text"
                  value={form.zip}
                  onChange={(e) => handleChange('zip', e.target.value)}
                  placeholder="11701"
                  style={fieldStyle}
                />
              </div>
            </div>

            <div>
              <label style={labelStyle}>Stage</label>
              <select
                value={form.pipeline_stage}
                onChange={(e) => handleChange('pipeline_stage', e.target.value)}
                style={fieldStyle}
              >
                <option value="new">New</option>
                <option value="contacted">Contacted</option>
                <option value="interested">Interested</option>
                <option value="meeting_booked">Meeting Booked</option>
                <option value="closed">Closed</option>
              </select>
            </div>

            <div>
              <label style={labelStyle}>Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => handleChange('notes', e.target.value)}
                placeholder="How did you find this lead? Any context..."
                rows={3}
                style={{ ...fieldStyle, resize: 'vertical' }}
              />
            </div>
          </div>

          {error && (
            <div style={{
              marginTop: 'var(--space-md)',
              padding: 'var(--space-sm) var(--space-md)',
              borderRadius: 'var(--radius-md)',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              color: '#ef4444',
              fontSize: '13px',
            }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 'var(--space-md)', marginTop: 'var(--space-xl)' }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Creating...' : 'Add Lead'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
