let nodes = [];
let calculationResults = [];
let isRunning = false;
let isPaused = false;
let isStopped = false;
let currentIndex = 0; // To track where we are if we pause

const fileInput = document.getElementById('fileInput');
const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const stopBtn = document.getElementById('stopBtn');
const saveBtn = document.getElementById('saveBtn');
const progressInfo = document.getElementById('progressInfo');

// Handle File Upload & Reset State
fileInput.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;

    // 1. Reset everything for the new file
    stopCalculation(); 
    nodes = [];
    calculationResults = [];
    currentIndex = 0;
    document.querySelector('#resultsTable tbody').innerHTML = '';
    document.getElementById('emptyState').style.display = 'block';
    progressInfo.style.display = 'none';
    saveBtn.disabled = true;

    document.getElementById('fileName').innerText = file.name;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, {type: 'array'});
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(sheet);

        nodes = json.map(row => ({
            name: row['Склад'] || row['Название'] || row['Node'] || row['Name'] || row['ID'] || 'Unnamed',
            lat: parseFloat(row['Широта'] || row['Lat'] || row['Latitude']),
            lng: parseFloat(row['Довгота'] || row['Lng'] || row['Longitude'])
        })).filter(n => !isNaN(n.lat) && !isNaN(n.lng));

        if (nodes.length > 0) {
            prepareRoutes();
            startBtn.disabled = false;
            startBtn.innerText = "Start";
        }
    };
    reader.readAsArrayBuffer(file);
});

// Updated logic to calculate all permutations (A -> B and B -> A)
function prepareRoutes() {
    const tbody = document.querySelector('#resultsTable tbody');
    tbody.innerHTML = '';
    calculationResults = [];
    document.getElementById('emptyState').style.display = 'none';

    let idCounter = 0;
    for (let i = 0; i < nodes.length; i++) {
        for (let j = 0; j < nodes.length; j++) {
            // Skip calculating distance to the same node
            if (i === j) continue; 

            const res = {
                id: idCounter,
                from: nodes[i],
                to: nodes[j],
                distance: '—',
                duration: '—'
            };
            calculationResults.push(res);
            
            const row = document.createElement('tr');
            row.id = `row-${idCounter}`;
            row.innerHTML = `
                <td>${res.from.name}</td>
                <td>${res.to.name}</td>
                <td class="dist-cell pending">—</td>
                <td class="time-cell pending">—</td>
            `;
            tbody.appendChild(row);
            idCounter++;
        }
    }
    
    progressInfo.style.display = 'block';
    document.getElementById('currentProgress').innerText = '0';
    document.getElementById('totalProgress').innerText = calculationResults.length;
}

async function startCalculation() {
    if (isRunning && !isPaused) return;
    
    const provider = document.getElementById('providerSelect').value;
    const apiKey = document.getElementById('apiKeyInput').value;

    if (provider === 'routestripe' && !apiKey) {
        alert("Please enter RouteStripe API Key");
        return;
    }

    isRunning = true;
    isPaused = false;
    isStopped = false;
    
    startBtn.style.display = 'none';
    pauseBtn.style.display = 'inline-block';
    stopBtn.style.display = 'inline-block';
    saveBtn.disabled = true;

    for (let i = currentIndex; i < calculationResults.length; i++) {
        if (isStopped) break;
        while (isPaused && !isStopped) { await new Promise(r => setTimeout(r, 100)); }
        if (isStopped) break;

        currentIndex = i;
        const item = calculationResults[i];
        const rowEl = document.getElementById(`row-${item.id}`);

        try {
            let resultData;
            if (provider === 'osrm') {
                resultData = await fetchOSRM(item);
            } else {
                resultData = await fetchRouteStripe(item, apiKey);
            }

            if (resultData) {
                item.distance = resultData.distance;
                item.duration = resultData.duration;

                const distCell = rowEl.querySelector('.dist-cell');
                const timeCell = rowEl.querySelector('.time-cell');

                distCell.innerText = item.distance;
                distCell.classList.remove('pending');
                distCell.style.color = 'var(--accent)';
                
                timeCell.innerText = item.duration;
                timeCell.classList.remove('pending');
            }

            document.getElementById('currentProgress').innerText = i + 1;
            // Short delay to avoid rate limiting
            await new Promise(r => setTimeout(r, provider === 'osrm' ? 200 : 100)); 
        } catch (err) {
            console.error("API Error:", err);
        }
    }
    finishLogic();
}

async function fetchOSRM(item) {
    const url = `https://router.project-osrm.org/route/v1/driving/${item.from.lng},${item.from.lat};${item.to.lng},${item.to.lat}?overview=false`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.code === 'Ok') {
        return {
            distance: (data.routes[0].distance / 1000).toFixed(2),
            duration: (data.routes[0].duration / 60).toFixed(1)
        };
    }
    return null;
}

async function fetchRouteStripe(item, key) {
    const url = "https://test-app.routestripe.com/api/route-matrix";
    const body = {
        "fleet": {
            "veh1": {
                "name": item.from.name,
                "profile": "auto",
                "shift_start": "00:00",
                "shift_end": "23:59",
                "start_location": {"id": item.from.name, "lng": item.from.lng, "lat": item.from.lat}
            }
        },
        "visits": {
            "dest1": {
                "type": "D",
                "start": "00:00",
                "end": "23:59",
                "duration": 0,
                "location": {"lng": item.to.lng, "lat": item.to.lat}
            }
        },
        "options": {"polylines": false, "avoid_tolls": false, "avoid_highways": false},
        "country_id": 1
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'api-key': key,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    const data = await response.json();
    
    // Logic from your Python script to get distance
    let distance = data.total_distance;
    
    // Fallback logic if total_distance is 0 or null
    if (!distance && data.solution) {
        for (const veh in data.solution) {
            for (const step of data.solution[veh]) {
                if (step.distance > 0) {
                    distance = step.distance;
                    break;
                }
            }
            if (distance) break;
        }
    }

    return {
        distance: distance ? distance.toFixed(2) : "0.00",
        duration: "—" // RouteStripe logic can be extended to find duration too
    };
}


function togglePause() {
    isPaused = !isPaused;
    pauseBtn.innerText = isPaused ? "Resume" : "Pause";
    pauseBtn.classList.toggle('paused-state', isPaused);
}

function stopCalculation() {
    isStopped = true;
    isPaused = false;
    isRunning = false;
    finishLogic();
}

function finishLogic() {
    isRunning = false;
    startBtn.style.display = 'inline-block';
    startBtn.innerText = isStopped ? "Restart" : (currentIndex >= calculationResults.length - 1 ? "Done" : "Start");
    if (currentIndex >= calculationResults.length - 1) startBtn.disabled = true;
    
    pauseBtn.style.display = 'none';
    pauseBtn.innerText = "Pause";
    pauseBtn.classList.remove('paused-state');
    stopBtn.style.display = 'none';
    
    if (calculationResults.some(r => r.distance !== '—')) {
        saveBtn.disabled = false;
    }
}

function exportToExcel() {
    const exportData = calculationResults
        .filter(r => r.distance !== '—')
        .map(r => ({
            "Node 1": r.from.name,
            "Node 2": r.to.name,
            "Distance (km)": r.distance,
            "Time (min)": r.duration
        }));
    
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Distances");
    XLSX.writeFile(wb, "Distances_Results.xlsx");
}

function toggleApiKeyField() {
    const provider = document.getElementById('providerSelect').value;
    document.getElementById('apiKeyInput').style.display = (provider === 'routestripe') ? 'inline-block' : 'none';
}