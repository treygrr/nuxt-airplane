<script setup lang="ts">
// The customer's account: profile, and the address book.
useHead({ title: 'Account · Toolshed' })
</script>

<template>
  <div>
    <h1 class="text-headline-medium font-weight-bold mb-6">
      Your account
    </h1>
    <ProfileForm class="mb-10" />
    <AddressBook />
  </div>
</template>
