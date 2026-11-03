<script setup lang="ts">
import { joinURL } from 'ufo'

const { data: page } = await useAsyncData('index', () => queryCollection('landing').path('/').first())
if (!page.value) {
  throw createError({ statusCode: 404, statusMessage: 'Page not found', fatal: true })
}

const title = page.value.seo?.title || page.value.title
const description = page.value.seo?.description || page.value.description

useSeoMeta({
  titleTemplate: '',
  title,
  ogTitle: title,
  description,
  ogDescription: description,
  ogImage: joinURL(useSiteConfig().url, useRuntimeConfig().app.baseURL, 'og-image.jpg')
})
</script>

<template>
  <ContentRenderer
    v-if="page"
    :value="page"
    :prose="false"
    :components="{ a: 'prose-a' }"
  />
</template>
