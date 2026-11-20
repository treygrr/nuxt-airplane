---
title: nuxt-airplane
description: Airplane mode for your GraphQL app. Typed composables from your .gql files, IndexedDB tables inferred from them and a mutation queue that syncs when you are back online.
---

::u-page-hero{class="dark:bg-gradient-to-b from-neutral-900 to-neutral-950"}
---
orientation: horizontal
---
#top
:hero-background

#headline
:hero-logo

#title
[Airplane mode]{.text-primary} for your GraphQL app.

#description
Give it an endpoint and your `.gql` files. Every operation becomes a typed `useAirplaneQuery` or `useMutation`, results live in IndexedDB, and anything you change mid-flight queues up and lands on the server once you're back on the ground.

#links
  :::u-button
  ---
  to: /getting-started
  size: xl
  trailing-icon: i-lucide-arrow-right
  ---
  Get started
  :::

  :::u-button
  ---
  icon: i-simple-icons-github
  color: neutral
  variant: outline
  size: xl
  to: https://github.com/treygrr/nuxt-airplane
  target: _blank
  ---
  View on GitHub
  :::

#default
  :::prose-pre
  ---
  code: |
    const { data, loading } = useAirplaneQuery('GetSites')
    const rename = useMutation('RenameSite')

    // Applied to the local tables right away,
    // sent to the server when online.
    await rename.mutate({ id: 'site-1', name: 'Depot' })
  filename: pages/sites.vue
  ---

  ```ts [pages/sites.vue]
  const { data, loading } = useAirplaneQuery('GetSites')
  const rename = useMutation('RenameSite')

  // Applied to the local tables right away,
  // sent to the server when online.
  await rename.mutate({ id: 'site-1', name: 'Depot' })
  ```
  :::
::

::u-page-section{class="dark:bg-neutral-950"}
#title
Why it exists

#description
Some apps are used where the connection is not: a warehouse aisle, a basement, a delivery route. A cache of responses can show a screen again, but it cannot answer a search nobody ran online, and a change made offline is a patch waiting for an answer. Here the local database is what the app reads and writes, and the network is how it catches up.

#features
  :::u-page-feature
  ---
  icon: i-lucide-search
  ---
  #title
  Queries read tables, not responses

  #description
  What was fetched is stored as rows. A filter or a search runs against everything on the device, whether or not the server was ever asked that question.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-hard-drive
  ---
  #title
  A change is kept until the server has it

  #description
  It shows at once and waits in the database: through a reload, behind the change it depends on, and through a server that was busy.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-user-check
  ---
  #title
  The person stays in charge

  #description
  Every pending change can be listed, retried or rolled back, and the app can be held offline on purpose.
  :::
::

::u-page-section{class="dark:bg-neutral-950"}
#title
Everything from your GraphQL documents

#features
  :::u-page-feature
  ---
  icon: i-lucide-file-code
  ---
  #title
  Typed by name

  #description
  Every named query and mutation becomes `useAirplaneQuery('Name')` / `useMutation('Name')`, with `data` and variables typed from the schema.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-database
  ---
  #title
  Live data from local tables

  #description
  Every type your documents select with an id gets a typed Dexie table. Query handlers write responses in and read results out, so components read the tables, not the network, and changes show up everywhere instantly.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-cloud-off
  ---
  #title
  Mutation queue

  #description
  Mutations apply locally and queue with their inputs. When the connection returns they are sent in order, and a row created offline gets its real id in every change queued after it.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-undo-2
  ---
  #title
  Roll back pending changes

  #description
  Any queued mutation can be undone before it reaches the server. Later changes are replayed on top of the restored data.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-git-merge
  ---
  #title
  Handlers you write

  #description
  A query handler says how a response is stored and read back; a mutation handler's `apply` and `reconcile` say how a change touches the tables. The ones that write run in a web worker, off the page.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-activity
  ---
  #title
  Sync state

  #description
  `useSync()` tells you whether you are online, syncing or synced, lists pending and failed changes and lets you go offline on purpose, in every tab.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-refresh-cw
  ---
  #title
  Retries that do not repeat

  #description
  A sync the network or the server stopped is tried again by itself, with a growing wait. Every mutation carries the same idempotency key on each attempt, and only one tab sends at a time.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-user-round
  ---
  #title
  Results without an id

  #description
  The signed-in user, settings, a page of figures: `store: 'result'` keeps a result whole, and a mutation can still change it and roll it back.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-server
  ---
  #title
  Online when it should be

  #description
  `useOnlineQuery` is for what is only ever asked of the server, such as a report or live prices. It keeps nothing and is rendered on the server.
  :::
::

::u-page-section{class="dark:bg-gradient-to-b from-neutral-950 to-neutral-900"}
  :::u-page-c-t-a
  ---
  links:
    - label: Read the guide
      to: '/getting-started'
      trailingIcon: i-lucide-arrow-right
    - label: API reference
      to: '/api/use-airplane-query'
      variant: subtle
      icon: i-lucide-book-open
  title: Ready to switch on airplane mode?
  description: Install it, drop in your .gql files, and stop worrying about the Wi-Fi.
  class: dark:bg-neutral-950
  ---

  :stars-bg
  :::
::
