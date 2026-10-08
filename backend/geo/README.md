# Automatic feed location data

City and region lookup uses a reduced GeoNames `cities500` gazetteer and `admin1CodesASCII` snapshot from 2026-10-08. Name, ASCII name, country, administrative region, latitude and longitude are retained. Other columns are removed, and the JSON is compressed.

Source: [GeoNames](https://www.geonames.org/) · [downloads](https://download.geonames.org/export/dump/) · [CC BY 4.0 license](https://creativecommons.org/licenses/by/4.0/).

Rebuild with `node scripts/build-feed-cities.mjs <local-source-directory> 2026-10-08`. The directory must contain `cities500.txt` and `admin1CodesASCII.txt`.

Lookup runs locally on the UFIConnect server. Device coordinates are used only for the current member's recommendations; they are not sent to GeoNames. City names are approximate settlement labels, not street addresses. A 100-mile radius is measured from the supplied coordinate, and ambiguous source city names do not establish a nearby match.
