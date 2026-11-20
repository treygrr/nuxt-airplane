<script setup lang="ts">
const { data, loading } = useAirplaneQuery('GetSites')
const { online, synced, pending } = useAirplaneSync()
// Answered by the server while the page renders.
const live = useOnlineQuery('GetSites')
// Off: sends nothing, on the server or in the browser.
const off = useOnlineQuery('GetSites', undefined, { enabled: false })
</script>

<template>
  <div>
    <div>basic</div>
    <p>online:{{ online }}</p>
    <p>synced:{{ synced }}</p>
    <p>pending:{{ pending.length }}</p>
    <p>loading:{{ loading }}</p>
    <p>sites:{{ data?.sites.length ?? 0 }}</p>
    <p>live:{{ live.data.value?.sites[0]?.name ?? 'none' }}</p>
    <p>live-fetching:{{ live.fetching.value }}</p>
    <p>off-fetching:{{ off.fetching.value }}</p>
  </div>
</template>
