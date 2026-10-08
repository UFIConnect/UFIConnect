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

- Sixteen districts use an irregular valley plan, with staggered setbacks along an open, winding arterial. The shortened network keeps district centers at least 26 scene units apart, and curved collectors connect their entrances to the road. Highway, transit, local streets, and drive routes share the same centerline data.
- City plots are 32 units wide, with buildings spaced across three columns and rows six units apart. Wider boulevards, transverse streets, sidewalks, and tree-lined verges preserve clear entrances and give each block more room.
- Every city has a distinct building profile, with floors, facades, roof equipment, glazing, foundations, gutters, sidewalks, and pedestrian crossings. Terrain hills use smooth height fields; waterfront walkways have supports and railings.
- Office blocks vary in height and use wider street-level podiums, corner columns, and narrower upper volumes. Terrace buildings have balconies; small landscaped courtyards sit between blocks. Doors and paths face the transverse streets.
- One major highway runs above the districts and the other through the middle. Both remain open routes. Two curved interchanges pass between districts and join the decks at the same height. Decks, piers, foundations, shoulders, supported guardrails, lane markings, and exit openings share their centerlines. Two exits descend from the middle highway to the arterial with smooth grades below 8%. Animated traffic also travels between the highways using the interchange geometry.
- Direct exits from the upper highway reach Travel and Business through their rear boulevards. The ramps have smooth grades below 8%, clear neighboring buildings, and have signs that open the corresponding city.
- Curved side roads connect both ends of the two major highways through four junctions. The side roads continue beyond the junctions, with supported decks, rail openings, lane markings, and stop lines.
- Side-road exits enter Community, Technology, Careers and People at their existing boulevard entrances. Seven curved neighborhood streets link the northern districts behind their buildings, preserving space around the southern waterfront and landmarks.
- Bridge supports skip the arterial, rail, city collectors, and landmark access roads, leaving clear crossings beneath the deck.
- A broad lake replaces the narrow water strip, with an irregular shoreline, shallow-edge and deeper-center shading, shore planting, and a promenade.
- The airport beside the lake includes a marked runway, parallel taxiway, apron, terminal, control tower, hangar, parked aircraft, and an arterial access road. Selecting it opens the Travel feed; Airport map in Live travel returns to a focused airport view.
- The shopping center has retail wings, glazed atrium, storefronts, canopies, roof equipment, parking, crossings, landscaping, and a connected access road. Selecting it opens Shop; Shopping center map in Shop returns to its focused view.
- Both landmarks are available through visible buttons and drive destinations. Arrival offers Open Travel or Open Shop. City destinations retain Enter city.
- Drive mode follows connected collectors and arterial roads, rounds turns, supports pause/resume and destination changes, and offers Enter city on arrival. Driving hides overview labels and restores the orbit camera on exit.
- Desktop defaults to Maximum detail: native pixel density, physical materials, daylight environment reflections, 4096-pixel shadows where supported, and ambient occlusion. Automatic quality adjusts resolution and materials based on frame cost, keeps all cities and interactions, and retries higher quality when headroom returns.
- Geometry is instanced, shadows are cached, and rendering suspends when hidden. Generated terrain, materials, and assets remain local to the app.
- The opening map fills the panel. Desktop settings open from Map menu; mobile keeps the three-stripe drawer. A less oblique opening camera and stronger terrain contrast make the branching road hierarchy clearer. Labels keep a readable screen size, hide on collision, reveal smaller building labels as users zoom, and support selecting their city or source.

## Validation

Twelve focused route/filter/limit tests passed, covering 500 posts across multiple pages, source-specific limits with city topics, malformed input, authentication, videos, all 342 start/destination combinations across cities and landmarks, destination changes on curved collectors, district spacing, highway and support clearance, interchange continuity, ramp clearance, and ramp grades. The map browser audit passed at 1440 and 390 pixels, including drafts, Apply/Discard, storage failures, account changes, paging, slider persistence, full feed cards, and desktop drive mode with both landmarks. Frontend production build and JavaScript syntax checks passed.

Desktop captures of the overview, Business district, airport, and shopping center were inspected. Browser navigation confirmed round trips from Maps to Travel and Shop and back to the corresponding landmark, with no page errors.
