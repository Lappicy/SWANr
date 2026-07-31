#!/usr/bin/env python3
# ******************************************************************************
# Create_SWORD_Buffers.py
# ******************************************************************************

# Purpose:
# This script creates buffers based on SWORD nodes.
# SWORD nodes  "width" and ""Ext_dist_c" parameters to generate averaged buffer
# distances at each reach.

# Author:
# Jeffrey Wade, Dinuke Munasinghe, Renato Frasson, 2024


# ******************************************************************************
# Import Python modules
# ******************************************************************************
import sys
import geopandas as gpd


# ******************************************************************************
# Declaration of variables (given as command line arguments)
# ******************************************************************************
# 1 - nodes_in
# 2 - buff_out


# ******************************************************************************
# Get command line arguments
# ******************************************************************************
IS_arg = len(sys.argv)
if IS_arg != 3:
    print('ERROR - 2 arguments must be used')
    raise SystemExit(22)

nodes_in = sys.argv[1]
buff_out = sys.argv[2]


# ******************************************************************************
# Check if inputs exist
# ******************************************************************************
try:
    with open(nodes_in) as file:
        pass
except IOError:
    print('ERROR - Unable to open ' + nodes_in)
    raise SystemExit(22)


# ******************************************************************************
# Load shapefiles
# ******************************************************************************
print('Loading shapefiles')
# Load node shapefiles
node_df = gpd.read_file(nodes_in)

# Reformat node columns
node_df = node_df[["geometry", "reach_id", "node_id", "node_len", "width", "ext_dist_c"]]
node_df['node_id'] = node_df['node_id'].astype(float).astype(int)
node_df['reach_id'] = node_df['reach_id'].astype(float).astype(int)


# ******************************************************************************
# Create buffers around SWORD reaches based on extreme distance coefficient
# ******************************************************************************
print('Creating SWORD reach buffers')
# Calculate buffer width based on a priori width estimate and ext_dist_coeff
# Buffer width in meters
node_df['buff_wid'] = 0

# Set buffer width based on ext_dist_c
node_df["buff_wid"] = node_df["width"] * node_df["ext_dist_c"]

# Set index of node_df to node_id
node_df = node_df.set_index('node_id', drop=False)
node_df = node_df.rename_axis('index')

# If buffer is 0km or when buffer widths exceed 15km, set
# max buffer distance to 15 km
node_df.loc[(node_df['buff_wid'] == 0) | (node_df['buff_wid'] > 15000),
            'buff_wid'] = 15000

# If buffer width is less than the node lenghth (creating gaps in the buffer),
# Set buffer width to node length
node_df.loc[node_df.node_len > node_df.buff_wid, 'buff_wid'] = \
    node_df.loc[node_df.node_len > node_df.buff_wid, 'node_len']

# Create the buffers and export to shp
node_df['geometry'] = node_df.geometry.buffer(node_df["buff_wid"])
node_df.to_file(buff_out)
