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

**Seen again, across tabs:** with "Work offline" on in one tab and ten changes queued there, a second tab opened on the shop sent all ten at once. A tab drains whatever queue it finds when it starts, and the queue is shared while the switch is not. So in practice "Work offline" holds only until the shopper opens the shop in another tab, or reloads. That makes the first option (keep it in the database, shared by the tabs) look like the right one.

Status: not changed. The switch in the app bar is left as it is.

## 2. `codegen.scalars` replaced the module's `ID` mapping

**Done:** mapped the shop's `DateTime` scalar with `codegen: { scalars: { DateTime: 'string' } }`.

**Happened:** every `ID` variable became `string | number`, so a handler could not hand `variables.siteId` to a row that wants a string.

**Expected:** the module's own `ID: string` mapping to stay, with `DateTime` added to it.

**Cause:** certain. The module spread the user's codegen config over its own, and `scalars` replaced its `ID` entry.

Status: fixed in the module, #61. The playground's workaround is gone.

## 3. Enums and input types were declared twice in the generated types

**Done:** wrote `{ status: 'CANCELLED' }` to an order row in `CancelOrder`'s `apply`.

**Happened:** a type error. The generated file declared `OrderStatus` both as an enum and as a string union, and the row type pointed at the enum. Every input type was declared twice too. `skipLibCheck` kept the duplicates out of sight.

**Cause:** certain. The module ran both the `typescript` and `typescript-operations` codegen plugins, and since v6 the second declares the enums and input types the operations use itself.

Status: fixed in the module, #61, which runs the operations plugin alone. The playground's workaround is gone.

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

## 7. A `read` that loads a whole table blocks the page while the catalog is fetched

**Done:** with the 50,000-product catalog, opened the home page, whose "New arrivals" row reads the products and starts the background walk of every page.

**Happened:** 382 long tasks on the main thread over the walk, 68 s of them in all, the longest 374 ms; a 100 ms timer fired up to 900 ms late. The handlers that write ran in the worker as intended.

**Cause:** certain, and in the app. `GetProducts`' `read` loaded every product and sorted it in JavaScript. A `read` runs on the page, in a live query, and runs again whenever a table it read changes. During the walk that is once per page, 255 times, each time over a bigger table.

**Fix, in the app:** the unfiltered listing walks an index in the sort order and stops at the page (`orderBy('[price+name]').offset(n).limit(24)`), so it reads a few rows and is only woken by writes in that range. The same walk then had 3 long tasks (232 ms in all, the longest 92 ms); the timer was late by 2 ms at the 95th percentile. Offline, the first page by name or price answers in about 10 ms from 50,000 rows; a search the server never saw takes about 0.8 s, since it has to look at every product.

Open, for the docs: the query handler guide could say this outright, since nothing about `read` hints that its cost is paid again on every write to the tables it touches.

## 8. Offline, a page never opened could not be opened at all

**Done:** in the end-to-end tests, opened the shop online, let the catalog be fetched, went offline (the browser's own offline mode), and clicked a category.

**Happened:** a blank page. The category's data was in the tables, but the page's code was not: Nuxt splits each page into its own file, fetched the first time the page opens, and offline that fetch fails.

**Cause:** certain, and not the module's: it keeps data, not the app's code. An app that wants to be navigable offline needs its code kept too, which is a service worker's job.

**In the playground:** a plugin downloads every page's code once the app is idle (`app/plugins/preload-pages.client.ts`). That lasts for the session; across a reload offline only a service worker helps.

Open, for the docs: the module's docs could say plainly that offline data is half of working offline, and point at a service worker for the other half.

## 9. The lab's idempotency let a retry through while the first attempt was still running (playground only)

**Done:** closed a tab while 3 of its changes were being sent, with the server holding each for 400 ms, and opened another.

**Happened:** in a production build, the new tab resent them before the first attempts had finished, and the server applied 4 of them twice. In dev it had not shown, since the timing differed.

**Cause:** certain. The server remembered a key only once its first attempt had finished, so a retry arriving during that attempt ran as well. The client did exactly what it should: same keys, every time.

**Fixed, in the playground's server:** a key whose first attempt is still running is waited on, and the retry gets that attempt's answer. Real servers that take idempotency keys need the same; the module's security and sync docs could say so where they introduce the keys.

## 10. A page opened by a temp id has nothing to follow when the id is resolved

**Done:** made a wishlist offline, opened it (`/wishlists/tmp-…`), then went online.

**Happened:** the list synced, its row took the server's id, and the open page showed "List not found". Anything that keeps a temp id outside the database (a URL, a component's state, a bookmark) is left holding an id that no longer exists.

**Expected:** a way to learn what a temp id became, so the page can follow it.

**Cause:** certain. The engine keeps the temp-to-server map in its `meta` table under `tempIds` (`readTempIdMap` in `src/runtime/helpers.ts`), and nothing public exposes it or announces a resolution.

**Worked around, in the playground:** the list page reads `meta.tempIds` itself when its list disappears and replaces the route (`app/pages/wishlists/[id].vue`). That leans on the module's bookkeeping, which is not an API.

**Open, for a decision:**

- A `resolveId(id)` on the client: the server's id for a temp id, or the id itself. Pages call it when their row goes missing.
- A composable, `useResolvedId(id)`, that returns a ref which moves to the server's id when it is resolved. Pages watch it and replace the route.
- Both: the composable built on the client method.

## 11. Queueing a change costs more the longer the queue is

**Done:** with the 50,000-product catalog, queued on-hand counts for different items at one site, offline, and timed each (`e2e/stress.e2e.ts`).

**Happened:** the first took 6 ms, the 400th 38 ms, the 1,000th about 100 ms. A thousand took 52 s to queue and 2,000 took 209 s: four times as long for twice as many. Draining a thousand, with the server answering at once, took 60 s.

**Expected:** a change costs about the same whether it is the first in the queue or the thousandth. A stock take of a few thousand items offline is the case this module is for.

**Cause:** certain for queueing. Every `enqueue` reads the whole outbox at least twice: `mergeTarget` walks it for a mutation to fold into, and `linksOf` walks it for what the new one depends on (`src/runtime/engine.ts`); a third read happens when there is a merge. The client's live `pending` list reads it all again after every change (`src/runtime/client.ts`). Reading a queue of 1,200 takes 28 ms, which accounts for the rest. Likely the same for draining, not measured apart: `sendable` and `acknowledge` read the whole outbox for every mutation sent.

**Open, for a decision:**

- Index what the walks look for. `linksOf` asks which rows minted a placeholder, created a row, or wrote a piece: multi-entry indexes on `tempIds`, `creates` and `writes` answer that without reading the rest. `mergeTarget` could read only the rows of the same document, newest first, which helps a mixed queue but not a thousand of one kind.
- Keep the queue in memory in the tab that owns it, refreshed when another tab writes, and answer all of these from it. Fastest, and the most to get wrong across tabs.
- Give `merge` a key (the row it is about), so the fold is a lookup rather than a walk.

Status: fixed in the module, with the first option and one thing more.

- The outbox is indexed on what the walks look for (`document`, the rows a mutation changed, what it created and wrote, its placeholders, and whether it changed nothing). `enqueue` and `acknowledge` no longer read the queue. A mutation to fold into is looked for among those that changed a row the new one changed too, which narrows `merge`: two mutations of one document that share no row are no longer offered to it.
- The indexes alone took a thousand from 52 s to 33 s. The rest was the live `pending` list: read in full after every change, and each read held up the next write. It now rests ten times as long as its last read took, two seconds at most.

Measured after: a change costs 3.9 ms into an empty queue and 3.0 ms into one of 400; a thousand queue in 3.7 s (was 52 s) and drain in 33 s (was 60 s), which is about 33 ms a change whatever the length. `queueing a change costs the same however long the queue is` holds that in the stress suite.

Left as it is: resolving a placeholder still rewrites the whole queue (`rewriteQueue`), so a long queue of creates pays for its length once per create.

## 12. Two mutations fired together could be applied out of order, and a failed one could take the other with it

**Done:** added a product to a site with "restock now" ticked. The dialog calls `addItem.mutate(...)` and `addToCart.mutate(...)` one after the other without awaiting the first. Seen once queueing had been made faster (finding 11): the e2e scenario for it failed.

**Happened:** the cart line was applied before the item it is for, threw, and the item's own mutation vanished from the outbox. The item showed on the page and never reached the server.

**Expected:** the two are applied in the order they were called, and a mutation whose `apply` throws leaves every other one alone.

**Cause:** certain, and two things.

- Nothing kept the order. Each `enqueue` did its reads (`describe`, the search for a mutation to fold into) and then opened its transaction, so whichever had less to read went first. It had held by luck.
- After an `apply` throws, `enqueue` deletes the outbox row it had added, by id, in case the transaction committed anyway. But the transaction had aborted, and IndexedDB hands the id of an aborted row to the next one added: the delete removed the other mutation's row.

Status: fixed in the module. Mutations are queued one at a time in call order, and the clean-up deletes a row only if it carries the failed mutation's own idempotency key.
