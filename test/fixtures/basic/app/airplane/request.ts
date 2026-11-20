// Request options, run in the browser and on the server alike: a header
// built from a cookie, read with a Nuxt composable.
export default defineAirplaneRequest({
  headers: () => ({ 'x-airplane-token': useCookie('token').value ?? 'none' }),
})
