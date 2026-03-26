import { useState, useEffect, useCallback } from 'react'
import type { Channel } from './types'
import ChannelList from './components/ChannelList'
import MessageList from './components/MessageList'
import SearchPanel from './components/SearchPanel'
import './App.css'

function parseHash(): { channelId: string | null; messageId: string | null } {
  const hash = window.location.hash.replace('#', '')
  if (!hash) return { channelId: null, messageId: null }
  const parts = hash.split('/')
  return {
    channelId: parts[0] || null,
    messageId: parts[1] || null,
  }
}

export default function App() {
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null)
  const [targetMessageId, setTargetMessageId] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)

  // Parse hash on load
  useEffect(() => {
    const { channelId, messageId } = parseHash()
    if (channelId) {
      // Create a minimal channel object; MessageList only needs the id
      setActiveChannel({ id: channelId, name: '', type: 0, position: 0, message_count: 0, oldest: null, newest: null })
      if (messageId) setTargetMessageId(messageId)
    }
  }, [])

  const handleSelectChannel = useCallback((channel: Channel) => {
    setActiveChannel(channel)
    setTargetMessageId(null)
    window.location.hash = channel.id
  }, [])

  const handleNavigate = useCallback((channelId: string, messageId: string) => {
    window.location.hash = messageId ? `${channelId}/${messageId}` : channelId
    if (!activeChannel || activeChannel.id !== channelId) {
      setActiveChannel({ id: channelId, name: '', type: 0, position: 0, message_count: 0, oldest: null, newest: null })
    }
    setTargetMessageId(messageId || null)
  }, [activeChannel])

  return (
    <div className="app">
      <div className="sidebar">
        <div className="sidebar-header">
          <h1>Discord Archive</h1>
        </div>
        <ChannelList
          activeChannelId={activeChannel?.id ?? null}
          onSelectChannel={handleSelectChannel}
        />
      </div>
      <div className="main">
        <div className="main-header">
          <div className="main-header-left">
            {activeChannel && (
              <>
                <span className="header-hash">#</span>
                <span className="header-channel-name">{activeChannel.name}</span>
              </>
            )}
          </div>
          <button
            className="search-toggle"
            onClick={() => setSearchOpen(!searchOpen)}
          >
            Search
          </button>
        </div>
        <div className="main-content">
          {activeChannel ? (
            <MessageList
              key={`${activeChannel.id}-${targetMessageId || ''}`}
              channelId={activeChannel.id}
              targetMessageId={targetMessageId}
              onNavigate={handleNavigate}
            />
          ) : (
            <div className="no-channel">Select a channel to view messages</div>
          )}
        </div>
        {searchOpen && (
          <SearchPanel
            onNavigate={handleNavigate}
            onClose={() => setSearchOpen(false)}
          />
        )}
      </div>
    </div>
  )
}
