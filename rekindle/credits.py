"""Data credits for Rekindle exports, each verified against its own source (DECISIONS.md, S6).

Shown in web/public/rekindle/<fire>/meta.json ("credits"), in the Rekindle panel, in the README
and in docs/report/rekindle/references.bib.
"""

ACCESSED = "2026-11-15"

CREDITS: list[dict] = [
    {
        "id": "merra2",
        "short": "MERRA-2 (NASA GMAO, GES DISC)",
        "use": "hourly 10 m wind (U10M, V10M), T2M, QV2M at the fire",
        # Fields from the collection's CMR CollectionCitations (C1276812863-GES_DISC).
        "citation": "Global Modeling and Assimilation Office (GMAO) (2015), MERRA-2 tavg1_2d_slv_Nx: "
        "2d,1-Hourly,Time-Averaged,Single-Level,Assimilation,Single-Level Diagnostics V5.12.4, "
        "Greenbelt, MD, USA, Goddard Earth Sciences Data and Information Services Center "
        f"(GES DISC), Accessed: {ACCESSED}, 10.5067/VJAFPLI1CSIV",
        "doi": "10.5067/VJAFPLI1CSIV",
        "url": "https://doi.org/10.5067/VJAFPLI1CSIV",
    },
    {
        "id": "mcd12q1",
        "short": "MODIS MCD12Q1 v061 land cover (NASA LP DAAC)",
        "use": "IGBP land cover → Anderson fuel models",
        "citation": "Friedl, Mark, & Sulla-Menashe, Damien. (2022). MODIS/Terra+Aqua Land Cover "
        "Type Yearly L3 Global 500m SIN Grid V061 [Data set]. NASA Land Processes Distributed "
        f"Active Archive Center. https://doi.org/10.5067/MODIS/MCD12Q1.061. Date Accessed: {ACCESSED}",
        "doi": "10.5067/MODIS/MCD12Q1.061",
        "url": "https://doi.org/10.5067/MODIS/MCD12Q1.061",
    },
    {
        "id": "mod44w",
        "short": "MODIS MOD44W v061 water mask (NASA LP DAAC)",
        "use": "water cells (non-burnable)",
        "citation": "Carroll, Mark, DiMiceli, Charlene, Townshend, John, Sohlberg, Robert, Hubbard, "
        "Alfred, Wooten, Margaret, Spradlin, Caleb, Gill, Roger, Strong, Savannah, Burke, Amanda, "
        "Blanco-Rojas, Mariana, & Frost, Melanie. (2024). MODIS/Terra Land Water Mask Derived "
        "from MODIS and SRTM L3 Global 250m SIN Grid V061 [Data set]. NASA Land Processes "
        "Distributed Active Archive Center. https://doi.org/10.5067/MODIS/MOD44W.061. "
        f"Date Accessed: {ACCESSED}",
        "doi": "10.5067/MODIS/MOD44W.061",
        "url": "https://doi.org/10.5067/MODIS/MOD44W.061",
    },
    {
        "id": "mcd64a1",
        "short": "MODIS MCD64A1 v061 burned area (NASA LP DAAC)",
        "use": "independent burned-area reference for shape and burn day (S6h)",
        "citation": "Giglio, L., Justice, C., Boschetti, L., Roy, D. (2021). MODIS/Terra+Aqua Burned "
        "Area Monthly L3 Global 500m SIN Grid V061. NASA EOSDIS Land Processes Distributed Active "
        f"Archive Center. Accessed: {ACCESSED}. doi:10.5067/MODIS/MCD64A1.061",
        "doi": "10.5067/MODIS/MCD64A1.061",
        "url": "https://doi.org/10.5067/MODIS/MCD64A1.061",
    },
    {
        "id": "mod44b",
        "short": "MODIS MOD44B v061 Vegetation Continuous Fields (NASA LP DAAC)",
        "use": "fractional cover: non-burnable where non-vegetated > 50 % (S6b)",
        # Citation as given on https://www.earthdata.nasa.gov/data/catalog/lpcloud-mod44b-061
        "citation": "DiMiceli, C., Sohlberg, R., & Townshend, J. (2022). MODIS/Terra Vegetation "
        "Continuous Fields Yearly L3 Global 250m SIN Grid V061 [Data set]. NASA Land Processes "
        f"Distributed Active Archive Center. https://doi.org/10.5067/MODIS/MOD44B.061. "
        f"Date Accessed: {ACCESSED}",
        "doi": "10.5067/MODIS/MOD44B.061",
        "url": "https://doi.org/10.5067/MODIS/MOD44B.061",
    },
    {
        "id": "copdem",
        "short": "Copernicus DEM GLO-30",
        "use": "elevation → slope and aspect (reprojected to 90 m UTM)",
        # Licence Art. 6(b), "adapted or modified" notice (we derive slope/aspect and reproject).
        "citation": "produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus "
        "Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and "
        "ESA; all rights reserved",
        "doi": "10.5270/ESA-c5d3d65",
        "url": "https://registry.opendata.aws/copernicus-dem/",
        "access": f"Copernicus Digital Elevation Model (DEM) was accessed on {ACCESSED} from "
        "https://registry.opendata.aws/copernicus-dem.",
    },
    {
        "id": "firms",
        "short": "NASA FIRMS active fire detections (VIIRS 375 m, MODIS)",
        "use": "ignition (first overpass) and the observed arrival times used for validation",
        "citation": "We acknowledge the use of imagery from the NASA LANCE FIRMS "
        "(https://earthdata.nasa.gov/firms), part of the NASA Earth Science Data and "
        "Information System (ESDIS).",
        "url": "https://earthdata.nasa.gov/firms",
    },
]
