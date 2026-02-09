import os
import shutil
import time
import requests
import json
import tempfile
import zipfile
import glob
import uuid
from flask import Flask, render_template, request, jsonify, Response, send_file, after_this_request
from werkzeug.utils import secure_filename
import earthaccess
import geopandas as gpd
import pandas as pd
from shapely.geometry import shape

# --- DRIVERS ---
import fiona
fiona.drvsupport.supported_drivers['KML'] = 'rw'
fiona.drvsupport.supported_drivers['LIBKML'] = 'rw'
fiona.drvsupport.supported_drivers['GPX'] = 'rw'
fiona.drvsupport.supported_drivers['GPKG'] = 'rw'

try:
    import xarray as xr
    import rioxarray
except ImportError:
    print("Aviso: NetCDF libs ausentes.")

app = Flask(__name__)

# --- CONFIG ---
os.environ["EARTHDATA_USERNAME"] = "joaquim.ajr"
os.environ["EARTHDATA_PASSWORD"] = "LancerEvolution6!"

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DOWNLOAD_FOLDER = os.path.join(BASE_DIR, 'dados_swot')
UPLOAD_FOLDER = os.path.join(BASE_DIR, 'temp_uploads')

os.makedirs(DOWNLOAD_FOLDER, exist_ok=True)
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

try:
    auth = earthaccess.login(strategy="environment", persist=True)
except Exception as e:
    print(f">>> Erro Login: {e}")

COLLECTIONS_BASE = {
    "PIXC": "SWOT_L2_HR_PIXC_D",
    "Raster": "SWOT_L2_HR_Raster_D"
}

CACHE_IBGE = {}

# --- FUNÇÕES ---
def carregar_geodataframe(caminho):
    abs_path = os.path.abspath(caminho).replace('\\', '/')
    ext = os.path.splitext(caminho)[1].lower()
    temp_dir = None
    try:
        if ext in ['.zip', '.kmz']:
            try: return gpd.read_file(f"zip:///{abs_path}"), None
            except:
                temp_dir = tempfile.mkdtemp()
                with zipfile.ZipFile(caminho, 'r') as z: z.extractall(temp_dir)
                for p in ["**/*.shp", "**/*.kml", "**/*.gpkg", "**/*.geojson"]:
                    f = glob.glob(os.path.join(temp_dir, p), recursive=True)
                    if f: return gpd.read_file(f[0]), temp_dir
                raise Exception("Vetor não encontrado no ZIP")
        else: return gpd.read_file(abs_path), None
    except Exception as e:
        if temp_dir and os.path.exists(temp_dir): shutil.rmtree(temp_dir)
        raise e

# --- ROTAS ---
@app.route('/')
def index(): return render_template('index.html')

@app.route('/upload_user_shape', methods=['POST'])
def upload_user_shape():
    if 'file' not in request.files: return jsonify({'error': 'Vazio'}), 400
    f = request.files['file']
    if not f.filename: return jsonify({'error': 'Nome vazio'}), 400
    
    path = os.path.join(app.config['UPLOAD_FOLDER'], secure_filename(f.filename))
    f.save(path)
    
    tmp = None
    try:
        gdf, tmp = carregar_geodataframe(path)
        if gdf.crs is None: gdf.set_crs(epsg=4326, inplace=True)
        else: gdf = gdf.to_crs("EPSG:4326")
        if not gdf.empty and gdf.has_z.any(): gdf.geometry = gdf.geometry.map(lambda g: shape(g).simplify(0))
        
        return jsonify({'message': 'OK', 'filename': os.path.basename(path), 'bbox': list(gdf.total_bounds), 'geojson': gdf.to_json()})
    except Exception as e: return jsonify({'error': str(e)}), 500
    finally:
        if tmp and os.path.exists(tmp): shutil.rmtree(tmp)

@app.route('/limites/ibge/<uf>')
def get_ibge(uf):
    if uf=='BR': return jsonify({"bbox": [-73.99, -33.75, -28.84, 5.27], "geojson": None})
    if uf in CACHE_IBGE: return jsonify(CACHE_IBGE[uf])
    try:
        r = requests.get(f"https://servicodados.ibge.gov.br/api/v3/malhas/estados/{uf}?formato=application/vnd.geo+json&qualidade=minima")
        if r.status_code!=200: return jsonify({'error': 'Erro IBGE'}), 500
        geo = r.json()
        CACHE_IBGE[uf] = {"bbox": list(shape(geo['features'][0]['geometry']).bounds), "geojson": geo}
        return jsonify(CACHE_IBGE[uf])
    except Exception as e: return jsonify({'error': str(e)}), 500

@app.route('/camadas/<nome>')
def get_layer(nome):
    try:
        p = os.path.join('camadas', f"{nome}.gpkg")
        if not os.path.exists(p): return jsonify({'error': '404'}), 404
        gdf = gpd.read_file(p)
        for c in gdf.columns:
            if pd.api.types.is_datetime64_any_dtype(gdf[c]): gdf[c] = gdf[c].astype(str)
        if gdf.crs and gdf.crs.to_string() != "EPSG:4326": gdf = gdf.to_crs("EPSG:4326")
        if len(gdf) > 3000: gdf['geometry'] = gdf['geometry'].simplify(0.01)
        return Response(gdf.to_json(), mimetype='application/json')
    except Exception as e: return jsonify({'error': str(e)}), 500

@app.route('/buscar_dados', methods=['POST'])
def buscar():
    try:
        d = request.json
        prod = d.get('produto')
        dates = (d.get('start_date'), d.get('end_date'))
        if not all(dates): return jsonify({'status': 'error', 'message': 'Datas'}), 400
        
        short = ""
        pat = "*"
        
        if prod == 'RiverSP':
            sub = d.get('subproduto')
            if sub == 'Reach': short = "SWOT_L2_HR_RiverSP_Reach_D"
            elif sub == 'Node': short = "SWOT_L2_HR_RiverSP_Node_D"
            else: short = "SWOT_L2_HR_RiverSP_D"
            if sub: pat = f"*{sub}*"
            
        elif prod == 'LakeSP':
            sub = d.get('subproduto')
            if sub: 
                short = f"SWOT_L2_HR_LakeSP_{sub}_D"
                pat = f"*{sub}*"
            else: short = "SWOT_L2_HR_LakeSP_D"
            
        elif prod in COLLECTIONS_BASE:
            short = COLLECTIONS_BASE[prod]
            if prod == 'Raster': pat = f"*{d.get('resolucao', '100m')}*"
        
        else: return jsonify({'status': 'error', 'message': 'Produto inválido'}), 400

        # Filtros extras
        if d.get('cycle'): pat += f"*_{str(d['cycle']).zfill(3)}_"
        if d.get('pass'): pat += f"_{str(d['pass']).zfill(3)}_"
        if d.get('tile'): pat += f"_{d['tile']}*"
        if d.get('continente') and 'SP' in prod: pat += f"_{d['continente']}*"
        pat += "*"

        bbox = None
        if d.get('lon_min'): bbox = (float(d['lon_min']), float(d['lat_min']), float(d['lon_max']), float(d['lat_max']))

        print(f"Busca: {short} | Padrao: {pat}")
        res = []
        for _ in range(3):
            try:
                res = earthaccess.search_data(short_name=short, temporal=dates, bounding_box=bbox, granule_name=pat)
                break
            except: time.sleep(1)

        fmt = []
        for r in res:
            try:
                lnk = r.data_links(access="external")[0]
                fmt.append({'filename': r['meta']['native-id'], 'size': f"{round(r.size(), 2)} MB", 'download_link': lnk})
            except: pass
            
        return jsonify({'status': 'success', 'results': fmt})
    except Exception as e: return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/baixar_selecionados', methods=['POST'])
def baixar_sel():
    try:
        links = request.json.get('arquivos', [])
        s = auth.get_session()
        c = 0
        for l in links:
            try:
                p = os.path.join(DOWNLOAD_FOLDER, l.split('/')[-1])
                with s.get(l, stream=True) as r:
                    r.raise_for_status()
                    with open(p, 'wb') as f: shutil.copyfileobj(r.raw, f)
                c += 1
            except: pass
        return jsonify({'status': 'success', 'message': f'{c} baixados.'})
    except Exception as e: return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/download_cropped', methods=['POST'])
def dl_crop():
    d = request.json
    url = d.get('granule_url')
    mask = d.get('shape_filename')
    if not url or not mask: return jsonify({'error': 'Dados insuficientes'}), 400

    tmp = None
    try:
        gdf_m, tmp = carregar_geodataframe(os.path.join(app.config['UPLOAD_FOLDER'], mask))
        if gdf_m.crs is None: gdf_m.set_crs(epsg=4326, inplace=True)
        else: gdf_m = gdf_m.to_crs("EPSG:4326")

        s = auth.get_session()
        with tempfile.TemporaryDirectory() as td:
            orig_name = url.split('/')[-1]
            ext = os.path.splitext(orig_name)[1].lower()
            p_in = os.path.join(td, f"in{ext}")
            
            with s.get(url, stream=True) as r:
                r.raise_for_status()
                with open(p_in, 'wb') as f: shutil.copyfileobj(r.raw, f)

            uid = uuid.uuid4().hex
            p_out = os.path.join(app.config['UPLOAD_FOLDER'], f"res_{uid}")
            dl_name = f"recortado_{orig_name}"
            mime = "application/octet-stream"

            if ext == '.zip':
                x_dir = os.path.join(td, "x")
                with zipfile.ZipFile(p_in, 'r') as z: z.extractall(x_dir)
                shp = glob.glob(os.path.join(x_dir, "**/*.shp"), recursive=True)
                if not shp: return jsonify({'error': 'ZIP sem SHP'}), 400
                
                gdf = gpd.read_file(shp[0])
                if gdf.crs != gdf_m.crs: gdf = gdf.to_crs(gdf_m.crs)
                clip = gpd.clip(gdf, gdf_m)
                if clip.empty: return jsonify({'error': 'Vazio'}), 400
                
                o_dir = os.path.join(td, "out")
                os.makedirs(o_dir, exist_ok=True)
                clip.to_file(os.path.join(o_dir, "data.shp"), driver='ESRI Shapefile')
                shutil.make_archive(p_out, 'zip', o_dir)
                p_out += ".zip"
                mime = "application/zip"
                if dl_name.endswith('.zip.zip'): dl_name = dl_name[:-4]

            elif ext == '.nc':
                ds = rioxarray.open_rasterio(p_in, decode_coords="all")
                if ds.rio.crs is None: ds.rio.write_crs("EPSG:4326", inplace=True)
                try:
                    clip = ds.rio.clip(gdf_m.geometry.values, gdf_m.crs, drop=True)
                    p_out += ".nc"
                    clip.to_netcdf(p_out)
                    mime = "application/x-netcdf"
                except Exception as e: return jsonify({'error': f"NetCDF: {e}"}), 500
            
            else:
                gdf = gpd.read_file(p_in)
                if gdf.crs != gdf_m.crs: gdf = gdf.to_crs(gdf_m.crs)
                clip = gpd.clip(gdf, gdf_m)
                if clip.empty: return jsonify({'error': 'Vazio'}), 400
                p_out += ext
                driv = 'GPKG' if ext=='.gpkg' else 'KML' if ext=='.kml' else 'GeoJSON'
                clip.to_file(p_out, driver=driv)

            @after_this_request
            def clean(r):
                try: 
                    if os.path.exists(p_out): os.remove(p_out)
                except: pass
                return r

            return send_file(p_out, as_attachment=True, download_name=dl_name, mimetype=mime)

    except Exception as e: 
        print(e)
        return jsonify({'error': str(e)}), 500
    finally:
        if tmp and os.path.exists(tmp): shutil.rmtree(tmp)

if __name__ == '__main__':
    app.run(debug=True)