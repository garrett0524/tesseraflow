import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { enrichLead, getLeads } from '../../api'
import { useAuth } from '../../contexts/AuthContext'
import MultiSelectFilter from './MultiSelectFilter'
import BulkActionBar from './BulkActionBar'
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

const STAGE_OPTIONS = Object.entries(STAGE_LABELS).map(([value, label]) => ({ value, label }));

const KNOWN_CATEGORIES = [
  'Bars', 'Restaurants', 'Gyms', 'Gambling & Casinos',
  'ISP', 'MSP', 'IT Services', 'WISP', 'Enterprise IT', 'Other',
];

const PRIORITY_OPTIONS = [
  { value: 'Hot', label: 'Hot' },
  { value: 'Warm', label: 'Warm' },
  { value: 'Cold', label: 'Cold' },
  { value: 'None', label: 'None / Unset' },
];

const PRIORITY_STYLE = {
  Hot:  { bg: 'rgba(239,68,68,0.15)', color: '#ef4444' },
  Warm: { bg: 'rgba(251,191,36,0.15)', color: '#fbbf24' },
  Cold: { bg: 'rgba(96,165,250,0.15)', color: '#60a5fa' },
};

const EMAIL_STATUS_OPTIONS = [
  { value: 'no_email', label: 'No Email' },
  { value: 'has_email', label: 'Has Email' },
  { value: 'sent', label: 'Sent' },
  { value: 'opened', label: 'Opened' },
  { value: 'replied', label: 'Replied' },
  { value: 'bounced', label: 'Bounced' },
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
  const { isAdmin } = useAuth();
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

  // Selection state (lead IDs across all pages)
  const [selectedIds, setSelectedIds] = useState([]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  // "Select all matching filters" mode — when true, every lead matching the
  // current filter set is considered selected, not just the visible page.
  const [selectAllMatching, setSelectAllMatching] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState([]);
  const [stageFilter, setStageFilter] = useState([]);
  const [priorityFilter, setPriorityFilter] = useState([]);
  const [emailStatusFilter, setEmailStatusFilter] = useState([]);
  const [attempts, setAttempts] = useState('');
  const [scoreMin, setScoreMin] = useState('');
  const [scoreMax, setScoreMax] = useState('');

  // Debounce search 300ms
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Reset to page 1 whenever filters/search/sort change. Also drop the
  // select-all-matching flag — the filter set it was bound to no longer applies.
  const filterKey = `${debouncedSearch}|${categoryFilter.join(',')}|${stageFilter.join(',')}|${priorityFilter.join(',')}|${emailStatusFilter.join(',')}|${attempts}|${scoreMin}|${scoreMax}|${sortField}|${sortDir}`;
  useEffect(() => {
    setPage(1);
    setSelectAllMatching(false);
  }, [filterKey]);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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
      if (categoryFilter.length) params.category = categoryFilter;
      if (stageFilter.length) params.stage = stageFilter;
      if (priorityFilter.length) params.priority = priorityFilter;
      if (emailStatusFilter.length) params.email_status = emailStatusFilter;
      if (attempts) params.attempts = attempts;
      if (scoreMin) params.score_min = scoreMin;
      if (scoreMax) params.score_max = scoreMax;

      const res = await getLeads(params);
      if (myReqId !== reqIdRef.current) return;
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
  }, [page, sortField, sortDir, debouncedSearch, categoryFilter, stageFilter,
      priorityFilter, emailStatusFilter, attempts, scoreMin, scoreMax]);

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

  // Selection helpers
  const toggleRow = (id) => {
    // Toggling an individual row drops select-all-matching mode: the user is
    // narrowing their selection, so we collapse to the page's checked rows
    // minus (or plus) this one.
    if (selectAllMatching) {
      setSelectAllMatching(false);
      setSelectedIds(pageIds.filter(x => x !== id));
      return;
    }
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const pageIds = leads.map(l => l.id);
  const allOnPageSelected = selectAllMatching ||
    (pageIds.length > 0 && pageIds.every(id => selectedSet.has(id)));
  const someOnPageSelected = !selectAllMatching && pageIds.some(id => selectedSet.has(id));

  const togglePageSelection = () => {
    if (selectAllMatching) {
      // Header click while in select-all mode clears everything.
      setSelectAllMatching(false);
      setSelectedIds([]);
      return;
    }
    if (allOnPageSelected) {
      setSelectedIds(prev => prev.filter(id => !pageIds.includes(id)));
    } else {
      setSelectedIds(prev => [...new Set([...prev, ...pageIds])]);
    }
  };

  const clearSelection = () => {
    setSelectedIds([]);
    setSelectAllMatching(false);
  };

  const handleBulkComplete = () => {
    setSelectedIds([]);
    setSelectAllMatching(false);
    fetchPage();
  };

  // The filter set that defines what "all matching" means on the server.
  // Mirrors every filter that affects the displayed `total`, so the bulk
  // action count always matches the Y shown in the banner.
  const currentFilters = useMemo(() => ({
    category: categoryFilter,
    stage: stageFilter,
    priority: priorityFilter,
    emailStatus: emailStatusFilter,
    search: debouncedSearch,
    scoreMin: scoreMin,
    scoreMax: scoreMax,
    attempts: attempts,
  }), [categoryFilter, stageFilter, priorityFilter, emailStatusFilter,
       debouncedSearch, scoreMin, scoreMax, attempts]);

  // The banner only makes sense when (a) every visible row is checked and
  // (b) there's at least one more lead outside the current page.
  const showSelectAllBanner =
    !selectAllMatching && allOnPageSelected && pageIds.length > 0 && total > pageIds.length;

  // Categories shown in filter dropdown: known set ∪ what's in the current page
  const categoryOptions = useMemo(() => {
    const cats = new Set(leads.map(l => l.category).filter(Boolean));
    for (const c of KNOWN_CATEGORIES) cats.add(c);
    return [...cats].sort();
  }, [leads]);

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
        <MultiSelectFilter
          label="Category"
          options={categoryOptions}
          selected={categoryFilter}
          onChange={setCategoryFilter}
          width={150}
        />
        <MultiSelectFilter
          label="Stage"
          options={STAGE_OPTIONS}
          selected={stageFilter}
          onChange={setStageFilter}
          width={150}
        />
        <MultiSelectFilter
          label="Priority"
          options={PRIORITY_OPTIONS}
          selected={priorityFilter}
          onChange={setPriorityFilter}
          width={140}
        />
        <MultiSelectFilter
          label="Email Status"
          options={EMAIL_STATUS_OPTIONS}
          selected={emailStatusFilter}
          onChange={setEmailStatusFilter}
          width={150}
        />
        <select value={attempts} onChange={e => setAttempts(e.target.value)}>
          <option value="">All Attempts</option>
          <option value="0">0 attempts</option>
          <option value="1-3">1-3 attempts</option>
          <option value="4+">4+ attempts</option>
        </select>
        <input
          type="number"
          placeholder="Score min"
          value={scoreMin}
          onChange={e => setScoreMin(e.target.value)}
          style={{ width: '100px' }}
        />
        <input
          type="number"
          placeholder="Score max"
          value={scoreMax}
          onChange={e => setScoreMax(e.target.value)}
          style={{ width: '100px' }}
        />
      </div>

      {/* Select-all banner — surfaces when the page is fully checked but more
          leads match the current filters. */}
      {(showSelectAllBanner || selectAllMatching) && (
        <div
          style={{
            background: selectAllMatching ? 'rgba(99,102,241,0.14)' : 'rgba(99,102,241,0.08)',
            border: '1px solid var(--accent-primary)',
            borderRadius: 'var(--radius-md)',
            padding: '8px 14px',
            margin: 'var(--space-sm) 0',
            fontSize: '13px',
            color: 'var(--text-primary)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-sm)',
            flexWrap: 'wrap',
          }}
        >
          {selectAllMatching ? (
            <>
              <span>
                All <strong>{total.toLocaleString()}</strong> leads matching current filters are selected.
              </span>
              <button
                type="button"
                onClick={() => setSelectAllMatching(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--accent-primary)',
                  cursor: 'pointer',
                  fontSize: '13px',
                  textDecoration: 'underline',
                  padding: 0,
                }}
              >
                Clear selection
              </button>
            </>
          ) : (
            <>
              <span>
                All <strong>{pageIds.length}</strong> leads on this page selected.
              </span>
              <button
                type="button"
                onClick={() => setSelectAllMatching(true)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--accent-primary)',
                  cursor: 'pointer',
                  fontSize: '13px',
                  textDecoration: 'underline',
                  padding: 0,
                  fontWeight: 600,
                }}
              >
                Select all {total.toLocaleString()} leads matching current filters.
              </button>
            </>
          )}
        </div>
      )}

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
            leads.map(lead => {
              const checked = selectAllMatching || selectedSet.has(lead.id);
              return (
                <div
                  key={lead.id}
                  onClick={() => onRowClick(lead)}
                  style={{
                    background: checked ? 'rgba(99,102,241,0.08)' : 'var(--bg-card-elevated)',
                    border: checked ? '1px solid var(--accent-primary)' : '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-md)',
                    padding: 'var(--space-md)',
                    marginBottom: 'var(--space-sm)',
                    cursor: 'pointer',
                    minHeight: '44px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-xs)', gap: 'var(--space-sm)' }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleRow(lead.id)}
                      onClick={e => e.stopPropagation()}
                      style={{ flexShrink: 0, marginTop: 2 }}
                    />
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
                    {lead.priority && <PriorityBadge value={lead.priority} />}
                    <span className={`badge badge-${lead.pipeline_stage}`}>
                      {STAGE_LABELS[lead.pipeline_stage] || lead.pipeline_stage}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      ) : (
        /* Desktop Table */
        <div className="lead-table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 36, textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={allOnPageSelected}
                    ref={el => {
                      if (el) el.indeterminate = !allOnPageSelected && someOnPageSelected;
                    }}
                    onChange={togglePageSelection}
                    onClick={e => e.stopPropagation()}
                  />
                </th>
                <th onClick={() => handleSort('business_name')}>Name <SortIcon field="business_name" /></th>
                <th onClick={() => handleSort('category')}>Category <SortIcon field="category" /></th>
                <th>Address</th>
                <th>Phone</th>
                <th>Contact</th>
                <th>Email</th>
                <th onClick={() => handleSort('estimated_locations')}>Locations <SortIcon field="estimated_locations" /></th>
                <th>Hardware</th>
                <th>Priority</th>
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
                  <td colSpan={15} style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 'var(--space-3xl)' }}>
                    Loading...
                  </td>
                </tr>
              ) : leads.length === 0 ? (
                <tr>
                  <td colSpan={15} style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 'var(--space-3xl)' }}>
                    {total === 0 ? 'No leads match filters' : 'No leads on this page'}
                  </td>
                </tr>
              ) : (
                leads.map(lead => {
                  const checked = selectAllMatching || selectedSet.has(lead.id);
                  return (
                    <tr
                      key={lead.id}
                      onClick={() => onRowClick(lead)}
                      style={{
                        cursor: 'pointer',
                        background: checked ? 'rgba(99,102,241,0.06)' : undefined,
                      }}
                    >
                      <td
                        style={{ width: 36, textAlign: 'center' }}
                        onClick={e => { e.stopPropagation(); toggleRow(lead.id); }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleRow(lead.id)}
                          onClick={e => e.stopPropagation()}
                        />
                      </td>
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
                      <td><PriorityBadge value={lead.priority} /></td>
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
                  );
                })
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
        paddingBottom: (selectedIds.length > 0 || selectAllMatching) ? 80 : undefined,
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

      <BulkActionBar
        selectedIds={selectedIds}
        selectAll={selectAllMatching}
        filters={currentFilters}
        totalMatching={total}
        onClearSelection={clearSelection}
        onComplete={handleBulkComplete}
        isAdmin={isAdmin}
      />
    </div>
  );
}

function PriorityBadge({ value }) {
  if (!value || String(value).toLowerCase() === 'none') {
    return <span style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>-</span>;
  }
  const style = PRIORITY_STYLE[value] || { bg: 'rgba(107,114,128,0.15)', color: '#9ca3af' };
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 'var(--radius-full)',
      fontSize: '11px',
      fontWeight: 600,
      background: style.bg,
      color: style.color,
      textTransform: 'uppercase',
    }}>
      {value}
    </span>
  );
}
