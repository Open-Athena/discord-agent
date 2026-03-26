import { useEffect, useState } from 'react'
import type { Channel } from '../types'
import { fetchChannels, prefetchMessages } from '../api'

interface Props {
  activeChannelId: string | null
  onSelectChannel: (channel: Channel) => void
}

export default function ChannelList({ activeChannelId, onSelectChannel }: Props) {
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchChannels()
      .then(chs => {
        chs.sort((a, b) => a.name.localeCompare(b.name))
        setChannels(chs)
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="channel-list-loading">Loading channels...</div>

  return (
    <div className="channel-list">
      {channels.map(ch => (
        <div
          key={ch.id}
          className={`channel-item${ch.id === activeChannelId ? ' active' : ''}`}
          onClick={() => onSelectChannel(ch)}
          onMouseEnter={() => prefetchMessages(ch.id)}
        >
          <span className="channel-hash">#</span>
          <span className="channel-name">{ch.name}</span>
          <span className="channel-count">{ch.message_count.toLocaleString()}</span>
        </div>
      ))}
    </div>
  )
}
