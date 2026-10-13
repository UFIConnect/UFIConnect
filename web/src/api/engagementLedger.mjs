// Protect confirmed writes from reads that started before those writes. Newer
// reads remain authoritative, so local counts never permanently hide updates.
export function createEngagementLedger(maxEntries = 500) {
  let revision = 0;
  const changes = new Map();
  return {
    revision: () => revision,
    clear() { changes.clear(); revision += 1; },
    record(postId, patch) {
      if (!postId) return;
      const previous = changes.get(postId);
      changes.delete(postId);
      const writeRevision = ++revision;
      const fields = { ...previous?.fields };
      for (const [key, value] of Object.entries(patch)) fields[key] = { revision: writeRevision, value };
      changes.set(postId, { fields });
      while (changes.size > maxEntries) changes.delete(changes.keys().next().value);
    },
    apply(post, readRevision) {
      const change = changes.get(post?.id);
      if (!change) return post;
      const patch = Object.fromEntries(Object.entries(change.fields)
        .filter(([, field]) => field.revision > readRevision).map(([key, field]) => [key, field.value]));
      return Object.keys(patch).length ? { ...post, ...patch } : post;
    },
  };
}
