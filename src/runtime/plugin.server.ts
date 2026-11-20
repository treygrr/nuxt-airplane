// Server-side rendering: online queries are sent from the server while the
// page renders, with the app's own request options, and their answers go
// to the browser in the page. Nothing here touches IndexedDB.

import { defineNuxtPlugin, useRequestEvent, useRequestURL, useRuntimeConfig } from '#app'
import { documents } from '#nuxt-airplane/documents'
import { requestFiles } from '#nuxt-airplane/request'
import { collect } from './collect'
import { createRequester, queryKey, type RequesterMemo } from './request'
import type { AirplaneRuntimeConfig, OperationDocument } from './types'
import type { AirplaneServer } from './composables/useOnlineQuery'

/**
 * What is learned about the endpoint (it does not take persisted queries)
 * holds for every visitor, so it outlives one request.
 */
const memo: RequesterMemo = { persistedUnsupported: false }

const isAbsolute = (url: string) => /^https?:\/\//.test(url)

export default defineNuxtPlugin({
  name: 'nuxt-airplane:server',
  setup(nuxtApp) {
    const config = useRuntimeConfig().public.airplane as AirplaneRuntimeConfig
    const { request } = collect(requestFiles)
    const event = useRequestEvent()

    // How the server reaches the endpoint:
    // - a path in this app is answered in process, with the visitor's
    //   cookies and authorization forwarded, as the browser would send them;
    // - a URL elsewhere is fetched with nothing of the visitor's added:
    //   their cookies are this app's, not that API's;
    // - the app's own `fetch`, if it has one, gets an absolute URL.
    let endpoint = config.endpoint
    let fetch: typeof globalThis.fetch | undefined
    if (request.fetch) {
      if (!isAbsolute(endpoint)) endpoint = new URL(endpoint, useRequestURL().origin).href
    }
    else if (!isAbsolute(endpoint) && event) {
      fetch = ((url: string, init?: RequestInit) => event.fetch(url, init)) as typeof globalThis.fetch
    }

    const send = createRequester({
      ...config,
      endpoint,
      documents: documents as Record<string, OperationDocument>,
      request,
      // After the first `await` the Nuxt context is gone; `headers` may need it (`useCookie`).
      runWithContext: fn => nuxtApp.runWithContext(fn),
      fetch,
    }, memo)

    /** Requests of this page, by query key: two components asking the same share one. */
    const asking = new Map<string, Promise<unknown>>()
    const server: AirplaneServer = {
      ask<T>(name: string, variables: unknown) {
        const key = queryKey(name, variables)
        let promise = asking.get(key)
        if (!promise) asking.set(key, promise = send<T>(name, variables))
        return promise as Promise<T>
      },
    }
    return { provide: { airplaneServer: server } }
  },
})
