<script setup lang="ts">
import { mdiCartOutline, mdiMagnify, mdiMenu } from '@mdi/js'

defineEmits<{ toggleNav: [] }>()
const { count } = useCart()
</script>

<template>
  <v-app-bar
    flat
    border="b"
  >
    <template #prepend>
      <v-app-bar-nav-icon
        :icon="mdiMenu"
        aria-label="Menu"
        @click="$emit('toggleNav')"
      />
    </template>

    <v-app-bar-title>
      <NuxtLink
        to="/"
        class="text-decoration-none text-high-emphasis font-weight-bold"
      >
        Toolshed
      </NuxtLink>
    </v-app-bar-title>

    <div
      class="d-none d-md-block mx-4"
      style="width: 420px; max-width: 40vw"
    >
      <SearchBox />
    </div>

    <template #append>
      <v-btn
        :icon="mdiMagnify"
        to="/search"
        class="d-md-none"
        aria-label="Search"
      />
      <SyncIndicator class="mx-2" />
      <v-btn
        to="/cart"
        aria-label="Cart"
        icon
      >
        <v-badge
          :model-value="count > 0"
          :content="count"
          :max="99"
          color="primary"
        >
          <v-icon :icon="mdiCartOutline" />
        </v-badge>
      </v-btn>
    </template>
  </v-app-bar>
</template>
