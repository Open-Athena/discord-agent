import { useMeta } from '../hooks'
import { API_BASE } from '../api'
import Tooltip from './Tooltip'

function relativeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const s = Math.max(0, Math.round(diffMs / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  return `${d}d ago`
}

function absolute(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

export default function FreshnessFooter() {
  const { data: meta } = useMeta()
  if (!meta || !meta.latest_message_ts) return null

  const ago = relativeAgo(meta.latest_message_ts)
  const abs = absolute(meta.latest_message_ts)
  const apiUrl = new URL(API_BASE, window.location.href).href

  return (
    <Tooltip content={
      <div className="freshness-tooltip">
        <div className="freshness-row">
          <span className="freshness-label">Latest message</span>
          <span>{abs} ({ago})</span>
        </div>
        <div className="freshness-row">
          <span className="freshness-label">Messages</span>
          <span>{meta.total_messages.toLocaleString()}</span>
        </div>
        <div className="freshness-row">
          <span className="freshness-label">Channels</span>
          <span>{meta.total_channels.toLocaleString()}</span>
        </div>
        <div className="freshness-row">
          <span className="freshness-label">Users</span>
          <span>{meta.total_users.toLocaleString()}</span>
        </div>
        <hr className="freshness-divider" />
        <div className="freshness-links">
          <a href={apiUrl} target="_blank" rel="noopener noreferrer">
            D1 API (live) ↗
          </a>
          {meta.archive_db_url && (
            <a href={meta.archive_db_url} target="_blank" rel="noopener noreferrer">
              archive.db (daily) ↗
            </a>
          )}
        </div>
      </div>
    }>
      <div className="freshness-footer">
        <span>Updated {ago}</span>
        <span className="freshness-dot">·</span>
        <span>{meta.total_messages.toLocaleString()} msgs</span>
      </div>
    </Tooltip>
  )
}
