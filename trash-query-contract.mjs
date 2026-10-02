// Runtime subset of the frozen Candidate 5A federated query contract.
// Read-only: restoration remains in each module's existing lifecycle.
const FIRST_TIMESTAMP = new Date(0);

function pageSizeOf(value) {
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new RangeError('pageSize must be an integer from 1 to 100');
  }
  return value;
}

function record(kind, snapshot, deletedAt, deletedBy, restoreCapability, extra = {}) {
  const data = snapshot.data();
  return {
    module: kind,
    sourceId: snapshot.id,
    sourcePath: snapshot.ref.path,
    title: data.title || data.name || '—',
    ownerId: data.ownerId,
    deletedAt,
    deletedBy: deletedBy || null,
    originalStatus: extra.originalStatus ?? data.status ?? null,
    originalLocation: extra.originalLocation || null,
    restoreCapability,
    ...extra,
  };
}

export function createTrashQueryContract({ collection, query, where, orderBy, limit, startAfter, getDocs }) {
  async function page(db, collectionName, filters, sortField, pageSize, cursor, normalize) {
    const size = pageSizeOf(pageSize);
    const constraints = [...filters, orderBy(sortField, 'desc')];
    if (cursor) constraints.push(startAfter(cursor));
    constraints.push(limit(size + 1));
    const snapshot = await getDocs(query(collection(db, collectionName), ...constraints));
    const documents = snapshot.docs.slice(0, size);
    return {
      items: documents.map(normalize),
      cursor: documents.at(-1) || null,
      hasMore: snapshot.docs.length > size,
    };
  }

  return {
    interaction: ({ db, ownerId, pageSize = 50, cursor = null }) => {
      if (!ownerId) throw new Error('Interaction trash requires ownerId');
      return page(db, 'sessions', [where('ownerId', '==', ownerId),
        where('deletedAt', '>', FIRST_TIMESTAMP)], 'deletedAt', pageSize, cursor,
      snap => record('interaction', snap, snap.data().deletedAt, snap.data().deletedBy,
        { allowed: true, action: 'restore-interaction' },
        { originalLocation: 'Tạo tương tác' }));
    },
    group: ({ db, ownerId, pageSize = 50, cursor = null }) => {
      if (!ownerId) throw new Error('Teacher Group trash requires ownerId');
      return page(db, 'groupActivities', [where('ownerId', '==', ownerId),
        where('status', '==', 'deleted')], 'deletedAt', pageSize, cursor,
      snap => {
        const data = snap.data();
        const prior = data.statusBeforeDelete;
        return record('group', snap, data.deletedAt, data.deletedBy,
          { allowed: ['draft', 'open', 'closed'].includes(prior), action: 'restore-group' },
          { originalStatus: prior || null, originalLocation: 'Thảo luận nhóm' });
      });
    },
  };
}

export function mergeTrashItems(interactionItems, groupItems) {
  const millis = value => value?.toMillis?.() ?? (value instanceof Date ? value.getTime() : new Date(value || 0).getTime());
  return [...interactionItems, ...groupItems].sort((a, b) =>
    millis(b.deletedAt) - millis(a.deletedAt) ||
    a.module.localeCompare(b.module) || a.sourceId.localeCompare(b.sourceId));
}

export function unifiedTrashView(pages, filter = 'all') {
  const selected = filter === 'all' ? ['interaction', 'group'] : [filter];
  if (selected.some(kind => !['interaction', 'group'].includes(kind))) throw new Error('Unknown trash filter');
  return {
    items: mergeTrashItems(
      selected.includes('interaction') ? pages.interaction.items : [],
      selected.includes('group') ? pages.group.items : []),
    failed: selected.filter(kind => pages[kind].error),
    hasMore: selected.some(kind => pages[kind].hasMore),
  };
}
