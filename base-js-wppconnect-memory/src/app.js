import { join } from 'path'
import { createBot, createProvider, createFlow, addKeyword, utils, EVENTS } from '@builderbot/bot'
import { MemoryDB as Database } from '@builderbot/bot'
import { WPPConnectProvider as Provider } from '@builderbot/provider-wppconnect'
import QRPortalWeb from '@bot-whatsapp/portal'
import { readFileSync, existsSync, statSync, writeFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// Obtener __dirname para ES Modules
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PORT = process.env.PORT ?? 3008

// ============= MANEJADORES DE ERRORES GLOBALES =============
process.on('uncaughtException', (err) => {
    console.error('🔴 Uncaught Exception:', err.message)
    console.error(err.stack)
})

process.on('unhandledRejection', (reason, promise) => {
    console.error('🔴 Unhandled Rejection at:', promise)
    console.error('Reason:', reason)
})

// ============= UTILIDADES =============

// Quitar acentos para normalizar respuestas
const quitarAcentos = (txt) =>
    txt.normalize('NFD').replace(/[\u0300-\u036f]/g, '')

// Conjuntos de respuestas válidas
const RESP_SI = new Set(['1', 'si', 's', 'y', 'yes'])
const RESP_NO = new Set(['2', 'no', 'n', 'nop'])

// Contador de solicitudes
let contadorSolicitudes = 1

// ============= BASE DE DATOS LOCAL =============
const DB_PATH = join(__dirname, 'local_db.json')

function readDb() {
    if (!existsSync(DB_PATH)) {
        return { user_state: {}, solicitudes_contacto: [] }
    }
    try {
        const data = readFileSync(DB_PATH, 'utf-8')
        return JSON.parse(data)
    } catch (e) {
        return { user_state: {}, solicitudes_contacto: [] }
    }
}

function writeDb(data) {
    try {
        writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8')
    } catch (error) {
        console.error('❌ Error al escribir en la base de datos:', error.message)
    }
}

async function guardarEstado(usuarioId, data) {
    try {
        const db = readDb()
        if (!db.user_state) db.user_state = {}

        db.user_state[usuarioId] = {
            ...db.user_state[usuarioId],
            ...data,
            updatedAt: new Date().toISOString()
        }

        writeDb(db)
    } catch (error) {
        console.error('❌ Error al guardar estado:', error.message)
    }
}

async function obtenerEstado(usuarioId) {
    try {
        const db = readDb()
        return db.user_state ? db.user_state[usuarioId] : null
    } catch (error) {
        console.error('❌ Error al obtener estado:', error.message)
        return null
    }
}

async function borrarEstado(usuarioId) {
    try {
        const db = readDb()
        if (db.user_state && db.user_state[usuarioId]) {
            delete db.user_state[usuarioId]
            writeDb(db)
        }
    } catch (error) {
        console.error('❌ Error al borrar estado:', error.message)
    }
}

async function guardarSolicitudContacto(data) {
    const db = readDb()
    if (!db.solicitudes_contacto) db.solicitudes_contacto = []

    db.solicitudes_contacto.push({
        ...data,
        createdAt: new Date().toISOString()
    })

    writeDb(db)
}

// ============= UTILIDAD PARA LEER ARCHIVOS =============
function leerArchivo(relPath, porDefecto = 'No disponible.') {
    try {
        const absPath = join(__dirname, relPath)
        if (!existsSync(absPath)) {
            console.warn(`⚠️ Archivo no encontrado: ${relPath}`)
            return porDefecto
        }

        const stats = statSync(absPath)
        if (stats.isDirectory()) {
            console.warn(`⚠️ La ruta es un directorio: ${relPath}`)
            return porDefecto
        }

        return readFileSync(absPath, 'utf8')
    } catch (error) {
        console.error(`❌ Error al leer archivo ${relPath}:`, error.message)
        return porDefecto
    }
}

// Función para enviar media de forma segura
async function enviarMediaSeguro(flowDynamic, texto, mediaUrl) {
    try {
        if (mediaUrl && mediaUrl.startsWith('http')) {
            await flowDynamic([{ body: texto, media: mediaUrl }])
        } else {
            console.warn(`⚠️ URL de media inválida: ${mediaUrl}`)
            await flowDynamic(texto + '\n(Documento no disponible)')
        }
    } catch (error) {
        console.error('❌ Error al enviar media:', error.message)
        await flowDynamic(texto + '\n(Error al cargar documento)')
    }
}

// ============= MENSAJES =============
const menu = leerArchivo('mensajes/menu.txt')
const programas = leerArchivo('mensajes/programas.txt')
const admision = leerArchivo('mensajes/admision.txt')
const requisitos = leerArchivo('mensajes/requisitos.txt')
const costos = leerArchivo('mensajes/costos.txt')
// eslint-disable-next-line no-unused-vars
const fechasadmision = leerArchivo('mensajes/fechasadmision.txt')
const infoplus = leerArchivo('desc/info.txt')

// ============= FACULTADES =============
const facultades = {
    '1': {
        nombre: 'Facultad de Ciencias de la Salud',
        maestrias: {
            '1': { nombre: 'Maestría en Gerencia en Salud', descripcion: leerArchivo('desc/fcs/maestrias/1.txt'), brochure: 'https://posgrado.unac.edu.pe/brochure/FCS/MAESTRIA/BROCHURE_MAESTRIA_EN_GERENCIA_EN_SALUD.pdf' },
            '2': { nombre: 'Maestría en Salud Pública', descripcion: leerArchivo('desc/fcs/maestrias/2.txt'), brochure: 'https://posgrado.unac.edu.pe/brochure/FCS/MAESTRIA/BROCHURE_MAESTRIA_EN_SALUD_PUBLICA.pdf' },
            '3': { nombre: 'Maestría en Ciencias de la Salud con Mención en Educación para la Salud', descripcion: leerArchivo('desc/fcs/maestrias/3.txt'), brochure: 'https://posgrado.unac.edu.pe/brochure/FCS/MAESTRIA/BROCHURE_MAESTRIA_EN_CIENCIAS_DE_SALUD_CON_MENCION_EN_EDUCACION_PARA_SALUD.pdf' },
            '4': { nombre: 'Maestría en Enfermería', descripcion: leerArchivo('desc/fcs/maestrias/4.txt'), brochure: 'https://posgrado.unac.edu.pe/brochure/FCS/MAESTRIA/BROCHURE_MAESTRIA_EN_ENFERMERIA.pdf' },
            '5': { nombre: 'Maestría en Enfermería Familiar y Comunitaria', descripcion: leerArchivo('desc/fcs/maestrias/5.txt'), brochure: 'https://posgrado.unac.edu.pe/brochure/FCS/MAESTRIA/BROCHURE_MAESTRIA_EN_ENFERMERIA_FAMILIAR_Y_COMUNITARIA.pdf' },
            '6': { nombre: 'Maestría en Salud Ocupacional y Ambiental', descripcion: leerArchivo('desc/fcs/maestrias/6.txt'), brochure: 'https://posgrado.unac.edu.pe/brochure/FCS/MAESTRIA/BROCHURE_MAESTRIA_EN_SALUD_OCUPACIONAL_Y_AMBIENTAL.pdf' }
        },
        doctorados: {
            '1': { nombre: 'Doctorado en Salud Pública', descripcion: leerArchivo('desc/fcs/doctorados/1.txt'), brochure: 'https://posgrado.unac.edu.pe/brochure/FCS/DOCTORADO/BROCHURE_DOCTORADO_EN_SALUD_PUBLICA.pdf' },
            '2': { nombre: 'Doctorado en Ciencias de la Salud', descripcion: leerArchivo('desc/fcs/doctorados/2.txt'), brochure: 'https://posgrado.unac.edu.pe/brochure/FCS/DOCTORADO/BROCHURE_DOCTORADO_EN_CIENCIAS_DE_SALUD.pdf' },
            '3': { nombre: 'Doctorado en Administración en Salud', descripcion: leerArchivo('desc/fcs/doctorados/1.txt'), brochure: 'https://posgrado.unac.edu.pe/brochure/FCS/DOCTORADO/BROCHURE_DOCTORADO_EN_ADMINISTRACION_EN_SALUD.pdf' },
            '4': { nombre: 'Doctorado en Enfermería', descripcion: leerArchivo('desc/fcs/doctorados/1.txt'), brochure: 'https://posgrado.unac.edu.pe/brochure/FCS/DOCTORADO/BROCHURE_DOCTORADO_EN_ENFERMERIA.pdf' }
        }
    },
    '2': {
        nombre: 'Facultad de Ciencias Administrativas',
        maestrias: {
            '1': { nombre: 'Maestría en Administración Estratégica de Empresas', descripcion: leerArchivo('desc/fca/maestrias/1.txt'), brochure: 'https://posgrado.unac.edu.pe/brochure/FCA/MAESTRIA/BROCHURE_MAESTRIA_EN_ADMINISTRACION_ESTRATEGICA_DE_EMPRESAS.pdf' },
            '2': { nombre: 'Maestría en Gerencia Educativa', descripcion: leerArchivo('desc/fca/maestrias/2.txt'), brochure: 'https://posgrado.unac.edu.pe/brochure/FCA/MAESTRIA/BROCHURE_MAESTRIA_EN_GERENCIA_EDUCATIVA.pdf' },
            '3': { nombre: 'Maestría en Administración Marítima y Portuaria', descripcion: leerArchivo('desc/fca/maestrias/3.txt'), brochure: 'https://posgrado.unac.edu.pe/brochure/FCA/MAESTRIA/BROCHURE_MAESTRIA_EN_ADMINISTRACION_MARITIMA_Y_PORTUARIA.pdf' }
        },
        doctorados: {
            '1': { nombre: 'Doctorado en Administración', descripcion: leerArchivo('desc/fca/doctorados/1.txt'), brochure: 'https://posgrado.unac.edu.pe/brochure/FCA/DOCTORADO/BROCHURE_DOCTORADO_EN_ADMINISTRACION.pdf' }
        }
    },
    '3': {
        nombre: 'Facultad de Ingeniería Industrial y de Sistemas',
        maestrias: {
            '1': { nombre: 'Maestría en Ingeniería Industrial con mención en Gerencia de la Calidad y Productividad', descripcion: leerArchivo('desc/fiis/maestrias/1.txt'), brochure: 'https://posgrado.unac.edu.pe/brochure/FIIS/MAESTRIA/BROCHURE_MAESTRIA_EN_INGENIERIA_INDUSTRIAL_CON_MENCION_EN_GERENCIA_DE_CALIDAD_Y_PRODUCTIVIDAD.pdf' },
            '2': { nombre: 'Maestría en Ingeniería Industrial con mención en Gerencia en Logística', descripcion: leerArchivo('desc/fiis/maestrias/2.txt'), brochure: 'https://posgrado.unac.edu.pe/brochure/FIIS/MAESTRIA/BROCHURE_MAESTRIA_EN_INGENIERIA_INDUSTRIAL_CON_MENCION_EN_GERENCIA_EN_LOGISTICA.pdf' },
            '3': { nombre: 'Maestría en Ingeniería de Sistemas', descripcion: leerArchivo('desc/fiis/maestrias/3.txt'), brochure: 'https://posgrado.unac.edu.pe/brochure/FIIS/MAESTRIA/BROCHURE_MAESTRIA_EN_INGENIERIA_DE_SISTEMAS.pdf' }
        },
        doctorados: {
            '1': { nombre: 'Doctorado en Ingeniería de Sistemas', descripcion: leerArchivo('desc/fiis/doctorados/1.txt'), brochure: 'https://posgrado.unac.edu.pe/brochure/FIIS/DOCTORADO/DOCTORADO_EN_INGENIERIA_DE_SISTEMAS.pdf' },
            '2': { nombre: 'Doctorado en Ingeniería Industrial', descripcion: leerArchivo('desc/fiis/doctorados/2.txt'), brochure: 'https://posgrado.unac.edu.pe/brochure/FIIS/DOCTORADO/DOCTORADO_EN_INGENIERIA_INDUSTRIAL.pdf' }
        }
    },
    '4': {
        nombre: 'Facultad de Ciencias Contables',
        maestrias: {
            '1': { nombre: 'Maestría en Tributación', descripcion: leerArchivo('desc/fcc/maestrias/1.txt'), brochure: 'https://posgrado.unac.edu.pe/brochure/FCC/MAESTRIA/BROCHURE_MAESTRIA_EN_TRIBUTACION.pdf' },
            '2': { nombre: 'Maestría en Ciencias Fiscalizadoras con Mención en Auditoría Gubernamental', descripcion: leerArchivo('desc/fcc/maestrias/2.txt'), brochure: 'https://posgrado.unac.edu.pe/brochure/FCC/MAESTRIA/BROCHURE_MAESTRIA_EN_CIENCIAS_FISCALIZADORAS_CON_MENCION_EN_AUDITORIA_GUBERNAMENTAL.pdf' },
            '3': { nombre: 'Maestría en Ciencias Fiscalizadoras con Mención en Auditoría Integral Empresarial', descripcion: leerArchivo('desc/fcc/maestrias/3.txt'), brochure: 'https://posgrado.unac.edu.pe/brochure/FCC/MAESTRIA/BROCHURE_MAESTRIA_EN_CIENCIAS_FISCALIZADORAS_CON_MENCION_EN_AUDITORIA_INTEGRAL_EMPRESARIAL.pdf' },
            '4': { nombre: 'Maestría en Gestión Pública', descripcion: leerArchivo('desc/fcc/maestrias/4.txt'), brochure: 'https://posgrado.unac.edu.pe/brochure/FCC/MAESTRIA/BROCHURE_MAESTRIA_EN_GESTION_PUBLICA.pdf' }
        },
        doctorados: {
            '1': { nombre: 'Doctorado en Ciencias Contables', descripcion: leerArchivo('desc/fcc/doctorados/1.txt'), brochure: 'https://posgrado.unac.edu.pe/brochure/FCC/DOCTORADO/BROCHURE_DOCTORADO_EN_CIENCIAS_CONTABLES.pdf' }
        }
    },
    '5': {
        nombre: 'Facultad de Ingeniería Eléctrica y Electrónica',
        maestrias: {
            '1': { nombre: 'Maestría en Ciencias de la Electrónica con Mención en Ingeniería Biomédica', descripcion: leerArchivo('desc/fiee/maestrias/1.txt'), brochure: 'https://posgrado.unac.edu.pe/brochure/FIEE/MAESTRIA/BROCHURE_MAESTRIA_EN_CIENCIAS_DE_ELECTRONICA_CON_MENCION_EN_INGENIERIA_BIOMEDICA.pdf' },
            '2': { nombre: 'Maestría en Ciencias de la Electrónica con mención en Control y Automatización', descripcion: leerArchivo('desc/fiee/maestrias/2.txt'), brochure: 'https://posgrado.unac.edu.pe/brochure/FIEE/MAESTRIA/BROCHURE_MAESTRIA_EN_CIENCIAS_DE_ELECTRONICA_CON_MENCION_EN_CONTROL_Y_AUTOMATIZACION.pdf' },
            '3': { nombre: 'Maestría en Ciencias de la Electrónica con mención en Telecomunicaciones', descripcion: leerArchivo('desc/fiee/maestrias/3.txt'), brochure: 'https://posgrado.unac.edu.pe/brochure/FIEE/MAESTRIA/BROCHURE_MAESTRIA_EN_CIENCIAS_DE_ELECTRONICA_CON_MENCION_EN_TELECOMUNICACIONES.pdf' },
            '4': { nombre: 'Maestría en Ingeniería Eléctrica con mención en Gestión de Sistemas de Energía Eléctrica', descripcion: leerArchivo('desc/fiee/maestrias/4.txt'), brochure: 'https://posgrado.unac.edu.pe/brochure/FIEE/MAESTRIA/BROCHURE_MAESTRIA_EN_INGENIERIA_ELECTRICA_CON_MENCION_EN_GESTION_DE_SISTEMAS_DE_ENERGIA_ELECTRICA.pdf' },
            '5': { nombre: 'Maestría en Ingeniería Eléctrica con mención en Gerencia de Proyectos de Ingeniería', descripcion: leerArchivo('desc/fiee/maestrias/5.txt'), brochure: 'https://posgrado.unac.edu.pe/brochure/FIEE/MAESTRIA/BROCHURE_MAESTRIA_EN_INGENIERIA_ELECTRICA_CON_MENCION_EN_GERENCIA_DE_PROYECTOS_DE_INGENIERIA.pdf' }
        },
        doctorados: {
            '1': { nombre: 'Doctorado en Ingeniería Eléctrica', descripcion: leerArchivo('desc/fiee/doctorados/1.txt'), brochure: 'https://posgrado.unac.edu.pe/brochure/FIEE/DOCTORADO/BROCHURE_DOCTORADO_EN_INGENIERIA_ELECTRICA.pdf' }
        }
    },
    '6': {
        nombre: 'Facultad de Ingeniería Pesquera y de Alimentos',
        maestrias: {
            '1': { nombre: 'Maestría en Gestión Pesquera', descripcion: leerArchivo('desc/fipa/maestrias/1.txt'), brochure: 'https://posgrado.unac.edu.pe/brochure/FIPA/MAESTRIA/BROCHURE_MAESTRIA_EN_GESTION_PESQUERA.pdf' },
            '2': { nombre: 'Maestría en Ingeniería de Alimentos', descripcion: leerArchivo('desc/fipa/maestrias/2.txt'), brochure: 'https://posgrado.unac.edu.pe/brochure/FIPA/MAESTRIA/BROCHURE_MAESTRIA_EN_INGENIERIA_DE_ALIMENTOS.pdf' }
        }
    },
    '7': {
        nombre: 'Facultad de Ingeniería Mecánica y Energía',
        maestrias: {
            '1': { nombre: 'Maestría en Gerencia del Mantenimiento', descripcion: leerArchivo('desc/fime/maestrias/1.txt'), brochure: 'https://posgrado.unac.edu.pe/brochure/FIME/MAESTRIA/BROCHURE_MAESTRIA_EN_GERENCIA_DEL_MANTENIMIENTO.pdf' }
        }
    },
    '8': {
        nombre: 'Facultad de Ciencias Naturales y Matemática',
        maestrias: {
            '1': { nombre: 'Maestría en Didáctica de las Enseñanza de la Física y Matemática', descripcion: leerArchivo('desc/fcnm/maestrias/1.txt'), brochure: 'https://posgrado.unac.edu.pe/brochure/FCNM/MAESTRIA/BROCHURE_MAESTRIA_EN_DIDACTICA_DE_ENSENANZA_DE_FISICA_Y_MATEMATICA.pdf' }
        }
    },
    '9': {
        nombre: 'Facultad de Ingeniería Ambiental y de Recursos Naturales',
        maestrias: {
            '1': { nombre: 'Maestría en Gestión Ambiental para el Desarrollo Sostenible', descripcion: leerArchivo('desc/fiarn/maestrias/1.txt'), brochure: 'https://posgrado.unac.edu.pe/brochure/FIARN/MAESTRIA/BROCHURE_MAESTRIA_EN_GESTION_AMBIENTAL_PARA_DESARROLLO_SOSTENIBLE.pdf' }
        }
    },
    '10': {
        nombre: 'Facultad de Ciencias Económicas',
        maestrias: {
            '1': { nombre: 'Maestría en Comercio y Negociaciones Internacionales', descripcion: leerArchivo('desc/fce/maestrias/1.txt'), brochure: 'https://posgrado.unac.edu.pe/brochure/FCE/MAESTRIA/BROCHURE_MAESTRIA_EN_COMERCIO_Y_NEGOCIACIONES_INTERNACIONALES.pdf' },
            '2': { nombre: 'Maestría en Finanzas', descripcion: leerArchivo('desc/fce/maestrias/2.txt'), brochure: 'https://posgrado.unac.edu.pe/brochure/FCE/MAESTRIA/BROCHURE_MAESTRIA_EN_FINANZAS.pdf' },
            '3': { nombre: 'Maestría en Investigación y Docencia Universitaria', descripcion: leerArchivo('desc/fce/maestrias/3.txt'), brochure: 'https://posgrado.unac.edu.pe/brochure/FCE/MAESTRIA/BROCHURE_MAESTRIA_EN_INVESTIGACION_Y_DOCENCIA_UNIVERSITARIA.pdf' },
            '4': { nombre: 'Maestría en Proyectos de Inversión', descripcion: leerArchivo('desc/fce/maestrias/4.txt'), brochure: 'https://posgrado.unac.edu.pe/brochure/FCE/MAESTRIA/BROCHURE_MAESTRIA_EN_PROYECTOS_DE_INVERSION.pdf' }
        }
    },
    '11': {
        nombre: 'Facultad de Ingeniería Química',
        maestrias: {
            '1': { nombre: 'Maestría en Gerencia de la Calidad y Desarrollo Humano', descripcion: leerArchivo('desc/fiq/maestrias/1.txt'), brochure: 'https://posgrado.unac.edu.pe/brochure/FIQ/MAESTRIA/BROCHURE_MAESTRIA_EN_GERENCIA_DE_CALIDAD_Y_DESARROLLO_HUMANO.pdf' },
            '2': { nombre: 'Maestría en Ciencia y Tecnología de los Alimentos', descripcion: leerArchivo('desc/fiq/maestrias/2.txt'), brochure: 'https://posgrado.unac.edu.pe/brochure/FIQ/MAESTRIA/BROCHURE_MAESTRIA_EN_CIENCIA_Y_TECNOLOGIA_ALIMENTOS.pdf' },
            '3': { nombre: 'Maestría en Ingeniería Química', descripcion: leerArchivo('desc/fiq/maestrias/3.txt'), brochure: 'https://posgrado.unac.edu.pe/brochure/FIQ/MAESTRIA/BROCHURE_MAESTRIA_EN_INGENIERIA_QUIMICA.pdf' }
        }
    },
    '12': {
        nombre: 'Facultad de Ciencias de la Educación',
        maestrias: {
            '1': { nombre: 'Maestría en Gerencia de la Calidad y Desarrollo Humano', descripcion: leerArchivo('desc/fiq/maestrias/1.txt'), brochure: 'https://posgrado.unac.edu.pe/brochure/FCED/MAESTRIA/BROCHURE_MAESTRIA_EN_GERENCIA_DEL_DESARROLLO_HUMANO.pdf' }
        },
        doctorados: {
            '1': { nombre: 'Doctorado en Educación', descripcion: leerArchivo('desc/fced/doctorados/1.txt'), brochure: 'https://posgrado.unac.edu.pe/brochure/FCED/DOCTORADO/BROCHURE_DOCTORADO_EN_EDUCACION.pdf' }
        }
    }
}

// ============= FLUJOS =============

// Flujo de Contacto - Usando state interno del bot
const flowContacto = addKeyword(utils.setEvent('CONTACTO_FLOW'))
    .addAnswer(
        '📋 *Formulario de contacto personalizado*\n' +
        '¿Cuál es el tipo de consulta?\n' +
        '1. Información académica\n2. Admisiones y becas\n3. Proceso de inscripción\n4. Documentación\n5. Otro',
        { capture: true },
        async (ctx, { state, fallBack }) => {
            if (!['1', '2', '3', '4', '5'].includes(ctx.body)) return fallBack()
            await state.update({ tipoConsulta: ctx.body })
        }
    )
    .addAnswer(
        '¿Cuál es tu canal preferido para que te contactemos?\n1. WhatsApp\n2. Correo\n3. Teléfono\n4. Videollamada',
        { capture: true },
        async (ctx, { state, fallBack }) => {
            if (!['1', '2', '3', '4'].includes(ctx.body)) return fallBack()
            await state.update({ canal: ctx.body })
        }
    )
    .addAnswer('👤 Por favor, escribe tu *nombre completo*:', { capture: true }, async (ctx, { state }) => {
        await state.update({ nombre: ctx.body })
    })
    .addAnswer('📧 Ahora escribe tu *correo electrónico*:', { capture: true }, async (ctx, { state }) => {
        await state.update({ correo: ctx.body.trim().toLowerCase() })
    })
    .addAnswer('📱 Tu *número de teléfono*:', { capture: true }, async (ctx, { state }) => {
        await state.update({ telefono: ctx.body })
    })
    .addAnswer('✍️ Por último, escribe un *mensaje o detalle de tu consulta*:', { capture: true }, async (ctx, { state, flowDynamic }) => {
        try {
            const myState = state.getMyState() || {}

            const solicitud = {
                usuarioId: ctx.from,
                tipoConsulta: myState.tipoConsulta || 'No especificado',
                canal: myState.canal || 'No especificado',
                nombre: myState.nombre || 'No proporcionado',
                correo: myState.correo || 'No proporcionado',
                telefono: myState.telefono || 'No proporcionado',
                mensaje: ctx.body
            }

            // Guardar en la base de datos local
            await guardarSolicitudContacto(solicitud)
            contadorSolicitudes++

            // Confirmación al usuario
            await flowDynamic('✅ Gracias. Tu solicitud fue registrada y un asesor te contactará pronto.\nSu ID de solicitud es: ' + contadorSolicitudes)

            // Limpiar estado
            await state.clear()
        } catch (error) {
            console.error('❌ Error en flowContacto:', error.message)
            await flowDynamic('❌ Ocurrió un error al registrar tu solicitud. Por favor intenta de nuevo.')
        }
    })

// Flujo Exit
const flowExit = addKeyword(['adios', 'bye', 'chau'])
    .addAnswer('👋 ¡Gracias por comunicarte con nosotros! Que tengas un excelente día.')
    .addAction(async (ctx, { endFlow }) => {
        return endFlow()
    })

// Flujo Calendario
const flowCalendario = addKeyword(utils.setEvent('CALENDARIO_FLOW'))
    .addAnswer([
        'Este es nuestro nuevo calendario académico para el 2025-II, puede visitar nuestra página web:',
        'https://posgrado.unac.edu.pe/admision/cronograma-academico-2025-i.html'
    ])

// ============= FLUJOS DE DOCTORADOS =============

const flowNuevoDoctorado = addKeyword(utils.setEvent('NUEVO_DOCTORADO'))
    .addAnswer(
        ['¿Necesita consultar otro doctorado?, digite el número de la acción a realizar', '1️⃣ *SI* 📜', '2️⃣ *NO*'],
        { capture: true },
        async (ctx, { flowDynamic, gotoFlow }) => {
            const entrada = quitarAcentos(ctx.body.trim().toLowerCase())

            if (RESP_SI.has(entrada)) {
                return gotoFlow(flowFacultadDoctorados)
            }
            if (RESP_NO.has(entrada)) {
                return gotoFlow(flowExit)
            }

            await flowDynamic('❌ Respuesta no válida, selecciona una de las opciones.')
            return gotoFlow(flowNuevoDoctorado)
        }
    )

const flowSeleccionDoctorado = addKeyword(utils.setEvent('SELECCION_DOCTORADO'))
    .addAnswer('📩 Seleccione un Doctorado:', { capture: true },
        async (ctx, { flowDynamic, gotoFlow }) => {
            const usuarioId = ctx.from
            const input = ctx.body.trim()

            try {
                const currentState = await obtenerEstado(usuarioId)
                const facultadId = currentState?.facultadId

                if (!facultadId || !facultades[facultadId]) {
                    await flowDynamic('❌ Error: Información de facultad perdida. Regresando al menú.')
                    return gotoFlow(flowFacultadDoctorados)
                }

                if (input === '0') {
                    await borrarEstado(usuarioId)
                    return gotoFlow(flowFacultadDoctorados)
                }

                const facultad = facultades[facultadId]
                const doctoradoKeys = Object.keys(facultad.doctorados || {})
                const selectedIndex = parseInt(input) - 1

                if (selectedIndex < 0 || selectedIndex >= doctoradoKeys.length) {
                    await flowDynamic('❌ Opción inválida. Intente de nuevo.')
                    return gotoFlow(flowSeleccionDoctorado)
                }

                const selectedKey = doctoradoKeys[selectedIndex]
                const doctorado = facultad.doctorados[selectedKey]

                const descripcion = typeof doctorado.descripcion === 'function'
                    ? doctorado.descripcion()
                    : doctorado.descripcion

                await flowDynamic([
                    `🎓 *${doctorado.nombre || 'Doctorado'}*`,
                    descripcion || 'Descripción no disponible',
                    infoplus || ''
                ])

                if (doctorado.brochure) {
                    await enviarMediaSeguro(flowDynamic, '📄 Aquí tienes el brochure:', doctorado.brochure)
                } else {
                    await flowDynamic('📄 Brochure no disponible para este doctorado.')
                }

                await borrarEstado(usuarioId)
                return gotoFlow(flowNuevoDoctorado)

            } catch (error) {
                console.error('❌ Error en flowSeleccionDoctorado:', error)
                await flowDynamic('❌ Ocurrió un error. Regresando al menú de facultades.')
                await borrarEstado(usuarioId)
                return gotoFlow(flowFacultadDoctorados)
            }
        })

const flowFacultadDoctorados = addKeyword(utils.setEvent('FACULTAD_DOCTORADOS'))
    .addAnswer('*DOCTORADOS DE LA UNIVERSIDAD NACIONAL DEL CALLAO*')
    .addAnswer('Estas son nuestras facultades:', {
        media: 'https://posgrado.unac.edu.pe/img/escuela.jpg'
    })
    .addAnswer([
        '1️⃣ Facultad de Ciencias de la Salud',
        '2️⃣ Facultad de Ciencias Administrativas',
        '3️⃣ Facultad de Ingeniería Industrial y de Sistemas',
        '4️⃣ Facultad de Ciencias Contables',
        '5️⃣ Facultad de Ingeniería Eléctrica y Electrónica',
        '6️⃣ Facultad de Ciencias de la Educación',
        '0️⃣ Volver al menú principal'
    ], { capture: true }, async (ctx, { gotoFlow, flowDynamic }) => {
        let facultadId = ctx.body.trim()
        const usuarioId = ctx.from

        if (!['1', '2', '3', '4', '5', '6', '0'].includes(facultadId)) {
            await flowDynamic('❌ Opción inválida. Intente de nuevo.')
            return gotoFlow(flowFacultadDoctorados)
        }

        if (facultadId === '6') {
            facultadId = '12'
        }

        if (facultadId === '0') {
            return gotoFlow(programasFlow)
        }

        const facultad = facultades[facultadId]
        if (!facultad || !facultad.doctorados) {
            await flowDynamic('❌ Facultad no encontrada o sin doctorados.')
            return gotoFlow(flowFacultadDoctorados)
        }

        try {
            await guardarEstado(usuarioId, { facultadId })

            const doctoradoEntries = Object.entries(facultad.doctorados)
            const opciones = doctoradoEntries
                .map(([doctoradoId, doctorado], index) =>
                    `${index + 1}️⃣ ${doctorado.nombre || 'Doctorado ' + doctoradoId}`
                )
                .join('\n')

            await flowDynamic([
                `📚 *${facultad.nombre}*`,
                'Seleccione un doctorado para ver más detalles:',
                opciones,
                '0️⃣ Volver al listado de facultades'
            ])

            return gotoFlow(flowSeleccionDoctorado)
        } catch (error) {
            console.error('❌ Error al guardar estado:', error)
            await flowDynamic('❌ Error interno. Intente de nuevo más tarde.')
            return gotoFlow(flowFacultadDoctorados)
        }
    })

// ============= FLUJOS DE MAESTRÍAS =============

const flowNuevaMaestria = addKeyword(utils.setEvent('NUEVA_MAESTRIA'))
    .addAnswer(
        ['¿Necesita consultar otra maestría?, digite el número la acción a realizar', '1️⃣ *SI* 📜', '2️⃣ *NO*'],
        { capture: true },
        async (ctx, { flowDynamic, gotoFlow }) => {
            if (!['1', '2'].includes(ctx.body)) {
                await flowDynamic('❌ Respuesta no válida, selecciona una de las opciones.')
                return gotoFlow(flowNuevaMaestria)
            }
            switch (ctx.body) {
                case '1':
                    return gotoFlow(flowFacultadMaestrias)
                case '2':
                    return gotoFlow(flowExit)
            }
        }
    )

const flowSeleccionMaestria = addKeyword(utils.setEvent('SELECCION_MAESTRIA'))
    .addAnswer('📩 Seleccione una maestría:', { capture: true },
        async (ctx, { flowDynamic, gotoFlow }) => {
            const usuarioId = ctx.from
            const input = ctx.body.trim()

            try {
                const currentState = await obtenerEstado(usuarioId)
                const facultadId = currentState?.facultadId

                if (!facultadId || !facultades[facultadId]) {
                    await flowDynamic('❌ Error: Información de facultad perdida. Regresando al menú.')
                    return gotoFlow(flowFacultadMaestrias)
                }

                if (input === '0') {
                    await borrarEstado(usuarioId)
                    return gotoFlow(flowFacultadMaestrias)
                }

                const facultad = facultades[facultadId]
                const maestriaKeys = Object.keys(facultad.maestrias)
                const selectedIndex = parseInt(input) - 1

                if (selectedIndex < 0 || selectedIndex >= maestriaKeys.length) {
                    await flowDynamic('❌ Opción inválida. Intente de nuevo.')
                    return gotoFlow(flowSeleccionMaestria)
                }

                const selectedKey = maestriaKeys[selectedIndex]
                const maestria = facultad.maestrias[selectedKey]

                const descripcion = typeof maestria.descripcion === 'function'
                    ? maestria.descripcion()
                    : maestria.descripcion

                await flowDynamic([
                    `🎓 *${maestria.nombre || 'Maestría'}*`,
                    descripcion || 'Descripción no disponible',
                    infoplus || ''
                ])

                if (maestria.brochure) {
                    await enviarMediaSeguro(flowDynamic, '📄 Aquí tienes el brochure:', maestria.brochure)
                } else {
                    await flowDynamic('📄 Brochure no disponible para esta maestría.')
                }

                await borrarEstado(usuarioId)
                return gotoFlow(flowNuevaMaestria)

            } catch (error) {
                console.error('❌ Error en flowSeleccionMaestria:', error)
                await flowDynamic('❌ Ocurrió un error. Regresando al menú de facultades.')
                await borrarEstado(usuarioId)
                return gotoFlow(flowFacultadMaestrias)
            }
        })

const flowFacultadMaestrias = addKeyword(utils.setEvent('FACULTAD_MAESTRIAS'))
    .addAnswer('*MAESTRÍAS DE LA UNIVERSIDAD NACIONAL DEL CALLAO*')
    .addAnswer('Estas son nuestras facultades:', {
        media: 'https://posgrado.unac.edu.pe/img/escuela.jpg'
    })
    .addAnswer([
        '1️⃣ Facultad de Ciencias de la Salud',
        '2️⃣ Facultad de Ciencias Administrativas',
        '3️⃣ Facultad de Ingeniería Industrial y de Sistemas',
        '4️⃣ Facultad de Ciencias Contables',
        '5️⃣ Facultad de Ingeniería Eléctrica y Electrónica',
        '6️⃣ Facultad de Ingeniería Pesquera y de Alimentos',
        '7️⃣ Facultad de Ingeniería Mecánica y Energía',
        '8️⃣ Facultad de Ciencias Naturales y Matemática',
        '9️⃣ Facultad de Ingeniería Ambiental y Recursos Naturales',
        '🔟 Facultad de Ciencias Económicas',
        '1️⃣1️⃣ Facultad de Ingeniería Química',
        '1️2️⃣ Facultad de Ciencias de la Educación',
        '0️⃣ Volver al menú principal'
    ], { capture: true }, async (ctx, { gotoFlow, flowDynamic }) => {
        const facultadId = ctx.body.trim()
        const usuarioId = ctx.from

        if (!['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '0'].includes(facultadId)) {
            await flowDynamic('❌ Opción inválida. Intente de nuevo.')
            return gotoFlow(flowFacultadMaestrias)
        }

        if (facultadId === '0') {
            return gotoFlow(programasFlow)
        }

        const facultad = facultades[facultadId]
        if (!facultad) {
            await flowDynamic('❌ Facultad no encontrada.')
            return gotoFlow(flowFacultadMaestrias)
        }

        try {
            await guardarEstado(usuarioId, { facultadId })

            const maestriaEntries = Object.entries(facultad.maestrias)
            const opciones = maestriaEntries
                .map(([maestriaId, maestria], index) =>
                    `${index + 1}️⃣ ${maestria.nombre || 'Maestría ' + maestriaId}`
                )
                .join('\n')

            await flowDynamic([
                `📚 *${facultad.nombre}*`,
                'Seleccione una maestría para ver más detalles:',
                opciones,
                '0️⃣ Volver al listado de facultades'
            ])

            return gotoFlow(flowSeleccionMaestria)
        } catch (error) {
            console.error('❌ Error al guardar estado:', error)
            await flowDynamic('❌ Error interno. Intente de nuevo más tarde.')
            return gotoFlow(flowFacultadMaestrias)
        }
    })

// Flujo Programas
const programasFlow = addKeyword(utils.setEvent('PROGRAMAS_FLOW'))
    .addAnswer(
        [programas || '📚 *PROGRAMAS DE POSGRADO*\n1️⃣ Maestrías\n2️⃣ Doctorados\n0️⃣ Volver al menú'],
        { capture: true },
        async (ctx, { flowDynamic, gotoFlow }) => {
            if (!['1', '2', '0'].includes(ctx.body)) {
                await flowDynamic('❌ Respuesta no válida, selecciona una de las opciones.')
                return gotoFlow(programasFlow)
            }
            switch (ctx.body) {
                case '1':
                    return gotoFlow(flowFacultadMaestrias)
                case '2':
                    return gotoFlow(flowFacultadDoctorados)
                case '0':
                    return gotoFlow(menuFlow)
            }
        }
    )

// ============= FLUJOS DE ADMISIÓN =============

const flowRequisitos = addKeyword(utils.setEvent('REQUISITOS_FLOW'))
    .addAnswer([requisitos || 'Requisitos no disponibles.'])
    .addAction(async (ctx, { gotoFlow }) => {
        return gotoFlow(masinfoadmision)
    })

const flowCostos = addKeyword(utils.setEvent('COSTOS_FLOW'))
    .addAnswer([costos || 'Costos no disponibles.'])
    .addAction(async (ctx, { gotoFlow }) => {
        return gotoFlow(masinfoadmision)
    })

const flowFechasAdmision = addKeyword(utils.setEvent('FECHAS_ADMISION_FLOW'))
    .addAnswer('Estas son nuestras fechas', {
        media: 'https://github.com/JeysonRG1804/brochure/raw/main/fechasadmision.png'
    })
    .addAction(async (ctx, { gotoFlow }) => {
        return gotoFlow(masinfoadmision)
    })

const flowGuia = addKeyword(utils.setEvent('GUIA_FLOW'))
    .addAnswer('Encuentra toda la información necesaria para postular con éxito:\n ✔️ Requisitos generales y específicos\n ✔️ Cronograma del proceso de admisión\n ✔️ Procedimiento de inscripción paso a paso\n✔️ Contactos y enlaces útiles')
    .addAnswer('Este es nuestra guía de admisión:',
        { media: 'https://posgrado.unac.edu.pe/CHATBOT/Guia_de_Postulante.pdf' },
    )
    .addAction(async (ctx, { gotoFlow }) => {
        return gotoFlow(masinfoadmision)
    })

const masinfoadmision = addKeyword(utils.setEvent('MAS_INFO_ADMISION'))
    .addAnswer(
        ['¿Necesitas mayor información sobre admisión?, digite el número la acción a realizar', '1️⃣ *SI* 📜', '2️⃣ *NO*'],
        { capture: true },
        async (ctx, { flowDynamic, gotoFlow }) => {
            if (!['1', '2'].includes(ctx.body)) {
                await flowDynamic('❌ Respuesta no válida, selecciona una de las opciones.')
                return gotoFlow(masinfoadmision)
            }
            switch (ctx.body) {
                case '1':
                    return gotoFlow(flowAdmision)
                case '2':
                    return gotoFlow(flowExit)
            }
        }
    )

const flowAdmision = addKeyword(utils.setEvent('ADMISION_FLOW'))
    .addAnswer(
        [admision || '📝 *ADMISIÓN*\n1️⃣ Requisitos\n2️⃣ Fechas\n3️⃣ Guía del Postulante\n4️⃣ Costos\n0️⃣ Volver al menú'],
        { capture: true },
        async (ctx, { flowDynamic, gotoFlow }) => {
            if (!['1', '2', '3', '4', '0'].includes(ctx.body)) {
                await flowDynamic('❌ Respuesta no válida, selecciona una de las opciones.')
                return gotoFlow(flowAdmision)
            }
            switch (ctx.body) {
                case '1':
                    return gotoFlow(flowRequisitos)
                case '2':
                    return gotoFlow(flowFechasAdmision)
                case '3':
                    return gotoFlow(flowGuia)
                case '4':
                    return gotoFlow(flowCostos)
                case '0':
                    return gotoFlow(menuFlow)
            }
        }
    )

// Flujo de Taller de Tesis
const flowTallerTesis = addKeyword(utils.setEvent('TALLER_TESIS_FLOW'))
    .addAnswer('*¡Bienvenido al Taller de Tesis!*')
    .addAnswer('Aquí encontrarás recursos y apoyo para tu proyecto de tesis, desde la formulación de la propuesta hasta la defensa final.')
    .addAnswer('Si tienes de 5 a más años de egresado, puedes participar en nuestro Taller de Tesis para mejorar tu proyecto y recibir orientación personalizada.',
        { media: 'https://github.com/JeysonRG1804/brochure/raw/main/tallertesis.png' },
    )
    .addAction(async (ctx, { gotoFlow }) => {
        return gotoFlow(masinfoadmision)
    })

// Flujo Menú Principal
const menuFlow = addKeyword(utils.setEvent('MENU_FLOW'))
    .addAnswer(
        [menu || '📋 *MENÚ PRINCIPAL*\n1️⃣ Programas de Posgrado\n2️⃣ Admisión\n3️⃣ Calendario Académico\n4️⃣ Taller de Tesis\n5️⃣ Contacto'],
        { capture: true },
        async (ctx, { flowDynamic, gotoFlow }) => {
            if (!['1', '2', '3', '4', '5'].includes(ctx.body)) {
                await flowDynamic('❌ Respuesta no válida, selecciona una de las opciones.')
                return gotoFlow(menuFlow)
            }
            switch (ctx.body) {
                case '1':
                    return gotoFlow(programasFlow)
                case '2':
                    return gotoFlow(flowAdmision)
                case '3':
                    return gotoFlow(flowCalendario)
                case '4':
                    return gotoFlow(flowTallerTesis)
                case '5':
                    return gotoFlow(flowContacto)
            }
        }
    )

// Flujo Principal (Bienvenida) - Solo EVENTS.WELCOME
const flowPrincipal = addKeyword(EVENTS.WELCOME)
    .addAction(async (ctx) => {
        console.log('=== DEBUG: Mensaje recibido ===')
        console.log('De:', ctx.from)
        console.log('Mensaje:', ctx.body)
        console.log('Nombre:', ctx.pushName)
        console.log('Timestamp:', new Date().toISOString())
        console.log('================================')
    })
    .addAnswer([
        '🌟 *BIENVENIDO A LA ESCUELA DE POSGRADO DE LA UNIVERSIDAD NACIONAL DEL CALLAO* 🌟',
        'Aquí, la excelencia académica se combina con el compromiso y la vocación de servicio, formando líderes que impactan en la sociedad.',
        '*Una universidad con un rostro humano*, donde cada estudiante es parte de una comunidad que inspira, acompaña y fortalece.',
        '¡Es momento de crecer juntos!'
    ])
    .addAnswer('BIENVENIDOS', {
        media: 'https://github.com/JeysonRG1804/brochure/raw/main/entrada.png'
    })
    .addAction(async (ctx, { gotoFlow }) => {
        return gotoFlow(menuFlow)
    })

// ============= INICIALIZACIÓN DEL BOT =============

const main = async () => {
    const adapterFlow = createFlow([
        flowPrincipal,
        menuFlow,
        programasFlow,
        flowFacultadMaestrias,
        flowSeleccionMaestria,
        flowNuevaMaestria,
        flowFacultadDoctorados,
        flowSeleccionDoctorado,
        flowNuevoDoctorado,
        flowAdmision,
        flowRequisitos,
        flowCostos,
        flowFechasAdmision,
        flowGuia,
        masinfoadmision,
        flowTallerTesis,
        flowContacto,
        flowCalendario,
        flowExit
    ])

    const adapterProvider = createProvider(Provider)
    const adapterDB = new Database()

    const { handleCtx, httpServer } = await createBot({
        flow: adapterFlow,
        provider: adapterProvider,
        database: adapterDB,
    })

    // Portal web para escanear QR
    QRPortalWeb({ port: 3001 })

    // ============= MIDDLEWARE CORS =============
    // Permitir peticiones desde cualquier origen (para pruebas)
    adapterProvider.server.use((req, res, next) => {
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

        // Manejar preflight requests
        if (req.method === 'OPTIONS') {
            res.writeHead(204)
            return res.end()
        }
        next()
    })

    // ============= ENDPOINTS API =============

    // Enviar mensaje
    adapterProvider.server.post(
        '/v1/messages',
        handleCtx(async (bot, req, res) => {
            const { number, message, urlMedia } = req.body
            await bot.sendMessage(number, message, { media: urlMedia ?? null })
            return res.end('sended')
        })
    )

    // Disparar flujo de registro personalizado
    adapterProvider.server.post(
        '/v1/register',
        handleCtx(async (bot, req, res) => {
            const { number, name } = req.body
            await bot.dispatch('CONTACTO_FLOW', { from: number, name })
            return res.end('trigger')
        })
    )

    // Disparar flujo de programas
    adapterProvider.server.post(
        '/v1/programas',
        handleCtx(async (bot, req, res) => {
            const { number } = req.body
            await bot.dispatch('PROGRAMAS_FLOW', { from: number })
            return res.end('trigger')
        })
    )

    // Blacklist - Agregar/Quitar
    adapterProvider.server.post(
        '/v1/blacklist',
        handleCtx(async (bot, req, res) => {
            const { number, intent } = req.body
            if (intent === 'remove') bot.blacklist.remove(number)
            if (intent === 'add') bot.blacklist.add(number)

            res.writeHead(200, { 'Content-Type': 'application/json' })
            return res.end(JSON.stringify({ status: 'ok', number, intent }))
        })
    )

    // Blacklist - Listar
    adapterProvider.server.get(
        '/v1/blacklist/list',
        handleCtx(async (bot, req, res) => {
            const blacklist = bot.blacklist.getList()
            res.writeHead(200, { 'Content-Type': 'application/json' })
            return res.end(JSON.stringify({ status: 'ok', blacklist }))
        })
    )

    // Enviar mensaje con brochure
    adapterProvider.server.post(
        '/v1/enviar-mensaje',
        handleCtx(async (bot, req, res) => {
            const { numero, mensaje, facultad, programa } = req.body || {}

            if (!numero || !mensaje || !facultad || !programa) {
                res.writeHead(400, { 'Content-Type': 'application/json' })
                return res.end(JSON.stringify({ error: 'Faltan datos' }))
            }

            try {
                // Texto inicial
                const texto = `👋 Felicidades ${mensaje}\n*Somos de la Escuela de Posgrado de la UNAC*\n🚀 Ya se encuentra registrado para nuestros programas de Posgrado!`
                await bot.sendMessage(numero, texto, {})

                // Determinar precio y duración
                let precio = ''
                let duracion = ''
                let cuenta = ''
                let cci = ''
                let enlace = 'https://chat.whatsapp.com/IKNzlJiO6El6Ns8k4bixjF'
                const p = programa.toLowerCase()

                if (p.includes('maestría') || p.includes('maestria')) {
                    precio = 'S/ 200'
                    duracion = '3 semestres académicos'
                    cuenta = '000-3747336'
                    cci = '009-100-000003747336-90'
                } else if (p.includes('doctorado')) {
                    precio = 'S/ 250'
                    duracion = '6 semestres académicos'
                    cuenta = '000-3747336'
                    cci = '009-100-000003747336-90'
                } else if (p.includes('especialidad')) {
                    precio = 'S/ 120'
                    duracion = '2 semestres académicos'
                    cuenta = '000-1797042'
                    cci = '009-100-000001797042-97'
                }

                const texto2 = `💥 ¡Quiero contarte sobre nuestro programa de posgrado y los increíbles beneficios que puedes obtener! 🎓

📌 Costo de Inscripción:
Por solo ${precio} recibirás:
📂 Carpeta de Postulante
📝 Derecho de Inscripción

🏦 Medios de Pago:
CCI: ${cci}
N° Cta. Cte.: ${cuenta} (Scotiabank)

📅 Fechas importantes:
🖋 Inscripciones: Hasta el 18 de marzo del 2026
📹 Entrevista virtual: última semana de Marzo del 2026
📃 Resultados: 1-2 días después del examen
🎒 Inicio de clases: Primera semana de Abril

⏳ Duración del programa: ${duracion}
💵 Costo por semestre: ~S/ 2500~ *S/ 2100*

📲 Contáctanos ahora:
📩 posgrado.admision@unac.edu.pe
📞 900969591`

                await bot.sendMessage(numero, texto2, {})

                // Función para normalizar texto (quitar acentos, caracteres especiales y espacios extra)
                const normalizarTexto = (txt) => {
                    if (!txt) return ''
                    // Primero quitar acentos usando NFD
                    let normalizado = txt.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                    // Reemplazar caracteres corruptos comunes (encoding issues)
                    normalizado = normalizado.replace(/[�]/g, '')
                    // Convertir a minúsculas
                    normalizado = normalizado.toLowerCase()
                    // Reemplazar múltiples espacios por uno solo
                    normalizado = normalizado.replace(/\s+/g, ' ').trim()
                    return normalizado
                }

                // Función para extraer palabras clave de un texto
                const extraerPalabrasClave = (txt) => {
                    const normalizado = normalizarTexto(txt)
                    // Palabras a ignorar
                    const stopWords = ['en', 'de', 'del', 'la', 'el', 'con', 'y', 'para', 'los', 'las', 'por', 'mencion', 'mención']
                    return normalizado.split(' ').filter(p => p.length > 2 && !stopWords.includes(p))
                }

                // Cargar programas.json para obtener el brochure específico del programa
                let brochurePrograma = null
                const programaNormalizado = normalizarTexto(programa)
                const palabrasClaveBusqueda = extraerPalabrasClave(programa)
                console.log(`🔍 Buscando programa: "${programa}"`)
                console.log(`🔍 Programa normalizado: "${programaNormalizado}"`)
                console.log(`🔍 Palabras clave: [${palabrasClaveBusqueda.join(', ')}]`)

                try {
                    const programasPath = join(__dirname, 'programas.json')

                    if (existsSync(programasPath)) {
                        const programasData = JSON.parse(readFileSync(programasPath, 'utf-8'))

                        // Buscar el programa en todas las facultades
                        if (programasData.facultades) {
                            let totalProgramasRevisados = 0
                            let mejorCoincidencia = null
                            let mejorPuntaje = 0

                            for (const codigoFacultad of Object.keys(programasData.facultades)) {
                                const fac = programasData.facultades[codigoFacultad]

                                if (fac.programas && Array.isArray(fac.programas)) {
                                    for (const prog of fac.programas) {
                                        totalProgramasRevisados++
                                        if (!prog.nombre) continue

                                        const nombreNormalizado = normalizarTexto(prog.nombre)
                                        const palabrasClavePrograma = extraerPalabrasClave(prog.nombre)

                                        // Verificar coincidencia exacta primero
                                        if (nombreNormalizado === programaNormalizado) {
                                            if (prog.brochure && prog.brochure.length > 0) {
                                                brochurePrograma = prog.brochure
                                                console.log(`✅ ¡Coincidencia exacta! Programa: "${prog.nombre}"`)
                                                console.log(`✅ Facultad: ${fac.nombre}`)
                                                console.log(`✅ Brochure: ${brochurePrograma}`)
                                                break
                                            }
                                        }

                                        // Búsqueda por palabras clave
                                        let puntaje = 0
                                        for (const palabra of palabrasClaveBusqueda) {
                                            if (palabrasClavePrograma.some(p => p.includes(palabra) || palabra.includes(p))) {
                                                puntaje++
                                            }
                                        }

                                        // Si encuentra suficientes palabras clave (al menos 2 o el 50%)
                                        const umbral = Math.max(2, Math.floor(palabrasClaveBusqueda.length * 0.5))
                                        if (puntaje >= umbral && puntaje > mejorPuntaje && prog.brochure && prog.brochure.length > 0) {
                                            mejorPuntaje = puntaje
                                            mejorCoincidencia = { prog, fac }
                                        }
                                    }

                                    if (brochurePrograma) break
                                }
                            }

                            // Si no hubo coincidencia exacta, usar la mejor por palabras clave
                            if (!brochurePrograma && mejorCoincidencia) {
                                brochurePrograma = mejorCoincidencia.prog.brochure
                                console.log(`✅ ¡Encontrado por palabras clave! Programa: "${mejorCoincidencia.prog.nombre}"`)
                                console.log(`✅ Facultad: ${mejorCoincidencia.fac.nombre}`)
                                console.log(`✅ Puntaje: ${mejorPuntaje}/${palabrasClaveBusqueda.length}`)
                                console.log(`✅ Brochure: ${brochurePrograma}`)
                            }

                            console.log(`📊 Total programas revisados: ${totalProgramasRevisados}`)
                        }

                        if (!brochurePrograma) {
                            console.log(`❌ No se encontró brochure para: "${programa}"`)
                        }
                    } else {
                        console.error('❌ Archivo programas.json no existe')
                    }
                } catch (jsonError) {
                    console.error('⚠️ Error al leer programas.json:', jsonError.message)
                }

                // Brochures de fallback por facultad (si no se encuentra el programa específico)
                const brochuresFacultad = {
                    'Facultad de Ciencias de la Salud': 'https://github.com/JeysonRG1804/brochure/raw/main/brochure%20fcs_compressed.pdf',
                    'Facultad en Ciencias Económicas': 'https://github.com/JeysonRG1804/brochure/raw/main/brochure%20fce_compressed.pdf',
                    'Facultad de Ciencias Económicas': 'https://github.com/JeysonRG1804/brochure/raw/main/brochure%20fce_compressed.pdf',
                    'Facultad de Ingeniería Industrial y de Sistemas': 'https://github.com/JeysonRG1804/brochure/raw/main/brochure%20fiis_compressed.pdf',
                    'Facultad de Ingeniería Química': 'https://github.com/JeysonRG1804/brochure/raw/main/brochure%20fiq_compressed.pdf',
                    'Facultad de Ingeniería Eléctrica y Electrónica': 'https://github.com/JeysonRG1804/brochure/raw/main/brochure%20fiee_compressed.pdf',
                    'Facultad de Ingeniería Pesquera y de Alimentos': 'https://github.com/JeysonRG1804/brochure/raw/main/brochure%20fipa_compressed.pdf',
                    'Facultad de Ingeniería Mecánica y Energía': 'https://github.com/JeysonRG1804/brochure/raw/main/brochure%20fime_compressed.pdf',
                    'Facultad de Ciencias Contables': 'https://github.com/JeysonRG1804/brochure/raw/main/brochure%20fcc_compressed.pdf',
                    'Facultad de Ciencias Administrativas': 'https://github.com/JeysonRG1804/brochure/raw/main/brochure%20fca_compressed.pdf',
                    'Facultad de Ingeniería Ambiental y de Recursos Naturales': 'https://github.com/JeysonRG1804/brochure/raw/main/brochure%20fiarn_compressed.pdf',
                    'Facultad de Ciencias Naturales y Matemática': 'https://github.com/JeysonRG1804/brochure/raw/main/brochure%20fcnm_compressed.pdf',
                    'Facultad de Ciencias de la Educación': 'https://github.com/JeysonRG1804/brochure/raw/main/brochure%20fced_compressed.pdf'
                }

                // Enviar el brochure del programa específico (prioridad) o el de facultad (fallback)
                const pdfUrl = brochurePrograma || brochuresFacultad[facultad]
                if (pdfUrl) {
                    const mensajeBrochure = brochurePrograma
                        ? `📄 Aquí está el brochure de *${programa}*:`
                        : '📄 Aquí está el brochure de su facultad:'
                    await bot.sendMessage(numero, mensajeBrochure, { media: pdfUrl })
                } else {
                    console.warn(`⚠️ No se encontró brochure para programa "${programa}" ni facultad "${facultad}"`)
                }

                // Último mensaje
                const text4 = `📌 Estoy disponible para resolver cualquier duda y acompañarte en tu proceso de inscripción.
O puedes unirte al grupo de WhatsApp POSGRADO UNAC 2026-A:
${enlace}

📩 Correo: posgrado.admision@unac.edu.pe
📞 WhatsApp: 900969591

🚀 ¡Escríbeme ahora y asegura tu cupo en la maestría!`

                await bot.sendMessage(numero, text4, {})

                res.writeHead(200, { 'Content-Type': 'application/json' })
                return res.end(JSON.stringify({
                    status: 'Mensaje y PDF enviados',
                    brochureEnviado: pdfUrl ? (brochurePrograma ? 'programa' : 'facultad') : 'ninguno'
                }))

            } catch (err) {
                console.error('❌ Error enviando mensaje:', err)
                res.writeHead(500, { 'Content-Type': 'application/json' })
                return res.end(JSON.stringify({ error: 'Error interno al enviar mensaje' }))
            }
        })
    )

    httpServer(+PORT)
    console.log(`🚀 Bot iniciado en el puerto ${PORT}`)
}

console.log('⏳ Iniciando bot...')
main().catch((err) => {
    console.error('❌ Error en main():', err)
})
