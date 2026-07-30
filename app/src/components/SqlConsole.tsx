import { useEffect, useRef, useState } from 'react'
import { runSql } from '../api'
import type { SqlResult } from '../types'

interface Props {
  hidden?: boolean
  onClose: () => void
}

const EXAMPLES: { label: string; sql: string }[] = [
  {
    label: 'Top posters',
    sql: `SELECT u.global_name, COUNT(*) n
FROM messages m JOIN users u ON m.author_id = u.id
GROUP BY 1 ORDER BY n DESC LIMIT 20`,
  },
  {
    label: 'Busiest channels',
    sql: `SELECT c.name, COUNT(*) n
FROM messages m JOIN channels c ON m.channel_id = c.id
WHERE c.type = 0
GROUP BY 1 ORDER BY n DESC LIMIT 20`,
  },
  {
    label: 'Messages per week',
    sql: `SELECT strftime('%Y-%W', timestamp) week, COUNT(*) n
FROM messages
GROUP BY 1 ORDER BY 1 DESC LIMIT 26`,
  },
  {
    label: 'Full-text search',
    sql: `SELECT c.name channel, substr(m.content, 1, 120) content, m.timestamp
FROM messages_fts f
JOIN messages m ON m.rowid = f.rowid
JOIN channels c ON m.channel_id = c.id
WHERE messages_fts MATCH 'scaling laws'
ORDER BY m.timestamp DESC LIMIT 20`,
  },
  {
    label: 'Schema',
    sql: `SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
  },
]

function download(filename: string, mime: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function toCsv(result: SqlResult): string {
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [result.columns.map(esc).join(','), ...result.rows.map(r => r.map(esc).join(','))].join('\n') + '\n'
}

export default function SqlConsole({ hidden, onClose }: Props) {
  const [sql, setSql] = useState(EXAMPLES[0].sql)
  const [result, setResult] = useState<SqlResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!hidden) textareaRef.current?.focus()
  }, [hidden])

  async function run(query?: string) {
    const q = (query ?? sql).trim()
    if (!q || running) return
    setRunning(true)
    setError(null)
    try {
      setResult(await runSql(q))
    } catch (e) {
      setResult(null)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className={`sql-panel${hidden ? ' hidden' : ''}`}>
      <div className="sql-header">
        <span className="sql-title">SQL console</span>
        <span className="sql-hint">read-only · 1,000-row cap · D1-backed</span>
        <button className="search-close" onClick={onClose}>X</button>
      </div>
      <div className="sql-examples">
        {EXAMPLES.map(ex => (
          <button
            key={ex.label}
            className="sql-example"
            onClick={() => { setSql(ex.sql); run(ex.sql) }}
          >
            {ex.label}
          </button>
        ))}
      </div>
      <textarea
        ref={textareaRef}
        className="sql-input"
        value={sql}
        rows={Math.min(12, Math.max(3, sql.split('\n').length))}
        spellCheck={false}
        onChange={e => setSql(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape') { onClose(); return }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            run()
          }
        }}
      />
      <div className="sql-actions">
        <button className="sql-run" onClick={() => run()} disabled={running}>
          {running ? 'Running…' : 'Run'}
        </button>
        <span className="sql-hint">⌘/Ctrl-Enter</span>
        {result && (
          <>
            <span className="sql-stats">
              {result.row_count.toLocaleString()} row{result.row_count === 1 ? '' : 's'}
              {result.truncated ? ' (truncated)' : ''} · {result.elapsed_ms}ms
            </span>
            <button className="sql-export" onClick={() => download('query.csv', 'text/csv', toCsv(result))}>CSV</button>
            <button
              className="sql-export"
              onClick={() => download('query.json', 'application/json', JSON.stringify(
                result.rows.map(r => Object.fromEntries(result.columns.map((c, i) => [c, r[i]]))), null, 2,
              ))}
            >
              JSON
            </button>
          </>
        )}
      </div>
      {error && <div className="sql-error">{error}</div>}
      {result && (
        <div className="sql-results">
          <table>
            <thead>
              <tr>{result.columns.map(c => <th key={c}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {result.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((v, j) => <td key={j}>{v == null ? <span className="sql-null">null</span> : String(v)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
