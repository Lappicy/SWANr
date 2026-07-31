#!/usr/bin/env python3
# ******************************************************************************
# ConfReclass_OPERA.py
# ******************************************************************************

# Purpose:
# This script reclassifies pixel values in the OPERA DSWx CONF tif to match
# values in OPERA WTR images.

# Author:
# Jeffrey Wade, Dinuke Munasinghe, Renato Frasson, 2024


# ******************************************************************************
# Import Python modules
# ******************************************************************************
import rasterio.mask
import numpy as np
import os
import sys
import glob


# ******************************************************************************
# Declaration of variables (given as command line arguments)
# ******************************************************************************
# 1 - tif_in
# 2- pw_opt
# 3 - reclass_out


# ******************************************************************************
# Get command line arguments
# ******************************************************************************
IS_arg = len(sys.argv)
if IS_arg != 4:
    print('ERROR - 3 arguments must be used')
    raise SystemExit(22)

tif_in = sys.argv[1]
pw_opt = sys.argv[2]
reclass_out = sys.argv[3]


# ******************************************************************************
# Check if inputs exist
# ******************************************************************************
try:
    if os.path.isdir(tif_in):
        pass
except IOError:
    print('ERROR - '+tif_in+' invalid folder path')
    raise SystemExit(22)

# Correct directories if they didnt end with /
if not tif_in.endswith(os.sep):
    tif_in += os.sep

if not reclass_out.endswith(os.sep):
    reclass_out += os.sep
    
    
# ******************************************************************************
# Retrieve OPERA CONF files
# ******************************************************************************
# Get list of file paths to conf tiles
tif_files = sorted(list(glob.iglob(tif_in + '*.tif')))

# Generate output file paths
tif_fps = [reclass_out + x.split('/')[-1].split('.tif')[0] + '_reclass.tif'
           for x in tif_files]


# ******************************************************************************
# Reclassify TIF pixel values
# ******************************************************************************
print('Reclassifying tif values')

# Conservative handling of partial water
if pw_opt == 'cons':
    reclass_map = {
        0: 0,  # No data
        1: 1,  # Open Water High Conf
        2: 1,  # Open Water Mod Conf
        3: 2,  # Partial Water Conservative
        4: 0,  # Partial Water Aggressive
        10: 253,  # Cloud: Not Water
        11: 1,  # Cloud: Open Water High Conf
        12: 253,  # Cloud: Open Water Mod Conf
        13: 2,  # Cloud: Partial Water Conservative
        14: 253,  # Cloud: Partial Water Aggressive
        20: 252,  # Ice: Not Water
        21: 1,  # Ice: Open Water High Conf
        22: 252,  # Ice: Open Water Mod Conf
        23: 2,  # Ice: Partial Water Conservative
        24: 252,  # Ice: Partial Water Aggressive
        252: 252,  # Snow/Ice
        254: 254,  # Ocean
        255: 255,  # No Data Fill
    }
elif pw_opt == 'agg':
    reclass_map = {
        0: 0,  # No data
        1: 1,  # Open Water High Conf
        2: 1,  # Open Water Mod Conf
        3: 2,  # Partial Water Conservative
        4: 2,  # Partial Water Aggressive
        10: 253,  # Cloud: Not Water
        11: 1,  # Cloud: Open Water High Conf
        12: 253,  # Cloud: Open Water Mod Conf
        13: 2,  # Cloud: Partial Water Conservative
        14: 253,  # Cloud: Partial Water Aggressive
        20: 252,  # Ice: Not Water
        21: 1,  # Ice: Open Water High Conf
        22: 1,  # Ice: Open Water Mod Conf
        23: 2,  # Ice: Partial Water Conservative
        24: 2,  # Ice: Partial Water Aggressive
        252: 252,  # Snow/Ice
        254: 254,  # Ocean
        255: 255,  # No Data Fill
    }

# Create lookup array from the reclassification mapping
max_key = max(reclass_map.keys())
lookup = np.zeros(max_key + 1, dtype=np.uint8)
for k, v in reclass_map.items():
    lookup[k] = v

# Loop through rasters
for i in range(len(tif_files)):

    print(i)

    # Open the source raster
    with rasterio.open(tif_files[i]) as src:

        # Read profile
        profile = src.profile

        # Read array
        data = src.read(1)

        # Reclassify using the lookup array
        data_reclass = lookup[data]

        # Write the reclassified data to the output raster
        with rasterio.open(tif_fps[i], 'w', **profile) as dst:
            dst.write(data_reclass, indexes=1)
