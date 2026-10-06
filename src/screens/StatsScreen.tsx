import { useState } from 'react'
import { getStats } from '../lib/stats.ts'
import { getExamHistory } from '../lib/exam.ts'
import { getDeckSummaries } from '../lib/study.ts'
import { useNav } from '../ui/nav.ts'
import { useLoad } from '../ui/hooks.ts'
import Screen from '../ui/Screen.tsx'
import { ColumnChart, Rings, StackedBar, type Column } from '../ui/charts.tsx'
import { EmptyState, Group, Row, RowIcon, Section, Segmented, SelectPill } from '../ui/controls.tsx'

const pct = (n: number | null) => (n === null ? '–' : `${Math.round(n * 100)}%`)
const duration = (ms: number) => ms < 60_000 ? `${Math.round(ms / 1000)}` : `${Math.round(ms / 60_000)}`
const durationUnit = (ms: number) => ms < 60_000 ? 's' : 'min'

// "2026-10-04" (a study day) -> local Date
function dayDate(key: string) {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}
const dayTitle = (key: string) => dayDate(key).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

async function loadStats(deckId: string | null) {
  const [stats, exams, summaries] = await Promise.all([getStats(deckId), getExamHistory(deckId), getDeckSummaries()])
  const relevant = summaries.filter((s) => deckId === null || s.deck.id === deckId)
  const remaining = relevant.reduce((n, s) => n + s.new + s.learning + s.due, 0)
  return { stats, exams, remaining, decks: summaries.map((s) => s.deck) }
}

// deckId = null: all decks, with a picker (the Stats tab). Otherwise one deck (pushed from it).
export default function StatsScreen({ deckId, title, back }: { deckId: string | null, title: string, back?: string }) {
  const nav = useNav()
  const [picked, setPicked] = useState<string>('all')
  const scope = deckId ?? (picked === 'all' ? null : picked)
  const data = useLoad(() => loadStats(scope), [scope, nav.version])
  const [range, setRange] = useState<'past' | 'next'>('past')

  const picker = deckId === null && data && data.decks.length > 1 && (
    <SelectPill label="Deck" value={picked} onChange={setPicked}
      options={[{ value: 'all', label: 'All decks' }, ...data.decks.map((d) => ({ value: d.id, label: d.name }))]} />
  )

  if (!data) return <Screen title={title} back={back}>{null}</Screen>
  const { stats, exams, remaining } = data
  const { today, cards } = stats
  const nothingYet = cards.total === 0

  const past: Column[] = stats.last14Days.map((d) => ({
    label: String(dayDate(d.day).getDate()),
    title: dayTitle(d.day),
    values: [d.reviews - d.again, d.again],
  }))
  const next: Column[] = stats.dueNext7Days.map((d, i) => ({
    label: i === 0 ? 'Today' : dayDate(d.day).toLocaleDateString('en-GB', { weekday: 'short' }),
    title: i === 0 ? 'Today, including overdue' : dayTitle(d.day),
    values: [d.cards],
  }))
  const plannedToday = today.cards + remaining

  return (
    <Screen title={title} back={back}>
      {picker && <div className="pad" style={{ marginBottom: 4 }}>{picker}</div>}

      {nothingYet ? (
        <EmptyState icon="chart" title="No stats yet" text="Add a deck and study a little: your progress shows up here." />
      ) : (
        <>
          <Section title="Today">
            <div className="card">
              <Rings rings={[
                { label: 'Studied', value: plannedToday ? today.cards / plannedToday : null, display: `${today.cards}/${plannedToday}`, color: 'var(--chart-1)' },
                { label: 'Correct', value: today.correctRate, display: pct(today.correctRate), color: 'var(--chart-2)' },
                { label: 'Retention 30d', value: stats.retention30d, display: pct(stats.retention30d), color: 'var(--chart-3)' },
              ]} />
            </div>
          </Section>

          <div className="stat-grid" style={{ marginTop: 12 }}>
            <div className="stat"><div className="stat-label">Streak</div>
              <div className="stat-value">{stats.streakDays}<small>{stats.streakDays === 1 ? 'day' : 'days'}</small></div></div>
            <div className="stat"><div className="stat-label">Time today</div>
              <div className="stat-value">{duration(today.timeMs)}<small>{durationUnit(today.timeMs)}</small></div></div>
            <div className="stat"><div className="stat-label">Total answers</div>
              <div className="stat-value">{stats.allTime.reviews.toLocaleString()}</div></div>
            <div className="stat"><div className="stat-label">Days studied</div>
              <div className="stat-value">{stats.allTime.daysStudied}</div></div>
          </div>

          <Section title="Activity">
            <div className="card">
              <Segmented label="Time range" value={range} onChange={setRange}
                options={[{ value: 'past', label: 'Past 2 weeks' }, { value: 'next', label: 'Next 7 days' }]} />
              {range === 'past' ? (
                <ColumnChart key="past" columns={past} caption="Answers per day, last 14 days"
                  series={[{ name: 'Remembered', color: 'var(--chart-1)' }, { name: 'Forgot', color: 'var(--chart-2)' }]}
                  readout={(c, total) => <><strong>{total}</strong><span>{total === 1 ? 'answer' : 'answers'} · {c.title}{c.values[1] > 0 && ` · ${c.values[1]} forgot`}</span></>} />
              ) : (
                <ColumnChart key="next" columns={next} caption="Cards due per day, next 7 days" initial={0}
                  series={[{ name: 'Cards due', color: 'var(--chart-1)' }]}
                  readout={(c, total) => <><strong>{total}</strong><span>{total === 1 ? 'card due' : 'cards due'} · {c.title}</span></>} />
              )}
            </div>
          </Section>

          <Section title="Cards">
            <div className="card">
              <StackedBar
                parts={[
                  { label: 'Learning', value: cards.learning, color: 'var(--chart-1)' },
                  { label: 'Young', value: cards.young, color: 'var(--chart-2)' },
                  { label: 'Mature', value: cards.mature, color: 'var(--chart-3)' },
                ]}
                rest={{ label: 'Not studied', value: cards.unseen }}
              />
            </div>
          </Section>

          <Section title="Exams">
            <Group>
              {exams.slice(0, 10).map((e) => (
                <Row key={e.id}
                  title={`${e.correct} of ${e.total} correct`}
                  sub={`${new Date(e.finishedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · ${e.minIntervalDays}+ days · ${e.mode === 'choice' ? 'multiple choice' : 'self-graded'}`}
                  value={e.total ? `${Math.round((e.correct / e.total) * 100)}%` : '–'} />
              ))}
              <Row inset="icon" icon={<RowIcon color="#5e5ce6" icon="exam" />} chevron
                title={scope === null ? 'Take an exam (all decks)' : 'Take an exam'}
                onClick={() => nav.push({
                  screen: 'exam',
                  deckId: scope,
                  title: scope === null ? 'All decks' : data.decks.find((d) => d.id === scope)?.name ?? title,
                })} />
            </Group>
          </Section>
        </>
      )}
    </Screen>
  )
}
