import { useEffect, useState } from 'react'
import { getStats, type Stats } from '../lib/stats.ts'
import { getExamHistory } from '../lib/exam.ts'
import type { SyncExam } from '../../shared/sync-types.ts'

const pct = (n: number | null) => (n === null ? '–' : `${Math.round(n * 100)}%`)
const minutes = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`)

// deckId = null shows all decks together
export default function StatsScreen({ deckId, title, onExit }: { deckId: string | null, title: string, onExit: () => void }) {
  const [stats, setStats] = useState<Stats | null>(null)
  const [exams, setExams] = useState<SyncExam[]>([])

  useEffect(() => {
    let alive = true
    void getStats(deckId).then((s) => { if (alive) setStats(s) })
    void getExamHistory(deckId).then((e) => { if (alive) setExams(e) })
    return () => { alive = false }
  }, [deckId])

  if (!stats) return <p>Loading…</p>
  const { cards, today, allTime } = stats

  return (
    <div style={{ textAlign: 'left' }}>
      <button onClick={onExit}>← Back</button>
      <h2 style={{ marginTop: 16 }}>Stats: {title}</h2>

      <h3>Today</h3>
      <Table rows={[
        ['Answers', today.reviews],
        ['Cards studied', today.cards],
        ['New cards', today.newCards],
        ['Time', minutes(today.timeMs)],
        ['Correct (not "Again")', pct(today.correctRate)],
      ]} />

      <h3>Cards</h3>
      <Table rows={[
        ['Total', cards.total],
        ['Not studied yet', cards.unseen],
        ['Learning', cards.learning],
        ['Young (under 3 weeks)', cards.young],
        ['Mature (3+ weeks)', cards.mature],
      ]} />

      <h3>Overall</h3>
      <Table rows={[
        ['Study streak', `${stats.streakDays} day${stats.streakDays === 1 ? '' : 's'}`],
        ['Retention, last 30 days', pct(stats.retention30d)],
        ['Total answers', allTime.reviews],
        ['Total time', minutes(allTime.timeMs)],
        ['Days studied', allTime.daysStudied],
      ]} />

      <h3>Answers per day (last 14 days)</h3>
      <Table rows={stats.last14Days.map((d) => [d.day, d.reviews])} />

      <h3>Due in the coming week</h3>
      <Table rows={stats.dueNext7Days.map((d, i) => [i === 0 ? `${d.day} (today)` : d.day, d.cards])} />

      <h3>Exams</h3>
      {exams.length === 0 ? <p style={{ fontSize: 14 }}>No exams yet.</p> : (
        <Table rows={exams.slice(0, 10).map((e) => [
          `${new Date(e.finishedAt).toLocaleDateString()} · ${e.minIntervalDays}+ days · ${e.mode === 'choice' ? 'multiple choice' : 'self-graded'}`,
          `${e.correct}/${e.total} (${e.total ? Math.round((e.correct / e.total) * 100) : 0}%)`,
        ])} />
      )}
    </div>
  )
}

function Table({ rows }: { rows: [string, string | number][] }) {
  return (
    <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse', marginBottom: 8 }}>
      <tbody>
        {rows.map(([label, value], i) => (
          <tr key={`${i}-${label}`} style={{ borderBottom: '1px solid #eee' }}>
            <td style={{ padding: '4px 0' }}>{label}</td>
            <td style={{ padding: '4px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
