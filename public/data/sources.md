# Data sources and limitations: Jezero Crater Marswalk Planner

Study area (all layers): 77.16–77.70° E, 18.21–18.72° N (about 30 × 30 km, centred near Jezero Crater).
Portal for all NASA layers: NASA/JPL Mars Trek, https://trek.nasa.gov/mars/
Items marked TODO still need to be filled in by the team.

## 1. Optical base map: MRO CTX, Jezero Mosaic, Controlled
- Instrument / mission: CTX, Mars Reconnaissance Orbiter
- Resolution: about 6 m per pixel
- Bounding box (lon/lat): 77.1604655, 18.2110274, 77.6991776, 18.7211945
- Producer: USGS Astrogeology Science Center (Lander Vision System map for Mars 2020)
- Notes: orthorectified using DTMs made from CTX stereo images, so it overlays accurately on the DEM.
- File: JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0.tif
- Projection: equirectangular, standard parallel 0 (from the file name). Read the CRS from the file and reproject; do not assume plain latitude/longitude.

## 2. Topography: MRO CTX, Jezero DEM, Controlled
- Instrument / mission: CTX, Mars Reconnaissance Orbiter
- Resolution: 20 m per pixel (from the file name; TODO confirm in View Metadata)
- Bounding box (lon/lat): 77.1604655, 18.2110274, 77.6989752, 18.7211945
- Producer: USGS Astrogeology Science Center
- File: JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_l... (name truncated in the download list; TODO write the full name)
- Use: slope map and elevation profile for route planning.
- Projection note: same equirectangular projection with standard parallel 0. At 18° N east-west distances are shortened by about 5% (cos 18° = 0.95), so slopes must be computed after reprojecting or with the correct pixel scale.

## 3. Mineralogy: Aqueous Mineral Distribution
- Source layer: Mars Trek, "Aqueous Mineral Distribution" (global point detections)
- Instruments compiled by the layer: CRISM (MRO), OMEGA (Mars Express), THEMIS (Mars Odyssey)
- Classes: phyllosilicate, silica, carbonate, sulfate, chloride; plus "Hydrous Mineral Detection" (CRISM)
- Citation: Ehlmann, B. L., and Edwards, C. S. (2014), Mineralogy of the Martian Surface, Annu. Rev. Earth Planet. Sci., 42, 291–315.
- Our file: jezero_aqueous_minerals.geojson (14 points collected by hand from the Mars Trek pop-ups on 2026-11-14; FIDs 74, 76, 1078, 1079, 1110, 1117, 1126, 1338, 1343, 1345, 1358, 3691, 3693, 4172). The layer cannot be downloaded from Mars Trek (metadata only).
- Limitation: these are detection points, not a continuous mineral map. Only two points (FID 3691 and 1345) fall inside the CTX study area; the rest are regional context within about 20–60 km.

## 4. Thermal: THEMIS Night IR, Controlled Mosaics
- Instrument / mission: THEMIS, Mars Odyssey
- Product: THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018 (2018 release)
- Resolution: 100 m per pixel; coverage 65° S to 65° N
- Use: qualitative indicator of surface thermal inertia. Warmer areas at night suggest rock or coarse material; cooler areas suggest dust or fine sand.
- Limitation: brightness-temperature mosaic, not a calibrated thermal-inertia product; 100 m pixels are coarse for metre-scale hazards.
- Delivery: TODO (file, or screenshot with corner coordinates)

## 5. Geologic context (optional panel, not a map layer)
- USGS SIM 3292, Geologic Map of Mars, USGS-NASA Planetary Geologic Mapping Program, https://astrogeology-usgs.hub.arcgis.com/pages/interactive-maps-mars (TODO add authors and year from the USGS page)
- Older alternative: Greeley, R., and Guest, J. E. (1987), Geologic map of the eastern equatorial region of Mars: USGS IMAP 1802-B, scale 1:15,000,000, https://doi.org/10.3133/i1802B
- Unit at the crater centre: TODO
- Limitation: regional scale; at 30 km it resolves only one or two units, so local detail comes from CTX.

## 6. Ground-level photos
- NASA Mars 2020 Perseverance Raw Images Gallery, https://mars.nasa.gov/mars2020/multimedia/raw-images/
- Images used: TODO (record sol, camera and approximate location for each)

## Not used
- MGS MOLA global DEM (463 m per pixel, ±3 m vertical): superseded by the regional CTX DEM for Jezero. Useful as a fallback for locations without a regional DEM.

## Radiation (if included)
- No Mars Trek layer was used. Any dose values are an illustrative estimate; state the assumptions and source here. TODO

## Method summary
1. Download regional DEM and optical mosaic for the study area.
2. Compute slope from the DEM after reprojecting.
3. Overlay mineral detections and the night thermal map as science and trafficability context.
4. Plan the route and points of interest within an EVA time budget.
