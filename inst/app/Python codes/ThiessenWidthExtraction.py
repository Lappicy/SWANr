#!/usr/bin/env python3
# ******************************************************************************
# ThiessenWidthExtraction.py
# ******************************************************************************

# Purpose:
# This script extracts river widths based on the pixel numbers of each class
# extracted by the "06_PixelClassSummary_v16.py".

# Author:
# Jeffrey Wade, Dinuke Munasinghe, Renato Frasson, 2024


# ******************************************************************************
# Import Python modules
# ******************************************************************************
import pandas as pd
import glob
import sys
import re
import os
from datetime import datetime


# ******************************************************************************
# Declaration of variables (given as command line arguments)
# ******************************************************************************
# 1 - pixel_num_in
# 2 - tif_opt
# 3 - width_out


# ******************************************************************************
# Get command line arguments
# ******************************************************************************
IS_arg = len(sys.argv)
if IS_arg != 4:
    print('ERROR - 3 arguments must be used')
    raise SystemExit(22)

pixel_num_in = sys.argv[1]
utm_str = sys.argv[2]
width_out = sys.argv[3]


# ******************************************************************************
# Check if inputs exist
# ******************************************************************************
try:
    if os.path.isdir(pixel_num_in):
        pass
except IOError:
    print('ERROR - '+pixel_num_in+' invalid folder path')
    raise SystemExit(22)


# ******************************************************************************
# Retrieve unique months from pixel_num files
# ******************************************************************************
# Get list of file paths to pixel_num files
pixel_files = sorted(list(glob.iglob(pixel_num_in + '/*' + utm_str + '*')))

# Retrieve unique aggregation dates
mon_yrs = sorted(list(set([re.search(r'(\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2})',
                                     x).group(1) for x in pixel_files])))

# Retrieve midpoint date between start and end
midpoints = []

for dr in mon_yrs:
    start_date_str, end_date_str = dr.split('_')
    start_date = datetime.strptime(start_date_str, '%Y-%m-%d')
    end_date = datetime.strptime(end_date_str, '%Y-%m-%d')
    midpoint = start_date + (end_date - start_date) / 2
    midpoints.append(midpoint.strftime('%Y-%m-%d'))

# Get the window sizes
window_size = re.search(r'_window_(\d+)_', pixel_files[0]).group(1)


# ******************************************************************************
# Extract river widths for each Thiessen polygon
# ******************************************************************************
print('Extracting river widths for each node')

for i in range(len(mon_yrs)):

    print(i)

    # Read thiessen polygon table
    pixtable = pd.read_csv(pixel_files[i])

    # Create new dataframe for widths
    widtable = pd.DataFrame({'node_id': pixtable.node_id,
                             'reach_id': pixtable.reach_id,
                             'startdate': [mon_yrs[i].split('_')[0]] *
                            len(pixtable),
                             'middate': midpoints[i],
                             'enddate': [mon_yrs[i].split('_')[1]] *
                            len(pixtable),
                             'node_len': pixtable.node_len,
                             'x': pixtable.x,
                             'y': pixtable.y,
                             'poly_area_km2': pixtable.Area_Sqkm,
                             'open_con': pixtable.Connected_Open,
                             'open_uncon': pixtable.Unconnected_Open,
                             'partial_con': pixtable.Connected_Partial,
                             'partial_uncon': pixtable.Unconnected_Partial,
                             'land': pixtable.Land,
                             'cloud': pixtable.Clouds,
                             'icesnow': pixtable.IceSnow,
                             'no_data': pixtable.No_Data})

    # Convert connected pixel count to area in m2
    # Partially inundated pixels counted as half area
    open_area = widtable.open_con * 900  # Fully inundated area
    partial_area = widtable.partial_con * 900  # Partially inundated area

    # Calculate river width in meters at node, node_len in meters
    widtable['width_m'] = (open_area + (0.5 * partial_area)) /\
        widtable.node_len

    # Calculate fraction of polygon with no data/clouds
    widtable['no_data_frac'] = ((widtable['no_data'] + widtable['cloud']) /
                                (widtable['open_con'] +
                                 widtable['open_uncon'] +
                                 widtable['partial_con'] +
                                 widtable['partial_uncon'] +
                                 widtable['land'] +
                                 widtable['cloud'] +
                                 widtable['icesnow'] +
                                 widtable['no_data']))

    # Calculate polygon inundation fraction of each polygon
    widtable['inun_frac'] = (open_area + (0.5 * partial_area)) /\
        (widtable.poly_area_km2 * 1000000)

    # Round floats
    widtable = widtable.round({'width_m': 4, 'no_data_frac': 4, 'inun_frac': 4})

    # Set output filepath
    csv_fp = width_out + '/opera_' + utm_str + '_' + mon_yrs[i] + \
        '_window_' + window_size + '_river_width.csv'

    # Write width table to csv
    widtable.to_csv(csv_fp, index=False)
