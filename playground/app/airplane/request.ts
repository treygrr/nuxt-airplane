// Test change to trigger the pkg.pr.new preview; safe to close without merging.
// How every request reaches the API. `headers` runs per request inside the
// Nuxt app context, so composables work and the token is read fresh each time,
// including for mutations the sync loop sends later.

export default defineAirplaneRequest({
  headers: () => {
    const token = useCookie('airplane-token', { default: () => 'demo-token' })
    return { Authorization: `Bearer ${token.value}` }
  },

  onResponse(response) {
    if (response.status === 401) console.warn('[playground] token rejected; time to sign in again')
  },
})
