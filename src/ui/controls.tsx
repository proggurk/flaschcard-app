// Small iOS-style building blocks: grouped sections and rows, segmented
// control, switch, select pill, bottom sheet, empty state.
import type { ReactNode } from 'react'
import Icon, { type IconName } from './icons.tsx'
import { avatarColor, initial } from './colors.ts'

// A colored circle with someone's initial (the color is stable per user)
export function Avatar({ id, name, large }: { id: string, name: string, large?: boolean }) {
  return <span className={`avatar${large ? ' large' : ''}`} style={{ background: avatarColor(id) }} aria-hidden="true">{initial(name)}</span>
}

export function Section({ title, action, footer, error, children }: {
  title?: ReactNode
  action?: ReactNode  // shown at the right end of the header
  footer?: ReactNode
  error?: boolean     // footer is an error message
  children: ReactNode
}) {
  return (
    <section className="section">
      {(title || action) && <h2 className="section-header"><span>{title}</span>{action}</h2>}
      {children}
      {footer && <p className={`section-footer${error ? ' error' : ''}`}>{footer}</p>}
    </section>
  )
}

export function Group({ children }: { children: ReactNode }) {
  return <div className="group">{children}</div>
}

interface RowProps {
  title: ReactNode
  sub?: ReactNode
  icon?: ReactNode      // e.g. <RowIcon/> or an avatar, shown before the text
  inset?: 'icon' | 'avatar' // where the separator above the next row starts
  value?: ReactNode
  trailing?: ReactNode
  chevron?: boolean
  tone?: 'accent' | 'destructive'
  centered?: boolean
  disabled?: boolean
  onClick?: () => void
}

// A list row. With onClick it's a button (tap highlight, chevron etc.).
export function Row({ title, sub, icon, inset, value, trailing, chevron, tone, centered, disabled, onClick }: RowProps) {
  const className = ['row', inset && `with-${inset}`, tone, centered && 'centered'].filter(Boolean).join(' ')
  const content = (
    <>
      {icon}
      {centered ? title : (
        <div className="row-main">
          <div className="row-title">{title}</div>
          {sub && <div className="row-sub">{sub}</div>}
        </div>
      )}
      {value !== undefined && <span className="row-value">{value}</span>}
      {trailing}
      {chevron && <span className="row-chevron"><Icon name="chevronRight" size={18} weight={2.4} /></span>}
    </>
  )
  return onClick
    ? <button className={className} onClick={onClick} disabled={disabled}>{content}</button>
    : <div className={className}>{content}</div>
}

export function RowIcon({ color, children, icon }: { color: string, children?: ReactNode, icon?: IconName }) {
  return <span className="row-icon" style={{ background: color }}>{icon ? <Icon name={icon} size={18} weight={2.2} /> : children}</span>
}

export function Segmented<T extends string | number>({ options, value, onChange, label, padded }: {
  options: { value: T, label: string }[]
  value: T
  onChange: (value: T) => void
  label: string // what is being chosen, for screen readers
  padded?: boolean
}) {
  const index = Math.max(0, options.findIndex((o) => o.value === value))
  return (
    <div className={`segmented${padded ? ' padded' : ''}`} role="group" aria-label={label}>
      <div className="segmented-thumb" style={{
        width: `calc((100% - 4px) / ${options.length})`,
        transform: `translateX(${index * 100}%)`,
      }} />
      {options.map((o) => (
        <button key={String(o.value)} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  )
}

export function Switch({ checked, onChange, disabled, label }: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  label: string
}) {
  return (
    <input type="checkbox" role="switch" className="switch" aria-label={label}
      checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
  )
}

// A native <select> that looks like a pill button (opens the iOS picker wheel)
export function SelectPill<T extends string>({ value, options, onChange, label }: {
  value: T
  options: { value: T, label: string }[]
  onChange: (value: T) => void
  label: string
}) {
  const current = options.find((o) => o.value === value)
  return (
    <label className="select-pill">
      <span>{current?.label}</span>
      <Icon name="chevronDown" size={16} weight={2.6} />
      <select value={value} aria-label={label} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}

export function Sheet({ title, leaving, onClose, left, right, children }: {
  title: string
  leaving: boolean
  onClose: () => void
  left?: ReactNode
  right?: ReactNode
  children: ReactNode
}) {
  return (
    <>
      <div className={`sheet-backdrop${leaving ? ' leaving' : ''}`} onClick={onClose} />
      <div className={`sheet${leaving ? ' leaving' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-grabber" />
        <div className="sheet-header">
          <div className="navbar-side">{left}</div>
          <div className="sheet-title">{title}</div>
          <div className="navbar-side end">{right}</div>
        </div>
        {children}
      </div>
    </>
  )
}

export function EmptyState({ icon, title, text, children }: { icon: IconName, title: string, text: ReactNode, children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon"><Icon name={icon} size={34} /></div>
      <p className="empty-title">{title}</p>
      <p className="empty-text">{text}</p>
      {children}
    </div>
  )
}
