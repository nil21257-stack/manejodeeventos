// app.js — Controlador principal de la interfaz. Sin frameworks, sin backend.
(function () {
  'use strict';

  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  let editingGuestId = null;
  let movingGuestId = null;
  let pendingImportRows = [];

  // ---------------- Navegación ----------------
  function showView(name) {
    $$('.view').forEach(v => v.classList.remove('active'));
    $('#view-' + name).classList.add('active');
    $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  }
  $$('.tab-btn').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));

  // ---------------- Encabezado / evento ----------------
  function renderHeader() {
    const ev = DB.event;
    $('#eventTitle').textContent = ev.name || 'Mi evento';
    $('#eventSubtitle').textContent = ev.date
      ? new Date(ev.date + 'T00:00').toLocaleDateString('es-DO', { day: 'numeric', month: 'long', year: 'numeric' })
      : 'Sin fecha definida';
  }

  // ---------------- Invitados ----------------
  function initials(name) {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
  }

  function renderGuests() {
    const q = $('#searchInput').value.trim().toLowerCase();
    const guests = DB.guests
      .filter(g => !q || g.nombre.toLowerCase().includes(q) || g.mesa.toLowerCase().includes(q))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

    const list = $('#guestList');
    list.innerHTML = '';
    guests.forEach(g => {
      const li = document.createElement('li');
      li.className = 'guest-row';
      li.innerHTML = `
        <div class="guest-avatar">${initials(g.nombre) || '?'}</div>
        <div class="guest-info">
          <div class="guest-name"></div>
          <div class="guest-table ${g.mesa ? '' : 'unassigned'}"></div>
        </div>
        <span class="chevron">›</span>`;
      li.querySelector('.guest-name').textContent = g.nombre;
      li.querySelector('.guest-table').textContent = g.mesa || 'Sin mesa asignada';
      li.addEventListener('click', () => openGuestModal(g.id));
      list.appendChild(li);
    });

    $('#emptyGuests').classList.toggle('hidden', DB.guests.length > 0);
    list.classList.toggle('hidden', DB.guests.length === 0);

    const total = DB.guests.length;
    const mesas = new Set(DB.guests.filter(g => g.mesa).map(g => g.mesa.toLowerCase())).size;
    const sinMesa = DB.guests.filter(g => !g.mesa).length;
    $('#statTotal').textContent = total;
    $('#statMesas').textContent = mesas;
    $('#statSinMesa').textContent = sinMesa;
  }
  $('#searchInput').addEventListener('input', renderGuests);

  // ---------------- Modal invitado ----------------
  function openGuestModal(id) {
    editingGuestId = id;
    const modal = $('#modalGuest');
    if (id) {
      const g = DB.guests.find(x => x.id === id);
      $('#modalGuestTitle').textContent = 'Editar invitado';
      $('#guestNameInput').value = g.nombre;
      $('#guestTableInput').value = g.mesa;
      $('#btnDeleteGuest').classList.remove('hidden');
    } else {
      $('#modalGuestTitle').textContent = 'Nuevo invitado';
      $('#guestNameInput').value = '';
      $('#guestTableInput').value = '';
      $('#btnDeleteGuest').classList.add('hidden');
    }
    fillTableSuggestions();
    modal.classList.remove('hidden');
    setTimeout(() => $('#guestNameInput').focus(), 50);
  }
  function closeGuestModal() { $('#modalGuest').classList.add('hidden'); editingGuestId = null; }

  function fillTableSuggestions() {
    const dl = $('#tableSuggestions');
    dl.innerHTML = '';
    DB.tables.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.name;
      dl.appendChild(opt);
    });
  }

  $('#btnAddGuest').addEventListener('click', () => openGuestModal(null));
  $('#btnCancelGuest').addEventListener('click', closeGuestModal);
  $('#btnSaveGuest').addEventListener('click', () => {
    const nombre = $('#guestNameInput').value.trim();
    const mesa = $('#guestTableInput').value.trim();
    if (!nombre) { toast('Escribe el nombre del invitado'); return; }
    if (editingGuestId) DB.updateGuest(editingGuestId, nombre, mesa);
    else DB.addGuest(nombre, mesa);
    closeGuestModal();
    renderAll();
    toast('Guardado');
  });
  $('#btnDeleteGuest').addEventListener('click', () => {
    if (!editingGuestId) return;
    if (confirm('¿Eliminar este invitado?')) {
      DB.deleteGuest(editingGuestId);
      closeGuestModal();
      renderAll();
      toast('Invitado eliminado');
    }
  });

  // ---------------- Mesas ----------------
  function renderTables() {
    const floor = $('#tablesFloor');
    floor.innerHTML = '';
    const tables = DB.tables.slice().sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));

    tables.forEach(t => {
      const guests = DB.guests.filter(g => g.mesa.toLowerCase() === t.name.toLowerCase());
      const card = document.createElement('div');
      card.className = 'table-card' + (guests.length === 0 ? ' empty' : '');
      card.innerHTML = `
        <div class="table-name"></div>
        <div class="table-count">${guests.length} invitado${guests.length === 1 ? '' : 's'}</div>
        <div class="table-chips"></div>`;
      card.querySelector('.table-name').textContent = t.name;
      const chipsWrap = card.querySelector('.table-chips');
      guests.slice(0, 8).forEach(g => {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.textContent = g.nombre;
        chip.addEventListener('click', ev => { ev.stopPropagation(); openMoveModal(g.id); });
        chipsWrap.appendChild(chip);
      });
      if (guests.length > 8) {
        const more = document.createElement('span');
        more.className = 'chip';
        more.textContent = `+${guests.length - 8} más`;
        chipsWrap.appendChild(more);
      }
      card.addEventListener('click', () => {
        if (confirm(`¿Eliminar la mesa "${t.name}"? Sus invitados quedarán sin mesa asignada.`)) {
          DB.deleteTable(t.id);
          renderAll();
        }
      });
      floor.appendChild(card);
    });

    $('#emptyTables').classList.toggle('hidden', tables.length > 0);
  }

  $('#btnAddTable').addEventListener('click', () => {
    $('#newTableName').value = '';
    $('#modalTable').classList.remove('hidden');
    setTimeout(() => $('#newTableName').focus(), 50);
  });
  $('#btnCancelTable').addEventListener('click', () => $('#modalTable').classList.add('hidden'));
  $('#btnSaveTable').addEventListener('click', () => {
    const name = $('#newTableName').value.trim();
    if (!name) { toast('Escribe un nombre para la mesa'); return; }
    DB.addTable(name);
    $('#modalTable').classList.add('hidden');
    renderAll();
    toast('Mesa creada');
  });

  // ---------------- Mover invitado ----------------
  function openMoveModal(guestId) {
    movingGuestId = guestId;
    const g = DB.guests.find(x => x.id === guestId);
    $('#moveGuestName').textContent = `${g.nombre} — mesa actual: ${g.mesa || 'sin asignar'}`;
    const wrap = $('#moveTableOptions');
    wrap.innerHTML = '';
    DB.tables.forEach(t => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'move-chip' + (t.name.toLowerCase() === g.mesa.toLowerCase() ? ' selected' : '');
      chip.textContent = t.name;
      chip.addEventListener('click', () => {
        $$('.move-chip').forEach(c => c.classList.remove('selected'));
        chip.classList.add('selected');
        $('#moveNewTable').value = '';
        chip.dataset.chosen = '1';
      });
      wrap.appendChild(chip);
    });
    $('#moveNewTable').value = '';
    $('#modalMove').classList.remove('hidden');
  }
  $('#btnCancelMove').addEventListener('click', () => $('#modalMove').classList.add('hidden'));
  $('#btnConfirmMove').addEventListener('click', () => {
    const newTableTyped = $('#moveNewTable').value.trim();
    const chosenChip = $('.move-chip.selected');
    const mesa = newTableTyped || (chosenChip ? chosenChip.textContent : '');
    if (!mesa) { toast('Elige o escribe una mesa'); return; }
    DB.moveGuest(movingGuestId, mesa);
    $('#modalMove').classList.add('hidden');
    renderAll();
    toast('Invitado movido');
  });

  // ---------------- Ajustes ----------------
  $('#btnSettings').addEventListener('click', () => {
    $('#settingsEventName').value = DB.event.name || '';
    $('#settingsEventDate').value = DB.event.date || '';
    $('#modalSettings').classList.remove('hidden');
  });
  $('#btnCancelSettings').addEventListener('click', () => $('#modalSettings').classList.add('hidden'));
  $('#btnSaveSettings').addEventListener('click', () => {
    DB.saveEvent($('#settingsEventName').value, $('#settingsEventDate').value);
    $('#modalSettings').classList.add('hidden');
    renderHeader();
    toast('Ajustes guardados');
  });
  $('#btnClearAll').addEventListener('click', () => {
    if (confirm('Esto borrará TODOS los invitados y mesas de este dispositivo. ¿Continuar?')) {
      DB.clearAll();
      $('#modalSettings').classList.add('hidden');
      renderAll();
      toast('Datos borrados');
    }
  });
  $('#btnExportBackup').addEventListener('click', () => {
    const blob = new Blob([DB.exportBackup()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'respaldo-evento.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  // ---------------- Importar ----------------
  let currentImportMode = null;

  $$('.import-card').forEach(card => {
    card.addEventListener('click', () => {
      const mode = card.dataset.mode;
      currentImportMode = mode;
      hideImportPanels();
      if (mode === 'excel') $('#fileExcel').click();
      else if (mode === 'pdf') $('#filePdf').click();
      else if (mode === 'foto') $('#fileFoto').click();
      else if (mode === 'texto') {
        $('#rawTextArea').value = '';
        $('#importReview').classList.remove('hidden');
        setTimeout(() => $('#rawTextArea').focus(), 50);
      }
    });
  });

  function hideImportPanels() {
    $('#importStatus').classList.add('hidden');
    $('#importReview').classList.add('hidden');
    $('#importPreview').classList.add('hidden');
  }

  function setStatus(msg, isError) {
    const el = $('#importStatus');
    el.textContent = msg;
    el.classList.remove('hidden');
    el.classList.toggle('error', !!isError);
  }

  $('#fileExcel').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setStatus('Leyendo archivo…');
    try {
      const { rows } = await Importers.parseExcel(file);
      if (!rows.length) { setStatus('No se encontraron filas con nombres en el archivo.', true); return; }
      showPreview(rows);
      $('#importStatus').classList.add('hidden');
    } catch (err) {
      console.error(err);
      setStatus('No se pudo leer el archivo. Verifica que sea un Excel o CSV válido.', true);
    }
  });

  $('#filePdf').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setStatus('Extrayendo texto del PDF…');
    try {
      const { rawText } = await Importers.parsePdf(file);
      if (!rawText.trim()) { setStatus('No se detectó texto seleccionable en ese PDF. Prueba con Foto/Escaneo.', true); return; }
      $('#importStatus').classList.add('hidden');
      $('#rawTextArea').value = rawText;
      $('#importReview').classList.remove('hidden');
    } catch (err) {
      console.error(err);
      setStatus('No se pudo leer el PDF.', true);
    }
  });

  $('#fileFoto').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setStatus('Reconociendo texto en la imagen… esto puede tardar unos segundos.');
    try {
      const { rawText } = await Importers.parseImage(file, m => {
        if (m.status === 'recognizing text') {
          setStatus(`Reconociendo texto… ${Math.round((m.progress || 0) * 100)}%`);
        }
      });
      if (!rawText.trim()) { setStatus('No se detectó texto en la imagen. Intenta con mejor luz o más de cerca.', true); return; }
      $('#importStatus').classList.add('hidden');
      $('#rawTextArea').value = rawText;
      $('#importReview').classList.remove('hidden');
    } catch (err) {
      console.error(err);
      setStatus('No se pudo procesar la imagen. Si es la primera vez, se necesita conexión para descargar el modelo de reconocimiento.', true);
    }
  });

  $('#btnParseText').addEventListener('click', () => {
    const text = $('#rawTextArea').value;
    const rows = Importers.parseFreeText(text);
    if (!rows.length) { toast('No se detectaron nombres en el texto'); return; }
    showPreview(rows);
  });

  function showPreview(rows) {
    pendingImportRows = rows;
    $('#importReview').classList.add('hidden');
    $('#importPreview').classList.remove('hidden');
    $('#previewCount').textContent = rows.length;
    const list = $('#previewList');
    list.innerHTML = '';
    rows.forEach((r, i) => {
      const row = document.createElement('div');
      row.className = 'preview-row';
      row.innerHTML = `
        <input class="pname" type="text" value="${escapeAttr(r.nombre)}">
        <input class="ptable" type="text" value="${escapeAttr(r.mesa || '')}" placeholder="mesa">
        <button class="prm" aria-label="Quitar">✕</button>`;
      row.querySelector('.pname').addEventListener('input', e => rows[i].nombre = e.target.value);
      row.querySelector('.ptable').addEventListener('input', e => rows[i].mesa = e.target.value);
      row.querySelector('.prm').addEventListener('click', () => {
        rows[i]._removed = true;
        row.remove();
        $('#previewCount').textContent = rows.filter(r => !r._removed).length;
      });
      list.appendChild(row);
    });
  }

  function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  $('#btnConfirmImport').addEventListener('click', () => {
    const rows = pendingImportRows.filter(r => !r._removed && r.nombre && r.nombre.trim());
    if (!rows.length) { toast('No hay invitados para importar'); return; }
    const replace = $('#replaceExisting').checked;
    DB.bulkImport(rows, replace);
    hideImportPanels();
    $('#replaceExisting').checked = false;
    renderAll();
    showView('invitados');
    toast(`${rows.length} invitado${rows.length === 1 ? '' : 's'} importado${rows.length === 1 ? '' : 's'}`);
  });

  // ---------------- Toast ----------------
  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 2200);
  }

  // ---------------- Render global ----------------
  function renderAll() {
    renderHeader();
    renderGuests();
    renderTables();
  }

  renderAll();

  // ---------------- Service worker (offline) ----------------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW no registrado:', err));
    });
  }
})();
