import { useState, useEffect, useCallback, useRef } from 'react'
import { enrichLead, getLeads } from '../../api'
import './LeadTable.css'

const STAGE_LABELS = {
  new: 'New',
  contacted: 'Contacted',
  interested: 'Interested',
  meeting_booked: 'Meeting Booked',
  technical_review: 'Technical Review',
  contract_sent: 'Contract Sent',
  onboarding: 'Onboarding',
  live: 'Live',
  closed: 'Closed',
  dead: 'Dead',
};

const KNOWN_CATEGORIES = [
  'Bars', 'Restaurants', 'Gyms', 'Casinos', 'Hotels', 'Hospitality',
  'ISP', 'MSP', 'IT Services', 'WISP', 'Enterprise IT', 'Other',
];

const EMAIL_STATUS_DOT = {
  none: '#6b7280',
  sent: '#3b82f6',
  opened: '#eab308',
  replied: '#10b981',
  bounced: '#ef4444',
};

const PAGE_SIZE = 50;

export default function LeadTable({ onRowClick, refreshToken = 0 }) {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  // Sort state
  const [sortField, setSortField] = useState('created_at');
  const [sortDir, setSortDir] = useState('desc');

  // Pagination state
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Data state
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [enrichingId, setEnrichingId] = useState(null);

  // Filter inputs (live) vs applied filters (sent to server, debounced)
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filters, setFilters] = useState({
    category: '',
    stage: '',
    attempts: '',
    scoreMin: '',
    scoreMax: '',
    emailStatus: '',
  });

  // Debounce search 300ms
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Reset to page 1 whenever filters/search/sort change
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, filters.category, filters.stage, filters.attempts,
      filters.scoreMin, filters.scoreMax, filters.emailStatus,
      sortField, sortDir]);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Track in-flight requests so a slow earlier response can't overwrite a newer one
  const reqIdRef = useRef(0);

  const fetchPage = useCallback(async () => {
    const myReqId = ++reqIdRef.current;
    setLoading(true);
    try {
      const params = {
        page,
        limit: PAGE_SIZE,
        sort: sortField,
        sort_dir: sortDir,
      };
      if (debouncedSearch) params.search = debouncedSearch;
      if (filters.category) params.category = filters.category;
      if (filters.stage) params.stage = filters.stage;
      if (filters.attempts) params.attempts = filters.attempts;
      if (filters.scoreMin) params.score_min = filters.scoreMin;
      if (filters.scoreMax) params.score_max = filters.scoreMax;
      if (filters.emailStatus) params.email_status = filters.emailStatus;

      const res = await getLeads(params);
      if (myReqId !== reqIdRef.current) return; // newer request landed first
      setLeads(res.data || []);
      setTotal(res.total || 0);
      setTotalPages(res.totalPages || 1);
    } catch (err) {
      if (myReqId === reqIdRef.current) {
        console.error('Failed to load leads:', err);
        setLeads([]);
        setTotal(0);
        setTotalPages(1);
      }
    } finally {
      if (myReqId === reqIdRef.current) setLoading(false);
    }
  }, [page, sortField, sortDir, debouncedSearch, filters]);

  useEffect(() => {
    fetchPage();
  }, [fetchPage, refreshToken]);

  const handleSort = (field) => {
    if (field === sortField) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ field }) => {
    if (sortField !== field) return <span className="sort-icon">&#8693;</span>;
    return <span className="sort-icon">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  const handleEnrich = (lead, e) => {
    e.stopPropagation();
    setEnrichingId(lead.id);
    enrichLead(lead.id)
      .then(() => fetchPage())
      .catch(() => {})
      .finally(() => setEnrichingId(null));
  };

  const goToPage = (p) => {
    const clamped = Math.max(1, Math.min(totalPages, p));
    if (clamped !== page) setPage(clamped);
  };

  // Categories shown in filter dropdown: known set ∪ what's in the current page
  const categoryOptions = (() => {
    const cats = new Set(leads.map(l => l.category).filter(Boolean));
    for (const c of KNOWN_CATEGORIES) cats.add(c);
    return [...cats].sort();
  })();

  const showingFrom = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const showingTo = Math.min(total, page * PAGE_SIZE);

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
        <select value={filters.category} onChange={e => setFilters(f => ({ ...f, category: e.target.value }))}>
          <option value="">All Categories</option>
          {categoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filters.stage} onChange={e => setFilters(f => ({ ...f, stage: e.target.value }))}>
          <option value="">All Stages</option>
          {Object.entries(STAGE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={filters.attempts} onChange={e => setFilters(f => ({ ...f, attempts: e.target.value }))}>
          <option value="">All Attempts</option>
          <option value="0">0 attempts</option>
          <option value="1-3">1-3 attempts</option>
          <option value="4+">4+ attempts</option>
        </select>
        <select value={filters.emailStatus} onChange={e => setFilters(f => ({ ...f, emailStatus: e.target.value }))}>
          <option value="">Email Status</option>
          <option value="no_email">No Email</option>
          <option value="has_email">Has Email</option>
          <option value="sent">Sent</option>
          <option value="opened">Opened</option>
          <option value="replied">Replied</option>
          <option value="bounced">Bounced</option>
        </select>
        <input
          type="number"
          placeholder="Score min"
          value={filters.scoreMin}
          onChange={e => setFilters(f => ({ ...f, scoreMin: e.target.value }))}
          style={{ width: '100px' }}
        />
        <input
          type="number"
          placeholder="Score max"
          value={filters.scoreMax}
          onChange={e => setFilters(f => ({ ...f, scoreMax: e.target.value }))}
          style={{ width: '100px' }}
        />
      </div>

      {/* Mobile Card View */}
      {isMobile ? (
        <div className="lead-card-list" style={{ padding: 'var(--space-sm)' }}>
          {loading ? (
            <div style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 'var(--space-3xl)' }}>
              Loading...
            </div>
          ) : leads.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 'var(--space-3xl)' }}>
              {total === 0 ? 'No leads match filters' : 'No leads on this page'}
            </div>
          ) : (
            leads.map(lead => (
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
                <th>Contact</th>
                <th>Email</th>
                <th onClick={() => handleSort('estimated_locations')}>Locations <SortIcon field="estimated_locations" /></th>
                <th>Hardware</th>
                <th onClick={() => handleSort('pipeline_stage')}>Stage <SortIcon field="pipeline_stage" /></th>
                <th onClick={() => handleSort('last_contact_date')}>Last Contact <SortIcon field="last_contact_date" /></th>
                <th onClick={() => handleSort('contact_attempts')}>Attempts <SortIcon field="contact_attempts" /></th>
                <th onClick={() => handleSort('lead_score')}>Score <SortIcon field="lead_score" /></th>
                <th onClick={() => handleSort('created_at')}>Added <SortIcon field="created_at" /></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={13} style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 'var(--space-3xl)' }}>
                    Loading...
                  </td>
                </tr>
              ) : leads.length === 0 ? (
                <tr>
                  <td colSpan={13} style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 'var(--space-3xl)' }}>
                    {total === 0 ? 'No leads match filters' : 'No leads on this page'}
                  </td>
                </tr>
              ) : (
                leads.map(lead => (
                  <tr key={lead.id} onClick={() => onRowClick(lead)} style={{ cursor: 'pointer' }}>
                    <td style={{ fontWeight: 500 }}>{lead.business_name}</td>
                    <td>{lead.category || '-'}</td>
                    <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {lead.address ? `${lead.address}, ${lead.city || ''}` : '-'}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}>
                      {lead.phone || lead.direct_phone || '-'}
                    </td>
                    <td>
                      {lead.owner_name
                        ? lead.owner_name
                        : (lead.contact_name
                            ? (
                                <span>
                                  {lead.contact_name}
                                  {lead.contact_title && (
                                    <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', display: 'block' }}>
                                      {lead.contact_title}
                                    </span>
                                  )}
                                </span>
                              )
                            : '-'
                        )}
                    </td>
                    <td style={{ maxWidth: '180px' }}>
                      {lead.email ? (
                        <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px' }}>
                          <span style={{
                            width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0,
                            background: EMAIL_STATUS_DOT[lead.email_status || 'none'] || EMAIL_STATUS_DOT.none,
                          }} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lead.email}</span>
                        </span>
                      ) : (
                        <button
                          onClick={(e) => handleEnrich(lead, e)}
                          disabled={enrichingId === lead.id}
                          style={{
                            background: 'none', border: 'none', color: '#8b5cf6', cursor: 'pointer',
                            fontSize: '12px', padding: 0, textDecoration: 'underline',
                          }}
                        >
                          {enrichingId === lead.id ? 'Enriching...' : 'Enrich'}
                        </button>
                      )}
                    </td>
                    <td style={{ textAlign: 'center', fontSize: '13px', color: 'var(--text-secondary)' }}>
                      {lead.estimated_locations != null && lead.estimated_locations !== '' ? lead.estimated_locations : '-'}
                    </td>
                    <td style={{ maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '12px', color: 'var(--text-secondary)' }}>
                      {lead.hardware_vendors || '-'}
                    </td>
                    <td>
                      <span className={`badge badge-${lead.pipeline_stage}`}>
                        {STAGE_LABELS[lead.pipeline_stage] || lead.pipeline_stage}
                      </span>
                    </td>
                    <td>
                      {lead.last_contact_date
                        ? `${String(lead.last_contact_date).split('T')[0]} (${lead.last_contact_method || '-'})`
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
                      {lead.created_at ? String(lead.created_at).split('T')[0] : '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination footer */}
      <div className="lead-table-footer" style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 'var(--space-md)',
        flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
          {total === 0
            ? 'No leads'
            : `Showing ${showingFrom.toLocaleString()}–${showingTo.toLocaleString()} of ${total.toLocaleString()}`}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
          <button
            className="btn btn-sm btn-secondary"
            onClick={() => goToPage(page - 1)}
            disabled={page <= 1 || loading}
          >
            ← Previous
          </button>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)', minWidth: '100px', textAlign: 'center' }}>
            Page {page} of {totalPages}
          </span>
          <button
            className="btn btn-sm btn-secondary"
            onClick={() => goToPage(page + 1)}
            disabled={page >= totalPages || loading}
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}
