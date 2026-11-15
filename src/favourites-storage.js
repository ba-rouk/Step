const FAVOURITES_STORAGE_KEY = "vitanova-favourites-v1";
const LEGACY_FAVOURITES_STORAGE_KEYS = ["step-town-favourites-v1"];

function parseIds(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? [...new Set(parsed.map(String).filter(Boolean))] : [];
  } catch {
    return [];
  }
}

export function readFavouriteIds(storage = localStorage) {
  try {
    const currentIds = parseIds(storage.getItem(FAVOURITES_STORAGE_KEY));
    const legacyIds = LEGACY_FAVOURITES_STORAGE_KEYS.flatMap(key => parseIds(storage.getItem(key)));
    const merged = [...new Set([...currentIds, ...legacyIds])];
    if (legacyIds.length || storage.getItem(FAVOURITES_STORAGE_KEY) === null) {
      storage.setItem(FAVOURITES_STORAGE_KEY, JSON.stringify(merged));
    }
    for (const key of LEGACY_FAVOURITES_STORAGE_KEYS) storage.removeItem(key);
    return merged;
  } catch {
    return [];
  }
}

export function writeFavouriteIds(ids, storage = localStorage) {
  const safeIds = [...new Set((Array.isArray(ids) ? ids : []).map(String).filter(Boolean))];
  storage.setItem(FAVOURITES_STORAGE_KEY, JSON.stringify(safeIds));
  for (const key of LEGACY_FAVOURITES_STORAGE_KEYS) storage.removeItem(key);
  return safeIds;
}
