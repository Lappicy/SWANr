#!/usr/bin/env python3
# ******************************************************************************
# SelectSWORDFeatures.py
# ******************************************************************************

# Purpose:
# This script selects SWORD nodes that overlap with target shapefile from
# SWORD NetCDF files and outputs as shapefile.
# Author:
# Jeffrey Wade, Dinuke Munasinghe, Renato Frasson, 2024


# ******************************************************************************
# Import Python modules
# ******************************************************************************
import sys
import xarray as xr
import numpy as np
import pandas as pd
import geopandas as gpd
from shapely import Point


# ******************************************************************************
# Declaration of variables (given as command line arguments)
# ******************************************************************************
# 1 - node_in
# 2 - utm_in
# 3 - node_str
# 4 - utm_str
# 5 - node_out


# ******************************************************************************
# Get command line arguments
# ******************************************************************************
IS_arg = len(sys.argv)
if IS_arg != 6:
    print('ERROR - 5 arguments must be used')
    raise SystemExit(22)

node_in = sys.argv[1]
utm_in = sys.argv[2]
node_str = sys.argv[3]
utm_str = sys.argv[4]
node_out = sys.argv[5]


# ******************************************************************************
# Check if inputs exist
# ******************************************************************************
try:
    with open(node_in) as file:
        pass
except IOError:
    print('ERROR - Unable to open ' + node_in)
    raise SystemExit(22)


try:
    with open(utm_in) as file:
        pass
except IOError:
    print('ERROR - Unable to open ' + utm_in)
    raise SystemExit(22)


# ******************************************************************************
# Read files
# ******************************************************************************
print('Reading files')
# ------------------------------------------------------------------------------
# SWORD Node NetCDF
# ------------------------------------------------------------------------------
# Load SWORD node dataset
# 'River_name' and 'edit_flag' have incorrectly assigned variable types, so
# xarray is unable to read those variables
sword_node_ds = xr.open_dataset(node_in, group='nodes',
                                drop_variables=['river_name', 'edit_flag'])

# ------------------------------------------------------------------------------
# UTM Zone Shapefile
# ------------------------------------------------------------------------------
# Load UTM zone of interest
utm_shp = gpd.read_file(utm_in)

# Set CRS of interest
crs_target = str(326)+utm_str[0:2]

# Reproject UTM zone of interest to correct UTM projection
utm_shp.to_crs(epsg=crs_target, inplace=True)

# Convert variable type of ZONE column
utm_shp.ZONE = utm_shp.ZONE.astype(int).astype(str)


# ******************************************************************************
# Retrieve SWORD nodes by ID string
# ******************************************************************************
print('Retrieving SWORD nodes in target region')
# Filter SWORD nodes by node_str starting digits
node_start = np.array([str(x)[0:len(node_str)] for x in
                       sword_node_ds.node_id.values])
node_mask = node_start == node_str

# Filter sword_node_ds to target nodes
node_sel = sword_node_ds.sel(num_nodes=node_mask)

# Convert to dataframe
node_df = node_sel.sel(num_ids=0).to_dataframe()

# Create point geometry
node_df['geometry'] = node_df.apply(lambda row: Point(row['x'], row['y']),
                                    axis=1)

# Create geodataframe
node_gdf = gpd.GeoDataFrame(node_df, geometry='geometry', crs='epsg: 4326')

# Reproject to CRS of UTM zone
node_gdf.to_crs(epsg=crs_target, inplace=True)


# ******************************************************************************
# Retrieve SWORD nodes within UTM zone of interest
# ******************************************************************************
# Buffer UTM zone shapefile by 20 km
utm_buffer = utm_shp.copy()
utm_buffer['geometry'] = utm_shp.geometry.buffer(20000)

# Get region of utm_buffer that doesnt overlap with utm_shp
utm_buffer_diff = utm_buffer.copy()
utm_buffer_diff['geometry'] =\
    utm_buffer.geometry.difference(utm_shp.union_all())

# Set zone to UTM zone + 'b' to indicate intersection with buffer only
utm_buffer_diff['ZONE'] = utm_buffer_diff['ZONE'] + 'b'

# Intersect node_gdf with utm_buffer and utm_shp
node_utm_buffer = gpd.sjoin(node_gdf, utm_buffer_diff[['ZONE', 'geometry']],
                            how='inner', predicate='intersects')
node_utm_shp = gpd.sjoin(node_gdf, utm_shp[['ZONE', 'geometry']], how="inner",
                         predicate="intersects")

# Join node dataframes
node_utm = gpd.GeoDataFrame(pd.concat([node_utm_buffer, node_utm_shp],
                                      ignore_index=True))


# ******************************************************************************
# Write target nodes to file
# ******************************************************************************
print('Writing target SWORD nodes to file')
# ------------------------------------------------------------------------------
# Write shapefile
# ------------------------------------------------------------------------------
# Convert specific columns to string
node_utm['reach_id'] = node_utm['reach_id'].astype(str)
node_utm['node_id'] = node_utm['node_id'].astype(str)

# Rename long column names
name_map = {'node_length': 'node_len',
            'ext_dist_coef': 'ext_dist_c',
            'meander_length': 'meander_l'}
node_utm = node_utm.rename(columns=name_map)

# Drop index_right column
node_utm = node_utm.drop(columns=['index_right'])

# Write to file
node_utm.to_file(node_out, driver='ESRI Shapefile')
