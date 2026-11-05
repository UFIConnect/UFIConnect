'use strict';
const {randomUUID}=require('node:crypto');
const RECOVERY_ATTEMPTS=2, ROLLBACK_COPIES=2;
function createTaskRecovery({revisions,now=Date.now}={}){
  const configured=()=>!!revisions?.configured?.();
  async function capture(task,summary){
    if(!configured())return;
    const snapshot={taskId:task.id,baseSha:task.internal.baseSha,files:task.internal.files||[],readRevisions:task.internal.readRevisions||{},changedFiles:task.changedFiles||[]};
    await revisions.write('task-draft',task.id,snapshot,{append:true,keep:ROLLBACK_COPIES+1,summary,
      metadata:{fileCount:snapshot.files.length,baseSha:snapshot.baseSha}});
    task.backups=await revisions.history('task-draft',task.id);
  }
  function retry(task,key,label){
    task.internal.recoveryCounts||={};
    const used=task.internal.recoveryCounts[key]||0;
    if(used>=RECOVERY_ATTEMPTS)return null;
    task.internal.recoveryCounts[key]=used+1;
    task.recovery={limit:RECOVERY_ATTEMPTS,currentAttempt:used+1,totalAttempts:(task.recovery?.totalAttempts||0)+1,step:label,at:new Date(now()).toISOString()};
    return(used+1)*2000;
  }
  function clear(task,key){if(task.internal.recoveryCounts)delete task.internal.recoveryCounts[key];}
  function review(task){
    return{checkedAt:new Date(now()).toISOString(),checks:[
      {label:'Current request and permissions retained',passed:!!task.message&&!!task.permissions},
      {label:'No unresolved file edit errors',passed:!Object.keys(task.internal.editFailures||{}).length},
      {label:'Repository changes checked before publication',passed:!task.commit||task.checks?.some(check=>check.sha===task.commit.sha&&check.conclusion==='success')===true},
      {label:'Published deployment confirmed',passed:!task.commit?.published||task.internal.deploymentVerified===true},
    ],confirmedSteps:task.events.filter(event=>event.status==='succeeded').length};
  }
  async function snapshot(task,id){return revisions.read('task-draft',task.id,id);}
  function restore(task,record){
    if(task.status!=='needs_continuation'||task.commit||task.internal.waitingTerminal||task.confirmation?.uncertain
      ||task.internal.pendingCalls?.some(call=>call.started))throw Object.assign(Error('Pause the draft before restoring it. Published commits and running external operations cannot be rewound.'),{status:409,publicMessage:'Pause the draft before restoring it. Published commits and running external operations cannot be rewound.'});
    if(record.value.taskId!==task.id||record.value.baseSha!==task.internal.baseSha)throw Object.assign(Error('The checkpoint does not belong to this draft revision.'),{status:409,publicMessage:'The checkpoint does not belong to this draft revision.'});
    task.internal.files=record.value.files;task.internal.readRevisions=record.value.readRevisions;task.changedFiles=record.value.changedFiles;
    task.internal.pendingCalls=[];task.internal.editFailures={};task.internal.recoveryCounts={};
    task.internal.messages.push({role:'user',content:`OPERATOR RESTORE: draft checkpoint ${record.id} was restored. Completed external receipts were preserved. Re-read staged files and plan the remaining work before making changes.`});
    task.continuation={id:randomUUID(),reason:'rollback',message:'The saved draft checkpoint is restored. Continue to review it and finish the original request.'};
    return task;
  }
  return{configured,capture,retry,clear,review,snapshot,restore,history:id=>revisions.history('task-draft',id)};
}
module.exports={createTaskRecovery,RECOVERY_ATTEMPTS,ROLLBACK_COPIES};
