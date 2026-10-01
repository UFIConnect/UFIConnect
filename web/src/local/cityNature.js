// Each city has its own landscape, not just a different label.
const theme = (name, description, ground, leaves, feature, water = '#6dbbc6', flowers = '#ead3a7') => ({ name, description, ground, leaves, feature, water, flowers });
export const CITY_NATURE = {
  community: theme('Maple commons', 'Autumn maples and a shared village green', '#a8b478', '#bd713f', 'grove'),
  technology: theme('Pine ridge', 'Evergreen hills and quiet woodland paths', '#8daa89', '#355f4a', 'pines'),
  science: theme('Cedar wetlands', 'A freshwater pond among cedar trees', '#91aca0', '#477564', 'pond'),
  writing: theme('Lavender fields', 'Lavender gardens around a reading square', '#b4bea0', '#8c83b3', 'flowers', '#a3c8cc', '#a696d2'),
  travel: theme('Coral bay', 'A sandy coastline with palms and turquoise water', '#e1cf9d', '#52916c', 'coast', '#68c7cb'),
  restaurants: theme('Orchard grove', 'Fruit trees and warm terracotta courtyards', '#b0bd84', '#7f9a55', 'orchard', '#80c4c5', '#e59c65'),
  nightlife: theme('Moonlit gardens', 'Violet gardens beside a reflecting pool', '#929daf', '#6f718f', 'pond', '#8296c5', '#b89adc'),
  cooking: theme('Kitchen gardens', 'Neat herb beds and kitchen gardens', '#b3bd8b', '#749152', 'beds', '#82bca9', '#dbb984'),
  music: theme('Willow creek', 'A winding creek shaded by willows', '#a4bca2', '#7ca179', 'creek', '#83bacc'),
  video: theme('Sunset meadow', 'Golden grasses and wildflower meadows', '#cabe8c', '#ac965c', 'flowers', '#98bbca', '#e8a778'),
  sports: theme('Alpine park', 'Snow-capped hills, fir trees, and open trails', '#bbcdc0', '#597969', 'alpine'),
  gaming: theme('Fern valley', 'Ferns, mossy rocks, and a forest clearing', '#95aa89', '#578156', 'rocks'),
  business: theme('Aspen heights', 'Golden aspens along a hilltop boulevard', '#c0be90', '#c8ad5b', 'hills'),
  design: theme('Rose gardens', 'Sculpted rose beds and a garden courtyard', '#b9c2a1', '#849772', 'beds', '#91b9bc', '#d692a6'),
  careers: theme('Oak meadow', 'Broad oak trees and a lakeside walk', '#b1ba94', '#7b8b50', 'pond', '#8cbebc'),
  people: theme('Blossom park', 'Cherry blossoms around a welcoming green', '#bdc6aa', '#dda8bb', 'grove', '#8ac7cb', '#edc5d3'),
};
