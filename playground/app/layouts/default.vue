<script setup lang="ts">
// The shell every page sits in: app bar, navigation, footer.
// On a phone the drawer starts closed and opens over the page.
const drawer = ref<boolean | null>(null)
</script>

<template>
  <v-app>
    <AppBar @toggle-nav="drawer = !drawer" />
    <AppNavDrawer v-model="drawer" />
    <v-main>
      <v-container class="py-6">
        <slot />
      </v-container>
    </v-main>
    <AppFooter />
  </v-app>
</template>
