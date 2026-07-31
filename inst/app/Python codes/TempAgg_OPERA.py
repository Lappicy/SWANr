#!/usr/bin/env python3
# ******************************************************************************
# TempAgg_OPERA.py
# ******************************************************************************

# Purpose:
# This script temporally aggregates unique OPERA tiles over date window to
# remove influence of clouds on observations.
# Author:
# Jeffrey Wade,  Renato Frasson, 2024

# ******************************************************************************
# Import Python modules
# ******************************************************************************
import os
import re
import sys
import glob
import numpy as np
from datetime import datetime, timedelta
import rasterio


# ******************************************************************************
# Declaration of variables (given as command line arguments)
# ******************************************************************************
# 1 - opera_in
# 2 - swot_folder
# 3 - window
# 4 - tile_out


# ******************************************************************************
# Get command line arguments
# ******************************************************************************
IS_arg = len(sys.argv)
if IS_arg != 5:
    print('ERROR - 4 arguments must be used')
    raise SystemExit(22)

opera_in = sys.argv[1]
swot_folder = sys.argv[2]
window = sys.argv[3]
tile_out = sys.argv[4]

# Correct tile_out and swot_folder
if not tile_out.endswith(os.sep):
    tile_out += os.sep

if not swot_folder.endswith(os.sep):
    swot_folder += os.sep


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
    if os.path.isdir(swot_folder):
        pass
except IOError:
    print('ERROR - '+swot_folder+' invalid folder path')
    raise SystemExit(22)


# ******************************************************************************
# Set mosaic options
# ******************************************************************************
# Set middle dates for composite tile
swot_dates = sorted({
    datetime.strptime(f[36:44], "%Y%m%d")
    for f in os.listdir(swot_folder)
    if len(f) >= 44 and f[36:44].isdigit()
})

# Create list of dates using sliding window
date_window = []

for d in swot_dates:
    window_start = d - timedelta(days = (int(window) - 1) / 2)
    window_end = d + timedelta(days = (int(window) + 1) / 2)
    date_window.append((window_start, window_end))
    

# Set inundation extent option
# 1 = maximum inundation extent
# 2 = minimum inundation extent
extent = 1

# Set IceWater option
# 0 = leave ice pixels as is
# 1 = set ice pixels to open water
icewater = 0

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
# Retrieve OPERA files within specified date range
# ******************************************************************************
print('Aggregating OPERA tiles over time')
# Retrieve list of all available OPERA files
all_files = glob.glob(os.path.join(opera_in, '*.tif'))
all_files.sort()

# Retrieve tile numbers from selected OPERA files
tile_num = [re.search(r'T(\w{5})_', x).group(1) for x in all_files]
tile_uniq = sorted(list(set(tile_num)))


# ******************************************************************************
# For each unique tile, composite OPERA files across date windows
# ******************************************************************************
# Loop through unique OPERA tiles
for i in range(len(tile_uniq)):

    print(i)

    # Retrieve tile of interest
    tile_i = tile_uniq[i]

    # Retrieve files from tile of interest
    tile_files = [all_files[ind] for ind, val in enumerate(tile_num) if
                  val == tile_i]

    # Retrieve dates from OPERA files
    file_dates = [datetime.strptime(re.search(r'(\d{8})T', x).group(1),
                                    '%Y%m%d') for x in tile_files]

    # Loop through date windows, aggregating OPERA files for each window
    for k in range(len(date_window)):

        # Select date window
        window_i = date_window[k]

        # Retrieve files from within date range
        sub_files = [tile_files[ind] for ind, d in enumerate(file_dates) if
                     window_i[0] <= d <= window_i[1]]

        # If no files retrieved, skip to next loop
        if len(sub_files) == 0:
            continue

        # Set variable to catch first file of each tile
        firstfile = 1

        # Loop through OPERA files
        for j in range(len(sub_files)):

            # If first file found for tile
            if firstfile == 1:

                # Open the raster file, extract metadata and raster values
                with rasterio.open(sub_files[j]) as src:
                    info = src.profile
                    A = src.read()  # A is the raster data
                    R = src.transform  # R is the affine transformation

                # Create array for value remapping
                B = np.zeros_like(A)

                # Remap OPERA values based on priority list
                for p in range(len(priority)):
                    B[A == priority[p]] = p

                # Store composite data
                composite = {'A': B, 'R': R}

                # Reset firstfile value
                firstfile = 0

            # If not the first file found for tile
            else:

                # Open the raster file
                with rasterio.open(sub_files[j]) as src:
                    A = src.read()  # A is the raster data

                # Create array for value remapping
                B = np.zeros_like(A)

                # Remap OPERA values based on priority list
                for p in range(len(priority)):
                    B[A == priority[p]] = p

                # Replace values in A with value in B when A > B
                composite['A'] = np.where(composite['A'] > B, B, composite['A'])

        # Map priority values back to original classes
        composite['A'] = np.array(priority)[composite['A']]

        # # Remap ice to open water if option selected
        # if icewater == 1:
        #     composite['A'][composite['A'] == 252] = 1

        # **********************************************************************
        # Write composited OPERA data to file
        # **********************************************************************
        # Prepare output filepath
        out_fp = tile_out + 'opera_T' + tile_i + '_' +                         \
            window_i[0].strftime('%Y-%m-%d') + '_' +                           \
            window_i[1].strftime('%Y-%m-%d') + '_' +                           \
            'window_' + window + '.tif'

        # Compress data to appropriate shape
        data_out = composite['A'].squeeze()

        # Write composite tif to file
        with rasterio.open(out_fp, 'w', driver='GTiff', dtype=info['dtype'],
                           nodata=info['nodata'], height=info['height'],
                           width=info['width'], count=1, crs=info['crs'],
                           transform=info['transform'],
                           blockxsize=info['blockxsize'],
                           blockysize=info['blockysize'],
                           tiled=info['tiled'], compress=info['compress'],
                           interleave=info['interleave']) as dst:
            dst.write(data_out, 1)
