// Small hand-made SVG charts. Colors come from the --chart-* tokens, which were
// validated for the dark surface (contrast + color-blind separation). Every chart
// also has a visually hidden table, so values never depend on seeing the colors.
import { useState, type ReactNode } from 'react'

// ---- Activity rings ------------------------------------------------------------
// Concentric progress meters (each 0..1), labeled in a legend beside them.

export interface RingSpec { label: string, value: number | null, display: string, color: string }

export function Rings({ rings, size = 124 }: { rings: RingSpec[], size?: number }) {
  const stroke = 11
  const step = stroke + 4
  return (
    <div className="rings">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" style={{ flex: 'none' }}>
        {rings.map((ring, i) => {
          const r = size / 2 - stroke / 2 - i * step
          const length = 2 * Math.PI * r
          const v = ring.value === null ? 0 : Math.min(1, Math.max(0, ring.value))
          return (
            <g key={ring.label} transform={`rotate(-90 ${size / 2} ${size / 2})`}>
              {/* Track: the same hue, faded (the unfilled part of the meter) */}
              <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={ring.color} strokeOpacity={0.22} strokeWidth={stroke} />
              {v > 0 && (
                <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={ring.color} strokeWidth={stroke}
                  strokeLinecap="round" strokeDasharray={`${Math.max(v * length, 0.01)} ${length}`}
                  style={{ transition: 'stroke-dasharray 0.6s var(--ease-ios)' }} />
              )}
            </g>
          )
        })}
      </svg>
      <div className="ring-legend">
        {rings.map((ring) => (
          <div key={ring.label} className="ring-legend-item">
            <span className="swatch" style={{ background: ring.color, borderRadius: '50%' }} />
            <span className="label">{ring.label}</span>
            <span className="value">{ring.display}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---- Column chart (optionally stacked) -----------------------------------------------

export interface Column {
  label: string    // under the column, e.g. "17"
  title: string    // in the readout when selected, e.g. "Mon 17 Oct"
  values: number[] // one per series, stacked bottom to top
}

const W = 340        // drawing width; the SVG scales to the card
const PLOT_TOP = 16
const PLOT_H = 112
const AXIS_H = 20
const H = PLOT_TOP + PLOT_H + AXIS_H
const BASELINE = PLOT_TOP + PLOT_H

export function ColumnChart({ columns, series, readout, caption, initial = columns.length - 1 }: {
  columns: Column[]
  series: { name: string, color: string }[]
  readout: (column: Column, total: number) => ReactNode
  caption: string // describes the chart for screen readers
  initial?: number // column selected at first (default: the last one)
}) {
  const [selected, setSelected] = useState(initial)
  const sel = Math.min(selected, columns.length - 1)
  const totals = columns.map((c) => c.values.reduce((a, b) => a + b, 0))
  const max = niceMax(Math.max(0, ...totals))
  const slot = W / columns.length
  const barW = Math.min(24, slot * 0.56)

  return (
    <figure className="chart" style={{ margin: 0 }}>
      <div className="chart-readout" aria-live="polite">{readout(columns[sel], totals[sel])}</div>
      <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true" style={{ marginTop: 8 }}>
        {/* Recessive grid: one hairline at the top value, plus the baseline */}
        <line x1={0} x2={W} y1={PLOT_TOP} y2={PLOT_TOP} stroke="var(--chart-grid)" strokeWidth={1} />
        <text x={0} y={PLOT_TOP - 5} className="axis-label">{max.toLocaleString()}</text>
        <line x1={0} x2={W} y1={PLOT_TOP + PLOT_H} y2={BASELINE} stroke="#383835" strokeWidth={1} />

        {columns.map((column, i) => {
          const x = i * slot + (slot - barW) / 2
          const topIndex = column.values.findLastIndex((v) => v > 0)
          const parts: ReactNode[] = []
          let bottom = BASELINE
          column.values.forEach((v, s) => {
            if (v <= 0) return
            const h = (v / max) * PLOT_H
            // 2px surface gap between stacked segments: each side gives up 1px
            const segBottom = bottom === BASELINE ? bottom : bottom - 1
            const segTop = s === topIndex ? bottom - h : bottom - h + 1
            const segH = Math.max(1, segBottom - segTop)
            parts.push(s === topIndex
              ? <path key={s} d={roundedTop(x, segBottom - segH, barW, segH, 4)} fill={series[s].color} />
              : <rect key={s} x={x} y={segBottom - segH} width={barW} height={segH} fill={series[s].color} />)
            bottom -= h
          })
          return (
            <g key={i} className="col" onClick={() => setSelected(i)} onPointerEnter={(e) => { if (e.pointerType === 'mouse') setSelected(i) }}>
              {i === sel && <rect x={i * slot + 1} y={PLOT_TOP - 2} width={slot - 2} height={PLOT_H + 4} rx={8} fill="rgba(255,255,255,0.06)" />}
              {parts}
              {/* Hit area: the whole slot, much bigger than the bar */}
              <rect x={i * slot} y={0} width={slot} height={H} fill="transparent" />
              <text x={i * slot + slot / 2} y={H - 4} textAnchor="middle" className={`axis-label${i === sel ? ' selected' : ''}`}>
                {column.label}
              </text>
            </g>
          )
        })}
      </svg>
      {series.length > 1 && (
        <div className="legend">
          {series.map((s) => (
            <span key={s.name} className="legend-item"><span className="swatch" style={{ background: s.color }} />{s.name}</span>
          ))}
        </div>
      )}
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead><tr><th>Day</th>{series.map((s) => <th key={s.name}>{s.name}</th>)}</tr></thead>
        <tbody>
          {columns.map((c, i) => <tr key={i}><th>{c.title}</th>{c.values.map((v, s) => <td key={s}>{v}</td>)}</tr>)}
        </tbody>
      </table>
    </figure>
  )
}

// Rectangle with 4px rounded top corners and a square bottom (on the baseline)
function roundedTop(x: number, y: number, w: number, h: number, radius: number) {
  const r = Math.min(radius, h, w / 2)
  return `M${x},${y + h}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h}Z`
}

// Round the axis maximum up to 1, 2 or 5 × a power of ten (at least 5)
function niceMax(n: number) {
  if (n <= 5) return 5
  const pow = 10 ** Math.floor(Math.log10(n))
  return [1, 2, 5, 10].map((m) => m * pow).find((m) => m >= n)!
}

// ---- Part-to-whole bar --------------------------------------------------------------
// One horizontal bar split into parts; the gray track is "the rest".

export function StackedBar({ parts, rest }: { parts: { label: string, value: number, color: string }[], rest?: { label: string, value: number } }) {
  const total = parts.reduce((a, p) => a + p.value, 0) + (rest?.value ?? 0)
  return (
    <div>
      <div className="stacked-bar" aria-hidden="true">
        {parts.map((p) => p.value > 0 && <div key={p.label} style={{ width: `${(p.value / Math.max(1, total)) * 100}%`, background: p.color }} />)}
      </div>
      <div className="legend">
        {parts.map((p) => (
          <span key={p.label} className="legend-item"><span className="swatch" style={{ background: p.color }} />{p.label} <strong style={{ color: 'var(--label)' }}>{p.value}</strong></span>
        ))}
        {rest && (
          <span className="legend-item"><span className="swatch" style={{ background: 'var(--chart-track)', boxShadow: 'inset 0 0 0 1px var(--separator)' }} />{rest.label} <strong style={{ color: 'var(--label)' }}>{rest.value}</strong></span>
        )}
      </div>
    </div>
  )
}

// ---- Single score ring (exam result) ------------------------------------------------------

export function ScoreRing({ value, children, size = 168 }: { value: number, children: ReactNode, size?: number }) {
  const stroke = 14
  const r = size / 2 - stroke / 2
  const length = 2 * Math.PI * r
  return (
    <div className="score-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} aria-hidden="true">
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--accent)" strokeOpacity={0.2} strokeWidth={stroke} />
          {value > 0 && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--accent)" strokeWidth={stroke}
            strokeLinecap="round" strokeDasharray={`${value * length} ${length}`} />}
        </g>
      </svg>
      <div className="score-ring-label">{children}</div>
    </div>
  )
}
