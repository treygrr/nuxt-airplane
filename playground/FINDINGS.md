# Findings

What the shop turned up about nuxt-airplane while it was being built. One
entry per finding: what was done, what happened, what should have happened,
and how sure the cause is. A finding that needs a design decision lists the
options and leaves the choice open.

## 1. "Work offline" does not survive a reload

**Done:** turned on the shell's "Work offline" switch (`useSync().goOffline()`), then reloaded the page.

**Happened:** the app came back online and synced the queue.

**Expected:** a user who chose to work offline (on a metered connection, say) stays offline until they turn it off.

**Cause:** certain. `forcedOffline` is a field of the client's in-memory state and nothing stores it (`src/runtime/client.ts`).

**Open, for a decision:**

- Keep it in the database's `meta` table, so it survives reloads and is shared by the tabs. Tabs already share the outbox, so one tab going online while another holds offline would be odd.
- Keep it per tab, in memory, as now, and document that.

Status: not changed. The switch in the app bar is left as it is.

## 2. `codegen.scalars` replaced the module's `ID` mapping

**Done:** mapped the shop's `DateTime` scalar with `codegen: { scalars: { DateTime: 'string' } }`.

**Happened:** every `ID` variable became `string | number`, so a handler could not hand `variables.siteId` to a row that wants a string.

**Expected:** the module's own `ID: string` mapping to stay, with `DateTime` added to it.

**Cause:** certain. The module spread the user's codegen config over its own, and `scalars` replaced its `ID` entry.

Status: fixed in the module, #61. Until it is merged, `nuxt.config.ts` restates `ID`.

## 3. Enums and input types were declared twice in the generated types

**Done:** wrote `{ status: 'CANCELLED' }` to an order row in `CancelOrder`'s `apply`.

**Happened:** a type error. The generated file declared `OrderStatus` both as an enum and as a string union, and the row type pointed at the enum. Every input type was declared twice too. `skipLibCheck` kept the duplicates out of sight.

**Cause:** certain. The module ran both the `typescript` and `typescript-operations` codegen plugins, and since v6 the second declares the enums and input types the operations use itself.

Status: fixed in the module, #61, which runs the operations plugin alone. Until it is merged, `nuxt.config.ts` sets `enumsAsTypes: true`, which makes both declarations unions.

## 4. A file without a default export in the handlers directory stopped the app

**Done:** kept the handlers' shared helpers in `app/airplane/shared.ts`, with named exports only.

**Happened:** the app never hydrated. The generated module did `import h0 from '…/shared.ts'`, a link error for a file with no default export (`MISSING_EXPORT` in a production build).

**Cause:** certain. The runtime already skipped a file whose default export is `undefined`; the import did not let it get that far.

Status: fixed in the module, #60. The helpers live in `app/lib/airplane.ts` in any case.

## 5. A running total in `apply` serialises every mutation that touches it

**Done:** queued 40 on-hand counts for 40 different items at one site, with the server holding each mutation 150 ms.

**Happened:** they were sent one at a time (7.7 s), not four at a time.

**Expected, on reflection:** exactly that. Each `apply` also adjusted the site's `unitCount`, so all 40 changed the same `Site` row, and the module keeps changes to one row in order. Without that line they went four at a time and drained in 1.7 s with no overlap on the server.

**Cause:** certain, and not a bug. A total kept up to date in `apply` couples every mutation that feeds it. The handler now leaves the total to the refetch it names.

Open, for the docs: the sync guide's "Side by side" section could say this in a sentence, since a handler that looks harmless decides whether a queue drains in parallel.

## 6. A dropped connection cannot be simulated in dev (playground only)

**Done:** made the server close the connection on a request, to look like a network failure.

**Happened:** in dev the request hung until the client's own 30 second timeout. Nuxt's dev server proxies each request to Nitro, and the browser's connection outlives the one Nitro closes.

Status: the playground's server answers `502` with no body in dev instead, which the client treats the same way (stays queued, retries later). A production build closes the connection for real; that was checked, and the client sees a socket error after 44 ms. Not a module issue.
