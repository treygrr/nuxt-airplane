// Every type the queries select with an id already has a table, keyed on it:
// `db.Site` and `db.Item`. This only adds the indexes the read handlers sort
// or filter on. Row types come from the schema; nothing to declare.
//
// `archived` is a boolean, which IndexedDB cannot index, so the read handler
// filters it in JavaScript (the module warns in dev if you try).
export default defineAirplaneStores({
  Site: 'name',
  Item: 'name',
})
