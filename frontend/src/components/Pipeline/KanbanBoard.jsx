import { useState, useEffect, useCallback } from 'react'
import KanbanCard from './KanbanCard'
import { getKanbanLeads, getLeadsByStage } from '../../api'
import './KanbanBoard.css'

const STAGES = [
  { key: 'new', label: 'New', color: 'var(--stage-new)' },
  { key: 'contacted', label: 'Contacted', color: 'var(--stage-contacted)' },
  { key: 'interested', label: 'Interested', color: 'var(--stage-interested)' },
  { key: 'meeting_booked', label: 'Meeting Booked', color: 'var(--stage-meeting)' },
  { key: 'technical_review', label: 'Technical Review', color: '#f97316' },
  { key: 'contract_sent', label: 'Contract Sent', color: '#a855f7' },
  { key: 'onboarding', label: 'Onboarding', color: '#6366f1' },
  { key: 'live', label: 'Live', color: '#22c55e' },
  { key: 'closed', label: 'Closed', color: 'var(--stage-closed)' },
  { key: 'dead', label: 'Dead', color: 'var(--stage-dead)' },
];

const PER_STAGE = 20;

export default function KanbanBoard({ onStageChange, onCardClick, refreshToken = 0 }) {
  const [byStage, setByStage] = useState({});
  const [totals, setTotals] = useState({});
  const [loadingMore, setLoadingMore] = useState({}); // { stageKey: true }
  const [draggedLead, setDraggedLead] = useState(null);

  const fetchKanban = useCallback(async () => {
    try {
      const res = await getKanbanLeads(PER_STAGE);
      setByStage(res.data || {});
      setTotals(res.totals || {});
    } catch (err) {
      console.error('Failed to load kanban:', err);
    }
  }, []);

  useEffect(() => {
    fetchKanban();
  }, [fetchKanban, refreshToken]);

  const getLeadsForStage = (stage) => byStage[stage] || [];

  const handleShowMore = async (stageKey) => {
    const current = getLeadsForStage(stageKey).length;
    const nextPage = Math.floor(current / PER_STAGE) + 1;
    setLoadingMore(prev => ({ ...prev, [stageKey]: true }));
    try {
      const res = await getLeadsByStage(stageKey, nextPage, PER_STAGE);
      const existing = getLeadsForStage(stageKey);
      const existingIds = new Set(existing.map(l => l.id));
      const merged = [...existing, ...(res.data || []).filter(l => !existingIds.has(l.id))];
      setByStage(prev => ({ ...prev, [stageKey]: merged }));
      if (res.total != null) {
        setTotals(prev => ({ ...prev, [stageKey]: res.total }));
      }
    } catch (err) {
      console.error('Failed to load more:', err);
    } finally {
      setLoadingMore(prev => ({ ...prev, [stageKey]: false }));
    }
  };

  const handleDragStart = (e, lead) => {
    setDraggedLead(lead);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e, stage) => {
    e.preventDefault();
    if (draggedLead && draggedLead.pipeline_stage !== stage) {
      // Optimistic: move card locally so the user sees the drop land instantly
      setByStage(prev => {
        const next = { ...prev };
        next[draggedLead.pipeline_stage] = (next[draggedLead.pipeline_stage] || [])
          .filter(l => l.id !== draggedLead.id);
        next[stage] = [{ ...draggedLead, pipeline_stage: stage }, ...(next[stage] || [])];
        return next;
      });
      setTotals(prev => ({
        ...prev,
        [draggedLead.pipeline_stage]: Math.max(0, (prev[draggedLead.pipeline_stage] || 0) - 1),
        [stage]: (prev[stage] || 0) + 1,
      }));
      onStageChange(draggedLead.id, stage);
    }
    setDraggedLead(null);
  };

  const handleDragEnd = () => {
    setDraggedLead(null);
  };

  return (
    <div className="kanban-board">
      {STAGES.map(stage => {
        const stageLeads = getLeadsForStage(stage.key);
        const total = totals[stage.key] ?? stageLeads.length;
        const hasMore = total > stageLeads.length;

        return (
          <div
            key={stage.key}
            className="kanban-column"
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, stage.key)}
          >
            <div className="kanban-column-header" style={{ borderTopColor: stage.color }}>
              <span className="kanban-column-dot" style={{ background: stage.color }}></span>
              <span className="kanban-column-title">{stage.label}</span>
              <span className="kanban-column-count" style={{ background: `${stage.color}15`, color: stage.color }}>
                {total}
              </span>
            </div>
            <div className="kanban-column-body">
              {stageLeads.map(lead => (
                <KanbanCard
                  key={lead.id}
                  lead={lead}
                  stageColor={stage.color}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onClick={() => onCardClick(lead)}
                />
              ))}
              {stageLeads.length === 0 && (
                <div className="kanban-empty">No leads</div>
              )}
              {hasMore && (
                <button
                  className="kanban-show-more"
                  onClick={() => handleShowMore(stage.key)}
                  disabled={loadingMore[stage.key]}
                >
                  {loadingMore[stage.key]
                    ? 'Loading...'
                    : `Show more (${total - stageLeads.length} more)`}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
