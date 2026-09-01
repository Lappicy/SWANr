import os
import gc
import shutil
import time
import json
import tempfile
import zipfile
import glob
import uuid
import re
import warnings
from collections import OrderedDict
from flask import Flask, render_template, request, jsonify, Response, send_file, after_this_request
from werkzeug.utils import secure_filename
import earthaccess
import geopandas as gpd
import pandas as pd
from shapely.geometry import box
from shapely.ops import transform as shapely_transform
from dotenv import load_dotenv


import fiona
fiona.drvsupport.supported_drivers['KML'] = 'rw'
fiona.drvsupport.supported_drivers['LIBKML'] = 'rw'
fiona.drvsupport.supported_drivers['GPX'] = 'rw'
fiona.drvsupport.supported_drivers['GPKG'] = 'rw'

warnings.filterwarnings("ignore", message="Dataset has no geotransform.*")
warnings.filterwarnings("ignore", message=".*NotGeoreferencedWarning.*")

NETCDF_AVAILABLE = False
try:
    import xarray as xr
    import rioxarray
    NETCDF_AVAILABLE = True
except ImportError:
    print(">>> AVISO: 'xarray' ou 'rioxarray' não instalados. Recorte de NetCDF indisponível.")

app = Flask(__name__)

load_dotenv()

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DOWNLOAD_FOLDER = os.path.join(BASE_DIR, 'dados_swot')
UPLOAD_FOLDER = os.path.join(BASE_DIR, 'temp_uploads')

os.makedirs(DOWNLOAD_FOLDER, exist_ok=True)
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024

ALLOWED_UPLOAD_EXTENSIONS = {'.zip', '.gpkg', '.kml', '.kmz', '.json', '.geojson'}
ALLOWED_LAYER_NAMES = {
    'limites_BR',
    'Estacoes_hidrometeorologicas_ANA',
    'SNIRH_OttobaciaNv1',
    'SWOT_orbits_BR',
    'SWOT_tiles_BR',
}

auth = None
usuario = os.environ.get("EARTHDATA_USERNAME")
senha = os.environ.get("EARTHDATA_PASSWORD")

COLLECTIONS_BASE = {
    "PIXC": "SWOT_L2_HR_PIXC_D",
    "Raster": "SWOT_L2_HR_Raster_D"
}

MAX_GRANULE_PATTERNS = 40

_CACHE_MAX = 10
CACHE_ESTADOS = OrderedDict()
_CACHE_COL_UF = {}


def _cache_set(cache, key, value, max_size):
    if key in cache:
        cache.move_to_end(key)
    cache[key] = value
    if len(cache) > max_size:
        cache.popitem(last=False)

def _numero_3(valor):
    n = re.findall(r'\d+', str(valor))
    return n[0].zfill(3) if n else None

def _pixc_tile_codes(tile):
    txt = str(tile).strip().upper()
    n = _numero_3(txt)
    if not n:
        return []
    if re.search(r'[LR]\s*$', txt):
        return [f"{n}{txt[-1]}"]
    return [f"{n}L", f"{n}R"]

def _raster_scene_codes(tile):
    n = _numero_3(tile)
    if not n:
        return []
    tile_num = int(n)
    scenes = {
        tile_num // 2,
        (tile_num + 1) // 2
    }
    return [str(s).zfill(3) for s in sorted(scenes) if 1 <= s <= 154]

def _is_pixc_file(filename):
    return "SWOT_L2_HR_PIXC" in str(filename).upper()

def _sanitize_gpkg_column(name, used):
    base = re.sub(r'[^0-9A-Za-z_]+', '_', str(name)).strip('_') or 'var'
    base = base[:55]
    candidate = base
    idx = 2
    while candidate.lower() in used:
        suffix = f"_{idx}"
        candidate = f"{base[:55 - len(suffix)]}{suffix}"
        idx += 1
    used.add(candidate.lower())
    return candidate

def _pixc_to_geopackage(caminho, gdf_mask, mask_bounds, out_path):
    import numpy as np
    import netCDF4

    def find_coord_vars(group):
        nomes = {n.lower(): n for n in group.variables}
        lon_name = next((nomes[n] for n in ["longitude", "lon"] if n in nomes), None)
        lat_name = next((nomes[n] for n in ["latitude", "lat"] if n in nomes), None)
        return lon_name, lat_name

    with netCDF4.Dataset(caminho, "r") as nc:
        candidate_groups = []
        if "pixel_cloud" in nc.groups:
            candidate_groups.append(nc.groups["pixel_cloud"])
        candidate_groups.extend(g for name, g in nc.groups.items() if name != "pixel_cloud")
        candidate_groups.append(nc)

        group = None
        lon_name = lat_name = None
        for candidate in candidate_groups:
            lon_name, lat_name = find_coord_vars(candidate)
            if lon_name and lat_name:
                group = candidate
                break

        if group is None:
            raise ValueError("PIXC sem variaveis latitude/longitude para gerar camada georreferenciada.")

        lon_data = group.variables[lon_name][:]
        lat_data = group.variables[lat_name][:]
        if hasattr(lon_data, "filled"):
            lon_data = lon_data.filled(np.nan)
        if hasattr(lat_data, "filled"):
            lat_data = lat_data.filled(np.nan)
        lon = np.asarray(lon_data).reshape(-1)
        lat = np.asarray(lat_data).reshape(-1)
        bbox_mask = (
            np.isfinite(lon) &
            np.isfinite(lat) &
            (lon >= float(mask_bounds[0])) &
            (lon <= float(mask_bounds[2])) &
            (lat >= float(mask_bounds[1])) &
            (lat <= float(mask_bounds[3]))
        )

        if not np.any(bbox_mask):
            raise ValueError("NoDataInBounds")

        geom_mask = gdf_mask.geometry.union_all() if hasattr(gdf_mask.geometry, "union_all") else gdf_mask.geometry.unary_union
        try:
            from shapely import contains_xy
            inside = contains_xy(geom_mask, lon, lat)
        except Exception:
            try:
                from shapely.vectorized import contains
                inside = contains(geom_mask, lon, lat)
            except Exception:
                from shapely.geometry import Point
                inside = np.array([geom_mask.contains(Point(x, y)) for x, y in zip(lon, lat)])

        mask = bbox_mask & inside
        if not np.any(mask):
            raise ValueError("NoDataInBounds")

        idx = np.where(mask)[0]
        data = OrderedDict()
        data["longitude"] = lon[idx]
        data["latitude"] = lat[idx]
        used_cols = {"longitude", "latitude", "geometry"}

        for var_name, var in group.variables.items():
            if var_name in {lon_name, lat_name}:
                continue
            if len(var.dimensions) != 1 or var.shape[0] != lon.shape[0]:
                continue
            if len(data) >= 80:
                break
            arr = var[:]
            if hasattr(arr, "filled"):
                fill_value = np.nan if arr.dtype.kind in "fc" else None
                arr = arr.filled(fill_value)
            arr = np.asarray(arr).reshape(-1)[idx]
            if arr.dtype.kind not in "biufSU":
                continue
            col = _sanitize_gpkg_column(var_name, used_cols)
            data[col] = arr

        df = pd.DataFrame(data)
        gdf_pixc = gpd.GeoDataFrame(
            df,
            geometry=gpd.points_from_xy(df["longitude"], df["latitude"]),
            crs="EPSG:4326"
        )
        gdf_pixc.to_file(out_path, layer="pixel_cloud", driver="GPKG")
        return len(gdf_pixc)

def _achar_var_coord(ds, nomes):
    nomes_lower = {n.lower() for n in nomes}
    candidatos = list(ds.coords) + list(ds.data_vars)
    for nome in candidatos:
        if nome.lower() in nomes_lower:
            return nome
    for nome in candidatos:
        nome_lower = nome.lower()
        if any(n in nome_lower for n in nomes_lower):
            return nome
    return None

def _preparar_dims_rioxarray(ds):
    try:
        return ds.rio.x_dim, ds.rio.y_dim
    except Exception:
        pass

    x_dim = next((d for d in ["x", "lon", "longitude"] if d in ds.dims), None)
    y_dim = next((d for d in ["y", "lat", "latitude"] if d in ds.dims), None)

    lon_name = _achar_var_coord(ds, ["lon", "longitude"])
    lat_name = _achar_var_coord(ds, ["lat", "latitude"])
    if lon_name and lat_name:
        lon_dims = ds[lon_name].dims
        lat_dims = ds[lat_name].dims
        if len(lon_dims) == 1 and len(lat_dims) == 1:
            x_dim = x_dim or lon_dims[0]
            y_dim = y_dim or lat_dims[0]

    if x_dim and y_dim:
        return x_dim, y_dim
    return None, None

def _clip_netcdf_dataset(ds, gdf_mask, mask_bounds):
    import numpy as np

    lon_name = _achar_var_coord(ds, ["lon", "longitude"])
    lat_name = _achar_var_coord(ds, ["lat", "latitude"])

    if lon_name and lat_name:
        lon = ds[lon_name]
        lat = ds[lat_name]
        dims_comuns = [d for d in lon.dims if d in lat.dims and lon.sizes.get(d) == lat.sizes.get(d)]
        if dims_comuns:
            lon_vals = lon.values
            lat_vals = lat.values
            bbox_mask = (
                (lon_vals >= float(mask_bounds[0])) &
                (lon_vals <= float(mask_bounds[2])) &
                (lat_vals >= float(mask_bounds[1])) &
                (lat_vals <= float(mask_bounds[3]))
            )

            if not np.any(bbox_mask):
                raise ValueError("NoDataInBounds")

            geom = gdf_mask.geometry.union_all() if hasattr(gdf_mask.geometry, "union_all") else gdf_mask.geometry.unary_union
            try:
                from shapely import contains_xy
                inside = contains_xy(geom, lon_vals, lat_vals)
            except Exception:
                try:
                    from shapely.vectorized import contains
                    inside = contains(geom, lon_vals, lat_vals)
                except Exception:
                    from shapely.geometry import Point
                    inside = np.array([
                        geom.contains(Point(x, y))
                        for x, y in zip(lon_vals.ravel(), lat_vals.ravel())
                    ]).reshape(lon_vals.shape)

            mask = bbox_mask & inside
            if not np.any(mask):
                raise ValueError("NoDataInBounds")

            mask_da = xr.DataArray(
                mask,
                dims=lon.dims,
                coords={d: lon.coords[d] for d in lon.dims if d in lon.coords}
            )
            dims_ponto = set(lon.dims)
            recortaveis = [
                var for var in ds.data_vars
                if set(ds[var].dims).issubset(dims_ponto) and len(ds[var].dims) > 0
            ]
            auxiliares = [
                var for var in ds.data_vars
                if var not in recortaveis and len(ds[var].dims) == 0
            ]
            if lon_name in ds.data_vars and lon_name not in recortaveis:
                recortaveis.append(lon_name)
            if lat_name in ds.data_vars and lat_name not in recortaveis:
                recortaveis.append(lat_name)

            partes = []
            if recortaveis:
                if len(lon.dims) == 1:
                    ponto_dim = lon.dims[0]
                    idx = np.where(mask)[0]
                    partes.append(ds[recortaveis].isel({ponto_dim: idx}))
                else:
                    partes.append(ds[recortaveis].where(mask_da, drop=True))
            if auxiliares:
                partes.append(ds[auxiliares])
            if not partes:
                raise ValueError("NetCDF sem variaveis recortaveis.")
            return xr.merge(partes, compat="override")

    x_dim, y_dim = _preparar_dims_rioxarray(ds)
    if x_dim and y_dim:
        ds = ds.rio.set_spatial_dims(x_dim=x_dim, y_dim=y_dim, inplace=False)
        if ds.rio.crs is None:
            ds = ds.rio.write_crs("EPSG:4326")

        dims_espaciais = {x_dim, y_dim}
        vars_espaciais = [
            var for var in ds.data_vars
            if dims_espaciais.issubset(set(ds[var].dims))
        ]
        vars_auxiliares = [var for var in ds.data_vars if var not in vars_espaciais]
        ds_espacial = ds[vars_espaciais] if vars_espaciais else ds

        try:
            ds_espacial = ds_espacial.rio.clip_box(
                minx=float(mask_bounds[0]),
                miny=float(mask_bounds[1]),
                maxx=float(mask_bounds[2]),
                maxy=float(mask_bounds[3])
            )
        except Exception:
            pass

        clipped = ds_espacial.rio.clip(
            gdf_mask.geometry.values,
            gdf_mask.crs,
            drop=True,
            all_touched=True
        )

        for var in vars_auxiliares:
            try:
                clipped[var] = ds[var]
            except Exception:
                pass
        return clipped

    if lon_name and lat_name:
        raise ValueError("Longitude/latitude existem, mas nao compartilham uma dimensao recortavel.")
    raise ValueError("Nao encontrei variaveis de longitude/latitude no NetCDF.")

def _listar_grupos_netcdf(caminho):
    try:
        import netCDF4
    except Exception:
        return []

    grupos = []

    def visitar(grupo, prefixo=""):
        for nome, subgrupo in grupo.groups.items():
            caminho_grupo = f"{prefixo}/{nome}" if prefixo else nome
            grupos.append(caminho_grupo)
            visitar(subgrupo, caminho_grupo)

    with netCDF4.Dataset(caminho, "r") as nc:
        visitar(nc)
    return grupos

def _clip_netcdf_file(caminho, gdf_mask, mask_bounds):
    erros = []
    grupos = [None] + _listar_grupos_netcdf(caminho)

    for grupo in grupos:
        try:
            kwargs = {"decode_coords": "all"}
            if grupo:
                kwargs["group"] = grupo
            with xr.open_dataset(caminho, **kwargs) as ds:
                clipped = _clip_netcdf_dataset(ds, gdf_mask, mask_bounds)
                clipped.attrs["swot_source_group"] = grupo or "/"
                return clipped.load()
        except Exception as e:
            erros.append(f"{grupo or '/'}: {type(e).__name__}: {e}")
            if "NoDataInBounds" in str(type(e)) or "NoDataInBounds" in str(e) or "No data found" in str(e):
                continue

    if erros:
        raise ValueError("Nao foi possivel recortar nenhum grupo NetCDF. " + " | ".join(erros[:6]))
    raise ValueError("NetCDF sem grupos ou variaveis recortaveis.")

def _restaurar_metadados_espaciais_netcdf(ds):
    if "crs" not in ds.variables:
        return ds

    if "crs" in ds.coords and "crs" not in ds.dims:
        try:
            ds = ds.reset_coords("crs")
        except Exception:
            pass

    lon_name = _achar_var_coord(ds, ["lon", "longitude"])
    lat_name = _achar_var_coord(ds, ["lat", "latitude"])
    x_dim, y_dim = _preparar_dims_rioxarray(ds)
    coords_attr = " ".join(n for n in [lon_name, lat_name] if n)

    for var in list(ds.data_vars):
        if var in {"crs", lon_name, lat_name}:
            continue

        dims = set(ds[var].dims)
        eh_raster_xy = bool(x_dim and y_dim and {x_dim, y_dim}.issubset(dims))
        eh_raster_lonlat = bool(
            lon_name and lat_name and
            set(ds[lon_name].dims).issubset(dims) and
            set(ds[lat_name].dims).issubset(dims)
        )
        if not (eh_raster_xy or eh_raster_lonlat):
            continue

        ds[var].attrs["grid_mapping"] = "crs"
        if coords_attr:
            ds[var].attrs.pop("coordinates", None)
            ds[var].encoding["coordinates"] = coords_attr
        else:
            ds[var].encoding.pop("coordinates", None)

    return ds

def remover_z(geom):
    return shapely_transform(lambda x, y, *_: (x, y), geom)

def _is_allowed_upload(filename):
    return os.path.splitext(filename)[1].lower() in ALLOWED_UPLOAD_EXTENSIONS

def _unique_upload_name(filename):
    safe_name = secure_filename(filename)
    stem, ext = os.path.splitext(safe_name)
    stem = stem or 'upload'
    return f"{stem[:80]}_{uuid.uuid4().hex[:10]}{ext.lower()}"

def _safe_extract_zip(zip_file, destination):
    dest_abs = os.path.abspath(destination)
    for member in zip_file.infolist():
        member_path = os.path.abspath(os.path.join(dest_abs, member.filename))
        if not member_path.startswith(dest_abs + os.sep):
            raise ValueError("Arquivo compactado contem caminho invalido.")
    zip_file.extractall(dest_abs)

def get_earthdata_auth():
    global auth
    if auth:
        return auth
    if not usuario or not senha:
        return None
    try:
        auth = earthaccess.login(strategy="environment", persist=True)
        return auth
    except Exception as e:
        print(f">>> Erro no Login Earthdata: {e}")
        return None

def _detectar_col_uf(caminho_arquivo, uf_alvo):
    if caminho_arquivo in _CACHE_COL_UF:
        return _CACHE_COL_UF[caminho_arquivo]

    col = None
    try:
        with fiona.open(caminho_arquivo) as src:
            props = list(src.schema['properties'].keys())

        candidatos = ['SIGLA_UF', 'SIGLA', 'UF', 'CD_UF', 'ABBREV_STATE', 'sigla_uf', 'uf']
        for c in candidatos:
            if c in props:
                col = c
                break

        if col is None:
            amostra = gpd.read_file(caminho_arquivo, rows=1)
            for c in amostra.columns:
                if amostra[c].astype(str).str.upper().isin([uf_alvo.upper()]).any():
                    col = c
                    break
    except Exception as e:
        print(f"[AVISO] _detectar_col_uf: {e}")

    _CACHE_COL_UF[caminho_arquivo] = col
    return col


def carregar_geodataframe(caminho_arquivo):
    abs_path = os.path.abspath(caminho_arquivo).replace('\\', '/')
    ext = os.path.splitext(caminho_arquivo)[1].lower()
    temp_dir = None

    try:
        if ext == '.zip':
            try:
                return gpd.read_file(f"zip:///{abs_path}"), None
            except Exception:
                pass 
        
        if ext in ['.zip', '.kmz']:
            temp_dir = tempfile.mkdtemp()
            with zipfile.ZipFile(caminho_arquivo, 'r') as z:
                _safe_extract_zip(z, temp_dir)

            for padrao in ["**/*.shp", "**/*.kml", "**/*.gpkg", "**/*.geojson"]:
                encontrados = glob.glob(os.path.join(temp_dir, padrao), recursive=True)
                if encontrados:
                    return gpd.read_file(encontrados[0]), temp_dir

            raise Exception("Nenhum arquivo de mapa valido encontrado.")
        else:
            return gpd.read_file(abs_path), None
    except Exception as e:
        if temp_dir and os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)
        raise e


def _carregar_estado_gpkg(uf):
    caminhos_possiveis = [
        os.path.join(BASE_DIR, 'camadas', 'BR_UF_2024.shp'),
        os.path.join(BASE_DIR, 'camadas', 'BR_Estados.gpkg'),
        os.path.join(BASE_DIR, 'camadas', 'BR_Estados.geojson'),
        os.path.join(BASE_DIR, 'camadas', 'BR_Estados.shp'),
    ]
    arq = next((p for p in caminhos_possiveis if os.path.exists(p)), None)
    if not arq:
        return None, "Arquivo de estados nao encontrado."

    col = _detectar_col_uf(arq, uf)
    if col is None:
        return None, f"Coluna UF nao detectada em {arq}."

    try:
        gdf = gpd.read_file(arq, where=f"{col} = '{uf.upper()}'")
        if gdf.empty:
            gdf = gpd.read_file(arq, where=f"UPPER({col}) = '{uf.upper()}'")
        return gdf, None
    except Exception as e:
        gdf_f = gpd.read_file(arq)
        resultado = gdf_f[gdf_f[col].astype(str).str.strip().str.upper() == uf.upper()].copy()
        del gdf_f
        gc.collect()
        return resultado, None


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/upload_user_shape', methods=['POST'])
def upload_user_shape():
    if 'file' not in request.files:
        return jsonify({'error': 'Arquivo nao enviado.'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'Nome do arquivo vazio.'}), 400

    filename = secure_filename(file.filename)
    if filename.lower().endswith('.shp'):
        return jsonify({'error': 'Um arquivo .shp nao funciona sozinho! '
                        'Por favor, compacte todos os arquivos do shapefile em um arquivo .ZIP e faca o upload.'}), 400
    if not _is_allowed_upload(filename):
        return jsonify({'error': 'Formato nao permitido. Use .zip, .gpkg, .kml, .kmz, .json ou .geojson.'}), 400

    filename = _unique_upload_name(filename)
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    file.save(filepath)

    temp_dir = None
    gdf = None
    try:
        gdf, temp_dir = carregar_geodataframe(filepath)

        if gdf.crs is None:
            gdf.set_crs(epsg=4326, inplace=True)
        else:
            gdf = gdf.to_crs("EPSG:4326")

        if not gdf.empty:
            if gdf.has_z.any():
                gdf.geometry = gdf.geometry.map(remover_z)
            gdf.geometry = gdf.geometry.make_valid()

        bounds = list(gdf.total_bounds)
        geojson_str = gdf.to_json()

        return jsonify({
            'message': 'Sucesso',
            'filename': filename,
            'bbox': bounds,
            'geojson': geojson_str
        })
    except Exception as e:
        return jsonify({'error': f"Erro ao ler arquivo: {str(e)}"}), 500
    finally:
        if temp_dir and os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)
        del gdf
        gc.collect()


@app.route('/limites/estado/<uf_sigla>')
def get_estado_limits(uf_sigla):
    uf = uf_sigla.upper()
    if uf == 'BR':
        return jsonify({"bbox": [-73.99, -33.75, -28.84, 5.27], "geojson": None})

    if uf in CACHE_ESTADOS:
        CACHE_ESTADOS.move_to_end(uf)
        return jsonify(CACHE_ESTADOS[uf])

    gdf_estado = None
    try:
        gdf_estado, erro = _carregar_estado_gpkg(uf)
        if erro or gdf_estado is None or gdf_estado.empty:
            return jsonify({"error": erro or f"Estado {uf} nao encontrado."}), 404

        if gdf_estado.crs and gdf_estado.crs.to_string() != "EPSG:4326":
            gdf_estado = gdf_estado.to_crs("EPSG:4326")

        bounds = gdf_estado.total_bounds
        geojson_data = json.loads(gdf_estado.to_json())

        res = {"bbox": [bounds[0], bounds[1], bounds[2], bounds[3]], "geojson": geojson_data}
        _cache_set(CACHE_ESTADOS, uf, res, _CACHE_MAX)
        return jsonify(res)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        del gdf_estado
        gc.collect()


@app.route('/camadas/<nome_camada>')
def get_camada(nome_camada):
    gdf = None
    try:
        if nome_camada not in ALLOWED_LAYER_NAMES:
            return jsonify({"error": "Camada nao permitida."}), 404

        nome_arquivo = f"{nome_camada}.gpkg"
        caminho_arquivo = os.path.join(BASE_DIR, 'camadas', nome_arquivo)
        if not os.path.exists(caminho_arquivo):
            return jsonify({"error": "Camada nao encontrada."}), 404

        gdf = gpd.read_file(caminho_arquivo)
        for col in gdf.columns:
            if pd.api.types.is_datetime64_any_dtype(gdf[col]):
                gdf[col] = gdf[col].astype(str)

        if gdf.crs and gdf.crs.to_string() != "EPSG:4326":
            gdf = gdf.to_crs("EPSG:4326")
        resp = Response(gdf.to_json(), mimetype='application/json')
        return resp
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        del gdf
        gc.collect()


@app.route('/buscar_dados', methods=['POST'])
def buscar_dados():
    gdf_mask = None
    gdf_tiles = None
    inter = None
    try:
        d = request.json
        prod = d.get('produto')
        start_date = d.get('start_date')
        end_date = d.get('end_date')

        if not start_date or not end_date:
            return jsonify({"status": "error", "message": "Selecione o periodo."}), 400

        short_name = ""
        subproduto_str = ""
        if prod == 'RiverSP':
            short_name, subproduto_str = "SWOT_L2_HR_RiverSP_D", d.get('subproduto', '')
        elif prod == 'LakeSP':
            short_name, subproduto_str = "SWOT_L2_HR_LakeSP_D", d.get('subproduto', '')
        elif prod in COLLECTIONS_BASE:
            short_name = COLLECTIONS_BASE[prod]
            if prod == 'Raster':
                subproduto_str = d.get('resolucao', '')
        else:
            return jsonify({"status": "error", "message": "Produto invalido"}), 400

        cycle_val = str(d.get('cycle', '')).strip().zfill(3) if str(d.get('cycle', '')).strip() else "*"
        pass_val = str(d.get('pass', '')).strip().zfill(3) if str(d.get('pass', '')).strip() else "*"
        tile_val = str(d.get('tile', '')).strip() if str(d.get('tile', '')).strip() else "*"
        cont_val = d.get('continente') if d.get('continente') else "SA"

        mask_name = d.get('shape_filename')
        state_uf = d.get('state_uf')

        bbox_geom = None
        if d.get('lon_min') and str(d.get('lon_min')).strip() != "":
            try:
                bbox_geom = box(float(d['lon_min']), float(d['lat_min']),
                                float(d['lon_max']), float(d['lat_max']))
            except Exception:
                pass

        passes_encontrados, tiles_encontrados, usou_smart_filter = [], [], False

        if (bbox_geom or mask_name or state_uf) and pass_val == "*" and tile_val == "*":
            try:
                if mask_name:
                    mask_path = os.path.join(app.config['UPLOAD_FOLDER'], mask_name)
                    if os.path.exists(mask_path):
                        gdf_mask, _ = carregar_geodataframe(mask_path)
                elif state_uf and state_uf != 'BR':
                    gdf_mask, erro = _carregar_estado_gpkg(state_uf)
                    if erro:
                        gdf_mask = None

                if gdf_mask is None or gdf_mask.empty:
                    if bbox_geom:
                        gdf_mask = gpd.GeoDataFrame(geometry=[bbox_geom], crs="EPSG:4326")
                    else:
                        raise Exception("Sem geometria valida para o smart filter.")
                else:
                    if gdf_mask.crs is None:
                        gdf_mask.set_crs(epsg=4326, inplace=True)
                    else:
                        gdf_mask = gdf_mask.to_crs("EPSG:4326")
                    gdf_mask = gdf_mask[['geometry']].dissolve()
                    gdf_mask['geometry'] = gdf_mask['geometry'].make_valid()

                caminho_tiles = os.path.join(BASE_DIR, 'camadas', 'SWOT_tiles_BR.gpkg')
                if os.path.exists(caminho_tiles):
                    gdf_tiles = gpd.read_file(caminho_tiles, bbox=tuple(gdf_mask.total_bounds))
                    if not gdf_tiles.empty:
                        if gdf_tiles.crs and gdf_tiles.crs.to_string() != "EPSG:4326":
                            gdf_tiles = gdf_tiles.to_crs("EPSG:4326")

                        inter = gpd.sjoin(gdf_tiles, gdf_mask, how="inner", predicate="intersects")
                        if not inter.empty:
                            usou_smart_filter = True
                            p_col = next((c for c in inter.columns if 'pass' in c.lower()), None)
                            t_col = next((c for c in inter.columns if 'tile' in c.lower()), None)

                            if prod in ['RiverSP', 'LakeSP'] and p_col:
                                for p in inter[p_col].astype(str):
                                    n = re.findall(r'\d+', p)
                                    if n:
                                        passes_encontrados.append(n[0].zfill(3))
                                passes_encontrados = list(set(passes_encontrados))
                            elif prod in ['PIXC', 'Raster'] and t_col:
                                if p_col:
                                    for _, row in inter.iterrows():
                                        p = _numero_3(row[p_col])
                                        if p and str(row[t_col]):
                                            tiles_encontrados.append((p, str(row[t_col])))
                                    tiles_encontrados = list(set(tiles_encontrados))
                                else:
                                    tiles_encontrados = inter[t_col].astype(str).unique().tolist()
                        else:
                            usou_smart_filter = False
                    else:
                        usou_smart_filter = False
                else:
                    usou_smart_filter = False

            except Exception:
                usou_smart_filter = False
            finally:
                del gdf_tiles, inter
                gc.collect()

        patterns = []
        sub = subproduto_str if subproduto_str else "*"

        if usou_smart_filter:
            if prod in ['RiverSP', 'LakeSP']:
                if not passes_encontrados:
                    usou_smart_filter = False
                else:
                    for p in passes_encontrados:
                        patterns.append(f"*_{sub}_{cycle_val}_{p}_{cont_val}_*".replace("**", "*"))

            elif prod in ['PIXC', 'Raster']:
                if not tiles_encontrados:
                    usou_smart_filter = False
                else:
                    for t in tiles_encontrados:
                        if isinstance(t, tuple):
                            if prod == 'Raster':
                                for scene in _raster_scene_codes(t[1]):
                                    patterns.append(f"*_{sub}_*_{cycle_val}_{t[0]}_{scene}*".replace("**", "*"))
                            else:
                                for tile in _pixc_tile_codes(t[1]):
                                    patterns.append(f"*_{cycle_val}_{t[0]}_{tile}*".replace("**", "*"))
                        else:
                            if prod == 'Raster':
                                for scene in _raster_scene_codes(t):
                                    patterns.append(f"*_{sub}_*_{cycle_val}_{pass_val}_{scene}*".replace("**", "*"))
                            else:
                                for tile in _pixc_tile_codes(t):
                                    patterns.append(f"*_{cycle_val}_{pass_val}_{tile}*".replace("**", "*"))

        if not usou_smart_filter:
            if prod in ['RiverSP', 'LakeSP']:
                patterns.append(f"*_{sub}_{cycle_val}_{pass_val}_{cont_val}_*".replace("**", "*"))
            elif prod == 'Raster':
                scene_codes = _raster_scene_codes(tile_val) if tile_val != "*" else ["*"]
                for scene in scene_codes:
                    patterns.append(f"*_{sub}_*_{cycle_val}_{pass_val}_{scene}*".replace("**", "*"))
            elif prod == 'PIXC':
                tile_codes = _pixc_tile_codes(tile_val) if tile_val != "*" else ["*"]
                for tile in tile_codes:
                    patterns.append(f"*_{cycle_val}_{pass_val}_{tile}*".replace("**", "*"))

        patterns = list(OrderedDict.fromkeys(patterns))
        if len(patterns) > MAX_GRANULE_PATTERNS:
            patterns = []

        base_kwargs = {
            "short_name": short_name,
            "temporal": (f"{start_date}T00:00:00", f"{end_date}T23:59:59"),
            "count": 500
        }

        if not patterns and subproduto_str:
            base_kwargs["granule_name"] = f"*_{subproduto_str}_*"

        if bbox_geom:
            base_kwargs["bounding_box"] = (
                float(d['lon_min']), float(d['lat_min']),
                float(d['lon_max']), float(d['lat_max'])
            )
        elif gdf_mask is not None and not gdf_mask.empty:
            try:
                b = gdf_mask.total_bounds
                base_kwargs["bounding_box"] = (b[0], b[1], b[2], b[3])
            except Exception:
                pass

        results = []
        if patterns:
            for pat in patterns:
                sk = base_kwargs.copy()
                sk["granule_name"] = pat
                for attempt in range(3):
                    try:
                        results.extend(earthaccess.search_data(**sk))
                        break
                    except Exception:
                        time.sleep(1)
        else:
            for attempt in range(3):
                try:
                    results.extend(earthaccess.search_data(**base_kwargs))
                    break
                except Exception:
                    time.sleep(1)

        fmt_dict = {}
        for r in results:
            try:
                meta = r['meta']
                fn = meta.get('native-id', meta.get('producer-granule-id', 'unknown'))
                if fn not in fmt_dict:
                    sz = r.size() if r.size() else 0
                    fmt_dict[fn] = {
                        "filename": fn,
                        "size": f"{round(sz, 2)}",
                        "download_link": r.data_links(access="external")[0]
                    }
            except Exception:
                pass

        del results
        gc.collect()

        return jsonify({"status": "success", "results": list(fmt_dict.values())})

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500
    finally:
        del gdf_mask
        gc.collect()


@app.route('/baixar_selecionados', methods=['POST'])
def baixar_selecionados():
    try:
        current_auth = get_earthdata_auth()
        if not current_auth:
            return jsonify({"status": "error", "message": "Falha no login da NASA."}), 500
        data = request.json
        links = data.get('arquivos', [])
        session = current_auth.get_session()
        sucessos = 0
        erros = []
        for link in links:
            try:
                filepath = os.path.join(DOWNLOAD_FOLDER, link.split('/')[-1])
                with session.get(link, stream=True) as r:
                    r.raise_for_status()
                    with open(filepath, 'wb') as f:
                        shutil.copyfileobj(r.raw, f)
                sucessos += 1
            except Exception as e:
                erros.append(link.split('/')[-1])

        msg = f"Download concluido: {sucessos} arquivo(s)."
        if erros:
            msg += f" Falha em {len(erros)}: {', '.join(erros)}"
        return jsonify({"status": "success", "message": msg})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/download_cropped', methods=['POST'])
def download_cropped():
    try:
        agora = time.time()
        for item in os.listdir(app.config['UPLOAD_FOLDER']):
            caminho_item = os.path.join(app.config['UPLOAD_FOLDER'], item)
            idade_segundos = agora - os.path.getmtime(caminho_item)
            if (item.startswith('res_') and idade_segundos > 120) or (idade_segundos > 7200):
                if os.path.isfile(caminho_item):
                    try: os.remove(caminho_item)
                    except: pass
                elif os.path.isdir(caminho_item):
                    shutil.rmtree(caminho_item, ignore_errors=True)
    except Exception:
        pass

    d = request.json
    url = d.get('granule_url')
    mask_name = d.get('shape_filename')
    state_uf = d.get('state_uf')
    lon_min, lat_min, lon_max, lat_max = d.get('lon_min'), d.get('lat_min'), d.get('lon_max'), d.get('lat_max')
    has_bbox = all(v is not None and str(v).strip() != "" for v in [lon_min, lat_min, lon_max, lat_max])

    if not url or (not mask_name and not state_uf and not has_bbox):
        return jsonify({'error': 'Dados incompletos.'}), 400
    current_auth = get_earthdata_auth()
    if not current_auth:
        return jsonify({'error': 'Falha no login NASA.'}), 500

    tmp_mask_dir = None
    tmpdirname = None
    gdf_mask = None
    try:
        if mask_name:
            mask_path = os.path.join(app.config['UPLOAD_FOLDER'], mask_name)
            gdf_mask, tmp_mask_dir = carregar_geodataframe(mask_path)
        elif state_uf and state_uf != 'BR':
            gdf_mask, erro = _carregar_estado_gpkg(state_uf)
            if erro:
                return jsonify({"error": erro}), 400
        elif has_bbox:
            gdf_mask = gpd.GeoDataFrame(
                geometry=[box(float(lon_min), float(lat_min), float(lon_max), float(lat_max))],
                crs="EPSG:4326"
            )

        if gdf_mask is None or gdf_mask.empty:
            return jsonify({"error": "Mascara invalida."}), 400

        if gdf_mask.crs is None:
            gdf_mask.set_crs(epsg=4326, inplace=True)
        else:
            gdf_mask = gdf_mask.to_crs("EPSG:4326")
        gdf_mask.geometry = gdf_mask.geometry.make_valid()

        mask_bounds = gdf_mask.total_bounds

        session = current_auth.get_session()
        tmpdirname = tempfile.mkdtemp(dir=app.config['UPLOAD_FOLDER'])
        
        real_filename = url.split('/')[-1]
        ext_orig = os.path.splitext(real_filename)[1].lower()
        short_input = os.path.join(tmpdirname, f"in{ext_orig}")

        sucesso_download = False
        for tentativa in range(4): 
            try:
                with session.get(url, stream=True, timeout=90) as r:
                    r.raise_for_status()
                    with open(short_input, 'wb') as f:
                        shutil.copyfileobj(r.raw, f)
                sucesso_download = True
                break
            except Exception as e:
                print(f"[AVISO] Gargalo de Rede/NASA (Tentativa {tentativa+1}/4)")
                time.sleep(2) 
        
        if not sucesso_download:
            return jsonify({'error': 'A NASA recusou a conexão após múltiplas tentativas. Tente selecionar menos arquivos por vez.'}), 502

        path_final = os.path.join(app.config['UPLOAD_FOLDER'], f"res_{uuid.uuid4().hex}")
        mimetype = "application/octet-stream"
        d_name = f"recortado_{real_filename}"

        if ext_orig == '.zip':
            extract_path = os.path.join(tmpdirname, "x")
            with zipfile.ZipFile(short_input, 'r') as z:
                _safe_extract_zip(z, extract_path)
            shps = glob.glob(os.path.join(extract_path, "**/*.shp"), recursive=True)
            if not shps:
                return jsonify({'error': 'ZIP sem Shapefile.'}), 400

            gdf_data = gpd.read_file(shps[0])
            if gdf_data.crs != gdf_mask.crs:
                gdf_data = gdf_data.to_crs(gdf_mask.crs)
            gdf_data.geometry = gdf_data.geometry.make_valid()
            try:
                clipped = gpd.clip(gdf_data, gdf_mask)
            except Exception:
                return jsonify({'error': 'Erro geometrico no recorte.'}), 400
            finally:
                del gdf_data
                gc.collect()

            if clipped.empty:
                return jsonify({'status': 'no_data', 'message': 'Sem dados na area de interesse.'})
            out_shp_dir = os.path.join(tmpdirname, "out")
            os.makedirs(out_shp_dir, exist_ok=True)
            clipped.to_file(os.path.join(out_shp_dir, "data.shp"), driver='ESRI Shapefile')
            del clipped
            gc.collect()

            shutil.make_archive(path_final, 'zip', out_shp_dir)
            path_final += ".zip"
            mimetype = 'application/zip'
            if d_name.endswith('.zip.zip'):
                d_name = d_name[:-4]

        elif ext_orig == '.nc':
            if not NETCDF_AVAILABLE:
                return jsonify({'error': 'NetCDF libs ausentes (xarray/rioxarray).'}), 500

            if _is_pixc_file(real_filename):
                pixc_out_dir = os.path.join(tmpdirname, "pixc_out")
                os.makedirs(pixc_out_dir, exist_ok=True)
                original_path = os.path.join(pixc_out_dir, real_filename)
                gpkg_name = f"{os.path.splitext(real_filename)[0]}_pixel_cloud_EPSG4326.gpkg"
                gpkg_path = os.path.join(pixc_out_dir, gpkg_name)

                shutil.copyfile(short_input, original_path)
                qtd_pixc = _pixc_to_geopackage(short_input, gdf_mask, mask_bounds, gpkg_path)

                readme_path = os.path.join(pixc_out_dir, "LEIA_ME_PIXC.txt")
                with open(readme_path, "w", encoding="utf-8") as f:
                    f.write(
                        "PIXC SWOT mantido em NetCDF original e convertido para camada GIS.\n"
                        f"- {real_filename}: arquivo original da NASA, com grupos/metadados preservados.\n"
                        f"- {gpkg_name}: pixel_cloud em pontos georreferenciados, CRS EPSG:4326.\n"
                        f"- Pontos na area de interesse: {qtd_pixc}\n"
                    )

                zip_base = path_final
                shutil.make_archive(zip_base, 'zip', pixc_out_dir)
                path_final = zip_base + ".zip"
                mimetype = 'application/zip'
                d_name = f"recorte_{os.path.splitext(real_filename)[0]}_PIXC.zip"
                print(">>> PIXC empacotado com NetCDF original e GeoPackage EPSG:4326.")
            
            else:
                try:
                    clipped = _clip_netcdf_file(short_input, gdf_mask, mask_bounds)
                    clipped = _restaurar_metadados_espaciais_netcdf(clipped)

                    for var in clipped.variables:
                        if clipped[var].dtype.kind in ['M', 'm']:
                            clipped[var].encoding.pop('_FillValue', None)
                            clipped[var].attrs.pop('_FillValue', None)
                            clipped[var].encoding.pop('missing_value', None)
                            clipped[var].attrs.pop('missing_value', None)
                            try:
                                clipped[var].rio.write_nodata(None, encoded=True, inplace=True)
                                clipped[var].rio.write_nodata(None, inplace=True)
                            except Exception:
                                pass

                    path_final += ".nc"
                    clipped.to_netcdf(path_final)
                    mimetype = 'application/x-netcdf'

                    del clipped
                    gc.collect()

                except Exception as e:
                    err_str = str(e)
                    err_type = str(type(e))
                    if "NoDataInBounds" in err_type or "NoDataInBounds" in err_str or "No data found" in err_str:
                        return jsonify({'status': 'no_data', 'message': 'Sem dados validos na area de interesse.'})
                    else:
                        print(f">>> Erro no recorte NetCDF: {err_type} - {err_str}")
                        return jsonify({'status': 'error', 'message': f'Erro no recorte NetCDF: {err_str}'}), 500

        else:
            gdf_data = gpd.read_file(short_input)
            if gdf_data.crs != gdf_mask.crs:
                gdf_data = gdf_data.to_crs(gdf_mask.crs)
            gdf_data.geometry = gdf_data.geometry.make_valid()
            clipped = gpd.clip(gdf_data, gdf_mask)
            del gdf_data
            gc.collect()

            if clipped.empty:
                return jsonify({'status': 'no_data', 'message': 'Sem dados na area de interesse.'})
            path_final += ext_orig
            driv = 'GeoJSON'
            if ext_orig == '.gpkg':
                driv = 'GPKG'
            elif ext_orig == '.kml':
                driv = 'KML'
            clipped.to_file(path_final, driver=driv)
            del clipped
            gc.collect()

        @after_this_request
        def cleanup_response_file(response):
            try:
                os.remove(path_final)
            except Exception:
                pass
            return response

        return send_file(
            path_final,
            as_attachment=True,
            download_name=d_name,
            mimetype=mimetype
        )

    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        if tmp_mask_dir and os.path.exists(tmp_mask_dir):
            shutil.rmtree(tmp_mask_dir, ignore_errors=True)
        
        if 'tmpdirname' in locals() and tmpdirname and os.path.exists(tmpdirname):
            shutil.rmtree(tmpdirname, ignore_errors=True)
            
        del gdf_mask
        gc.collect()


if __name__ == '__main__':
    port = int(os.environ.get('PORT', '5050'))
    app.run(host='127.0.0.1', port=port, debug=True, use_reloader=False)
