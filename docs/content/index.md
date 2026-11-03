---
title: nuxt-airplane
description: Airplane mode for your GraphQL app. Typed composables from your .gql files, an IndexedDB cache and a mutation queue that syncs when you are back online.
---

::u-page-hero{class="dark:bg-gradient-to-b from-neutral-900 to-neutral-950"}
---
orientation: horizontal
---
#top
:hero-background

#title
[Airplane mode]{.text-primary} for your GraphQL app.

#description
Give it an endpoint and your `.gql` files. Every operation becomes a typed `useQuery` or `useMutation`, results live in IndexedDB, and anything you change mid-flight queues up and lands on the server once you're back on the ground.

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
    const { data, loading } = useQuery('GetSites')
    const rename = useMutation('RenameSite')

    // Applied to the local cache right away,
    // sent to the server when online.
    await rename.mutate({ id: 'site-1', name: 'Depot' })
  filename: pages/sites.vue
  ---

  ```ts [pages/sites.vue]
  const { data, loading } = useQuery('GetSites')
  const rename = useMutation('RenameSite')

  // Applied to the local cache right away,
  // sent to the server when online.
  await rename.mutate({ id: 'site-1', name: 'Depot' })
  ```
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
  Every named query and mutation becomes `useQuery('Name')` / `useMutation('Name')`, with `data` and variables typed from the schema.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-database
  ---
  #title
  Live data from the cache

  #description
  Responses are stored in IndexedDB with Dexie. Components read the cache, not the network, so changes show up everywhere instantly.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-cloud-off
  ---
  #title
  Mutation queue

  #description
  Mutations apply locally and queue with their inputs. When the connection returns they are sent in order.
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
  Mutation handlers

  #description
  `defineMutationHandlers` exposes `apply`, `reconcile` and `revert` so you decide how each mutation touches the cache.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-activity
  ---
  #title
  Sync state

  #description
  `useSync()` tells you whether you are online, syncing or synced, lists pending changes and lets you go offline on purpose.
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
      to: '/api/use-query'
      variant: subtle
      icon: i-lucide-book-open
  title: Ready to switch on airplane mode?
  description: Install it, drop in your .gql files, and stop worrying about the Wi-Fi.
  class: dark:bg-neutral-950
  ---

  :stars-bg
  :::
::
