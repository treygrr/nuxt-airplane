// What llms.txt says under each page: one line per `##` section, saying what
// the section explains, so a reader can tell which page answers a question
// without fetching them all.
//
// The sections are read from the page, so the list cannot fall behind it.
// What each explains is written in the page's frontmatter, by heading:
//
//   sections:
//     Rolling back: How `rollback(id)` undoes a queued mutation, and what goes with it.
//
// A section without a line there gets the sentence it opens on. A line for a
// heading the page does not have fails the build: it was renamed or removed.

import type { H3Event } from 'h3'

/** A node of a page's body as Nuxt Content keeps it: text, or `[tag, props, ...children]`. */
type Node = string | [string, Record<string, unknown>, ...Node[]]

interface Section {
  title: string
  opening: string
}

/** Tags whose text says nothing about a section: code, tables, and the callouts. */
const SKIPPED = new Set(['pre', 'table', 'note', 'tip', 'warning', 'caution', 'style', 'script'])

function text(node: Node): string {
  if (typeof node === 'string') return node
  const [tag, , ...children] = node
  const inner = children.map(text).join('')
  return tag === 'code' ? `\`${inner}\`` : inner
}

/** The first paragraph in `nodes`, however deep, outside code, tables and callouts. */
function firstParagraph(nodes: Node[]): string | undefined {
  for (const node of nodes) {
    if (typeof node === 'string' || SKIPPED.has(node[0])) continue
    if (node[0] === 'p') {
      const found = text(node).replace(/\s+/g, ' ').trim()
      if (found) return found
      continue
    }
    const found = firstParagraph(node.slice(2) as Node[])
    if (found) return found
  }
}

/** Its first sentence, without the colon that leads into an example. */
function firstSentence(paragraph: string): string {
  const end = paragraph.search(/[.!?:](?=\s|$)/)
  const sentence = end === -1 ? paragraph : paragraph.slice(0, end + 1)
  return sentence.replace(/:$/, '.')
}

/** The page's sections: each `##` heading and the sentence under it. */
function sectionsOf(body: Node[]): Section[] {
  const sections: { title: string, nodes: Node[] }[] = []
  for (const node of body) {
    if (typeof node !== 'string' && node[0] === 'h2') sections.push({ title: text(node).trim(), nodes: [] })
    else sections.at(-1)?.nodes.push(node)
  }
  return sections.map(({ title, nodes }) => ({ title, opening: firstSentence(firstParagraph(nodes) ?? '') }))
}

export default defineNitroPlugin((nitroApp) => {
  // Registered after Nuxt Content's own hook, which turns each section's pages into links.
  nitroApp.hooks.hook('llms:generate', async (event, options) => {
    const pages = await queryCollection(event as H3Event, 'docs').select('path', 'body', 'sections').all()
    const byLink = new Map(pages.map((page) => {
      const found = sectionsOf((page.body as unknown as { value?: Node[] } | null)?.value ?? [])
      const written = page.sections ?? {}
      const stale = Object.keys(written).filter(title => !found.some(section => section.title === title))
      if (stale.length) throw new Error(`[llms.txt] ${page.path}: \`sections\` in the frontmatter names ${stale.map(title => `"${title}"`).join(', ')}, which the page has no \`##\` heading for. Its headings: ${found.map(section => `"${section.title}"`).join(', ')}.`)
      return [`/raw${page.path}.md`, found.map(section => ({ title: section.title, opening: written[section.title] ?? section.opening }))] as const
    }))
    for (const section of options.sections) {
      for (const link of section.links ?? []) {
        const found = [...byLink].find(([path]) => link.href.endsWith(path))?.[1]
        if (!found?.length) continue
        const lines = found.map(({ title, opening }) => `  - ${title}${opening ? `: ${opening}` : ''}`)
        link.description = [link.description, ...lines].filter(Boolean).join('\n')
      }
    }
  })
})
