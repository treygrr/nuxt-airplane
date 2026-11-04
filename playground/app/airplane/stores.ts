// Every type the queries select with an id already has a table, keyed on it:
// `db.Site`, `db.Item`, `db.SiteItem`. This only adds the indexes the read
// handlers sort or filter on. Row types come from the schema; nothing to declare.
export default defineAirplaneStores({
  Item: 'name',
})
