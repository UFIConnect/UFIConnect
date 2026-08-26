import client from './client';

// applicationServerKey needs raw bytes, not the base64url string
// webpush.generateVAPIDKeys()/the /push/config endpoint hands back.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function getPushSubscriptionState() {
  if (!pushSupported()) return { supported: false, permission: 'unsupported', subscribed: false };
  const registration = await navigator.serviceWorker.ready.catch(() => null);
  const existing = registration ? await registration.pushManager.getSubscription() : null;
  return { supported: true, permission: Notification.permission, subscribed: !!existing };
}

// Requests permission (a real user gesture is required — call this from a
// click handler, not on mount) and subscribes this browser, then registers
// the subscription server-side so sendPushToUser can actually reach it.
export async function enablePush() {
  if (!pushSupported()) throw new Error('Push notifications are not supported in this browser.');
  const { data } = await client.get('/push/config');
  if (!data.configured) throw new Error('Push notifications are not configured yet.');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Permission denied.');

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(data.publicKey),
    });
  }
  await client.post('/push/subscribe', { subscription: subscription.toJSON() });
  return subscription;
}

export async function disablePush() {
  if (!pushSupported()) return;
  const registration = await navigator.serviceWorker.ready.catch(() => null);
  const subscription = registration ? await registration.pushManager.getSubscription() : null;
  if (!subscription) return;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe().catch(() => {});
  await client.post('/push/unsubscribe', { endpoint }).catch(() => {});
}
