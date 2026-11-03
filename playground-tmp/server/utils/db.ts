// In-memory data store for testing. Resets whenever the server restarts.

export interface CatalogItem {
  id: string
  name: string
}

export interface SiteItem {
  itemId: string
  onHand: number
}

export interface Site {
  id: string
  name: string
  archived: boolean
  items: SiteItem[]
}

const ITEM_NAMES = [
  'Hammer',
  'Screwdriver',
  'Wrench',
  'Pliers',
  'Tape Measure',
  'Drill',
  'Saw',
  'Level',
  'Utility Knife',
  'Safety Glasses',
  'Work Gloves',
  'Ladder',
  'Flashlight',
  'Extension Cord',
  'Zip Ties',
]

const SITE_NAMES = [
  'North Warehouse',
  'South Depot',
  'East Yard',
  'West Storage',
  'Downtown Office',
]

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomInt(0, i)
    ;[copy[i], copy[j]] = [copy[j]!, copy[i]!]
  }
  return copy
}

export const catalog: CatalogItem[] = ITEM_NAMES.map((name, i) => ({
  id: `item-${i + 1}`,
  name,
}))

export const sites: Site[] = SITE_NAMES.map((name, i) => ({
  id: `site-${i + 1}`,
  name,
  archived: false,
  items: shuffle(catalog)
    .slice(0, randomInt(3, 8))
    .map(item => ({ itemId: item.id, onHand: randomInt(0, 100) })),
}))
