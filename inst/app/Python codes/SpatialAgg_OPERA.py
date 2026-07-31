#!/usr/bin/env python3
# ******************************************************************************
# SpatialAgg_OPERA.py
# ******************************************************************************

# Purpose:
# This script combines multiple temporally aggregated OPERA tiles in space
# by reprojecting and realigning rasters.
# Author:
# Jeffrey Wade,  Renato Frasson, 2024

# ******************************************************************************
# Import Python modules
# ******************************************************************************
import os
import glob
import numpy as np
import pandas as pd
import geopandas as gpd
import sys
import re
import glob
from pyproj import CRS
from collections import Counter
import rasterio
from rasterio.warp import calculate_default_transform, reproject, Resampling
from rasterio.merge import merge
import tempfile


# ******************************************************************************
# Declaration of variables (given as command line arguments)
# ******************************************************************************
# 1 - opera_in
# 2 - tile_in
# 3 - utm_str
# 4 - merge_out


# ******************************************************************************
# Get command line arguments
# ******************************************************************************
IS_arg = len(sys.argv)
if IS_arg != 5:
    print('ERROR - 4 arguments must be used')
    raise SystemExit(22)

opera_in = sys.argv[1]
tile_in = sys.argv[2]
utm_str = sys.argv[3]
merge_out = sys.argv[4]

# Correct opera_in
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
    with open(tile_in) as file:
        pass
except IOError:
    print('ERROR - Unable to open ' + tile_in)
    raise SystemExit(22)


# ******************************************************************************
# Set merge options
# ******************************************************************************
# Set inundation extent option
# 1 = maximum inundation extent
# 2 = minimum inundation extent
extent = 1

# Define priority for OPERA value compositing
# Opera Classes:
# 0 = Land
# 1 = Open Water
# 2 = Partial Water
# Ice = 252
# Cloud = 253

# If maximum inundation option, prefer water and partial water
if extent == 1:
    priority = [1, 2, 252, 0, 253, 255]
# If minimum inundation option, prefer land
elif extent == 2:
    priority = [0, 2, 1, 252, 253, 255]


# ******************************************************************************
# Create custom merge function
# ******************************************************************************
# Create custom merge function that merges rasters based on value priority
def priority_merge(old_data, new_data, old_nodata=None, new_nodata=None,
                   index=None, roff=None, coff=None):

    # Create a priority ranking: lower values in the list have higher priority
    priority_rank = {val: rank for rank, val in enumerate(priority)}

    # Get the ranks of old and new data based on priority
    old_data_priority = np.vectorize(priority_rank.get)(old_data)
    new_data_priority = np.vectorize(priority_rank.get)(new_data)

    # Mask to select where new_data should replace old_data
    replace_mask = new_data_priority < old_data_priority

    # Update old_data where the new_data has higher priority
    old_data[replace_mask] = new_data[replace_mask]


# ******************************************************************************
# Read files and retrieve CRS
# ******************************************************************************
# ------------------------------------------------------------------------------
# UTM OPERA Overlap File
# ------------------------------------------------------------------------------
# Load csv of overlap between UTM Zones and OPERA
tile_df = pd.read_csv(tile_in)

# Retrieve tiles overlapping with UTM zone of interest
tile_int = tile_df.loc[:, utm_str].dropna()

# ------------------------------------------------------------------------------
# OPERA Tiles
# ------------------------------------------------------------------------------
# Retrieve all temporally aggregated OPERA files
opera_files = sorted(glob.glob(opera_in + '*.tif'))

# Retrieve file names
opera_names = [os.path.basename(file) for file in opera_files]

# Filter files to those intersecting UTM zone
fil_files = [f for f in opera_files if any(k in f for k in tile_int)]


# ******************************************************************************
# Read date windows from temporally aggregated OPERA tiles
# ******************************************************************************
# Get the window size from OPERA files
window_size = re.search(r'window_\d{1,2}', opera_files[0]).group(0)

# Get dates from OPERA files
opera_dates = [re.search(r'(\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2})', x).group(0)
               for x in opera_files]

fil_dates = [re.search(r'(\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2})', x).group(0)
             for x in fil_files]

# Get unique date windows
date_windows = sorted(list(set(opera_dates)))


# ******************************************************************************
# Reproject and realign rasters to source raster for each date window
# ******************************************************************************
for i in range(len(date_windows)):

    # Print
    print(i)

    # Select date window
    window_i = date_windows[i]

    # Retrieve file paths corresponding to window_i
    sub_files = [fil_files[j] for j, window in enumerate(fil_dates)
                 if window == window_i]

    # Set filepath corresponding to source raster with target CRS
    src_in = next((file for file in sub_files
                   if ('T' + utm_str[0:2]) in file), None)

    # Read source raster (unchanging layer)
    with rasterio.open(src_in) as src:
        # Get source CRS, transform, and metadata
        src_crs = src.crs
        src_transform = src.transform
        src_meta = src.meta.copy()
        src_bounds = src.bounds

    # Create a list to hold reprojected rasters in memory
    tmpdir = tempfile.mkdtemp(prefix="reproj_")
    reproj_paths = []
    
    # Reproject each raster and store it in MemoryFile
    for src_path in sub_files:
        with rasterio.open(src_path) as src:
            tgt_transform, tgt_w, tgt_h = calculate_default_transform(
                src.crs, src_crs, src.width, src.height, *src.bounds
            )
            align_transform, align_w, align_h = rasterio.warp.aligned_target(
                transform=tgt_transform, width=tgt_w, height=tgt_h,
                resolution=(src_transform[0], -src_transform[4])
            )
            meta = src.meta.copy()
            meta.update(crs=src_crs, transform=align_transform,
                        width=align_w, height=align_h, compress='LZW')
    
            out_path = os.path.join(tmpdir, os.path.basename(src_path).replace(".tif", "_reproj.tif"))
            with rasterio.open(out_path, "w", **meta) as dst:
                reproject(
                    source=rasterio.band(src, 1),
                    destination=rasterio.band(dst, 1),
                    src_transform=src.transform, src_crs=src.crs,
                    dst_transform=align_transform, dst_crs=src_crs,
                    resampling=Resampling.nearest
                )
            reproj_paths.append(out_path)
        
    # keep datasets OPEN during merge
    datasets = [rasterio.open(p) for p in reproj_paths]

    # Merge OPERA tiles with custom priority merge
    merge_rast, out_trans = merge(datasets, method=priority_merge)

    # Remove extra dimension if it exists
    merge_rast = np.squeeze(merge_rast)

    # Get the metadata from the first MemoryFile Object
    meta = datasets[0].meta.copy()

    # Update metadata for merged raster
    meta.update({
        'height': merge_rast.shape[0],
        'width': merge_rast.shape[1],
        'transform': out_trans,
        'compress': 'LZW'
    })

    # Set output file path
    merge_fp = merge_out + '/opera_' + utm_str + "_" + window_i + '_' + window_size + '.tif'

    # Write the merged raster to a file
    with rasterio.open(merge_fp, 'w', **meta) as dst:
        dst.write(merge_rast, 1)
        
    
    # Older code
    # reproj_rasters = []
    # 
    # # Reproject each raster and store it in MemoryFile
    # for reproj_in in sub_files:
    #     with rasterio.open(reproj_in) as reproj:
    #         # Get reproj CRS, transform, and metadata
    #         reproj_crs = reproj.crs
    #         reproj_transform = reproj.transform
    #         reproj_meta = reproj.meta.copy()
    #         reproj_bounds = reproj.bounds
    # 
    #         # Calculate the transform and dimensions to project to new CRS
    #         target_transform, target_width, target_height = \
    #             calculate_default_transform(reproj_crs, src_crs,
    #                                         reproj.width, reproj.height,
    #                                         *reproj_bounds)
    # 
    #         # Align pixel grids to src_in
    #         align_transform, align_width, align_height = \
    #             rasterio.warp.aligned_target(transform=target_transform,
    #                                          width=target_width,
    #                                          height=target_height,
    #                                          resolution=(src_transform[0],
    #                                                      -src_transform[4]))
    # 
    #         # Update metadata for the output raster
    #         reproj_args = reproj_meta.copy()
    #         reproj_args.update({'crs': src_crs,
    #                             'transform': align_transform,
    #                             'width': align_width,
    #                             'height': align_height})
    # 
    #         # Reproject the data and store it in memory
    #         with rasterio.io.MemoryFile() as memfile:
    #             with memfile.open(**reproj_args) as dst:
    #                 reproject(source=rasterio.band(reproj, 1),
    #                           destination=rasterio.band(dst, 1),
    #                           src_transform=reproj_transform,
    #                           src_crs=reproj_crs,
    #                           dst_transform=align_transform,
    #                           dst_crs=src_crs,
    #                           resampling=Resampling.nearest)
    #                 # Append reproj_raster
    #                 reproj_rasters.append(memfile.open())


# # ******************************************************************************
# # Reproject and realign rasters to source raster for each date window
# # ******************************************************************************

# # Set temporary reproj output path
# reproj_out = '/Users/jwade/jpl/computing/opera/RiverWidths_v16/missouri/'\
#     'output/opera/reproj_temp/'

# for i in range(len(date_windows)):

#     print(i)

#     # Select date window
#     window_i = date_windows[i]

#     # Retrieve file paths corresponding to window_i
#     sub_files = [fil_files[i] for i, window in enumerate(opera_dates) if
#                  window == window_i]

#     # Set first filepath corresponding to target CRS to source raster
#     src_in = next((file for file in sub_files if ('T' + utm_str[0:2]) in file),
#                   None)

#     # Read source raster (unchanging layer)
#     with rasterio.open(src_in) as src:
#         # Get source CRS, transform, and metadata
#         src_crs = src.crs
#         src_transform = src.transform
#         src_meta = src.meta.copy()
#         src_bounds = src.bounds

#     # Loop through OPERA rasters to reproject them to the source CRS
#     for reproj_in in sub_files:

#         # Set reproject file path
#         reproj_fp = reproj_in.replace('.tif', '_reproj.tif')
#         reproj_fp = reproj_fp.replace(opera_in, reproj_out)

#         # Reproject and realign each raster to src_crs
#         with rasterio.open(reproj_in) as reproj:
#             # Get reproj CRS, transform, and metadata
#             reproj_crs = reproj.crs
#             reproj_transform = reproj.transform
#             reproj_meta = reproj.meta.copy()
#             reproj_bounds = reproj.bounds

#             # If reproj_crs same as src_crs, write to file without reprojecting
#             if reproj_crs == src_crs:
#                 with rasterio.open(reproj_fp, 'w', **reproj_meta) as dest:
#                     dest.write(reproj.read(1), 1)

#             else:

#                 # Calculate the transform and dimensions to project to new CRS
#                 target_transform, target_width, target_height = \
#                     calculate_default_transform(reproj_crs, src_crs,
#                                                 reproj.width,
#                                                 reproj.height, *reproj_bounds)

#                 # Align pixel grids to src_in
#                 align_transform, align_width, align_height = \
#                     rasterio.warp.aligned_target(transform=target_transform,
#                                                  width=target_width,
#                                                  height=target_height,
#                                                  resolution=(src_transform[0],
#                                                              -src_transform[4]))

#                 # Update metadata for the output raster
#                 reproj_args = reproj_meta.copy()
#                 reproj_args.update({
#                     'crs': src_crs,
#                     'transform': align_transform,
#                     'width': align_width,
#                     'height': align_height
#                 })

#                 # Reproject the data and write to temporary file
#                 with rasterio.open(reproj_fp, 'w', **reproj_args) as dst:
#                     reproject(
#                         source=rasterio.band(reproj, 1),
#                         destination=rasterio.band(dst, 1),
#                         src_transform=reproj_transform,
#                         src_crs=reproj_crs,
#                         dst_transform=align_transform,
#                         dst_crs=src_crs,
#                         resampling=Resampling.nearest
#                     )

#     # **************************************************************************
#     # Merge OPERA tiles in same coordinate system
#     # **************************************************************************
#     # Retrieve all temporary reproj files
#     reproj_files = glob.glob(reproj_out + '*reproj.tif')

#     # Open reprojected rasters
#     rasts = []
#     for reproj_file in reproj_files:
#         rasts.append(rasterio.open(reproj_file))

#     # Merge OPERA tiles with custom priority merge
#     merge_rast, out_trans = merge(rasts, method=priority_merge)

#     # Remove extra dimension if it exists
#     merge_rast = np.squeeze(merge_rast)

#     # Get the metadata from an input raster
#     meta = rasts[0].meta.copy()

#     # Update metadata for the output raster
#     meta.update({
#         'height': merge_rast.shape[0],
#         'width': merge_rast.shape[1],
#         'transform': out_trans,
#         'compress': 'LZW'
#     })

#     # Set output file path
#     merge_fp = merge_out + 'opera_' + window_i + '.tif'

#     # Write the merged raster to a new file
#     with rasterio.open(merge_fp, 'w', **meta) as dst:
#         dst.write(merge_rast, 1)

#     # Close all raster objects
#     for r in rasts:
#         r.close()

#     # **************************************************************************
#     # Delete temporary reproj files
#     # **************************************************************************
#     for reproj_file in reproj_files:
#         os.remove(reproj_file)

