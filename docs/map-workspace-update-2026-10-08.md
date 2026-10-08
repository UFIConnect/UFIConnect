# Map workspace update

The map uses full feed cards beneath the scene, preserving photos, videos, author profiles, likes, source actions, and listing dialogs. The duplicate city directory and explanatory footer are removed.

## Topics and counts

- Guide, Cities, Sources, and Topics have separate settings pages. Source choices page by 12; available topics by 12; selected topic sliders by 6.
- Post-count sliders run from 20 to 500. Each selected topic has a limit; an unfiltered city or source also has a post limit.
- City and source topic selections both apply. Explicit aliases map labels such as Web Development to the source workers' Frontend Dev and Backend Dev labels. Arbitrary title substrings do not count as topic matches.
- Completed topic limits are removed from subsequent database queries before their indexed per-source limit. Deduplication and counters continue across pages. Counts report loaded posts; an exhausted source does not fabricate posts to meet a target.
- Draft settings fetch nothing until Apply. Refresh uses applied settings. Account, location, source, and topic changes invalidate previous requests and pagination.
- Map browsing uses authenticated, located requests and preserves member source restrictions. Passive map reads can display previously read posts and do not consume Home's unseen queue.

## Scene and driving

- Sixteen districts use an explicit land-use plan: Technology and Science share the western academic area; Writing, Bars & clubs and Music surround the central civic gap; Business, Careers and Design share the eastern business area. Community, Travel, Restaurants, Cooking, Video, Sports, Gaming and People occupy the southern terrace facing the waterfront. Stable district IDs define positions, independent of UI list order.
- The district plan reserves the center for UFI downtown and a park leading to the lake. Terrain, highway alignments, interchanges, collectors, secondary streets, rail, airport and shopping access have been repositioned around that plan. All road geometry, traffic and drive routes use the same centerline survey.
- District centers are at least 32 scene units apart. City plots use a larger .82 scale with three building rows, transverse streets, sidewalks and clear entrances. Decorative buildings complete nine parcels per district without inventing source counts or clickable sources. Compact district ponds and hills are removed from street and building footprints; the regional lake provides the waterfront.
- Every city has a distinct building profile, with floors, facades, roof equipment, glazing, foundations, gutters, sidewalks, and pedestrian crossings. Terrain hills use smooth height fields; waterfront walkways have supports and railings.
- Office blocks vary in height and use wider street-level podiums, corner columns, and narrower upper volumes. Terrace buildings have balconies; small landscaped courtyards sit between blocks. Doors and paths face the transverse streets.
- One major highway runs above the districts and the other through the middle. Both remain open routes. Two curved interchanges pass between districts and join the decks at the same height. Decks, piers, foundations, shoulders, supported guardrails, lane markings, and exit openings share their centerlines. Two exits descend from the middle highway to the arterial with smooth grades below 8%. Animated traffic also travels between the highways using the interchange geometry.
- Direct exits from the upper highway reach Science and Business through their rear boulevards. The ramps have smooth grades below 8%, clear neighboring buildings, and have signs that open the corresponding city.
- Curved side roads connect both ends of the two major highways through four junctions, with supported decks, rail openings and lane markings. Side roads end at a highway or city exit; the arterial ends at the outer city junctions, removing unused extensions.
- Each highway corner turns smoothly into the side road around a raised triangular traffic island. Kerbs, low planting, edge lines, guardrails and a supported corner deck replace the abrupt square end junctions. Islands stay outside the traffic lanes.
- Side-road exits enter Community, Technology, Design and People at their boulevard entrances. Fourteen secondary streets connect both terraces through gentle curves and shared junctions. Northern streets run behind the blocks; southern streets run in front, preserving the waterfront green belt. Footpaths accompany the secondary streets.
- Bridge supports skip the arterial, rail, city collectors, and landmark access roads, leaving clear crossings beneath the deck.
- A broad lake replaces the narrow water strip, with an irregular shoreline, shallow-edge and deeper-center shading, shore planting, and a promenade.
- The airport sits southwest of Travel, beside the lake. It includes a marked runway, parallel taxiway, apron, terminal, control tower, hangar and parked aircraft. Its access road uses the gap between Community and Travel. Selecting it opens the Travel feed; Airport map in Live travel returns to a focused airport view.
- The shopping center occupies the southeast waterfront, with retail wings, glazed atrium, storefronts, canopies, roof equipment, parking, crossings and landscaping. Its access road passes east of People. Selecting it opens Shop; Shopping center map in Shop returns to its focused view.
- Both landmarks are available through visible buttons and drive destinations. Arrival offers Open Travel or Open Shop. City destinations retain Enter city.
- Drive mode follows connected collectors and arterial roads, rounds turns, supports pause/resume and destination changes, and offers Enter city on arrival. Driving hides overview labels and restores the orbit camera on exit.
- Desktop defaults to Maximum detail: native pixel density, physical materials, daylight environment reflections, 4096-pixel shadows where supported, and ambient occlusion. Automatic quality adjusts resolution and materials based on frame cost, keeps all cities and interactions, and retries higher quality when headroom returns.
- Night view adds moonlight, lit windows, warm street-lamp pools and localized lighting at downtown, the airport and shopping center. The altitude slider adjusts camera height from 35% to 180% of the fitted view without rebuilding the renderer; Reset view restores 100%. It is disabled during driving. Terrain has smooth edge relief and varied ground colors, with the urban corridor kept graded. Automatic quality retains and restores the original terrain and water colors.
- Geometry is instanced, shadows are cached, and rendering suspends when hidden. Generated terrain, materials, and assets remain local to the app.
- The opening map uses a bird's-eye view fitted to the whole plan on desktop and phones. The Bird’s-eye view toggle also offers perspective; orbit, reset, focus and driving remain available. Desktop gets a larger map panel. Labels keep a readable screen size, hide on collision, reveal smaller building labels as users zoom, and support selecting their city or source. Desktop settings open from Map menu; mobile keeps the three-stripe drawer.

## Validation

Twelve focused route/filter/limit tests passed, covering 500 posts across multiple pages, source-specific limits with city topics, malformed input, authentication, videos, all 342 start/destination combinations across cities and landmarks, destination changes on curved collectors, district spacing, highway and support clearance, interchange continuity, ramp clearance, and ramp grades. The map browser audit passed at 1440 and 390 pixels, including drafts, Apply/Discard, storage failures, account changes, paging, slider persistence, full feed cards, and desktop drive mode with both landmarks. Frontend production build and JavaScript syntax checks passed.

Desktop captures of the bird's-eye plan, perspective view, night view, Business district, airport, and shopping center were inspected. Browser checks verify actual camera-height changes and phone night controls at 390 pixels. Browser navigation confirmed round trips from Maps to Travel and Shop and back to the corresponding landmark, with no page errors. The shoreline is an annulus around the water, removing overlapping surfaces that flickered at high viewpoints.

The previous release's Business onboarding browser check used the old topic-button name. It now checks the selected-topic removal button in the current picker; all 52 Business team browser checks passed.
