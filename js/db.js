// db.js — Toda la persistencia vive en localStorage. Sin backend, sin red.
// Soporta VARIOS eventos guardados en el mismo dispositivo (ej. una boda, luego un cumpleaños),
// cada uno con su propia lista de invitados y mesas, independientes entre sí.

const REGISTRY_KEY = 'eventos_pwa_registry_v1';
const ACTIVE_KEY = 'eventos_pwa_active_v1';
const LEGACY_KEY = 'eventos_pwa_v1'; // versión anterior de un solo evento

function normalizeName(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita acentos
    .replace(/\s+/g, ' ')
    .trim();
}

function newId(prefix) {
  return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}

function dataKey(eventId) { return 'eventos_pwa_data_' + eventId; }

const DB = {
  _data: null,
  _activeId: null,

  // ---------- Registro de eventos ----------
  _loadRegistry() {
    try {
      const raw = localStorage.getItem(REGISTRY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  },

  _saveRegistry(reg) {
    localStorage.setItem(REGISTRY_KEY, JSON.stringify(reg));
  },

  listEvents() {
    return this._loadRegistry().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  },

  get activeEventId() {
    if (this._activeId) return this._activeId;
    this._activeId = localStorage.getItem(ACTIVE_KEY);
    return this._activeId;
  },

  _migrateLegacyIfNeeded() {
    const reg = this._loadRegistry();
    if (reg.length > 0) return; // ya hay eventos registrados, nada que migrar
    const legacyRaw = localStorage.getItem(LEGACY_KEY);
    let legacyData = null;
    if (legacyRaw) {
      try { legacyData = JSON.parse(legacyRaw); } catch (e) { legacyData = null; }
    }
    const id = newId('ev');
    const data = legacyData || this._defaults();
    if (!data.event) data.event = { name: 'Mi evento', date: '' };
    localStorage.setItem(dataKey(id), JSON.stringify(data));
    const entry = { id, name: data.event.name || 'Mi evento', date: data.event.date || '', updatedAt: Date.now() };
    this._saveRegistry([entry]);
    localStorage.setItem(ACTIVE_KEY, id);
    if (legacyRaw) localStorage.removeItem(LEGACY_KEY);
  },

  createEvent(name) {
    const id = newId('ev');
    const data = this._defaults();
    data.event = { name: name || 'Nuevo evento', date: '' };
    localStorage.setItem(dataKey(id), JSON.stringify(data));
    const reg = this._loadRegistry();
    reg.push({ id, name: data.event.name, date: '', updatedAt: Date.now() });
    this._saveRegistry(reg);
    this.switchEvent(id);
    return id;
  },

  duplicateEvent(id, newName) {
    const raw = localStorage.getItem(dataKey(id));
    if (!raw) return null;
    const data = JSON.parse(raw);
    data.event = { name: newName || (data.event.name + ' (copia)'), date: data.event.date || '' };
    const newIdVal = newId('ev');
    localStorage.setItem(dataKey(newIdVal), JSON.stringify(data));
    const reg = this._loadRegistry();
    reg.push({ id: newIdVal, name: data.event.name, date: data.event.date || '', updatedAt: Date.now() });
    this._saveRegistry(reg);
    return newIdVal;
  },

  switchEvent(id) {
    if (!localStorage.getItem(dataKey(id))) return false;
    localStorage.setItem(ACTIVE_KEY, id);
    this._activeId = id;
    this._data = null; // fuerza recarga
    return true;
  },

  deleteEvent(id) {
    const reg = this._loadRegistry().filter(e => e.id !== id);
    localStorage.removeItem(dataKey(id));
    this._saveRegistry(reg);
    if (this.activeEventId === id) {
      if (reg.length) this.switchEvent(reg[0].id);
      else this.createEvent('Mi evento');
    }
  },

  _touchRegistryEntry() {
    const reg = this._loadRegistry();
    const entry = reg.find(e => e.id === this.activeEventId);
    if (entry) {
      entry.name = this.event.name || 'Mi evento';
      entry.date = this.event.date || '';
      entry.updatedAt = Date.now();
      this._saveRegistry(reg);
    }
  },

  // ---------- Datos del evento activo ----------
  load() {
    this._migrateLegacyIfNeeded();
    if (!this.activeEventId) {
      // No debería pasar tras la migración, pero por si acaso:
      this.createEvent('Mi evento');
    }
    if (this._data) return this._data;
    try {
      const raw = localStorage.getItem(dataKey(this.activeEventId));
      this._data = raw ? JSON.parse(raw) : this._defaults();
    } catch (e) {
      console.error('Error leyendo datos locales, iniciando de cero.', e);
      this._data = this._defaults();
    }
    if (!this._data.event) this._data.event = { name: 'Mi evento', date: '' };
    if (this._data.event.lugar === undefined) this._data.event.lugar = '';
    if (this._data.event.hora === undefined) this._data.event.hora = '';
    if (this._data.event.invitacion === undefined) this._data.event.invitacion = null; // dataURL base64 o null
    if (!Array.isArray(this._data.guests)) this._data.guests = [];
    if (!Array.isArray(this._data.tables)) this._data.tables = [];
    this._data.guests.forEach(g => {
      if (typeof g.llego !== 'boolean') g.llego = false;
      if (g.titulo === undefined) g.titulo = '';
      if (g.nota === undefined) g.nota = '';
      if (g.confirmado === undefined) g.confirmado = ''; // '', 'si', 'no'
      if (g.correo === undefined) g.correo = '';
      if (g.telefono === undefined) g.telefono = '';
      if (g.ocupacion === undefined) g.ocupacion = '';
      if (g.acompanante === undefined) g.acompanante = ''; // '', 'si', 'no'
    });
    this._data.tables.forEach(t => {
      if (t.capacidad === undefined) t.capacidad = null;
      if (t.etiqueta === undefined) t.etiqueta = '';
    });
    return this._data;
  },

  _defaults() {
    return { event: { name: 'Mi evento', date: '' }, guests: [], tables: [] };
  },

  save() {
    try {
      localStorage.setItem(dataKey(this.activeEventId), JSON.stringify(this._data));
      this._touchRegistryEntry();
    } catch (e) {
      console.error('No se pudo guardar (posible límite de almacenamiento del navegador):', e);
      throw e;
    }
  },

  get event() { return this.load().event; },
  get guests() { return this.load().guests; },
  get tables() { return this.load().tables; },

  saveEvent(name, date, lugar, hora) {
    const prev = this.load().event;
    this._data.event = {
      name: name || 'Mi evento',
      date: date || '',
      lugar: (lugar !== undefined ? lugar : prev.lugar) || '',
      hora: (hora !== undefined ? hora : prev.hora) || '',
      invitacion: prev.invitacion || null
    };
    this.save();
  },

  setInvitacion(dataUrl) {
    this.load().event.invitacion = dataUrl;
    this.save();
  },

  clearInvitacion() {
    this.load().event.invitacion = null;
    this.save();
  },

  // Busca invitados existentes con el mismo nombre (normalizado). excludeId para ediciones.
  findDuplicates(nombre, excludeId) {
    const n = normalizeName(nombre);
    if (!n) return [];
    return this.guests.filter(g => g.id !== excludeId && normalizeName(g.nombre) === n);
  },

  // ---------- Deshacer ----------
  snapshot() {
    return JSON.parse(JSON.stringify(this.load()));
  },

  restoreSnapshot(snap) {
    this._data = JSON.parse(JSON.stringify(snap));
    this.save();
  },

  addGuest(nombre, mesa, llego, titulo, nota, confirmado, extra) {
    extra = extra || {};
    const g = {
      id: newId('g'),
      nombre: nombre.trim(),
      mesa: (mesa || '').trim(),
      llego: !!llego,
      titulo: (titulo || '').trim(),
      nota: (nota || '').trim(),
      confirmado: confirmado || '',
      correo: (extra.correo || '').trim(),
      telefono: (extra.telefono || '').trim(),
      ocupacion: (extra.ocupacion || '').trim(),
      acompanante: extra.acompanante || ''
    };
    this.load().guests.push(g);
    this._ensureTable(g.mesa);
    this.save();
    return g;
  },

  updateGuest(id, nombre, mesa, titulo, nota, confirmado, extra) {
    const g = this.guests.find(x => x.id === id);
    if (!g) return;
    g.nombre = nombre.trim();
    g.mesa = (mesa || '').trim();
    if (titulo !== undefined) g.titulo = (titulo || '').trim();
    if (nota !== undefined) g.nota = (nota || '').trim();
    if (confirmado !== undefined) g.confirmado = confirmado || '';
    if (extra) {
      if (extra.correo !== undefined) g.correo = (extra.correo || '').trim();
      if (extra.telefono !== undefined) g.telefono = (extra.telefono || '').trim();
      if (extra.ocupacion !== undefined) g.ocupacion = (extra.ocupacion || '').trim();
      if (extra.acompanante !== undefined) g.acompanante = extra.acompanante || '';
    }
    this._ensureTable(g.mesa);
    this.save();
  },

  toggleCheckin(id) {
    const g = this.guests.find(x => x.id === id);
    if (!g) return;
    g.llego = !g.llego;
    this.save();
    return g.llego;
  },

  deleteGuest(id) {
    const arr = this.load().guests;
    const i = arr.findIndex(x => x.id === id);
    if (i > -1) arr.splice(i, 1);
    this.save();
  },

  deleteGuests(ids) {
    const set = new Set(ids);
    this._data.guests = this.load().guests.filter(g => !set.has(g.id));
    this.save();
  },

  moveGuest(id, mesa) {
    this.updateGuest(id, this.guests.find(x => x.id === id).nombre, mesa);
  },

  _ensureTable(name) {
    const n = (name || '').trim();
    if (!n) return;
    if (!this.load().tables.find(t => t.name.toLowerCase() === n.toLowerCase())) {
      this._data.tables.push({ id: newId('t'), name: n, capacidad: null, etiqueta: '' });
    }
  },

  addTable(name, capacidad, etiqueta) {
    const n = name.trim();
    if (!n) return null;
    const existing = this.tables.find(t => t.name.toLowerCase() === n.toLowerCase());
    if (existing) return existing;
    const t = {
      id: newId('t'), name: n,
      capacidad: (capacidad || capacidad === 0) ? Number(capacidad) : null,
      etiqueta: (etiqueta || '').trim()
    };
    this.load().tables.push(t);
    this.save();
    return t;
  },

  updateTable(id, name, capacidad, etiqueta) {
    const t = this.tables.find(x => x.id === id);
    if (!t) return;
    const oldName = t.name;
    t.name = name.trim();
    t.capacidad = (capacidad || capacidad === 0) ? Number(capacidad) : null;
    t.etiqueta = (etiqueta || '').trim();
    if (oldName.toLowerCase() !== t.name.toLowerCase()) {
      this.guests.forEach(g => {
        if (g.mesa.toLowerCase() === oldName.toLowerCase()) g.mesa = t.name;
      });
    }
    this.save();
  },

  deleteTable(id) {
    const t = this.tables.find(x => x.id === id);
    if (!t) return;
    this.guests.forEach(g => { if (g.mesa.toLowerCase() === t.name.toLowerCase()) g.mesa = ''; });
    const i = this.load().tables.findIndex(x => x.id === id);
    if (i > -1) this._data.tables.splice(i, 1);
    this.save();
  },

  guestsInTable(tableName) {
    return this.guests.filter(g => g.mesa.toLowerCase() === tableName.toLowerCase());
  },

  findTableByName(name) {
    const n = (name || '').trim().toLowerCase();
    if (!n) return null;
    return this.tables.find(t => t.name.toLowerCase() === n) || null;
  },

  // Devuelve null si la mesa no existe o no tiene capacidad definida (sin límite).
  // Si existe con capacidad, devuelve {capacidad, ocupados, disponibles, llena}.
  tableAvailability(name, excludeGuestId) {
    const t = this.findTableByName(name);
    if (!t || t.capacidad == null) return null;
    const ocupados = this.guestsInTable(t.name).filter(g => g.id !== excludeGuestId).length;
    return { capacidad: t.capacidad, ocupados, disponibles: t.capacidad - ocupados, llena: ocupados >= t.capacidad };
  },

  overbookedTables() {
    return this.tables
      .filter(t => t.capacidad != null)
      .map(t => ({ table: t, ocupados: this.guestsInTable(t.name).length }))
      .filter(x => x.ocupados > x.table.capacidad);
  },

  bulkImport(rows, replace) {
    if (replace) {
      this._data.guests = [];
      this._data.tables = [];
    }
    rows.forEach(r => {
      if (!r.nombre) return;
      this.addGuest(r.nombre, r.mesa || '', false, '', '', '', {
        correo: r.correo, telefono: r.telefono, ocupacion: r.ocupacion, acompanante: r.acompanante
      });
    });
    this.save();
  },

  clearAll() {
    this._data = this._defaults();
    this.save();
  },

  exportBackup() {
    return JSON.stringify(this.load(), null, 2);
  }
};
