import os
import shutil
import time
import requests
import json
from flask import Flask, render_template, request, jsonify, Response
import earthaccess
import geopandas as gpd
import pandas as pd
from shapely.geometry import shape

app = Flask(__name__)

# --- 1. CREDENCIAIS ---
os.environ["EARTHDATA_USERNAME"] = "joaquim.ajr"
os.environ["EARTHDATA_PASSWORD"] = "LancerEvolution6!"

# --- 2. CONFIGURAÇÃO ---
DOWNLOAD_FOLDER = './dados_swot'
if not os.path.exists(DOWNLOAD_FOLDER):
    os.makedirs(DOWNLOAD_FOLDER)

# --- 3. LOGIN ---
try:
    auth = earthaccess.login(strategy="environment", persist=True)
    print(">>> Login no Earthdata realizado com sucesso!")
except Exception as e:
    print(f">>> Aviso de Login: {e}")

COLLECTIONS = {
    "RiverSP": "SWOT_L2_HR_RiverSP_2.0",
    "LakeSP": "SWOT_L2_HR_LakeSP_2.0",
    "PIXC": "SWOT_L2_HR_PIXC_2.0",
    "Raster": "SWOT_L2_HR_Raster_2.0"
}

# Cache do IBGE
CACHE_IBGE = {}

@app.route('/')
def index():
    return render_template('index.html')

# --- ROTA IBGE (Limites Estaduais) ---
@app.route('/limites/ibge/<uf_sigla>')
def get_ibge_limits(uf_sigla):
    uf = uf_sigla.upper()
    if uf == 'BR': # Brasil inteiro fixo para não pesar
        return jsonify({"bbox": [-73.99, -33.75, -28.84, 5.27], "geojson": None})
    
    if uf in CACHE_IBGE: return jsonify(CACHE_IBGE[uf])

    try:
        url = f"https://servicodados.ibge.gov.br/api/v3/malhas/estados/{uf}?formato=application/vnd.geo+json&qualidade=minima"
        resp = requests.get(url)
        if resp.status_code != 200: return jsonify({"error": "Erro IBGE"}), 500
        
        geojson_data = resp.json()
        geom = shape(geojson_data['features'][0]['geometry'])
        bounds = geom.bounds 
        
        res = {"bbox": [bounds[0], bounds[1], bounds[2], bounds[3]], "geojson": geojson_data}
        CACHE_IBGE[uf] = res
        return jsonify(res)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# --- ROTA CAMADAS (CORREÇÃO DE ERRO TIMESTAMP/ANA) ---
@app.route('/camadas/<nome_camada>')
def get_camada(nome_camada):
    try:
        caminho_arquivo = os.path.join('camadas', f'{nome_camada}.gpkg')
        print(f"Lendo camada: {caminho_arquivo}")

        if not os.path.exists(caminho_arquivo):
            return jsonify({"error": "Arquivo não encontrado"}), 404

        # Lê arquivo
        gdf = gpd.read_file(caminho_arquivo)

        # CORREÇÃO 1: Converter datas para string (Evita erro JSON Timestamp)
        for col in gdf.columns:
            if pd.api.types.is_datetime64_any_dtype(gdf[col]):
                gdf[col] = gdf[col].astype(str)

        # CORREÇÃO 2: Garante Lat/Lon
        if gdf.crs and gdf.crs.to_string() != "EPSG:4326":
            gdf = gdf.to_crs("EPSG:4326")
            
        # CORREÇÃO 3: Simplifica geometria se for pesado
        if len(gdf) > 3000:
            print(f"Simplificando geometria de {nome_camada}...")
            gdf['geometry'] = gdf['geometry'].simplify(0.01)

        # Retorna JSON direto do GeoPandas
        return Response(gdf.to_json(), mimetype='application/json')

    except Exception as e:
        print(f"ERRO CRÍTICO CAMADA {nome_camada}: {e}")
        return jsonify({"error": str(e)}), 500

# --- BUSCA DE DADOS ---
@app.route('/buscar_dados', methods=['POST'])
def buscar_dados():
    try:
        data = request.json
        produto_key = data.get('produto')
        short_name = COLLECTIONS.get(produto_key)
        
        start_date = data.get('start_date')
        end_date = data.get('end_date')
        if not start_date or not end_date: return jsonify({"status": "error", "message": "Datas obrigatórias."}), 400
        temporal = (start_date, end_date)
        
        granule_pattern = "*"
        bbox = None

        try:
            if data.get('lon_min'):
                bbox = (float(data['lon_min']), float(data['lat_min']), float(data['lon_max']), float(data['lat_max']))
        except: pass

        if produto_key in ['RiverSP', 'LakeSP']:
            sub = data.get('river_subproduct') if produto_key == 'RiverSP' else data.get('lake_subproduct')
            cont = data.get('river_continent') if produto_key == 'RiverSP' else data.get('lake_continent')
            pass_num = data.get('pass')
            cycle = data.get('cycle')
            tile = data.get('tile')

            if sub: granule_pattern += f"{sub}*"
            if cycle: granule_pattern += f"_{str(cycle).zfill(3)}_"
            if pass_num: granule_pattern += f"_{str(pass_num).zfill(3)}_"
            else: granule_pattern += "*" 
            if cont: granule_pattern += f"_{cont}*"
            if tile: granule_pattern += f"_{tile}*"
            granule_pattern += "*"

        elif produto_key in ['PIXC', 'Raster']:
            if not bbox: return jsonify({"status": "error", "message": "Desenhe a área ou selecione um estado."}), 400
            if produto_key == 'Raster':
                res = data.get('raster_resolution', '100m')
                granule_pattern = f"*{res}*"

        results = []
        max_retries = 3
        for attempt in range(max_retries):
            try:
                results = earthaccess.search_data(short_name=short_name, temporal=temporal, bounding_box=bbox, granule_name=granule_pattern)
                break 
            except Exception as e:
                if attempt < max_retries - 1: time.sleep(2)
                else: raise e

        results_formatted = []
        for r in results:
            try:
                filename = r['meta']['native-id']
                size_val = r.size()
                size_bytes = int(size_val * 1024 * 1024) if size_val else 0
                size_str = f"{round(size_val, 2)} MB" if size_val else "N/A"
                # CORREÇÃO S3: access="external"
                link = r.data_links(access="external")[0]
                results_formatted.append({"filename": filename, "size": size_str, "size_bytes": size_bytes, "download_link": link})
            except: pass

        return jsonify({"status": "success", "results": results_formatted})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/baixar_selecionados', methods=['POST'])
def baixar_selecionados():
    try:
        data = request.json
        links = data.get('arquivos', [])
        if not links: return jsonify({"status": "error", "message": "Nenhum arquivo."}), 400
        
        session = auth.get_session()
        sucessos = 0
        erros = 0
        
        for link in links:
            try:
                filename = link.split('/')[-1]
                filepath = os.path.join(DOWNLOAD_FOLDER, filename)
                print(f"Baixando: {filename}")
                with session.get(link, stream=True) as r:
                    r.raise_for_status()
                    with open(filepath, 'wb') as f: shutil.copyfileobj(r.raw, f)
                sucessos += 1
            except: erros += 1
            
        return jsonify({"status": "success", "message": f"Concluído! {sucessos} salvos."})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True)