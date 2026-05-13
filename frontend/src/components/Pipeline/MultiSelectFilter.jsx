import { useState, useRef, useEffect } from 'react'

/**
 * Checkbox-dropdown filter. Calls onChange(string[]) with the selected
 * values. Pass `label` (e.g. "Category") and `options` ([{value,label}] or
 * string[]). Leads matching ANY selected value will pass the filter
 * (semantics handled server-side).
 */
export default function MultiSelectFilter({
  label,
  options,
  selected = [],
  onChange,
  width = 160,
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Normalize options: accept string[] or {value,label}[]
  const opts = (options || []).map(o =>
    typeof o === 'string' ? { value: o, label: o } : o
  );

  // Click-outside closes the menu
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const isSelected = (v) => selected.includes(v);

  const toggleOne = (v) => {
    if (isSelected(v)) {
      onChange(selected.filter(x => x !== v));
    } else {
      onChange([...selected, v]);
    }
  };

  const selectAll = () => onChange(opts.map(o => o.value));
  const clearAll = () => onChange([]);

  const count = selected.length;
  const buttonLabel = count > 0 ? `${label} (${count})` : label;

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          background: 'var(--bg-tertiary)',
          border: count > 0 ? '1px solid var(--accent-primary)' : '1px solid var(--border-default)',
          borderRadius: 'var(--radius-md)',
          padding: '6px 10px',
          color: count > 0 ? 'var(--accent-primary)' : 'var(--text-primary)',
          fontSize: '13px',
          cursor: 'pointer',
          minWidth: width,
          textAlign: 'left',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span style={{ fontWeight: count > 0 ? 600 : 400 }}>{buttonLabel}</span>
        <span style={{ fontSize: '10px', opacity: 0.7 }}>▼</span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            zIndex: 50,
            background: 'var(--bg-card-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-elevated)',
            minWidth: Math.max(width, 200),
            maxHeight: 320,
            overflowY: 'auto',
            padding: '6px 0',
          }}
        >
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: '4px 12px 8px',
            borderBottom: '1px solid var(--border-default)',
            marginBottom: 4,
            fontSize: '11px',
          }}>
            <button
              type="button"
              onClick={selectAll}
              style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', fontSize: '11px', fontWeight: 600 }}
            >
              Select All
            </button>
            <button
              type="button"
              onClick={clearAll}
              style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '11px', fontWeight: 600 }}
            >
              Clear
            </button>
          </div>
          {opts.length === 0 ? (
            <div style={{ padding: '8px 12px', color: 'var(--text-tertiary)', fontSize: '12px' }}>
              No options
            </div>
          ) : (
            opts.map(opt => (
              <label
                key={opt.value}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 12px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  color: 'var(--text-primary)',
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <input
                  type="checkbox"
                  checked={isSelected(opt.value)}
                  onChange={() => toggleOne(opt.value)}
                  style={{ cursor: 'pointer' }}
                />
                {opt.label}
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}
