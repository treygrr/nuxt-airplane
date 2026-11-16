<script setup lang="ts">
import { mdiHeartOutline, mdiPlus } from '@mdi/js'

// The customer's lists of saved products, each a card that opens the list.
useHead({ title: 'Wishlists · Toolshed' })
const wishlists = useWishlists()
const { lists, loading } = wishlists
const pendingLists = usePendingRows('Wishlist')
const creating = ref(false)
</script>

<template>
  <div>
    <div class="d-flex align-center mb-6">
      <h1 class="text-headline-medium font-weight-bold me-auto">
        Wishlists
      </h1>
      <v-btn
        :prepend-icon="mdiPlus"
        color="primary"
        @click="creating = true"
      >
        New list
      </v-btn>
    </div>
    <v-skeleton-loader
      v-if="loading && !lists.length"
      type="card@2"
    />
    <v-empty-state
      v-else-if="!lists.length"
      :icon="mdiHeartOutline"
      title="No lists yet"
      text="Make a list for the next project and save tools to it."
    />
    <v-row v-else>
      <v-col
        v-for="list in lists"
        :key="list.id"
        cols="6"
        sm="4"
        md="3"
      >
        <WishlistPreviewCard
          :list="list"
          :pending="pendingLists.has(list.id)"
        />
      </v-col>
    </v-row>
    <TextPromptDialog
      v-model="creating"
      title="New list"
      label="Name"
      action="Create"
      @submit="name => wishlists.create.mutate({ name })"
    />
  </div>
</template>
