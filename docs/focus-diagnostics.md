# Focus Studio diagnostics

Open **Focus Studio → Session → Phone, car & computer diagnostics → Optional device diagnostics**. Use **Enable all available diagnostics** to enable the browser's supported network, battery and page-performance reports. Each optional category can be stopped separately. Unavailable APIs remain labelled unavailable.

## Additional diagnostic options

The diagnostic desk also includes independently selectable **Site storage estimate** and **Office page error counts**, plus page timer-delay observation that works without the long-task API. Preferences are saved on this browser. Sampling stops when Office is inactive or the page is hidden. Counters describe only this session; page error messages, URLs, stack traces and rejected promise contents are not retained.

Use **Refresh diagnostic readings** to refresh enabled network, battery and storage reports. Storage usage and quota refer to this site's browser storage allowance, not whole-device disk space. The persistence check only reads the existing grant; it does not request persistence. Unavailable estimates remain unknown.

**Test Office connection** makes one uncached GET to the existing live-device endpoint using the current Office credential, without opening or awaiting an authentication prompt. A seven-second deadline bounds the entire request, including a transport that ignores cancellation. It reports response status and elapsed time, discards the response body, and does not start GPS, subscribe to shared locations or publish a location. HTTP errors and requests without responses remain distinct. Hiding Office cancels an in-flight test. The diagnostic report includes these measurements and numeric error counts without error details or coordinates.

**Diagnostic coverage & missing connections** lists current GPS readiness and live-pin coverage, alongside integrations still needed for native locked-screen location sharing, OBD-II or manufacturer vehicle telemetry, and whole-computer hardware/process diagnostics. These integrations are not fabricated from browser readings.

## Pins attached to live GPS sources

In **Geo Tracking** or **Live Maps**, use **Live pins → Live pin target → Attach live pin**. Targets are this device and devices explicitly sharing GPS with Office. A current accepted reading is required. The pin stays bound to that source's session ID as it moves; matching names do not merge or retarget pins.

On Geo Tracking, **Drop pin on map** followed by a tap on a GPS marker attaches a live pin to that marker's source. Tapping ordinary map space still creates a fixed pin. In Live Maps, use **Drop live pin on map**, then tap a GPS marker. The target selector offers the same action without tapping a small marker. **Drop & Track** starts or reuses moving tracking, attaches a live pin to this device, and retains the existing fixed pin and route waypoint behavior.

Each live pin has **Follow pin**, **Pause pin**, **Resume pin** and **Remove live pin** controls. Multiple pins can update at once, and one can be followed by the map. Live pin markers disappear when GPS is stale (25 seconds), paused, hidden, stopped or no longer shared. They are not replaced with the viewer's GPS or another device's location. A selected pin with unavailable GPS leaves the map at its last viewed center without showing a current marker.

Choosing a different live tracking source or using **Follow shared device** clears the pin-follow override, so the map follows the requested source. Attaching or explicitly following a live pin in Geo Tracking cancels any pending one-shot location drop; late GPS callbacks cannot add an unintended fixed pin or recenter the map.

Up to 20 bindings are saved locally without coordinates. Reloading restores them paused and does not start GPS or viewing. A renewed sharing session has a new ID and must be attached again. Removing or pausing a pin does not stop another device's sharing session. Fixed saved pins and geofence boundaries retain their existing coordinates and radii; live pins do not move those boundaries. An ordinary object, phone number or unconnected vehicle cannot provide live location merely because a map pin was dropped over it.

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

Regular **Start Geo Tracking**, **Start live GPS**, and command-panel starts use continuous tracking unless a stop limit is explicitly enabled. Old saved numeric limits do not enable automatic stops. A continuous session stays active across visible Office views. Pause and Stop remain available.

Use **Geo Tracking → Drop & Track** to also record a route, then save a pin and waypoint from the next accepted reading. If GPS is already active, it reuses that accepted stream and keeps the existing trip. **More tracking actions → Track while moving** enables route recording without dropping a pin and bypasses stop limits for that session. The selected accuracy profile is preserved; continuous high-accuracy sessions request updates every five seconds.

**Tracking settings → Optional automatic stops** provides separate **Enable time stop** and **Enable distance stop** switches. Both are off by default. Turning a switch on configures the next start; turning it off removes that stop from the current session. Explicit timed shortcuts keep their chosen deadline until stopped or changed. **Keep tracking screen awake** is available beside the main controls when supported.

Dropping a pin while GPS is active preserves map following. Drop & Track explicitly returns the map to following your live location. A saved pin remains separate from your moving marker; it does not impose a stationary start boundary or pause the route. If a drop is waiting for a valid fix, no location is invented. Hidden-tab and screen-lock limitations still apply.

- Balanced recording accepts device-reported uncertainty up to 150 m; Precise accepts 25 m. These are acceptance limits, not accuracy guarantees. Custom settings remain available.
- During Geo Tracking, readings are checked for order, freshness, uncertainty and implausible ground travel. The jump check permits both uncertainty circles and uses 100 m/s as a generous sanity limit. A rejected jump cannot move the accepted marker or add route distance.
- Movement inside the combined uncertainty of consecutive recorded samples is excluded from the route. Stationary jitter is not treated as reliable movement.
- Fresh observations expire after 25 seconds. Hidden tabs, pauses and signal gaps separate route segments; missing sections are not filled in.
- A bounded watchdog frees a hung one-shot GPS request. Late callbacks from that request are ignored. **Automatic GPS recovery**, enabled by default, replaces a failed or stale GPS watch with bounded retries instead of ending the tracking session. Stopped, hidden and permission-denied sessions cannot be restarted by that recovery. Replaced watches cannot deliver late updates. The switch is under Tracking settings.
- Transient Office failures preserve only still-fresh shared observations and retry with bounded backoff. Expiration removes their markers even while the network is unavailable. Authorization failures clear shared observations immediately.
- A network failure has no inferred cause. Browser online status and network speed/latency estimates do not prove that the Office API is reachable; actual HTTP responses are reported separately.

## Device limits and quiet operation

**Commands → Automatic commands** contains a master switch for this Office's automatic boundary actions and repeat messages, plus switches for each timer, reset, sound, Quiet Mode and monitoring action. Switching an action off keeps its saved rules and boundary observations; suppressed actions are labelled in activity history. Manual commands continue to work. **Live Maps → Messages** also has an **Enabled** checkbox for each message. Disabling a message or the master switch cancels its pending repeats rather than replaying them later.

Paired phones retain their last applied configuration. After changing automatic command switches, use **Review and apply phone rules**, then save the reviewed phone configuration. Disabled rules are excluded from server action selection and translated to status-only rules for installed phone clients. Claimed audio retains its originating command, so a composite timer-and-sound command uses its own switch. Local switches also prevent already queued phone-triggered audio from executing in this Office tab.

These features run in the Office browser session. Browser geolocation may pause when the page is hidden or the screen locks; a screen wake lock can help keep a visible page awake when supported, but cannot override operating-system suspension. These changes do not install native background services or constitute a TestFlight release.

Quiet views do not start GPS, publish a location, request camera/microphone access, change operating-system notification settings or stop another program. Use the phone or computer's system Focus / Do Not Disturb for other applications. Phone geofence configurations that execute on a separate device retain their own controls; the action suppression applies to this browser's monitor.

Vehicle OBD-II, engine codes, fuel, vehicle battery, CarPlay and Android Auto telemetry are not connected. No vehicle hardware readings are inferred from GPS or from a selected vehicle type. A shared “computer” profile is likewise an explicitly labelled GPS source, not remote access to that computer.

Diagnostics retain up to 30 recent events in memory, plus up to 50 observed cells for the selected source and grid spacing. A reload ends that observation history. The browser may decline individual permission, battery, network or performance APIs; those values remain unknown rather than receiving fabricated defaults.
