<script setup lang="ts">
const showArchived = ref(false)
const search = ref('')
// Filtering is a query variable: the server applies it to the response and
// `read` applies the same filter to the local tables, so it works offline.
const { data: sitesData, loading, fetching, error, updatedAt, refresh } = useQuery('GetSites', () => ({
  archived: showArchived.value ? null : false,
  search: search.value.trim() || null,
}))
const { data: itemsData } = useQuery('GetItems')
const sync = useSync()

const archive = useMutation('ArchiveSite')
const unarchive = useMutation('UnarchiveSite')
const rename = useMutation('RenameSite')
const remove = useMutation('DeleteSite')
const addItem = useMutation('AddSiteItem')
const removeItem = useMutation('RemoveSiteItem')
const setOnHand = useMutation('UpdateSiteItemOnHand')

const sites = computed(() => sitesData.value?.sites ?? [])

// Paginated catalog search: one cursor per loaded page, reset when the query changes.
const itemSearch = ref('')
const itemQuery = computed(() => itemSearch.value.trim() || null)
const cursors = ref<(string | null)[]>([null])
watch(itemQuery, () => (cursors.value = [null]))

// The same catalog with classic numbered pages: one query whose `page`
// variable changes, so every visited page is its own cached row.
const pagingMode = ref<'cursor' | 'pages'>('cursor')
const page = ref(1)
watch(itemQuery, () => (page.value = 1))
const itemsPage = useQuery('ItemsPage', () => ({ query: itemQuery.value, page: page.value, pageSize: 20 }))
const catalog = computed(() => itemsData.value?.items ?? [])
const picked = reactive<Record<string, string>>({})

function promptRename(site: { id: string, name: string }) {
  const name = window.prompt('New name', site.name)
  if (name && name !== site.name) rename.mutate({ id: site.id, name })
}

function confirmDelete(site: { id: string, name: string }) {
  if (window.confirm(`Delete ${site.name}?`)) remove.mutate({ id: site.id })
}

function add(siteId: string) {
  const itemId = picked[siteId]
  if (!itemId) return
  addItem.mutate({ siteId, itemId, onHand: 0 })
  picked[siteId] = ''
}

function available(site: { items: { id: string }[] }) {
  return catalog.value.filter(c => !site.items.some(i => i.id === c.id))
}

function summarize(m: { document: string, variables: unknown }) {
  return `${m.document} ${JSON.stringify(m.variables)}`
}
</script>

<template>
  <main>
    <header :class="{ offline: !sync.online.value }">
      <img
        src="/logo.png"
        alt="nuxt-airplane"
        class="logo"
      >
      <strong>{{ sync.online.value ? 'Online' : 'Offline' }}</strong>
      <span v-if="sync.syncing.value">Syncing {{ sync.syncCount.value }} / {{ sync.syncTotal.value }}…</span>
      <span v-else-if="sync.synced.value">Synced</span>
      <span v-else>{{ sync.pending.value.length }} pending<template v-if="sync.blocked.value"> · {{ sync.blocked.value }} blocked</template></span>
      <span
        v-if="sync.lastError.value"
        class="error"
      >{{ sync.lastError.value }}</span>
      <span v-if="sync.prefetching.value">· caching pages for offline…</span>
      <button
        v-if="sync.forcedOffline.value"
        class="force"
        @click="sync.goOnline()"
      >
        Go online
      </button>
      <button
        v-else
        class="force"
        @click="sync.goOffline()"
      >
        Go offline
      </button>
      <button
        :disabled="!sync.online.value || sync.synced.value"
        @click="sync.sync()"
      >
        Sync now
      </button>
    </header>

    <section
      v-if="sync.pending.value.length"
      class="pending"
    >
      <h2>Pending changes</h2>
      <ul>
        <li
          v-for="m in sync.pending.value"
          :key="m.id"
          :class="m.status"
        >
          <span class="description">{{ m.description }}</span>
          <code :title="summarize(m)">{{ m.document }}</code>
          <em>{{ m.status }}</em>
          <span
            v-if="m.error"
            class="error"
          >{{ m.error }}</span>
          <button
            v-if="m.status === 'failed'"
            @click="sync.retry(m.id)"
          >
            Retry
          </button>
          <button
            :disabled="m.status === 'syncing'"
            @click="sync.rollback(m.id)"
          >
            Roll back
          </button>
        </li>
      </ul>
    </section>

    <section>
      <h1>
        Sites
        <small v-if="fetching">refreshing…</small>
        <small v-else-if="updatedAt">as of {{ new Date(updatedAt).toLocaleTimeString() }}</small>
      </h1>
      <div class="filters">
        <input
          v-model="search"
          type="search"
          placeholder="Search sites…"
        >
        <label><input
          v-model="showArchived"
          type="checkbox"
        > Show archived</label>
        <button @click="refresh()">
          Refresh
        </button>
      </div>
      <p
        v-if="error"
        class="error"
      >
        {{ error.message }}
      </p>
      <p v-if="loading">
        Loading…
      </p>

      <article
        v-for="site in sites"
        :key="site.id"
        :class="{ archived: site.archived }"
      >
        <h3>
          {{ site.name }}
          <em v-if="site.archived">archived</em>
        </h3>
        <div class="actions">
          <button @click="promptRename(site)">
            Rename
          </button>
          <button
            v-if="site.archived"
            @click="unarchive.mutate({ id: site.id })"
          >
            Unarchive
          </button>
          <button
            v-else
            @click="archive.mutate({ id: site.id })"
          >
            Archive
          </button>
          <button @click="confirmDelete(site)">
            Delete
          </button>
        </div>

        <table>
          <tr
            v-for="item in site.items"
            :key="item.id"
          >
            <td>{{ item.name }}</td>
            <td>
              <input
                type="number"
                min="0"
                :value="item.onHand"
                @change="setOnHand.mutate({ siteId: site.id, itemId: item.id, onHand: Number(($event.target as HTMLInputElement).value) })"
              >
            </td>
            <td>
              <button @click="removeItem.mutate({ siteId: site.id, itemId: item.id })">
                Remove
              </button>
            </td>
          </tr>
        </table>

        <div class="actions">
          <select v-model="picked[site.id]">
            <option value="">
              Add item…
            </option>
            <option
              v-for="c in available(site)"
              :key="c.id"
              :value="c.id"
            >
              {{ c.name }}
            </option>
          </select>
          <button
            :disabled="!picked[site.id]"
            @click="add(site.id)"
          >
            Add
          </button>
        </div>
      </article>
    </section>

    <section>
      <h1>Items catalog</h1>
      <div class="filters">
        <input
          v-model="itemSearch"
          type="search"
          placeholder="Search items…"
        >
      </div>
      <div class="filters">
        <label><input
          v-model="pagingMode"
          type="radio"
          value="cursor"
        > Load more</label>
        <label><input
          v-model="pagingMode"
          type="radio"
          value="pages"
        > Pages</label>
      </div>

      <template v-if="pagingMode === 'cursor'">
        <ItemsPage
          v-for="(after, i) in cursors"
          :key="after ?? 'first'"
          :query="itemQuery"
          :after="after"
          :last="i === cursors.length - 1"
          @next="cursor => cursors.push(cursor)"
        />
      </template>

      <template v-else>
        <p v-if="itemsPage.loading.value">
          Loading…
        </p>
        <template v-else-if="itemsPage.data.value">
          <p class="meta">
            {{ itemsPage.data.value.itemsPage.totalCount }} items · page {{ itemsPage.data.value.itemsPage.page }} of {{ itemsPage.data.value.itemsPage.totalPages }}
            <span v-if="itemsPage.fetching.value">· refreshing…</span>
          </p>
          <ul class="items">
            <li
              v-for="item in itemsPage.data.value.itemsPage.items"
              :key="item.id"
            >
              {{ item.name }}
            </li>
          </ul>
          <PageNav
            :page="page"
            :total-pages="itemsPage.data.value.itemsPage.totalPages"
            @go="p => (page = p)"
          />
        </template>
      </template>
    </section>
  </main>
</template>

<style>
body { font-family: system-ui, sans-serif; margin: 0; background: #f6f6f6; color: #222; }
main { max-width: 720px; margin: 0 auto; padding: 16px; }
header { display: flex; gap: 12px; align-items: center; padding: 10px 14px; border-radius: 8px; background: #d9f5e3; margin-bottom: 16px; }
header.offline { background: #fde7c8; }
header .logo { width: 28px; height: 28px; }
header .force { margin-left: auto; }
article { background: #fff; border-radius: 8px; padding: 12px 16px; margin: 12px 0; box-shadow: 0 1px 2px rgba(0,0,0,.08); }
article.archived { opacity: .6; }
article h3 { margin: 0 0 8px; display: flex; gap: 8px; align-items: baseline; }
article h3 em, .pending em { font-size: .8em; color: #777; }
.filters { display: flex; gap: 12px; align-items: center; margin: 8px 0 12px; }
.filters input[type=search] { flex: 1; padding: 6px 8px; }
.actions { display: flex; gap: 6px; margin: 8px 0; }
table { width: 100%; border-collapse: collapse; }
td { padding: 4px 0; }
td input { width: 70px; }
.pending { background: #fff; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; }
.pending ul { list-style: none; padding: 0; margin: 0; }
.pending li { display: flex; gap: 8px; align-items: center; padding: 6px 0; border-top: 1px solid #eee; }
.pending li .description { flex: 1; }
.pending li code { font-size: .8em; color: #777; }
.pending li.failed { color: #a33; }
.error { color: #a33; }
.meta { color: #777; font-size: .9em; }
.items { columns: 2; list-style: none; padding: 0; margin: 8px 0; }
.items li { padding: 2px 0; }
h1 small { font-size: .5em; color: #777; font-weight: normal; }
</style>
