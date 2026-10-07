import { getDeckSummaries, type DeckSummary } from '../lib/study.ts'
import { getStats } from '../lib/stats.ts'
import { pendingCount } from '../lib/db.ts'
import { studyDayKey, studyDayStart, studyDayStartDaysAgo } from '../lib/days.ts'
import { sync } from '../lib/sync.ts'
import { formatWhen } from '../lib/format.ts'
import { useOnline } from '../lib/useOnline.ts'
import { useNav } from '../ui/nav.ts'
import { useLoad } from '../ui/hooks.ts'
import { deckColor, initial } from '../ui/colors.ts'
import Screen from '../ui/Screen.tsx'
import Icon from '../ui/icons.tsx'
import { EmptyState, Group, RowIcon, Section } from '../ui/controls.tsx'

interface WeekDay { key: string, name: string, num: number, isToday: boolean, isFuture: boolean, studied: boolean }

async function loadToday(now = Date.now()) {
  const [decks, stats, pending] = await Promise.all([getDeckSummaries(now), getStats(null, now), pendingCount()])

  // This week, Monday to Sunday, with a dot on days you studied
  const reviewsByDay = new Map(stats.last14Days.map((d) => [d.day, d.reviews]))
  const todayStart = studyDayStart(now)
  const mondayOffset = (new Date(todayStart).getDay() + 6) % 7
  const week: WeekDay[] = Array.from({ length: 7 }, (_, i) => {
    const start = studyDayStartDaysAgo(now, mondayOffset - i)
    const date = new Date(start)
    const key = studyDayKey(start)
    return {
      key,
      name: date.toLocaleDateString('en-GB', { weekday: 'short' }),
      num: date.getDate(),
      isToday: i === mondayOffset,
      isFuture: i > mondayOffset,
      studied: (reviewsByDay.get(key) ?? 0) > 0,
    }
  })

  return {
    decks,
    week,
    month: new Date(todayStart).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
    streak: stats.streakDays,
    answersToday: stats.today.reviews,
    pending,
  }
}

export default function TodayScreen() {
  const nav = useNav()
  const data = useLoad(() => loadToday(), [nav.version])

  const toStudy = data?.decks.filter((d) => d.new + d.learning + d.due > 0) ?? []
  const done = data?.decks.filter((d) => d.new + d.learning + d.due === 0) ?? []

  return (
    <Screen title="Today" right={data && <SyncButton pending={data.pending} />}>
      {data && (
        <>
          <p className="month-label">{data.month}</p>
          <div className="week" role="list" aria-label="This week">
            {data.week.map((d) => (
              <div key={d.key} role="listitem"
                className={`day${d.isToday ? ' today' : ''}${d.isFuture ? ' future' : ''}${d.studied ? ' studied' : ''}`}
                aria-label={`${d.name} ${d.num}${d.studied ? ', studied' : ''}${d.isToday ? ', today' : ''}`}>
                <span className="day-name">{d.name}</span>
                <span className="day-num">{d.num}</span>
                <span className="day-dot" />
              </div>
            ))}
          </div>

          <div className="tiles">
            <button className="tile blue" onClick={() => nav.setTab('stats')}>
              <span className="tile-badge"><Icon name="flame" size={15} weight={2.2} />Streak</span>
              <span>
                <span className="tile-value" style={{ display: 'block' }}>{data.streak} {data.streak === 1 ? 'day' : 'days'}</span>
                <span className="tile-sub" style={{ display: 'block' }}>
                  {data.answersToday === 0 ? 'Nothing studied yet today' : `${data.answersToday} answers today`}
                </span>
              </span>
            </button>
            <button className="tile dashed" onClick={nav.openAdd}>
              <span className="tab-add-circle"><Icon name="plus" size={22} weight={2.6} /></span>
              Add deck
            </button>
          </div>

          {data.decks.length === 0 && (
            <EmptyState icon="cards" title="No decks yet"
              text="Import a deck from Anki, or try the sample deck to see how studying works.">
              <button className="btn btn-primary" onClick={nav.openAdd}>Add a deck</button>
            </EmptyState>
          )}

          {toStudy.length > 0 && (
            <Section title="To study">
              <Group>
                {toStudy.map((s) => <StudyRow key={s.deck.id} summary={s} />)}
              </Group>
            </Section>
          )}

          {done.length > 0 && (
            <Section title="Done for today">
              <Group>
                {done.map((s) => <DoneRow key={s.deck.id} summary={s} />)}
              </Group>
            </Section>
          )}
        </>
      )}
    </Screen>
  )
}

function StudyRow({ summary: s }: { summary: DeckSummary }) {
  const nav = useNav()
  const parts = [
    s.due > 0 && `${s.due} due`,
    s.new > 0 && `${s.new} new`,
    s.learning > 0 && `${s.learning} learning`,
  ].filter(Boolean)
  return (
    <div className="row with-icon">
      <button className="row-link" onClick={() => nav.push({ screen: 'deck', deckId: s.deck.id })}>
        <RowIcon color={deckColor(s.deck.id)}>{initial(s.deck.name)}</RowIcon>
        <span className="row-main">
          <span className="row-title" style={{ display: 'block' }}>{s.deck.name}</span>
          <span className="row-sub" style={{ display: 'block' }}>{parts.join(' · ')}</span>
        </span>
      </button>
      <button className="pill" onClick={() => nav.push({ screen: 'study', deckId: s.deck.id })}
        aria-label={`Study ${s.deck.name}`}>
        <Icon name="play" size={12} />Study
      </button>
    </div>
  )
}

function DoneRow({ summary: s }: { summary: DeckSummary }) {
  const nav = useNav()
  const sub = s.total === 0 ? 'No cards yet'
    : s.nextDueAt ? `Next card ${formatWhen(s.nextDueAt)}`
    : 'All caught up'
  return (
    <button className="row with-icon" onClick={() => nav.push({ screen: 'deck', deckId: s.deck.id })}>
      <RowIcon color={deckColor(s.deck.id)}>{initial(s.deck.name)}</RowIcon>
      <div className="row-main">
        <div className="row-title">{s.deck.name}</div>
        <div className="row-sub">{sub}</div>
      </div>
      <span className="check-circle"><Icon name="check" size={15} weight={3} /></span>
    </button>
  )
}

function SyncButton({ pending }: { pending: number }) {
  const online = useOnline()
  if (!online) {
    return <span className="nav-btn" style={{ color: 'var(--label-3)' }} title="Offline: changes sync when you're back online">
      <Icon name="cloudOff" size={22} /><span className="sr-only">Offline</span>
    </span>
  }
  return (
    <button className="nav-btn" onClick={() => void sync()} aria-label={pending ? `${pending} changes waiting. Sync now` : 'All synced. Sync now'}>
      <Icon name={pending ? 'refresh' : 'cloud'} size={22} />
      {pending > 0 && <span style={{ fontSize: 15, fontWeight: 600 }}>{pending}</span>}
    </button>
  )
}
