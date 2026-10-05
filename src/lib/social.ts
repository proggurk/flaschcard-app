// Friends, leaderboards and the public profile. These talk to the server
// directly (they're about other people), so they need a connection.
import { api } from './api.ts'
import { setMeta, type LocalUser } from './db.ts'

export interface Person {
  userId: string
  username: string | null
  displayName: string | null
}

export interface FriendsList {
  friends: Person[]
  incoming: Person[] // requests waiting for you to accept
  outgoing: Person[] // requests you sent
}

export type LeaderboardScope = 'friends' | 'global'
export type LeaderboardMetric = 'reviews7d' | 'mature' | 'days30d'

export const METRIC_LABELS: Record<LeaderboardMetric, string> = {
  reviews7d: 'Answers, last 7 days',
  mature: 'Mature cards',
  days30d: 'Days studied, last 30 days',
}

export interface Leaderboard {
  hiddenFromGlobal: boolean
  entries: (Person & { rank: number, value: number, isMe: boolean })[]
}

const ERRORS: Record<string, string> = {
  username_taken: 'That username is taken.',
  username_required: 'Pick a username first, so friends can find you.',
  user_not_found: 'No user with that username.',
  cannot_add_yourself: "That's you!",
  too_many_requests: 'Too many requests. Try again later.',
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res
  try {
    res = await api<T & { error?: string, issues?: string[] }>(method, path, body)
  } catch {
    throw new Error('You need to be online for this.')
  }
  if (!res.ok) {
    const { error, issues } = res.data
    throw new Error(issues?.join('\n') ?? (error && ERRORS[error]) ?? 'Something went wrong.')
  }
  return res.data
}

export async function updateProfile(changes: { username?: string, showOnLeaderboard?: boolean }): Promise<LocalUser> {
  const { user } = await call<{ user: LocalUser }>('PATCH', '/auth/profile', changes)
  await setMeta('user', user)
  return user
}

export const getFriends = () => call<FriendsList>('GET', '/social/friends')
export const sendFriendRequest = (username: string) =>
  call<{ status: 'pending' | 'accepted' }>('POST', '/social/friends/requests', { username })
export const acceptFriend = (userId: string) => call('POST', `/social/friends/requests/${userId}/accept`)
export const removeFriend = (userId: string) => call('DELETE', `/social/friends/${userId}`)

export const getLeaderboard = (scope: LeaderboardScope, metric: LeaderboardMetric) =>
  call<Leaderboard>('GET', `/social/leaderboard?scope=${scope}&metric=${metric}`)

export const personName = (p: Person) => p.displayName ? `${p.displayName} (@${p.username})` : `@${p.username}`
