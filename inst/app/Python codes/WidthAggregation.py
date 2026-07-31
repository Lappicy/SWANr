#!/usr/bin/env python3
# ******************************************************************************
# WidthAggregation.py
# ******************************************************************************

# Purpose:
# This script combines all UTM specific OPERA width CSV files into a single
# width file for each UTM zone.

# Author:
# Jeffrey Wade, Dinuke Munasinghe, Renato Frasson, 2024


# ******************************************************************************
# Import Python modules
# ******************************************************************************
import pandas as pd
import numpy as np
import glob
import sys
import re
import os


# ******************************************************************************
# Declaration of variables (given as command line arguments)
# ******************************************************************************
# 1 - width_in
# 2 - width_out


# ******************************************************************************
# Get command line arguments
# ******************************************************************************
IS_arg = len(sys.argv)
if IS_arg != 3:
    print('ERROR - 2 arguments must be used')
    raise SystemExit(22)

width_in = sys.argv[1]
width_out = sys.argv[2]


# ******************************************************************************
# Check if inputs exist
# ******************************************************************************
try:
    if os.path.isdir(width_in):
        pass
except IOError:
    print('ERROR - '+width_in+' invalid folder path')
    raise SystemExit(22)


# ******************************************************************************
# Retrieve UTM zone width files
# ******************************************************************************
# Get list of file paths of width files
width_files = sorted(list(glob.iglob(width_in + '/*')))

# Retrieve unique aggregation dates
width_dates = [re.search(r'(\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2})', x).group(1)
               for x in width_files]
mon_yrs = sorted(list(set(width_dates)))

# Get the window sizes
window_size = re.search(r'_window_(\d+)_', width_files[0]).group(1)


# ******************************************************************************
# Combine width files for each date window
# ******************************************************************************
print('Combining width files')

for i in range(len(mon_yrs)):

    print(i)

    # Retrieve window
    window_i = mon_yrs[i]

    # Retrieve files with window_i date
    files_i = np.array(width_files)[np.array(width_dates) == window_i].tolist()

    # Read csv files and combine into one file
    width_all = pd.concat([pd.read_csv(x) for x in files_i], ignore_index=True)

    # Set output filepath
    csv_fp = width_out + '/opera_' + mon_yrs[i] + '_window_' + window_size + '_river_width.csv'

    # Write width table to csv
    width_all.to_csv(csv_fp, index=False)
