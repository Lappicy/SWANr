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
from flask import Flask, render_template, request, jsonify, Response, send_file, after_this_request
from werkzeug.utils import secure_filename
import earthaccess
import geopandas as gpd
import pandas as pd
from shapely.geometry import shape
from dotenv import load_dotenv

# --- CONFIGURAÇÃO DE DRIVERS (Fiona) ---
import fiona
fiona.drvsupport.supported_drivers['KML'] = 'rw'
fiona.drvsupport.supported_drivers['LIBKML'] = 'rw'
fiona.drvsupport.supported_drivers['GPX'] = 'rw'
fiona.drvsupport.supported_drivers['GPKG'] = 'rw'

# Verifica suporte a NetCDF
NETCDF_AVAILABLE = False
try:
    import xarray as xr
    import rioxarray
    NETCDF_AVAILABLE = True
except ImportError:
    print(">>> AVISO: 'xarray' ou 'rioxarray' não instalados. Recorte de NetCDF indisponível.")

app = Flask(__name__)

# --- 1. CREDENCIAIS & CONFIGURAÇÕES ---
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

if not usuario or not senha:
    print(">>> AVISO: Credenciais da NASA ausentes. O download falhará.")
else:
    try:
        auth = earthaccess.login(strategy="environment", persist=True)
        print(">>> Login na NASA realizado com sucesso!")
    except Exception as e:
        print(f">>> Erro no Login Earthdata: {e}")

COLLECTIONS_BASE = {
    "PIXC": "SWOT_L2_HR_PIXC_D",
    "Raster": "SWOT_L2_HR_Raster_D"
}

CACHE_ESTADOS = {}

# --- 2. FUNÇÕES AUXILIARES ---
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
                
                raise Exception("Nenhum arquivo de mapa válido encontrado dentro do ZIP.")
        else:
            return gpd.read_file(abs_path), None
    except Exception as e:
        if temp_dir and os.path.exists(temp_dir): shutil.rmtree(temp_dir)
        raise e

# --- 3. ROTAS PRINCIPAIS ---
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/upload_user_shape', methods=['POST'])
def upload_user_shape():
    if 'file' not in request.files: return jsonify({'error': 'Arquivo não enviado.'}), 400
    file = request.files['file']
    if file.filename == '': return jsonify({'error': 'Nome do arquivo vazio.'}), 400

    filename = secure_filename(file.filename)
    
    if filename.lower().endswith('.shp'):
        return jsonify({'error': 'Um arquivo .shp não funciona sozinho! Por favor, compacte todos os arquivos do shapefile (.shp, .shx, .dbf, .prj) em um arquivo .ZIP e faça o upload.'}), 400

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

        return jsonify({
            'message': 'Sucesso',
            'filename': filename,
            'bbox': list(gdf.total_bounds),
            'geojson': gdf.to_json()
        })
    except Exception as e:
        return jsonify({'error': f"Erro ao ler arquivo: {str(e)}"}), 500
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
        
        caminho_arquivo = None
        for cp in caminhos_possiveis:
            if os.path.exists(cp):
                caminho_arquivo = cp
                break
                
        if not caminho_arquivo:
            return jsonify({"error": "Arquivo de estados (BR_UF_2024.shp ou similar) não encontrado na pasta 'camadas'."}), 404

        gdf = gpd.read_file(caminho_arquivo)
        
        coluna_uf = None
        for col in gdf.columns:
            if gdf[col].astype(str).str.strip().str.upper().eq(uf).any():
                coluna_uf = col
                break

        if not coluna_uf:
            return jsonify({"error": f"A sigla '{uf}' não foi encontrada em nenhuma coluna do shapefile."}), 400

        gdf_estado = gdf[gdf[coluna_uf].astype(str).str.strip().str.upper() == uf].copy()

        if gdf_estado.empty:
            return jsonify({"error": f"Estado {uf} não encontrado no arquivo."}), 404

        if gdf_estado.crs and gdf_estado.crs.to_string() != "EPSG:4326":
            gdf_estado = gdf_estado.to_crs("EPSG:4326")

        gdf_estado['geometry'] = gdf_estado['geometry'].simplify(0.005)

        bounds = gdf_estado.total_bounds 
        geojson_data = json.loads(gdf_estado.to_json())
        
        res = {"bbox": [bounds[0], bounds[1], bounds[2], bounds[3]], "geojson": geojson_data}
        CACHE_ESTADOS[uf] = res
        return jsonify(res)
        
    except Exception as e: 
        return jsonify({"error": str(e)}), 500

@app.route('/camadas/<nome_camada>')
def get_camada(nome_camada):
    try:
        nome_arquivo = f"{nome_camada}.gpkg"
        caminho_arquivo = os.path.join('camadas', nome_arquivo)
        
        if not os.path.exists(caminho_arquivo): return jsonify({"error": "Camada não encontrada."}), 404

        gdf = gpd.read_file(caminho_arquivo)
        for col in gdf.columns:
            if pd.api.types.is_datetime64_any_dtype(gdf[col]): gdf[col] = gdf[col].astype(str)
        
        if gdf.crs and gdf.crs.to_string() != "EPSG:4326": gdf = gdf.to_crs("EPSG:4326")
        if len(gdf) > 3000: gdf['geometry'] = gdf['geometry'].simplify(0.01)

        return Response(gdf.to_json(), mimetype='application/json')
    except Exception as e: return jsonify({"error": str(e)}), 500

# =======================================================
# BUSCA E DOWNLOAD (SISTEMA DE PESQUISA FUZZY BLINDADO)
# =======================================================
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
        
        # 1. Identifica a Coleção Oficial da NASA
        if prod == 'RiverSP':
            short_name = "SWOT_L2_HR_RiverSP_D"
            sub = d.get('subproduto')
            if sub: subproduto_str = sub
            
        elif prod == 'LakeSP':
            short_name = "SWOT_L2_HR_LakeSP_D"
            sub = d.get('subproduto')
            if sub: subproduto_str = sub
            
        elif prod in COLLECTIONS_BASE:
            short_name = COLLECTIONS_BASE[prod]
            if prod == 'Raster': 
                res = d.get('resolucao')
                if res: subproduto_str = res
        else: 
            return jsonify({"status": "error", "message": "Produto inválido"}), 400

        # 2. Constrói o Padrão de Busca Infalível (Usando '*')
        parts = []
        
        if subproduto_str: 
            parts.append(subproduto_str)
            
        cycle_val = d.get('cycle')
        if cycle_val and str(cycle_val).strip() != "": 
            parts.append(str(cycle_val).strip().zfill(3))
            
        pass_val = d.get('pass')
        if pass_val and str(pass_val).strip() != "": 
            parts.append(str(pass_val).strip().zfill(3))

        tile_val = d.get('tile')
        if tile_val and str(tile_val).strip() != "":
            parts.append(str(tile_val).strip())
            
        continente = d.get('continente')
        if continente and ('SP' in prod): 
            parts.append(continente)
            
        # Junta tudo criando uma busca fuzzy "indestrutível" (Ex: *Reach*044*005*SA*)
        core_pattern = "*".join(parts)
        granule_pattern = f"*{core_pattern}*"
        
        # Limpa duplos asteriscos que confundem a API
        while "**" in granule_pattern:
            granule_pattern = granule_pattern.replace("**", "*")

        # 3. Empacota a requisição de forma limpa (Ocultando vazios)
        search_kwargs = {
            "short_name": short_name,
            "granule_name": granule_pattern
        }
        
        if start_date and end_date:
            search_kwargs["temporal"] = (start_date, end_date)
            
        # Envia a área de interesse APENAS se ela de fato existir
        if d.get('lon_min') and str(d.get('lon_min')).strip() != "":
            try:
                bbox = (float(d['lon_min']), float(d['lat_min']), float(d['lon_max']), float(d['lat_max']))
                search_kwargs["bounding_box"] = bbox
            except: pass

        results = []
        for i in range(3):
            try:
                results = earthaccess.search_data(**search_kwargs)
                break 
            except Exception: time.sleep(1)

        fmt = []
        for r in results:
            try:
                meta = r['meta']
                filename = meta.get('native-id', meta.get('producer-granule-id', 'unknown'))
                size_val = r.size() if r.size() else 0
                fmt.append({"filename": filename, "size": f"{round(size_val, 2)}", "download_link": r.data_links(access="external")[0]})
            except: pass

        return jsonify({"status": "success", "results": fmt})

    except Exception as e: return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/baixar_selecionados', methods=['POST'])
def baixar_selecionados():
    try:
        if not auth: return jsonify({"status": "error", "message": "O servidor não conseguiu fazer login na NASA."}), 500

        data = request.json
        links = data.get('arquivos', [])
        session = auth.get_session()
        sucessos = 0
        for link in links:
            try:
                filename = link.split('/')[-1]
                filepath = os.path.join(DOWNLOAD_FOLDER, filename)
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

    if not url or (not mask_name and not state_uf): 
        return jsonify({'error': 'Dados incompletos. Informe um shape ou um estado.'}), 400
    if not auth: 
        return jsonify({'error': 'Falha no login da NASA. Verifique credenciais.'}), 500

    tmp_mask_dir = None
    try:
        # Se for Upload do usuário
        if mask_name:
            mask_path = os.path.join(app.config['UPLOAD_FOLDER'], mask_name)
            gdf_mask, tmp_mask_dir = carregar_geodataframe(mask_path)
            
        # Se for seleção de Estado
        elif state_uf:
            caminhos_possiveis = [
                os.path.join(BASE_DIR, 'camadas', 'BR_UF_2024.shp'), 
                os.path.join(BASE_DIR, 'camadas', 'BR_Estados.gpkg'),
                os.path.join(BASE_DIR, 'camadas', 'BR_Estados.geojson'),
                os.path.join(BASE_DIR, 'camadas', 'BR_Estados.shp')
            ]
            caminho_arquivo = next((cp for cp in caminhos_possiveis if os.path.exists(cp)), None)
            
            if not caminho_arquivo:
                return jsonify({"error": "Arquivo da malha de estados não encontrado no servidor."}), 404
                
            gdf_full = gpd.read_file(caminho_arquivo)
            coluna_uf = None
            uf_upper = state_uf.upper()
            
            for col in gdf_full.columns:
                if gdf_full[col].astype(str).str.strip().str.upper().eq(uf_upper).any():
                    coluna_uf = col
                    break
                    
            if not coluna_uf:
                return jsonify({"error": f"A sigla '{uf_upper}' não foi encontrada na malha."}), 400
                
            gdf_mask = gdf_full[gdf_full[coluna_uf].astype(str).str.strip().str.upper() == uf_upper].copy()
            if gdf_mask.empty:
                return jsonify({"error": "Geometria do estado vazia ou não encontrada."}), 404
        
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

            final_uuid = uuid.uuid4().hex
            path_final_persistente = os.path.join(app.config['UPLOAD_FOLDER'], f"res_{final_uuid}")
            mimetype = "application/octet-stream"
            download_name_browser = f"recortado_{real_filename}"

            if ext_orig == '.zip':
                extract_path = os.path.join(tmpdirname, "x") 
                with zipfile.ZipFile(short_input, 'r') as z: z.extractall(extract_path)
                
                shps = glob.glob(os.path.join(extract_path, "**/*.shp"), recursive=True)
                if not shps: return jsonify({'error': 'ZIP original sem Shapefile.'}), 400
                
                gdf_data = gpd.read_file(shps[0])
                if gdf_data.crs != gdf_mask.crs: gdf_data = gdf_data.to_crs(gdf_mask.crs)
                gdf_data.geometry = gdf_data.geometry.make_valid()
                
                try: clipped = gpd.clip(gdf_data, gdf_mask)
                except Exception: return jsonify({'error': 'Erro geométrico no recorte.'}), 400

                if clipped.empty: return jsonify({'error': 'Sem sobreposição na área.'}), 400
                
                out_shp_dir = os.path.join(tmpdirname, "out")
                os.makedirs(out_shp_dir, exist_ok=True)
                clipped.to_file(os.path.join(out_shp_dir, "data.shp"), driver='ESRI Shapefile')
                
                shutil.make_archive(path_final_persistente, 'zip', out_shp_dir)
                path_final_persistente += ".zip"
                mimetype = 'application/zip'
                if download_name_browser.endswith('.zip.zip'): download_name_browser = download_name_browser[:-4]

            elif ext_orig == '.nc':
                if not NETCDF_AVAILABLE: return jsonify({'error': 'NetCDF libs ausentes.'}), 500
                ds = rioxarray.open_rasterio(short_input, decode_coords="all")
                if ds.rio.crs is None: ds.rio.write_crs("EPSG:4326", inplace=True)
                try:
                    clipped = ds.rio.clip(gdf_mask.geometry.values, gdf_mask.crs, drop=True)
                    path_final_persistente += ".nc"
                    clipped.to_netcdf(path_final_persistente)
                    mimetype = 'application/x-netcdf'
                except Exception as e: return jsonify({'error': f"Erro NetCDF: {str(e)}"}), 500
            
            else:
                gdf_data = gpd.read_file(short_input)
                if gdf_data.crs != gdf_mask.crs: gdf_data = gdf_data.to_crs(gdf_mask.crs)
                gdf_data.geometry = gdf_data.geometry.make_valid()
                
                clipped = gpd.clip(gdf_data, gdf_mask)
                if clipped.empty: return jsonify({'error': 'Sem sobreposição.'}), 400
                
                path_final_persistente += ext_orig
                driv = 'GeoJSON'
                if ext_orig == '.gpkg': driv = 'GPKG'
                elif ext_orig == '.kml': driv = 'KML'
                clipped.to_file(path_final_persistente, driver=driv)
                mimetype = 'application/octet-stream'

            @after_this_request
            def remove_file(response):
                try:
                    if os.path.exists(path_final_persistente): os.remove(path_final_persistente)
                except: pass
                return response

            return send_file(path_final_persistente, as_attachment=True, download_name=download_name_browser, mimetype=mimetype)

    except Exception as e: return jsonify({'error': f"Erro interno: {str(e)}"}), 500
    finally:
        if tmp_mask_dir and os.path.exists(tmp_mask_dir): shutil.rmtree(tmp_mask_dir)

if __name__ == '__main__':
    app.run(debug=True)