'use strict';
function createVpnActionGate(getSession) {
  let active = null;
  return {
    begin(session) {
      if (!session || getSession() !== session || active) return null;
      return (active = {session});
    },
    current(operation) {return active === operation && getSession() === operation.session;},
    finish(operation) {
      if (active !== operation || getSession() !== operation.session) return false;
      active = null; return true;
    },
    cancel() {active = null;},
  };
}
async function runVpnAction({gate,session,action,onStart,onSuccess,onError,onFinish}) {
  const operation = gate.begin(session);
  if (!operation) return false;
  onStart();
  try {
    const result = await action(() => gate.current(operation));
    if (gate.current(operation)) onSuccess(result);
  } catch (error) {
    if (gate.current(operation)) onError(error);
  } finally {
    if (gate.finish(operation)) onFinish();
  }
  return true;
}
module.exports = {createVpnActionGate,runVpnAction};
