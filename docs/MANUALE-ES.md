# IGOR - ABit/s — Minimanual

*Versión 0.4.15*

[Italiano](MANUALE.md#italiano) · [English](MANUALE.md#english) · **Español** · [Français](MANUALE-FR.md) · [中文](MANUALE-ZH.md) · [العربية](MANUALE-AR.md)

---

### Qué es
IGOR es una pequeña mesa de realización de vídeo para Windows y Mac. La **ventana de control** está en el monitor principal y la **salida** se muestra a pantalla completa en el segundo monitor (con un solo monitor aparece como ventana). En la salida se combinan señales NDI, cámaras y capturadoras, vídeos e imágenes, un temporizador, un rótulo de texto y un teleprompter. La salida funciona a los fotogramas por segundo de su monitor (Auto); desde la barra inferior se pueden reducir para usar menos recursos.

### La ventana de control en resumen
- **Menú superior**
  - *Archivo*: importar y exportar la configuración, color de fondo de la salida.
  - *Ver*: modo light, modo studio, mostrar u ocultar instrucciones, restablecer la disposición, este minimanual.
- **Barra inferior**
  - A la izquierda (azul): **Restablecer ventanas de paneles** devuelve todos los paneles de detalles a su posición inicial; **Separar ventana de detalles** abre los detalles de las entradas en una ventana aparte (el mismo botón, *Reintegrar ventana de detalles*, los devuelve a la ventana de control).
  - A la derecha (gris), con iconos: **NDI** (verde = la salida se envía por la red como fuente «IGOR - ABit/s», rojo = apagado; al pasar el ratón se ven el nombre y los receptores conectados), **monitor** (mostrar/ocultar la salida), elección del **monitor** y de los **fotogramas por segundo**, **importar** y **exportar** la configuración (archivo `.igor`), **idioma** (italiano, inglés, español, francés, chino, árabe), **controlador MIDI** y **Companion / Stream Deck**.
  - Los monitores se numeran así: el principal es el número 1 y los demás siguen de izquierda a derecha.
- **Vista previa** (arriba): arrastra un elemento para moverlo y una esquina para cambiar su tamaño (Mayús mantiene las proporciones). En vídeos e imágenes, los tiradores naranjas sirven para recortar.
- **Columna de entradas** (a la derecha): el botón azul **+** añade una entrada (NDI, dispositivo de captura, multimedia, temporizador, rótulo de texto, TelePrompt). Para crear una escena pulsa **Añadir escena** abajo, haz clic en las entradas que quieras incluir (una o varias, o ninguna para una escena vacía) y luego en **Añadir**; el botón **LIGHT** pasa al modo light y se convierte en **STUDIO** para volver al modo completo (ver más abajo).
  - La lista va del primer plano al fondo; arrastra para cambiar el orden o para meter una entrada en una escena (Ctrl al soltar = también en esa escena).
  - **Mostrar todo**, encima de la lista, vuelve a hacer visibles todas las entradas.
  - En cada fila: 👁 visible/oculto, ↺ restablece el tamaño y los ajustes de la entrada, papelera roja para eliminar.
  - Ctrl + clic o Mayús + clic seleccionan varias filas; con el clic derecho aparecen *Eliminar* y *Restablecer entrada* para todas las filas seleccionadas.
- **Detalles de la entrada** (abajo): los ajustes de la entrada seleccionada, divididos en paneles.
  - Cada panel se mueve arrastrando su título y se ensancha o se alarga desde sus bordes derecho e inferior, de forma independiente de los demás.
  - Un clic en el título (o en la pestaña ▾) lo reduce a una barra.
  - El botón ⧉ abre el panel en una ventana separada que puedes colocar donde quieras (incluso en otro monitor); *Devolver a la ventana de control* lo vuelve a poner en su sitio.

### Colores
- Rojo: en el aire, y el botón *Eliminar*.
- Verde: vista previa.
- Azul y gris IGOR: botones de mando (CUT azul, FADE gris).

### Escenas y modo studio
Una escena agrupa varias entradas; en el aire hay una sola escena a la vez. Las entradas que están fuera de las escenas siempre se ven. El **modo studio** muestra dos pantallas: a la izquierda la **vista previa** (verde) y a la derecha lo que está **en el aire** (rojo); en el centro **CUT** (corte directo) y **FADE** (fundido), con la duración del fundido a elegir.

### Modo light y modo completo
- **Completo**: todas las funciones, con escenas y modo studio.
- **Light** (botón LIGHT): para ordenadores menos potentes. Las escenas y el modo studio se desactivan; las entradas de la escena en el aire se convierten en una lista sencilla, en las mismas posiciones, y la salida no se interrumpe. Las demás escenas se apartan y sus fuentes (cámaras, NDI, vídeos) se cierran. En modo light solo se pueden añadir temporizadores, TelePrompts, imágenes, un dispositivo de captura y una señal NDI.
- Con el botón STUDIO se vuelve al modo completo: las escenas regresan y la escena anterior vuelve al aire con los cambios hechos mientras tanto. Las entradas añadidas en modo light quedan fuera de las escenas.

### Los elementos
- **Temporizador**: cuenta atrás o cronómetro, tres colores (inicio, final cercano, tiempo superado), marco que parpadea al acabar el tiempo, reloj cuando está parado, señal acústica al terminar el tiempo (campana o archivo de audio, salida de audio a elegir, repetición). Barra espaciadora = iniciar/pausa.
- **Rótulo de texto**: una franja de texto que se desplaza si es más larga que la pantalla.
- **TelePrompt**: texto que sube a la velocidad elegida; se escribe, se pega o se importa (.docx, .rtf, .txt, .html); tamaño de letra en puntos; botones con icono para espejo y línea de lectura; pausa y reproducción automáticas al salir del aire o al entrar.
- **NDI**, **Dispositivo de captura**, **Multimedia** (vídeos e imágenes): ajustar / rellenar / estirar, recorte en % o en píxeles; en los vídeos: línea de tiempo que se puede arrastrar, con inicio y final marcables, repetición, reproducir cuando está en el aire, pausar y rebobinar cuando no lo está, audio Follow (solo suena en el aire).
- **Clic derecho en una entrada**: copiar, cortar, pegar, copiar y pegar atributos (solo el aspecto, entre entradas del mismo tipo).

### Control remoto
- **MIDI**: elige un comando, pulsa *Aprender* y toca una tecla del controlador.
- **Companion**: activa *Aceptar comandos por HTTP* y usa direcciones como `http://127.0.0.1:8765/api/cut` (módulo *Generic HTTP*). Guía completa (en inglés e italiano): [COMPANION.md](COMPANION.md).
- **Mando desde el móvil** (icono del teléfono en la barra inferior): activa el mando y escanea el código QR con un móvil o tablet conectado a la misma red Wi-Fi. Desde la página se ponen las escenas en vista previa o al aire, se usan CUT y FADE, se activa el modo studio, se muestran y ocultan las entradas, se inician temporizadores y TelePrompt, se abren los detalles de cada entrada para cambiar sus parámetros y con **+** se añaden entradas y escenas. *Código nuevo* cambia las direcciones: los enlaces antiguos dejan de funcionar.
- **Página del moderador**: en la misma ventana hay un segundo código QR para el moderador (una tablet o su propio móvil, en la misma red). Solo ve las entradas en las que la realización marcó **Mostrar en la página del moderador** (primera tarjeta de los detalles de la entrada, bajo el nombre), si están al aire, el tiempo de los temporizadores y pocos mandos: mostrar/ocultar, iniciar/pausar/poner a cero el temporizador, iniciar/pausar/inicio del TelePrompt.

### Consejos
- *Ver → Restablecer la disposición de ventanas* deja paneles y zonas como al principio.
- La configuración se guarda sola; para llevarla a otro PC usa el icono *Exportar* de la barra inferior.
