<script setup lang="ts">
// The lab: make the server misbehave, put load on the client, and watch what
// both sides do about it.
useHead({ title: 'Lab · Toolshed' })
</script>

<template>
  <div>
    <h1 class="text-headline-medium mb-4">
      Lab
    </h1>
    <ClientOnly>
      <v-row>
        <v-col
          cols="12"
          lg="8"
        >
          <ChaosPanel class="mb-4" />
          <StressGenerators class="mb-4" />
          <DataReset />
        </v-col>
        <v-col
          cols="12"
          lg="4"
        >
          <ServerCounters class="mb-4" />
          <LocalNumbers />
        </v-col>
      </v-row>
    </ClientOnly>
  </div>
</template>
