import { useEffect, useState } from 'react'
import { useMeta } from '../hooks'
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

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function useArchiveDbInfo(url: string | null) {
  const [info, setInfo] = useState<{ size: number; lastModified: string | null } | null>(null)
  useEffect(() => {
    if (!url) return
    let cancelled = false
    fetch(url, { method: 'HEAD' }).then(async res => {
      if (cancelled || !res.ok) return
      const size = parseInt(res.headers.get('content-length') || '0', 10)
      const lastModified = res.headers.get('last-modified')
      setInfo({ size, lastModified })
    }).catch(() => {})
    return () => { cancelled = true }
  }, [url])
  return info
}

export default function FreshnessFooter() {
  const { data: meta } = useMeta()
  const archiveInfo = useArchiveDbInfo(meta?.archive_db_url ?? null)
  if (!meta) return null

  const sync = meta.latest_sync
  const syncAgo = sync ? relativeAgo(sync.finished_at) : null
  const syncAbs = sync ? absolute(sync.finished_at) : null
  const msgAgo = meta.latest_message_ts ? relativeAgo(meta.latest_message_ts) : null
  const msgAbs = meta.latest_message_ts ? absolute(meta.latest_message_ts) : null

  // Footer text: prefer "synced" (DB freshness) when available; fall back
  // to the latest-message timestamp.
  const primaryLabel = syncAgo ? `Synced ${syncAgo}` : msgAgo ? `Latest msg ${msgAgo}` : 'Loading…'

  return (
    <Tooltip interactive content={
      <div className="freshness-tooltip">
        {sync && syncAbs && (
          <div className="freshness-row">
            <span className="freshness-label">Last sync</span>
            <span>
              {syncAbs} ({syncAgo})
              {sync.run_url ? <> · <a href={sync.run_url} target="_blank" rel="noopener noreferrer">{sync.source}</a></> : <> · {sync.source}</>}
              {sync.messages_added > 0 ? ` · +${sync.messages_added}` : ''}
            </span>
          </div>
        )}
        {msgAbs && (
          <div className="freshness-row">
            <span className="freshness-label">Latest msg</span>
            <span>{msgAbs} ({msgAgo})</span>
          </div>
        )}
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
        {meta.archive_db_url && (
          <>
            <hr className="freshness-divider" />
            <div className="freshness-links">
              <a href={meta.archive_db_url} target="_blank" rel="noopener noreferrer" download>
                ⬇ Download archive.db
                {archiveInfo && (
                  <span className="freshness-meta"> ({formatBytes(archiveInfo.size)}{
                    archiveInfo.lastModified
                      ? ` · ${relativeAgo(new Date(archiveInfo.lastModified).toISOString())}`
                      : ''
                  })</span>
                )}
              </a>
              <div className="freshness-hint">
                SQLite file, updated daily. Query with <code>sqlite3</code> or a notebook.
              </div>
            </div>
          </>
        )}
      </div>
    }>
      <div className="freshness-footer">
        <span>{primaryLabel}</span>
        <span className="freshness-dot">·</span>
        <span>{meta.total_messages.toLocaleString()} msgs</span>
      </div>
    </Tooltip>
  )
}
