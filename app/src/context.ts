import { createContext, useContext } from 'react'
import type { Channel, User } from './types'

export interface LookupData {
  channels: Map<string, Channel>
  users: Map<string, User>
  guildId: string | null
}

export const LookupContext = createContext<LookupData>({
  channels: new Map(),
  users: new Map(),
  guildId: null,
})

export function useLookup() {
  return useContext(LookupContext)
}
