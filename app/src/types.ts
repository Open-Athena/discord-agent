export interface Channel {
  id: string
  name: string
  type: number
  position: number
  message_count: number
  oldest: string | null
  newest: string | null
}

export interface Attachment {
  id: string
  filename: string
  content_type: string
  size: number
  url: string
  width: number | null
  height: number | null
}

export interface Reaction {
  emoji_name: string
  emoji_id: string | null
  count: number
}

export interface Embed {
  type: string
  title: string | null
  description: string | null
  url: string | null
  thumbnail_url: string | null
  thumbnail_width: number | null
  thumbnail_height: number | null
  image_url: string | null
}

export interface Message {
  id: string
  channel_id: string
  author_id: string
  content: string
  timestamp: string
  edited_timestamp: string | null
  type: number
  flags: number
  pinned: boolean
  reference_message_id: string | null
  reference_channel_id: string | null
  thread_id: string | null
  username: string
  global_name: string | null
  avatar: string | null
  attachments: Attachment[]
  reactions: Reaction[]
  embeds: Embed[]
}

export interface SearchResult {
  id: string
  channel_id: string
  content: string
  timestamp: string
  username: string
  global_name: string | null
  avatar: string | null
  channel_name: string
}

export interface Thread {
  id: string
  parent_message_id: string
  name: string
  message_count: number
  archived: boolean
}

export interface User {
  id: string
  username: string
  global_name: string | null
  avatar: string | null
}

export interface Meta {
  latest_message_ts: string | null
  total_messages: number
  total_channels: number
  total_users: number
  guild_id: string | null
  archive_db_url: string | null
}
