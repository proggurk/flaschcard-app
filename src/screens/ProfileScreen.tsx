import { useState, type FormEvent } from 'react'
import { getMeta, pendingCount, type LocalUser } from '../lib/db.ts'
import { updateProfile } from '../lib/social.ts'
import { logout } from '../lib/session.ts'
import { sync } from '../lib/sync.ts'
import { useOnline } from '../lib/useOnline.ts'
import { useNav } from '../ui/nav.ts'
import { useLoad } from '../ui/hooks.ts'
import Screen from '../ui/Screen.tsx'
import { Avatar, Group, Row, Section, Switch } from '../ui/controls.tsx'

async function loadSync() {
  return { pending: await pendingCount(), lastSyncedAt: (await getMeta<number>('lastSyncedAt')) ?? null }
}

export default function ProfileScreen({ user, onUserChange }: { user: LocalUser, onUserChange: (user: LocalUser | null) => void }) {
  const nav = useNav()
  const online = useOnline()
  const syncInfo = useLoad(loadSync, [nav.version])
  const [username, setUsername] = useState(user.username ?? '')
  const [message, setMessage] = useState<{ text: string, error: boolean } | null>(null)
  const [syncing, setSyncing] = useState(false)

  async function save(changes: { username?: string, showOnLeaderboard?: boolean }) {
    try {
      onUserChange(await updateProfile(changes))
      setMessage(changes.username !== undefined ? { text: 'Username saved.', error: false } : null)
    } catch (err) {
      setMessage({ text: (err as Error).message, error: true })
    }
  }

  const cleaned = username.trim().replace(/^@/, '').toLowerCase()
  const usernameChanged = cleaned !== (user.username ?? '') && cleaned !== ''
  const name = user.displayName ?? (user.username ? `@${user.username}` : user.email)

  return (
    <Screen title="Profile">
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '8px 16px 0' }}>
        <Avatar id={user.id} name={user.username ?? user.displayName ?? user.email} large />
        <p style={{ fontSize: 22, fontWeight: 700, marginTop: 8, overflowWrap: 'anywhere', textAlign: 'center' }}>{name}</p>
        {name !== user.email && <p style={{ fontSize: 15, color: 'var(--label-2)' }}>{user.email}</p>}
      </div>

      <Section title="Profile"
        footer={message?.text ?? 'Friends find you by your username. Your email is never shown to anyone.'}
        error={message?.error}>
        <Group>
          <form className="row" onSubmit={(e: FormEvent) => { e.preventDefault(); if (usernameChanged) void save({ username: cleaned }) }}>
            <span style={{ flex: 'none' }}>Username</span>
            <span className="input-prefix" style={{ marginLeft: 'auto' }}>@</span>
            <input className="row-input" value={username} onChange={(e) => setUsername(e.target.value)}
              placeholder="choose one" maxLength={20} autoCapitalize="none" autoCorrect="off" spellCheck={false}
              enterKeyHint="done" aria-label="Username" disabled={!online}
              style={{ flex: '0 1 150px', textAlign: 'left', color: 'var(--label-2)' }} />
            {usernameChanged && <button type="submit" className="pill">Save</button>}
          </form>
          <Row title="Show me on the global leaderboard"
            trailing={<Switch label="Show me on the global leaderboard" checked={user.showOnLeaderboard ?? false}
              disabled={!user.username || !online} onChange={(checked) => void save({ showOnLeaderboard: checked })} />} />
        </Group>
      </Section>

      <Section title="Sync" footer="Everything is saved on this device first, so studying works offline. Changes sync automatically when you're online.">
        <Group>
          <Row title="Status" value={
            !online ? 'Offline'
              : !syncInfo ? ''
              : syncInfo.pending === 0 ? 'All synced'
              : `${syncInfo.pending} waiting`
          } />
          <Row title="Last synced" value={syncInfo?.lastSyncedAt ? formatSyncTime(syncInfo.lastSyncedAt) : 'Never'} />
          <Row title={syncing ? 'Syncing…' : 'Sync now'} tone="accent" disabled={!online || syncing}
            onClick={async () => { setSyncing(true); await sync(); setSyncing(false) }} />
        </Group>
      </Section>

      <Section>
        <Group>
          <Row title="Log out" tone="destructive" centered onClick={async () => { if (await logout()) onUserChange(null) }} />
        </Group>
      </Section>
    </Screen>
  )
}

function formatSyncTime(t: number) {
  const d = new Date(t)
  const sameDay = d.toDateString() === new Date().toDateString()
  return sameDay
    ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
