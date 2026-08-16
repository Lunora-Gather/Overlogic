// StorageWriteGate.js — process-local guard for cross-tab save conflicts.
// localStorage has no transaction primitive. Once another tab changes a
// persistent store, the current tab must stop writing until it reloads and
// rehydrates from the authoritative store.

let blocked = false;

export function storageWritesAllowed() {
  return !blocked;
}

export function markStorageWriteConflict() {
  blocked = true;
  return blocked;
}

export function resetStorageWriteGate() {
  blocked = false;
}

