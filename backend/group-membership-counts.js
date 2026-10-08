'use strict';
function createNativeGroupCountHydrator({db,getUsers,allowMemory=false}) {
  return async function hydrateNativeGroupCounts(groups) {
    const nativeIds=[...new Set(groups.filter(group=>group.isExternal!==true).map(group=>group.id))];
    if(!nativeIds.length)return groups;
    let counts;
    if(db.isConnected()) {
      try {
        const {rows}=await db.query(`SELECT requested.group_id,COUNT(u.id)::integer AS members
          FROM UNNEST($1::text[]) requested(group_id)
          LEFT JOIN users u ON requested.group_id=ANY(COALESCE(u.joined_groups,'{}'::text[]))
          GROUP BY requested.group_id`,[nativeIds]);
        counts=new Map(rows.map(row=>[row.group_id,Number(row.members)]));
      } catch(error) {
        throw Object.assign(new Error('Group member counts are temporarily unavailable.'),{status:503,cause:error});
      }
    } else {
      if(!allowMemory)throw Object.assign(new Error('Group member counts are temporarily unavailable.'),{status:503});
      counts=new Map(nativeIds.map(id=>[id,getUsers().filter(user=>user.joinedGroups?.includes(id)).length]));
    }
    return groups.map(group=>group.isExternal===true?group:{...group,members:counts.get(group.id)||0});
  };
}
module.exports={createNativeGroupCountHydrator};
