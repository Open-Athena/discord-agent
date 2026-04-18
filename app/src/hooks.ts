import { useEffect, useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchChannels,
  fetchMessage,
  fetchMessages,
  fetchMessagesAround,
  fetchMeta,
  fetchUsers,
  searchMessages,
} from './api'
import type { Channel, Message, Meta, SearchResult, User } from './types'

export function useChannels() {
  return useQuery<Channel[]>({
    queryKey: ['channels'],
    queryFn: fetchChannels,
    staleTime: 5 * 60 * 1000,
  })
}

export function useUsers() {
  return useQuery<User[]>({
    queryKey: ['users'],
    queryFn: fetchUsers,
    staleTime: 5 * 60 * 1000,
  })
}

/** Returns a counter that increments every `intervalMs`, forcing re-render.
 * Use when a component renders a value (e.g. "Nm ago") that's derived from
 * the wall clock and should advance without waiting for data to change. */
export function useTick(intervalMs: number): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setN((x) => x + 1), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return n
}

export function useMeta() {
  return useQuery<Meta>({
    queryKey: ['meta'],
    queryFn: fetchMeta,
    staleTime: 30 * 1000,
    // Poll every 60s so new CFW/GHA sync_runs show up without a reload.
    refetchInterval: 60 * 1000,
    refetchIntervalInBackground: false,
  })
}

export function useMessages(channelId: string, targetMessageId?: string | null) {
  return useQuery<Message[]>({
    queryKey: ['messages', channelId, targetMessageId || 'latest'],
    queryFn: async () => {
      if (targetMessageId) {
        // Fetch around target AND newest, merge
        const [around, newest] = await Promise.all([
          fetchMessagesAround(channelId, targetMessageId, 50),
          fetchMessages(channelId, { limit: 50 }),
        ])
        const seen = new Set<string>()
        const merged: Message[] = []
        for (const msg of [...around, ...newest]) {
          if (!seen.has(msg.id)) {
            seen.add(msg.id)
            merged.push(msg)
          }
        }
        // Sort chronologically (oldest first)
        merged.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        return merged
      }
      // Default: newest first from API, reverse to chronological
      const msgs = await fetchMessages(channelId, { limit: 50 })
      return [...msgs].reverse()
    },
    // Keep showing the previous channel's messages while the new query runs —
    // prevents the "Loading..." flash when clicking a permalink within the
    // same channel (targetMessageId change triggers a new query).
    placeholderData: keepPreviousData,
    staleTime: 30 * 1000,
  })
}

export function useOlderMessages(channelId: string, beforeId: string | null) {
  return useQuery<Message[]>({
    queryKey: ['messages-older', channelId, beforeId],
    queryFn: () => fetchMessages(channelId, { limit: 50, before: beforeId! }),
    enabled: !!beforeId,
    staleTime: Infinity, // Older messages don't change
  })
}

export function useMessage(messageId: string | null) {
  return useQuery<Message>({
    queryKey: ['message', messageId],
    queryFn: () => fetchMessage(messageId!),
    enabled: !!messageId,
    staleTime: 60 * 1000,
  })
}

export function useSearch(query: string) {
  return useQuery<SearchResult[]>({
    queryKey: ['search', query],
    queryFn: () => searchMessages(query),
    enabled: query.trim().length > 0,
    staleTime: 30 * 1000,
  })
}

export function usePrefetchMessages() {
  const queryClient = useQueryClient()
  return (channelId: string, targetMessageId?: string) => {
    const key = targetMessageId || 'latest'
    queryClient.prefetchQuery({
      queryKey: ['messages', channelId, key],
      queryFn: async () => {
        if (targetMessageId) {
          const [around, newest] = await Promise.all([
            fetchMessagesAround(channelId, targetMessageId, 50),
            fetchMessages(channelId, { limit: 50 }),
          ])
          const seen = new Set<string>()
          const merged: Message[] = []
          for (const msg of [...around, ...newest]) {
            if (!seen.has(msg.id)) {
              seen.add(msg.id)
              merged.push(msg)
            }
          }
          merged.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
          return merged
        }
        const msgs = await fetchMessages(channelId, { limit: 50 })
        return [...msgs].reverse()
      },
      staleTime: 30 * 1000,
    })
  }
}
