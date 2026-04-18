import { type ReactNode } from 'react'
import type { Message as MessageType } from '../types'
import type { LookupData } from '../context'
import { useLookup } from '../context'
import { useMessage, usePrefetchMessages } from '../hooks'
import Tooltip from './Tooltip'

const DISCORD_URL_RE = /^https:\/\/discord\.com\/channels\/(\d+)\/(\d+)(?:\/(\d+))?(?:\/|$|\?|#)/

function parseDiscordLink(url: string): { guildId: string; channelId: string; messageId?: string } | null {
  const m = url.match(DISCORD_URL_RE)
  if (!m) return null
  return { guildId: m[1], channelId: m[2], messageId: m[3] }
}

function renderLink(
  url: string,
  text: string,
  key: string,
  lookup: LookupData,
  onPrefetchChannel?: (channelId: string) => void,
): ReactNode {
  const parsed = parseDiscordLink(url)
  if (parsed && lookup.guildId && parsed.guildId === lookup.guildId) {
    return (
      <DiscordLink
        key={key}
        channelId={parsed.channelId}
        messageId={parsed.messageId}
        guildId={lookup.guildId}
        onPrefetchChannel={onPrefetchChannel}
      >
        {text}
      </DiscordLink>
    )
  }
  return <a key={key} href={url} target="_blank" rel="noopener noreferrer">{text}</a>
}

function DiscordLink({
  channelId,
  messageId,
  guildId,
  className,
  children,
  onClick,
  onPrefetchChannel,
}: {
  channelId: string
  messageId?: string
  guildId: string | null
  className?: string
  children: ReactNode
  onClick?: (e: React.MouseEvent) => void
  onPrefetchChannel?: (channelId: string) => void
}) {
  const viewerHref = messageId ? `#${channelId}/${messageId}` : `#${channelId}`
  const discordUrl = guildId
    ? `https://discord.com/channels/${guildId}/${channelId}${messageId ? `/${messageId}` : ''}`
    : null
  const anchor = (
    <a
      className={className}
      href={viewerHref}
      onClick={onClick}
      onMouseEnter={() => onPrefetchChannel?.(channelId)}
    >
      {children}
    </a>
  )
  if (!discordUrl) return anchor
  return (
    <Tooltip interactive content={
      <div className="discord-link-tooltip">
        <div>View in archive (click)</div>
        <a href={discordUrl} target="_blank" rel="noopener noreferrer">
          Open in Discord ↗
        </a>
      </div>
    }>
      {anchor}
    </Tooltip>
  )
}

function avatarUrl(authorId: string, avatar: string | null): string {
  if (avatar) {
    return `https://cdn.discordapp.com/avatars/${authorId}/${avatar}.png?size=32`
  }
  return `https://cdn.discordapp.com/embed/avatars/${parseInt(authorId) % 5}.png`
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    + ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function renderContent(content: string, lookup: LookupData, onPrefetchChannel?: (channelId: string) => void): ReactNode[] {
  if (!content) return []

  const parts: ReactNode[] = []
  let key = 0

  // Split into code blocks first
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(...renderInline(content.slice(lastIndex, match.index), key, lookup, onPrefetchChannel))
      key += 100
    }
    parts.push(
      <pre key={`cb-${key++}`} className="code-block">
        <code>{match[2]}</code>
      </pre>
    )
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < content.length) {
    parts.push(...renderInline(content.slice(lastIndex), key, lookup, onPrefetchChannel))
  }

  return parts
}

function renderInline(text: string, keyOffset: number, lookup: LookupData, onPrefetchChannel?: (channelId: string) => void): ReactNode[] {
  const parts: ReactNode[] = []
  let key = keyOffset

  // Process inline patterns
  const inlineRegex = /(`[^`]+`)|(\*\*\*(.+?)\*\*\*)|(\*\*(.+?)\*\*)|(\*(.+?)\*)|(\|\|(.+?)\|\|)|(\[([^\]]+)\]\((https?:\/\/[^)]+)\))|(https?:\/\/[^\s<>)]+)|(<#(\d+)>)|(<@!?(\d+)>)|(<@&(\d+)>)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = inlineRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }

    if (match[1]) {
      // inline code
      parts.push(<code key={`ic-${key++}`} className="inline-code">{match[1].slice(1, -1)}</code>)
    } else if (match[3]) {
      // bold italic
      parts.push(<strong key={`bi-${key++}`}><em>{match[3]}</em></strong>)
    } else if (match[5]) {
      // bold
      parts.push(<strong key={`b-${key++}`}>{match[5]}</strong>)
    } else if (match[7]) {
      // italic
      parts.push(<em key={`i-${key++}`}>{match[7]}</em>)
    } else if (match[9]) {
      // spoiler
      parts.push(<span key={`sp-${key++}`} className="spoiler">{match[9]}</span>)
    } else if (match[10]) {
      // markdown link [text](url)
      parts.push(renderLink(match[12], match[11], `a-${key++}`, lookup, onPrefetchChannel))
    } else if (match[13]) {
      // bare link
      parts.push(renderLink(match[13], match[13], `a-${key++}`, lookup, onPrefetchChannel))
    } else if (match[14]) {
      // channel mention <#id>
      const chId = match[15]
      const ch = lookup.channels.get(chId)
      const chName = ch ? ch.name : 'unknown-channel'
      parts.push(
        <DiscordLink
          key={`ch-${key++}`}
          channelId={chId}
          guildId={lookup.guildId}
          className="mention"
          onPrefetchChannel={onPrefetchChannel}
        >
          #{chName}
        </DiscordLink>,
      )
    } else if (match[16]) {
      // user mention <@id> or <@!id>
      const user = lookup.users.get(match[17])
      const userName = user?.global_name || user?.username || 'Unknown User'
      parts.push(<span key={`um-${key++}`} className="mention">@{userName}</span>)
    } else if (match[18]) {
      // role mention <@&id>
      parts.push(<span key={`rm-${key++}`} className="mention">@role</span>)
    }

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts
}

function isSystemMessage(type: number): boolean {
  return type === 7 || type === 18
}

function PinnedSystemMessage({ msg, guildId }: { msg: MessageType; guildId: string | null }) {
  const author = msg.global_name || msg.username
  // Quirk: for type-18 pinned events, the DB stores the pinned message's ID in
  // `reference_channel_id` (and `reference_message_id` is null). `msg.content`
  // is Discord's own preview of the pinned content, so use it directly — no
  // follow-up fetch needed.
  const pinnedMsgId = msg.reference_message_id || msg.reference_channel_id
  const snippet = msg.content
    ? (msg.content.length > 80 ? msg.content.slice(0, 80) + '…' : msg.content)
    : null

  const body = snippet
    ? <><span className="pin-author">{author}</span> pinned <strong>{snippet}</strong></>
    : <><span className="pin-author">{author}</span> pinned a message</>

  return (
    <span className="pinned-system">
      <span className="pin-icon" aria-hidden>📌</span>
      {pinnedMsgId
        ? (
          <DiscordLink channelId={msg.channel_id} messageId={pinnedMsgId} guildId={guildId}>
            {body}
          </DiscordLink>
        )
        : <span>{body}</span>}
    </span>
  )
}

function renderSystemMessage(msg: MessageType, guildId: string | null): ReactNode {
  const author = msg.global_name || msg.username
  if (msg.type === 7) return <em>{author} joined the server.</em>
  if (msg.type === 18) return <PinnedSystemMessage msg={msg} guildId={guildId} />
  return null
}

interface ReplySnippetProps {
  messageId: string
}

function ReplySnippet({ messageId }: ReplySnippetProps) {
  const { data: refMsg } = useMessage(messageId)

  if (!refMsg) return <div className="reply-snippet">…</div>

  const displayName = refMsg.global_name || refMsg.username
  const snippet = refMsg.content.length > 100
    ? refMsg.content.slice(0, 100) + '…'
    : refMsg.content

  return (
    <div
      className="reply-snippet"
      onClick={() => { location.hash = `${refMsg.channel_id}/${refMsg.id}` }}
      role="link"
    >
      <img
        className="reply-avatar"
        src={avatarUrl(refMsg.author_id, refMsg.avatar)}
        alt=""
        width={18}
        height={18}
      />
      <span className="reply-author">@{displayName}</span>
      <span className="reply-text">{snippet}</span>
    </div>
  )
}

interface Props {
  message: MessageType
  compact: boolean
  targeted?: boolean
  onNavigate?: (channelId: string, messageId: string) => void
}

export default function MessageComponent({ message, compact, targeted, onNavigate }: Props) {
  const lookup = useLookup()
  const prefetch = usePrefetchMessages()

  if (isSystemMessage(message.type)) {
    return (
      <div className="message system-message" data-message-id={message.id}>
        {renderSystemMessage(message, lookup.guildId)}
        <DiscordLink
          channelId={message.channel_id}
          messageId={message.id}
          guildId={lookup.guildId}
          className="timestamp"
        >
          {formatTimestamp(message.timestamp)}
        </DiscordLink>
      </div>
    )
  }

  const displayName = message.global_name || message.username
  const avatar = avatarUrl(message.author_id, message.avatar)

  return (
    <div className={`message${compact ? ' compact' : ''}${targeted ? ' targeted' : ''}`} data-message-id={message.id}>
      {message.reference_message_id && (
        <ReplySnippet messageId={message.reference_message_id} />
      )}
      <div className="message-body">
        {compact ? (
          <div className="compact-gutter">
            <DiscordLink
              channelId={message.channel_id}
              messageId={message.id}
              guildId={lookup.guildId}
              className="compact-timestamp"
            >
              {new Date(message.timestamp).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
            </DiscordLink>
          </div>
        ) : (
          <img className="avatar" src={avatar} alt="" width={40} height={40} />
        )}
        <div className="message-content">
          {!compact && (
            <div className="message-header">
              <span className="author-name">{displayName}</span>
              <DiscordLink
                channelId={message.channel_id}
                messageId={message.id}
                guildId={lookup.guildId}
                className="timestamp"
              >
                {formatTimestamp(message.timestamp)}
              </DiscordLink>
              {message.edited_timestamp && <span className="edited">(edited)</span>}
            </div>
          )}
          <div className="message-text">{renderContent(message.content, lookup, (chId) => prefetch(chId))}</div>

          {message.attachments.length > 0 && (
            <div className="attachments">
              {message.attachments.map(att => {
                if (att.content_type?.startsWith('image/')) {
                  // Calculate display dimensions preserving aspect ratio
                  const maxW = 400, maxH = 300
                  let w = att.width || maxW, h = att.height || maxH
                  if (w > maxW) { h = Math.round(h * maxW / w); w = maxW }
                  if (h > maxH) { w = Math.round(w * maxH / h); h = maxH }
                  return (
                    <a key={att.id} href={att.url} target="_blank" rel="noopener noreferrer">
                      <img
                        className="attachment-image"
                        src={att.url}
                        alt={att.filename}
                        width={w}
                        height={h}
                        loading="lazy"
                        onError={e => {
                          const el = e.currentTarget
                          const link = el.parentElement as HTMLAnchorElement
                          // Replace with filename placeholder
                          link.replaceWith(Object.assign(document.createElement('div'), {
                            className: 'attachment-expired',
                            textContent: `📎 ${att.filename} (expired)`,
                          }))
                        }}
                      />
                    </a>
                  )
                }
                return (
                  <a key={att.id} className="attachment-file" href={att.url} target="_blank" rel="noopener noreferrer">
                    {att.filename} ({(att.size / 1024).toFixed(1)} KB)
                  </a>
                )
              })}
            </div>
          )}

          {message.embeds.length > 0 && (
            <div className="embeds">
              {message.embeds
                .filter(e => e.title || e.description)
                .map((embed, i) => {
                  // For article/link embeds, show image as small thumbnail on the right
                  const isArticle = embed.type === 'article' || embed.type === 'link'
                  const thumbSrc = embed.thumbnail_url || (isArticle ? embed.image_url : null)
                  const largeSrc = isArticle ? null : embed.image_url
                  return (
                    <div key={i} className={`embed${isArticle ? ' embed-article' : ''}`}>
                      <div className="embed-body">
                        {embed.title && (
                          <div className="embed-title">
                            {embed.url ? (
                              <a href={embed.url} target="_blank" rel="noopener noreferrer">{embed.title}</a>
                            ) : embed.title}
                          </div>
                        )}
                        {embed.description && (
                          <div className="embed-description">{embed.description}</div>
                        )}
                      </div>
                      {thumbSrc && (() => {
                        const img = <img className="embed-thumbnail" src={thumbSrc} alt="" loading="lazy" />
                        return embed.url
                          ? <a href={embed.url} target="_blank" rel="noopener noreferrer">{img}</a>
                          : img
                      })()}
                      {largeSrc && (() => {
                        const img = <img className="embed-image" src={largeSrc} alt="" loading="lazy" />
                        return embed.url
                          ? <a href={embed.url} target="_blank" rel="noopener noreferrer">{img}</a>
                          : img
                      })()}
                    </div>
                  )
                })}
            </div>
          )}

          {message.reactions.length > 0 && (
            <div className="reactions">
              {message.reactions.map((r, i) => {
                const emoji = r.emoji_id
                  ? <img className="reaction-emoji-img" src={`https://cdn.discordapp.com/emojis/${r.emoji_id}.webp?size=20`} alt={r.emoji_name} />
                  : <span className="reaction-emoji">{r.emoji_name}</span>
                return (
                  <Tooltip key={i} content={`:${r.emoji_name}:`}>
                    <span className="reaction">
                      {emoji}
                      <span className="reaction-count">{r.count}</span>
                    </span>
                  </Tooltip>
                )
              })}
            </div>
          )}

          {message.thread_id && (
            <div
              className="thread-link"
              onClick={() => onNavigate?.(message.thread_id!, '')}
            >
              View thread
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
