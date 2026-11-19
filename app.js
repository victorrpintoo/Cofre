/* =========================================================
   Cofre — lógica de la app ("Tu oro, bajo llave")
   Los datos se guardan en el navegador (localStorage).
   ========================================================= */

// OJO: esta clave NO se cambia aunque la app se llame Cofre.
// Es el "cajón" donde ya están guardados los datos; si cambia, la app se vería vacía.
const CLAVE = "misFinanzas.v1";

const CATEGORIAS = {
  gasto: ["Vivienda", "Alimentación", "Transporte", "Servicios", "Salud", "Ejercicio",
          "Entretenimiento", "Videojuegos", "Educación", "Ahorro e inversión", "Deudas", "Otros"],
  ingreso: ["Salario", "Negocio", "Ventas", "Inversiones", "Regalos", "Otros"],
};

// Colores apagados estilo "dark fantasy" (uno por categoría de gasto)
const COLORES_DONA = ["#6B7A4F", "#A0784A", "#7D6E5D", "#B06A58", "#8C8C7A", "#5E6B5A",
                      "#B09A6E", "#6E5A48", "#8FA872", "#9A8F7E", "#7A4E42", "#5A5550"];
const COLOR_INGRESO = "#8FA872";
const COLOR_GASTO = "#B06A58";
const COLOR_SUPERFICIE = "#2A2621";

// ---------- Aviso flotante con botón "Deshacer" (reemplaza las ventanas de permiso) ----------
let temporizadorToast = null;
function mostrarAviso(texto, alDeshacer) {
  const toast = document.getElementById("toast");
  const boton = document.getElementById("toastDeshacer");
  document.getElementById("toastTexto").textContent = texto;
  boton.hidden = !alDeshacer;
  boton.onclick = () => { ocultarAviso(); if (alDeshacer) alDeshacer(); };
  toast.hidden = false;
  clearTimeout(temporizadorToast);
  temporizadorToast = setTimeout(ocultarAviso, 6000);
}
function ocultarAviso() { document.getElementById("toast").hidden = true; }

// Hace un cambio y deja la opción de deshacerlo
function cambiarConDeshacer(cambio, texto) {
  const copia = JSON.parse(JSON.stringify(datos));
  cambio();
  guardar();
  dibujarTodo();
  // El texto puede ser una función, para calcularlo DESPUÉS del cambio
  const mensaje = typeof texto === "function" ? texto() : texto;
  mostrarAviso(mensaje, () => { datos = copia; guardar(); dibujarTodo(); });
}

// ---------- Formato de dinero en Lempiras ----------
const formatoNumero = new Intl.NumberFormat("es-HN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function lempiras(valor) {
  const signo = valor < 0 ? "−" : "";
  return `${signo}L ${formatoNumero.format(Math.abs(valor))}`;
}

// ---------- Fechas (siempre en hora local, formato AAAA-MM-DD) ----------
function fechaISO(d) {
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}
function hoyISO() { return fechaISO(new Date()); }
function haceDias(n) { const d = new Date(); d.setDate(d.getDate() - n); return fechaISO(d); }
function fechaBonita(iso) {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(a, m - 1, d).toLocaleDateString("es-HN", { day: "numeric", month: "short" });
}

// ---------- Guardar y cargar datos ----------
let puedeGuardar = true;
function datosVacios() { return { movimientos: [], metas: [], presupuestos: {} }; }

// Limpia lo que venga guardado o de un respaldo (los respaldos viejos no traen presupuestos)
function normalizar(d) {
  const pres = d.presupuestos && typeof d.presupuestos === "object" && !Array.isArray(d.presupuestos) ? d.presupuestos : {};
  return {
    movimientos: Array.isArray(d.movimientos) ? d.movimientos : [],
    metas: Array.isArray(d.metas) ? d.metas : [],
    presupuestos: pres, // { "Alimentación": 3000, ... } límite mensual por categoría de gasto
  };
}

function cargar() {
  try {
    const texto = localStorage.getItem(CLAVE);
    if (!texto) return datosVacios();
    return normalizar(JSON.parse(texto));
  } catch (e) {
    puedeGuardar = false;
    return datosVacios();
  }
}
function guardar() {
  try { localStorage.setItem(CLAVE, JSON.stringify(datos)); }
  catch (e) { puedeGuardar = false; document.getElementById("avisoGuardado").hidden = false; }
}
function nuevoId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

let datos = cargar();
let periodo = "mes"; // "1" = hoy, "7" = últimos 7 días, "mes" = del día 1 de este mes a hoy
let graficaBarras = null;
let graficaDona = null;

// ---------- Movimientos del periodo elegido ----------
function rangoPeriodo() {
  const hasta = hoyISO();
  const desde = periodo === "mes" ? rangoMes(0).desde : haceDias(Number(periodo) - 1);
  return { desde, hasta };
}
function movimientosDelPeriodo() {
  const { desde, hasta } = rangoPeriodo();
  return datos.movimientos.filter(m => m.fecha >= desde && m.fecha <= hasta);
}

// =========================================================
//  RESUMEN Y GRÁFICAS
// =========================================================
function dibujarResumen() {
  const movs = movimientosDelPeriodo();
  const ingresos = movs.filter(m => m.tipo === "ingreso").reduce((s, m) => s + m.monto, 0);
  const gastos = movs.filter(m => m.tipo === "gasto").reduce((s, m) => s + m.monto, 0);
  const saldo = ingresos - gastos;

  document.getElementById("totalIngresos").textContent = lempiras(ingresos);
  document.getElementById("totalGastos").textContent = lempiras(gastos);
  const elSaldo = document.getElementById("totalSaldo");
  elSaldo.textContent = lempiras(saldo);
  elSaldo.classList.toggle("negativo", saldo < 0);

  dibujarGraficas(movs);
}

function dibujarGraficas(movs) {
  const nombres = { "1": "de hoy", "7": "de los últimos 7 días", "mes": "de este mes" };
  document.getElementById("tituloBarras").textContent = `Ingresos y gastos ${nombres[periodo]}`;

  if (typeof Chart === "undefined") {
    document.getElementById("sinGraficas").hidden = false;
    document.querySelectorAll(".graficas").forEach(g => g.hidden = true);
    return;
  }

  // Colores del texto y las líneas de las gráficas para fondo oscuro
  Chart.defaults.color = "#A89F91";
  Chart.defaults.borderColor = "rgba(228, 220, 207, 0.08)";
  Chart.defaults.font.family = "Inter, system-ui, sans-serif";

  // --- Barras: por categoría (hoy) o por día (7 / 30 días) ---
  let etiquetas, ingresosSerie, gastosSerie;
  if (periodo === "1") {
    const cats = [...new Set(movs.map(m => m.categoria))];
    etiquetas = cats.length ? cats : ["Sin movimientos"];
    ingresosSerie = etiquetas.map(c => sumar(movs, "ingreso", m => m.categoria === c));
    gastosSerie = etiquetas.map(c => sumar(movs, "gasto", m => m.categoria === c));
  } else {
    const cuantosDias = periodo === "mes" ? new Date().getDate() : Number(periodo);
    const dias = [];
    for (let i = cuantosDias - 1; i >= 0; i--) dias.push(haceDias(i));
    etiquetas = dias.map(fechaBonita);
    ingresosSerie = dias.map(d => sumar(movs, "ingreso", m => m.fecha === d));
    gastosSerie = dias.map(d => sumar(movs, "gasto", m => m.fecha === d));
  }

  const opcionesDinero = {
    responsive: true, maintainAspectRatio: false,
    plugins: { tooltip: { callbacks: { label: ctx => `${ctx.dataset.label || ctx.label}: ${lempiras(ctx.parsed.y ?? ctx.parsed)}` } } },
  };

  if (graficaBarras) graficaBarras.destroy();
  graficaBarras = new Chart(document.getElementById("graficaBarras"), {
    type: "bar",
    data: {
      labels: etiquetas,
      datasets: [
        { label: "Ingresos", data: ingresosSerie, backgroundColor: COLOR_INGRESO, borderRadius: 6 },
        { label: "Gastos", data: gastosSerie, backgroundColor: COLOR_GASTO, borderRadius: 6 },
      ],
    },
    options: {
      ...opcionesDinero,
      scales: {
        y: { beginAtZero: true, ticks: { callback: v => "L " + formatoNumero.format(v).replace(/[.,]00$/, "") } },
        x: { ticks: { maxRotation: 0, autoSkip: true } },
      },
    },
  });

  // --- Dona: gastos por categoría ---
  const gastos = movs.filter(m => m.tipo === "gasto");
  const cats = CATEGORIAS.gasto.filter(c => gastos.some(m => m.categoria === c));
  const valores = cats.map(c => sumar(gastos, "gasto", m => m.categoria === c));
  document.getElementById("sinGastos").hidden = cats.length > 0;
  document.getElementById("graficaDona").parentElement.hidden = cats.length === 0;

  if (graficaDona) graficaDona.destroy();
  graficaDona = null;
  if (cats.length) {
    graficaDona = new Chart(document.getElementById("graficaDona"), {
      type: "doughnut",
      data: { labels: cats, datasets: [{ data: valores, backgroundColor: cats.map(c => COLORES_DONA[CATEGORIAS.gasto.indexOf(c)]), borderWidth: 2, borderColor: COLOR_SUPERFICIE }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "60%",
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 12 } },
          tooltip: { callbacks: { label: ctx => `${ctx.label}: ${lempiras(ctx.parsed)}` } },
        },
      },
    });
  }
}

function sumar(movs, tipo, condicion) {
  return movs.filter(m => m.tipo === tipo && condicion(m)).reduce((s, m) => s + m.monto, 0);
}

// =========================================================
//  MOVIMIENTOS
// =========================================================
const form = document.getElementById("formMovimiento");
const selCategoria = document.getElementById("categoria");

function tipoElegido() { return form.querySelector('input[name="tipo"]:checked').value; }

function llenarCategorias() {
  selCategoria.innerHTML = "";
  CATEGORIAS[tipoElegido()].forEach(c => selCategoria.add(new Option(c, c)));
}

form.querySelectorAll('input[name="tipo"]').forEach(r => r.addEventListener("change", llenarCategorias));

// ---------- Modo edición: el mismo formulario sirve para anotar o corregir ----------
let editandoId = null; // id del movimiento que se está editando (null = anotando uno nuevo)

function empezarEdicion(m) {
  editandoId = m.id;
  form.querySelector(`input[name="tipo"][value="${m.tipo}"]`).checked = true;
  llenarCategorias();
  selCategoria.value = m.categoria;
  document.getElementById("monto").value = m.monto;
  document.getElementById("fecha").value = m.fecha;
  document.getElementById("descripcion").value = m.descripcion || "";
  document.getElementById("tituloMov").textContent = "Editar movimiento";
  document.getElementById("btnGuardarMov").textContent = "Guardar cambios";
  document.getElementById("btnCancelarEdicion").hidden = false;
  dibujarMovimientos();
  abrirHoja();
}

function salirDeEdicion() {
  editandoId = null;
  form.reset();
  document.getElementById("fecha").value = hoyISO();
  llenarCategorias();
  document.getElementById("tituloMov").textContent = "Anotar movimiento";
  document.getElementById("btnGuardarMov").textContent = "Guardar movimiento";
  document.getElementById("btnCancelarEdicion").hidden = true;
  dibujarMovimientos();
}

// ---------- Hoja que sube desde abajo con el formulario ----------
const hoja = document.getElementById("hojaAnotar");
function abrirHoja() {
  if (!hoja.open) hoja.showModal();
  document.getElementById("monto").focus();
}
function cerrarHoja() { if (hoja.open) hoja.close(); }
// Al cerrarse (con ✕, con la tecla Esc o tocando fuera) se sale del modo edición
hoja.addEventListener("close", () => { if (editandoId) salirDeEdicion(); });
hoja.addEventListener("click", e => { if (e.target === hoja) cerrarHoja(); }); // tocar el fondo oscuro
document.getElementById("btnCerrarHoja").addEventListener("click", cerrarHoja);
document.getElementById("btnCancelarEdicion").addEventListener("click", cerrarHoja);
document.getElementById("btnAnotar").addEventListener("click", () => {
  if (editandoId) salirDeEdicion();
  abrirHoja();
});

form.addEventListener("submit", e => {
  e.preventDefault();
  const monto = Math.round(parseFloat(document.getElementById("monto").value) * 100) / 100;
  if (!(monto > 0)) return;
  const mov = {
    id: editandoId || nuevoId(),
    tipo: tipoElegido(),
    monto,
    categoria: selCategoria.value,
    fecha: document.getElementById("fecha").value || hoyISO(),
    descripcion: document.getElementById("descripcion").value.trim(),
  };

  if (editandoId) {
    // Corregir uno que ya existía (con opción de deshacer)
    cambiarConDeshacer(
      () => { datos.movimientos = datos.movimientos.map(x => x.id === mov.id ? mov : x); },
      () => `Editaste "${mov.descripcion || mov.categoria}"` + alertaPresupuesto(mov)
    );
    cerrarHoja(); // también sale del modo edición
    return;
  }

  // Anotar uno nuevo (con opción de deshacer, por si te equivocaste)
  cambiarConDeshacer(
    () => { datos.movimientos.push(mov); },
    () => `${mov.tipo === "gasto" ? "Gasto" : "Ingreso"} guardado: ${lempiras(mov.monto)}` + alertaPresupuesto(mov)
  );
  document.getElementById("monto").value = "";
  document.getElementById("descripcion").value = "";
  cerrarHoja();
});

function dibujarMovimientos() {
  const lista = document.getElementById("listaMovimientos");
  lista.innerHTML = "";
  const movs = movimientosDelPeriodo().sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id.localeCompare(a.id));
  document.getElementById("sinMovimientos").hidden = movs.length > 0;

  movs.forEach(m => {
    const li = document.createElement("li");
    li.className = "mov" + (m.id === editandoId ? " editando" : "");

    const info = document.createElement("div");
    const desc = document.createElement("div");
    desc.className = "desc";
    desc.textContent = m.descripcion || m.categoria;
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `${fechaBonita(m.fecha)} · ${m.categoria}`;
    info.append(desc, meta);

    const monto = document.createElement("div");
    monto.className = `monto ${m.tipo}`;
    monto.textContent = (m.tipo === "ingreso" ? "+ " : "− ") + lempiras(m.monto);

    const acciones = document.createElement("div");
    acciones.className = "acciones";
    const editar = document.createElement("button");
    editar.className = "boton-mini";
    editar.textContent = "Editar";
    editar.addEventListener("click", () => empezarEdicion(m));

    const borrar = document.createElement("button");
    borrar.className = "boton-mini peligro";
    borrar.textContent = "Borrar";
    borrar.addEventListener("click", () => {
      if (m.id === editandoId) salirDeEdicion();
      cambiarConDeshacer(
        () => { datos.movimientos = datos.movimientos.filter(x => x.id !== m.id); },
        `Borraste "${m.descripcion || m.categoria}" (${lempiras(m.monto)})`
      );
    });
    acciones.append(editar, borrar);

    li.append(info, monto, acciones);
    lista.append(li);
  });
}

// =========================================================
//  METAS DE AHORRO
// =========================================================
document.getElementById("formMeta").addEventListener("submit", e => {
  e.preventDefault();
  const objetivo = Math.round(parseFloat(document.getElementById("metaObjetivo").value) * 100) / 100;
  const nombre = document.getElementById("metaNombre").value.trim();
  if (!nombre || !(objetivo > 0)) return;
  datos.metas.push({ id: nuevoId(), nombre, objetivo, ahorrado: 0, fechaLimite: document.getElementById("metaFecha").value || null });
  guardar();
  e.target.reset();
  dibujarMetas();
});

function dibujarMetas() {
  const cont = document.getElementById("listaMetas");
  cont.innerHTML = "";
  document.getElementById("sinMetas").hidden = datos.metas.length > 0;

  datos.metas.forEach(meta => {
    const pct = Math.min(100, (meta.ahorrado / meta.objetivo) * 100);
    const falta = Math.max(0, meta.objetivo - meta.ahorrado);

    const caja = document.createElement("div");
    caja.className = "meta-item";

    const fila = document.createElement("div");
    fila.className = "fila";
    const titulo = document.createElement("h3");
    titulo.textContent = meta.nombre;
    const cifras = document.createElement("span");
    cifras.className = "cifras";
    cifras.textContent = `${lempiras(meta.ahorrado)} de ${lempiras(meta.objetivo)}`;
    fila.append(titulo, cifras);

    const barra = document.createElement("div");
    barra.className = "barra";
    barra.setAttribute("role", "progressbar");
    barra.setAttribute("aria-valuenow", Math.round(pct));
    barra.setAttribute("aria-valuemin", "0");
    barra.setAttribute("aria-valuemax", "100");
    const relleno = document.createElement("div");
    relleno.style.width = pct + "%";
    barra.append(relleno);

    const detalle = document.createElement("p");
    detalle.className = "detalle";
    if (falta === 0) {
      detalle.innerHTML = '<span class="cumplida">¡Meta cumplida! 🎉</span>';
    } else {
      let texto = `${pct.toFixed(1)} % · Faltan ${lempiras(falta)}`;
      if (meta.fechaLimite) {
        const [a, m, d] = meta.fechaLimite.split("-").map(Number);
        const dias = Math.ceil((new Date(a, m - 1, d) - new Date(new Date().toDateString())) / 86400000);
        if (dias > 0) {
          const semanas = Math.max(1, dias / 7);
          texto += ` · Ahorra ${lempiras(falta / semanas)} por semana hasta el ${fechaBonita(meta.fechaLimite)}`;
        } else {
          texto += " · La fecha límite ya pasó";
        }
      }
      detalle.textContent = texto;
    }

    const botones = document.createElement("div");
    botones.className = "botones";
    // Cajita para aportar directamente (sin ventana emergente)
    const aporte = document.createElement("form");
    aporte.className = "aporte";
    const campo = document.createElement("input");
    campo.type = "number";
    campo.min = "0.01";
    campo.step = "0.01";
    campo.placeholder = "Monto L";
    campo.inputMode = "decimal";
    campo.setAttribute("aria-label", `Monto a aportar a ${meta.nombre}`);
    const aportar = document.createElement("button");
    aportar.type = "submit";
    aportar.className = "boton-mini";
    aportar.textContent = "+ Aportar";
    aporte.append(campo, aportar);
    aporte.addEventListener("submit", ev => {
      ev.preventDefault();
      const valor = Math.round(parseFloat(campo.value) * 100) / 100;
      if (!(valor > 0)) { mostrarAviso("Escribe un monto mayor que 0 para aportar."); campo.focus(); return; }
      cambiarConDeshacer(
        () => { const x = datos.metas.find(mt => mt.id === meta.id); x.ahorrado = Math.round((x.ahorrado + valor) * 100) / 100; },
        `Aportaste ${lempiras(valor)} a "${meta.nombre}"`
      );
    });

    const borrar = document.createElement("button");
    borrar.className = "boton-mini peligro";
    borrar.textContent = "Borrar meta";
    borrar.addEventListener("click", () => {
      cambiarConDeshacer(
        () => { datos.metas = datos.metas.filter(x => x.id !== meta.id); },
        `Borraste la meta "${meta.nombre}"`
      );
    });
    botones.append(aporte, borrar);

    caja.append(fila, barra, detalle, botones);
    cont.append(caja);
  });
}

// =========================================================
//  ESTE MES: PRESUPUESTO POR CATEGORÍA Y COMPARACIÓN
// =========================================================
// Rango de un mes: offset 0 = este mes, -1 = mes pasado
function rangoMes(offset) {
  const hoy = new Date();
  const inicio = new Date(hoy.getFullYear(), hoy.getMonth() + offset, 1);
  const fin = new Date(hoy.getFullYear(), hoy.getMonth() + offset + 1, 0);
  return { desde: fechaISO(inicio), hasta: fechaISO(fin), diasDelMes: fin.getDate(), fecha: inicio };
}
function movsEntre(desde, hasta) { return datos.movimientos.filter(m => m.fecha >= desde && m.fecha <= hasta); }
function nombreMes(fecha) {
  const t = fecha.toLocaleDateString("es-HN", { month: "long", year: "numeric" });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// Gasto del mes actual en una categoría (todo el mes calendario)
function gastadoEsteMes(categoria) {
  const { desde, hasta } = rangoMes(0);
  return sumar(movsEntre(desde, hasta), "gasto", m => m.categoria === categoria);
}

// Texto de alerta si un gasto deja la categoría cerca o por encima del límite ("" si todo bien)
function alertaPresupuesto(mov) {
  const limite = datos.presupuestos[mov.categoria];
  const { desde, hasta } = rangoMes(0);
  if (mov.tipo !== "gasto" || !limite || mov.fecha < desde || mov.fecha > hasta) return "";
  const gastado = gastadoEsteMes(mov.categoria);
  if (gastado > limite) return ` · ⚠️ Te pasaste del presupuesto de ${mov.categoria} por ${lempiras(gastado - limite)}`;
  if (gastado >= limite * 0.8) return ` · ⚠️ Ya usaste el ${Math.round((gastado / limite) * 100)} % del presupuesto de ${mov.categoria}`;
  return "";
}

// --- Formulario para poner un límite ---
const selPresCategoria = document.getElementById("presCategoria");
CATEGORIAS.gasto.forEach(c => selPresCategoria.add(new Option(c, c)));

document.getElementById("formPresupuesto").addEventListener("submit", e => {
  e.preventDefault();
  const campo = document.getElementById("presMonto");
  const monto = Math.round(parseFloat(campo.value) * 100) / 100;
  if (!(monto > 0)) return;
  const cat = selPresCategoria.value;
  const habia = datos.presupuestos[cat];
  cambiarConDeshacer(
    () => { datos.presupuestos[cat] = monto; },
    habia ? `Cambiaste el límite de ${cat} a ${lempiras(monto)}` : `Límite de ${cat}: ${lempiras(monto)} al mes`
  );
  campo.value = "";
});

function dibujarPresupuestos() {
  const cont = document.getElementById("listaPresupuestos");
  cont.innerHTML = "";
  // Ordenadas como en la lista de categorías
  const cats = CATEGORIAS.gasto.filter(c => datos.presupuestos[c] > 0);
  document.getElementById("sinPresupuestos").hidden = cats.length > 0;

  cats.forEach(cat => {
    const limite = datos.presupuestos[cat];
    const gastado = gastadoEsteMes(cat);
    const pct = (gastado / limite) * 100;
    const estado = pct > 100 ? "excedido" : pct >= 80 ? "alerta" : "ok";

    const caja = document.createElement("div");
    caja.className = `pres-item ${estado}`;

    const fila = document.createElement("div");
    fila.className = "fila";
    const titulo = document.createElement("h3");
    titulo.textContent = cat;
    const cifras = document.createElement("span");
    cifras.className = "cifras";
    cifras.textContent = `${lempiras(gastado)} de ${lempiras(limite)}`;
    fila.append(titulo, cifras);

    const barra = document.createElement("div");
    barra.className = "barra";
    barra.setAttribute("role", "progressbar");
    barra.setAttribute("aria-label", `Presupuesto de ${cat}`);
    barra.setAttribute("aria-valuenow", Math.round(pct));
    barra.setAttribute("aria-valuemin", "0");
    barra.setAttribute("aria-valuemax", "100");
    const relleno = document.createElement("div");
    relleno.style.width = Math.min(100, pct) + "%";
    barra.append(relleno);

    const pie = document.createElement("div");
    pie.className = "fila";
    const detalle = document.createElement("p");
    detalle.className = "detalle";
    detalle.textContent = estado === "excedido"
      ? `⚠️ Te pasaste por ${lempiras(gastado - limite)}`
      : `Te quedan ${lempiras(limite - gastado)}` + (estado === "alerta" ? " · ¡Cuidado, vas por el " + Math.round(pct) + " %!" : "");
    const quitar = document.createElement("button");
    quitar.className = "boton-mini peligro";
    quitar.textContent = "Quitar";
    quitar.addEventListener("click", () => {
      cambiarConDeshacer(() => { delete datos.presupuestos[cat]; }, `Quitaste el límite de ${cat}`);
    });
    pie.append(detalle, quitar);

    caja.append(fila, barra, pie);
    cont.append(caja);
  });
}

// --- Comparación: este mes contra el mes pasado, hasta el mismo día ---
let graficaComparacion = null;

function dibujarComparacion() {
  const actual = rangoMes(0);
  const pasado = rangoMes(-1);
  const dia = new Date().getDate();
  // Para que sea justo: del día 1 al día de hoy en ambos meses
  const hastaActual = hoyISO();
  const hastaPasado = fechaISO(new Date(pasado.fecha.getFullYear(), pasado.fecha.getMonth(), Math.min(dia, pasado.diasDelMes)));
  const movsA = movsEntre(actual.desde, hastaActual);
  const movsP = movsEntre(pasado.desde, hastaPasado);

  document.getElementById("nombreMes").textContent = nombreMes(actual.fecha);
  const mesPasado = pasado.fecha.toLocaleDateString("es-HN", { month: "long" });
  document.getElementById("notaComparacion").textContent =
    `Del 1 al ${dia} de este mes contra el 1 al ${Math.min(dia, pasado.diasDelMes)} de ${mesPasado}, para comparar lo mismo. ` +
    `${mesPasado.charAt(0).toUpperCase() + mesPasado.slice(1)} completo: gastaste ${lempiras(sumar(movsEntre(pasado.desde, pasado.hasta), "gasto", () => true))}.`;

  const filas = [
    { nombre: "Ingresos", a: sumar(movsA, "ingreso", () => true), p: sumar(movsP, "ingreso", () => true), subirEsBueno: true },
    { nombre: "Gastos", a: sumar(movsA, "gasto", () => true), p: sumar(movsP, "gasto", () => true), subirEsBueno: false },
  ];
  filas.push({ nombre: "Saldo", a: filas[0].a - filas[1].a, p: filas[0].p - filas[1].p, subirEsBueno: true });

  const tabla = document.getElementById("comparacion");
  tabla.innerHTML = "";
  filas.forEach(f => {
    const fila = document.createElement("div");
    fila.className = "comp-fila";
    const nombre = document.createElement("span");
    nombre.className = "comp-nombre";
    nombre.textContent = f.nombre;
    const valores = document.createElement("span");
    valores.className = "comp-valores";
    const actual = document.createElement("strong");
    actual.textContent = lempiras(f.a);
    const antes = document.createElement("small");
    antes.textContent = `antes ${lempiras(f.p)}`;
    valores.append(actual, antes);
    const cambio = document.createElement("span");
    cambio.className = "comp-cambio";
    const dif = f.a - f.p;
    if (dif === 0) {
      cambio.textContent = "= igual";
    } else {
      const flecha = dif > 0 ? "▲" : "▼";
      // Si el mes pasado fue 0 no se puede sacar porcentaje: decimos "nuevo"
      cambio.textContent = f.p !== 0 ? `${flecha} ${Math.abs(Math.round((dif / Math.abs(f.p)) * 100))} %` : `${flecha} nuevo`;
      cambio.classList.add((dif > 0) === f.subirEsBueno ? "bueno" : "malo");
    }
    fila.append(nombre, valores, cambio);
    tabla.append(fila);
  });

  // Gráfica: gastos por categoría, mes pasado vs este mes
  const contGrafica = document.getElementById("graficaComparacion").parentElement;
  const cats = CATEGORIAS.gasto.filter(c => movsA.concat(movsP).some(m => m.tipo === "gasto" && m.categoria === c));
  document.getElementById("sinComparacion").hidden = cats.length > 0;
  contGrafica.hidden = cats.length === 0 || typeof Chart === "undefined";
  if (graficaComparacion) graficaComparacion.destroy();
  graficaComparacion = null;
  if (contGrafica.hidden) return;

  contGrafica.style.height = Math.max(160, cats.length * 46 + 60) + "px";
  graficaComparacion = new Chart(document.getElementById("graficaComparacion"), {
    type: "bar",
    data: {
      labels: cats,
      datasets: [
        { label: "Mes pasado", data: cats.map(c => sumar(movsP, "gasto", m => m.categoria === c)), backgroundColor: "#6E655A", borderRadius: 4 },
        { label: "Este mes", data: cats.map(c => sumar(movsA, "gasto", m => m.categoria === c)), backgroundColor: COLOR_GASTO, borderRadius: 4 },
      ],
    },
    options: {
      indexAxis: "y", responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 12 } },
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${lempiras(ctx.parsed.x)}` } },
      },
      scales: { x: { beginAtZero: true, ticks: { callback: v => "L " + formatoNumero.format(v).replace(/[.,]00$/, "") } } },
    },
  });
}

// =========================================================
//  MENÚ ESCONDIDO ☰ (respaldo y cargar)
// =========================================================
const btnMenu = document.getElementById("btnMenu");
const panelMenu = document.getElementById("panelMenu");
function abrirMenu() { panelMenu.hidden = false; btnMenu.setAttribute("aria-expanded", "true"); btnMenu.textContent = "✕"; }
function cerrarMenu() { panelMenu.hidden = true; btnMenu.setAttribute("aria-expanded", "false"); btnMenu.textContent = "☰"; }
btnMenu.addEventListener("click", e => { e.stopPropagation(); panelMenu.hidden ? abrirMenu() : cerrarMenu(); });
// Se cierra al tocar fuera del menú o con la tecla Esc
document.addEventListener("click", e => { if (!panelMenu.hidden && !e.target.closest(".menu")) cerrarMenu(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !panelMenu.hidden) { cerrarMenu(); btnMenu.focus(); } });

// =========================================================
//  RESPALDO (descargar / cargar archivo .json)
// =========================================================
document.getElementById("btnExportar").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(datos, null, 2)], { type: "application/json" });
  const enlace = document.createElement("a");
  enlace.href = URL.createObjectURL(blob);
  enlace.download = `respaldo-cofre-${hoyISO()}.json`;
  enlace.click();
  URL.revokeObjectURL(enlace.href);
  cerrarMenu();
  mostrarAviso("Respaldo descargado. Guárdalo en un lugar seguro.");
});

document.getElementById("archivoImportar").addEventListener("change", e => {
  const archivo = e.target.files[0];
  if (!archivo) return;
  cerrarMenu();
  const lector = new FileReader();
  lector.onload = () => {
    try {
      const d = JSON.parse(lector.result);
      if (!Array.isArray(d.movimientos) || !Array.isArray(d.metas)) throw new Error("formato");
      cambiarConDeshacer(
        () => { datos = normalizar(d); },
        `Respaldo cargado: ${d.movimientos.length} movimientos y ${d.metas.length} metas`
      );
    } catch (err) {
      mostrarAviso("Ese archivo no es un respaldo válido de Cofre.");
    } finally {
      e.target.value = "";
    }
  };
  lector.readAsText(archivo);
});

// =========================================================
//  SELECTOR DE PERIODO E INICIO
// =========================================================
// Hay un selector en Inicio y otro en Movimientos: los dos se mueven juntos
document.querySelectorAll(".selector-periodo button").forEach(btn => {
  btn.addEventListener("click", () => {
    periodo = btn.dataset.periodo;
    document.querySelectorAll(".selector-periodo button").forEach(b => b.classList.toggle("activo", b.dataset.periodo === periodo));
    dibujarTodo();
  });
});

// =========================================================
//  PESTAÑAS (barra de abajo)
// =========================================================
function irA(nombre) {
  document.querySelectorAll(".pestana").forEach(p => p.hidden = p.dataset.pestana !== nombre);
  document.querySelectorAll(".barra-pestanas button").forEach(b => {
    const activa = b.dataset.ir === nombre;
    b.classList.toggle("activa", activa);
    if (activa) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  window.scrollTo(0, 0);
  dibujarTodo(); // las gráficas se redibujan al hacerse visibles
}
document.querySelectorAll(".barra-pestanas button").forEach(b => b.addEventListener("click", () => irA(b.dataset.ir)));

function dibujarTodo() {
  dibujarResumen();
  dibujarComparacion();
  dibujarPresupuestos();
  dibujarMovimientos();
  dibujarMetas();
}

// Comprobar si el navegador permite guardar
try { localStorage.setItem(CLAVE + ".prueba", "1"); localStorage.removeItem(CLAVE + ".prueba"); }
catch (e) { puedeGuardar = false; }
document.getElementById("avisoGuardado").hidden = puedeGuardar;

document.getElementById("fecha").value = hoyISO();
llenarCategorias();
dibujarTodo();

// =========================================================
//  FUNCIONAR SIN INTERNET (service worker)
//  Solo funciona cuando la app se abre desde una dirección web
//  (http/https), no con doble clic al archivo.
// =========================================================
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js").catch(() => { /* si falla, la app sigue funcionando normal */ });
}
