// Temp id primitives, with no import at all: `isTempId` is auto-imported in
// components that render on the server, where IndexedDB is not there. See
// `helpers.ts` for what a temp id is.

export const TEMP_ID_PREFIX = 'tmp-'
export const TEMP_ID_RE = /^tmp-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function uuid() {
  return typeof crypto === 'object' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
      })
}

/** A fresh placeholder id: `tmp-` plus a UUID. */
export function newTempId() {
  return `${TEMP_ID_PREFIX}${uuid()}`
}

/**
 * Whether a value is a placeholder id minted by `tempId()` in an `apply`: the
 * id of a row created offline that the server has not named yet. Anything
 * else, a real id, another string or not a string at all, is `false`.
 */
export function isTempId(value: unknown): value is string {
  return typeof value === 'string' && TEMP_ID_RE.test(value)
}
