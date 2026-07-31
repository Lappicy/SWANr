#!/usr/bin/env python3
# ******************************************************************************
# OPERA_UTM_Zones.py
# ******************************************************************************

# Purpose:
# This script identifies overlap between OPERA tiles and UTM zones in region
# of interest.
# Author:
# Jeffrey Wade,  Renato Frasson, 2024

# ******************************************************************************
# Import Python modules
# ******************************************************************************
import glob
import os
import numpy as np
import pandas as pd
import geopandas as gpd
import sys
import re
import shapely
from rasterio.warp import transform_bounds
import rasterio


# ******************************************************************************
# Declaration of variables (given as command line arguments)
# ******************************************************************************
# 1 - opera_in
# 2 - reproj_out
# 3 - tile_out


# ******************************************************************************
# Get command line arguments
# ******************************************************************************
IS_arg = len(sys.argv)
if IS_arg != 5:
    print('ERROR - 4 arguments must be used')
    raise SystemExit(22)

aoi_in = sys.argv[1]
opera_in = sys.argv[2]
utm_in = sys.argv[3]
tile_out = sys.argv[4]

# Correção do opera_in
if not opera_in.endswith(os.sep):
    opera_in+= os.sep


# ******************************************************************************
# Check if inputs exist
# ******************************************************************************
try:
    if os.path.isdir(opera_in):
        pass
except IOError:
    print('ERROR - '+opera_in+' invalid folder path')
    raise SystemExit(22)

try:
    if os.path.isdir(utm_in):
        pass
except IOError:
    print('ERROR - '+utm_in+' invalid folder path')
    raise SystemExit(22)


# ******************************************************************************
# Read files
# ******************************************************************************
print('Reading files')
# ------------------------------------------------------------------------------
# UTM Zone Shapefile
# ------------------------------------------------------------------------------
# Open the area of interest (aoi)
aoi_in = gpd.read_file(aoi_in)

# Retrieve file with all UTM zones
utm_all = gpd.read_file(utm_in)

# Make same projection (CRS)
if utm_all.crs != aoi_in.crs:
    aoi_in = aoi_in.to_crs(utm_all.crs)
    
# Dissolve AOI in one geometry, and check intersecting zones
aoi_union = aoi_in.unary_union
utm_keep = utm_all[utm_all.intersects(aoi_union)].copy()

# Manitain only the name of the Zone
utm_names = utm_keep["ZoneSimplified"].unique()

# Change the CRS for 4326
utm_keep.to_crs(epsg=4326, inplace=True)

# # Retrieve all UTM zone shapefiles
# utm_files = sorted(glob.glob(utm_in + '*.shp'))
# 
# # Load UTM zone of interest
# utm_all = [gpd.read_file(x) for x in utm_files]
# 
# # Read UTM zone labels
# utm_names = [f.split('.shp')[0][-6:] for f in utm_files]

# ------------------------------------------------------------------------------
# OPERA Tiles
# ------------------------------------------------------------------------------
# Retrieve all temporally aggregated OPERA files
opera_files = sorted(glob.glob(opera_in + '*.tif'))

# Retrieve files from first date window
date_str = re.search(r"\d{4}-\d{2}-\d{2}", opera_files[0]).group(0)
first_files = [file for file in opera_files if re.search(date_str, file)]


# ******************************************************************************
# Extract boundaries of OPERA tiles
# ******************************************************************************
print('Identifying overlap between UTM Zones and OPERA tiles')
# Initialize lists
opera_geoms = []
opera_names = []

# Retrieve geometries of OPERA tiles
for file in first_files:
    with rasterio.open(file) as src:

        # Get raster bounds (and CRS
        bounds = src.bounds
        src_crs = src.crs

        # Reproject bounds to EPSG 4326
        reproj_bounds = transform_bounds(src_crs, "EPSG:4326",
                                         bounds.left, bounds.bottom,
                                         bounds.right, bounds.top)

        # Create box from transformed bounds
        geom = shapely.geometry.box(*reproj_bounds)
        opera_geoms.append(geom)
        opera_names.append(file)

# Create a GeoDataFrame with OPERA raster boundaries
opera_gdf = gpd.GeoDataFrame({"filename": opera_names,
                              "geometry": opera_geoms},
                             crs="EPSG:4326")


# ******************************************************************************
# Find intersecting OPERA tiles
# ******************************************************************************
# Retrieve unique tile IDs
all_tiles = np.unique([re.search(r'T\w{5}', f).group(0) for f in opera_files])

# Initialize dataframe
tile_df = pd.DataFrame(index=range(len(all_tiles)), columns=utm_names)

for j in range(len(utm_keep)):

    # Reproject utm_shp to EPSG 4326
    utm_shp = utm_keep.iloc[[j]]

    # Intersect shapefile with tile boundaries
    opera_int = opera_gdf[opera_gdf.
                          intersects(utm_shp.
                                     union_all())]["filename"]. tolist()

    # Retrieve tile IDs from intersecting file names
    opera_tiles = [re.search(r'T\w{5}', f).group(0) for f in opera_int]

    # Store in dataframe
    tile_df.iloc[0:len(opera_tiles), j] = opera_tiles


# ******************************************************************************
# Write to file
# ******************************************************************************
print('Writing to file')
# Drop rows that are all NaN
tile_df = tile_df.dropna(how='all')

# Write to file
tile_df.to_csv(tile_out, index=False)
