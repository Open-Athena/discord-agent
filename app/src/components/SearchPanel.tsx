import { useState, useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { useSearch, usePrefetchMessages } from '../hooks'
import { useLookup } from '../context'

interface Props {
  inputRef?: RefObject<HTMLInputElement | null>
  hidden?: boolean
  onNavigate: (channelId: string, messageId: string) => void
  onClose: () => void
}

export default function SearchPanel({ inputRef: externalRef, hidden, onNavigate, onClose }: Props) {
  const lookup = useLookup()
  const prefetch = usePrefetchMessages()
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const internalRef = useRef<HTMLInputElement>(null)
  const inputRef = externalRef || internalRef

  useEffect(() => {
    if (!hidden) inputRef.current?.focus()
  }, [hidden])

  // Debounce the query
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300)
    return () => clearTimeout(timer)
  }, [query])

  const { data: results = [], isLoading } = useSearch(debouncedQuery)
  const [selectedIdx, setSelectedIdx] = useState(-1)

  // Reset selection when query changes
  useEffect(() => { setSelectedIdx(-1) }, [query])

  // Autocomplete suggestions for #channel and @user
  const suggestions = (() => {
    const q = query.trim()
    if (q.startsWith('#')) {
      const name = q.slice(1).toLowerCase()
      return [...lookup.channels.values()]
        .filter(c => c.type !== 11 && c.name.toLowerCase().includes(name))
        .sort((a, b) => b.message_count - a.message_count)
        .slice(0, 10)
        .map(c => ({ type: 'channel' as const, id: c.id, label: `#${c.name}`, count: c.message_count }))
    }
    if (q.startsWith('@')) {
      const name = q.slice(1).toLowerCase()
      return [...lookup.users.values()]
        .filter(u => (u.global_name || u.username).toLowerCase().includes(name))
        .slice(0, 10)
        .map(u => ({ type: 'user' as const, id: u.id, label: `@${u.global_name || u.username}`, count: 0 }))
    }
    return []
  })()

  function snippetAround(text: string, q: string, maxLen: number): string {
    if (text.length <= maxLen) return text
    const needle = q.toLowerCase()
    const idx = text.toLowerCase().indexOf(needle)
    if (idx < 0) return text.slice(0, maxLen) + '...'
    const padding = Math.floor((maxLen - needle.length) / 2)
    const start = Math.max(0, idx - padding)
    const end = Math.min(text.length, idx + needle.length + padding)
    let snippet = text.slice(start, end)
    if (start > 0) snippet = '...' + snippet
    if (end < text.length) snippet = snippet + '...'
    return snippet
  }

  function resolveMentions(text: string): string {
    return text
      .replace(/<#(\d+)>/g, (_, id) => {
        const ch = lookup.channels.get(id)
        return ch ? `#${ch.name}` : '#unknown-channel'
      })
      .replace(/<@!?(\d+)>/g, (_, id) => {
        const user = lookup.users.get(id)
        return user ? `@${user.global_name || user.username}` : '@unknown-user'
      })
      .replace(/<@&(\d+)>/g, '@role')
  }

  function highlightMatch(text: string, q: string): ReactNode {
    if (!q.trim()) return <>{text}</>
    const regex = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
    const parts = text.split(regex)
    return (
      <>
        {parts.map((part, i) =>
          regex.test(part)
            ? <mark key={i}>{part}</mark>
            : part
        )}
      </>
    )
  }

  function avatarUrl(authorId: string | undefined, avatar: string | null): string {
    if (!authorId) return `https://cdn.discordapp.com/embed/avatars/0.png`
    if (avatar) return `https://cdn.discordapp.com/avatars/${authorId}/${avatar}.png?size=32`
    return `https://cdn.discordapp.com/embed/avatars/${parseInt(authorId) % 5}.png`
  }

  return (
    <div className={`search-panel${hidden ? ' hidden' : ''}`}>
      <div className="search-header">
        <input
          ref={inputRef}
          className="search-input"
          type="text"
          placeholder="Search messages..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') { onClose(); return }
            const totalItems = suggestions.length + results.length
            if (totalItems > 0) {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSelectedIdx(i => Math.min(i + 1, totalItems - 1))
                return
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSelectedIdx(i => Math.max(i - 1, -1))
                return
              }
              if (e.key === 'Enter' && selectedIdx >= 0) {
                e.preventDefault()
                if (selectedIdx < suggestions.length) {
                  const s = suggestions[selectedIdx]
                  if (s.type === 'channel') location.hash = s.id
                  else setQuery(`@${s.label.slice(1)}`)
                } else {
                  const r = results[selectedIdx - suggestions.length]
                  if (r) onNavigate(r.channel_id, r.id)
                }
                return
              }
            }
          }}
        />
        <button className="search-close" onClick={onClose}>X</button>
      </div>
      <div className="search-results">
        {suggestions.length > 0 && (
          <div className="search-suggestions">
            {suggestions.map((s, i) => (
              <div
                key={s.id}
                className={`search-suggestion${i === selectedIdx ? ' selected' : ''}`}
                onClick={() => {
                  if (s.type === 'channel') {
                    location.hash = s.id
                  } else {
                    setQuery(`@${s.label.slice(1)}`)
                  }
                }}
                onMouseEnter={() => {
                  if (s.type === 'channel') prefetch(s.id)
                }}
              >
                <span className="search-suggestion-label">{s.label}</span>
                {s.count > 0 && <span className="search-suggestion-count">{s.count.toLocaleString()}</span>}
              </div>
            ))}
          </div>
        )}
        {isLoading && <div className="search-loading">Searching...</div>}
        {!isLoading && debouncedQuery && results.length === 0 && suggestions.length === 0 && (
          <div className="search-empty">No results found</div>
        )}
        {results.map((r, i) => (
          <div
            key={r.id}
            className={`search-result${i + suggestions.length === selectedIdx ? ' selected' : ''}`}
            onClick={() => onNavigate(r.channel_id, r.id)}
            onMouseEnter={() => prefetch(r.channel_id, r.id)}
          >
            <div className="search-result-header">
              <img
                className="search-result-avatar"
                src={avatarUrl(undefined, r.avatar)}
                alt=""
                width={20}
                height={20}
              />
              <span className="search-result-author">{r.global_name || r.username}</span>
              <span className="search-result-channel">#{r.channel_name}</span>
              <span className="search-result-time">
                {new Date(r.timestamp).toLocaleDateString()}
              </span>
            </div>
            <div className="search-result-content">
              {(() => {
                const resolved = resolveMentions(r.content)
                const display = snippetAround(resolved, debouncedQuery, 200)
                return highlightMatch(display, debouncedQuery)
              })()}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
