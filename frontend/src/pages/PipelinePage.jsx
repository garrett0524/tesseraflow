import { useState, useEffect, useCallback } from 'react'
import StatsBar from '../components/Shared/StatsBar'
import KanbanBoard from '../components/Pipeline/KanbanBoard'
import LeadTable from '../components/Pipeline/LeadTable'
import LeadDetailModal from '../components/Shared/LeadDetailModal'
import TodayScheduleWidget from '../components/Calendar/TodayScheduleWidget'
import { getLeads, updateLead } from '../api'

export default function PipelinePage() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedLead, setSelectedLead] = useState(null);
  const [sortField, setSortField] = useState('created_at');
  const [sortDir, setSortDir] = useState('desc');

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

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh', color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)', fontSize: '14px' }}>
        Loading pipeline...
      </div>
    );
  }

  return (
    <div style={{ animation: 'fadeInContent 0.3s ease' }}>
      <div className="page-header">
        <h1>Pipeline</h1>
        <p>Lead pipeline overview</p>
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
    </div>
  );
}
