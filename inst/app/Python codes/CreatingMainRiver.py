#!/usr/bin/env python3
# ******************************************************************************
# CreatingMainRiver_.py
# ******************************************************************************

# Purpose:
# This script creates the a polygon representation of the main river and
# connected water bodies using the clumped OPERA DSWx raster.

# Author:
# Jeffrey Wade, Dinuke Munasinghe, Renato Frasson, 2024


# ******************************************************************************
# Import Python modules
# ******************************************************************************
import geopandas as gpd
import glob
import re
import os
import sys
import fiona
import rasterio.mask
import numpy as np
from rtree import index
from rasterio.mask import mask
from shapely.geometry import box


# ******************************************************************************
# Declaration of variables (given as command line arguments)
# ******************************************************************************
# 1 - clump_in
# 2 - voronoi_in
# 3 - nodes_in
# 4 - tif_in
# 5 - utm_str
# 6 - conwater_out


# ******************************************************************************
# Get command line arguments
# ******************************************************************************
IS_arg = len(sys.argv)
if IS_arg != 7:
    print('ERROR - 6 arguments must be used')
    raise SystemExit(22)

clump_in = sys.argv[1]
voronoi_in = sys.argv[2]
nodes_in = sys.argv[3]
tif_in = sys.argv[4]
utm_str = sys.argv[5]
conwater_out = sys.argv[6]


# ******************************************************************************
# Check if inputs exist
# ******************************************************************************
try:
    if os.path.isdir(clump_in):
        pass
except IOError:
    print('ERROR - '+clump_in+' invalid folder path')
    raise SystemExit(22)

try:
    with open(voronoi_in) as file:
        pass
except IOError:
    print('ERROR - Unable to open ' + voronoi_in)
    raise SystemExit(22)

try:
    with open(nodes_in) as file:
        pass
except IOError:
    print('ERROR - Unable to open ' + nodes_in)
    raise SystemExit(22)

try:
    if os.path.isdir(tif_in):
        pass
except IOError:
    print('ERROR - '+tif_in+' invalid folder path')
    raise SystemExit(22)


# ******************************************************************************
# Retrieve unique months from reclassified tifs, clumped polygons and window size
# ******************************************************************************
# Get list of file paths to merged tiles in UTM zone
reclass_files = sorted(list(glob.iglob(clump_in + 'reclass/*' + utm_str + '*')))

# Retrieve unique aggregation dates
mon_yrs = sorted(list(set([re.search(r'(\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2})',
                                     x).group(1) for x in reclass_files])))

# Retrieve clumped polygon files
clump_files = sorted(list(glob.iglob(clump_in + 'clumpedras_poly/*' + utm_str +
                                     '*.shp')))

# Get the window size for these files
window_size = re.search(r'_window_(\d+)_', reclass_files[0]).group(1)


# ******************************************************************************
# Create function for identifying nearest polygon to each node
# ******************************************************************************
def near_poly(node_geom):

    # Intersect node geometry with bounding boxes
    int_index = list(poly_idx.nearest(node_geom.bounds, 1))

    # Retrieve matching polygons
    int_poly = clipped_poly.iloc[int_index]

    # Calculate the actual distance to these polygons
    near_poly_index = int_poly.distance(node_geom).idxmin()

    return near_poly_index


# ******************************************************************************
# Create main river from clumped polygons
# ******************************************************************************
print('Creating main river')

# Load SWORD target nodes
nodes = gpd.read_file(nodes_in)

for i in range(len(mon_yrs)):

    print(i)

    # **************************************************************************
    # Dissolve clumped polygons related to target nodes
    # **************************************************************************
    # Read in clipped clumped OPERA shapefile
    clipped_poly = gpd.read_file(clump_files[i])

    # If its empty (no water pixels in the voronoi, jump to the next iteration)
    if clipped_poly.empty:
      continue
  
    # Create spatial index for polygons
    poly_idx = index.Index()
    for j, poly in enumerate(clipped_poly.geometry):
        poly_idx.insert(j, poly.bounds)
    
    # Correct projection for nodes
    if nodes.crs != clipped_poly.crs:
      nodes = nodes.to_crs(clipped_poly.crs)
    
    # Find nearest clipped polygon to each node
    nodes_poly = nodes.copy()
    nodes_poly['near_poly'] = nodes.geometry.apply(near_poly)

    # Select unique reach values
    near_poly_uniq = list(set(nodes_poly.near_poly.to_list()))

    # Dissolve clumped OPERA polygons
    clipped_poly['ind'] = 0
    clipped_poly_sub = clipped_poly.loc[near_poly_uniq]
    conwater = clipped_poly_sub.dissolve(by='ind')

    # **************************************************************************
    # Retrieve main river tif values
    # **************************************************************************
    # Set file paths
    reclassify_fp = clump_in + 'reclass/opera_' + utm_str + '_' + mon_yrs[i] + \
        '_window_' + window_size + '_reclassified.tif'

    conwater_ras_fp = conwater_out + 'con_ras/opera_' + utm_str + '_' +        \
        mon_yrs[i] + '_window_' + window_size + '_connected_water_raster.tif'

    # Retrieve feature geometries from connected water
    shapes = [feature for feature in conwater['geometry']]

    # Retrieve OPERA raster data for main river polygon
    with rasterio.open(reclassify_fp) as src:
        src_crs = src.crs
        out_image, out_transform = rasterio.mask.mask(src, shapes, crop=True)
        out_meta = src.meta

        # Set No data values (255) to 0
        out_image[out_image == 255] = 0

    out_meta.update({'driver': 'GTiff',
                     'height': out_image.shape[1],
                     'width': out_image.shape[2],
                     'transform': out_transform,
                     'dtype': src.meta['dtype'],
                     'compress': 'lzw'})

    # Write raster to file
    with rasterio.open(conwater_ras_fp, 'w', **out_meta) as dest:
      dest.write(out_image)
    
    dest.close()

    # **************************************************************************
    # Reclassify Tif pixel values
    # **************************************************************************
    # Snow/Ice reclassified to avoid conflict with cloud pixel value
    # Partial water reclassified to avoid conflict with connected open water

    # Set file paths
    tif_fp = tif_in + 'opera_' + utm_str + '_' + mon_yrs[i] + '_window_' + window_size + '.tif'

    con_reclass = conwater_out + 'con_reclass/opera_' + utm_str + '_' +        \
        mon_yrs[i] + '_window_' + window_size + '_connected_reclass.tif'

    # Set reclassification value map
    reclass_map = {
        0: 0,  # No data
        1: 1,  # Open Water
        2: 3,  # Partial Surface Water (Change value to avoid overlap)
        252: 252,  # Snow/Ice (Reclassify to Open Water)
        253: 253,  # Cloud/Cloud shadow
        255: 255
    }

    # Set chunk size
    chunk_size = 5000

    # Reclassify OPERA DSWx
    with rasterio.open(tif_fp) as src:

        # Read profile and array
        profile = src.profile
        data = src.read()

        # Create output raster
        with rasterio.open(con_reclass, 'w', **profile) as dst:
            for j in range(0, src.height, chunk_size):

                print(j)

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

    # **************************************************************************
    # Create the main river raster
    # **************************************************************************
    # Add pixel values of original raster and connected water raster to
    # identify connected/unconnected open and partial water pixels

    # Output Values (OPERA):
    # 0: Land
    # 1: Unconnected Open Water
    # 2: Connected Open Water
    # 3: Unconnected Partial Water
    # 4: Connected Partial Water
    # 253: Cloud
    # 255: No Data

    # Open rasters
    with rasterio.open(conwater_ras_fp) as con_r:
        with rasterio.open(con_reclass) as tif_r:

            # Read data and bounds of connected water rasters
            con_data = con_r.read(1)
            con_bounds = con_r.bounds
            con_geom = [box(*con_bounds)]

            # Clip original raster to connected water raster
            tif_clip, tif_transform = mask(tif_r, con_geom, crop=True)
            tif_clip = np.resize(tif_clip[0], con_data.shape)
            tif_clip = tif_clip.astype(con_data.dtype)

            # Sum rasters
            sum_data = con_data + tif_clip

            # Update metadata from connected raster
            out_meta = con_r.meta.copy()
            out_meta.update({"transform": con_r.transform,
                             "height": con_data.shape[0],
                             "width": con_data.shape[1],
                             "dtype": con_r.meta['dtype'],
                             "compress": "lzw",
                             "colormap": tif_r.colormap})

            # Set output filepath
            mainriver_fp = conwater_out + 'main_river/opera_' + utm_str + '_' +\
                mon_yrs[i] + '_window_' + window_size + '_main_river.tif'

            # Write main river raster to file
            with rasterio.open(mainriver_fp, 'w', **out_meta) as dst:
                dst.write(sum_data, 1)
