function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, cloneValue(nested)]));
  }

  return value;
}

function cloneRecord(record = {}) {
  return cloneValue(record);
}

export function createDraftEntry(record = {}, fingerprintFn, options = {}) {
  return {
    baseFingerprint: typeof fingerprintFn === 'function' ? fingerprintFn(record) : '',
    draft: cloneRecord(record),
    dirtyFields: Array.from(new Set((options.dirtyFields || []).map((field) => String(field || '').trim()).filter(Boolean))),
    isNew: options.isNew === true
  };
}

export function getResolvedRecord(record = {}, draftsById = {}) {
  const recordId = String(record?.id || '').trim();
  const entry = recordId ? draftsById[recordId] : null;
  return entry?.draft ? cloneRecord(entry.draft) : cloneRecord(record);
}

export function getResolvedRecords(records = [], draftsById = {}) {
  const remoteRecords = Array.isArray(records) ? records : [];
  const resolvedRemote = remoteRecords.map((record) => getResolvedRecord(record, draftsById));
  const remoteIds = new Set(remoteRecords.map((record) => String(record?.id || '').trim()).filter(Boolean));
  const newDrafts = Object.entries(draftsById || {})
    .filter(([, entry]) => entry?.isNew === true && entry?.draft && !remoteIds.has(String(entry.draft.id || '').trim()))
    .map(([, entry]) => cloneRecord(entry.draft));

  return [...newDrafts, ...resolvedRemote];
}

export function updateDraftEntry(draftsById = {}, record = {}, updater, options = {}) {
  const recordId = String(record?.id || '').trim();
  if (!recordId || typeof updater !== 'function') {
    return draftsById;
  }

  const existing = draftsById[recordId]
    ? {
      ...draftsById[recordId],
      draft: cloneRecord(draftsById[recordId].draft),
      dirtyFields: Array.isArray(draftsById[recordId].dirtyFields) ? [...draftsById[recordId].dirtyFields] : []
    }
    : createDraftEntry(record, options.fingerprintFn, { isNew: options.isNew === true });

  const nextDraft = updater(cloneRecord(existing.draft));
  const dirtyFields = new Set(existing.dirtyFields);
  for (const field of options.dirtyFields || []) {
    const normalized = String(field || '').trim();
    if (normalized) {
      dirtyFields.add(normalized);
    }
  }

  return {
    ...draftsById,
    [recordId]: {
      ...existing,
      draft: cloneRecord(nextDraft),
      dirtyFields: Array.from(dirtyFields)
    }
  };
}

export function discardDraftEntry(draftsById = {}, recordId = '') {
  const normalizedId = String(recordId || '').trim();
  if (!normalizedId || !draftsById[normalizedId]) {
    return draftsById;
  }

  const nextDrafts = { ...draftsById };
  delete nextDrafts[normalizedId];
  return nextDrafts;
}

export function clearDraftEntries(draftsById = {}, recordIds = []) {
  let nextDrafts = { ...draftsById };
  for (const recordId of Array.isArray(recordIds) ? recordIds : []) {
    nextDrafts = discardDraftEntry(nextDrafts, recordId);
  }
  return nextDrafts;
}

export function rebaseDraftEntries(draftsById = {}, records = [], fingerprintFn) {
  const remoteRecords = Array.isArray(records) ? records : [];
  const remoteById = new Map(remoteRecords.map((record) => [String(record?.id || '').trim(), record]));
  const nextDraftsById = {};
  const removedIds = [];

  for (const [recordId, entry] of Object.entries(draftsById || {})) {
    if (!entry?.draft) {
      continue;
    }

    if (entry.isNew) {
      nextDraftsById[recordId] = {
        ...entry,
        draft: cloneRecord(entry.draft),
        dirtyFields: Array.isArray(entry.dirtyFields) ? [...entry.dirtyFields] : []
      };
      continue;
    }

    const remoteRecord = remoteById.get(recordId);
    if (!remoteRecord) {
      removedIds.push(recordId);
      continue;
    }

    const rebasedDraft = cloneRecord(remoteRecord);
    for (const field of entry.dirtyFields || []) {
      if (Object.prototype.hasOwnProperty.call(entry.draft, field)) {
        rebasedDraft[field] = cloneValue(entry.draft[field]);
      }
    }

    nextDraftsById[recordId] = {
      ...entry,
      baseFingerprint: typeof fingerprintFn === 'function' ? fingerprintFn(remoteRecord) : '',
      draft: rebasedDraft,
      dirtyFields: Array.isArray(entry.dirtyFields) ? [...entry.dirtyFields] : []
    };
  }

  return {
    draftsById: nextDraftsById,
    removedIds
  };
}

export function hasDraftChanges(draftsById = {}, recordId = '') {
  const normalizedId = String(recordId || '').trim();
  const entry = normalizedId ? draftsById[normalizedId] : null;
  return Boolean(entry && (entry.isNew || (entry.dirtyFields || []).length));
}
