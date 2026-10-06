import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { LocalUser } from '../lib/db.ts'
import {
  acceptFriend, getFriends, getLeaderboard, removeFriend, sendFriendRequest,
  METRIC_LABELS, type FriendsList, type Leaderboard, type LeaderboardMetric, type LeaderboardScope, type Person,
} from '../lib/social.ts'
import { useOnline } from '../lib/useOnline.ts'
import { useNav } from '../ui/nav.ts'
import Screen from '../ui/Screen.tsx'
import { Avatar, EmptyState, Group, Row, Section, Segmented, SelectPill } from '../ui/controls.tsx'

const MEDALS = ['🥇', '🥈', '🥉']

const displayTitle = (p: Person) => p.displayName ?? `@${p.username}`
const displaySub = (p: Person) => (p.displayName ? `@${p.username}` : undefined)

export default function FriendsScreen({ user }: { user: LocalUser }) {
  const nav = useNav()
  const online = useOnline()
  // Bumped after any friend change, so the lists and the leaderboard reload
  const [changes, setChanges] = useState(0)
  const changed = useCallback(() => setChanges((n) => n + 1), [])

  return (
    <Screen title="Friends">
      {!online ? (
        <EmptyState icon="cloudOff" title="You're offline" text="Friends and leaderboards need a connection. Studying works offline as usual." />
      ) : !user.username ? (
        <EmptyState icon="people" title="Pick a username"
          text="Friends find you by your username. Your email is never shown to anyone.">
          <button className="btn btn-primary" onClick={() => nav.setTab('profile')}>Choose a username</button>
        </EmptyState>
      ) : (
        <>
          <LeaderboardView changes={changes} />
          <FriendsView onChange={changed} changes={changes} />
        </>
      )}
    </Screen>
  )
}

// ---- Leaderboard ------------------------------------------------------------------

function LeaderboardView({ changes }: { changes: number }) {
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
  }, [scope, metric, changes])

  const footer = error ?? (board?.hiddenFromGlobal && scope === 'global'
    ? 'Others can\'t see you here until you turn on "Show me on the global leaderboard" in Profile.'
    : board && scope === 'friends' && board.entries.length <= 1 ? 'Add friends below to compete with them here.' : undefined)

  return (
    <Section title="Leaderboard" footer={footer} error={!!error}>
      <div className="pad" style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
        <Segmented label="Leaderboard" value={scope} onChange={setScope}
          options={[{ value: 'friends', label: 'Friends' }, { value: 'global', label: 'Everyone' }]} />
        <div>
          <SelectPill label="Ranked by" value={metric} onChange={setMetric}
            options={Object.entries(METRIC_LABELS).map(([value, label]) => ({ value: value as LeaderboardMetric, label }))} />
        </div>
      </div>
      {board && board.entries.length > 0 && (
        <Group>
          {board.entries.map((e) => (
            <div key={e.userId} className="row with-avatar" style={e.isMe ? { background: 'var(--accent-tint)' } : undefined}>
              <span style={{ width: 22, flex: 'none', textAlign: 'center', fontWeight: 600, color: 'var(--label-2)', fontVariantNumeric: 'tabular-nums' }}>
                {MEDALS[e.rank - 1] ?? e.rank}
              </span>
              <Avatar id={e.userId} name={e.username ?? '?'} />
              <div className="row-main">
                <div className="row-title" style={e.isMe ? { fontWeight: 600 } : undefined}>{e.isMe ? 'You' : displayTitle(e)}</div>
                {(e.isMe ? e.username && `@${e.username}` : displaySub(e)) && (
                  <div className="row-sub">{e.isMe ? `@${e.username}` : displaySub(e)}</div>
                )}
              </div>
              <span className="row-value" style={{ color: 'var(--label)', fontWeight: 600 }}>{e.value.toLocaleString()}</span>
            </div>
          ))}
        </Group>
      )}
    </Section>
  )
}

// ---- Adding and managing friends ---------------------------------------------------------

function FriendsView({ onChange, changes }: { onChange: () => void, changes: number }) {
  const [list, setList] = useState<FriendsList | null>(null)
  const [username, setUsername] = useState('')
  const [message, setMessage] = useState<{ text: string, error: boolean } | null>(null)

  useEffect(() => {
    let alive = true
    getFriends().then((l) => { if (alive) setList(l) }, (err: Error) => { if (alive) setMessage({ text: err.message, error: true }) })
    return () => { alive = false }
  }, [changes])

  // Runs a change; if the action returns a string, it's shown as confirmation
  async function act(action: () => Promise<unknown>) {
    try {
      const result = await action()
      setMessage(typeof result === 'string' ? { text: result, error: false } : null)
      onChange()
    } catch (err) {
      setMessage({ text: (err as Error).message, error: true })
    }
  }

  function add(e: FormEvent) {
    e.preventDefault()
    const name = username.trim().replace(/^@/, '')
    if (!name) return
    void act(async () => {
      const { status } = await sendFriendRequest(name)
      setUsername('')
      return status === 'accepted'
        ? `You and @${name} are now friends.`
        : `Request sent to @${name}. You'll be friends once they accept.`
    })
  }

  return (
    <>
      <Section title="Add a friend" footer={message?.text} error={message?.error}>
        <Group>
          <form className="row" onSubmit={add}>
            <span className="input-prefix">@</span>
            <input className="row-input" value={username} onChange={(e) => setUsername(e.target.value)}
              placeholder="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="send"
              aria-label="Friend's username" />
            <button type="submit" className="pill" disabled={!username.trim()} style={{ opacity: username.trim() ? 1 : 0.4 }}>Add</button>
          </form>
        </Group>
      </Section>

      {list && list.incoming.length > 0 && (
        <Section title="Friend requests">
          <Group>
            {list.incoming.map((p) => (
              <Row key={p.userId} inset="avatar" icon={<Avatar id={p.userId} name={p.username ?? '?'} />}
                title={displayTitle(p)} sub={displaySub(p)}
                trailing={<span style={{ display: 'flex', gap: 6 }}>
                  <button className="pill" onClick={() => void act(() => acceptFriend(p.userId))}>Accept</button>
                  <button className="pill gray" onClick={() => void act(() => removeFriend(p.userId))}>Decline</button>
                </span>} />
            ))}
          </Group>
        </Section>
      )}

      <Section title={list ? `Your friends (${list.friends.length})` : 'Your friends'}>
        <Group>
          {list?.friends.length === 0 && <Row title={<span style={{ color: 'var(--label-2)' }}>No friends yet</span>} />}
          {list?.friends.map((p) => (
            <Row key={p.userId} inset="avatar" icon={<Avatar id={p.userId} name={p.username ?? '?'} />}
              title={displayTitle(p)} sub={displaySub(p)}
              trailing={<button className="pill gray" onClick={() => {
                if (confirm(`Remove ${displayTitle(p)} as a friend?`)) void act(() => removeFriend(p.userId))
              }}>Remove</button>} />
          ))}
        </Group>
      </Section>

      {list && list.outgoing.length > 0 && (
        <Section title="Waiting for them to accept">
          <Group>
            {list.outgoing.map((p) => (
              <Row key={p.userId} inset="avatar" icon={<Avatar id={p.userId} name={p.username ?? '?'} />}
                title={displayTitle(p)} sub={displaySub(p)}
                trailing={<button className="pill gray" onClick={() => void act(() => removeFriend(p.userId))}>Cancel</button>} />
            ))}
          </Group>
        </Section>
      )}
    </>
  )
}
