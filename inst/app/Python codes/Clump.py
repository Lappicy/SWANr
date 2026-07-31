#!/usr/bin/env python3
# ******************************************************************************
# Clump.py
# ******************************************************************************

# Purpose:
# This script reclassifies pixel values in the OPERA DSWx tif and clumps
# regions of equal pixel values together

# Author:
# Jeffrey Wade, Dinuke Munasinghe, Renato Frasson, 2024


# ******************************************************************************
# Import Python modules
# ******************************************************************************
# from whitebox_workflows import WbEnvironment
import rasterio.mask
import numpy as np
import geopandas as gpd
import os
import sys
import glob
import re
from rasterio.features import shapes
from rasterio.mask import mask
from pandas import DataFrame
from geopandas import GeoDataFrame
from shapely.geometry import shape
import importlib.util


# ******************************************************************************
# Import WBT for clumping algorithm
# ******************************************************************************
# Define path to the whitebox_tools.py file inside the /WBT/
wbt_path = '/Users/lappicy/miniforge3_x86/envs/dswx310_x86/lib/python3.10/site-packages/whitebox/WBT/whitebox_tools.py'

# Check if path to whitebox_tools.py exists
if not os.path.isfile(wbt_path):
    raise FileNotFoundError(f"Could not find 'whitebox_tools.py' at {wbt_path}")

# Import whitebox_tools module
spec = importlib.util.spec_from_file_location("whitebox_tools", wbt_path)
whitebox_tools = importlib.util.module_from_spec(spec)
sys.modules["whitebox_tools"] = whitebox_tools
spec.loader.exec_module(whitebox_tools)

# Initialize WhiteboxTools
wbt = whitebox_tools.WhiteboxTools()
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
wbt.work_dir = project_root
wbt.set_verbose_mode(True)

from whitebox_workflows import WbEnvironment
wbe = WbEnvironment()


# ******************************************************************************
# Declaration of variables (given as command line arguments)
# ******************************************************************************
# 1 - tif_in
# 2 - voronoi_in
# 3 - utm_str
# 4 - clump_out


# ******************************************************************************
# Get command line arguments
# ******************************************************************************
IS_arg = len(sys.argv)
if IS_arg != 5:
    print('ERROR - 4 arguments must be used')
    raise SystemExit(22)

tif_in = sys.argv[1]
voronoi_in = sys.argv[2]
utm_str = sys.argv[3]
clump_out = sys.argv[4]

# Correct tif_in
if not tif_in.endswith(os.sep):
    tif_in+= os.sep


# ******************************************************************************
# Check if inputs exist
# ******************************************************************************
try:
    if os.path.isdir(tif_in):
        pass
except IOError:
    print('ERROR - '+tif_in+' invalid folder path')
    raise SystemExit(22)

try:
    with open(voronoi_in) as file:
        pass
except IOError:
    print('ERROR - Unable to open ' + voronoi_in)
    raise SystemExit(22)


# ******************************************************************************
# Retrieve unique months and window sizes from merged tiles
# ******************************************************************************
# Get list of file paths to merged tiles in UTM zone
tif_files = sorted(list(glob.iglob(tif_in + '*' + utm_str + '*.tif')))

# Retrieve unique aggregation dates
mon_yrs = sorted(list(set([re.search(r'(\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2})',
                                     x).group(1) for x in tif_files])))

# Get the window size for these files
window_size = re.search(r'window(\d+)', tif_in).group(1)


# ******************************************************************************
# Reclassify TIF pixel values
# ******************************************************************************
print('Reclassifying tif values')

# Set chunk size
chunk_size = 5000

# Define pixel reclassification
reclass_map = {
    0: 0,  # No data
    1: 1,  # Open Water
    2: 1,  # Partial Surface Water
    252: 252,  # Snow/Ice
    253: 0,  # Cloud/Cloud shadow
    255: 0  # No Data
}

# Set original water values
water_val = [1, 2]

# Initialize valid mon_yrs
val_mon_yrs = []

# Loop through merged files
for i in range(len(tif_files)):

    print(i)

    # Set file path for reclassified tif
    fp_reclass = clump_out + '/reclass/opera_' + utm_str + '_' + mon_yrs[i] +   \
        '_window_' + window_size + '_reclassified.tif'
         
    # Reclassify OPERA DSWx
    with rasterio.open(tif_files[i]) as src:

        # Read profile and array
        profile = src.profile
        data = src.read()

        # Add compression to raster
        profile.update({'compress': 'LZW'})

        # Check if raster has any water pixels
        if np.sum(np.isin(data, water_val)) > 0:

            # Add mon_yr to new list
            val_mon_yrs.append(mon_yrs[i])

            # Create output raster
            with rasterio.open(fp_reclass, 'w', **profile) as dst:
                for j in range(0, src.height, chunk_size):

                    # print(j)

                    # Read a horizontal chunk of data
                    window = rasterio.windows.Window(0, j, src.width,
                                                     min(chunk_size,
                                                         src.height - j))
                    array = src.read(window=window)

                    # Reclassify pixel values
                    vector_reclass = np.vectorize(reclass_map.get)
                    array_reclass = vector_reclass(array)

                    # Write the reclassified chunk to the output file
                    dst.write(array_reclass, window=window)

        # If no water pixels, skip to next file
        else:
            print('No water pixels')
            # continue


# ******************************************************************************
# Clump regions of similar pixels
# ******************************************************************************
print('Clump similar pixels')
# Read in the Thiessen Polygons
thiessen_polygons = gpd.read_file(voronoi_in)

# Correct projection if needed, as to match the projection from the rasters
ref_tif = os.path.join(clump_out, 'reclass',
                       f'opera_{utm_str}_{val_mon_yrs[0]}_window_{window_size}_reclassified.tif')
with rasterio.open(ref_tif) as rsrc:
    raster_crs = rsrc.crs

# reproject the shapes to the raster CRS
if thiessen_polygons.crs != raster_crs:
    thiessen_polygons = thiessen_polygons.to_crs(raster_crs)

# Retrieve polygon geometries of thiessen polygons
poly_shapes = [feature["geometry"] for feature in
               thiessen_polygons.__geo_interface__["features"]]
               
for i in range(len(val_mon_yrs)):

    print(i)

    # Generate reclassified raster fp
    fp_reclass = clump_out + '/reclass/opera_' + utm_str + '_' +                \
        val_mon_yrs[i] + '_window_' + window_size + '_reclassified.tif'

    # Generate clumped raster fp
    fp_clump = clump_out + '/clumpedras_poly/opera_' + utm_str + '_' +          \
        val_mon_yrs[i] + '_window_' + window_size + '_clumpedRas.tif'
    fp_clip = clump_out + '/clumpedras_poly/opera_' + utm_str + '_' +           \
        val_mon_yrs[i] + '_window_' + window_size + '_clumpedRas_clip.tif'
    fp_shp = clump_out + '/clumpedras_poly/opera_' + utm_str + '_' +            \
        val_mon_yrs[i] + '_window_' + window_size + '_clumpedRas_poly.shp'

    # Use the clump tool to create regions
    wbt.clump(fp_reclass, fp_clump, diag=True, zero_back=True)

    # Clip clumped raster to thiessen polygons
    with rasterio.open(fp_clump) as src:

        clip_image, clip_transform = mask(src, poly_shapes, crop=True)

        # Update raster metadata
        clip_meta = src.meta.copy()
        clip_meta.update({
            "driver": "GTiff",
            "height": clip_image.shape[1],
            "width": clip_image.shape[2],
            "transform": clip_transform,
            "compress": "LZW"
        })

        # Write clipped raster to file
        with rasterio.open(fp_clip, "w", **clip_meta) as dest:
            dest.write(clip_image)

    # Convert the raster into polygons
    with rasterio.open(fp_clip) as src:
        data = src.read(1, masked=True)
        shape_gen = ((shape(s), v) for s, v in shapes(data,
                                                      transform=src.transform))
        df = DataFrame(shape_gen, columns=['geometry', 'class'])
        df = df.loc[df['class'] != 0]
        gdf = GeoDataFrame(df['class'], geometry=df.geometry, crs=src.crs)
        gdf.to_file(fp_shp,
                    driver='ESRI Shapefile')

    # Delete clumped and clipped raster to save space
    os.remove(fp_clump)
    os.remove(fp_clip)
