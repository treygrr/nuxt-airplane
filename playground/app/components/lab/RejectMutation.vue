<script setup lang="ts">
// Makes the server reject the next N mutations of one name with a GraphQL
// error: the way to fail one link of a chain on purpose.
const { chaos, set } = useLab()

const MUTATIONS = [
  'addCartLine', 'setCartLineQuantity', 'removeCartLine', 'applyCoupon', 'createWishlist', 'addWishlistItem',
  'setWishlistItemNote', 'createAddress', 'updateAddress', 'setDefaultAddress', 'createReview', 'updateProfile',
  'placeOrder', 'cancelOrder', 'createSite', 'renameSite', 'addSiteItem', 'updateSiteItemOnHand',
]
const name = ref('addCartLine')
const count = ref(1)
const waiting = computed(() => Object.entries(chaos.value?.rejectNext ?? {}).filter(([, n]) => n > 0))
</script>

<template>
  <div>
    <v-row
      dense
      align="center"
    >
      <v-col
        cols="12"
        md="5"
      >
        <v-select
          v-model="name"
          :items="MUTATIONS"
          label="Reject a mutation"
          density="compact"
          hide-details
        />
      </v-col>
      <v-col
        cols="6"
        md="3"
      >
        <v-number-input
          v-model="count"
          label="Times"
          :min="1"
          density="compact"
          control-variant="stacked"
          hide-details
        />
      </v-col>
      <v-col
        cols="6"
        md="4"
      >
        <v-btn
          color="error"
          variant="tonal"
          block
          @click="set({ rejectNext: { [name]: count } })"
        >
          Reject next {{ count }}
        </v-btn>
      </v-col>
    </v-row>
    <div
      v-if="waiting.length"
      class="text-body-small text-medium-emphasis mt-2"
    >
      Waiting to reject:
      <v-chip
        v-for="[op, n] in waiting"
        :key="op"
        size="x-small"
        class="ms-1"
      >
        {{ op }} × {{ n }}
      </v-chip>
    </div>
  </div>
</template>
