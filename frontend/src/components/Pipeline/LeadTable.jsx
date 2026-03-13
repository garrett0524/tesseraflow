import { useState, useMemo, useEffect } from 'react'
import './LeadTable.css'

const STAGE_LABELS = {
  new: 'New',
  contacted: 'Contacted',
  interested: 'Interested',
  meeting_booked: 'Meeting Booked',
  closed: 'Closed',
  dead: 'Dead',
};

export default function LeadTable({ leads, onRowClick, onSort, sortField, sortDir }) {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({
    category: '',
    stage: '',
    attempts: '',
    scoreMin: '',
    scoreMax: '',
  });

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const filteredLeads = useMemo(() => {
    return leads.filter(lead => {
      if (search) {
        const term = search.toLowerCase();
        const match = (lead.business_name || '').toLowerCase().includes(term)
          || (lead.address || '').toLowerCase().includes(term)
          || (lead.owner_name || '').toLowerCase().includes(term)
          || (lead.city || '').toLowerCase().includes(term);
        if (!match) return false;
      }
      if (filters.category && lead.category !== filters.category) return false;
      if (filters.stage && lead.pipeline_stage !== filters.stage) return false;
      if (filters.attempts) {
        const att = lead.contact_attempts || 0;
        if (filters.attempts === '0' && att !== 0) return false;
        if (filters.attempts === '1-3' && (att < 1 || att > 3)) return false;
        if (filters.attempts === '4+' && att < 4) return false;
      }
      if (filters.scoreMin && lead.lead_score < Number(filters.scoreMin)) return false;
      if (filters.scoreMax && lead.lead_score > Number(filters.scoreMax)) return false;
      return true;
    });
  }, [leads, search, filters]);

  const categories = useMemo(() => {
    const cats = new Set(leads.map(l => l.category).filter(Boolean));
    return [...cats].sort();
  }, [leads]);

  const handleSort = (field) => {
    if (onSort) onSort(field);
  };

  const SortIcon = ({ field }) => {
    if (sortField !== field) return <span className="sort-icon">&#8693;</span>;
    return <span className="sort-icon">{sortDir === 'asc' ? '&#8593;' : '&#8595;'}</span>;
  };

  return (
    <div className="lead-table-container">
      {/* Filter bar */}
      <div className="lead-table-filters">
        <input
          type="search"
          placeholder="Search leads..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="lead-search"
        />
        <select value={filters.category} onChange={e => setFilters(f => ({...f, category: e.target.value}))}>
          <option value="">All Categories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filters.stage} onChange={e => setFilters(f => ({...f, stage: e.target.value}))}>
          <option value="">All Stages</option>
          {Object.entries(STAGE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={filters.attempts} onChange={e => setFilters(f => ({...f, attempts: e.target.value}))}>
          <option value="">All Attempts</option>
          <option value="0">0 attempts</option>
          <option value="1-3">1-3 attempts</option>
          <option value="4+">4+ attempts</option>
        </select>
        <input
          type="number"
          placeholder="Score min"
          value={filters.scoreMin}
          onChange={e => setFilters(f => ({...f, scoreMin: e.target.value}))}
          style={{ width: '100px' }}
        />
        <input
          type="number"
          placeholder="Score max"
          value={filters.scoreMax}
          onChange={e => setFilters(f => ({...f, scoreMax: e.target.value}))}
          style={{ width: '100px' }}
        />
      </div>

      {/* Mobile Card View */}
      {isMobile ? (
        <div className="lead-card-list" style={{ padding: 'var(--space-sm)' }}>
          {filteredLeads.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 'var(--space-3xl)' }}>
              {leads.length === 0 ? 'No leads yet — run a scrape or import CSV' : 'No leads match filters'}
            </div>
          ) : (
            filteredLeads.map(lead => (
              <div
                key={lead.id}
                onClick={() => onRowClick(lead)}
                style={{
                  background: 'var(--bg-card-elevated)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-md)',
                  marginBottom: 'var(--space-sm)',
                  cursor: 'pointer',
                  transition: 'background 0.15s ease',
                  minHeight: '44px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-xs)' }}>
                  <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {lead.business_name}
                  </div>
                  <span style={{
                    fontWeight: 700,
                    fontSize: '14px',
                    marginLeft: 'var(--space-sm)',
                    flexShrink: 0,
                    color: lead.lead_score >= 70 ? 'var(--color-success)' :
                           lead.lead_score >= 40 ? 'var(--color-warning)' : 'var(--text-secondary)'
                  }}>
                    {lead.lead_score || 0}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                  {lead.category && (
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      {lead.category}
                    </span>
                  )}
                  <span className={`badge badge-${lead.pipeline_stage}`}>
                    {STAGE_LABELS[lead.pipeline_stage] || lead.pipeline_stage}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        /* Desktop Table */
        <div className="lead-table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th onClick={() => handleSort('business_name')}>Name <SortIcon field="business_name" /></th>
                <th onClick={() => handleSort('category')}>Category <SortIcon field="category" /></th>
                <th>Address</th>
                <th>Phone</th>
                <th>Owner</th>
                <th onClick={() => handleSort('pipeline_stage')}>Stage <SortIcon field="pipeline_stage" /></th>
                <th onClick={() => handleSort('last_contact_date')}>Last Contact <SortIcon field="last_contact_date" /></th>
                <th onClick={() => handleSort('contact_attempts')}>Attempts <SortIcon field="contact_attempts" /></th>
                <th onClick={() => handleSort('lead_score')}>Score <SortIcon field="lead_score" /></th>
                <th onClick={() => handleSort('created_at')}>Added <SortIcon field="created_at" /></th>
              </tr>
            </thead>
            <tbody>
              {filteredLeads.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 'var(--space-3xl)' }}>
                    {leads.length === 0 ? 'No leads yet — run a scrape or import CSV' : 'No leads match filters'}
                  </td>
                </tr>
              ) : (
                filteredLeads.map(lead => (
                  <tr key={lead.id} onClick={() => onRowClick(lead)} style={{ cursor: 'pointer' }}>
                    <td style={{ fontWeight: 500 }}>{lead.business_name}</td>
                    <td>{lead.category || '-'}</td>
                    <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {lead.address ? `${lead.address}, ${lead.city || ''}` : '-'}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}>{lead.phone || '-'}</td>
                    <td>{lead.owner_name || '-'}</td>
                    <td>
                      <span className={`badge badge-${lead.pipeline_stage}`}>
                        {STAGE_LABELS[lead.pipeline_stage] || lead.pipeline_stage}
                      </span>
                    </td>
                    <td>
                      {lead.last_contact_date
                        ? `${lead.last_contact_date.split('T')[0]} (${lead.last_contact_method || '-'})`
                        : 'Never'}
                    </td>
                    <td style={{ textAlign: 'center' }}>{lead.contact_attempts || 0}</td>
                    <td>
                      <span style={{
                        fontWeight: 600,
                        color: lead.lead_score >= 70 ? 'var(--color-success)' :
                               lead.lead_score >= 40 ? 'var(--color-warning)' : 'var(--text-secondary)'
                      }}>
                        {lead.lead_score || 0}
                      </span>
                    </td>
                    <td style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      {lead.created_at ? lead.created_at.split('T')[0] : '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
      <div className="lead-table-footer">
        Showing {filteredLeads.length} of {leads.length} leads
      </div>
    </div>
  );
}
