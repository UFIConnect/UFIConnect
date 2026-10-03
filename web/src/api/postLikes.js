import client from './client';

// Batch cards arriving through a live stream before viewer-specific counts exist.
let queued = new Map();
let timer;
export function loadPostLikes(postId, separateTable = false) {
  // Restaurant/OSM reactions use their existing storage, outside the external
  // feed bulk endpoint. The detail endpoint also enforces post visibility.
  if (separateTable) return client.get(`/feed/${encodeURIComponent(postId)}/likes`).then(({ data }) => ({
    id: postId, likesCount: data.likesCount, likedByMe: Boolean(data.likedByMe), likesScope: 'uficonnect',
  }));
  return new Promise((resolve, reject) => {
    const listeners = queued.get(postId) || [];
    listeners.push({ resolve, reject });
    queued.set(postId, listeners);
    if (timer) return;
    timer = setTimeout(async () => {
      const batch = queued;
      queued = new Map();
      timer = null;
      const ids = [...batch.keys()];
      for (let index = 0; index < ids.length; index += 100) {
        const chunk = ids.slice(index, index + 100);
        try {
          const { data } = await client.get('/feed/likes', { params: { ids: chunk.join(',') } });
          for (const id of chunk) {
            const value = data.likes?.[id];
            for (const listener of batch.get(id)) {
              if (value) listener.resolve({ id, ...value });
              else listener.reject(new Error('Like counts are unavailable.'));
            }
          }
        } catch (error) {
          for (const id of chunk) for (const listener of batch.get(id)) listener.reject(error);
        }
      }
    }, 0);
  });
}
