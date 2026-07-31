#!/usr/bin/env python3
# ******************************************************************************
# CreateThiessenPolygons.py
# ******************************************************************************

# Purpose:
# This script creates Thiessen Polygons around SWORD v16 node network and
# clips them based on buffers defined by SWORD reaches' widths and extreme
# distance coefficients.

# Author:
# Jeffrey Wade, Dinuke Munasinghe, Renato Frasson, 2024


# ******************************************************************************
# Import Python modules
# ******************************************************************************
import sys
import numpy as np
import pandas as pd
import geopandas as gpd
from scipy.spatial import Voronoi
from shapely.geometry import Polygon, box


# ******************************************************************************
# Declaration of variables (given as command line arguments)
# ******************************************************************************
# 1 - nodes_in
# 2 - ext_buff_in
# 3 - bound_out


# ******************************************************************************
# Get command line arguments
# ******************************************************************************
IS_arg = len(sys.argv)
if IS_arg != 4:
    print('ERROR - 3 arguments must be used')
    raise SystemExit(22)

nodes_in = sys.argv[1]
ext_buff_in = sys.argv[2]
voronoi_out = sys.argv[3]


# ******************************************************************************
# Check if inputs exist
# ******************************************************************************
try:
    with open(nodes_in) as file:
        pass
except IOError:
    print('ERROR - Unable to open ' + nodes_in)
    raise SystemExit(22)

try:
    with open(ext_buff_in) as file:
        pass
except IOError:
    print('ERROR - Unable to open ' + ext_buff_in)
    raise SystemExit(22)


# ******************************************************************************
# Read shapefiles
# ******************************************************************************
print('Reading files')
# Read node file
nodes_df = gpd.read_file(nodes_in)

# Read node buffer file
ext_buff_df = gpd.read_file(ext_buff_in)


# ******************************************************************************
# Create Thiessen polygons around SWORD nodes
# ******************************************************************************
print('Creating Thiessen polygons')
# ------------------------------------------------------------------------------
# Create bounding box to bound infinite Thiessen polygons
# ------------------------------------------------------------------------------
# Create bounding box around all nodes
minx, miny, maxx, maxy = nodes_df.total_bounds

# Add arbitrary buffer to bounding box (in this case, 20,000 m)
minx -= 20000
maxx += 20000
miny -= 20000
maxy += 20000

# Form bounding box from node extent
node_box = box(minx, miny, maxx, maxy)

# Interpolate additional points along bounding box to catch infinite Voronois
node_boundary = node_box.boundary
boundary_interp = [node_boundary.interpolate(distance=d) for d in
                   np.linspace(0, node_boundary.length, 100)]

# Retrieve coordinates of new bounding box
bound_coords = pd.DataFrame([[p.x, p.y] for p in boundary_interp],
                            columns=['x', 'y'])


# ------------------------------------------------------------------------------
# Create Thiessen polygons
# ------------------------------------------------------------------------------
# Create Voronoi polygons around nodes
nodes_df['x'] = nodes_df.geometry.x
nodes_df['y'] = nodes_df.geometry.y
nodes_xy = nodes_df[['x', 'y']]

# Add bounding box coordinates
nodes_df1 = pd.concat([nodes_xy, bound_coords], ignore_index=True)
vor = Voronoi(nodes_df1.values)

# Extract valid polygons
voronoi_polygons = [Polygon(vor.vertices[region]) for region in vor.regions if
                    region and -1 not in region]

# Convert to geodataframe
voronoi_gdf = gpd.GeoDataFrame(geometry=voronoi_polygons, crs=nodes_df.crs)


# ******************************************************************************
# Write shapefiles to file
# ******************************************************************************
print('Writing shapefiles')
# Write Voronoi polygons to file
# leftdf needs to be the Voronois becuase during 'inner',
# only the geometry from the lef_df will be preserved.
voronoi_sj = gpd.sjoin(left_df=voronoi_gdf, right_df=nodes_df, how='inner',
                       predicate='intersects')

# Convert node_id and reach_id to int
voronoi_sj.node_id = voronoi_sj.node_id.astype('float').astype('int')
voronoi_sj.reach_id = voronoi_sj.reach_id.astype('float').astype('int')

# Remove ghost nodes
voronoi_sj = voronoi_sj[voronoi_sj.node_id % 10 != 6]

# Remove reach end cap nodes at edge of study region
# where Missouri meets the Mississippi, removes edge effects
end_nodes = [64248300140011, 64248300110961,
             64248300170013, 64248300040011, 64248300020061,
             64247900260011, 64247900240701,
             64247900200011, 64247900180581,
             64247900390013, 64247900090011, 64247900070451,
             64247300130211, 64247500010011, 64247400020011]
voronoi_sj = voronoi_sj[~voronoi_sj.node_id.isin(end_nodes)]

# Remove nodes that are in the UTM buffer regions
#voronoi_sj = voronoi_sj[~voronoi_sj['ZONE'].str.contains('b')]

# Drop index_right column
voronoi_sj = voronoi_sj.drop(columns=['index_right'])

# Filter ext_buff_df to node_ids in voronoi_sj
ext_buff_fil = ext_buff_df[ext_buff_df['node_id'].isin(voronoi_sj['node_id'])]

# Sort voronoi_sj and ext_buff_fil to align geometries
voronoi_sj = voronoi_sj.sort_values(by='node_id').reset_index(drop=True)
ext_buff_fil = ext_buff_fil.sort_values(by='node_id').reset_index(drop=True)

# Clip each voronoi_sj geometry with the corresponding geometry in ext_buff_fil
clipped_geom = [
    voronoi_sj.geometry.iloc[i].intersection(ext_buff_fil.geometry.iloc[i])
    for i in range(len(voronoi_sj))]

# Create GeoDataFrame with clipped geometries
clipped = gpd.GeoDataFrame(voronoi_sj, geometry=clipped_geom,
                           crs=voronoi_sj.crs)

# Write clipped Voronoi polygons to file
clipped.to_file(voronoi_out)
