// How each category looks: an icon and a color. The product pictures the
// server draws and the category tiles on the home page both use it.

import {
  mdiAngleAcute, mdiAxe, mdiBattery, mdiFlashlight, mdiFlower, mdiHammer, mdiHammerWrench, mdiHandSaw, mdiHardHat,
  mdiLightbulbOutline, mdiNut, mdiPowerPlug, mdiRuler, mdiSafetyGoggles, mdiScrewdriver, mdiScrewFlatTop,
  mdiScrewMachineFlatTop, mdiShovel, mdiSprout, mdiTapeMeasure, mdiToolbox, mdiToolboxOutline, mdiWater, mdiWrench,
} from '@mdi/js'

export interface CategoryStyle {
  /** An SVG path on a 24 by 24 grid, from @mdi/js. */
  icon: string
  /** The ink: the icon, and text on the tint. */
  color: string
  /** A pale background. */
  tint: string
}

/** The eight top-level categories. */
export const TOP_CATEGORIES: Record<string, CategoryStyle> = {
  'Power Tools': { icon: mdiPowerPlug, color: '#c2410c', tint: '#fff1e6' },
  'Hand Tools': { icon: mdiHammer, color: '#1d4ed8', tint: '#e8efff' },
  'Fasteners': { icon: mdiScrewFlatTop, color: '#475569', tint: '#eef1f5' },
  'Measuring': { icon: mdiTapeMeasure, color: '#a16207', tint: '#fdf6dc' },
  'Safety': { icon: mdiSafetyGoggles, color: '#15803d', tint: '#e7f6ec' },
  'Lighting': { icon: mdiFlashlight, color: '#b45309', tint: '#fef3e2' },
  'Storage': { icon: mdiToolbox, color: '#7c3aed', tint: '#f1ebff' },
  'Outdoor': { icon: mdiShovel, color: '#0f766e', tint: '#e3f5f2' },
}

/** Icons that say more than the top category's, by subcategory. */
const LEAF_ICONS: Record<string, string> = {
  Saws: mdiHandSaw,
  Batteries: mdiBattery,
  Grinders: mdiHammerWrench,
  Screwdrivers: mdiScrewdriver,
  Wrenches: mdiWrench,
  Pliers: mdiHammerWrench,
  Chisels: mdiAxe,
  Screws: mdiScrewMachineFlatTop,
  Bolts: mdiNut,
  Squares: mdiAngleAcute,
  Levels: mdiRuler,
  Hearing: mdiHardHat,
  Headlamps: mdiLightbulbOutline,
  Bags: mdiToolboxOutline,
  Rakes: mdiSprout,
  Pruners: mdiFlower,
  Hoses: mdiWater,
}

/** The look of a category, given its name and, for a subcategory, its parent's name. */
export function categoryStyle(name: string, parentName?: string | null): CategoryStyle {
  const top = TOP_CATEGORIES[parentName ?? name] ?? TOP_CATEGORIES['Hand Tools']!
  return { ...top, icon: LEAF_ICONS[name] ?? top.icon }
}
