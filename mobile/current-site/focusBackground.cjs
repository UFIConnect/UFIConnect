const LIVE_TASK = 'uficonnect.focus.live-location';
const ZONE_TASK = 'uficonnect.focus.geofencing';

function validCoordinates(latitude, longitude) {
  return Number.isFinite(latitude) && Math.abs(latitude) <= 90
    && Number.isFinite(longitude) && Math.abs(longitude) <= 180;
}

function createBackgroundFocus(location, tasks, store, platform) {
  let pending = Promise.resolve();
  function serialize(operation) {
    const result = pending.then(operation);
    pending = result.catch(() => {});
    return result;
  }

  tasks.defineTask(LIVE_TASK, ({ data, error }) => serialize(async () => {
    if (error || !Array.isArray(data?.locations) || !await location.hasStartedLocationUpdatesAsync(LIVE_TASK)) return;
    const previous = await store.read('fix');
    const latest = data.locations.reduce((latest, { coords, timestamp }) => {
      if (!coords || !validCoordinates(coords.latitude, coords.longitude)
        || !Number.isFinite(timestamp) || timestamp <= (latest?.timestamp ?? 0)) return latest;
      return { latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy, timestamp };
    }, previous);
    if (latest && latest !== previous) await store.write('fix', latest);
  }));

  tasks.defineTask(ZONE_TASK, ({ data, error }) => serialize(async () => {
    if (error || !data || !await location.hasStartedGeofencingAsync(ZONE_TASK)) return;
    const zone = await store.read('zone');
    if (!zone || zone.identifier !== data.region?.identifier) return;
    const inside = data.eventType === location.GeofencingEventType.Enter;
    if (!inside && data.eventType !== location.GeofencingEventType.Exit) return;
    const previous = await store.read('event');
    if (previous?.inside === inside) return;
    await store.write('event', { inside, timestamp: Date.now() });
  }));

  async function requireForeground() {
    if (!(await location.requestForegroundPermissionsAsync()).granted) {
      throw new Error('Allow location while using UFIConnect in your device settings.');
    }
  }

  async function requireBackground() {
    await requireForeground();
    if (!(await location.requestBackgroundPermissionsAsync()).granted) {
      throw new Error('Allow background location for UFIConnect in your device settings.');
    }
  }

  return {
    current: async () => {
      await requireForeground();
      return (await location.getCurrentPositionAsync({ accuracy: location.Accuracy.High })).coords;
    },
    snapshot: () => serialize(async () => {
      const [live, monitoring, permission, services, zone, fix, event] = await Promise.all([
        location.hasStartedLocationUpdatesAsync(LIVE_TASK), location.hasStartedGeofencingAsync(ZONE_TASK),
        location.getBackgroundPermissionsAsync(), location.hasServicesEnabledAsync(),
        store.read('zone'), store.read('fix'), store.read('event'),
      ]);
      return { live, monitoring, available: permission.granted && services, zone, fix: live ? fix : null, event: monitoring ? event : null };
    }),
    live: enabled => serialize(async () => {
      if (enabled === await location.hasStartedLocationUpdatesAsync(LIVE_TASK)) return;
      if (!enabled) {
        await location.stopLocationUpdatesAsync(LIVE_TASK);
        await store.remove('fix');
        return;
      }
      await requireBackground();
      await store.remove('fix');
      await location.startLocationUpdatesAsync(LIVE_TASK, {
        accuracy: location.Accuracy.High, distanceInterval: 15, timeInterval: 5000,
        pausesUpdatesAutomatically: false, showsBackgroundLocationIndicator: true,
        ...(platform === 'android' && { foregroundService: {
          notificationTitle: 'UFIConnect live location is on',
          notificationBody: 'Open Focus to stop background location updates.',
          killServiceOnDestroy: false,
        } }),
      });
    }),
    geofence: (enabled, coordinates) => serialize(async () => {
      if (enabled === await location.hasStartedGeofencingAsync(ZONE_TASK)) return;
      if (!enabled) {
        await location.stopGeofencingAsync(ZONE_TASK);
        await store.remove('event');
        return;
      }
      const { latitude, longitude, radius } = coordinates;
      if (!validCoordinates(latitude, longitude) || !Number.isFinite(radius) || radius < 1) {
        throw new Error('Enter valid latitude, longitude, and a radius of at least 1 meter.');
      }
      await requireBackground();
      const zone = { latitude, longitude, radius, identifier: `focus-${Date.now()}-${Math.random().toString(36).slice(2)}` };
      await store.remove('event');
      await store.write('zone', zone);
      await location.startGeofencingAsync(ZONE_TASK, [{ ...zone, notifyOnEnter: true, notifyOnExit: true }]);
    }),
  };
}

module.exports = { createBackgroundFocus, LIVE_TASK, ZONE_TASK };
