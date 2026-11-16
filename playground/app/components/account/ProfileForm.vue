<script setup lang="ts">
// The customer's name and contact details, and whether they want emails.
// Saving sends only what changed.
const { me, loading, updateProfile, setMarketingOptIn } = useMe()
const pending = usePendingRows('Customer')

const fields = reactive({ name: '', email: '', phone: '' })
watch(me, (m) => {
  if (m) Object.assign(fields, { name: m.name, email: m.email, phone: m.phone })
}, { immediate: true })
const changed = computed(() => (me.value ? Object.fromEntries(Object.entries(fields).filter(([k, v]) => v !== me.value![k as keyof typeof fields])) : {}))
const emailValid = computed(() => /^[^@\s]+@[^\s@][^\s.@]*\.[^\s@]+$/.test(fields.email))

function save() {
  if (Object.keys(changed.value).length && emailValid.value) void updateProfile.mutate(changed.value)
}
</script>

<template>
  <section>
    <div class="d-flex align-center ga-2 mb-4">
      <h2 class="text-title-large font-weight-bold">
        Profile
      </h2>
      <PendingChip v-if="me && pending.has(me.id)" />
    </div>
    <v-skeleton-loader
      v-if="loading && !me"
      type="article"
    />
    <v-card
      v-else
      border
      flat
      class="pa-6"
    >
      <v-row dense>
        <v-col
          cols="12"
          sm="6"
        >
          <v-text-field
            v-model="fields.name"
            label="Name"
          />
        </v-col>
        <v-col
          cols="12"
          sm="6"
        >
          <v-text-field
            v-model="fields.phone"
            label="Phone"
          />
        </v-col>
        <v-col cols="12">
          <v-text-field
            v-model="fields.email"
            label="Email"
            :error-messages="emailValid ? [] : ['Not an email address']"
          />
        </v-col>
      </v-row>
      <div class="d-flex align-center flex-wrap ga-4">
        <v-switch
          :model-value="me?.marketingOptIn"
          label="Send me deals and new arrivals"
          hide-details
          @update:model-value="setMarketingOptIn.mutate({ optIn: !!$event })"
        />
        <v-spacer />
        <v-btn
          color="primary"
          :disabled="!Object.keys(changed).length || !emailValid"
          @click="save"
        >
          Save changes
        </v-btn>
      </div>
    </v-card>
  </section>
</template>
