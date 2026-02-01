// 1. KONFIGURASI AWAL
Cesium.Ion.defaultAccessToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiIzY2ZhMGQ3MS1mYzYwLTQ1NzktODY1Mi1lODRhZjRmMWE4Y2EiLCJpZCI6Mzg0MjAyLCJpYXQiOjE3Njk1Njg5ODJ9.5U2zZd_um-3-iYrpnfZg1Xt7eI7N_CPTCQHoa2xB0jQ";

const viewer = new Cesium.Viewer('cesiumContainer', {
    terrain: Cesium.Terrain.fromWorldTerrain(),
});

let activePoints = []; 
let labelsList = []; // Untuk menyimpan label agar mudah dihapus
let profileChart = null;
let contourDataSource = null;
let isContourVisible = false;
let isDragging = false;
let draggedEntity = null;

// 2. LOAD ASSET
async function init() {
    try {
        const tileset = await Cesium.Cesium3DTileset.fromIonAssetId(4406223);
        viewer.scene.primitives.add(tileset);
        viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(107.6258056, -6.8698692729, 990),
            orientation: { heading: Cesium.Math.toRadians(0), pitch: Cesium.Math.toRadians(-15.0), roll: 0.0 },
            duration: 2
        });

        const resource1 = await Cesium.IonResource.fromAssetId(4406181);
        dataSource1 = await Cesium.GeoJsonDataSource.load(resource1, {clampToGround: true });
        await viewer.dataSources.add(dataSource1);
    } catch (e) { console.error(e); }
}
init();

// 3. FUNGSI PERHITUNGAN BEARING
function getBearing(start, end) {
    const s = Cesium.Cartographic.fromCartesian(start);
    const e = Cesium.Cartographic.fromCartesian(end);
    const y = Math.sin(e.longitude - s.longitude) * Math.cos(e.latitude);
    const x = Math.cos(s.latitude) * Math.sin(e.latitude) - Math.sin(s.latitude) * Math.cos(e.latitude) * Math.cos(e.longitude - s.longitude);
    return (Cesium.Math.toDegrees(Math.atan2(y, x)) + 360) % 360;
}

// 4. UPDATE VISUAL & LABEL (VERSI LABEL DI TITIK AWAL)
function updateVisuals() {
    // Hapus semua label lama
    labelsList.forEach(l => viewer.entities.remove(l));
    labelsList = [];

    if (activePoints.length < 2) return;

    // Gambar ulang garis utama
    const lineId = 'dynamicLine';
    if (!viewer.entities.getById(lineId)) {
        viewer.entities.add({
            id: lineId,
            polyline: {
                // Menggunakan CallbackProperty agar garis 'elastis' saat titik ditarik
                positions: new Cesium.CallbackProperty(() => {
                    return activePoints.map(p => p.position);
                }, false),
                width: 4,
                material: Cesium.Color.YELLOW,
                clampToGround: true
            }
        });
    }

    // Iterasi untuk membuat label
    for (let i = 1; i < activePoints.length; i++) {
        const pStart = activePoints[i-1].position; // Titik Awal Segmen
        const pEnd = activePoints[i].position;     // Titik Akhir Segmen
        
        const cStart = Cesium.Cartographic.fromCartesian(pStart);
        const cEnd = Cesium.Cartographic.fromCartesian(pEnd);

        const dist = Cesium.Cartesian3.distance(pStart, pEnd);
        const deltaH = cEnd.height - cStart.height;
        const bearing = getBearing(pStart, pEnd);
        const slope = (deltaH / dist) * 100;

        // A. Label JARAK (Tetap di tengah segmen)
        const midPos = Cesium.Cartesian3.lerp(pStart, pEnd, 0.5, new Cesium.Cartesian3());
        const distLabel = viewer.entities.add({
            position: midPos,
            label: {
                text: `${dist.toFixed(1)} m`,
                font: 'bold 16pt "Arial Black", Gadget, sans-serif',
                fillColor: Cesium.Color.AQUA,
                outlineWidth: 4,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                heightReference: Cesium.HeightReference.clampToHeightMostDetailed,
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            }
        });
        labelsList.push(distLabel);

        // B. Label INFO DETAIL (diletakkan di pStart / Titik Awal Segmen)
        const infoLabel = viewer.entities.add({
            position: pStart,
            label: {
                text: `ARAH: ${bearing.toFixed(1)}°\nKEMIRINGAN: ${slope.toFixed(1)}%\nΔTINGGI: ${deltaH.toFixed(1)}m`,
                font: 'bold 14pt "Arial Black", Gadget, sans-serif',
                fillColor: Cesium.Color.WHITE,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 4,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                showBackground: true,
                backgroundColor: new Cesium.Color(0, 0, 0, 0.5), // Hitam transparan 50%
                backgroundPadding: new Cesium.Cartesian2(7, 5), // Jarak teks ke pinggir kotak
                pixelOffset: new Cesium.Cartesian2(0, -50), // Offset agak tinggi agar tidak tumpang tindih
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM
            }
        });
        labelsList.push(infoLabel);
    }
    generateMultiPointProfile();
}
// 5. EVENT HANDLER KLIK
// --- REVISI EVENT HANDLER UNTUK SUPPORT HP & DESKTOP ---

const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
const viewerControls = viewer.scene.screenSpaceCameraController;

// 1. FUNGSI UNTUK MENAMBAH TITIK (Klik/Tap Baru)
handler.setInputAction(async function (movement) {
    
    const infoBox = document.getElementById('toolbar-info');
    if (infoBox) {
        infoBox.style.display = 'none'; 
    }
    // Jika sedang nge-drag, jangan buat titik baru
    if (isDragging) return;

    const cartesian = viewer.scene.pickPosition(movement.position);
    if (!Cesium.defined(cartesian)) return;

    const v = viewer.entities.add({
        position: cartesian,
        point: { 
            pixelSize: 20, // Diperbesar agar mudah di-tap di HP
            color: Cesium.Color.GREEN, 
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 3,
            disableDepthTestDistance: Number.POSITIVE_INFINITY 
        }
    });
    
    activePoints.push({ position: cartesian, entity: v });
    updateVisuals();
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);

// 2. MULAI GESER (Support Mouse Down & Touch Start)
// Di mobile, LEFT_DOWN otomatis terpicu saat jari menyentuh layar
handler.setInputAction(function(click) {
    const pickedObject = viewer.scene.pick(click.position);
    if (Cesium.defined(pickedObject) && pickedObject.id && pickedObject.id.point) {
        isDragging = true;
        draggedEntity = pickedObject.id;
        
        // KUNCI KAMERA: Sangat penting di HP agar layar tidak ikut goyang saat geser titik
        viewerControls.enableInputs = false; 
    }
}, Cesium.ScreenSpaceEventType.LEFT_DOWN);

// 3. PROSES GESER (Support Mouse Move & Touch Move)
handler.setInputAction(function(movement) {
    if (isDragging && draggedEntity) {
        // Gunakan endPosition untuk posisi jari/mouse terbaru
        const cartesian = viewer.scene.pickPosition(movement.endPosition);
        if (Cesium.defined(cartesian)) {
            draggedEntity.position = cartesian;
            
            // Update data di array agar garis ikut bergerak
            const pointData = activePoints.find(p => p.entity === draggedEntity);
            if (pointData) pointData.position = cartesian;

            updateVisuals(); 
        }
    }
}, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

// 4. SELESAI GESER (Support Mouse Up & Touch End)
handler.setInputAction(function() {
    if (isDragging) {
        isDragging = false;
        draggedEntity = null;
        
        // AKTIFKAN KEMBALI KAMERA
        viewerControls.enableInputs = true; 
        
        generateMultiPointProfile();
    }
}, Cesium.ScreenSpaceEventType.LEFT_UP);

// 6. MULTI-POINT PROFILE
async function generateMultiPointProfile() {
    const totalSamples = 50;
    const labels = [];
    const heights = [];
    const positions = activePoints.map(p => p.position);
    
    let totalDist = 0;
    for (let i = 0; i < positions.length - 1; i++) totalDist += Cesium.Cartesian3.distance(positions[i], positions[i+1]);

    let cumDist = 0;
    for (let i = 0; i < positions.length - 1; i++) {
        const start = positions[i];
        const end = positions[i+1];
        const segD = Cesium.Cartesian3.distance(start, end);
        const segS = Math.max(2, Math.floor((segD / totalDist) * totalSamples));

        for (let j = 0; j < segS; j++) {
            const r = j / segS;
            const p = Cesium.Cartesian3.lerp(start, end, r, new Cesium.Cartesian3());
            const cl = await viewer.scene.clampToHeightMostDetailed([p]);
            if (cl[0]) {
                const h = Cesium.Cartographic.fromCartesian(cl[0]).height;
                labels.push((cumDist + (r * segD)).toFixed(1) + "m");
                heights.push(h);
            }
        }
        cumDist += segD;
    }
    document.getElementById('chartContainer').style.display = 'block';
    renderChart(labels, heights);
}

function renderChart(labels, data) {
    const ctx = document.getElementById('profileChart').getContext('2d');
    if (profileChart) profileChart.destroy();
    profileChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Elevasi Kumulatif (m)',
                data: data,
                borderColor: '#2ecc71',
                backgroundColor: 'rgba(46, 204, 113, 0.2)',
                fill: true,
                tension: 0.1,
                pointRadius: 0
            }]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });
}

// 7. KONTUR & CLEAR
document.getElementById('contourBtn').addEventListener('click', async function() {
    isContourVisible = !isContourVisible;
    this.innerText = `Tampilkan Kontur: ${isContourVisible ? 'ON' : 'OFF'}`;
    this.style.background = isContourVisible ? '#e74c3c' : '#2c3e50';

    try {
        if (!contourDataSource) {
            console.log("Loading Contour with Elevation Grading...");
            const resource = await Cesium.IonResource.fromAssetId(4406299);
            contourDataSource = await Cesium.GeoJsonDataSource.load(resource, {clampToGround: true });

            const entities = contourDataSource.entities.values;
            let minH = Infinity, maxH = -Infinity;

            // Tahap 1: Scan Min/Max Elevation
            entities.forEach(e => {
                const h = e.properties.Kontur ? parseFloat(e.properties.Kontur.getValue()) : null;
                if (h !== null && !isNaN(h)) {
                    if (h < minH) minH = h;
                    if (h > maxH) maxH = h;
                }
            });

            // Tahap 2: Apply Gradasi Biru (Rendah) ke Merah (Tinggi) & Label
            // ... (Bagian Scan Min/Max tetap sama) ...

    entities.forEach(e => {
        const h = e.properties.Kontur ? parseFloat(e.properties.Kontur.getValue()) : 0;
        let ratio = (h - minH) / (maxH - minH);
        if (isNaN(ratio)) ratio = 0;

        const color = Cesium.Color.fromHsl(0.6 * (1.0 - ratio), 1.0, 0.5);

        if (e.polyline) {
            e.polyline.material = color;
            e.polyline.width = 2;
            e.polyline.classificationType = Cesium.ClassificationType.BOTH;

        // Kita ambil titik tengah dari koordinat garis untuk menaruh label
            const positions = e.polyline.positions.getValue();
            if (positions && positions.length > 0) {
                const centerIndex = Math.floor(positions.length / 2);
                const centerPos = positions[centerIndex];

                e.position = centerPos; // Menentukan posisi label pada entity
                e.label = {
                    text: h.toString(),
                    font: 'bold 10pt Verdana, Geneva, sans-serif',
                    fillColor: Cesium.Color.WHITE,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 3,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                // heightReference sangat penting agar tidak tenggelam di bawah terrain
                    heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND, 
                    eyeOffset: new Cesium.ConstantProperty(new Cesium.Cartesian3(0, 0, -1)), // Memaksa label tampil sedikit di depan garis
                    disableDepthTestDistance: Number.POSITIVE_INFINITY, // Label tembus pandang terhadap objek lain
                    distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 150)
                    };
                }
            }
        });
        }

        isContourVisible ? viewer.dataSources.add(contourDataSource) : viewer.dataSources.remove(contourDataSource);
    } catch (err) { console.error("Contour Load Error:", err); }
});

document.getElementById('clearBtn').addEventListener('click', () => {
    activePoints.forEach(p => viewer.entities.remove(p.entity));
    labelsList.forEach(l => viewer.entities.remove(l));
    if (viewer.entities.getById('dynamicLine')) viewer.entities.removeById('dynamicLine');
    activePoints = []; labelsList = [];
    if (profileChart) profileChart.destroy();
    document.getElementById('chartContainer').style.display = 'none';
    const infoBox = document.getElementById('toolbar-info');
    if (infoBox) {
        infoBox.style.display = 'block'; 
    }
});