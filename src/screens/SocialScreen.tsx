import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import type { LocalUser } from '../lib/db.ts'
import {
  acceptFriend, getFriends, getLeaderboard, personName, removeFriend, sendFriendRequest, updateProfile,
  METRIC_LABELS, type FriendsList, type Leaderboard, type LeaderboardMetric, type LeaderboardScope,
} from '../lib/social.ts'
import { useOnline } from '../lib/useOnline.ts'

interface Props {
  user: LocalUser
  onUserChange: (user: LocalUser) => void
  onExit: () => void
}

export default function SocialScreen({ user, onUserChange, onExit }: Props) {
  const online = useOnline()

  return (
    <div style={{ textAlign: 'left' }}>
      <button onClick={onExit}>← Back</button>
      <h2 style={{ marginTop: 16 }}>Friends & leaderboard</h2>
      {!online
        ? <p>You're offline. Friends and leaderboards need a connection.</p>
        : (
          <>
            <Profile user={user} onUserChange={onUserChange} />
            {user.username && <Friends />}
            <LeaderboardView />
          </>
        )}
    </div>
  )
}

// ---- Profile: username + global leaderboard opt-in ---------------------------

function Profile({ user, onUserChange }: { user: LocalUser, onUserChange: (u: LocalUser) => void }) {
  const [username, setUsername] = useState(user.username ?? '')
  const [message, setMessage] = useState<string | null>(null)

  async function save(changes: { username?: string, showOnLeaderboard?: boolean }) {
    try {
      onUserChange(await updateProfile(changes))
      setMessage('✔ Saved')
    } catch (err) {
      setMessage((err as Error).message)
    }
  }

  return (
    <section style={section}>
      <h3 style={{ marginTop: 0 }}>Your profile</h3>
      {!user.username && <p style={{ fontSize: 14 }}>Pick a username so friends can find you. Your email is never shown to anyone.</p>}
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); void save({ username }) }} style={{ display: 'flex', gap: 8 }}>
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username"
          maxLength={20} style={{ flex: 1 }} />
        <button type="submit" disabled={username.trim().toLowerCase() === (user.username ?? '')}>Save</button>
      </form>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8, fontSize: 14 }}>
        <input type="checkbox" checked={user.showOnLeaderboard ?? false} disabled={!user.username}
          onChange={(e) => void save({ showOnLeaderboard: e.target.checked })} />
        Show me on the global leaderboard
      </label>
      {message && <p style={{ fontSize: 13, whiteSpace: 'pre-line', margin: '6px 0 0' }}>{message}</p>}
    </section>
  )
}

// ---- Friends -----------------------------------------------------------------------

function Friends() {
  const [list, setList] = useState<FriendsList | null>(null)
  const [username, setUsername] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    let alive = true
    getFriends().then((l) => { if (alive) setList(l) }, (err: Error) => { if (alive) setMessage(err.message) })
    return () => { alive = false }
  }, [reloadKey])

  async function act(action: () => Promise<unknown>, done?: string) {
    try {
      await action()
      setMessage(done ?? null)
      reload()
    } catch (err) {
      setMessage((err as Error).message)
    }
  }

  return (
    <section style={section}>
      <h3 style={{ marginTop: 0 }}>Friends</h3>
      <form onSubmit={(e) => {
        e.preventDefault()
        void act(async () => {
          const { status } = await sendFriendRequest(username)
          setMessage(status === 'accepted' ? `✔ You and @${username} are now friends` : `✔ Request sent to @${username}`)
          setUsername('')
        })
      }} style={{ display: 'flex', gap: 8 }}>
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Add friend by username" style={{ flex: 1 }} />
        <button type="submit" disabled={!username.trim()}>Add</button>
      </form>
      {message && <p style={{ fontSize: 13, margin: '6px 0 0' }}>{message}</p>}

      {list && list.incoming.length > 0 && (
        <>
          <h4>Friend requests</h4>
          {list.incoming.map((p) => (
            <div key={p.userId} style={row}>
              <span>{personName(p)}</span>
              <span style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => void act(() => acceptFriend(p.userId))}>Accept</button>
                <button onClick={() => void act(() => removeFriend(p.userId))}>Decline</button>
              </span>
            </div>
          ))}
        </>
      )}

      <h4>Your friends</h4>
      {list === null ? <p>Loading…</p> : list.friends.length === 0 ? <p style={{ fontSize: 14 }}>No friends yet.</p> : (
        list.friends.map((p) => (
          <div key={p.userId} style={row}>
            <span>{personName(p)}</span>
            <button onClick={() => { if (confirm(`Remove ${personName(p)} as a friend?`)) void act(() => removeFriend(p.userId)) }}>
              Remove
            </button>
          </div>
        ))
      )}

      {list && list.outgoing.length > 0 && (
        <>
          <h4>Waiting for them to accept</h4>
          {list.outgoing.map((p) => (
            <div key={p.userId} style={row}>
              <span>{personName(p)}</span>
              <button onClick={() => void act(() => removeFriend(p.userId))}>Cancel</button>
            </div>
          ))}
        </>
      )}
    </section>
  )
}

// ---- Leaderboard -------------------------------------------------------------------

function LeaderboardView() {
  const [scope, setScope] = useState<LeaderboardScope>('friends')
  const [metric, setMetric] = useState<LeaderboardMetric>('reviews7d')
  const [board, setBoard] = useState<Leaderboard | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    getLeaderboard(scope, metric).then(
      (b) => { if (alive) { setBoard(b); setError(null) } },
      (err: Error) => { if (alive) setError(err.message) },
    )
    return () => { alive = false }
  }, [scope, metric])

  return (
    <section style={section}>
      <h3 style={{ marginTop: 0 }}>Leaderboard</h3>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <select value={scope} onChange={(e) => setScope(e.target.value as LeaderboardScope)}>
          <option value="friends">Friends</option>
          <option value="global">Everyone</option>
        </select>
        <select value={metric} onChange={(e) => setMetric(e.target.value as LeaderboardMetric)}>
          {Object.entries(METRIC_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>

      {error && <p>{error}</p>}
      {board?.hiddenFromGlobal && (
        <p style={{ fontSize: 13, color: '#666' }}>Others can't see you here until you turn on "Show me on the global leaderboard".</p>
      )}
      {board && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <tbody>
            {board.entries.map((e) => (
              <tr key={e.userId} style={{ borderBottom: '1px solid #eee', fontWeight: e.isMe ? 'bold' : undefined }}>
                <td style={{ padding: '4px 0', width: 32 }}>{e.rank}.</td>
                <td>{e.isMe ? `You${e.username ? ` (@${e.username})` : ''}` : personName(e)}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{e.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {board && scope === 'friends' && board.entries.length <= 1 && (
        <p style={{ fontSize: 13, color: '#666' }}>Add friends to compete with them here.</p>
      )}
    </section>
  )
}

const section: CSSProperties = { border: '1px solid #ddd', borderRadius: 8, padding: 12, margin: '12px 0' }
const row: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', fontSize: 14 }
