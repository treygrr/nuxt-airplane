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
    <v-row>
      <v-col
        cols="12"
        lg="8"
      >
        <ClientOnly>
          <ChaosPanel class="mb-4" />
          <StressGenerators class="mb-4" />
          <DataReset />
        </ClientOnly>
      </v-col>
      <v-col
        cols="12"
        lg="4"
      >
        <!-- An online query: rendered on the server with the counters in it. -->
        <ServerCounters class="mb-4" />
        <ClientOnly>
          <LocalNumbers />
        </ClientOnly>
      </v-col>
    </v-row>
  </div>
</template>
