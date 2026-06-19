var map = L.map('map', { zoomControl: false }).setView([-14.235, -51.925], 4);
var satellite = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Esri', maxZoom: 19 }
);
var street = L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { attribution: 'OSM', maxZoom: 19 }
);
var labels = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png',
    { maxZoom: 19 }
);

satellite.addTo(map);
labels.addTo(map);
L.control.zoom({ position: 'topright' }).addTo(map);
L.control.scale({ position: 'bottomleft', metric: true, imperial: true }).addTo(map);

var CoordControl = L.Control.extend({
    options: { position: 'bottomleft' },
    onAdd: function () {
        var container = L.DomUtil.create('div', 'coord-display leaflet-control');
        container.innerHTML = '<i data-lucide="crosshair"></i><span id="map-coords">0,000 0,000 Graus</span>';
        return container;
    }
});

map.addControl(new CoordControl());
renderIcons();

var lastMoveTime = 0;
var drawnItems = new L.FeatureGroup();
var uploadedLayer = null;
var stateLayer = null;
var activeLayers = {};

map.addLayer(drawnItems);

var drawControl = new L.Control.Draw({
    draw: {
        polygon: false,
        polyline: false,
        circle: false,
        marker: false,
        circlemarker: false,
        rectangle: { shapeOptions: { color: '#1677b8' } }
    },
    edit: { featureGroup: drawnItems, remove: true },
    position: 'topright'
});

map.addControl(drawControl);

map.on('mousemove', function (e) {
    var now = Date.now();
    if (now - lastMoveTime < 50) return;
    lastMoveTime = now;

    var lat = e.latlng.lat.toFixed(3).replace('.', ',');
    var lng = e.latlng.lng.toFixed(3).replace('.', ',');
    var coordSpan = document.getElementById('map-coords');
    if (coordSpan) coordSpan.innerText = lng + ' ' + lat + ' Graus';
});

map.on(L.Draw.Event.CREATED, function (e) {
    limparTudoMenos('draw');
    drawnItems.addLayer(e.layer);
    updateCoords(e.layer.getBounds());
});

map.on(L.Draw.Event.DELETED, function () {
    updateCoords(null);
});

function renderIcons() {
    if (window.lucide) window.lucide.createIcons();
}

function icon(name) {
    return '<i data-lucide="' + name + '"></i>';
}

function setButton(button, iconName, text) {
    if (!button) return;
    button.innerHTML = icon(iconName) + '<span>' + escHtml(text) + '</span>';
    renderIcons();
}

function startLoading() {
    document.getElementById('map').classList.add('map-loading');
}

function stopLoading() {
    document.getElementById('map').classList.remove('map-loading');
}

function showToast(msg, type, duration) {
    type = type || 'info';
    duration = duration || 4000;

    var container = document.getElementById('toast-container');
    if (!container) return;

    var toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.textContent = msg;
    container.appendChild(toast);
    void toast.offsetWidth;
    toast.classList.add('show');

    setTimeout(function () {
        toast.classList.remove('show');
        setTimeout(function () { toast.remove(); }, 250);
    }, duration);
}

function trocarBasemap(tipo) {
    if (tipo === 'sat') {
        if (!map.hasLayer(satellite)) map.addLayer(satellite);
        if (!map.hasLayer(labels)) map.addLayer(labels);
        if (map.hasLayer(street)) map.removeLayer(street);
        return;
    }

    if (!map.hasLayer(street)) map.addLayer(street);
    if (map.hasLayer(satellite)) map.removeLayer(satellite);
    if (map.hasLayer(labels)) map.removeLayer(labels);
}

function switchTab(t) {
    var panel = document.getElementById('main-panel');
    var clickedNav = document.getElementById('nav-' + t);
    var isAlreadyActive = clickedNav && clickedNav.classList.contains('active');

    if (isAlreadyActive && panel.style.display !== 'none') {
        panel.style.display = 'none';
        return;
    }

    panel.style.display = 'flex';

    document.querySelectorAll('.panel-body').forEach(function (view) {
        view.classList.add('hidden');
    });

    document.querySelectorAll('.nav-item:not(#nav-manual)').forEach(function (item) {
        item.classList.remove('active');
    });

    var view = document.getElementById('view-' + t);
    if (view) view.classList.remove('hidden');
    if (clickedNav) clickedNav.classList.add('active');
}

function toggleManual() {
    var panel = document.getElementById('manual-panel');
    var btn = document.getElementById('nav-manual');
    var opening = !panel.classList.contains('open');
    panel.classList.toggle('open', opening);
    if (btn) btn.classList.toggle('active', opening);
}

function resetarConsulta() {
    document.getElementById('searchForm').reset();
    limparArea();
    toggleSubproducts();
    document.getElementById('date-msg').classList.add('hidden');
    document.getElementById('results-list').innerHTML = '';
    document.getElementById('results-meta').classList.add('hidden');
    document.getElementById('btn-download-selected').classList.add('hidden');
    document.getElementById('nav-resultados').classList.add('disabled');
    switchTab('swot');
}

function toggleSubproducts() {
    document.querySelectorAll('.sub-opts').forEach(function (el) {
        el.classList.add('hidden');
    });
    document.querySelectorAll('.sub-opts select').forEach(function (select) {
        select.disabled = true;
    });

    var product = document.getElementById('produto').value;
    var divId = '';

    if (product === 'RiverSP') divId = 'sub-river';
    if (product === 'LakeSP') divId = 'sub-lake';
    if (product === 'Raster') divId = 'sub-raster';

    if (!divId) return;

    var target = document.getElementById(divId);
    target.classList.remove('hidden');
    target.querySelectorAll('select').forEach(function (select) {
        select.disabled = false;
    });
}

function validarDatas() {
    var start = document.getElementById('start_date');
    var end = document.getElementById('end_date');
    var msg = document.getElementById('date-msg');
    var min = new Date('2022-02-15T00:00:00');
    var calValEnd = new Date('2023-07-26T23:59:59');
    var d1 = start.value ? new Date(start.value + 'T00:00:00') : null;
    var d2 = end.value ? new Date(end.value + 'T00:00:00') : null;

    msg.classList.add('hidden');
    msg.textContent = '';
    msg.style.color = '#7a5200';
    msg.style.backgroundColor = '#fff6df';
    msg.style.borderColor = '#f4d58d';

    if ((d1 && d1 < min) || (d2 && d2 < min)) {
        showToast('O satélite não estava disponível antes de 15/02/2022.', 'warning');
        if (d1 && d1 < min) start.value = '';
        if (d2 && d2 < min) end.value = '';
        return;
    }

    if (d1 && d2 && d1 > d2) {
        msg.textContent = 'Data inicial deve ser anterior à data final.';
        msg.style.color = '#7d1b25';
        msg.style.backgroundColor = '#fff0f2';
        msg.style.borderColor = '#facbd2';
        msg.classList.remove('hidden');
        end.value = '';
        return;
    }

    if ((d1 && d1 <= calValEnd) || (d2 && d2 <= calValEnd)) {
        msg.textContent = 'Esse período engloba a fase de Cal/Val.';
        msg.classList.remove('hidden');
    }
}

function limparArea() {
    limparTudoMenos('reset');
    updateCoords(null);
}

function limparTudoMenos(tipo) {
    if (tipo !== 'draw') drawnItems.clearLayers();

    if (tipo !== 'upload') {
        if (uploadedLayer) {
            map.removeLayer(uploadedLayer);
            uploadedLayer = null;
        }
        document.getElementById('uploadedShapeName').value = '';
        document.getElementById('shapeStatus').innerText = '';
        document.getElementById('userShapeInput').value = '';
    }

    if (tipo !== 'state') {
        if (stateLayer) {
            map.removeLayer(stateLayer);
            stateLayer = null;
        }
        document.getElementById('brazil_states').value = '';
    }
}

function updateCoords(bounds) {
    if (!bounds) {
        ['lat_min', 'lat_max', 'lon_min', 'lon_max'].forEach(function (id) {
            document.getElementById(id).value = '';
        });
        return;
    }

    document.getElementById('lat_min').value = bounds.getSouth().toFixed(4);
    document.getElementById('lat_max').value = bounds.getNorth().toFixed(4);
    document.getElementById('lon_min').value = bounds.getWest().toFixed(4);
    document.getElementById('lon_max').value = bounds.getEast().toFixed(4);
}

async function uploadShape() {
    var file = document.getElementById('userShapeInput').files[0];
    if (!file) return;

    limparTudoMenos('upload');
    startLoading();
    document.getElementById('shapeStatus').innerText = 'Enviando...';

    var fd = new FormData();
    fd.append('file', file);

    try {
        var response = await fetch('/upload_user_shape', { method: 'POST', body: fd });
        var data = await response.json();
        if (data.error) throw new Error(data.error);

        document.getElementById('uploadedShapeName').value = data.filename;
        document.getElementById('shapeStatus').innerText = 'Arquivo carregado: ' + data.filename;
        uploadedLayer = L.geoJSON(JSON.parse(data.geojson), {
            interactive: false,
            style: { color: '#d36b00', dashArray: '5,5', weight: 2 }
        }).addTo(map);
        map.fitBounds(uploadedLayer.getBounds());
        updateCoords(uploadedLayer.getBounds());
    } catch (error) {
        showToast('Erro ao enviar arquivo: ' + error.message, 'error', 6000);
        document.getElementById('shapeStatus').innerText = 'Erro no upload';
    } finally {
        stopLoading();
    }
}

function aplicarFiltroEstado() {
    var uf = document.getElementById('brazil_states').value;

    if (stateLayer) {
        map.removeLayer(stateLayer);
        stateLayer = null;
    }

    limparTudoMenos('state');
    if (!uf) {
        updateCoords(null);
        return;
    }

    startLoading();

    fetch('/limites/estado/' + encodeURIComponent(uf))
        .then(function (response) { return response.json(); })
        .then(function (data) {
            if (data.error) {
                showToast('Erro: ' + data.error, 'error');
                return;
            }

            if (data.geojson) {
                stateLayer = L.geoJSON(data.geojson, {
                    interactive: false,
                    style: { color: '#1677b8', weight: 2, fillOpacity: 0.1 }
                }).addTo(map);
            }

            var b = data.bbox;
            var bounds = L.latLngBounds([b[1], b[0]], [b[3], b[2]]);
            map.fitBounds(bounds);
            updateCoords(bounds);
        })
        .catch(function () {
            showToast('Erro ao carregar estado.', 'error');
        })
        .finally(stopLoading);
}

function toggleCamada(checkbox, nomeArquivo, nomeExibicao, cor, tipo) {
    if (!checkbox.checked) {
        if (activeLayers[nomeArquivo]) map.removeLayer(activeLayers[nomeArquivo]);
        return;
    }

    if (activeLayers[nomeArquivo]) {
        map.addLayer(activeLayers[nomeArquivo]);
        return;
    }

    startLoading();
    checkbox.disabled = true;

    fetch('/camadas/' + encodeURIComponent(nomeArquivo))
        .then(function (response) {
            if (!response.ok) throw new Error('Camada indisponível.');
            return response.json();
        })
        .then(function (data) {
            var layer = L.geoJSON(data, {
                customTitle: nomeExibicao,
                interactive: true,
                style: function () {
                    return { color: cor, weight: 3, opacity: 0.82, fillOpacity: 0.1 };
                },
                pointToLayer: function (feature, latlng) {
                    return L.circleMarker(latlng, {
                        radius: tipo === 'ponto' ? 5 : 4,
                        fillColor: cor,
                        color: '#fff',
                        weight: 1,
                        opacity: 1,
                        fillOpacity: 0.9
                    });
                }
            });

            activeLayers[nomeArquivo] = layer;
            map.addLayer(layer);
        })
        .catch(function () {
            showToast('Erro ao carregar camada.', 'error');
            checkbox.checked = false;
        })
        .finally(function () {
            checkbox.disabled = false;
            stopLoading();
        });
}

function buscarDados() {
    var product = document.getElementById('produto').value;
    var startDate = document.getElementById('start_date').value;
    var endDate = document.getElementById('end_date').value;

    if (!product) {
        showToast('Selecione um produto antes de consultar.', 'warning');
        return;
    }

    if (!startDate || !endDate) {
        showToast('Preencha a data inicial e a data final.', 'warning');
        return;
    }

    if (new Date(startDate) > new Date(endDate)) {
        showToast('As datas estão invertidas. Corrija o período.', 'warning');
        return;
    }

    switchTab('resultados');

    var list = document.getElementById('results-list');
    var loader = document.getElementById('progress-container');
    var bar = document.getElementById('progress-fill');
    var btnDown = document.getElementById('btn-download-selected');

    list.innerHTML = '';
    list.classList.add('hidden');
    document.getElementById('results-meta').classList.add('hidden');
    if (btnDown) btnDown.classList.add('hidden');
    document.getElementById('nav-resultados').classList.remove('disabled');

    loader.classList.remove('hidden');
    bar.style.width = '0%';
    bar.classList.remove('progress-filling');
    void bar.offsetWidth;
    bar.classList.add('progress-filling');

    var formData = new FormData(document.getElementById('searchForm'));
    var reqData = Object.fromEntries(formData);
    reqData.shape_filename = document.getElementById('uploadedShapeName').value;
    reqData.state_uf = document.getElementById('brazil_states').value;

    fetch('/buscar_dados', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reqData)
    })
    .then(function (response) {
        if (!response.ok) throw new Error('Falha do servidor (' + response.status + '). A NASA pode estar demorando a responder.');
        return response.json();
    })
    .then(function (data) {
        bar.classList.remove('progress-filling');
        bar.style.width = '100%';
        loader.classList.add('hidden');
        list.classList.remove('hidden');

        if (data.status !== 'success' || !data.results || data.results.length === 0) {
            list.innerHTML = '<p class="state-message">Nenhum resultado encontrado.</p>';
            return;
        }

        renderResults(data.results);
    })
    .catch(function (error) {
        loader.classList.add('hidden');
        list.classList.remove('hidden');
        list.innerHTML = '<div class="error-card">' + icon('circle-alert') + '<b>Erro na busca</b><br><span>' + escHtml(error.message) + '</span></div>';
        renderIcons();
    });
}

function renderResults(results) {
    var list = document.getElementById('results-list');
    var btnDown = document.getElementById('btn-download-selected');
    var totalBytes = 0;

    results.forEach(function (file) {
        if (file.size && file.size !== 'N/A') totalBytes += parseFloat(file.size) || 0;
    });

    document.getElementById('total-count').innerText = results.length;
    document.getElementById('total-size').innerText = totalBytes.toFixed(2) + ' MB';
    document.getElementById('results-meta').classList.remove('hidden');

    var shapeName = document.getElementById('uploadedShapeName').value;
    var stateUF = document.getElementById('brazil_states').value;
    var latMinVal = document.getElementById('lat_min').value;
    var willCrop = shapeName || (stateUF && stateUF !== 'BR') || latMinVal !== '';

    btnDown.classList.remove('hidden');
    btnDown.disabled = true;
    btnDown.style.backgroundColor = willCrop ? '#d36b00' : '#1677b8';
    setButton(btnDown, willCrop ? 'scissors' : 'download', willCrop ? 'Recortar e Baixar Selecionados' : 'Baixar Originais Selecionados');

    var selectAll = document.getElementById('select-all');
    if (selectAll) selectAll.checked = false;

    results.forEach(function (file, index) {
        var item = document.createElement('div');
        item.className = 'result-item';

        var info = document.createElement('div');
        info.className = 'result-info';

        var checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = file.download_link;
        checkbox.id = 'cb-' + index;
        checkbox.addEventListener('change', verificarSelecao);

        var text = document.createElement('div');
        text.className = 'result-text';

        var filename = document.createElement('div');
        filename.className = 'result-filename';
        filename.title = file.filename;
        filename.textContent = file.filename;

        var size = document.createElement('div');
        size.className = 'result-size';
        size.innerHTML = escHtml(String(file.size)) + ' MB <span id="status-' + index + '"></span>';

        text.appendChild(filename);
        text.appendChild(size);
        info.appendChild(checkbox);
        info.appendChild(text);
        item.appendChild(info);
        list.appendChild(item);
    });

    verificarSelecao();
}

function verificarSelecao() {
    var selected = document.querySelectorAll('.result-item input:checked');
    var btn = document.querySelector('.btn-aneel.download');
    if (btn) btn.disabled = selected.length === 0;
}

function toggleSelectAll() {
    var selectAll = document.getElementById('select-all');
    if (!selectAll) return;

    document.querySelectorAll('.result-item input[type="checkbox"]').forEach(function (checkbox) {
        checkbox.checked = selectAll.checked;
    });
    verificarSelecao();
}

function baixarSelecionados() {
    var cbs = document.querySelectorAll('.result-item input:checked');
    if (cbs.length === 0) return;

    var shapeName = document.getElementById('uploadedShapeName').value;
    var stateUF = document.getElementById('brazil_states').value;
    var latMinVal = document.getElementById('lat_min').value;
    var willCrop = shapeName || (stateUF && stateUF !== 'BR') || latMinVal !== '';
    var btn = document.querySelector('.btn-aneel.download');
    var totalSizeMB = 0;

    cbs.forEach(function (checkbox) {
        var sizeDiv = checkbox.closest('.result-info').querySelector('.result-size');
        var match = sizeDiv && (sizeDiv.innerText || sizeDiv.textContent).match(/([\d.]+)\s*MB/);
        if (match) totalSizeMB += parseFloat(match[1]);
    });

    var sizeDisplay = totalSizeMB >= 1024
        ? (totalSizeMB / 1024).toFixed(2) + ' GB'
        : totalSizeMB.toFixed(2) + ' MB';

    if (willCrop) {
        showToast(cbs.length + ' arquivo(s), ' + sizeDisplay + '. Preparando recortes...', 'info', 5000);
        btn.disabled = true;
        var originalCropText = btn.innerHTML;
        setButton(btn, 'loader-circle', 'Preparando...');

        var product = document.getElementById('produto').value;
        var sub = getSelectedSubproduct(product);
        var areaName = getAreaName(shapeName, stateUF);
        var today = new Date().toISOString().split('T')[0];
        var finalZipName = 'SWOT_' + product + '_' + sub + '_' + areaName + '_' + today;
        var tasks = Array.from(cbs).map(function (checkbox) {
            return {
                url: checkbox.value,
                statusId: checkbox.id.replace('cb-', 'status-'),
                shape: shapeName,
                state: stateUF !== 'BR' ? stateUF : '',
                lon_min: document.getElementById('lon_min').value,
                lat_min: document.getElementById('lat_min').value,
                lon_max: document.getElementById('lon_max').value,
                lat_max: document.getElementById('lat_max').value
            };
        });

        processarFilaDownloads(tasks, btn, originalCropText, finalZipName);
        return;
    }

    showToast(cbs.length + ' arquivo(s), ' + sizeDisplay + '. Iniciando download...', 'info', 4000);
    btn.disabled = true;
    var originalText = btn.innerHTML;
    setButton(btn, 'loader-circle', 'Baixando...');

    fetch('/baixar_selecionados', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ arquivos: Array.from(cbs).map(function (checkbox) { return checkbox.value; }) })
    })
    .then(function (response) { return response.json(); })
    .then(function (data) {
        showToast(data.message, data.status === 'success' ? 'success' : 'error', 6000);
    })
    .catch(function () {
        showToast('Erro no download. Verifique o servidor.', 'error');
    })
    .finally(function () {
        btn.disabled = false;
        btn.innerHTML = originalText;
        renderIcons();
    });
}

function getSelectedSubproduct(product) {
    if (product === 'RiverSP') return document.querySelector('#sub-river select[name="subproduto"]').value;
    if (product === 'LakeSP') return document.querySelector('#sub-lake select[name="subproduto"]').value;
    if (product === 'Raster') return document.querySelector('#sub-raster select[name="resolucao"]').value;
    if (product === 'PIXC') return 'Nuvem';
    return 'Dados';
}

function getAreaName(shapeName, stateUF) {
    if (shapeName) return shapeName.split('.').slice(0, -1).join('.').replace(/[^a-zA-Z0-9_-]/g, '') || 'Area';
    if (stateUF && stateUF !== 'BR') return stateUF;
    return 'AreaLivre';
}

async function processarFilaDownloads(tarefas, btn, textoOriginal, nomeFinalZip) {
    var fileHandle = null;

    if (window.showSaveFilePicker) {
        try {
            fileHandle = await window.showSaveFilePicker({
                suggestedName: nomeFinalZip + '.zip',
                types: [{ description: 'Arquivo ZIP', accept: { 'application/zip': ['.zip'] } }]
            });
        } catch (error) {
            btn.disabled = false;
            btn.innerHTML = textoOriginal;
            renderIcons();
            return;
        }
    } else {
        showToast('O navegador salvará o arquivo na pasta Downloads.', 'warning', 5000);
    }

    setButton(btn, 'loader-circle', 'Processando (0/' + tarefas.length + ')...');

    var zip = new JSZip();
    var counts = { salvos: 0, vazios: 0, erros: 0 };
    var report = '========================================\n'
        + 'RELATÓRIO DE DOWNLOAD - SWOT NASA\n'
        + '========================================\n'
        + 'Data: ' + new Date().toLocaleString() + '\n'
        + 'Total de arquivos: ' + tarefas.length + '\n\n';
    var results = new Array(tarefas.length);
    var concurrency = 3;
    var nextIndex = 0;
    var finished = 0;

    async function worker() {
        while (nextIndex < tarefas.length) {
            var i = nextIndex++;
            var task = tarefas[i];
            results[i] = await baixarRecortado(task.url, task.statusId, task.shape, task.state, task.lon_min, task.lat_min, task.lon_max, task.lat_max);
            finished++;
            setButton(btn, 'loader-circle', 'Processando (' + finished + '/' + tarefas.length + ')...');
        }
    }

    var workers = [];
    for (var w = 0; w < Math.min(concurrency, tarefas.length); w++) workers.push(worker());
    await Promise.all(workers);

    results.forEach(function (result, i) {
        var fileName = tarefas[i].url.split('/').pop().split('?')[0];
        report += '> ' + fileName + '\n  Status: ' + result.msg + '\n\n';

        if (result.tipo === 'salvo') {
            counts.salvos++;
            if (result.blob && result.nomeFinal) zip.file(result.nomeFinal, result.blob);
        } else if (result.tipo === 'vazio') {
            counts.vazios++;
        } else {
            counts.erros++;
        }
    });

    report += '========================================\n'
        + 'RESUMO:\n'
        + '- Baixados: ' + counts.salvos + '\n'
        + '- Sem sobreposição: ' + counts.vazios + '\n'
        + '- Falhas: ' + counts.erros + '\n';
    zip.file('Relatorio_SWOT.txt', report);

    setButton(btn, 'archive', 'Salvando ZIP...');

    try {
        var content = await zip.generateAsync({ type: 'blob' });
        if (fileHandle) {
            var writable = await fileHandle.createWritable();
            await writable.write(content);
            await writable.close();
            showToast('ZIP salvo com sucesso. Baixados: ' + counts.salvos + ', sem dados: ' + counts.vazios + '.', 'success', 7000);
        } else {
            baixarBlob(content, nomeFinalZip + '.zip');
        }
    } catch (error) {
        showToast('Erro ao gravar o arquivo ZIP.', 'error');
    }

    btn.disabled = false;
    btn.innerHTML = textoOriginal;
    renderIcons();
}

async function baixarRecortado(url, statusId, shape, stateUF, lonMin, latMin, lonMax, latMax) {
    var statusSpan = document.getElementById(statusId);
    if (statusSpan) {
        statusSpan.innerText = 'Recortando...';
        statusSpan.style.color = '#d36b00';
    }

    var controller = new AbortController();
    var timeout = setTimeout(function () { controller.abort(); }, 3 * 60 * 1000);

    try {
        var reqBody = { granule_url: url };
        if (shape) reqBody.shape_filename = shape;
        if (stateUF) reqBody.state_uf = stateUF;
        if (lonMin !== '') {
            reqBody.lon_min = lonMin;
            reqBody.lat_min = latMin;
            reqBody.lon_max = lonMax;
            reqBody.lat_max = latMax;
        }

        var response = await fetch('/download_cropped', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(reqBody),
            signal: controller.signal
        });
        clearTimeout(timeout);

        if (response.ok) {
            var contentType = response.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                var data = await response.json();
                if (data.status === 'no_data') {
                    if (statusSpan) {
                        statusSpan.innerText = 'Sem sobreposição';
                        statusSpan.style.color = '#7a5200';
                        statusSpan.title = 'Sem sobreposição na área de interesse';
                    }
                    return { tipo: 'vazio', msg: 'Sem sobreposição na área de interesse.' };
                }
            }

            var blob = await response.blob();
            var originalName = url.split('/').pop().split('?')[0];
            var nameWithoutExt = originalName.substring(0, originalName.lastIndexOf('.')) || originalName;
            var ext = '.geojson';
            var lowerUrl = url.toLowerCase();
            if (lowerUrl.includes('.zip')) ext = '.zip';
            if (lowerUrl.includes('.nc')) ext = '.nc';
            if (lowerUrl.includes('.gpkg')) ext = '.gpkg';

            if (statusSpan) {
                statusSpan.innerText = 'Salvo';
                statusSpan.style.color = '#16834a';
            }
            return { tipo: 'salvo', msg: 'Recorte efetuado com sucesso.', blob: blob, nomeFinal: 'recorte_' + nameWithoutExt + ext };
        }

        var err = await response.json().catch(function () { return {}; });
        var errorMessage = err.error || 'Erro desconhecido';
        if (statusSpan) {
            statusSpan.innerText = 'Falha';
            statusSpan.style.color = '#c92a3a';
            statusSpan.title = errorMessage;
        }
        return { tipo: 'erro', msg: 'Falha: ' + errorMessage };
    } catch (error) {
        clearTimeout(timeout);
        var msg = error.name === 'AbortError'
            ? 'Timeout: servidor demorou mais de 3 minutos.'
            : 'Falha de comunicação com o servidor.';
        if (statusSpan) {
            statusSpan.innerText = error.name === 'AbortError' ? 'Timeout' : 'Sem conexão';
            statusSpan.style.color = '#c92a3a';
        }
        return { tipo: 'erro', msg: msg };
    }
}

function baixarBlob(blob, nome) {
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = nome;
    anchor.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

map.on('click', function (e) {
    if (Object.keys(activeLayers).length === 0) return;

    var clickPoint = turf.point([e.latlng.lng, e.latlng.lat]);
    var foundFeatures = [];
    var toleranceKm = 2000 / Math.pow(2, map.getZoom());

    Object.keys(activeLayers).forEach(function (layerKey) {
        var layerGroup = activeLayers[layerKey];
        layerGroup.eachLayer(function (layer) {
            if (!layer.feature || !layer.feature.geometry) return;
            if (featureMatchesClick(layer.feature, clickPoint, toleranceKm)) {
                foundFeatures.push({
                    title: layerGroup.options.customTitle || layerKey,
                    props: layer.feature.properties || {}
                });
            }
        });
    });

    if (foundFeatures.length > 0) showMultiPopup(foundFeatures, e.latlng);
});

function featureMatchesClick(feature, clickPoint, toleranceKm) {
    var geom = feature.geometry;
    var type = geom.type;

    try {
        if (type === 'Point') return pointNear(clickPoint, geom.coordinates, toleranceKm);
        if (type === 'MultiPoint') {
            return geom.coordinates.some(function (coord) {
                return pointNear(clickPoint, coord, toleranceKm);
            });
        }
        if (type === 'LineString' || type === 'MultiLineString') return lineNear(clickPoint, feature, geom, toleranceKm);
        if (type === 'Polygon' || type === 'MultiPolygon') return polygonNear(clickPoint, feature, toleranceKm);
    } catch (error) {
        return false;
    }

    return false;
}

function pointNear(clickPoint, coord, toleranceKm) {
    return turf.distance(clickPoint, turf.point([coord[0], coord[1]]), { units: 'kilometers' }) <= toleranceKm;
}

function lineNear(clickPoint, feature, geom, toleranceKm) {
    try {
        return turf.pointToLineDistance(clickPoint, feature, { units: 'kilometers' }) <= toleranceKm;
    } catch (error) {
        var coords = geom.type === 'LineString' ? [geom.coordinates] : geom.coordinates;
        return coords.some(function (line) {
            return line.some(function (coord) {
                return pointNear(clickPoint, coord, toleranceKm);
            });
        });
    }
}

function polygonNear(clickPoint, feature, toleranceKm) {
    if (turf.booleanPointInPolygon(clickPoint, feature)) return true;

    try {
        var lines = turf.polygonToLine(feature);
        var lineFeatures = lines.type === 'FeatureCollection' ? lines.features : [lines];
        return lineFeatures.some(function (line) {
            return turf.pointToLineDistance(clickPoint, line, { units: 'kilometers' }) <= toleranceKm;
        });
    } catch (error) {
        return false;
    }
}

function showMultiPopup(features, latlng) {
    var html = '<div class="popup-wrapper">';

    if (features.length === 1) {
        html += buildFeatureTable(features[0].title, features[0].props);
    } else {
        html += '<div class="popup-tabs">';
        features.forEach(function (feature, idx) {
            html += '<button type="button" class="multi-tab-btn ' + (idx === 0 ? 'active' : '') + '" data-idx="' + idx + '">'
                + escHtml(feature.title)
                + '</button>';
        });
        html += '</div><div id="multi-popup-contents">';
        features.forEach(function (feature, idx) {
            html += '<div class="multi-tab-pane ' + (idx === 0 ? '' : 'hidden') + '" id="pane-' + idx + '">';
            html += buildFeatureTable(feature.title, feature.props);
            html += '</div>';
        });
        html += '</div>';
    }

    html += '</div>';
    L.popup({ maxHeight: window.innerHeight * 0.5 }).setLatLng(latlng).setContent(html).openOn(map);
    setTimeout(bindPopupTabs, 0);
}

function buildFeatureTable(title, props) {
    var html = '<div class="feature-title">' + escHtml(title) + '</div>';
    html += '<table class="feature-table">';

    Object.keys(props).forEach(function (key) {
        var value = props[key];
        var displayValue = value === null || value === '' ? '-' : escHtml(String(value));
        html += '<tr><td class="feature-key">' + escHtml(key) + '</td><td class="feature-value">' + displayValue + '</td></tr>';
    });

    html += '</table>';
    return html;
}

window.switchTabPopup = function (activeIdx) {
    document.querySelectorAll('.multi-tab-btn').forEach(function (btn) {
        var isActive = parseInt(btn.getAttribute('data-idx'), 10) === activeIdx;
        btn.classList.toggle('active', isActive);
    });

    document.querySelectorAll('.multi-tab-pane').forEach(function (pane, idx) {
        pane.classList.toggle('hidden', idx !== activeIdx);
    });
};

function bindPopupTabs() {
    document.querySelectorAll('.multi-tab-btn').forEach(function (button) {
        button.addEventListener('click', function () {
            window.switchTabPopup(parseInt(button.getAttribute('data-idx'), 10));
        });
    });
}

function bindEvents() {
    document.querySelectorAll('[data-tab]').forEach(function (button) {
        button.addEventListener('click', function () {
            switchTab(button.getAttribute('data-tab'));
        });
    });

    var manualButton = document.querySelector('[data-action="manual"]');
    if (manualButton) manualButton.addEventListener('click', toggleManual);

    document.getElementById('close-manual').addEventListener('click', toggleManual);
    document.getElementById('produto').addEventListener('change', toggleSubproducts);
    document.getElementById('userShapeInput').addEventListener('change', uploadShape);
    document.getElementById('brazil_states').addEventListener('change', aplicarFiltroEstado);
    document.getElementById('start_date').addEventListener('change', validarDatas);
    document.getElementById('end_date').addEventListener('change', validarDatas);
    document.getElementById('clear-area').addEventListener('click', limparArea);
    document.getElementById('search-button').addEventListener('click', buscarDados);
    document.getElementById('btn-download-selected').addEventListener('click', baixarSelecionados);
    document.getElementById('reset-search').addEventListener('click', resetarConsulta);
    document.getElementById('select-all').addEventListener('change', toggleSelectAll);

    document.querySelectorAll('input[name="basemap_sel"]').forEach(function (radio) {
        radio.addEventListener('change', function () {
            trocarBasemap(radio.value);
        });
    });

    document.querySelectorAll('[data-layer]').forEach(function (checkbox) {
        checkbox.addEventListener('change', function () {
            toggleCamada(
                checkbox,
                checkbox.getAttribute('data-layer'),
                checkbox.getAttribute('data-title'),
                checkbox.getAttribute('data-color'),
                checkbox.getAttribute('data-kind')
            );
        });
    });
}

bindEvents();
renderIcons();

window.switchTab = switchTab;
window.toggleManual = toggleManual;
window.limparArea = limparArea;
window.buscarDados = buscarDados;
