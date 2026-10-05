// Renders Anki card templates ({{Front}}, {{#Field}}...{{/Field}}, {{cloze:Text}}, ...)
// into plain HTML for the front and back of a card.
// Reference: https://docs.ankiweb.net/templates/fields.html

export interface TemplateContext {
  fields: Record<string, string>
  clozeOrd: number | null // 1-based cloze number for cloze note types
  frontSide: string       // rendered question, for {{FrontSide}} on the answer
  tags: string
  deck: string
  cardName: string
  noteType: string
}

type Side = 'q' | 'a'

const SECTION = /\{\{([#^])\s*([^}]+?)\s*\}\}([\s\S]*?)\{\{\/\s*\2\s*\}\}/
const TAG = /\{\{([^{}]+?)\}\}/g
const CLOZE = /\{\{c(\d+)::([\s\S]*?)(?:::([^}]*?))?\}\}/g

export function renderTemplate(template: string, ctx: TemplateContext, side: Side): string {
  // 1. Conditional sections: {{#Field}}shown if Field has content{{/Field}}, {{^Field}} = if empty
  let out = template
  let m: RegExpExecArray | null
  while ((m = SECTION.exec(out))) {
    const [whole, kind, key, inner] = m
    const filled = !isEmptyField(lookup(fieldName(key), ctx, side))
    const keep = kind === '#' ? filled : !filled
    out = out.slice(0, m.index) + (keep ? inner : '') + out.slice(m.index + whole.length)
  }

  // 2. Replacements: {{Field}}, {{filter:Field}}, {{filter2:filter1:Field}}
  return out.replace(TAG, (_, spec: string) => {
    spec = spec.trim()
    if (/^[#^/!]/.test(spec)) return '' // stray section tag or comment
    const parts = spec.split(':')
    const name = parts.pop()!.trim()
    let value = lookup(name, ctx, side)
    // Filters apply right-to-left: {{text:cloze:Text}} runs cloze first, then text
    for (const filter of parts.reverse().map((f) => f.trim())) value = applyFilter(filter, value, ctx, side)
    return value
  })
}

function fieldName(key: string) {
  return key.split(':').pop()!.trim()
}

function lookup(name: string, ctx: TemplateContext, side: Side): string {
  if (name in ctx.fields) return ctx.fields[name]
  switch (name) {
    case 'FrontSide': return side === 'a' ? ctx.frontSide : ''
    case 'Tags': return ctx.tags
    case 'Type': return ctx.noteType
    case 'Deck': return ctx.deck
    case 'Subdeck': return ctx.deck.split('::').pop() ?? ''
    case 'Card': return ctx.cardName
    default: return ''
  }
}

function applyFilter(filter: string, value: string, ctx: TemplateContext, side: Side): string {
  switch (filter) {
    case 'text': return stripHtml(value)
    case 'cloze': return renderCloze(value, ctx.clozeOrd, side)
    case 'cloze-only': return ''
    case 'type': return '' // "type the answer" input: not supported yet
    case 'hint': return value ? `<details><summary>Hint</summary>${value}</details>` : ''
    case 'furigana': return value.replace(/ ?([^ >]+?)\[(.+?)\]/g, '<ruby>$1<rt>$2</rt></ruby>')
    case 'kana': return value.replace(/ ?([^ >]+?)\[(.+?)\]/g, '$2')
    case 'kanji': return value.replace(/ ?([^ >]+?)\[(.+?)\]/g, '$1')
    default:
      if (filter.startsWith('tts')) return '' // text-to-speech: not supported
      return value // unknown filter: show the field as-is
  }
}

export function renderCloze(text: string, ord: number | null, side: Side): string {
  if (ord === null) return text
  return text.replace(CLOZE, (_, n: string, content: string, hint?: string) => {
    if (Number(n) !== ord) return content // other clozes on the same note are shown normally
    return side === 'q'
      ? `<span class="cloze">[${hint ?? '...'}]</span>`
      : `<span class="cloze">${content}</span>`
  })
}

// Anki treats a field as empty if it only has whitespace/line breaks (an image counts as content)
export function isEmptyField(html: string): boolean {
  return html.replace(/<\/?(br|div|p)\s*\/?>|&nbsp;|\s/gi, '') === ''
}

export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()
}
