'use strict';

function nativeGroupVisibilityPredicate(postAlias, viewerParameter) {
  if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(postAlias)||!/^\$[1-9][0-9]*$/.test(viewerParameter))throw new TypeError('Invalid visibility SQL reference');
  return `(${postAlias}.group_id IS NULL OR ${postAlias}.group_id='' OR EXISTS (
    SELECT 1 FROM community_groups visible_group
    WHERE visible_group.id=${postAlias}.group_id AND (
      visible_group.is_private IS NOT TRUE OR visible_group.created_by=${viewerParameter}::text
      OR EXISTS (SELECT 1 FROM users group_viewer WHERE group_viewer.id::text=${viewerParameter}::text
        AND visible_group.id=ANY(COALESCE(group_viewer.joined_groups,'{}'::text[])))
    )
  ))`;
}

function createNativePostVisibilityFilter({db,getGroups,getViewer,allowMemory=false}) {
  return async function filterNativePosts(posts,viewerId=null) {
    const nativeGroupIds=[...new Set(posts.filter(post=>(post.source||'uficonnect')==='uficonnect'&&post.groupId).map(post=>post.groupId))];
    if(!nativeGroupIds.length)return posts;
    let visible;
    if(db.isConnected()) {
      try {
        const {rows}=await db.query(`SELECT candidate.group_id FROM UNNEST($1::text[]) candidate(group_id)
          WHERE ${nativeGroupVisibilityPredicate('candidate','$2')}`,[nativeGroupIds,viewerId]);
        visible=new Set(rows.map(row=>row.group_id));
      } catch(error) {
        throw Object.assign(new Error('Group post visibility is temporarily unavailable.'),{status:503,cause:error});
      }
    } else {
      if(!allowMemory)throw Object.assign(new Error('Group post visibility is temporarily unavailable.'),{status:503});
      const viewer=getViewer(viewerId);
      visible=new Set(getGroups().filter(group=>!group.isPrivate||group.createdBy===viewerId||viewer?.joinedGroups?.includes(group.id)).map(group=>group.id));
    }
    return posts.filter(post=>(post.source||'uficonnect')!=='uficonnect'||!post.groupId||visible.has(post.groupId));
  };
}

module.exports={nativeGroupVisibilityPredicate,createNativePostVisibilityFilter};
