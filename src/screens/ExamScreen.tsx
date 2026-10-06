import { useEffect, useState, type ReactNode } from 'react'
import CardHtml from '../components/CardHtml.tsx'
import {
  buildExam, countExamCards, relearnCards, saveExamResult, EXAM_LEVELS, type ExamMode, type ExamQuestion,
} from '../lib/exam.ts'
import { htmlToText } from '../lib/text.ts'
import { useNav } from '../ui/nav.ts'
import Screen from '../ui/Screen.tsx'
import Icon from '../ui/icons.tsx'
import { ScoreRing } from '../ui/charts.tsx'
import { Group, Row, Section, Segmented } from '../ui/controls.tsx'

interface Props {
  deckId: string | null // null = all decks
  title: string
}

interface Answer { cardId: string, correct: boolean }

export default function ExamScreen({ deckId, title }: Props) {
  const [questions, setQuestions] = useState<ExamQuestion[] | null>(null)
  const [settings, setSettings] = useState<{ minIntervalDays: number, mode: ExamMode, startedAt: number } | null>(null)
  const [answers, setAnswers] = useState<Answer[]>([])

  if (!questions || !settings) {
    return (
      <ExamSetup title={title} deckId={deckId} onStart={async (minIntervalDays, size, mode) => {
        setQuestions(await buildExam(deckId, minIntervalDays, size, mode))
        setSettings({ minIntervalDays, mode, startedAt: Date.now() })
        setAnswers([])
      }} />
    )
  }

  if (answers.length < questions.length) {
    return (
      <ExamQuestionView
        key={answers.length}
        question={questions[answers.length]}
        number={answers.length + 1}
        total={questions.length}
        onAnswer={(correct) => {
          const next = [...answers, { cardId: questions[answers.length].card.id, correct }]
          setAnswers(next)
          if (next.length === questions.length) {
            void saveExamResult({
              id: crypto.randomUUID(),
              deckId,
              mode: settings.mode,
              minIntervalDays: settings.minIntervalDays,
              total: next.length,
              correct: next.filter((a) => a.correct).length,
              answers: next,
              startedAt: settings.startedAt,
              finishedAt: Date.now(),
            })
          }
        }}
      />
    )
  }

  return <ExamResults questions={questions} answers={answers} />
}

// ---- Setup ------------------------------------------------------------------

const SIZES = [
  { value: 10, label: '10' },
  { value: 20, label: '20' },
  { value: 50, label: '50' },
  { value: Infinity, label: 'All' },
]

function ExamSetup({ title, deckId, onStart }: {
  title: string
  deckId: string | null
  onStart: (minIntervalDays: number, size: number, mode: ExamMode) => void
}) {
  const nav = useNav()
  const [minIntervalDays, setMinIntervalDays] = useState<number>(21)
  const [custom, setCustom] = useState(false)
  const [size, setSize] = useState(20)
  const [mode, setMode] = useState<ExamMode>('choice')
  const [available, setAvailable] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    void countExamCards(deckId, minIntervalDays).then((n) => { if (alive) setAvailable(n) })
    return () => { alive = false }
  }, [deckId, minIntervalDays])

  const tick = <span className="tick"><Icon name="check" size={20} weight={2.6} /></span>
  const count = Math.min(size, available ?? 0)

  return (
    <Screen title="Exam" noTabbar left={<button className="nav-btn" onClick={nav.back}>Cancel</button>}>
      <p className="subtitle">{title}. An exam doesn't change when your cards are scheduled.</p>

      <Section title="Which cards" footer={available === null ? ' ' : `${available} ${available === 1 ? 'card matches' : 'cards match'}`}>
        <Group>
          {EXAM_LEVELS.map((l) => (
            <Row key={l.minIntervalDays} title={l.label}
              trailing={!custom && minIntervalDays === l.minIntervalDays ? tick : undefined}
              onClick={() => { setCustom(false); setMinIntervalDays(l.minIntervalDays) }} />
          ))}
          <Row title="Custom" trailing={custom ? tick : undefined} onClick={() => { setCustom(true); setMinIntervalDays(14) }} />
          {custom && (
            <div className="row">
              <span className="row-main">Remembered for at least</span>
              <input className="row-input" type="number" inputMode="numeric" min={1} max={3650} value={minIntervalDays}
                style={{ flex: 'none', width: 64, textAlign: 'right', color: 'var(--accent)' }} aria-label="Minimum days"
                onChange={(e) => setMinIntervalDays(Math.max(1, Math.min(3650, Number(e.target.value) || 1)))} />
              <span className="row-value">days</span>
            </div>
          )}
        </Group>
      </Section>

      <Section title="Questions">
        <Segmented padded label="Number of questions" value={size} onChange={setSize} options={SIZES} />
      </Section>

      <Section title="Type" footer={mode === 'choice'
        ? 'Pick the right answer out of four. Answers that are images or long text are self-graded instead.'
        : 'Think of the answer, flip the card and say whether you knew it.'}>
        <Segmented padded label="Exam type" value={mode} onChange={setMode}
          options={[{ value: 'choice', label: 'Multiple choice' }, { value: 'self', label: 'Self-graded' }]} />
      </Section>

      <div className="pad" style={{ marginTop: 32 }}>
        <button className="btn btn-primary" disabled={!available} onClick={() => onStart(minIntervalDays, size, mode)}>
          {available ? `Start · ${count} ${count === 1 ? 'question' : 'questions'}` : 'No cards to test yet'}
        </button>
      </div>
    </Screen>
  )
}

// ---- One question -------------------------------------------------------------

function ExamQuestionView({ question, number, total, onAnswer }: {
  question: ExamQuestion
  number: number
  total: number
  onAnswer: (correct: boolean) => void
}) {
  const nav = useNav()
  const [picked, setPicked] = useState<number | null>(null) // multiple choice
  const [revealed, setRevealed] = useState(false) // self-graded
  const choices = question.choices

  let footer: ReactNode = null
  if (choices && picked !== null) {
    footer = <button className="btn btn-primary" onClick={() => onAnswer(picked === question.correctIndex)}>Next</button>
  } else if (!choices && !revealed) {
    footer = <button className="btn btn-secondary" style={{ height: 60 }} onClick={() => setRevealed(true)}>Show answer</button>
  } else if (!choices) {
    footer = (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <button className="rating again" onClick={() => onAnswer(false)}>Didn't know</button>
        <button className="rating good" onClick={() => onAnswer(true)}>Knew it</button>
      </div>
    )
  }

  return (
    <div className="fullscreen">
      <div className="session-bar">
        <button className="icon-btn" aria-label="Quit exam"
          onClick={() => { if (confirm("Quit the exam? Your answers so far won't be saved.")) nav.back() }}>
          <Icon name="close" size={24} />
        </button>
        <div className="progress"><div className="progress-fill" style={{ width: `${((number - 1) / total) * 100}%` }} /></div>
        <span className="session-count">{number}/{total}</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 16 }}>
        <div className="exam-card"><CardHtml html={question.card.front} /></div>

        {choices && (
          <div className="choices">
            {choices.map((choice, i) => {
              const state = picked === null ? '' : i === question.correctIndex ? ' correct' : i === picked ? ' wrong' : ''
              return (
                <button key={i} className={`choice${state}`} disabled={picked !== null} onClick={() => setPicked(i)}>
                  <span>{choice}</span>
                  {state === ' correct' && <Icon name="check" size={20} weight={2.6} />}
                  {state === ' wrong' && <Icon name="close" size={20} weight={2.6} />}
                </button>
              )
            })}
          </div>
        )}

        {/* After a multiple-choice pick, the highlighted choice already is the answer:
            only show the card's back when it has more (images, audio, extra notes) */}
        {((picked !== null && answerAddsInfo(question)) || revealed) && (
          <div className="exam-card answer"><CardHtml html={question.card.back} /></div>
        )}
      </div>

      <div className="answer-bar">{footer}</div>
    </div>
  )
}

function answerAddsInfo(q: ExamQuestion) {
  const back = q.card.back
  return /<(img|audio|video)\b|\[sound:/i.test(back) || !q.choices || htmlToText(back) !== q.choices[q.correctIndex]
}

// ---- Results --------------------------------------------------------------------

function ExamResults({ questions, answers }: { questions: ExamQuestion[], answers: Answer[] }) {
  const nav = useNav()
  const [relearned, setRelearned] = useState(false)
  const correct = answers.filter((a) => a.correct).length
  const missed = questions.filter((_, i) => !answers[i].correct)
  const score = answers.length ? correct / answers.length : 0

  return (
    <Screen title="Result" large={false} noTabbar right={<button className="nav-btn strong" onClick={nav.back}>Done</button>}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '16px 0 4px' }}>
        <ScoreRing value={score}>
          <strong>{Math.round(score * 100)}%</strong>
          <span>{correct} of {answers.length}</span>
        </ScoreRing>
        <p className="empty-title" style={{ marginTop: 8 }}>
          {missed.length === 0 ? 'Perfect score!' : score >= 0.8 ? 'Great job!' : score >= 0.5 ? 'Not bad!' : 'Keep practising!'}
        </p>
      </div>

      {missed.length > 0 && (
        <>
          <Section title={`Missed (${missed.length})`}>
            <Group>
              {missed.map((q) => (
                <Row key={q.card.id} title={htmlToText(q.card.front) || '(image/audio)'} sub={htmlToText(q.card.back) || '(image/audio)'} />
              ))}
            </Group>
          </Section>
          <div className="pad" style={{ marginTop: 20 }}>
            <button className="btn btn-tinted" disabled={relearned}
              onClick={async () => { await relearnCards(missed.map((q) => q.card.id)); setRelearned(true) }}>
              {relearned ? <><Icon name="check" size={20} weight={2.6} />Sent back to learning</>
                : `Send ${missed.length} missed ${missed.length === 1 ? 'card' : 'cards'} back to learning`}
            </button>
            <p className="section-footer" style={{ padding: '8px 16px 0', textAlign: 'center' }}>
              Counts them as forgotten, so they come back in your next study session.
            </p>
          </div>
        </>
      )}

      <div className="pad" style={{ marginTop: 24 }}>
        <button className="btn btn-primary" onClick={nav.back}>Done</button>
      </div>
    </Screen>
  )
}
