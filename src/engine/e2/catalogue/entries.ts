// E2: the cable catalogue of the app. EMPTY on purpose: entries are added only from
// manufacturer catalogues supplied for it, each value with its document and page.
// No value is typed here from memory, from the company table (COMPANY_RX_OHM_PER_KM,
// not verified) or from another cable.

import type { CableEntry, CatalogueDocument } from './schema';

export const CATALOGUE_DOCUMENTS: readonly CatalogueDocument[] = [];
export const CABLE_ENTRIES: readonly CableEntry[] = [];
