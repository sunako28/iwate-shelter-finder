document.addEventListener('DOMContentLoaded', () => {
    const statusBox = document.getElementById('status-message');
    const shelterListEl = document.getElementById('shelter-list');
    const recenterBtn = document.getElementById('recenter-btn');

    let map;
    let userMarker;
    let shelterMarkers = [];
    let allShelters = [];
    let userLat = null;
    let userLng = null;

    // --- Configuration ---
    const CSV_FILE = '03000_1.csv';
    const DEFAULT_LAT = 39.7036; // Iwate Prefectural Office
    const DEFAULT_LNG = 141.1570;
    const MAX_SHELTERS_TO_SHOW = 20;

    // --- 1. Initialize Map ---
    function initMap(lat, lng, zoom = 13) {
        map = L.map('map').setView([lat, lng], zoom);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(map);

        return map;
    }

    // --- 2. Fetch and Parse CSV ---
    async function loadShelterData() {
        try {
            const response = await fetch(CSV_FILE);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status} ${response.statusText}`);
            }
            const csvText = await response.text();

            return new Promise((resolve, reject) => {
                Papa.parse(csvText, {
                    header: true,
                    skipEmptyLines: true,
                    complete: function (results) {
                        if (results.data && results.data.length > 0) {
                            console.log(`Loaded ${results.data.length} shelters.`);
                            allShelters = results.data.map(row => ({
                                name: row['施設・場所名'],
                                address: row['住所'],
                                lat: parseFloat(row['緯度']),
                                lng: parseFloat(row['経度']),
                                type: row['受入対象者'] || '全般',
                                remarks: row['備考']
                            })).filter(s => !isNaN(s.lat) && !isNaN(s.lng));
                            resolve(allShelters);
                        } else {
                            reject('CSV data is empty or invalid.');
                        }
                    },
                    error: function (err) {
                        reject('CSV Parsing Error: ' + err.message);
                    }
                });
            });
        } catch (error) {
            console.error('Fetch error:', error);
            // Check if it looks like a CORS/file protocol error
            if (error.message.includes('Failed to fetch') || !error.message) {
                throw new Error('ファイルの読み込みに失敗しました。ローカルサーバー経由でアクセスしているか確認してください。(CORS/File protocol restrictions)');
            }
            throw error;
        }
    }

    // --- 3. Geolocation ---
    function getUserLocation() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject('Geolocation is not supported by your browser.');
            } else {
                navigator.geolocation.getCurrentPosition(
                    (position) => {
                        resolve({
                            lat: position.coords.latitude,
                            lng: position.coords.longitude
                        });
                    },
                    (error) => {
                        console.warn('Geolocation error:', error);
                        reject('位置情報の取得に失敗しました。デフォルトの位置を表示します。');
                    },
                    {
                        enableHighAccuracy: true,
                        timeout: 10000,
                        maximumAge: 0
                    }
                );
            }
        });
    }

    // --- 4. Distance Calculation (Haversine) ---
    function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
        const R = 6371; // Radius of the earth in km
        const dLat = deg2rad(lat2 - lat1);
        const dLon = deg2rad(lon2 - lon1);
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const d = R * c; // Distance in km
        return d;
    }

    function deg2rad(deg) {
        return deg * (Math.PI / 180);
    }

    // --- 5. Update UI (Map & List) ---
    function updateUI() {
        // Clear existing shelter markers
        shelterMarkers.forEach(m => map.removeLayer(m));
        shelterMarkers = [];
        shelterListEl.innerHTML = '';

        // Calculate distances
        allShelters.forEach(s => {
            s.distance = getDistanceFromLatLonInKm(userLat, userLng, s.lat, s.lng);
        });

        // Sort by distance
        allShelters.sort((a, b) => a.distance - b.distance);

        // Take top N
        const nearestShelters = allShelters.slice(0, MAX_SHELTERS_TO_SHOW);

        // Render List & Markers
        nearestShelters.forEach((s, index) => {
            // Add Marker
            const marker = L.marker([s.lat, s.lng]).addTo(map);
            marker.bindPopup(`<b>${s.name}</b><br>${s.address}<br>距離: ${s.distance.toFixed(2)} km`);

            // Marker Click Event: Scroll List
            marker.on('click', () => {
                const targetCard = document.getElementById(`shelter-card-${index}`);
                if (targetCard) {
                    // Highlight logic
                    document.querySelectorAll('.shelter-card').forEach(c => c.classList.remove('selected'));
                    targetCard.classList.add('selected');
                    targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            });

            shelterMarkers.push(marker);

            // Add List Item
            const card = document.createElement('div');
            card.id = `shelter-card-${index}`;
            card.className = 'shelter-card';
            card.innerHTML = `
                <div class="shelter-info">
                    <h3>${index + 1}. ${s.name}</h3>
                    <div class="shelter-addr">📍 ${s.address}</div>
                </div>
                <div class="shelter-dist">
                    <span class="dist-badge">${s.distance.toFixed(2)} km</span>
                    <span class="walk-time">🚶 約${Math.ceil(s.distance * 15)}分</span> 
                </div>
            `; // Assumes 4km/h walking speed -> 1km = 15min roughly

            card.addEventListener('click', () => {
                map.setView([s.lat, s.lng], 16);
                marker.openPopup();
                // Highlight itself
                document.querySelectorAll('.shelter-card').forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');

                // Mobile: Scroll map into view smoothly?
                const mapSection = document.querySelector('.map-section');
                if (window.innerWidth < 768) {
                    mapSection.scrollIntoView({ behavior: 'smooth' });
                }
            });

            shelterListEl.appendChild(card);
        });

        statusBox.textContent = `現在地周辺 ${MAX_SHELTERS_TO_SHOW}件の避難所を表示中`;
        statusBox.className = 'status-box';
    }

    // --- Main Logic Flow ---
    (async function main() {
        try {
            // Load Data first
            await loadShelterData();

            // Init Map (Default View)
            initMap(DEFAULT_LAT, DEFAULT_LNG, 10);

            // Get User Location
            try {
                const position = await getUserLocation();
                userLat = position.lat;
                userLng = position.lng;

                // Update Map View
                map.setView([userLat, userLng], 14);

                // Add User Marker (Blue Circle or special icon)
                const userIcon = L.divIcon({
                    className: 'user-location-marker',
                    html: '<div style="background-color:#007bff; width:16px; height:16px; border-radius:50%; border:3px solid white; box-shadow: 0 0 5px rgba(0,0,0,0.5);"></div>',
                    iconSize: [20, 20]
                });

                userMarker = L.marker([userLat, userLng], { icon: userIcon }).addTo(map);
                userMarker.bindPopup('<b>現在地</b>').openPopup();

                updateUI();

            } catch (geoError) {
                statusBox.textContent = geoError;
                statusBox.classList.add('error');
                // Even if geo fails, we might want to show defaults or let user search? 
                // For now, logic defaults to Iwate Prefectural Office for map center, but distance can't be calc'd accurately without user pos.
                // Could implement a fallback "Show all" or "Center of Data" logic if needed.
                console.error(geoError);
                // Fallback: Use default lat/lng as 'user' pos for demo purposes or keep empty?
                // Let's set user pos to Default for demonstration content if geo fails.
                userLat = DEFAULT_LAT;
                userLng = DEFAULT_LNG;
                updateUI();
                statusBox.textContent = '位置情報が取得できませんでした。岩手県庁周辺を表示します。';
            }

        } catch (err) {
            console.error(err);
            statusBox.textContent = 'エラーが発生しました: ' + err;
            statusBox.classList.add('error');
        }
    })();

    // Recenter Button
    recenterBtn.addEventListener('click', () => {
        if (userLat && userLng) {
            map.setView([userLat, userLng], 14);
            if (userMarker) userMarker.openPopup();
        } else {
            alert('現在地が特定されていません。');
        }
    });
});
