#!/usr/bin/env python3
# ******************************************************************************
# Download_SWOT_Node_Data.py
# ******************************************************************************

# Purpose:
# This script downloads SWOT observations aggregated to selected SWORD nodes
# Author:
# Jeffrey Wade,  Renato Frasson, 2024

# ******************************************************************************
# Import Python modules
# ******************************************************************************
import xarray as xr
import sys
import os
from datetime import datetime
import requests
import glob
from io import StringIO
import numpy as np
import pandas as pd
import geopandas as gpd
import rasterio
import itertools
import earthaccess
from shapely.geometry import Polygon, Point


# ******************************************************************************
# Declaration of variables (given as command line arguments)
# ******************************************************************************
# 1 - node_in
# 2 - date1
# 3 - date2
# 4 - swot_orbit_in
# 5 - swot_out


# ******************************************************************************
# Get command line arguments
# ******************************************************************************
IS_arg = len(sys.argv)
if IS_arg != 6:
    print('ERROR - 5 arguments must be used')
    raise SystemExit(22)

node_in = sys.argv[1]
date1 = sys.argv[2]
date2 = sys.argv[3]
swot_orbit_in = sys.argv[4]
swot_out = sys.argv[5]


# ******************************************************************************
# Check if inputs exist
# ******************************************************************************
try:
    if os.path.isdir(node_in):
        pass
except IOError:
    print('ERROR - '+node_in+' invalid folder path')
    raise SystemExit(22)

try:
    with open(swot_orbit_in) as file:
        pass
except IOError:
    print('ERROR - Unable to open ' + swot_orbit_in)
    raise SystemExit(22)


# ******************************************************************************
# Read files
# ******************************************************************************
print('Reading files')
# Read target SWORD nodes
node_files = sorted(list(glob.iglob(node_in + '*.shp')))
node_all = [gpd.read_file(x) for x in node_files]

# Retrieve SWORD node ids from all UTM zones
node_id = np.concatenate([x.node_id.values.astype('float').astype('int')
                          for x in node_all])

# Set aquisition dates
startdate = datetime.strptime(date1, '%Y-%m-%d')
enddate = datetime.strptime(date2, '%Y-%m-%d')


# ******************************************************************************
# Retrieve SWOT Pass Times from Orbital Parameter file
# ******************************************************************************
# Open SWOT Orbit file
swot_orb = xr.open_dataset(swot_orbit_in)

# Set cycle numbersr
cycs = list(range(1, 13))

# Retrieve pass numbers
pass_num = swot_orb.num_passes.values

# Retrieve pass start times (nanoseconds since cycle start)
pass_interval = swot_orb.start_time.values

# Set cycle start times
# https://github.com/CNES/search_swot/tree/master
cyc_start_dict = {
  "1": "2023-07-21T05:33:45.768Z",
  "2": "2023-08-11T02:18:53.064Z",
  "3": "2023-08-31T23:03:58.183Z",
  "4": "2023-09-21T19:49:03.318Z",
  "5": "2023-10-12T16:34:05.784Z",
  "6": "2023-11-02T13:19:11.147Z",
  "7": "2023-11-23T10:04:16.384Z",
  "8": "2023-12-14T06:49:20.010Z",
  "9": "2024-01-04T03:34:26.795Z",
  "10": "2024-01-25T00:19:32.445Z",
  "11": "2024-02-14T21:04:37.126Z",
  "12": "2024-03-06T17:49:41.352Z",
  "13": "2024-03-27T14:34:44.000Z",
  "14": "2024-04-17T11:19:50.000Z",
  "15": "2024-05-08T08:04:54.000Z",
  "16": "2024-05-29T04:49:59.000Z",
  "17": "2024-06-19T01:35:04.000Z",
  "18": "2024-07-09T22:20:07.000Z",
  "19": "2024-07-30T19:05:12.000Z",
  "20": "2024-08-20T15:50:16.000Z",
  "21": "2024-09-10T12:35:22.000Z",
  "22": "2024-10-01T09:20:30.000Z",
  "23": "2024-10-22T06:05:34.000Z",
  "24": "2024-11-12T02:50:38.000Z"
}

# Convert cycle start times to dataframe
cyc_start = pd.DataFrame(list(cyc_start_dict.items()),
                         columns=["cycle_id", "start_time"])

# Convert cycle start data types
cyc_start["cycle_id"] = cyc_start["cycle_id"].astype(int)
cyc_start["start_time"] = pd.to_datetime(cyc_start["start_time"])

# Find combinations of cycle_id and pass number
cycle_pass_comb = list(itertools.product(cyc_start.cycle_id, pass_num))
cycle_pass = [f"{cycle}_{pass_num}" for cycle, pass_num in cycle_pass_comb]

# Compute times of each pass start for each cycle
pass_times = [(x + pd.to_timedelta(pass_interval)).
              strftime('%Y-%m-%dT%H:%M:%SZ')
              for x in cyc_start['start_time']]

# Create dictionary of cycle_pass and start time
pass_dict = dict(zip(cycle_pass, list(itertools.chain(*pass_times))))


# ******************************************************************************
# Retrieve SWOT node data for desired time period using Hydrocron
# ******************************************************************************
# Set desired node attributes for retrieval
attrs = ['node_id', 'reach_id', 'time_str', 'width', 'width_u', 'area_total',
         'area_tot_u', 'area_detct', 'area_det_u', 'node_dist', 'node_q',
         'node_q_b', 'dark_frac', 'ice_clim_f', 'ice_dyn_f', 'n_good_pix',
         'xovr_cal_q', 'p_width', 'p_wid_var', 'p_length', 'p_dam_id',
         'p_n_ch_max', 'p_n_ch_mod', 'xtrk_dist', 'crid', 'cycle_id',
         'pass_id']

# Prepare dates as timestamps
startdt = startdate.strftime('%Y-%m-%dT%H:%M:%SZ')
enddt = enddate.strftime('%Y-%m-%dT%H:%M:%SZ')

# Initiliaze df_list
df_list = []

# Loop through SWORD nodes
for i in range(len(node_id)):

    print(i)

    # Prepare Hydrocron query
    hydrocron_str = 'https://soto.podaac.earthdatacloud.nasa.gov/hydrocron/v1/'\
        'timeseries?feature=Node&feature_id=' + str(node_id[i]) +              \
        '&start_time=' + startdt + '&end_time=' + enddt + '&output=csv&'       \
        'fields=' + ','.join(attrs)

    # Make call to hydrocron
    hydrocron_resp = requests.get(hydrocron_str).json()

    # Catch error results
    if 'error' in hydrocron_resp:
        continue

    # Convert JSON to DF
    hydrocron_data = pd.read_csv(StringIO(hydrocron_resp['results']['csv']))

    # Drop columns that contain 'units'
    hydrocron_df = hydrocron_data.drop(columns=hydrocron_data.
                                       filter(regex='units').columns)

    # Append df to list
    df_list.append(hydrocron_df)

# Concatenate all dataframes
sword_df = pd.concat(df_list, axis=0)

# Combine cycle and pass id
sword_df["cycle_pass"] = sword_df.cycle_id.astype(str) + "_" +\
    sword_df.pass_id.astype(str)

# Drop rows with CRID PIC2
sword_df = sword_df[sword_df["crid"] != "PIC2"]

# ******************************************************************************
# Fill in missing datetimes using cycle and pass ids
# ******************************************************************************
# Replace 'no_data' in time_str with values from pass_dict based on cycle_pass
sword_df['time_str'] = sword_df['time_str'].where(
    sword_df['time_str'] != 'no_data',
    sword_df['cycle_pass'].map(pass_dict))


# ******************************************************************************
# Write to file
# ******************************************************************************
# Format output path
fp_out = swot_out + 'swot_nodes_' + date1 + 'to' + date2 + '.csv'

# Write retrieved data to file
sword_df.to_csv(fp_out)
