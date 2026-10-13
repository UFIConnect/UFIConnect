import client from '../api/client';
import usePagedResults from './usePagedResults';

export const POST_PAGE_SIZE = 12;

export default function usePostPages({ endpoint, viewerId, enabled = true, continuous = false, orderPosts = posts => posts }) {
  return usePagedResults({
    enabled: enabled && !!endpoint && !!viewerId,
    queryKey: JSON.stringify([endpoint, viewerId]),
    errorMessage: 'Posts could not be loaded. Please try again.',
    mergeItems: continuous ? (existing, incoming) => {
      const seen = new Set(existing.map(post => post.id));
      return [...existing, ...incoming.filter(post => !seen.has(post.id) && seen.add(post.id))];
    } : undefined,
    loadPage: async ({ page, signal }) => {
      const { data } = await client.get(endpoint, { signal, params: { limit: POST_PAGE_SIZE, offset: (page - 1) * POST_PAGE_SIZE } });
      return { items: orderPosts(data.posts || []), hasNext: !!data.hasMore, total: data.total };
    },
  });
}
