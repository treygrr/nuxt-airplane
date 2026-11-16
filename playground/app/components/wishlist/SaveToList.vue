<script setup lang="ts">
import { mdiCheck, mdiHeartOutline, mdiPlus } from '@mdi/js'

// "Save to a list" on a product page: pick a list, or make one. A list made
// here offline gets the product at once; the add waits for the list to sync.
const props = defineProps<{ productId: string, variantId?: string | null }>()
const { lists, create, addItem } = useWishlists()
const naming = ref(false)
const pendingAdd = ref(false)

const onList = (list: { items: { productId: string }[] }) => list.items.some(i => i.productId === props.productId)

function save(wishlistId: string) {
  void addItem.mutate({ wishlistId, productId: props.productId, variantId: props.variantId ?? null })
}

// A new list shows at once, under a placeholder id: add the product to it then.
let known: Set<string> | null = null
function newList(name: string) {
  known = new Set(lists.value.map(l => l.id))
  pendingAdd.value = true
  void create.mutate({ name })
}
watch(lists, (all) => {
  const fresh = known && all.find(l => !known!.has(l.id))
  if (!fresh || !pendingAdd.value) return
  known = null
  pendingAdd.value = false
  save(fresh.id)
})
</script>

<template>
  <v-menu>
    <template #activator="{ props: menu }">
      <v-btn
        v-bind="menu"
        :prepend-icon="mdiHeartOutline"
        variant="outlined"
      >
        Save to a list
      </v-btn>
    </template>
    <v-list
      density="compact"
      min-width="240"
    >
      <v-list-item
        v-for="list in lists"
        :key="list.id"
        :title="list.name"
        :disabled="onList(list)"
        @click="save(list.id)"
      >
        <template
          v-if="onList(list)"
          #append
        >
          <v-icon
            :icon="mdiCheck"
            size="18"
            color="success"
          />
        </template>
      </v-list-item>
      <v-divider
        v-if="lists.length"
        class="my-1"
      />
      <v-list-item
        :prepend-icon="mdiPlus"
        title="New list…"
        @click="naming = true"
      />
    </v-list>
  </v-menu>
  <TextPromptDialog
    v-model="naming"
    title="New list"
    label="Name"
    action="Create and save"
    @submit="newList"
  />
</template>
