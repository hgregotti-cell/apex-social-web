APEX SOCIAL WEB V1 — GUÍA RÁPIDA
================================

Esta versión NO necesita Firebase, ni Apple Developer, ni compilar un IPA.
Se publica gratis mediante GitHub Pages y se consulta desde PC o iPhone.

1) CREAR EL REPOSITORIO
   En github.com, creá un repositorio público nuevo, por ejemplo apex-social-web.
   Subí TODO EL CONTENIDO de esta carpeta a la RAÍZ del repositorio:
   index.html, styles.css, app.js, despegues.json, manifest.webmanifest, assets/.
   No subas el ZIP sin descomprimir: GitHub Pages necesita los archivos.

2) PUBLICAR EL ENLACE
   Repositorio → Settings → Pages → Build and deployment:
   Source: Deploy from a branch; Branch: main; Folder: /(root); Save.
   Esperá a que GitHub muestre la URL (habitualmente
   https://TU-USUARIO.github.io/apex-social-web/).
   Abrí esa URL en PC o Safari. Compartila con cualquier piloto.

3) ADMINISTRAR DESPEGUES CON SEGURIDAD
   Todos pueden VER los despegues. Solo quien tenga un token autorizado
   puede agregar, editar o borrar desde el botón 'Administrar lugares'.
   En GitHub → Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token.
   Resource owner: tu cuenta. Repository access: ONLY apex-social-web.
   Repository permissions → Contents: Read and write.
   Creá el token con vencimiento y copialo en un lugar seguro.
   Al entrar a Administrar, poné usuario, repositorio y token.
   El token solo permanece en la memoria de esa pestaña; NO se publica
   en archivos del sitio ni se guarda en localStorage.
   IMPORTANTE: un token de GitHub NO es una contraseña compartida entre
   visitantes. No se lo des a nadie: otorga permiso de modificar archivos.

4) PERSISTENCIA Y RECUPERACIÓN
   Agregar/editar/borrar publica cambios en despegues.json mediante la API
   de GitHub. Todos ven la misma lista tras la actualización de Pages.
   El historial de commits permite recuperar un lugar borrado por error.
   El borrado exige además escribir ELIMINAR.
   Los favoritos son personales: quedan guardados en cada navegador.

5) EN IPHONE
   Abrí el enlace en Safari → Compartir → Añadir a pantalla de inicio.
   Sin certificados de Apple, sin renovación cada 7 días.

6) DATOS METEOROLÓGICOS
   Pronóstico horario de Open-Meteo para cada ubicación, 5 días.
   Límite conservador: ráfagas >=35 km/h, viento >=30 km/h, lluvia
   >=0.3 mm/h bloquean recomendación. Dirección compatible ±30°.
   Un 'favorable' es SOLO un filtro orientativo del modelo, no autoriza
   despegar: verificar observación local, turbulencia y criterios del piloto.
   El servicio externo puede limitar solicitudes y cambiar condiciones.

7) NOTAS
   Requiere internet y un navegador moderno; NO abrir index.html por
   doble clic (file:// puede bloquear lectura de JSON). Usar GitHub Pages.
   El mapa usa OpenStreetMap y opción satélite Esri, sujetos a sus políticas.
   Esta V1 prioriza consulta de despegues, orientación y meteorología.
   No incluye tracking, variometro, mensajes ni sincronización de favoritos.
   La meteorología no es idéntica a la app Flutter: esta versión usa
   un modelo Open-Meteo en lugar del conjunto de modelos de la app.
