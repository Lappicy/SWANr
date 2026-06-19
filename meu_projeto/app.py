import os
import shutil
import time
import requests
import json
import tempfile
import zipfile
import glob
import uuid
import traceback
import re
from flask import Flask, render_template, request, jsonify, Response, send_file, after_this_request
from werkzeug.utils import secure_filename
import earthaccess
import geopandas as gpd
import pandas as pd
from shapely.geometry import shape, box
from dotenv import load_dotenv

import fiona
fiona.drvsupport.supported_drivers['KML'] = 'rw'
fiona.drvsupport.supported_drivers['LIBKML'] = 'rw'
fiona.drvsupport.supported_drivers['GPX'] = 'rw'
fiona.drvsupport.supported_drivers['GPKG'] = 'rw'

NETCDF_AVAILABLE = False
try:
    import xarray as xr
    import rioxarray
    NETCDF_AVAILABLE = True
except ImportError:
    pass

app = Flask(__name__)
load_dotenv()

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DOWNLOAD_FOLDER = os.path.join(BASE_DIR, 'dados_swot')
UPLOAD_FOLDER = os.path.join(BASE_DIR, 'temp_uploads')

os.makedirs(DOWNLOAD_FOLDER, exist_ok=True)
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

auth = None 
usuario = os.environ.get("EARTHDATA_USERNAME")
senha = os.environ.get("EARTHDATA_PASSWORD")

if usuario and senha:
    try:
        auth = earthaccess.login(strategy="environment", persist=True)
    except Exception as e:
        print(f"Erro Login: {e}")

COLLECTIONS_BASE = {
    "PIXC": "SWOT_L2_HR_PIXC_D",
    "Raster": "SWOT_L2_HR_Raster_D"
}

CACHE_ESTADOS = {}

def carregar_geodataframe(caminho_arquivo):
    abs_path = os.path.abspath(caminho_arquivo).replace('\\', '/')
    ext = os.path.splitext(caminho_arquivo)[1].lower()
    temp_dir = None

    try:
        if ext in ['.zip', '.kmz']:
            try:
                return gpd.read_file(f"zip:///{abs_path}"), None
            except:
                temp_dir = tempfile.mkdtemp()
                with zipfile.ZipFile(caminho_arquivo, 'r') as z:
                    z.extractall(temp_dir)
                
                for padrao in ["**/*.shp", "**/*.kml", "**/*.gpkg", "**/*.geojson"]:
                    encontrados = glob.glob(os.path.join(temp_dir, padrao), recursive=True)
                    if encontrados:
                        return gpd.read_file(encontrados[0]), temp_dir
                
                raise Exception("Nenhum arquivo válido no ZIP.")
        else:
            return gpd.read_file(abs_path), None
    except Exception as e:
        if temp_dir and os.path.exists(temp_dir): shutil.rmtree(temp_dir)
        raise e

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/upload_user_shape', methods=['POST'])
def upload_user_shape():
    if 'file' not in request.files: return jsonify({'error': 'Arquivo não enviado.'}), 400
    file = request.files['file']
    if file.filename == '': return jsonify({'error': 'Nome do arquivo vazio.'}), 400

    filename = secure_filename(file.filename)
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    file.save(filepath)

    temp_dir = None
    try:
        gdf, temp_dir = carregar_geodataframe(filepath)
        if gdf.crs is None: gdf.set_crs(epsg=4326, inplace=True)
        else: gdf = gdf.to_crs("EPSG:4326")
        
        if not gdf.empty:
            if gdf.has_z.any(): gdf.geometry = gdf.geometry.map(lambda g: shape(g).simplify(0))
            gdf.geometry = gdf.geometry.make_valid()

        return jsonify({'message': 'Sucesso', 'filename': filename, 'bbox': list(gdf.total_bounds), 'geojson': gdf.to_json()})
    except Exception as e: return jsonify({'error': str(e)}), 500
    finally:
        if temp_dir and os.path.exists(temp_dir): shutil.rmtree(temp_dir)

@app.route('/limites/estado/<uf_sigla>')
def get_estado_limits(uf_sigla):
    uf = uf_sigla.upper()
    if uf == 'BR': return jsonify({"bbox": [-73.99, -33.75, -28.84, 5.27], "geojson": None})
    if uf in CACHE_ESTADOS: return jsonify(CACHE_ESTADOS[uf])

    try:
        caminhos_possiveis = [
            os.path.join(BASE_DIR, 'camadas', 'BR_UF_2024.shp'), 
            os.path.join(BASE_DIR, 'camadas', 'BR_Estados.gpkg'),
            os.path.join(BASE_DIR, 'camadas', 'BR_Estados.geojson'),
            os.path.join(BASE_DIR, 'camadas', 'BR_Estados.shp')
        ]
        caminho_arquivo = next((cp for cp in caminhos_possiveis if os.path.exists(cp)), None)
        if not caminho_arquivo: return jsonify({"error": "Arquivo não encontrado."}), 404

        gdf = gpd.read_file(caminho_arquivo)
        coluna_uf = next((c for c in gdf.columns if gdf[c].astype(str).str.strip().str.upper().eq(uf).any()), None)

        if not coluna_uf: return jsonify({"error": "Sigla não encontrada."}), 400

        gdf_estado = gdf[gdf[coluna_uf].astype(str).str.strip().str.upper() == uf].copy()
        if gdf_estado.empty: return jsonify({"error": "Estado não encontrado."}), 404

        if gdf_estado.crs and gdf_estado.crs.to_string() != "EPSG:4326": gdf_estado = gdf_estado.to_crs("EPSG:4326")
        gdf_estado['geometry'] = gdf_estado['geometry'].simplify(0.005)
        
        bounds = gdf_estado.total_bounds 
        res = {"bbox": [bounds[0], bounds[1], bounds[2], bounds[3]], "geojson": json.loads(gdf_estado.to_json())}
        CACHE_ESTADOS[uf] = res
        return jsonify(res)
    except Exception as e: return jsonify({"error": str(e)}), 500

@app.route('/camadas/<nome_camada>')
def get_camada(nome_camada):
    try:
        caminho_arquivo = os.path.join('camadas', f"{nome_camada}.gpkg")
        if not os.path.exists(caminho_arquivo): return jsonify({"error": "Camada não encontrada."}), 404

        gdf = gpd.read_file(caminho_arquivo)
        for col in gdf.columns:
            if pd.api.types.is_datetime64_any_dtype(gdf[col]): gdf[col] = gdf[col].astype(str)
        
        if gdf.crs and gdf.crs.to_string() != "EPSG:4326": gdf = gdf.to_crs("EPSG:4326")
        if len(gdf) > 3000: gdf['geometry'] = gdf['geometry'].simplify(0.01)

        return Response(gdf.to_json(), mimetype='application/json')
    except Exception as e: return jsonify({"error": str(e)}), 500

@app.route('/buscar_dados', methods=['POST'])
def buscar_dados():
    try:
        d = request.json
        prod = d.get('produto')
        start_date = d.get('start_date')
        end_date = d.get('end_date')
        
        if not start_date or not end_date: return jsonify({"status": "error", "message": "Selecione o período."}), 400
        
        short_name = ""
        subproduto_str = ""
        if prod == 'RiverSP':
            short_name, subproduto_str = "SWOT_L2_HR_RiverSP_D", d.get('subproduto', '')
        elif prod == 'LakeSP':
            short_name, subproduto_str = "SWOT_L2_HR_LakeSP_D", d.get('subproduto', '')
        elif prod in COLLECTIONS_BASE:
            short_name = COLLECTIONS_BASE[prod]
            if prod == 'Raster': subproduto_str = d.get('resolucao', '')
        else: return jsonify({"status": "error", "message": "Produto inválido"}), 400

        cycle_val = str(d.get('cycle', '')).strip().zfill(3) if str(d.get('cycle', '')).strip() else "*"
        pass_val = str(d.get('pass', '')).strip().zfill(3) if str(d.get('pass', '')).strip() else "*"
        tile_val = str(d.get('tile', '')).strip() if str(d.get('tile', '')).strip() else "*"
        cont_val = d.get('continente') if d.get('continente') else "SA"

        mask_name = d.get('shape_filename')
        state_uf = d.get('state_uf')

        bbox_geom = None
        if d.get('lon_min') and str(d.get('lon_min')).strip() != "":
            try: bbox_geom = box(float(d['lon_min']), float(d['lat_min']), float(d['lon_max']), float(d['lat_max']))
            except: pass

        passes_encontrados, tiles_encontrados, usou_smart_filter = [], [], False

        # MOTOR DE BUSCA ESTÁVEL E CONFIÁVEL
        if (bbox_geom or mask_name or state_uf) and pass_val == "*" and tile_val == "*":
            try:
                gdf_mask = None
                if mask_name:
                    mask_path = os.path.join(app.config['UPLOAD_FOLDER'], mask_name)
                    if os.path.exists(mask_path): gdf_mask, _ = carregar_geodataframe(mask_path)
                elif state_uf and state_uf != 'BR':
                    cp = [os.path.join(BASE_DIR, 'camadas', p) for p in ['BR_UF_2024.shp', 'BR_Estados.gpkg', 'BR_Estados.geojson', 'BR_Estados.shp']]
                    arq = next((p for p in cp if os.path.exists(p)), None)
                    if arq:
                        gdf_f = gpd.read_file(arq)
                        col = next((c for c in gdf_f.columns if gdf_f[c].astype(str).str.strip().str.upper().eq(state_uf.upper()).any()), None)
                        if col: gdf_mask = gdf_f[gdf_f[col].astype(str).str.strip().str.upper() == state_uf.upper()].copy()

                if gdf_mask is None or gdf_mask.empty:
                    if bbox_geom: gdf_mask = gpd.GeoDataFrame(geometry=[bbox_geom], crs="EPSG:4326")
                    else: raise Exception("Sem geometria")
                else:
                    if gdf_mask.crs is None: gdf_mask.set_crs(epsg=4326, inplace=True)
                    else: gdf_mask = gdf_mask.to_crs("EPSG:4326")
                    gdf_mask['geometry'] = gdf_mask['geometry'].simplify(0.005) # Proteção de memória

                caminho_tiles = os.path.join(BASE_DIR, 'camadas', 'SWOT_tiles_BR.gpkg')
                if os.path.exists(caminho_tiles):
                    gdf_tiles = gpd.read_file(caminho_tiles, bbox=tuple(gdf_mask.total_bounds))
                    if not gdf_tiles.empty:
                        if gdf_tiles.crs and gdf_tiles.crs.to_string() != "EPSG:4326": gdf_tiles = gdf_tiles.to_crs("EPSG:4326")
                        
                        inter = gpd.sjoin(gdf_tiles, gdf_mask, how="inner", predicate="intersects")
                        if not inter.empty:
                            usou_smart_filter = True
                            p_col = next((c for c in inter.columns if 'pass' in c.lower()), None)
                            t_col = next((c for c in inter.columns if 'tile' in c.lower()), None)

                            if prod in ['RiverSP', 'LakeSP'] and p_col:
                                for p in inter[p_col].astype(str):
                                    n = re.findall(r'\d+', p)
                                    if n: passes_encontrados.append(n[0].zfill(3))
                                passes_encontrados = list(set(passes_encontrados))
                            elif prod in ['PIXC', 'Raster'] and t_col:
                                if p_col:
                                    for _, row in inter.iterrows():
                                        n = re.findall(r'\d+', str(row[p_col]))
                                        if n and str(row[t_col]): tiles_encontrados.append((n[0].zfill(3), str(row[t_col])))
                                    tiles_encontrados = list(set(tiles_encontrados))
                                else:
                                    tiles_encontrados = inter[t_col].astype(str).unique().tolist()
            except Exception as e:
                usou_smart_filter = False

        patterns = []
        sub = subproduto_str if subproduto_str else "*"

        if usou_smart_filter:
            if prod in ['RiverSP', 'LakeSP']:
                if not passes_encontrados: return jsonify({"status": "success", "results": []})
                for p in passes_encontrados: patterns.append(f"*_{sub}_{cycle_val}_{p}_{cont_val}_*".replace("**", "*"))
            elif prod in ['PIXC', 'Raster']:
                if not tiles_encontrados: return jsonify({"status": "success", "results": []})
                for t in tiles_encontrados:
                    if isinstance(t, tuple):
                        if prod == 'Raster': patterns.append(f"*_{sub}_{cycle_val}_{t[0]}_{t[1]}_*".replace("**", "*"))
                        else: patterns.append(f"*_{cycle_val}_{t[0]}_{t[1]}_*".replace("**", "*"))
                    else:
                        if prod == 'Raster': patterns.append(f"*_{sub}_{cycle_val}_{pass_val}_{t}_*".replace("**", "*"))
                        else: patterns.append(f"*_{cycle_val}_{pass_val}_{t}_*".replace("**", "*"))
        else:
            if prod in ['RiverSP', 'LakeSP']: patterns.append(f"*_{sub}_{cycle_val}_{pass_val}_{cont_val}_*".replace("**", "*"))
            elif prod == 'Raster': patterns.append(f"*_{sub}_{cycle_val}_{pass_val}_{tile_val}_*".replace("**", "*"))
            elif prod == 'PIXC': patterns.append(f"*_{cycle_val}_{pass_val}_{tile_val}_*".replace("**", "*"))

        # TRAVA DE SEGURANÇA: Se a área for muito grande, ativa a busca por BBox (Evita travamentos)
        if len(patterns) > 20:
            patterns = []

        base_kwargs = {
            "short_name": short_name,
            "temporal": (f"{start_date}T00:00:00", f"{end_date}T23:59:59"),
            "count": 3000
        }
        if bbox_geom:
            base_kwargs["bounding_box"] = (float(d['lon_min']), float(d['lat_min']), float(d['lon_max']), float(d['lat_max']))

        results = []
        if patterns:
            for pat in patterns:
                sk = base_kwargs.copy()
                sk["granule_name"] = pat
                for _ in range(3):
                    try:
                        results.extend(earthaccess.search_data(**sk))
                        break
                    except: time.sleep(1)
        else:
            for _ in range(3):
                try:
                    results.extend(earthaccess.search_data(**base_kwargs))
                    break
                except: time.sleep(1)

        fmt_dict = {}
        for r in results:
            try:
                meta = r['meta']
                fn = meta.get('native-id', meta.get('producer-granule-id', 'unknown'))
                if fn not in fmt_dict:
                    sz = r.size() if r.size() else 0
                    fmt_dict[fn] = {"filename": fn, "size": f"{round(sz, 2)}", "download_link": r.data_links(access="external")[0]}
            except: pass

        return jsonify({"status": "success", "results": list(fmt_dict.values())})

    except Exception as e: return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/baixar_selecionados', methods=['POST'])
def baixar_selecionados():
    try:
        if not auth: return jsonify({"status": "error", "message": "Falha no login da NASA."}), 500
        data = request.json
        links = data.get('arquivos', [])
        session = auth.get_session()
        sucessos = 0
        for link in links:
            try:
                filepath = os.path.join(DOWNLOAD_FOLDER, link.split('/')[-1])
                with session.get(link, stream=True) as r:
                    r.raise_for_status()
                    with open(filepath, 'wb') as f: shutil.copyfileobj(r.raw, f)
                sucessos += 1
            except: pass
        return jsonify({"status": "success", "message": f"Download concluído: {sucessos} arquivos."})
    except Exception as e: return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/download_cropped', methods=['POST'])
def download_cropped():
    d = request.json
    url = d.get('granule_url')
    mask_name = d.get('shape_filename')
    state_uf = d.get('state_uf')
    lon_min, lat_min, lon_max, lat_max = d.get('lon_min'), d.get('lat_min'), d.get('lon_max'), d.get('lat_max')
    has_bbox = all(v is not None and str(v).strip() != "" for v in [lon_min, lat_min, lon_max, lat_max])

    if not url or (not mask_name and not state_uf and not has_bbox): return jsonify({'error': 'Dados incompletos.'}), 400
    if not auth: return jsonify({'error': 'Falha no login NASA.'}), 500

    tmp_mask_dir = None
    try:
        gdf_mask = None
        if mask_name:
            mask_path = os.path.join(app.config['UPLOAD_FOLDER'], mask_name)
            gdf_mask, tmp_mask_dir = carregar_geodataframe(mask_path)
        elif state_uf and state_uf != 'BR':
            cp = [os.path.join(BASE_DIR, 'camadas', p) for p in ['BR_UF_2024.shp', 'BR_Estados.gpkg', 'BR_Estados.geojson', 'BR_Estados.shp']]
            arq = next((p for p in cp if os.path.exists(p)), None)
            if arq:
                gdf_f = gpd.read_file(arq)
                col = next((c for c in gdf_f.columns if gdf_f[c].astype(str).str.strip().str.upper().eq(state_uf.upper()).any()), None)
                if col: gdf_mask = gdf_f[gdf_f[col].astype(str).str.strip().str.upper() == state_uf.upper()].copy()
        elif has_bbox:
            gdf_mask = gpd.GeoDataFrame(geometry=[box(float(lon_min), float(lat_min), float(lon_max), float(lat_max))], crs="EPSG:4326")

        if gdf_mask is None or gdf_mask.empty: return jsonify({"error": "Máscara inválida."}), 400
        
        if gdf_mask.crs is None: gdf_mask.set_crs(epsg=4326, inplace=True)
        else: gdf_mask = gdf_mask.to_crs("EPSG:4326")
        gdf_mask.geometry = gdf_mask.geometry.make_valid()

        session = auth.get_session()
        with tempfile.TemporaryDirectory() as tmpdirname:
            real_filename = url.split('/')[-1]
            ext_orig = os.path.splitext(real_filename)[1].lower()
            short_input = os.path.join(tmpdirname, f"in{ext_orig}")
            
            with session.get(url, stream=True) as r:
                r.raise_for_status()
                with open(short_input, 'wb') as f: shutil.copyfileobj(r.raw, f)

            path_final = os.path.join(app.config['UPLOAD_FOLDER'], f"res_{uuid.uuid4().hex}")
            mimetype = "application/octet-stream"
            d_name = f"recortado_{real_filename}"

            if ext_orig == '.zip':
                extract_path = os.path.join(tmpdirname, "x") 
                with zipfile.ZipFile(short_input, 'r') as z: z.extractall(extract_path)
                shps = glob.glob(os.path.join(extract_path, "**/*.shp"), recursive=True)
                if not shps: return jsonify({'error': 'ZIP sem Shapefile.'}), 400
                
                gdf_data = gpd.read_file(shps[0])
                if gdf_data.crs != gdf_mask.crs: gdf_data = gdf_data.to_crs(gdf_mask.crs)
                gdf_data.geometry = gdf_data.geometry.make_valid()
                try: clipped = gpd.clip(gdf_data, gdf_mask)
                except: return jsonify({'error': 'Erro geométrico.'}), 400

                if clipped.empty: return jsonify({'status': 'no_data', 'message': 'Sem dados.'})
                out_shp_dir = os.path.join(tmpdirname, "out")
                os.makedirs(out_shp_dir, exist_ok=True)
                clipped.to_file(os.path.join(out_shp_dir, "data.shp"), driver='ESRI Shapefile')
                shutil.make_archive(path_final, 'zip', out_shp_dir)
                path_final += ".zip"
                mimetype = 'application/zip'
                if d_name.endswith('.zip.zip'): d_name = d_name[:-4]

            elif ext_orig == '.nc':
                if not NETCDF_AVAILABLE: return jsonify({'error': 'NetCDF libs ausentes.'}), 500
                ds = rioxarray.open_rasterio(short_input, decode_coords="all")
                if ds.rio.crs is None: ds.rio.write_crs("EPSG:4326", inplace=True)
                try:
                    clipped = ds.rio.clip(gdf_mask.geometry.values, gdf_mask.crs, drop=True)
                    path_final += ".nc"
                    clipped.to_netcdf(path_final)
                    mimetype = 'application/x-netcdf'
                except: return jsonify({'status': 'no_data', 'message': 'Sem dados.'})
            else:
                gdf_data = gpd.read_file(short_input)
                if gdf_data.crs != gdf_mask.crs: gdf_data = gdf_data.to_crs(gdf_mask.crs)
                gdf_data.geometry = gdf_data.geometry.make_valid()
                clipped = gpd.clip(gdf_data, gdf_mask)
                if clipped.empty: return jsonify({'status': 'no_data', 'message': 'Sem dados.'})
                path_final += ext_orig
                driv = 'GeoJSON'
                if ext_orig == '.gpkg': driv = 'GPKG'
                elif ext_orig == '.kml': driv = 'KML'
                clipped.to_file(path_final, driver=driv)

            @after_this_request
            def remove_file(response):
                try:
                    if os.path.exists(path_final): os.remove(path_final)
                except: pass
                return response

            return send_file(path_final, as_attachment=True, download_name=d_name, mimetype=mimetype)

    except Exception as e: return jsonify({'error': str(e)}), 500
    finally:
        if tmp_mask_dir and os.path.exists(tmp_mask_dir): shutil.rmtree(tmp_mask_dir)

if __name__ == '__main__':
    app.run(debug=True)