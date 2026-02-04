let nodes = [];
let calculationResults = [];

// 1. Обработка файла и формирование списка пар
document.getElementById('fileInput').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;

    document.getElementById('fileName').innerText = file.name;
    const reader = new FileReader();
    reader.onload = function(e) {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, {type: 'array'});
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(sheet);

        nodes = json.map(row => ({
            name: row['Склад'] || row['Название'] || row['Node'] || row['Вузол'] || row['Name'] || row['ID'],
            lat: parseFloat(row['Широта'] || row['Lat'] || row['Latitude']),
            lng: parseFloat(row['Довгота'] || row['Lng'] || row['Longitude'])
        })).filter(n => !isNaN(n.lat) && !isNaN(n.lng));

        if (nodes.length > 0) {
            prepareRoutes(); // Формируем список сразу
            document.getElementById('startBtn').disabled = false;
        }
    };
    reader.readAsArrayBuffer(file);
});

// Формируем все возможные комбинации и выводим их в таблицу
function prepareRoutes() {
    const tbody = document.querySelector('#resultsTable tbody');
    tbody.innerHTML = '';
    calculationResults = [];
    document.getElementById('emptyState').style.display = 'none';

    let index = 0;
    for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
            const res = {
                id: index,
                from: nodes[i],
                to: nodes[j],
                distance: '—',
                duration: '—'
            };
            calculationResults.push(res);
            
            const row = document.createElement('tr');
            row.id = `row-${index}`;
            row.innerHTML = `
                <td>${res.from.name}</td>
                <td>${res.to.name}</td>
                <td class="dist-cell pending">${res.distance}</td>
                <td class="time-cell pending">${res.duration}</td>
            `;
            tbody.appendChild(row);
            index++;
        }
        const progBox = document.getElementById('progressInfo');
        progBox.style.display = 'block';
        document.getElementById('currentProgress').innerText = '0';
        document.getElementById('totalProgress').innerText = calculationResults.length;
    }
}

// 2. Постепенный расчет
async function startCalculation() {
    document.getElementById('startBtn').disabled = true;

    for (let i = 0; i < calculationResults.length; i++) {
        const item = calculationResults[i];
        const rowEl = document.getElementById(`row-${item.id}`);

        try {
            const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${item.from.lng},${item.from.lat};${item.to.lng},${item.to.lat}?overview=false`);
            const data = await response.json();

            if (data.code === 'Ok') {
                const dist = (data.routes[0].distance / 1000).toFixed(2);
                const dur = (data.routes[0].duration / 60).toFixed(1);

                // Обновляем данные в массиве
                item.distance = dist;
                item.duration = dur;

                // Обновляем ячейки в таблице
                const distCell = rowEl.querySelector('.dist-cell');
                const timeCell = rowEl.querySelector('.time-cell');

                distCell.innerText = dist;
                distCell.classList.remove('pending');
                distCell.style.color = 'var(--accent)';
                
                timeCell.innerText = dur;
                timeCell.classList.remove('pending');
            }
            document.getElementById('currentProgress').innerText = i + 1;
            // Пауза 200мс для соблюдения лимитов API
            await new Promise(r => setTimeout(r, 200));
        } catch (err) {
            console.error("Query error:", err);
        }
    }
    
    document.getElementById('startBtn').innerText = "Done";
}

function exportToExcel() {
    if (!calculationResults.some(r => r.distance !== '—')) return alert("No calculated data");
    
    const exportData = calculationResults.map(r => ({
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