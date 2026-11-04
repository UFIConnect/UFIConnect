'use strict';
function createOfficeAIWorkspaceRoutes(workspace) {
  const handle = callback => async (req, res) => {
    res.set?.('Cache-Control', 'no-store');
    try { return res.json(await callback(req)); }
    catch (error) { return res.status(error.publicMessage ? error.status : 503).json({ error: error.publicMessage || 'The saved workspace file could not be retrieved. Please retry.' }); }
  };
  return { list: handle(req => workspace.list(req.params.projectId)),
    read: handle(async req => ({ file: await workspace.read(req.params.projectId, req.query?.path) })) };
}
module.exports = { createOfficeAIWorkspaceRoutes };
