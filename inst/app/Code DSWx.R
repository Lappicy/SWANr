# Create python environment in R ####
# 1) Setup reticulate and Miniconda
# Clean any forced Python selection
Sys.unsetenv("RETICULATE_PYTHON")  # if you set this in ~/.Renviron, remove that line too and restart later

# Setup reticulate + Miniconda (ARM64)
if (!requireNamespace("reticulate", quietly = TRUE)) install.packages("reticulate")
library(reticulate)
if (is.null(conda_binary())) install_miniconda()  # installs under ~/Library/r-miniconda-arm64

# # Create env if missing
# if (!"dswx" %in% conda_list()$name) {
#   system2(conda_binary(), c("create","-y","-n","dswx","python=3.11"))
# }
# Create env if missing
envs <- tryCatch(conda_list()$name, error = function(e) character())
if (!"dswx" %in% envs) {
  conda_create("dswx", packages = "python=3.11")
}

# Core geospatial libs from conda-forge (ARM binaries)
conda_install("dswx", packages = c("gdal", "geopandas", "rasterio", "shapely",
                                   "fiona", "pyproj", "rtree", "xarray",
                                   "pandas", "numpy", "scipy", "requests", "pip",
                                   "whitebox", "whiteboxgui", "rasterstats"),
              channel = "conda-forge")

# Extras via pip inside the same env (not always on conda-forge or fresher on PyPI)
py_install(packages = c("earthaccess", "whitebox-workflows"),
           envname = "dswx", pip = TRUE)

# Bind this R session to the env
use_condaenv("dswx", required = TRUE)

# # Install packages (ARM64 builds from conda-forge)
# system2(conda_binary(), c("install","-y","-n","dswx","-c","conda-forge",
#                           "geopandas","fiona","shapely","pyproj","rtree","gdal"))
#
# # Point reticulate to the exact ARM64 Python in that env
# py <- conda_python("dswx")
# use_python(py, required = TRUE)

# Verify architecture and libs
py_run_string("
import sys, platform
print('Python:', sys.version.split()[0], 'Arch:', platform.machine())
import geopandas, shapely, fiona, pyproj, rasterio, xarray, pandas, numpy, requests
print('OK:', 'geopandas', geopandas.__version__, 'rasterio', rasterio.__version__, 'xarray', xarray.__version__)
from whitebox.whitebox_tools import WhiteboxTools
wbt = WhiteboxTools()
print('WhiteboxTools OK')
try:
    from whitebox_workflows import WbEnvironment
    wbe = WbEnvironment()
    print('whitebox_workflows OK')
except Exception as e:
    print('whitebox_workflows issue:', e)
import earthaccess
print('earthaccess OK')
")


# Inicio necessário ####
library(reticulate)

# Garantir o Python ARM64 correto
use_python(conda_python("dswx"), required = TRUE)

# NÃO RODAR ESSE Download_SWOT_Node_Data.py ####
# Paths
script <- paste0(getwd(), "/Python codes/Download_SWOT_Node_Data_Pass.py")

# node_in must be a FOLDER containing one or more *.shp of selected SWORD nodes
node_in  <- paste0(getwd(), "/AOI/Nodes/")
date1 <- "2023-07-21"
date2 <- "2026-01-31" 

# SWOT orbit parameters NetCDF (from CNES/NASA; contains pass timings)
swot_orbit_in <- paste0(getwd(), "/SWOT/orbit/swot_orbit_params.nc")

# Output directory prefix; the script will write:
#   <swot_out>/swot_nodes_<date1>to<date2>.csv
swot_out_dir <- paste0(getwd(), "/DSWx_out/swot_nodes/")
dir.create(swot_out_dir, showWarnings = TRUE, recursive = TRUE)

# Pass CLI args e executar o script completo
py_run_string(sprintf('import sys; sys.argv = ["Download_SWOT_Node_Data.py",
                      r"%s", r"%s", r"%s", r"%s", r"%s"]',
                      node_in,
                      date1,
                      date2,
                      swot_orbit_in,
                      swot_out_dir))
py_run_file(normalizePath(script, winslash = "/"))

# Saída criada dentro de `swot_out_dir`


# NÃO RODAR ESSE SelectSWORDFeatures.py ####
# Paths
script <- paste0(getwd(), "/Python codes/SelectSWORDFeatures.py")
nodes <- paste0(getwd(), "/AOI/Nodes_Pantanal_metros.gpkg")
utm_shp <- paste0(getwd(), "/AOI/utm_zone.gpkg")
node_str <- "7429"
utm_str <- "22S"
out <- paste0(getwd(), "/DSWx_out/sword_nodes_sel.shp")
dir.create(dirname(out), showWarnings = TRUE, recursive = TRUE)


# Pass CLI args and execute the Python script
py_run_string(sprintf('import sys; sys.argv = ["SelectSWORDFeatures.py",
                      r"%s", r"%s", r"%s", r"%s", r"%s"]',
                      node_nc, 
                      utm_shp,
                      node_str, utm_str,
                      out))
py_run_file(normalizePath(script, winslash = "/"))
# Output written to `out`


# CreateSWORDBuffers.py ####
# Paths
script_CreateSWORDBuffers <- paste0(getwd(), "/Python codes/CreateSWORDBuffers.py")
nodes <- paste0(getwd(), "/AOI/Chosen_nodes.gpkg")
out <- paste0(getwd(), "/DSWx_out/sword_buffers.gpkg")
dir.create(dirname(out), showWarnings = T, recursive = T)

# Pass CLI args and execute the Python script
py_run_string(sprintf('import sys; sys.argv = ["CreateSWORDBuffers.py", r"%s", r"%s"]',
                      nodes, out))
py_run_file(script_CreateSWORDBuffers)


# CreateThiessenPolygons.py ####
# Caminhos
script_CreateThiessenPolygons <- paste0(getwd(), "/Python codes/CreateThiessenPolygons.py")
nodes <- paste0(getwd(), "/AOI/Chosen_nodes.gpkg")   # projected CRS, meters
buff <- paste0(getwd(), "/DSWx_out/sword_buffers.gpkg")      # same CRS
out <- paste0(getwd(), "/DSWx_out/thiessen_polygons.gpkg")

# Ensure output dir exists, then define output file
dir.create(out, showWarnings = TRUE, recursive = TRUE)

# run the script with CLI-style args (no REPL active)
py_run_string(sprintf('import sys; sys.argv = ["CreateThiessenPolygons.py",
                      r"%s", r"%s", r"%s"]',
                      nodes, buff, out))
py_run_file(script_CreateThiessenPolygons)


# OPERA_Dwnl.py ####
# Paths
script_OPERA_Dwnl <- paste0(getwd(), "/Python codes/OPERA_Dwnl.py")
target <- paste0(getwd(), "/DSWx_out/thiessen_polygons.gpkg")
nodes_dir <- paste0(getwd(), "/SWOT nodes D/")     
date1 <- "2023-07-11"                                                  
date2 <- "2026-01-31"                                               
opera_out <- paste0(getwd(), "/OPERA/DSWx_conf")              
tile_out  <- paste0(getwd(), "/OPERA/Opera tile boundaries - polygons.gpkg")   

# Ensure dirs
dir.create(dirname(tile_out), recursive = TRUE, showWarnings = TRUE)
dir.create(opera_out, recursive = TRUE, showWarnings = TRUE)

# Definir sys.argv e executar o script completo
py_run_string(sprintf('import sys; sys.argv = ["OPERA_Dwnl.py",
                      r"%s", r"%s", r"%s", r"%s", r"%s", r"%s"]',
                      target, nodes_dir, date1, date2, opera_out, tile_out))
py_run_file(script_OPERA_Dwnl)


# ConfReclass_OPERA.py ####
# Vars
script_ConfReclass_OPERA <- paste0(getwd(), "/Python codes/ConfReclass_OPERA.py")
tif_in_dir <- paste0(getwd(), "/OPERA/DSWx_conf")
pw_opt <- "cons" # cons = conserver OR agg = more permesive 
reclass_dir <- paste0(getwd(), "/OPERA/DSWx_conf_reclass")

# Prep
dir.create(reclass_dir, recursive = TRUE, showWarnings = TRUE)

# Set sys.argv inside Python and run the script
py_run_string(sprintf('import sys; sys.argv = ["ConfReclass_OPERA.py",
                      r"%s", r"%s", r"%s"]',
                      tif_in_dir, pw_opt, reclass_dir))
py_run_file(script_ConfReclass_OPERA)


# TempAgg_OPERA.py ####
# Vars
script_TempAgg_OPERA <- paste0(getwd(), "/Python codes/TempAgg_OPERA.py")
opera_in <- paste0(getwd(), "/OPERA/DSWx_conf_reclass")
swot_folder <- paste0(getwd(), "/SWOT reaches D")
window <- 11 
tile_out <- paste0(getwd(), "/OPERA/DSWx_mosaics/window", window)

# Criar diretório
dir.create(tile_out, recursive = TRUE, showWarnings = TRUE)

# Set sys.argv em Python e execute o script em uma linha
py_run_string(sprintf('import sys; sys.argv = ["TempAgg_OPERA.py",
                      r"%s", r"%s", r"%s", r"%s"]',
                      opera_in, swot_folder, window, tile_out))
py_run_file(script_TempAgg_OPERA)


# Loop para várias janelas temporais
script_TempAgg_OPERA <- paste0(getwd(), "/Python codes/TempAgg_OPERA.py")
opera_in <- paste0(getwd(), "/OPERA/DSWx_conf_reclass")
swot_folder <- paste0(getwd(), "/SWOT reaches D")
#window <- 11 
for(i in seq(3, 15, 2)){
  cat(paste0("Rodando i = ", i, Sys.time(), "\t"))
  window <- i
  tile_out <- paste0(getwd(), "/OPERA/DSWx_mosaics/window", window)
  dir.create(tile_out, recursive = TRUE, showWarnings = FALSE)
  py_run_string(sprintf('import sys; sys.argv = ["TempAgg_OPERA.py",
                      r"%s", r"%s", r"%s", r"%s"]',
                        opera_in, swot_folder, window, tile_out))
  py_run_file(script_TempAgg_OPERA)
}


# OPERA_UTM_Zones.py ####
# Vars
script_OPERA_UTM_Zones <- paste0(getwd(), "/Python codes/UTM_Overlap_OPERA.py")
AOI_in <- paste0(getwd(), "/AOI/Chosen_nodes.gpkg")
opera_in <- paste0(getwd(), "/OPERA/DSWx_mosaics")
utm_in <- paste0(getwd(), "/AOI/World_UTM_Grid_simplified.gpkg") 
tile_out <- paste0(getwd(), "/OPERA/DSWx_mosaics/opera_utm_tiles.csv")

# Set sys.argv and run
py_run_string(sprintf('import sys; sys.argv = ["OPERA_UTM_Zones.py",
                      r"%s", r"%s", r"%s", r"%s"]',
                      AOI_in, opera_in, utm_in, tile_out))
py_run_file(script_OPERA_UTM_Zones)


# Loop para várias janelas temporais
script_OPERA_UTM_Zones <- paste0(getwd(), "/Python codes/UTM_Overlap_OPERA.py")
AOI_in <- paste0(getwd(), "/AOI/Chosen_nodes.gpkg")
utm_in <- paste0(getwd(), "/AOI/World_UTM_Grid_simplified.gpkg") 
for(i in seq(3, 15, 2)){
  cat(paste0("Rodando i = ", i, Sys.time(), "\t"))
  window <- i
  opera_in <- paste0(getwd(), "/OPERA/DSWx_mosaics/window", window)
  tile_out <- paste0(opera_in, "/opera_utm_tiles.csv")
  py_run_string(sprintf('import sys; sys.argv = ["OPERA_UTM_Zones.py",
                      r"%s", r"%s", r"%s", r"%s"]',
                        AOI_in, opera_in, utm_in, tile_out))
  py_run_file(script_OPERA_UTM_Zones)
}


# SpatialAgg_OPERA.py ####
# Vars
script_SpatialAgg_OPERA <- paste0(getwd(), "/Python codes/SpatialAgg_OPERA.py")
opera_in <- paste0(getwd(), "/OPERA/DSWx_mosaics")  
tile_in <- paste0(getwd(), "/OPERA/DSWx_mosaics/opera_utm_tiles.csv") 
utm_str <- "21S"
merge_out <- paste0(getwd(), "/OPERA/merged")

# Prep
dir.create(merge_out, recursive = TRUE, showWarnings = TRUE)

# Set sys.argv and run
py_run_string(sprintf('import sys; sys.argv = ["SpatialAgg_OPERA.py",
                      r"%s", r"%s", r"%s", r"%s"]',
                      opera_in, tile_in, utm_str, merge_out))
py_run_file(script_SpatialAgg_OPERA)


# Loop para várias janelas temporais
script_SpatialAgg_OPERA <- paste0(getwd(), "/Python codes/SpatialAgg_OPERA.py")
utm_str <- "21S"
for(i in seq(3, 15, 2)){
  cat(paste0("Rodando i = ", i, Sys.time(), "\t"))
  window <- i
  opera_in <- paste0(getwd(), "/OPERA/DSWx_mosaics/window", window, "/")  
  tile_in <- paste0(getwd(), "/OPERA/DSWx_mosaics/window", window, "/opera_utm_tiles.csv")
  merge_out <- paste0(getwd(), "/OPERA/merged/window", window, "/")
  dir.create(merge_out, recursive = TRUE, showWarnings = FALSE)
  py_run_string(sprintf('import sys; sys.argv = ["SpatialAgg_OPERA.py",
                        r"%s", r"%s", r"%s", r"%s"]',
                        opera_in, tile_in, utm_str, merge_out))
  py_run_file(script_SpatialAgg_OPERA)
}


# Clump.py ####
# Remember old directory to return to it later on
old_dir <- "/Users/lappicy/Desktop/JPL"

# Paths
script_Clump <- paste0(getwd(), "/Python codes/Clump.py")
tif_in_dir <- paste0(getwd(), "/OPERA/merged/")
voronoi_in <- paste0(getwd(), "/DSWx_out/thiessen_polygons.gpkg")
utm_str <- "21S"
clump_out <- paste0(getwd(), "/OPERA/clump/")

# Ensure output folders exist (the script expects these subfolders)
dir.create(clump_out, showWarnings = TRUE, recursive = TRUE)
dir.create(paste0(clump_out, "reclass/"), showWarnings = TRUE, recursive = TRUE)
dir.create(paste0(clump_out, "clumpedras_poly/"), showWarnings = TRUE, recursive = TRUE)

# Pass CLI args and execute
py_run_string(sprintf('import sys; sys.argv = ["Clump.py", r"%s", r"%s", r"%s", r"%s"]',
                      tif_in_dir, voronoi_in, utm_str, clump_out))
py_run_file(script_Clump)

# Return to correct wd
setwd(old_dir)


# Loop para várias janelas temporais
script_Clump <- paste0(getwd(), "/Python codes/Clump.py")
utm_str <- "21S"
voronoi_in <- paste0(getwd(), "/DSWx_out/thiessen_polygons.gpkg")
old_dir <- "/Users/lappicy/Desktop/JPL"
for(i in seq(3, 15, 2)){
  cat(paste0("Rodando i = ", i, Sys.time(), "\t"))
  window <- i
  tif_in_dir <- paste0(getwd(), "/OPERA/merged/window", window)
  clump_out <- paste0(getwd(), "/OPERA/clump/window", window, "/")
  dir.create(clump_out, recursive = T, showWarnings = F)
  dir.create(paste0(clump_out, "reclass/"), showWarnings = F, recursive = T)
  dir.create(paste0(clump_out, "clumpedras_poly/"), showWarnings = F, recursive = T)
  py_run_string(sprintf('import sys; sys.argv = ["Clump.py", r"%s", r"%s", r"%s", r"%s"]',
                        tif_in_dir, voronoi_in, utm_str, clump_out))
  py_run_file(script_Clump)
  setwd(old_dir)
}


# CreatingMainRiver.py ####
setwd("/Users/lappicy/Desktop/JPL")

# Paths
script_CreatingMainRiver <- paste0(getwd(), "/Python codes/CreatingMainRiver.py")
clump_in <- paste0(getwd(), "/OPERA/clump/")            
voronoi_in <- paste0(getwd(), "/DSWx_out/thiessen_polygons.gpkg") 
nodes_in <- paste0(getwd(), "/AOI/Chosen_nodes.gpkg")
tif_in <- paste0(getwd(), "/OPERA/merged/")
utm_str <- "21S"  
conwater_out <- paste0(getwd(), "/OPERA/connected_water/")

# Ensure output subfolders exist (the script writes here)
dir.create(conwater_out, showWarnings = TRUE, recursive = TRUE)
dir.create(file.path(conwater_out, "con_ras"),     showWarnings = TRUE, recursive = TRUE)
dir.create(file.path(conwater_out, "con_reclass"), showWarnings = TRUE, recursive = TRUE)
dir.create(file.path(conwater_out, "main_river"),  showWarnings = TRUE, recursive = TRUE)

# Wire CLI args for the Python script
py_run_string(sprintf('import sys; sys.argv = ["CreatingMainRiver_.py",
                      r"%s", r"%s", r"%s", r"%s", r"%s", r"%s"]',
                      clump_in, voronoi_in, nodes_in, tif_in, utm_str, conwater_out))
py_run_file(script_CreatingMainRiver)


# Loop para várias janelas temporais
script_CreatingMainRiver <- paste0(getwd(), "/Python codes/CreatingMainRiver.py")
voronoi_in <- paste0(getwd(), "/DSWx_out/thiessen_polygons.gpkg") 
nodes_in <- paste0(getwd(), "/AOI/Chosen_nodes.gpkg")
utm_str <- "21S"  
for(i in seq(3, 15, 2)){
  cat(paste0("Rodando i = ", i, Sys.time(), "\t"))
  window <- i
  clump_in <- paste0(getwd(), "/OPERA/clump/window", window, "/")            
  tif_in <- paste0(getwd(), "/OPERA/merged/window", window, "/")
  conwater_out <- paste0(getwd(), "/OPERA/connected_water/window", window, "/")
  dir.create(conwater_out, recursive = T, showWarnings = F)
  dir.create(file.path(conwater_out, "con_ras"),     showWarnings = F, recursive = T)
  dir.create(file.path(conwater_out, "con_reclass"), showWarnings = F, recursive = T)
  dir.create(file.path(conwater_out, "main_river"),  showWarnings = F, recursive = T)
  py_run_string(sprintf('import sys; sys.argv = ["CreatingMainRiver_.py",
                        r"%s", r"%s", r"%s", r"%s", r"%s", r"%s"]',
                        clump_in, voronoi_in, nodes_in, tif_in, utm_str, conwater_out))
  py_run_file(script_CreatingMainRiver)
}


# PixelClassSummary.py ####
# Paths
script_PixelClassSummary <- paste0(getwd(), "/Python codes/PixelClassSummary.py")
main_river_in <- paste0(getwd(), "/OPERA/connected_water/main_river")
voronoi_in <- paste0(getwd(), "/DSWx_out/thiessen_polygons.gpkg")
utm_str <- "21S"  
csv_out <- paste0(getwd(), "/OPERA/pixel_summary/")

# Create dir if inexistent
dir.create(csv_out, showWarnings = TRUE, recursive = TRUE)

# Pass CLI args to Python and execute
py_run_string(sprintf('import sys; sys.argv = ["PixelClassSummary.py",
                      r"%s", r"%s", r"%s", r"%s"]',
                      main_river_in, voronoi_in, utm_str, csv_out))
py_run_file(script_PixelClassSummary)


# Loop para várias janelas temporais
script_PixelClassSummary <- paste0(getwd(), "/Python codes/PixelClassSummary.py")
voronoi_in <- paste0(getwd(), "/DSWx_out/thiessen_polygons.gpkg")
utm_str <- "21S"  
for(i in seq(3, 15, 2)){
  cat(paste0("Rodando i = ", i, Sys.time(), "\t"))
  window <- i
  main_river_in <- paste0(getwd(), "/OPERA/connected_water/window", window, "/main_river")
  csv_out <- paste0(getwd(), "/OPERA/pixel_summary/window", window, "/")
  dir.create(csv_out, showWarnings = F, recursive = T)
  py_run_string(sprintf('import sys; sys.argv = ["PixelClassSummary.py",
                        r"%s", r"%s", r"%s", r"%s"]',
                        main_river_in, voronoi_in, utm_str, csv_out))
  py_run_file(script_PixelClassSummary)
}


# ThiessenWidthExtraction.py ####
# Paths
script_ThiessenWidthExtraction <- paste0(getwd(), "/Python codes/ThiessenWidthExtraction.py")
pixel_num_in  <- paste0(getwd(), "/OPERA/pixel_summary")   # folder with *_pixel_nums_thiessen.csv
utm_str <- "21S"  
width_out <- paste0(getwd(), "/OPERA/widths") 

# Ensure dirs exist and trailing slashes where the Python expects concatenation
dir.create(width_out, showWarnings = TRUE, recursive = TRUE)

# Pass CLI args and execute
py_run_string(sprintf('import sys; sys.argv = ["ThiessenWidthExtraction.py",
                      r"%s", r"%s", r"%s"]',
                      pixel_num_in, utm_str, width_out))
py_run_file(script_ThiessenWidthExtraction)


# Loop para várias janelas temporais
script_ThiessenWidthExtraction <- paste0(getwd(), "/Python codes/ThiessenWidthExtraction.py")
utm_str <- "21S"  
for(i in seq(3, 15, 2)){
  cat(paste0("Rodando i = ", i, Sys.time(), "\t"))
  window <- i
  pixel_num_in  <- paste0(getwd(), "/OPERA/pixel_summary/window", window) 
  width_out <- paste0(getwd(), "/OPERA/widths/window", window) 
  dir.create(width_out, showWarnings = F, recursive = T)
  py_run_string(sprintf('import sys; sys.argv = ["ThiessenWidthExtraction.py",
                        r"%s", r"%s", r"%s"]',
                        pixel_num_in, utm_str, width_out))
  py_run_file(script_ThiessenWidthExtraction)
}


# WidthAggregation.py ####
# Caminhos
script_WidthAggregation <- paste0(getwd(), "/Python codes/WidthAggregation.py")
width_in <- paste0(getwd(), "/OPERA/widths")
width_out <- paste0(getwd(), "/OPERA/widths_agg") 

# Garantir existência de diretório
dir.create(width_out, showWarnings = TRUE, recursive = TRUE)

# Passar argumentos e executar
py_run_string(sprintf('import sys; sys.argv = ["WidthAggregation.py", r"%s", r"%s"]',
                      width_in, width_out))
py_run_file(script_WidthAggregation)


# Loop para várias janelas temporais
script_WidthAggregation <- paste0(getwd(), "/Python codes/WidthAggregation.py")
for(i in seq(3, 15, 2)){
  cat(paste0("Rodando i = ", i, Sys.time(), "\t"))
  window <- i
  width_in <- paste0(getwd(), "/OPERA/widths/window", window)
  width_out <- paste0(getwd(), "/OPERA/widths_agg/window", window)  
  dir.create(width_out, showWarnings = F, recursive = T)
  py_run_string(sprintf('import sys; sys.argv = ["WidthAggregation.py", r"%s", r"%s"]',
                        width_in, width_out))
  py_run_file(script_WidthAggregation)
}
