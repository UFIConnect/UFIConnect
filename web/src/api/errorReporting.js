import client from './client';
import { getVisitorId } from '../analytics';
import { redactTelemetry, telemetryPath } from './telemetryPrivacy';

// Feeds the autofix agent's detection pipeline (see backend's
// recordClientError/recordServerError/runAutofixCheck) — same fire-and-
// forget shape as engagement.js's reportEngagementSignal: no batching, no
// retry, a dropped report just doesn't nudge that signature's count.
//
// Deduped per session per signature (a looping error — e.g. one stuck in a
// render loop — shouldn't spam the same report every render) rather than a
// hard cap, since a genuinely different error should never be suppressed by
// an unrelated one having already reported once.
const reportedSignatures = new Set();

// Coarse client-side mirror of the backend's own computeErrorSignature — the
// real signature is computed server-side (this only needs to be stable
// enough to dedupe within one tab session, not to match the backend's exact
// hash), so a class of error doesn't get reported on every single render/
// event it recurs in during one session.
function localSignature(message, extra) {
  return `${String(message || '').slice(0, 120)}|${extra || ''}`;
}

export function reportClientError({ message, stack, componentStack, urlPath }) {
  const safePath = telemetryPath(urlPath || (typeof location !== 'undefined' ? location.pathname : '/'));
  if (!safePath) return;
  const safeMessage = redactTelemetry(message);
  const sig = localSignature(safeMessage, componentStack?.match(/in (\S+)/)?.[1]);
  if (reportedSignatures.has(sig)) return;
  reportedSignatures.add(sig);
  client.post('/client-error', {
    message: safeMessage, stack: redactTelemetry(stack), componentStack: redactTelemetry(componentStack),
    urlPath: safePath,
    visitorId: getVisitorId(),
  }).catch(() => {});
}

export function reportNegativeSignal({ signalType, source, topic, postId, context }) {
  if (!signalType) return;
  client.post('/negative-signal', { signalType, source, topic, postId, context, visitorId: getVisitorId() }).catch(() => {});
}
