import { useEffect, useState, type CSSProperties } from 'react'
import CardHtml from '../components/CardHtml.tsx'
import {
  buildExam, countExamCards, relearnCards, saveExamResult, EXAM_LEVELS, type ExamMode, type ExamQuestion,
} from '../lib/exam.ts'
import { htmlToText } from '../lib/text.ts'

interface Props {
  deckId: string | null // null = all decks
  title: string
  onExit: () => void
}

interface Answer { cardId: string, correct: boolean }

export default function ExamScreen({ deckId, title, onExit }: Props) {
  const [questions, setQuestions] = useState<ExamQuestion[] | null>(null)
  const [settings, setSettings] = useState<{ minIntervalDays: number, mode: ExamMode, startedAt: number } | null>(null)
  const [answers, setAnswers] = useState<Answer[]>([])

  if (!questions || !settings) {
    return (
      <ExamSetup title={title} deckId={deckId} onExit={onExit} onStart={async (minIntervalDays, size, mode) => {
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
        onQuit={onExit}
      />
    )
  }

  return <ExamResults questions={questions} answers={answers} onExit={onExit} />
}

// ---- Setup ------------------------------------------------------------------

function ExamSetup({ title, deckId, onStart, onExit }: {
  title: string
  deckId: string | null
  onStart: (minIntervalDays: number, size: number, mode: ExamMode) => void
  onExit: () => void
}) {
  const [minIntervalDays, setMinIntervalDays] = useState<number>(21)
  const [size, setSize] = useState(20)
  const [mode, setMode] = useState<ExamMode>('choice')
  const [available, setAvailable] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    void countExamCards(deckId, minIntervalDays).then((n) => { if (alive) setAvailable(n) })
    return () => { alive = false }
  }, [deckId, minIntervalDays])

  const isPreset = EXAM_LEVELS.some((l) => l.minIntervalDays === minIntervalDays)

  return (
    <div style={{ textAlign: 'left' }}>
      <button onClick={onExit}>← Back</button>
      <h2 style={{ marginTop: 16 }}>Exam: {title}</h2>
      <p style={{ fontSize: 14, color: '#666' }}>
        Test how well you really know your cards. An exam doesn't change your study schedule.
      </p>

      <fieldset style={fieldset}>
        <legend>Which cards</legend>
        {EXAM_LEVELS.map((l) => (
          <label key={l.minIntervalDays} style={radio}>
            <input type="radio" checked={minIntervalDays === l.minIntervalDays}
              onChange={() => setMinIntervalDays(l.minIntervalDays)} />
            {l.label}
          </label>
        ))}
        <label style={radio}>
          <input type="radio" checked={!isPreset} onChange={() => setMinIntervalDays(14)} />
          Remembered for at least
          <input type="number" min={1} max={3650} value={minIntervalDays} disabled={isPreset}
            onChange={(e) => setMinIntervalDays(Math.max(1, Number(e.target.value) || 1))} style={{ width: 64 }} />
          days
        </label>
        <p style={{ fontSize: 13, color: '#666', margin: '8px 0 0' }}>
          {available === null ? '…' : `${available} cards match`}
        </p>
      </fieldset>

      <fieldset style={fieldset}>
        <legend>How many questions</legend>
        {[10, 20, 50, Infinity].map((n) => (
          <label key={n} style={radio}>
            <input type="radio" checked={size === n} onChange={() => setSize(n)} />
            {n === Infinity ? 'All' : n}
          </label>
        ))}
      </fieldset>

      <fieldset style={fieldset}>
        <legend>Type</legend>
        <label style={radio}>
          <input type="radio" checked={mode === 'choice'} onChange={() => setMode('choice')} />
          Multiple choice (graded for you)
        </label>
        <label style={radio}>
          <input type="radio" checked={mode === 'self'} onChange={() => setMode('self')} />
          Flip and grade yourself
        </label>
      </fieldset>

      <button disabled={!available} onClick={() => onStart(minIntervalDays, size, mode)} style={{ marginTop: 8 }}>
        Start exam ({Math.min(size, available ?? 0)} questions)
      </button>
    </div>
  )
}

// ---- One question -------------------------------------------------------------

function ExamQuestionView({ question, number, total, onAnswer, onQuit }: {
  question: ExamQuestion
  number: number
  total: number
  onAnswer: (correct: boolean) => void
  onQuit: () => void
}) {
  const [picked, setPicked] = useState<number | null>(null) // multiple choice
  const [revealed, setRevealed] = useState(false) // self-graded

  const choices = question.choices
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <button onClick={() => { if (confirm('Quit the exam? Your answers so far won\'t be saved.')) onQuit() }}>Quit</button>
        <span style={{ fontSize: 13, color: '#666' }}>Question {number} of {total}</span>
      </div>

      <div style={cardBox}><CardHtml html={question.card.front} /></div>

      {choices ? (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {choices.map((choice, i) => {
              const done = picked !== null
              const background = !done ? '#fff'
                : i === question.correctIndex ? '#dcfce7'
                : i === picked ? '#fee2e2' : '#fff'
              return (
                <button key={i} disabled={done} onClick={() => setPicked(i)} style={{ ...choiceBtn, background }}>
                  {choice}
                </button>
              )
            })}
          </div>
          {picked !== null && (
            <>
              <p style={{ fontWeight: 'bold' }}>{picked === question.correctIndex ? '✔ Correct' : '✖ Not quite'}</p>
              <div style={cardBox}><CardHtml html={question.card.back} /></div>
              <button onClick={() => onAnswer(picked === question.correctIndex)}>Next</button>
            </>
          )}
        </>
      ) : !revealed ? (
        <button onClick={() => setRevealed(true)}>Show answer</button>
      ) : (
        <>
          <div style={cardBox}><CardHtml html={question.card.back} /></div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button onClick={() => onAnswer(false)}>✖ I didn't know it</button>
            <button onClick={() => onAnswer(true)}>✔ I knew it</button>
          </div>
        </>
      )}
    </div>
  )
}

// ---- Results --------------------------------------------------------------------

function ExamResults({ questions, answers, onExit }: { questions: ExamQuestion[], answers: Answer[], onExit: () => void }) {
  const [relearned, setRelearned] = useState(false)
  const correct = answers.filter((a) => a.correct).length
  const missed = questions.filter((_, i) => !answers[i].correct)

  return (
    <div style={{ textAlign: 'left' }}>
      <h2>Result: {correct} / {answers.length} ({Math.round((correct / answers.length) * 100)}%)</h2>

      {missed.length === 0 ? <p>Perfect score! 🎉</p> : (
        <>
          <h3>Missed</h3>
          <ul style={{ fontSize: 14 }}>
            {missed.map((q) => (
              <li key={q.card.id}>{htmlToText(q.card.front) || '(image/audio)'} → {htmlToText(q.card.back) || '(image/audio)'}</li>
            ))}
          </ul>
          <button disabled={relearned} onClick={async () => { await relearnCards(missed.map((q) => q.card.id)); setRelearned(true) }}>
            {relearned ? '✔ Sent back to learning' : `Send ${missed.length} missed card${missed.length === 1 ? '' : 's'} back to learning`}
          </button>
          <p style={{ fontSize: 12, color: '#888' }}>
            Counts them as forgotten, so they show up in your next study session.
          </p>
        </>
      )}

      <button onClick={onExit} style={{ marginTop: 16 }}>Done</button>
    </div>
  )
}

const fieldset: CSSProperties = { border: '1px solid #ddd', borderRadius: 8, margin: '12px 0', padding: '8px 12px' }
const radio: CSSProperties = { display: 'flex', gap: 6, alignItems: 'center', padding: '3px 0', fontSize: 15 }
const cardBox: CSSProperties = {
  border: '2px solid #ccc', borderRadius: 16, padding: 20, margin: '16px 0', background: '#fff', textAlign: 'center',
}
const choiceBtn: CSSProperties = {
  padding: '10px 14px', fontSize: 16, borderRadius: 8, border: '1px solid #ccc', cursor: 'pointer', textAlign: 'left',
  color: '#111',
}
