<script setup lang="ts">
// The shell every page sits in. On a wide screen the shop is navigated from
// the app bar; the drawer is the menu on a phone.
const drawer = ref(false)
</script>

<template>
  <v-app>
    <PromoStrip />
    <AppBar @toggle-nav="drawer = !drawer" />
    <AppNavDrawer v-model="drawer" />
    <v-main>
      <v-container
        class="py-6 py-md-8"
        style="max-width: 1280px"
      >
        <slot />
      </v-container>
      <AppFooter />
    </v-main>
  </v-app>
</template>
