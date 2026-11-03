<script setup lang="ts">
const { data, loading } = useQuery('GetSites')
const { online, synced, pending } = useSync()
</script>

<template>
  <div>
    <div>basic</div>
    <p>online:{{ online }}</p>
    <p>synced:{{ synced }}</p>
    <p>pending:{{ pending.length }}</p>
    <p>loading:{{ loading }}</p>
    <p>sites:{{ data?.sites.length ?? 0 }}</p>
  </div>
</template>
