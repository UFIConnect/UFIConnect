'use strict';

function createOfficeAIMemoryRoutes(memory) {
  const handle = action => async (req, res) => {
    res.set?.('Cache-Control', 'no-store');
    try { return res.json(await action(req)); }
    catch (error) { return res.status(error.publicMessage ? error.status : 503).json({ error: error.publicMessage || 'Office memory could not complete this request. Please retry.' }); }
  };
  return {
    list: handle(async req => {
      if (Object.keys(req.query || {}).some(key => !['query', 'limit', 'before'].includes(key))) throw Object.assign(new Error(), { status: 400, publicMessage: 'Choose a memory query, limit, or page cursor.' });
      const query = req.query?.query ?? '';
      if (typeof query !== 'string' || query.length > 500) throw Object.assign(new Error(), { status: 400, publicMessage: 'Memory searches support up to 500 characters.' });
      const limit = req.query?.limit === undefined ? 30 : Number(req.query.limit);
      const result = query.trim() ? await memory.search(query.trim(), { limit }) : await memory.list({ limit, before: req.query?.before });
      const storageStats = typeof memory.stats === 'function' ? await memory.stats() : null;
      return { ...result, ...(storageStats ? { storageStats } : {}), storage: 'encrypted-database', persistent: true, shared: true };
    }),
    remove: handle(req => memory.remove(req.params?.id)),
    importHistory: handle(req => memory.importSavedConversations({ limit: req.body?.limit ?? 5, before: req.body?.before })),
    clear: handle(req => memory.clear({ confirmed: req.body?.confirmed === true })),
  };
}

module.exports = { createOfficeAIMemoryRoutes };
