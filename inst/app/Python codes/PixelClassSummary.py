#!/usr/bin/env python3
# ******************************************************************************
# PixelClassSummary.py
# ******************************************************************************

# Purpose:
# This script extracts pixels by class for each Thiessen Polygon sliver and
# writes it to a csv.

# Author:
# Jeffrey Wade, Dinuke Munasinghe, Renato Frasson, 2024


# ******************************************************************************
# Import Python modules
# ******************************************************************************
import geopandas as gpd
import glob
import sys
import os
import re
import pandas as pd
import rasterio
from rasterstats import zonal_stats
from rasterio.warp import reproject, Resampling, calculate_default_transform
from rasterio.io import MemoryFile


# ******************************************************************************
# Declaration of variables (given as command line arguments)
# ******************************************************************************
# 1 - main_river_in
# 2 - voronoi_in
# 3 - utm_str
# 4 - csv_out


# ******************************************************************************
# Get command line arguments
# ******************************************************************************
IS_arg = len(sys.argv)
if IS_arg != 5:
    print('ERROR - 4 arguments must be used')
    raise SystemExit(22)

main_river_in = sys.argv[1]
voronoi_in = sys.argv[2]
utm_str = sys.argv[3]
csv_out = sys.argv[4]


# ******************************************************************************
# Check if inputs exist
# ******************************************************************************
try:
    if os.path.isdir(main_river_in):
        pass
except IOError:
    print('ERROR - '+main_river_in+' invalid folder path')
    raise SystemExit(22)

try:
    with open(voronoi_in) as file:
        pass
except IOError:
    print('ERROR - Unable to open ' + voronoi_in)
    raise SystemExit(22)


# ******************************************************************************
# Retrieve unique months from main river files
# ******************************************************************************
# Get list of file paths to main_river files for UTM zone
mainriver_files = sorted(list(glob.iglob(main_river_in + '/*' + utm_str + '*')))

# Retrieve unique aggregation dates
mon_yrs = sorted(list(set([re.search(r'(\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2})',
                                     x).group(1) for x in mainriver_files])))

# Open Thiessen polygon file and calculate area of polygons in SqKM
thiessen_pols = gpd.read_file(voronoi_in)
thiessen_pols["Area_Sqkm"] = thiessen_pols['geometry'].area / 10**6

# Get the window sizes
window_size = re.search(r'_window_(\d+)_', mainriver_files[0]).group(1)


# ******************************************************************************
# Calculate pixel class numbers in Thiessen Polygons
# ******************************************************************************
print('Calculating pixel class numbers in Thiessen Polygons')
for i in range(len(mon_yrs)):

    print(i)

    with rasterio.open(mainriver_files[i]) as src:
        # 1) Reproject raster -> EPSG:10857 in memory
        dst_crs = "EPSG:10857"
        dst_transform, dst_w, dst_h = calculate_default_transform(
            src.crs, dst_crs, src.width, src.height, *src.bounds
        )
        dst = np.empty((dst_h, dst_w), dtype=src.dtypes[0])
        reproject(
            source=rasterio.band(src, 1),
            destination=dst,
            src_transform=src.transform,
            src_crs=src.crs,
            dst_transform=dst_transform,
            dst_crs=dst_crs,
            resampling=Resampling.nearest,
            dst_nodata=255
        )
    
    # 2) Reproject vectors -> EPSG:5070
    thiessen_reoproj = thiessen_pols.to_crs(dst_crs)
    
    # 3) Zonal stats on CRS-matched data
    zs = zonal_stats(
        vectors=thiessen_reoproj["geometry"],
        raster=dst,
        affine=dst_transform,
        categorical=True,
        nodata=255
    )
    pixel_numbers = pd.DataFrame(zs).fillna(0)

    # Assembly polygons and pixel numbers into dataframe
    frames = [thiessen_pols, pixel_numbers]

    # Label pixel classes
    pixel_class = pd.concat(frames, axis=1)

    # Add missing columns
    req_cols = [0, 1, 2, 3, 4, 252, 253, 255]

    for col in req_cols:
        if col not in pixel_class.columns:
            pixel_class[col] = 0

    pixel_class.rename(columns={0: 'Land',
                                1: 'Unconnected_Open',
                                2: 'Connected_Open',
                                3: 'Unconnected_Partial',
                                4: 'Connected_Partial',
                                252: 'IceSnow',
                                253: 'Clouds',
                                255: 'No_Data'}, inplace=True)

    # Drop columns for output
    pixel_class = pixel_class.filter(['node_id', 'reach_id', 'node_len',
                                      'x', 'y', 'Area_Sqkm',
                                      'Unconnected_Open', 'Unconnected_Partial',
                                      'Connected_Open', 'Connected_Partial',
                                      'Land', 'Clouds', 'IceSnow', 'No_Data'])

    # Round floats
    pixel_class = pixel_class.round({'node_len': 4, 'x': 6, 'y': 6,
                                     'Area_Sqkm': 6})

    # Set file path
    csv_fp = csv_out + 'opera_' + utm_str + '_' + mon_yrs[i] + \
        '_window_' + window_size + '_pixel_nums_thiessen.csv'

    # Write csv to file
    pixel_class.to_csv(csv_fp, index=False)
