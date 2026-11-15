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
