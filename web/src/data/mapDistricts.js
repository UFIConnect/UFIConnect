import { MAP_TOWNS } from './mapTowns';
export const CITY_DISTRICTS = MAP_TOWNS.map((town, index) => ({
  id: town.id, label: town.label, short: town.label.toUpperCase(), color: town.color,
  x: 190 + (index % 3) * 240, y: 220 + Math.floor(index / 3) * 270, height: 64 + (index % 3) * 17,
  description: 'Explore the sources in ' + town.town + '.',
}));
