import { getDeckSummaries, SESSION_SIZE } from '../lib/study.ts'
import { getStats } from '../lib/stats.ts'
import { formatWhen } from '../lib/format.ts'
import { useNav } from '../ui/nav.ts'
import { useLoad } from '../ui/hooks.ts'
import Screen from '../ui/Screen.tsx'
import { StackedBar } from '../ui/charts.tsx'
import { Group, Row, RowIcon, Section } from '../ui/controls.tsx'

async function loadDeck(deckId: string) {
  const [summaries, stats] = await Promise.all([getDeckSummaries(), getStats(deckId)])
  return { summary: summaries.find((s) => s.deck.id === deckId) ?? null, cards: stats.cards }
}

export default function DeckScreen({ deckId, back }: { deckId: string, back: string }) {
  const nav = useNav()
  const data = useLoad(() => loadDeck(deckId), [deckId, nav.version])
  const s = data?.summary

  if (data && !s) {
    return <Screen title="Deck" back={back}><p className="subtitle">This deck no longer exists.</p></Screen>
  }

  const toStudy = s ? s.new + s.learning + s.due : 0
  return (
    <Screen title={s?.deck.name ?? ''} back={back}>
      {s && data && (
        <>
          <p className="subtitle">{s.total} {s.total === 1 ? 'card' : 'cards'}{s.deck.description ? ` · ${s.deck.description}` : ''}</p>

          <Section title="Ready now">
            <div className="card counts">
              <div><div className="count-value">{s.due}</div><div className="count-label">Due</div></div>
              <div><div className="count-value">{s.new}</div><div className="count-label">New</div></div>
              <div><div className="count-value">{s.learning}</div><div className="count-label">Learning</div></div>
            </div>
          </Section>

          <div className="pad" style={{ marginTop: 16 }}>
            <button className="btn btn-primary" disabled={toStudy === 0}
              onClick={() => nav.push({ screen: 'study', deckId })}>
              {toStudy > 0 ? `Study ${Math.min(SESSION_SIZE, toStudy)} ${toStudy === 1 ? 'card' : 'cards'}` : 'All done for now'}
            </button>
            <p className="section-footer" style={{ textAlign: 'center', padding: '8px 0 0' }}>
              {toStudy > SESSION_SIZE ? `${toStudy} cards ready. You study ${SESSION_SIZE} at a time, as many rounds as you like.`
                : toStudy > 0 ? null
                : s.nextDueAt ? `Next card is due ${formatWhen(s.nextDueAt)}.` : 'Nothing to study in this deck.'}
            </p>
          </div>

          <Section title="Progress">
            <div className="card">
              <StackedBar
                parts={[
                  { label: 'Learning', value: data.cards.learning, color: 'var(--chart-1)' },
                  { label: 'Young', value: data.cards.young, color: 'var(--chart-2)' },
                  { label: 'Mature', value: data.cards.mature, color: 'var(--chart-3)' },
                ]}
                rest={{ label: 'Not studied', value: data.cards.unseen }}
              />
            </div>
          </Section>

          <Section footer="An exam tests cards you already know, without changing when they're scheduled.">
            <Group>
              <Row inset="icon" icon={<RowIcon color="#5e5ce6" icon="exam" />} title="Take an exam" chevron
                onClick={() => nav.push({ screen: 'exam', deckId, title: s.deck.name })} />
              <Row inset="icon" icon={<RowIcon color="#0a84ff" icon="chart" />} title="Statistics" chevron
                onClick={() => nav.push({ screen: 'stats', deckId, title: s.deck.name })} />
            </Group>
          </Section>
        </>
      )}
    </Screen>
  )
}
