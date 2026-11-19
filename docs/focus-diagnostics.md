# Focus Studio diagnostics

Open **Focus Studio → Session → Phone, car & computer diagnostics**. Use **Enable all available diagnostics** to enable the browser's supported network, battery and page-performance reports. Each optional category can be stopped separately. Unavailable APIs remain labelled unavailable.

## Options

| Area | Available information and controls |
| --- | --- |
| Phone and GPS | Permission states, page visibility, last accepted fix, accuracy limit, rejected samples, manual refresh, recording, timed/distance stop limits, and an opt-in screen wake lock. |
| Sharing | Explicit publishing and viewing controls, a device label, sharing session ID, last GPS timestamp, accuracy, actual Office HTTP status, response latency and successful-sync time. |
| Grid | Fresh shared devices in the selected cell, uncertain membership near boundaries, accepted cell history, map inspection, following a shared source, and Google Maps directions. |
| Car trips | A chosen GPS source associated with a saved vehicle profile, distance, speed, heading, route stops and stopped-state estimates. Device-reported speed and GPS-estimated vehicle speed are labelled separately. |
| Computer/browser | Browser network estimates, data-saver reports, supported device-battery data, and observed page tasks lasting at least 50 ms. These are not whole-system CPU, process, malware or network-interception diagnostics. |
| Quiet views | Phone, driving and computer focus views silence Office audio, remove the normal dashboard, and suppress automatic browser geofence actions and their notifications. Events remain in the geofence log. Diagnostic controls stay behind an expandable panel. |
| Evidence export | Download the session's observed statuses, error codes, sync information and suppressed boundary events as JSON. Coordinates, publisher credentials and authentication tokens are excluded. |

## Grid visitors and identity

“Visitors” means devices explicitly sharing GPS with this Office. The list is not a census of people nearby. A publisher-supplied label is not a verified identity, vehicle identity or proof of continuous presence. Phone numbers are optional saved profile identifiers; they cannot locate a phone or establish who carries it.

On another authorized Office device, start live GPS and select **Share my GPS with Office**. On the viewing device, use **Live Maps → Grid → Load shared grid visitors**. A shared observation must be less than 25 seconds old. Location uncertainty must fit inside a cell for reliable membership; boundary overlaps remain labelled uncertain. A crossing needs two accepted, reliable observations in the new cell.

Use **View location on map** to inspect a point, **Follow shared device** to select its stream, or **Directions to shared location** to open Google Maps. Directions use the last received point, not a prediction of where a moving device will arrive. Opening the directions link sends those coordinates to Google.

Stopping sharing stops local publishing immediately and requests server revocation. If that request fails, the last location expires within 25 seconds. Idle sharing sessions expire after 90 seconds and require explicit renewed sharing. Hiding the page stops publishing; returning does not silently restart sharing.

## GPS and connection recovery

Use **Geo Tracking → Drop & Track** to start continuous moving GPS and route recording, then save a pin and waypoint from the next accepted reading. If GPS is already active, it reuses that accepted stream and keeps the existing trip. **Track while moving** is also available without dropping a pin. This mode bypasses automatic time and distance stop limits for that session, requests high accuracy every five seconds, and continues across visible Office views. Pause and Stop remain available.

Dropping a pin while GPS is active preserves map following. Drop & Track explicitly returns the map to following your live location. A saved pin remains separate from your moving marker; it does not impose a stationary start boundary or pause the route. If a drop is waiting for a valid fix, no location is invented. Hidden-tab and screen-lock limitations still apply.

- Balanced recording accepts device-reported uncertainty up to 150 m; Precise accepts 25 m. These are acceptance limits, not accuracy guarantees. Custom settings remain available.
- During Geo Tracking, readings are checked for order, freshness, uncertainty and implausible ground travel. The jump check permits both uncertainty circles and uses 100 m/s as a generous sanity limit. A rejected jump cannot move the accepted marker or add route distance.
- Movement inside the combined uncertainty of consecutive recorded samples is excluded from the route. Stationary jitter is not treated as reliable movement.
- Fresh observations expire after 25 seconds. Hidden tabs, pauses and signal gaps separate route segments; missing sections are not filled in.
- A bounded watchdog frees a hung one-shot GPS request. Late callbacks from that request are ignored. Visibility and network recovery request fresh updates without overlapping Office polls.
- Transient Office failures preserve only still-fresh shared observations and retry with bounded backoff. Expiration removes their markers even while the network is unavailable. Authorization failures clear shared observations immediately.
- A network failure has no inferred cause. Browser online status and network speed/latency estimates do not prove that the Office API is reachable; actual HTTP responses are reported separately.

## Device limits and quiet operation

These features run in the Office browser session. Browser geolocation may pause when the page is hidden or the screen locks; a screen wake lock can help keep a visible page awake when supported, but cannot override operating-system suspension. These changes do not install native background services or constitute a TestFlight release.

Quiet views do not start GPS, publish a location, request camera/microphone access, change operating-system notification settings or stop another program. Use the phone or computer's system Focus / Do Not Disturb for other applications. Phone geofence configurations that execute on a separate device retain their own controls; the action suppression applies to this browser's monitor.

Vehicle OBD-II, engine codes, fuel, vehicle battery, CarPlay and Android Auto telemetry are not connected. No vehicle hardware readings are inferred from GPS or from a selected vehicle type. A shared “computer” profile is likewise an explicitly labelled GPS source, not remote access to that computer.

Diagnostics retain up to 30 recent events in memory, plus up to 50 observed cells for the selected source and grid spacing. A reload ends that observation history. The browser may decline individual permission, battery, network or performance APIs; those values remain unknown rather than receiving fabricated defaults.
