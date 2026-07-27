# Manejo de Eventos — Mesas e Invitados

PWA 100% sin backend para organizar invitados y mesas de un evento. Todo se guarda con
`localStorage` en el propio dispositivo; no depende de ningún servidor una vez instalada.

## Estructura

```
index.html          → interfaz (una sola página, navegación por pestañas)
css/style.css        → estilos
js/db.js              → capa de datos (localStorage)
js/importers.js       → parsers de Excel/CSV, PDF, imagen (OCR) y texto libre
js/app.js             → controlador de la interfaz
manifest.json         → metadatos de instalación (PWA)
sw.js                  → service worker (cachea todo para uso offline)
vendor/                → librerías de terceros ya incluidas (sin CDN, offline)
tessdata/spa.traineddata.gz → modelo de reconocimiento de texto en español (offline)
icons/                 → íconos de la app
```

## Cómo importar invitados

Hay 4 formas, todas procesadas en el propio dispositivo:

1. **Excel / CSV** — busca automáticamente columnas llamadas "nombre" y "mesa" (o similares).
   Si no encuentra encabezados, asume que la primera columna es el nombre y la segunda la mesa.
2. **PDF** — extrae el texto seleccionable del documento.
3. **Foto / Escaneo** — usa reconocimiento óptico (OCR) sobre una foto tomada con la cámara o
   una imagen de la galería.
4. **Pegar texto** — para pegar manualmente una lista.

En los casos de PDF, foto y texto, el resultado pasa primero por una **pantalla de revisión**
donde puedes corregir el texto detectado antes de convertirlo en invitados (esto cubre el
"seleccionar el texto" que mencionaste). Luego se muestra una **vista previa editable** fila por
fila antes de confirmar la importación.

Formatos de línea que el parser de texto entiende:
```
Ana Pérez, Mesa 3
Ana Pérez - Mesa 3
Mesa 3: Ana Pérez, Juan López, María Díaz
Ana Pérez                (sin mesa; se puede asignar después)
```

## Nota sobre el OCR (Foto/Escaneo)

El modelo de reconocimiento en español (`tessdata/spa.traineddata.gz`, ~1.1 MB) ya viene
empaquetado dentro del proyecto, así que **el OCR también funciona offline** una vez que la app
fue instalada/visitada la primera vez (el service worker lo cachea junto con todo lo demás).

## Publicar en GitHub Pages

1. Crea un repositorio nuevo (ej. `manejo-de-eventos`) y sube **todo el contenido de esta
   carpeta** tal cual (sin subcarpetas extra).
2. En GitHub: **Settings → Pages → Source: Deploy from a branch**, rama `main`, carpeta `/root`.
3. Espera 1–2 minutos y entra a `https://tu-usuario.github.io/manejo-de-eventos/`.
4. Desde el celular, abre esa URL en Chrome y usa **"Agregar a pantalla de inicio"** (o el
   banner de instalación que aparece automáticamente) para instalarla como app.

No hace falta configurar nada más: no hay build step, no hay backend, no hay variables de
entorno. Es HTML/CSS/JS estático.

## Probar localmente antes de subir

Los service workers no funcionan abriendo el `index.html` directo con `file://`. Sirve la
carpeta con cualquier servidor estático simple, por ejemplo:

```bash
cd eventos
python3 -m http.server 8080
```

Y abre `http://localhost:8080` en el navegador.

## Respaldo de datos

Como todo vive en `localStorage` del navegador, los datos son **por dispositivo y por
navegador**. Desde Ajustes (⚙) puedes exportar un respaldo en JSON. Si en el futuro quieres
sincronizar entre varios dispositivos (por ejemplo tú y un vendedor en campo), eso ya
requeriría un backend — lo cual queda fuera del alcance de esta primera versión, tal como
pediste.
