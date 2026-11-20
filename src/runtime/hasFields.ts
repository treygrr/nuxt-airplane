// A check for `read` handlers, with no import at all, so it can be
// auto-imported anywhere, the server included.

/**
 * Whether a row holds every one of `fields`: none of them is `undefined`.
 * `null` is a value the server gave, so it counts as held.
 *
 * A row's optional fields are the ones some query stores it without. A
 * `read` for a query that needs them says so with this, and gets rows typed
 * with those fields required, in place of a cast that would hide a row that
 * is not all there yet:
 *
 * ```ts
 * read: async ({ db }) => ({
 *   sites: (await db.Site.toArray()).filter(site => hasFields(site, 'archived', 'owner')),
 * })
 * ```
 */
export function hasFields<T extends object, K extends keyof T>(row: T | null | undefined, ...fields: K[]): row is T & { [P in K]-?: T[P] } {
  return !!row && fields.every(field => row[field] !== undefined)
}
