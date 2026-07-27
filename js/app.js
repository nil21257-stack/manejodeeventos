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

  let currentFilter = 'todos';

  function buildGuestRow(g, onCheckinToggle) {
    const li = document.createElement('li');
    li.className = 'guest-row';
    li.innerHTML = `
      <div class="guest-avatar ${g.llego ? 'checked' : ''}" title="Marcar llegada">${g.llego ? '✓' : (initials(g.nombre) || '?')}</div>
      <div class="guest-info">
        <div class="guest-name"></div>
        <div class="guest-table ${g.mesa ? '' : 'unassigned'}"></div>
      </div>
      <span class="chevron">›</span>`;
    li.querySelector('.guest-name').textContent = g.nombre;
    li.querySelector('.guest-table').textContent = g.mesa || 'Sin mesa asignada';
    li.querySelector('.guest-avatar').addEventListener('click', ev => {
      ev.stopPropagation();
      DB.toggleCheckin(g.id);
      if (onCheckinToggle) onCheckinToggle(); else renderAll();
    });
    li.addEventListener('click', () => openGuestModal(g.id));
    return li;
  }

  function renderGuests() {
    const q = $('#searchInput').value.trim().toLowerCase();
    let guests = DB.guests
      .filter(g => !q || g.nombre.toLowerCase().includes(q) || g.mesa.toLowerCase().includes(q));
    if (currentFilter === 'llegaron') guests = guests.filter(g => g.llego);
    else if (currentFilter === 'faltan') guests = guests.filter(g => !g.llego);
    guests = guests.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

    const list = $('#guestList');
    list.innerHTML = '';
    guests.forEach(g => list.appendChild(buildGuestRow(g)));

    $('#emptyGuests').classList.toggle('hidden', DB.guests.length > 0);
    list.classList.toggle('hidden', DB.guests.length === 0);

    const total = DB.guests.length;
    const mesas = new Set(DB.guests.filter(g => g.mesa).map(g => g.mesa.toLowerCase())).size;
    const sinMesa = DB.guests.filter(g => !g.mesa).length;
    const llegaron = DB.guests.filter(g => g.llego).length;
    $('#statTotal').textContent = total;
    $('#statMesas').textContent = mesas;
    $('#statSinMesa').textContent = sinMesa;
    $('#statLlegaron').textContent = llegaron;
  }
  $('#searchInput').addEventListener('input', renderGuests);
  $$('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      currentFilter = chip.dataset.filter;
      $$('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      renderGuests();
    });
  });

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
    const dups = DB.findDuplicates(nombre, editingGuestId);
    if (dups.length && !confirm(`Ya existe "${dups[0].nombre}"${dups[0].mesa ? ' en ' + dups[0].mesa : ''}. ¿Agregar de todas formas?`)) {
      return;
    }
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
  let editingTableId = null;
  let detailTableId = null;

  function tableSummaryText(t, guests) {
    if (t.etiqueta) return t.etiqueta;
    if (!guests.length) return 'Sin invitados aún';
    const names = guests.slice(0, 2).map(g => g.nombre).join(' y ');
    return guests.length > 2 ? `${names} +${guests.length - 2} más` : names;
  }

  function renderTables() {
    const floor = $('#tablesFloor');
    floor.innerHTML = '';
    const tables = DB.tables.slice().sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));

    tables.forEach(t => {
      const guests = DB.guestsInTable(t.name);
      const over = t.capacidad != null && guests.length > t.capacidad;
      const card = document.createElement('div');
      card.className = 'table-card' + (guests.length === 0 ? ' empty' : '') + (over ? ' overbooked' : '');
      const occText = t.capacidad != null
        ? `${guests.length}/${t.capacidad} asientos`
        : `${guests.length} invitado${guests.length === 1 ? '' : 's'}`;
      card.innerHTML = `
        <div class="table-name"></div>
        <div class="table-summary"></div>
        <div class="table-occupancy ${over ? 'full' : ''}"></div>`;
      card.querySelector('.table-name').textContent = t.name;
      card.querySelector('.table-summary').textContent = tableSummaryText(t, guests);
      card.querySelector('.table-occupancy').textContent = occText;
      card.addEventListener('click', () => openTableDetail(t.id));
      floor.appendChild(card);
    });

    $('#emptyTables').classList.toggle('hidden', tables.length > 0);
  }

  function openTableDetail(tableId) {
    detailTableId = tableId;
    const t = DB.tables.find(x => x.id === tableId);
    if (!t) return;
    const guests = DB.guestsInTable(t.name).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    $('#detailTableName').textContent = t.name;
    const occText = t.capacidad != null
      ? `${guests.length}/${t.capacidad} asientos ocupados`
      : `${guests.length} invitado${guests.length === 1 ? '' : 's'}`;
    $('#detailTableOccupancy').textContent = occText;

    const list = $('#detailGuestList');
    list.innerHTML = '';
    guests.forEach(g => {
      const li = buildGuestRow(g, () => openTableDetail(tableId));
      const moveBtn = document.createElement('button');
      moveBtn.className = 'move-btn';
      moveBtn.textContent = 'Mover';
      moveBtn.addEventListener('click', ev => { ev.stopPropagation(); openMoveModal(g.id, () => openTableDetail(tableId)); });
      li.insertBefore(moveBtn, li.querySelector('.chevron'));
      li.querySelector('.chevron').remove();
      list.appendChild(li);
    });
    $('#detailEmpty').classList.toggle('hidden', guests.length > 0);
    list.classList.toggle('hidden', guests.length === 0);

    $('#modalTableDetail').classList.remove('hidden');
  }
  $('#btnCloseTableDetail').addEventListener('click', () => $('#modalTableDetail').classList.add('hidden'));
  $('#btnEditTable').addEventListener('click', () => {
    $('#modalTableDetail').classList.add('hidden');
    openTableModal(detailTableId);
  });

  function openTableModal(tableId) {
    editingTableId = tableId || null;
    const t = tableId ? DB.tables.find(x => x.id === tableId) : null;
    $('#modalTableTitle').textContent = t ? 'Editar mesa' : 'Nueva mesa';
    $('#newTableName').value = t ? t.name : '';
    $('#newTableCapacity').value = (t && t.capacidad != null) ? t.capacidad : '';
    $('#newTableLabel').value = t ? t.etiqueta : '';
    $('#btnDeleteTable').classList.toggle('hidden', !t);
    $('#modalTable').classList.remove('hidden');
    setTimeout(() => $('#newTableName').focus(), 50);
  }

  $('#btnAddTable').addEventListener('click', () => openTableModal(null));
  $('#btnCancelTable').addEventListener('click', () => $('#modalTable').classList.add('hidden'));
  $('#btnSaveTable').addEventListener('click', () => {
    const name = $('#newTableName').value.trim();
    const capacidad = $('#newTableCapacity').value.trim();
    const etiqueta = $('#newTableLabel').value.trim();
    if (!name) { toast('Escribe un nombre para la mesa'); return; }
    if (editingTableId) DB.updateTable(editingTableId, name, capacidad, etiqueta);
    else DB.addTable(name, capacidad, etiqueta);
    $('#modalTable').classList.add('hidden');
    renderAll();
    toast('Mesa guardada');
  });
  $('#btnDeleteTable').addEventListener('click', () => {
    if (!editingTableId) return;
    const t = DB.tables.find(x => x.id === editingTableId);
    if (confirm(`¿Eliminar la mesa "${t.name}"? Sus invitados quedarán sin mesa asignada.`)) {
      DB.deleteTable(editingTableId);
      $('#modalTable').classList.add('hidden');
      renderAll();
      toast('Mesa eliminada');
    }
  });

  // ---------------- Mover invitado ----------------
  let moveDoneCallback = null;
  function openMoveModal(guestId, onDone) {
    movingGuestId = guestId;
    moveDoneCallback = onDone || null;
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
    if (moveDoneCallback) { renderAll(); moveDoneCallback(); }
    else renderAll();
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
    setStatus('Preparando imagen…');
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
    renderPreviewList(rows);
  }

  function renderPreviewList(rows) {
    const seen = new Map(); // normalizedName -> primer índice visto
    let dupCount = 0;
    rows.forEach((r, i) => {
      if (r._removed) return;
      const key = normalizeName(r.nombre);
      if (!key) return;
      const existingInDb = DB.findDuplicates(r.nombre).length > 0;
      const repeatedInBatch = seen.has(key);
      r._dup = existingInDb || repeatedInBatch;
      if (r._dup) dupCount++;
      if (!repeatedInBatch) seen.set(key, i);
    });

    $('#previewCount').textContent = rows.filter(r => !r._removed).length;
    $('#previewDupInfo').textContent = dupCount ? `, ${dupCount} posible${dupCount === 1 ? '' : 's'} duplicado${dupCount === 1 ? '' : 's'}` : '';
    $('#btnRemoveDuplicates').classList.toggle('hidden', dupCount === 0);

    const list = $('#previewList');
    list.innerHTML = '';
    rows.forEach((r, i) => {
      if (r._removed) return;
      const row = document.createElement('div');
      row.className = 'preview-row' + (r._dup ? ' duplicate' : '');
      row.innerHTML = `
        <input class="pname" type="text" value="${escapeAttr(r.nombre)}">
        <input class="ptable" type="text" value="${escapeAttr(r.mesa || '')}" placeholder="mesa">
        ${r._dup ? '<span class="dup-tag">duplicado</span>' : ''}
        <button class="prm" aria-label="Quitar">✕</button>`;
      row.querySelector('.pname').addEventListener('input', e => { rows[i].nombre = e.target.value; });
      row.querySelector('.ptable').addEventListener('input', e => rows[i].mesa = e.target.value);
      row.querySelector('.prm').addEventListener('click', () => {
        rows[i]._removed = true;
        renderPreviewList(rows);
      });
      list.appendChild(row);
    });
  }

  $('#btnRemoveDuplicates').addEventListener('click', () => {
    let removed = 0;
    pendingImportRows.forEach(r => {
      if (r._dup && !r._removed) { r._removed = true; removed++; }
    });
    renderPreviewList(pendingImportRows);
    toast(`${removed} duplicado${removed === 1 ? '' : 's'} quitado${removed === 1 ? '' : 's'}`);
  });

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
