#!/usr/bin/env python3
# ******************************************************************************
# OPERA_Dwnl.py
# ******************************************************************************

# Purpose:
# This script downloads OPERA HLS granules given a target region and
# image acquisition dates.
# Author:
# Jeffrey Wade, 2024


# ******************************************************************************
# Import Python modules
# ******************************************************************************
import geopandas as gpd
import pandas as pd
import glob
import sys
from datetime import datetime
import earthaccess
import requests
import os
import re


# ******************************************************************************
# Declaration of variables (given as command line arguments)
# ******************************************************************************
# 1 - target_in
# 2 - node_in
# 3 - date1
# 4 - date2
# 5 - opera_out
# 6 - tile_out
# 7 - product, optional. Example: DSWx-HLS or DSWx-S1
# 8 - subproduct, optional. Example: WTR, BWTR, CONF, DIAG, WTR2


# ******************************************************************************
# Get command line arguments
# ******************************************************************************
IS_arg = len(sys.argv)
if IS_arg not in (7, 9):
    print('ERROR - 6 or 8 arguments must be used')
    raise SystemExit(22)

target_in = sys.argv[1]
node_in = sys.argv[2]
date1 = sys.argv[3]
date2 = sys.argv[4]
opera_out = sys.argv[5]
tile_out = sys.argv[6]
product = sys.argv[7] if IS_arg == 9 else "DSWx-HLS"
subproduct = sys.argv[8] if IS_arg == 9 else "CONF"


def normalize_product(value):
    value = value.strip().upper().replace("_", "-")
    aliases = {
        "DSWX-HLS": "DSWX-HLS",
        "DSWX-S1": "DSWX-S1",
    }
    if value not in aliases:
        print("ERROR - Unsupported OPERA product: " + value)
        raise SystemExit(22)
    return aliases[value]


def product_short_name(value):
    return "OPERA_L3_" + normalize_product(value) + "_V1"


def normalize_subproduct(value):
    value = value.strip().upper().replace("-", "")
    aliases = {
        "WTR": "WTR",
        "BWTR": "BWTR",
        "CONF": "CONF",
        "DIAG": "DIAG",
        "WTR2": "WTR2",
    }
    if value not in aliases:
        print("ERROR - Unsupported OPERA subproduct: " + value)
        raise SystemExit(22)
    return aliases[value]


def link_matches_subproduct(url, value):
    name = os.path.basename(url).upper()
    value = normalize_subproduct(value)
    patterns = {
        "WTR": [r"(^|_)B\d{2}_WTR([_.]|$)", r"(^|_)WTR([_.]|$)"],
        "BWTR": [r"(^|_)B\d{2}_BWTR([_.]|$)", r"(^|_)BWTR([_.]|$)"],
        "CONF": [r"(^|_)B\d{2}_CONF([_.]|$)", r"(^|_)CONF([_.]|$)"],
        "DIAG": [r"(^|_)B\d{2}_DIAG([_.]|$)", r"(^|_)DIAG([_.]|$)"],
        "WTR2": [r"(^|_)B\d{2}_WTR[-_]?2([_.]|$)", r"(^|_)WTR[-_]?2([_.]|$)"],
    }
    return any(re.search(pattern, name) for pattern in patterns[value])


def granule_tile_id(url):
    name = os.path.basename(url).upper()
    patterns = [
        r"HLS_T([0-9]{2}[A-Z]{3})_",
        r"_T([0-9]{2}[A-Z]{3})_",
        r"T([0-9]{2}[A-Z]{3})",
    ]
    for pattern in patterns:
        match = re.search(pattern, name)
        if match:
            return match.group(1)
    return ""


product = normalize_product(product)
subproduct = normalize_subproduct(subproduct)


# ******************************************************************************
# Check if inputs exist
# ******************************************************************************
try:
    with open(target_in) as file:
        pass
except IOError:
    print('ERROR - Unable to open ' + target_in)
    raise SystemExit(22)

# try:
#     with open(node_in) as file:
#         pass
# except IOError:
#     print('ERROR - Unable to open ' + node_in)
#     raise SystemExit(22)


# ******************************************************************************
# Give authorization to EarthAccess
# ******************************************************************************
print('Authorizing earthaccess')
# # Authorize earthaccess with supplied credentials
# EARTHDATA_USERNAME = '****'
# EARTHDATA_PASSWORD = '****'
# auth = earthaccess.login(strategy="environment")

# Authorize earthaccess with environment variables or netrc
try:
    auth = earthaccess.login(strategy="environment")
except Exception:
    auth = earthaccess.login(strategy="netrc")


# ******************************************************************************
# Retrieve bounding box of target area
# ******************************************************************************
print('Retrieving target area')
# Read target region shapefile
target_area = gpd.read_file(target_in)
target_area = target_area.to_crs('EPSG:4326')

# Retrieve bounding box of target area (xmin, ymin, xmax, ymax)
xmin, ymin, xmax, ymax = target_area.total_bounds


# ******************************************************************************
# Download tile boundaries and select tiles for download
# ******************************************************************************
# Download OPERA tile boundary file
# https://hls.gsfc.nasa.gov/products-description/tiling-system/
# tile_url = 'https://hls.gsfc.nasa.gov/wp-content/uploads/2016/03/'\
#     'S2A_OPER_GIP_TILPAR_MPC__20151209T095117_V20150622T000000_'\
#     '21000101T000000_B00.kml'
# 
# response = requests.get(tile_url, stream=True)
# if response.status_code == 200:
#     with open(tile_out, 'wb') as file:
#         file.write(response.content)
# else:
#     print(f"Download failed. Status code: {response.status_code}")

# Read OPERA tile boundary 
tile_gdf = gpd.read_file(tile_out)

# Read OPERA tile boundary kml
#tile_gdf = gpd.read_file(tile_out, driver='KML', layer='Features')

# Read node file or node shapefiles
if os.path.isdir(node_in):
    if not node_in.endswith(os.sep):
        node_in += os.sep
    node_files = sorted(glob.glob(node_in + '*.shp'))
    if not node_files:
        print('ERROR - No node shapefiles found in ' + node_in)
        raise SystemExit(22)
    node_all = [gpd.read_file(x) for x in node_files]
    node_merged = gpd.GeoDataFrame(pd.concat(node_all, ignore_index=True),
                                   crs=node_all[0].crs)
else:
    node_merged = gpd.read_file(node_in)

# Reproject nodes to EPSG 4326
node_merged = node_merged.to_crs(epsg=4326)

# Compute union of all node geometries
node_union = node_merged.union_all()

# Retrieve OPERA tiles that intersect with nodes
int_tiles = tile_gdf[tile_gdf.geometry.intersects(node_union)]
tile_nums = int_tiles.Name.values
if len(tile_nums) == 0:
    print('ERROR - No OPERA tiles intersect selected SWORD nodes')
    raise SystemExit(22)


# ******************************************************************************
# Retrieve OPERA DSWx granules for target region and dates
# ******************************************************************************
print('Querying earthaccess')
# Query earthaccess HLS product
try:
    results = earthaccess.search_data(short_name=product_short_name(product),
                                      temporal=(date1, date2),
                                      bounding_box=(str(xmin), str(ymin),
                                                    str(xmax), str(ymax)))
except (IOError, IndexError):
    # Raise error if no OPERA results returned for location/time
    print('ERROR - No OPERA results returned')
    raise SystemExit(22)


# ******************************************************************************
# Download OPERA DSWx Confidence layer
# ******************************************************************************
print('Querying earthaccess')
# Prepare query for download
dwnl_list = []

# Select requested DSWx layer from each queried result if tile selected
for result in results:
    for granule in earthaccess.results.DataGranule.data_links(result):
        if link_matches_subproduct(granule, subproduct):
            # Retrieve tile and check if it is in selected tile_nums
            if granule_tile_id(granule) in tile_nums:
                dwnl_list.append(granule)

if len(dwnl_list) == 0:
    print('ERROR - No OPERA ' + product + ' ' + subproduct +
          ' files matched the selected SWORD nodes and dates')
    raise SystemExit(22)

# Download OPERA layers
earthaccess.download(sorted(set(dwnl_list)), opera_out)
