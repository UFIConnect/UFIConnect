// The public landing page and the browser app share one maintained build.
// Match the exact host so an unrelated hostname cannot opt into this entry.
export function isAppHost(hostname) {
  return typeof hostname === 'string' && hostname.toLowerCase() === 'app.uficonnect.org';
}
