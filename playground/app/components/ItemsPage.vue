<script setup lang="ts">
// One page of the paginated catalog. Each page is its own `useQuery` with its
// own cursor, so it is cached, typed and live like any other query.
const props = defineProps<{
  query: string | null
  after: string | null
  last: boolean
}>()
const emit = defineEmits<{ next: [cursor: string] }>()

const { data, loading, fetching } = useQuery('SearchItems', () => ({
  query: props.query,
  first: 20,
  after: props.after,
}))

const connection = computed(() => data.value?.searchItems)
</script>

<template>
  <p v-if="loading">
    Loading…
  </p>
  <template v-else-if="connection">
    <p
      v-if="!after"
      class="meta"
    >
      {{ connection.totalCount }} items
      <span v-if="fetching">· refreshing…</span>
    </p>
    <ul class="items">
      <li
        v-for="edge in connection.edges"
        :key="edge.node.id"
      >
        {{ edge.node.name }}
      </li>
    </ul>
    <button
      v-if="last && connection.pageInfo.hasNextPage && connection.pageInfo.endCursor"
      @click="emit('next', connection.pageInfo.endCursor)"
    >
      Load more
    </button>
  </template>
</template>
