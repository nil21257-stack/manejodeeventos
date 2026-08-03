// app.js — Controlador principal de la interfaz. Sin frameworks, sin backend.
(function () {
  'use strict';

  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  // Números de RD (y todo el plan NANP: +1) casi siempre se escriben en el Form como
  // 10 dígitos sin el código de país (ej. "809-601-8142"). WhatsApp necesita el número
  // completo para encontrar el chat, así que si detectamos exactamente 10 dígitos,
  // asumimos que falta el "1" y se lo agregamos. Si ya viene con código de país
  // (11 dígitos empezando en 1, o más largo para otros países), se deja tal cual.
  function normalizePhoneForWhatsapp(telefono) {
    let digits = (telefono || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.length === 10) digits = '1' + digits;
    return digits;
  }

  // Paleta de tonos joya dentro del mismo esquema esmeralda/oro/vino de la app —
  // le da variedad a los avatares sin romper la identidad visual.
  const AVATAR_PALETTE = ['#164C4A', '#4A2E4F', '#5C4A2E', '#2E3B5C', '#5C2E3B', '#2E5C46'];
  function avatarColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
  }

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
    let dateStr = ev.date
      ? new Date(ev.date + 'T00:00').toLocaleDateString('es-DO', { day: 'numeric', month: 'long', year: 'numeric' })
      : 'Sin fecha definida';
    if (ev.hora) dateStr += `, ${ev.hora}`;
    $('#eventSubtitle').textContent = ev.lugar ? `${dateStr} · ${ev.lugar}` : dateStr;
  }

  // ---------------- Invitados ----------------
  function initials(name) {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
  }

  let currentFilter = 'todos';
  let selectionMode = false;
  let selectedIds = new Set();

  function isAutoCompanionName(g) {
    if (!g.companionOf) return false;
    const parent = DB.guests.find(x => x.id === g.companionOf);
    return parent && g.nombre === `Acompañante de ${parent.nombre}`;
  }

  function buildGuestRow(g, onCheckinToggle) {
    const li = document.createElement('li');
    const isCompanion = !!g.companionOf;
    li.className = 'guest-row' + (g.llego ? ' arrived' : '') + (selectionMode ? ' selectable' : '') + (isCompanion ? ' companion-row' : '');

    if (selectionMode) {
      const checked = selectedIds.has(g.id);
      li.innerHTML = `
        <div class="guest-checkbox ${checked ? 'checked' : ''}">✓</div>
        <div class="guest-info">
          <div class="guest-name"></div>
          <div class="guest-table ${g.mesa ? '' : 'unassigned'}"></div>
        </div>`;
      li.querySelector('.guest-name').textContent = (isCompanion ? '↳ ' : '') + (isAutoCompanionName(g) ? 'Acompañante' : (g.titulo ? `${g.titulo} ${g.nombre}` : g.nombre));
      li.querySelector('.guest-table').textContent = (g.mesa || 'Sin mesa/fila asignada') + (g.nota ? ' 📝' : '');
      li.addEventListener('click', () => {
        if (selectedIds.has(g.id)) selectedIds.delete(g.id); else selectedIds.add(g.id);
        renderGuests();
      });
      return li;
    }

    li.innerHTML = `
      <div class="guest-avatar ${g.llego ? 'checked' : ''}" title="Marcar llegada">${g.llego ? '✓' : (initials(g.nombre) || '?')}</div>
      <div class="guest-info">
        <div class="guest-name"></div>
        <div class="guest-table ${g.mesa ? '' : 'unassigned'}"></div>
        <div class="guest-badges"></div>
      </div>
      <span class="chevron">›</span>`;
    li.querySelector('.guest-name').textContent = (isCompanion ? '↳ ' : '') + (isAutoCompanionName(g) ? 'Acompañante' : (g.titulo ? `${g.titulo} ${g.nombre}` : g.nombre));
    const mesaTexto = (g.mesa || 'Sin mesa/fila asignada') + (g.asiento ? ` · Asiento ${g.asiento}` : '') + (g.nota ? ' 📝' : '');
    li.querySelector('.guest-table').textContent = mesaTexto;
    if (g.nota) li.querySelector('.guest-table').title = g.nota;
    const badgesEl = li.querySelector('.guest-badges');
    if (g.categoria) {
      const cat = document.createElement('span');
      cat.className = 'badge-categoria';
      cat.textContent = g.categoria;
      cat.style.background = avatarColor(g.categoria);
      badgesEl.appendChild(cat);
    }
    if (g.acompanante === 'si') {
      const b = document.createElement('span');
      b.className = 'badge-plusone';
      b.textContent = '+1';
      badgesEl.appendChild(b);
    }
    if (g.telefono) {
      const wa = document.createElement('button');
      wa.className = 'badge-whatsapp';
      wa.textContent = '💬';
      wa.title = 'Abrir WhatsApp';
      wa.addEventListener('click', ev => {
        ev.stopPropagation();
        window.open('https://wa.me/' + normalizePhoneForWhatsapp(g.telefono), '_blank');
      });
      badgesEl.appendChild(wa);
    }
    if (!badgesEl.children.length) badgesEl.remove();
    if (!g.llego) li.querySelector('.guest-avatar').style.background = avatarColor(g.nombre);
    li.querySelector('.guest-avatar').addEventListener('click', ev => {
      ev.stopPropagation();
      DB.toggleCheckin(g.id);
      if (onCheckinToggle) onCheckinToggle(); else renderAll();
    });
    li.addEventListener('click', () => openGuestModal(g.id));
    return li;
  }

  function renderGuests() {
    const q = normalizeName($('#searchInput').value.trim());
    let guests = DB.guests
      .filter(g => !q || normalizeName(g.nombre).includes(q) || normalizeName(g.mesa).includes(q));
    if (currentFilter === 'llegaron') guests = guests.filter(g => g.llego);
    else if (currentFilter === 'faltan') guests = guests.filter(g => !g.llego);

    // Agrupa: cada invitado principal, seguido inmediatamente de su acompañante (si pasó el filtro).
    const mains = guests.filter(g => !g.companionOf).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    const byId = new Map(guests.map(g => [g.id, g]));
    const usedCompanionIds = new Set();
    const ordered = [];
    mains.forEach(g => {
      ordered.push(g);
      if (g.companionId && byId.has(g.companionId)) {
        ordered.push(byId.get(g.companionId));
        usedCompanionIds.add(g.companionId);
      }
    });
    // Acompañantes cuyo principal no pasó el filtro (caso raro): se muestran igual, al final.
    guests.filter(g => g.companionOf && !usedCompanionIds.has(g.id)).forEach(g => ordered.push(g));

    const list = $('#guestList');
    list.innerHTML = '';
    ordered.forEach(g => list.appendChild(buildGuestRow(g)));

    $('#emptyGuests').classList.toggle('hidden', DB.guests.length > 0);
    list.classList.toggle('hidden', DB.guests.length === 0);

    const total = DB.guests.length;
    const mainCount = DB.guests.filter(g => !g.companionOf).length;
    const companionCount = total - mainCount;
    const mesas = new Set(DB.guests.filter(g => g.mesa).map(g => g.mesa.toLowerCase())).size;
    const sinMesa = DB.guests.filter(g => !g.mesa).length;
    const llegaron = DB.guests.filter(g => g.llego).length;
    const confirmados = DB.guests.filter(g => g.confirmado === 'si').length;
    $('#statTotal').textContent = total;
    $('#statTotalLabel').textContent = companionCount > 0 ? `${mainCount} + ${companionCount} acomp.` : 'invitados';
    $('#statMesas').textContent = mesas;
    $('#statSinMesa').textContent = sinMesa;
    $('#statLlegaron').textContent = llegaron;
    $('#statConfirmados').textContent = confirmados;

    if (selectionMode) {
      // Limpia selecciones de invitados que ya no están visibles/existen
      const visibleIds = new Set(guests.map(g => g.id));
      selectedIds.forEach(id => { if (!visibleIds.has(id) && !DB.guests.find(g => g.id === id)) selectedIds.delete(id); });
      $('#selectionCount').textContent = `${selectedIds.size} seleccionado${selectedIds.size === 1 ? '' : 's'}`;
    }
  }
  $('#searchInput').addEventListener('input', renderGuests);
  $$('.filter-chip[data-filter]').forEach(chip => {
    chip.addEventListener('click', () => {
      currentFilter = chip.dataset.filter;
      $$('.filter-chip[data-filter]').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      renderGuests();
    });
  });

  $('#btnToggleSelect').addEventListener('click', () => {
    selectionMode = !selectionMode;
    selectedIds.clear();
    $('#btnToggleSelect').classList.toggle('active', selectionMode);
    $('#btnToggleSelect').textContent = selectionMode ? 'Cancelar' : 'Seleccionar';
    $('#selectionBar').classList.toggle('hidden', !selectionMode);
    $('#btnAddGuest').classList.toggle('hidden', selectionMode);
    renderGuests();
  });
  $('#btnSelectAll').addEventListener('click', () => {
    const q = normalizeName($('#searchInput').value.trim());
    let guests = DB.guests.filter(g => !q || normalizeName(g.nombre).includes(q) || normalizeName(g.mesa).includes(q));
    if (currentFilter === 'llegaron') guests = guests.filter(g => g.llego);
    else if (currentFilter === 'faltan') guests = guests.filter(g => !g.llego);
    const allSelected = guests.every(g => selectedIds.has(g.id)) && guests.length > 0;
    if (allSelected) guests.forEach(g => selectedIds.delete(g.id));
    else guests.forEach(g => selectedIds.add(g.id));
    renderGuests();
  });
  $('#btnDeleteSelected').addEventListener('click', () => {
    if (!selectedIds.size) { toast('No hay invitados seleccionados'); return; }
    if (confirm(`¿Eliminar ${selectedIds.size} invitado(s) seleccionado(s)?`)) {
      const snap = DB.snapshot();
      DB.deleteGuests(Array.from(selectedIds));
      const count = selectedIds.size;
      selectedIds.clear();
      renderAll();
      toast(`${count} invitado(s) eliminado(s)`, snap);
    }
  });

  // ---------------- Modal invitado ----------------
  function openGuestModal(id) {
    editingGuestId = id;
    const modal = $('#modalGuest');
    if (id) {
      const g = DB.guests.find(x => x.id === id);
      $('#modalGuestTitle').textContent = 'Editar invitado';
      $('#guestNameInput').value = g.nombre;
      $('#guestTituloInput').value = g.titulo || '';
      $('#guestTableInput').value = g.mesa;
      $('#guestNotaInput').value = g.nota || '';
      $('#guestConfirmadoInput').value = g.confirmado || '';
      $('#guestCorreoInput').value = g.correo || '';
      $('#guestTelefonoInput').value = g.telefono || '';
      $('#guestOcupacionInput').value = g.ocupacion || '';
      $('#guestAcompananteInput').value = g.acompanante || '';
      $('#guestAcompananteLabel').classList.toggle('hidden', !!g.companionOf);
      $('#guestCategoriaInput').value = g.categoria || '';
      $('#guestAsientoInput').value = g.asiento || '';
      $('#btnDeleteGuest').classList.remove('hidden');
    } else {
      $('#modalGuestTitle').textContent = 'Nuevo invitado';
      $('#guestNameInput').value = '';
      $('#guestTituloInput').value = '';
      $('#guestTableInput').value = '';
      $('#guestNotaInput').value = '';
      $('#guestConfirmadoInput').value = '';
      $('#guestCorreoInput').value = '';
      $('#guestTelefonoInput').value = '';
      $('#guestOcupacionInput').value = '';
      $('#guestAcompananteInput').value = '';
      $('#guestAcompananteLabel').classList.remove('hidden');
      $('#guestCategoriaInput').value = '';
      $('#guestAsientoInput').value = '';
      $('#btnDeleteGuest').classList.add('hidden');
    }
    fillTableSuggestions();
    fillCategoriaSuggestions();
    updateAsientoFieldVisibility();
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

  function fillCategoriaSuggestions() {
    const dl = $('#categoriaSuggestions');
    dl.innerHTML = '';
    const cats = new Set(DB.guests.map(g => g.categoria).filter(Boolean));
    cats.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c;
      dl.appendChild(opt);
    });
  }

  // Muestra el campo "Asiento" solo si la mesa escrita es de tipo "fila"
  function updateAsientoFieldVisibility() {
    const t = DB.findTableByName($('#guestTableInput').value.trim());
    $('#guestAsientoLabel').classList.toggle('hidden', !(t && t.tipo === 'fila'));
  }
  $('#guestTableInput').addEventListener('input', updateAsientoFieldVisibility);
  $('#guestTableInput').addEventListener('change', updateAsientoFieldVisibility);

  $('#btnAddGuest').addEventListener('click', () => openGuestModal(null));
  $('#btnCancelGuest').addEventListener('click', closeGuestModal);
  $('#btnSaveGuest').addEventListener('click', () => {
    const nombre = $('#guestNameInput').value.trim();
    const mesa = $('#guestTableInput').value.trim();
    const titulo = $('#guestTituloInput').value.trim();
    const nota = $('#guestNotaInput').value.trim();
    const confirmado = $('#guestConfirmadoInput').value;
    const categoria = $('#guestCategoriaInput').value.trim();
    const asiento = $('#guestAsientoInput').value.trim();
    const extra = {
      correo: $('#guestCorreoInput').value.trim(),
      telefono: $('#guestTelefonoInput').value.trim(),
      ocupacion: $('#guestOcupacionInput').value.trim(),
      acompanante: $('#guestAcompananteInput').value,
      categoria, asiento
    };
    if (!nombre) { toast('Escribe el nombre del invitado'); return; }
    const existingGuest = editingGuestId ? DB.guests.find(x => x.id === editingGuestId) : null;
    const willCreateCompanion = extra.acompanante === 'si' && !(existingGuest && existingGuest.companionId);
    if (mesa) {
      const neededSeats = willCreateCompanion ? 2 : 1;
      const avail = DB.tableAvailability(mesa, editingGuestId);
      if (avail && avail.disponibles < neededSeats) {
        toast(`"${mesa}" no tiene espacio suficiente (necesita ${neededSeats} asientos, quedan ${avail.disponibles})`);
        return;
      }
      if (asiento && DB.seatTaken(mesa, asiento, editingGuestId)) {
        toast(`El asiento ${asiento} ya está ocupado en "${mesa}"`);
        return;
      }
    }
    const dups = DB.findDuplicates(nombre, editingGuestId);
    if (dups.length && !confirm(`Ya existe "${dups[0].nombre}"${dups[0].mesa ? ' en ' + dups[0].mesa : ''}. ¿Agregar de todas formas?`)) {
      return;
    }
    let savedGuest;
    if (editingGuestId) { DB.updateGuest(editingGuestId, nombre, mesa, titulo, nota, confirmado, extra); savedGuest = DB.guests.find(x => x.id === editingGuestId); }
    else { savedGuest = DB.addGuest(nombre, mesa, false, titulo, nota, confirmado, extra); }

    if (extra.acompanante === 'si' && !savedGuest.companionId) {
      DB.ensureCompanion(savedGuest.id);
    } else if (extra.acompanante !== 'si' && savedGuest.companionId) {
      if (confirm('Ya no trae acompañante. ¿Eliminar también la fila de su acompañante?')) {
        DB.removeCompanion(savedGuest.id);
      }
    }
    closeGuestModal();
    renderAll();
    toast('Guardado');
  });
  $('#btnOpenWhatsapp').addEventListener('click', () => {
    const digits = normalizePhoneForWhatsapp($('#guestTelefonoInput').value);
    if (!digits) { toast('Escribe un número primero'); return; }
    window.open('https://wa.me/' + digits, '_blank');
  });
  $('#btnDeleteGuest').addEventListener('click', () => {
    if (!editingGuestId) return;
    if (confirm('¿Eliminar este invitado?')) {
      const snap = DB.snapshot();
      DB.deleteGuest(editingGuestId);
      closeGuestModal();
      renderAll();
      toast('Invitado eliminado', snap);
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

      if (t.tipo === 'fila') {
        const card = document.createElement('div');
        card.className = 'fila-card' + (over ? ' overbooked' : '');
        const occText = t.capacidad != null ? `${guests.length}/${t.capacidad} asientos` : `${guests.length} invitado${guests.length === 1 ? '' : 's'}`;
        card.innerHTML = `<div class="fila-header"><span class="fila-name"></span><span class="fila-occupancy"></span></div><div class="fila-seats"></div>`;
        card.querySelector('.fila-name').textContent = t.name + (t.etiqueta ? ' — ' + t.etiqueta : '');
        card.querySelector('.fila-occupancy').textContent = occText;
        const seatsEl = card.querySelector('.fila-seats');
        const total = t.capacidad || guests.length || 0;
        for (let n = 1; n <= total; n++) {
          const g = guests.find(x => String(x.asiento || '').trim() === String(n));
          const seat = document.createElement('div');
          seat.className = 'fila-seat' + (g ? ' taken' : '');
          seat.textContent = n;
          if (g) seat.title = g.nombre;
          seatsEl.appendChild(seat);
        }
        // Invitados en esta fila sin número de asiento asignado
        const sinAsiento = guests.filter(g => !g.asiento);
        if (sinAsiento.length) {
          const warn = document.createElement('div');
          warn.className = 'fila-sin-asiento';
          warn.textContent = `⚠ ${sinAsiento.length} sin asiento asignado`;
          card.appendChild(warn);
        }
        card.addEventListener('click', () => openTableDetail(t.id));
        floor.appendChild(card);
        return;
      }

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
    $('#detailSearchInput').value = '';
    renderTableDetailList(tableId);
    $('#modalTableDetail').classList.remove('hidden');
    setTimeout(() => $('#detailSearchInput').focus(), 50);
  }

  function renderTableDetailList(tableId) {
    const t = DB.tables.find(x => x.id === tableId);
    if (!t) return;
    const allGuests = DB.guestsInTable(t.name).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    const q = normalizeName($('#detailSearchInput').value.trim());
    const guests = q ? allGuests.filter(g => normalizeName(g.nombre).includes(q)) : allGuests;

    $('#detailTableName').textContent = t.name;
    const occText = t.capacidad != null
      ? `${allGuests.length}/${t.capacidad} asientos ocupados`
      : `${allGuests.length} invitado${allGuests.length === 1 ? '' : 's'}`;
    $('#detailTableOccupancy').textContent = occText;

    const list = $('#detailGuestList');
    list.innerHTML = '';
    guests.forEach(g => {
      const li = buildGuestRow(g, () => renderTableDetailList(tableId));
      const moveBtn = document.createElement('button');
      moveBtn.className = 'move-btn';
      moveBtn.textContent = 'Mover';
      moveBtn.addEventListener('click', ev => {
        ev.stopPropagation();
        $('#modalTableDetail').classList.add('hidden');
        openMoveModal(g.id, () => openTableDetail(tableId));
      });
      li.insertBefore(moveBtn, li.querySelector('.chevron'));
      li.querySelector('.chevron').remove();
      list.appendChild(li);
    });
    $('#detailEmpty').classList.toggle('hidden', guests.length > 0);
    list.classList.toggle('hidden', guests.length === 0);
  }
  $('#detailSearchInput').addEventListener('input', () => renderTableDetailList(detailTableId));
  $('#btnCloseTableDetail').addEventListener('click', () => $('#modalTableDetail').classList.add('hidden'));

  // ---------------- Compartir ----------------
  function shareText(text, title) {
    if (navigator.share) {
      navigator.share({ title: title || 'Manejo de Eventos', text }).catch(() => {});
    } else {
      window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
    }
  }

  $('#btnShareTable').addEventListener('click', () => {
    const t = DB.tables.find(x => x.id === detailTableId);
    if (!t) return;
    const guests = DB.guestsInTable(t.name).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    let text = `${t.name}${t.etiqueta ? ' — ' + t.etiqueta : ''}\n`;
    text += `${guests.length}${t.capacidad != null ? '/' + t.capacidad : ''} invitados:\n`;
    guests.forEach((g, i) => { text += `${i + 1}. ${g.titulo ? g.titulo + ' ' : ''}${g.nombre}${g.llego ? ' ✓' : ''}\n`; });
    shareText(text, t.name);
  });

  $('#btnShareSummary').addEventListener('click', () => {
    $('#modalShareOptions').classList.remove('hidden');
  });
  $('#btnCancelShareOptions').addEventListener('click', () => $('#modalShareOptions').classList.add('hidden'));

  function loadScriptOnce(src, globalCheck) {
    return new Promise((resolve, reject) => {
      if (globalCheck()) { resolve(); return; }
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function shareOrDownloadFile(blob, filename, mimeLabel) {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename });
        return;
      } catch (e) { /* si cancela el share, cae al descargar */ }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast(`${mimeLabel} descargado — ya puedes compartirlo desde tus archivos`);
  }

  $('#btnGeneratePdf').addEventListener('click', async () => {
    $('#modalShareOptions').classList.add('hidden');
    toast('Generando PDF…');
    try {
      await loadScriptOnce('vendor/jspdf.umd.min.js', () => window.jspdf && window.jspdf.jsPDF);
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const marginX = 48;
      let y = 60;

      const ev = DB.event;
      const tables = DB.tables.slice().sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));
      const sinMesa = DB.guests.filter(g => !g.mesa);

      function ensureSpace(lines) {
        if (y + lines * 16 > pageH - 50) { doc.addPage(); y = 60; }
      }

      doc.setFont('helvetica', 'bold'); doc.setFontSize(20);
      doc.text(ev.name || 'Mi evento', marginX, y); y += 26;

      doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(90);
      let subtitle = '';
      if (ev.date) subtitle += new Date(ev.date + 'T00:00').toLocaleDateString('es-DO', { day: 'numeric', month: 'long', year: 'numeric' });
      if (ev.hora) subtitle += (subtitle ? ', ' : '') + ev.hora;
      if (ev.lugar) subtitle += (subtitle ? ' — ' : '') + ev.lugar;
      if (subtitle) { doc.text(subtitle, marginX, y); y += 18; }
      doc.text(`${DB.guests.length} invitados · ${tables.length} mesas`, marginX, y); y += 26;
      doc.setTextColor(0);

      function printGuestLine(g, i, x) {
        ensureSpace(g.correo || g.telefono || g.ocupacion ? 2 : 1);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(0);
        const prefix = g.companionOf ? '↳ ' : `${i + 1}. `;
        const label = `${prefix}${g.titulo ? g.titulo + ' ' : ''}${g.nombre}${g.asiento ? ' (Asiento ' + g.asiento + ')' : ''}${g.llego ? '  ✓' : ''}${g.acompanante === 'si' ? '  (+1)' : ''}`;
        doc.text(label, x, y); y += 13;
        const detailParts = [g.ocupacion, g.telefono, g.correo].filter(Boolean);
        if (detailParts.length) {
          doc.setFontSize(9); doc.setTextColor(120);
          doc.text(detailParts.join('  ·  '), x + 10, y); y += 13;
          doc.setTextColor(0);
        }
      }

      tables.forEach(t => {
        const guests = DB.guestsInTable(t.name).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
        ensureSpace(3);
        doc.setDrawColor(210); doc.line(marginX, y, pageW - marginX, y); y += 18;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
        const occ = t.capacidad != null ? ` (${guests.length}/${t.capacidad})` : ` (${guests.length})`;
        doc.text(`${t.name}${t.etiqueta ? ' — ' + t.etiqueta : ''}${occ}`, marginX, y); y += 18;
        if (!guests.length) { doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(140); doc.text('(sin invitados)', marginX + 12, y); doc.setTextColor(0); y += 16; }
        guests.forEach((g, i) => printGuestLine(g, i, marginX + 12));
        y += 10;
      });

      if (sinMesa.length) {
        ensureSpace(3);
        doc.setDrawColor(210); doc.line(marginX, y, pageW - marginX, y); y += 18;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
        doc.text(`Sin mesa/fila asignada (${sinMesa.length})`, marginX, y); y += 18;
        sinMesa.forEach((g, i) => printGuestLine(g, i, marginX + 12));
      }

      const blob = doc.output('blob');
      const filename = `${(ev.name || 'evento').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`;
      await shareOrDownloadFile(blob, filename, 'PDF');
    } catch (err) {
      console.error(err);
      alert('No se pudo generar el PDF.');
    }
  });

  $('#btnGenerateCsv').addEventListener('click', async () => {
    $('#modalShareOptions').classList.add('hidden');
    const csvEscape = v => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const siNoTexto = v => v === 'si' ? 'Sí' : v === 'no' ? 'No' : '';
    const rows = [['Nombre', 'Título', 'Mesa/Fila', 'Asiento', 'Categoría', 'Correo', 'WhatsApp', 'Ocupación', 'Acompañante', 'Es acompañante de', 'Confirmado', 'Llegó', 'Nota']];
    DB.guests.forEach(g => {
      const parentName = g.companionOf ? (DB.guests.find(x => x.id === g.companionOf)?.nombre || '') : '';
      rows.push([
        g.nombre, g.titulo || '', g.mesa || '', g.asiento || '', g.categoria || '', g.correo || '', g.telefono || '',
        g.ocupacion || '', siNoTexto(g.acompanante), parentName, siNoTexto(g.confirmado), g.llego ? 'Sí' : 'No', g.nota || ''
      ]);
    });
    const csv = rows.map(r => r.map(csvEscape).join(',')).join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const ev = DB.event;
    const filename = `invitados-${(ev.name || 'evento').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`;
    await shareOrDownloadFile(blob, filename, 'CSV');
  });

  $('#btnSendEmails').addEventListener('click', async () => {
    $('#modalShareOptions').classList.add('hidden');
    const ev = DB.event;
    if (!ev.emailjsService || !ev.emailjsTemplate || !ev.emailjsPublicKey) {
      if (confirm('Todavía no has configurado el envío de correos (EmailJS) para este evento. ¿Ir a Ajustes para configurarlo?')) {
        $('#btnSettings').click();
      }
      return;
    }
    if (!navigator.onLine) {
      alert('Sin conexión a internet — enviar correos necesita internet.');
      return;
    }
    const destinatarios = DB.guests.filter(g => g.correo && g.correo.trim());
    if (!destinatarios.length) {
      toast('Ningún invitado tiene correo registrado');
      return;
    }
    if (!confirm(`Se enviará la invitación por correo a ${destinatarios.length} invitado${destinatarios.length === 1 ? '' : 's'}. ¿Continuar?`)) {
      return;
    }
    try {
      await loadScriptOnce('vendor/email.min.js', () => window.emailjs);
      window.emailjs.init({ publicKey: ev.emailjsPublicKey });
    } catch (err) {
      console.error(err);
      alert('No se pudo cargar el sistema de envío de correos.');
      return;
    }

    const dateStr = ev.date ? new Date(ev.date + 'T00:00').toLocaleDateString('es-DO', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
    let ok = 0, fail = 0;
    for (let i = 0; i < destinatarios.length; i++) {
      const g = destinatarios[i];
      setStatus(`Enviando correos… ${i + 1}/${destinatarios.length}`);
      $('#importStatus').classList.remove('hidden');
      try {
        await window.emailjs.send(ev.emailjsService, ev.emailjsTemplate, {
          to_email: g.correo,
          to_name: g.titulo ? `${g.titulo} ${g.nombre}` : g.nombre,
          event_name: ev.name || 'Mi evento',
          event_date: dateStr,
          event_hora: ev.hora || '',
          event_lugar: ev.lugar || ''
        });
        ok++;
      } catch (err) {
        console.error('Error enviando a', g.correo, err);
        fail++;
      }
      await new Promise(r => setTimeout(r, 300)); // pequeña pausa entre envíos
    }
    $('#importStatus').classList.add('hidden');
    alert(`Envío terminado: ${ok} correo${ok === 1 ? '' : 's'} enviado${ok === 1 ? '' : 's'} correctamente${fail ? `, ${fail} con error` : ''}.`);
  });

  // ---------------- Imprimir plano de mesas ----------------
  $('#btnPrintPlan').addEventListener('click', () => {
    const ev = DB.event;
    const tables = DB.tables.slice().sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));
    const area = $('#printArea');
    let html = `<div class="print-title">${escapeAttr(ev.name || 'Mi evento')}</div>`;
    html += `<div class="print-subtitle">${ev.date ? new Date(ev.date + 'T00:00').toLocaleDateString('es-DO', { day: 'numeric', month: 'long', year: 'numeric' }) : ''}${ev.lugar ? ' — ' + escapeAttr(ev.lugar) : ''} — ${DB.guests.length} invitados, ${tables.length} mesas</div>`;
    tables.forEach(t => {
      const guests = DB.guestsInTable(t.name).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
      html += `<div class="print-table"><h3>${escapeAttr(t.name)}${t.etiqueta ? ' — ' + escapeAttr(t.etiqueta) : ''}</h3>`;
      html += `<div class="print-occ">${guests.length}${t.capacidad != null ? '/' + t.capacidad : ''} invitados</div>`;
      html += '<ol>';
      guests.forEach(g => {
        html += `<li class="${g.llego ? 'arrived' : ''}">${escapeAttr(g.titulo ? g.titulo + ' ' : '')}${escapeAttr(g.nombre)}</li>`;
      });
      html += '</ol></div>';
    });
    const sinMesa = DB.guests.filter(g => !g.mesa);
    if (sinMesa.length) {
      html += `<div class="print-table"><h3>Sin mesa/fila asignada</h3><ol>`;
      sinMesa.forEach(g => { html += `<li>${escapeAttr(g.nombre)}</li>`; });
      html += '</ol></div>';
    }
    area.innerHTML = html;
    window.print();
  });
  $('#btnEditTable').addEventListener('click', () => {
    $('#modalTableDetail').classList.add('hidden');
    openTableModal(detailTableId);
  });

  function updateTableTypeLabels() {
    const isFila = $('#newTableTipo').value === 'fila';
    $('#newTableNameLabel').firstChild.textContent = isFila ? 'Nombre de la fila' : 'Nombre o número';
    $('#newTableName').placeholder = isFila ? 'Ej: Fila A' : 'Ej: Mesa 5';
    $('#newTableCapacityLabel').firstChild.textContent = isFila ? 'Cantidad de asientos' : 'Asientos disponibles (opcional)';
  }
  $('#newTableTipo').addEventListener('change', updateTableTypeLabels);

  function openTableModal(tableId) {
    editingTableId = tableId || null;
    const t = tableId ? DB.tables.find(x => x.id === tableId) : null;
    $('#modalTableTitle').textContent = t ? 'Editar mesa/fila' : 'Nueva mesa/fila';
    $('#newTableTipo').value = t ? (t.tipo || 'mesa') : 'mesa';
    $('#newTableName').value = t ? t.name : '';
    $('#newTableCapacity').value = (t && t.capacidad != null) ? t.capacidad : '';
    $('#newTableLabel').value = t ? t.etiqueta : '';
    $('#btnDeleteTable').classList.toggle('hidden', !t);
    updateTableTypeLabels();
    $('#modalTable').classList.remove('hidden');
    setTimeout(() => $('#newTableName').focus(), 50);
  }

  $('#btnAddTable').addEventListener('click', () => openTableModal(null));
  $('#btnCancelTable').addEventListener('click', () => $('#modalTable').classList.add('hidden'));
  $('#btnSaveTable').addEventListener('click', () => {
    const name = $('#newTableName').value.trim();
    const capacidad = $('#newTableCapacity').value.trim();
    const etiqueta = $('#newTableLabel').value.trim();
    const tipo = $('#newTableTipo').value;
    if (!name) { toast('Escribe un nombre para la mesa'); return; }
    if (tipo === 'fila' && !capacidad) { toast('Escribe cuántos asientos tiene la fila'); return; }
    if (editingTableId) DB.updateTable(editingTableId, name, capacidad, etiqueta, tipo);
    else DB.addTable(name, capacidad, etiqueta, tipo);
    $('#modalTable').classList.add('hidden');
    renderAll();
    toast('Mesa guardada');
  });
  $('#btnDeleteTable').addEventListener('click', () => {
    if (!editingTableId) return;
    const t = DB.tables.find(x => x.id === editingTableId);
    if (confirm(`¿Eliminar la mesa "${t.name}"? Sus invitados quedarán sin mesa asignada.`)) {
      const snap = DB.snapshot();
      DB.deleteTable(editingTableId);
      $('#modalTable').classList.add('hidden');
      renderAll();
      toast('Mesa eliminada', snap);
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
      const isCurrent = t.name.toLowerCase() === g.mesa.toLowerCase();
      const avail = DB.tableAvailability(t.name, g.id);
      const full = avail && avail.llena && !isCurrent;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'move-chip' + (isCurrent ? ' selected' : '') + (full ? ' full' : '');
      chip.textContent = avail ? `${t.name} (${avail.ocupados}/${avail.capacidad})` : t.name;
      chip.disabled = full;
      if (full) chip.title = 'Esta mesa ya está llena';
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
  $('#btnCancelMove').addEventListener('click', () => {
    $('#modalMove').classList.add('hidden');
    if (moveDoneCallback) moveDoneCallback();
  });
  $('#btnConfirmMove').addEventListener('click', () => {
    const newTableTyped = $('#moveNewTable').value.trim();
    const chosenChip = $('.move-chip.selected');
    const mesa = newTableTyped || (chosenChip ? chosenChip.textContent.replace(/\s*\(\d+\/\d+\)$/, '') : '');
    if (!mesa) { toast('Elige o escribe una mesa'); return; }
    const avail = DB.tableAvailability(mesa, movingGuestId);
    if (avail && avail.llena) {
      toast(`"${mesa}" ya está llena (${avail.ocupados}/${avail.capacidad})`);
      return;
    }
    DB.moveGuest(movingGuestId, mesa);
    $('#modalMove').classList.add('hidden');
    renderAll();
    if (moveDoneCallback) moveDoneCallback();
    toast('Invitado movido');
  });

  // ---------------- Ajustes ----------------
  function renderEventsList() {
    const wrap = $('#eventsList');
    wrap.innerHTML = '';
    const events = DB.listEvents();
    events.forEach(ev => {
      const isActive = ev.id === DB.activeEventId;
      const item = document.createElement('div');
      item.className = 'event-item' + (isActive ? ' active' : '');
      item.innerHTML = `
        <div class="event-info">
          <div class="event-name"></div>
          <div class="event-meta"></div>
        </div>
        ${isActive ? '<span class="event-badge">Activo</span>' : '<button class="ev-switch" title="Usar este evento">⇄</button>'}
        <button class="ev-delete" title="Eliminar evento">🗑</button>`;
      item.querySelector('.event-name').textContent = ev.name || 'Sin nombre';
      item.querySelector('.event-meta').textContent = ev.date
        ? new Date(ev.date + 'T00:00').toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' })
        : 'Sin fecha';
      const switchBtn = item.querySelector('.ev-switch');
      if (switchBtn) switchBtn.addEventListener('click', () => {
        DB.switchEvent(ev.id);
        $('#modalSettings').classList.add('hidden');
        renderAll();
        toast(`Ahora estás en "${ev.name}"`);
      });
      item.querySelector('.ev-delete').addEventListener('click', () => {
        if (events.length === 1) { toast('No puedes borrar tu único evento'); return; }
        if (confirm(`¿Eliminar el evento "${ev.name}" y todos sus invitados/mesas? No se puede deshacer.`)) {
          DB.deleteEvent(ev.id);
          renderEventsList();
          renderAll();
          toast('Evento eliminado');
        }
      });
      wrap.appendChild(item);
    });
  }

  $('#btnSettings').addEventListener('click', () => {
    $('#settingsEventName').value = DB.event.name || '';
    $('#settingsEventDate').value = DB.event.date || '';
    $('#settingsEventHora').value = DB.event.hora || '';
    $('#settingsEventLugar').value = DB.event.lugar || '';
    $('#settingsSheetsUrl').value = DB.event.sheetsUrl || '';
    $('#settingsEmailjsService').value = DB.event.emailjsService || '';
    $('#settingsEmailjsTemplate').value = DB.event.emailjsTemplate || '';
    $('#settingsEmailjsPublicKey').value = DB.event.emailjsPublicKey || '';
    renderInvitationBox();
    renderEventsList();
    $('#modalSettings').classList.remove('hidden');
  });
  $('#btnCancelSettings').addEventListener('click', () => $('#modalSettings').classList.add('hidden'));
  $('#btnSaveSettings').addEventListener('click', () => {
    DB.saveEvent(
      $('#settingsEventName').value, $('#settingsEventDate').value, $('#settingsEventLugar').value, $('#settingsEventHora').value,
      $('#settingsSheetsUrl').value.trim(),
      {
        service: $('#settingsEmailjsService').value.trim(),
        template: $('#settingsEmailjsTemplate').value.trim(),
        publicKey: $('#settingsEmailjsPublicKey').value.trim()
      }
    );
    $('#modalSettings').classList.add('hidden');
    renderHeader();
    toast('Ajustes guardados');
  });
  $('#btnNewEvent').addEventListener('click', () => {
    const name = prompt('Nombre del nuevo evento:', 'Nuevo evento');
    if (name === null) return;
    DB.createEvent(name.trim() || 'Nuevo evento');
    $('#modalSettings').classList.add('hidden');
    renderAll();
    toast('Evento creado — ya estás en él');
  });
  $('#btnDuplicateEvent').addEventListener('click', () => {
    const name = prompt('Nombre para la copia:', DB.event.name + ' (copia)');
    if (name === null) return;
    DB.duplicateEvent(DB.activeEventId, name.trim());
    renderEventsList();
    toast('Evento duplicado. Actívalo desde la lista si quieres cambiarte a él.');
  });
  $('#btnClearAll').addEventListener('click', () => {
    if (confirm('Esto borrará todos los invitados y mesas de ESTE evento (no de tus otros eventos guardados). ¿Continuar?')) {
      DB.clearAll();
      $('#modalSettings').classList.add('hidden');
      renderAll();
      toast('Datos de este evento borrados');
    }
  });
  $('#btnExportBackup').addEventListener('click', () => {
    const blob = new Blob([DB.exportBackup()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `respaldo-${(DB.event.name || 'evento').toLowerCase().replace(/\s+/g, '-')}.json`;
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
      else if (mode === 'camara') $('#fileFotoCamera').click();
      else if (mode === 'galeria') $('#fileFotoGaleria').click();
      else if (mode === 'texto') {
        $('#rawTextArea').value = '';
        $('#importReview').classList.remove('hidden');
        setTimeout(() => $('#rawTextArea').focus(), 50);
      }
      else if (mode === 'sheets') syncFromSheets();
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

  async function syncFromSheets() {
    const url = DB.event.sheetsUrl;
    if (!url) {
      if (confirm('Todavía no has configurado el link de Google Sheets para este evento. ¿Ir a Ajustes para agregarlo?')) {
        $('#btnSettings').click();
      }
      return;
    }
    if (!navigator.onLine) {
      setStatus('Sin conexión a internet — esta función necesita internet para traer los datos más recientes de Google Sheets.', true);
      return;
    }
    setStatus('Sincronizando con Google Sheets…');
    try {
      const { rows } = await Importers.parseSheetsUrl(url);
      if (!rows.length) { setStatus('La hoja no tiene filas con nombres, o no se reconoció ninguna columna de nombre.', true); return; }
      showPreview(rows, { suggestReplace: true });
      $('#importStatus').classList.add('hidden');
    } catch (err) {
      console.error(err);
      setStatus(err.message || 'No se pudo sincronizar con Google Sheets.', true);
    }
  }

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

  async function handleFotoFile(file) {
    setStatus('Preparando imagen…');
    const withTimeout = (promise, ms, msg) => Promise.race([
      promise,
      new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))
    ]);
    try {
      const { rawText } = await withTimeout(
        Importers.parseImage(file, m => {
          if (m.status === 'preparing') setStatus('Redimensionando foto…');
          else if (m.status === 'loading tesseract core') setStatus('Cargando motor de reconocimiento…');
          else if (m.status === 'recognizing text') setStatus(`Reconociendo texto… ${Math.round((m.progress || 0) * 100)}%`);
        }),
        75000,
        'Tardó demasiado en procesar la imagen.'
      );
      if (!rawText.trim()) { setStatus('No se detectó texto en la imagen. Intenta con mejor luz o más de cerca.', true); return; }
      $('#importStatus').classList.add('hidden');
      $('#rawTextArea').value = rawText;
      $('#importReview').classList.remove('hidden');
    } catch (err) {
      console.error(err);
      setStatus('No se pudo procesar la imagen (tardó demasiado o falló el reconocimiento). Prueba con mejor luz, más cerca del texto, o usa "Pegar texto" como alternativa.', true);
    }
  }
  $('#fileFotoCamera').addEventListener('change', e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) handleFotoFile(file);
  });
  $('#fileFotoGaleria').addEventListener('change', e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) handleFotoFile(file);
  });

  $('#btnParseText').addEventListener('click', () => {
    const text = $('#rawTextArea').value;
    const rows = Importers.parseFreeText(text);
    if (!rows.length) { toast('No se detectaron nombres en el texto'); return; }
    showPreview(rows);
  });

  function showPreview(rows, opts) {
    pendingImportRows = rows;
    $('#importReview').classList.add('hidden');
    $('#importPreview').classList.remove('hidden');
    renderPreviewList(rows);
    $('#replaceExisting').checked = !!(opts && opts.suggestReplace);
    $('#replaceHint').classList.toggle('hidden', !(opts && opts.suggestReplace));
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

    const overbooked = DB.overbookedTables();
    if (overbooked.length) {
      const lines = overbooked.slice(0, 5).map(o => `• ${o.table.name}: ${o.ocupados}/${o.table.capacidad}`).join('\n');
      const extra = overbooked.length > 5 ? `\n…y ${overbooked.length - 5} mesa(s) más` : '';
      alert(`Se importaron ${rows.length} invitado(s), pero algunas mesas quedaron con más gente de la que les cabe:\n\n${lines}${extra}\n\nAjusta la capacidad de esas mesas o mueve invitados a otra mesa desde la pestaña Mesas.`);
    } else {
      toast(`${rows.length} invitado${rows.length === 1 ? '' : 's'} importado${rows.length === 1 ? '' : 's'}`);
    }
  });

  // ---------------- Toast (con "Deshacer" opcional) ----------------
  let toastTimer = null;
  function toast(msg, undoSnapshot) {
    const el = $('#toast');
    el.innerHTML = '';
    const span = document.createElement('span');
    span.textContent = msg;
    el.appendChild(span);
    if (undoSnapshot) {
      const btn = document.createElement('button');
      btn.className = 'toast-undo';
      btn.textContent = 'Deshacer';
      btn.addEventListener('click', () => {
        DB.restoreSnapshot(undoSnapshot);
        el.classList.add('hidden');
        clearTimeout(toastTimer);
        renderAll();
      });
      el.appendChild(btn);
    }
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), undoSnapshot ? 5000 : 2200);
  }

  // ---------------- Modo recepción ----------------
  function renderReceptionList() {
    const q = normalizeName($('#receptionSearch').value.trim());
    const guests = DB.guests.filter(g => !q || normalizeName(g.nombre).includes(q));

    const mains = guests.filter(g => !g.companionOf).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    const byId = new Map(guests.map(g => [g.id, g]));
    const usedCompanionIds = new Set();
    const ordered = [];
    mains.forEach(g => {
      ordered.push(g);
      if (g.companionId && byId.has(g.companionId)) {
        ordered.push(byId.get(g.companionId));
        usedCompanionIds.add(g.companionId);
      }
    });
    guests.filter(g => g.companionOf && !usedCompanionIds.has(g.id)).forEach(g => ordered.push(g));

    const list = $('#receptionList');
    list.innerHTML = '';
    ordered.forEach(g => {
      const isCompanion = !!g.companionOf;
      const li = document.createElement('li');
      li.className = 'guest-row' + (g.llego ? ' arrived' : '') + (isCompanion ? ' companion-row' : '');
      li.innerHTML = `
        <div class="guest-avatar ${g.llego ? 'checked' : ''}">${g.llego ? '✓' : (initials(g.nombre) || '?')}</div>
        <div class="guest-info">
          <div class="guest-name"></div>
          <div class="guest-table ${g.mesa ? '' : 'unassigned'}"></div>
        </div>`;
      li.querySelector('.guest-name').textContent = (isCompanion ? '↳ ' : '') + (isAutoCompanionName(g) ? 'Acompañante' : (g.titulo ? `${g.titulo} ${g.nombre}` : g.nombre));
      li.querySelector('.guest-table').textContent = g.mesa || 'Sin mesa/fila asignada';
      if (!g.llego) li.querySelector('.guest-avatar').style.background = avatarColor(g.nombre);
      li.addEventListener('click', () => {
        DB.toggleCheckin(g.id);
        renderReceptionList();
      });
      list.appendChild(li);
    });
    const llegaron = DB.guests.filter(g => g.llego).length;
    $('#receptionStat').textContent = `${llegaron} de ${DB.guests.length} han llegado`;
  }

  $('#btnReception').addEventListener('click', () => {
    $('#receptionEventName').textContent = DB.event.name || 'Recepción';
    $('#receptionSearch').value = '';
    renderReceptionList();
    $('#receptionMode').classList.remove('hidden');
    setTimeout(() => $('#receptionSearch').focus(), 50);
  });
  $('#btnExitReception').addEventListener('click', () => {
    $('#receptionMode').classList.add('hidden');
    renderAll();
  });
  $('#receptionSearch').addEventListener('input', renderReceptionList);

  // ---------------- Invitación del evento ----------------
  function renderInvitationBox() {
    const img = DB.event.invitacion;
    $('#invitationBox').classList.toggle('hidden', !img);
    $('#invitationDetected').classList.add('hidden');
    $('#invitationOcrStatus').classList.add('hidden');
    if (img) $('#invitationThumb').src = img;
  }

  $('#btnUploadInvitation').addEventListener('click', () => $('#fileInvitation').click());
  $('#fileInvitation').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const resized = await Importers._downscaleImage(file, 1400);
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(resized);
      });
      DB.setInvitacion(dataUrl);
      renderInvitationBox();
      toast('Invitación guardada');
    } catch (err) {
      console.error(err);
      if (err && err.name === 'QuotaExceededError') {
        alert('No se pudo guardar la imagen: no hay suficiente espacio de almacenamiento en el navegador. Prueba con una foto más liviana, o borra respaldos/eventos que ya no uses.');
      } else {
        alert('No se pudo guardar la imagen de la invitación.');
      }
    }
  });
  $('#btnRemoveInvitation').addEventListener('click', () => {
    if (confirm('¿Quitar la imagen de la invitación?')) {
      DB.clearInvitacion();
      renderInvitationBox();
    }
  });
  $('#btnOcrInvitation').addEventListener('click', async () => {
    const dataUrl = DB.event.invitacion;
    if (!dataUrl) return;
    const statusEl = $('#invitationOcrStatus');
    statusEl.classList.remove('hidden', 'error');
    statusEl.textContent = 'Detectando datos de la invitación…';
    $('#invitationDetected').classList.add('hidden');
    try {
      const blob = await (await fetch(dataUrl)).blob();
      const withTimeout = (promise, ms) => Promise.race([
        promise,
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))
      ]);
      const result = await withTimeout(
        Importers.parseImage(blob, m => {
          if (m.status === 'recognizing text') {
            statusEl.textContent = `Leyendo texto… ${Math.round((m.progress || 0) * 100)}%`;
          }
        }, { multiPass: true }),
        100000
      );
      const rawText = result.rawText;
      statusEl.classList.add('hidden');
      if (!rawText.trim()) { toast('No se detectó texto en la imagen'); return; }
      // Combina lo detectado en cada intento (un modo puede acertar la hora, otro el lugar)
      const attempts = (result.candidates && result.candidates.length) ? result.candidates : [rawText];
      const found = { nombre: '', fecha: '', hora: '', lugar: '' };
      attempts.forEach(t => {
        const f = Importers.parseInvitation(t);
        if (!found.nombre && f.nombre) found.nombre = f.nombre;
        if (!found.fecha && f.fecha) found.fecha = f.fecha;
        if (!found.hora && f.hora) found.hora = f.hora;
        if (!found.lugar && f.lugar) found.lugar = f.lugar;
      });
      $('#detNombre').value = found.nombre || '';
      $('#detFecha').value = found.fecha || '';
      $('#detHora').value = found.hora || '';
      $('#detLugar').value = found.lugar || '';
      $('#invitationOcrText').value = rawText;
      $('#invitationDetected').classList.remove('hidden');
      if (!found.fecha && !found.hora && !found.lugar) {
        toast('No se pudo identificar fecha/hora/lugar con certeza — revisa el texto completo abajo');
      }
    } catch (err) {
      console.error(err);
      statusEl.textContent = 'No se pudo leer el texto de la imagen.';
      statusEl.classList.add('error');
    }
  });
  $('#btnApplyDetected').addEventListener('click', () => {
    if ($('#detNombre').value.trim()) $('#settingsEventName').value = $('#detNombre').value.trim();
    if ($('#detFecha').value) $('#settingsEventDate').value = $('#detFecha').value;
    if ($('#detHora').value) $('#settingsEventHora').value = $('#detHora').value;
    if ($('#detLugar').value.trim()) $('#settingsEventLugar').value = $('#detLugar').value.trim();
    $('#invitationDetected').classList.add('hidden');
    toast('Datos aplicados — recuerda tocar "Guardar" para confirmarlos');
  });

  // ---------------- Edición rápida del evento (tocando el encabezado) ----------------
  $('#btnQuickEventInfo').addEventListener('click', () => {
    $('#quickEventName').value = DB.event.name || '';
    $('#quickEventDate').value = DB.event.date || '';
    $('#quickEventHora').value = DB.event.hora || '';
    $('#quickEventLugar').value = DB.event.lugar || '';
    $('#modalQuickEvent').classList.remove('hidden');
    setTimeout(() => $('#quickEventName').focus(), 50);
  });
  $('#btnCancelQuickEvent').addEventListener('click', () => $('#modalQuickEvent').classList.add('hidden'));
  $('#btnSaveQuickEvent').addEventListener('click', () => {
    DB.saveEvent($('#quickEventName').value, $('#quickEventDate').value, $('#quickEventLugar').value, $('#quickEventHora').value);
    $('#modalQuickEvent').classList.add('hidden');
    renderHeader();
    toast('Datos del evento actualizados');
  });

  // ---------------- Botones X de cerrar modal ----------------
  $$('.modal-close-x, .modal-close-x-inline').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = $('#' + btn.dataset.close);
      if (target) target.click();
    });
  });

  // ---------------- Botón "atrás" del celular: no cerrar la app de una vez ----------------
  let lastBackAttempt = 0;
  history.pushState({ eventosApp: true }, '', location.href);

  function closeTopModal() {
    const openModal = document.querySelector('.modal:not(.hidden)');
    if (!openModal) return false;
    const xBtn = openModal.querySelector('.modal-close-x, .modal-close-x-inline');
    if (xBtn) xBtn.click(); else openModal.classList.add('hidden');
    return true;
  }

  window.addEventListener('popstate', () => {
    if (!$('#receptionMode').classList.contains('hidden')) {
      $('#btnExitReception').click();
      history.pushState({ eventosApp: true }, '', location.href);
      return;
    }
    if (closeTopModal()) {
      history.pushState({ eventosApp: true }, '', location.href);
      return;
    }
    const activeTab = document.querySelector('.tab-btn.active');
    if (activeTab && activeTab.dataset.view !== 'invitados') {
      showView('invitados');
      history.pushState({ eventosApp: true }, '', location.href);
      return;
    }
    // Ya estamos en la pantalla principal sin nada abierto: pide un segundo "atrás" para salir
    const now = Date.now();
    if (now - lastBackAttempt < 2000) return; // deja que la navegación siga (cierra/minimiza)
    lastBackAttempt = now;
    toast('Presiona atrás de nuevo para salir');
    history.pushState({ eventosApp: true }, '', location.href);
  });

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
