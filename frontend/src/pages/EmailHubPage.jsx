import { useState, useEffect, useCallback } from 'react'
import SequenceStatus from '../components/EmailHub/SequenceStatus'
import DomainHealth from '../components/EmailHub/DomainHealth'
import { getEmails } from '../api'

export default function EmailHubPage() {
  const [emails, setEmails] = useState([]);
  const [sequences, setSequences] = useState([]);
  const [domains, setDomains] = useState([]);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const res = await getEmails();
      setEmails(res.data || []);
      setSequences(res.sequences || []);
      setDomains(res.domains || []);
      setErrors(res.errors || {});
    } catch (err) {
      console.error('Failed to load emails:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filteredEmails = filterStatus
    ? emails.filter(e => e.status === filterStatus)
    : emails;

  if (loading) {
    return <div style={{ padding: 'var(--space-3xl)', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading email hub...</div>;
  }

  const hasApiKey = errors.sequences !== 'no_api_key' && errors.domains !== 'no_api_key';

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Email Hub</h1>
          <p>Instantly.ai email campaigns, account health, and email timeline</p>
        </div>
        {hasApiKey && (
          <button
            className="btn btn-secondary"
            onClick={() => fetchData(true)}
            disabled={refreshing}
            style={{ marginTop: 'var(--space-sm)' }}
          >
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        )}
      </div>

      <SequenceStatus sequences={sequences} error={errors.sequences} />
      <DomainHealth domains={domains} error={errors.domains} />

      {/* Email Timeline */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' }}>
          <h3>Email Log</h3>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ width: '150px' }}>
            <option value="">All Status</option>
            <option value="sent">Sent</option>
            <option value="opened">Opened</option>
            <option value="replied">Replied</option>
            <option value="bounced">Bounced</option>
          </select>
        </div>

        <div className="card">
          {filteredEmails.length === 0 ? (
            <p style={{ color: 'var(--text-tertiary)', textAlign: 'center', padding: 'var(--space-3xl)' }}>
              No emails sent yet. Configure Instantly.ai in Settings and approve outreach to start sending.
            </p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Lead</th>
                  <th>Sequence</th>
                  <th>Step</th>
                  <th>Status</th>
                  <th>Sent</th>
                  <th>Opened</th>
                  <th>Replied</th>
                </tr>
              </thead>
              <tbody>
                {filteredEmails.map(email => (
                  <tr key={email.id}>
                    <td style={{ fontWeight: 500 }}>{email.business_name || `Lead #${email.lead_id}`}</td>
                    <td>{email.sequence_name || '-'}</td>
                    <td style={{ textAlign: 'center' }}>{email.step_number || '-'}</td>
                    <td>
                      <span className={`badge ${
                        email.status === 'replied' ? 'badge-meeting_booked' :
                        email.status === 'opened' ? 'badge-interested' :
                        email.status === 'bounced' ? 'badge-dead' :
                        'badge-contacted'
                      }`}>
                        {email.status}
                      </span>
                    </td>
                    <td style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{email.sent_at?.split('T')[0] || '-'}</td>
                    <td style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{email.opened_at?.split('T')[0] || '-'}</td>
                    <td style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{email.replied_at?.split('T')[0] || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
