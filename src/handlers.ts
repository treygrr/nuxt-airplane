// Build-time check of the handlers directory: a default export that was not
// made with a define* helper carries no HANDLER_KIND tag, so the runtime would
// silently skip it. The check is a regex over the file text, so it can only
// see literals and calls; identifiers are left to the runtime warning.

/** The helpers whose result is tagged for the runtime collector. */
export const DEFINE_HELPERS = [
  'defineMutationHandler',
  'defineMutationHandlers',
  'defineQueryHandler',
  'defineQueryHandlers',
  'defineAirplaneStores',
  'defineAirplaneRequest',
] as const

/** Hint appended to the build error. */
export const WRAP_HINT = 'Wrap it in defineMutationHandlers(...) / defineQueryHandler(name, ...) / defineAirplaneStores(...) / defineAirplaneRequest(...), or export it from outside the handlers directory.'

/** Drops block comments and whole-line / trailing `//` comments (not `://` in URLs). */
function stripComments(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1')
}

/**
 * Finds a `export default` whose expression can be seen, statically, not to
 * be the result of a define* helper: an object or array literal, a function,
 * a class, a literal value, or a call to something else. Returns `null` for
 * files without a default export and for identifiers or member expressions,
 * which cannot be resolved from the text alone.
 */
export function findUntaggedDefaultExport(source: string): { reason: string } | null {
  const code = stripComments(source)
  const match = /\bexport\s+default\s+(?:await\s+)?/.exec(code)
  if (!match) return null
  const rest = code.slice(match.index + match[0].length).trimStart()

  if (rest.startsWith('{')) return { reason: 'an object literal' }
  if (rest.startsWith('[')) return { reason: 'an array literal' }
  if (/^(?:async\s+)?function\b/.test(rest)) return { reason: 'a function' }
  if (/^class\b/.test(rest)) return { reason: 'a class' }
  if (/^new\b/.test(rest)) return { reason: 'a `new` expression' }
  if (/^(?:async\s+)?(?:\([^)]*\)|[\w$]+)\s*=>/.test(rest)) return { reason: 'an arrow function' }
  if (/^(?:['"`\d]|true\b|false\b|null\b|undefined\b)/.test(rest)) return { reason: 'a literal value' }

  const call = /^([\w$]+(?:\s*\.\s*[\w$]+)*)\s*(?:<[^()]*>\s*)?\(/.exec(rest)
  if (call) {
    const callee = call[1]!.replace(/\s+/g, '')
    if ((DEFINE_HELPERS as readonly string[]).includes(callee)) return null
    return { reason: `a call to \`${callee}()\`` }
  }

  return null
}
