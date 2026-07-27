// importers.js — Extrae texto/filas desde Excel, PDF o imagen (OCR), 100% en el dispositivo.
// normalizeName() vive en db.js y se usa aquí también para marcar duplicados en la vista previa.

const Importers = {

  // ---------- EXCEL / CSV ----------
  async parseExcel(file) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (!rows.length) return { rows: [], rawText: '' };

    // Detecta si la primera fila es encabezado buscando palabras clave
    const headerCandidates = rows[0].map(c => String(c).toLowerCase().trim());
    const nameCol = headerCandidates.findIndex(c => /nombre|invitad|guest|name/.test(c));
    const tableCol = headerCandidates.findIndex(c => /mesa|tabla|table/.test(c));

    let dataRows = rows;
    let nCol = nameCol, tCol = tableCol;
    if (nameCol > -1) {
      dataRows = rows.slice(1); // hay encabezado real
    } else {
      // sin encabezado reconocible: asumimos columna 0 = nombre, columna 1 = mesa
      nCol = 0; tCol = 1;
    }

    const out = [];
    dataRows.forEach(r => {
      const nombre = String(r[nCol] ?? '').trim();
      const mesa = tCol > -1 ? String(r[tCol] ?? '').trim() : '';
      if (nombre) out.push({ nombre, mesa });
    });

    const rawText = out.map(r => r.mesa ? `${r.nombre}, ${r.mesa}` : r.nombre).join('\n');
    return { rows: out, rawText };
  },

  // ---------- PDF ----------
  async parsePdf(file) {
    await this._ensurePdfJs();
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    let lines = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      // Agrupa items por posición vertical (misma línea aprox.)
      const byY = {};
      content.items.forEach(item => {
        const y = Math.round(item.transform[5]);
        if (!byY[y]) byY[y] = [];
        byY[y].push(item.str);
      });
      const ys = Object.keys(byY).map(Number).sort((a, b) => b - a);
      ys.forEach(y => {
        const line = byY[y].join(' ').replace(/\s+/g, ' ').trim();
        if (line) lines.push(line);
      });
    }
    return { rawText: lines.join('\n') };
  },

  async _ensurePdfJs() {
    if (window.pdfjsLib) return;
    window.pdfjsLib = await import('../vendor/pdf.min.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.mjs';
  },

  // ---------- OCR (foto/escaneo) ----------
  async parseImage(file, onProgress) {
    if (!window.Tesseract) await this._loadScript('vendor/tesseract.min.js', false);
    if (onProgress) onProgress({ status: 'preparing', progress: 0 });
    const resized = await this._downscaleImage(file, 1600);
    const worker = await Tesseract.createWorker('spa', 1, {
      workerPath: 'vendor/worker.min.js',
      corePath: 'vendor/tesseract-core-simd-lstm.js',
      langPath: 'tessdata',
      gzip: true,
      workerBlobURL: false,
      logger: m => { if (onProgress) onProgress(m); }
    });
    try {
      const { data } = await worker.recognize(resized);
      return { rawText: data.text.trim() };
    } finally {
      await worker.terminate();
    }
  },

  // Reduce fotos de cámara (a menudo 12MP+) a un lado máximo razonable para leer texto.
  // Esto acelera el OCR drásticamente sin perder legibilidad del texto.
  // Usa createImageBitmap cuando está disponible (más rápido y liviano en celulares que
  // decodificar con <img> + canvas), con un límite de tiempo para nunca quedarse colgado.
  async _downscaleImage(file, maxSide) {
    const withTimeout = (promise, ms) => Promise.race([
      promise,
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))
    ]);

    try {
      if ('createImageBitmap' in window) {
        const bitmap = await withTimeout(createImageBitmap(file), 15000);
        const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
        if (scale >= 1) { bitmap.close(); return file; }
        const w = Math.round(bitmap.width * scale);
        const h = Math.round(bitmap.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0, w, h);
        bitmap.close();
        const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.88));
        return blob || file;
      }
    } catch (e) {
      console.warn('createImageBitmap falló o tardó demasiado, usando la imagen original:', e);
      return file;
    }

    // Fallback para navegadores sin createImageBitmap
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      const timer = setTimeout(() => { URL.revokeObjectURL(url); resolve(file); }, 15000);
      img.onload = () => {
        clearTimeout(timer);
        URL.revokeObjectURL(url);
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        if (scale >= 1) { resolve(file); return; }
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(blob => resolve(blob || file), 'image/jpeg', 0.88);
      };
      img.onerror = () => { clearTimeout(timer); URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  },

  _loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = reject;
      document.head.appendChild(s);
    });
  },

  // ---------- Parser de texto libre -> filas {nombre, mesa} ----------
  // Acepta líneas como:
  //   "Ana Pérez, Mesa 3"      "Ana Pérez - Mesa 3"      "Ana Pérez\tMesa 3"
  //   "Mesa 3: Ana Pérez, Juan López"   (varios invitados por mesa)
  //   "Ana Pérez"  (sin mesa)
  parseFreeText(text) {
    const rows = [];
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    lines.forEach(line => {
      // Formato "Mesa X: nombre1, nombre2, nombre3"
      let m = line.match(/^(mesa|tabla|table)\s*[:\-]?\s*(\S.*?)\s*[:\-]\s*(.+)$/i);
      if (m) {
        const mesa = `${m[1]} ${m[2]}`.replace(/\s+/g, ' ').trim();
        m[3].split(/,|;/).forEach(n => {
          const nombre = n.trim();
          if (nombre) rows.push({ nombre, mesa });
        });
        return;
      }

      // Formato "Nombre, Mesa" / "Nombre - Mesa" / "Nombre\tMesa" / "Nombre | Mesa"
      m = line.match(/^(.+?)\s*[,\t|]\s*((?:mesa|tabla|table)?\s*[\wñÑáéíóúÁÉÍÓÚ.\-]+)$/i);
      if (m && /mesa|tabla|table|^\d+$/i.test(m[2])) {
        rows.push({ nombre: m[1].trim(), mesa: m[2].trim() });
        return;
      }
      m = line.match(/^(.+?)\s+-\s+(.+)$/);
      if (m) {
        rows.push({ nombre: m[1].trim(), mesa: m[2].trim() });
        return;
      }

      // Sin mesa detectable: toda la línea es el nombre (si no es puro ruido)
      if (line.length > 1 && !/^(nombre|invitado|guest|name)s?$/i.test(line)) {
        rows.push({ nombre: line, mesa: '' });
      }
    });

    return rows;
  },

  // ---------- Parser de invitación: intenta identificar nombre/fecha/hora/lugar ----------
  // Es un best-effort (no hay dos invitaciones diseñadas igual), por eso todo se devuelve
  // para que el usuario lo revise y edite antes de aplicarlo a los campos del evento.
  parseInvitation(text) {
    const MESES = {
      enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7,
      agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12
    };
    const pad = n => String(n).padStart(2, '0');
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const joined = text;

    // --- Fecha ---
    let fecha = '';
    let m = joined.match(/(\d{1,2})\s+de\s+([a-záéíóúñ]+)\s+(?:de\s+)?(\d{4})?/i);
    if (m) {
      const day = parseInt(m[1], 10);
      const monthName = m[2].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const month = MESES[monthName];
      let year = m[3] ? parseInt(m[3], 10) : null;
      if (month && day >= 1 && day <= 31) {
        if (!year) {
          const now = new Date();
          year = now.getFullYear();
          if (new Date(year, month - 1, day) < now) year += 1;
        }
        fecha = `${year}-${pad(month)}-${pad(day)}`;
      }
    }
    if (!fecha) {
      m = joined.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/);
      if (m) {
        let d = parseInt(m[1], 10), mo = parseInt(m[2], 10), y = parseInt(m[3], 10);
        if (y < 100) y += 2000;
        if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) fecha = `${y}-${pad(mo)}-${pad(d)}`;
      }
    }

    // --- Hora ---
    let hora = '';
    m = joined.match(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*([ap]\.?\s*m\.?)\b/i);
    if (m) {
      let h = parseInt(m[1], 10);
      const min = m[2] || '00';
      const ampm = m[3].toLowerCase().replace(/[.\s]/g, '');
      if (ampm.startsWith('p') && h !== 12) h += 12;
      if (ampm.startsWith('a') && h === 12) h = 0;
      hora = `${pad(h)}:${min}`;
    } else {
      m = joined.match(/\b([01]?\d|2[0-3]):([0-5]\d)\s*(?:hrs?|horas?)?\b/i);
      if (m) hora = `${pad(parseInt(m[1], 10))}:${m[2]}`;
    }

    // --- Lugar ---
    let lugar = '';
    const lugarLabel = lines.find(l => /^(lugar|direcci[oó]n|ubicaci[oó]n)\s*[:\-]/i.test(l));
    if (lugarLabel) {
      lugar = lugarLabel.replace(/^(lugar|direcci[oó]n|ubicaci[oó]n)\s*[:\-]\s*/i, '').trim();
    } else {
      const kwRegex = /sal[oó]n|club|hotel|restaurante|jard[ií]n|iglesia|parroquia|quinta|villa|plaza|terraza|centro de eventos|hall/i;
      const kwLine = lines.find(l => kwRegex.test(l));
      if (kwLine) lugar = kwLine;
    }

    // --- Nombre del evento (mejor esfuerzo: primera línea con contenido real) ---
    let nombre = '';
    for (const l of lines) {
      if (l === lugar) continue;
      if (/^\d{1,2}\s+de\s+/i.test(l)) continue;
      if (l.replace(/\W/g, '').length < 3) continue;
      nombre = l;
      break;
    }

    return { nombre, fecha, hora, lugar, rawText: text };
  }
};
