const ShairportReader = require('shairport-sync-reader')
const compression = require('compression') // to use gzip compression
const cquant = require('cquant') // use sharp to convert image to RGB Buffer Array
const sharp = require('sharp')
const Color = require('color')
const glob = require('glob')
const express = require('express')

const app = express()
const port = 3600
app.use(compression())
app.use(express.static('public'))
app.disable('x-powered-by') // masquer express dans les headers

const http = require('http').Server(app)
const io = require('socket.io')(http, {
    pingTimeout: 60000
})
// pingTimeout pour corriger un bug de Chrome : https://github.com/socketio/socket.io/issues/3259

const fs = require('fs')

const Track = require('./Track.js')
let track = new Track()
let currentAlbum
let prevAlbum
let buf
let bgImg

http.listen(port, () => {
    console.log('listening on :' + port)
})

// Routes ----------------------
app.get('/', function (req, res) {
    res.sendFile(__dirname + 'public/index.html')
})

// Route not found (404)
app.use(function(req, res, next) {
    return res.status(404).sendFile(__dirname + '/public/404.html')
})

// 500 - Any server error
app.use(function(err, req, res, next) {
    return res.status(500).send({ error: err })
})

// SocketIO
io.on('connection', function (socket) {
    console.log('an user connected')
    socket.emit('message', 'Bienvenue, nouveau connecté')
    if (track.title !== '') {
        // pour n'envoyer les infos qu'au nouveau connecté
        updateTrack('trackInfos', socket)
        if (track.artwork.isPresent) {
            updateTrack('PICT', socket)
            updateTrack('PICTmeta', socket)
            updateTrack('bgImg', socket)
        }
    } else {
        socket.emit('message', 'noInfo')
    }

    socket.on('requestPICT', () => {
        if (track.artwork.isPresent) {
            updateTrack('PICT', socket)
            updateTrack('PICTmeta', socket)
        } else {
            socket.emit('noPICT')
        }
    })

    socket.on('disconnect', () => {
        console.log('user disconnected')
    })
})

// read from pipe
let pipeReader = new ShairportReader({
    path: '/tmp/shairport-sync-metadata'
})
pipeReader
    .on('meta', function (meta) {
        console.log('ev: meta') //, meta)
        if (currentAlbum !== undefined) {
            if (currentAlbum !== prevAlbum) bgImg = undefined
            prevAlbum = currentAlbum
        }
        currentAlbum = meta.asai // `asai` : album ID (DAAP code)
        console.log('albumID:', currentAlbum)
        track = new Track()
        console.log('yearAlbum:', track.yearAlbum)
        track.artist = meta.asar
        track.title = meta.minm
        track.album = meta.asal
        track.yearAlbum = meta.asyr
        if (meta.astm !== undefined) {
            track.duration = meta.astm
        }
        updateTrack('trackInfos')
    })
    .on('pvol', function (pvol) {
        console.log('ev: pvol')
        // volume entre 0 (muet) et 100 (à fond)
        track.volume = map(pvol.volume, pvol.lowest, pvol.highest, 0, 100)
        updateTrack('volume')
    })
    .on('prgr', function (prgr) {
        console.log('ev: prgr') //, prgr)
        if (track.duration === 0) {
            track.duration = totalLength(prgr)
        }
        track.currPosition = elapsed(prgr)
        updateTrack('position')
    })
    // .on('client', function (data) {
    //     // infos sur le client qui envoie les infos (iTunes, iPod, etc.)
    //     console.log('ev: client', data)
    // })
    .on('pfls', function (pfls) {
        console.log('ev: pfls')
        // Pause/Stop : envoie un  message pour vider l'affichage
        io.emit('pause')
    })
    .on('pend', function () {
        console.log('ev: pend')
        // fin du stream
        track = new Track()
        io.emit('stop')
    })
    .on('PICT', function (PICT) {
        console.log('ev: PICT')
        buf = Buffer.from(PICT, 'base64')
        track.artwork.isPresent = true

        let image = sharp(buf)
        processPICT(image)
    })

function updateTrack(what, socket) {
    let data, src
    switch (what) {
        case 'trackInfos':
            data = {
                'artist': track.artist,
                'title': track.title,
                'album': track.album,
                'yearAlbum': track.yearAlbum,
                'duration': track.duration
            }
            break
        case 'PICT':
            src = 'data:image/' + track.artwork.format + ';base64,' + buf.toString('base64')
            data = {
                'src': src
            }
            break
        case 'bgImg':
            src = 'data:image/jpeg;base64,' + bgImg.toString('base64')
            data = {
                'src': src
            }
            break
        case 'PICTmeta':
            data = {
                'dimensions': {
                    'width': track.artwork.dimensions.width,
                    'height': track.artwork.dimensions.height
                },
                'palette': {
                    'backgroundColor': track.artwork.palette.backgroundColor,
                    'color': track.artwork.palette.color,
                    'alternativeColor': track.artwork.palette.alternativeColor,
                    'spanColorContrast': track.artwork.palette.spanColorContrast
                }
            }
            break
        case 'position':
            data = {
                'currPosition': track.currPosition,
                'duration': track.duration
            }
            break
        case 'volume':
            data = {
                'volume': track.volume
            }
            break
        default:
            // envoie l'obj track en entier
            data = track
            break
    }
    if (socket) {
        socket.emit(what, data)
    } else {
        io.emit(what, data)
    }
}

async function processPICT(image) {
    try {
        // 1) Metadata
        const metadata = await image.metadata()
        track.artwork.format = metadata.format
        track.artwork.dimensions.width = metadata.width
        track.artwork.dimensions.height = metadata.height
        // 2) Color palette
        const colorCount = 5
        let colors = []
        let luminances = []
        let ratios = []
        const imgBuf = await image.raw().toBuffer({ resolveWithObject: true })
        console.log('Début cquant')
        let responseCQuant = await cquant.paletteAsync(imgBuf.data, imgBuf.info.channels, colorCount)
        console.log('Fin cquant')
        responseCQuant.forEach(element => {
            colors.push(Color({
                r: element.R,
                g: element.G,
                b: element.B
            }))
            // calcul luminance de la couleur
            luminances.push(colorLuminance([element.R, element.G, element.B]))
        })
        for (let i = 1; i < colorCount; i++) {
            // calcul du contrast ratio entre la couleur i et la couleur dominante
            ratios.push({
                'idx': i,
                'ctr': calcContrastRatio(luminances[0], luminances[i])
            })
        }
        // Stocke la luminance de background color
        track.artwork.palette.backgroundLuminance = luminances[0]
        // la couleur de background est la couleur dominante
        track.artwork.palette.backgroundColor = colors[0].hsl().string()
        // la couleur du titre est la 2e dominante
        if (ratios[0].ctr >= 3) {
            track.artwork.palette.color = colors[1].hsl().string()
        } else {
            // corrige la couleur pour obtenir le bon contraste
            try {
                let arr = tuneColor(colors[1], ratios[0].ctr)
                let newCol = Color.hsl(arr)
                track.artwork.palette.color = newCol.hsl().string()
            } catch (error) {
                console.log(error)
            }
        }
        // Choix de la 3e couleur :
        ratios.shift()
        // nbre de couleurs restantes dont le CR est bon
        let s = ratios.filter(el => {
            return el.ctr >= 3
        })
        if (s.length === 1) {
            track.artwork.palette.alternativeColor = colors[s[0].idx].hsl().string()
        } else if (s.length >= 2) {
            let idx = Math.floor(Math.random() * s.length)
            track.artwork.palette.alternativeColor = colors[s[idx].idx].hsl().string()
        } else {
            // Pas de couleur idoine, on prend celle qui a le contrast ratio le + proche et on la corrige
            ratios.sort((a, b) => {
                return b.ctr - a.ctr
            })
            try {
                let c = colors[ratios[0].idx]
                let arr = tuneColor(c, ratios[0].ctr)
                let newCol = Color.hsl(arr)
                track.artwork.palette.alternativeColor = newCol.hsl().string()
            } catch (error) {
                console.log(error)
            }
        }
        // Année album
        if (track.yearAlbum !== '') {
            // contrast ratio white/bg color
            let cr = calcContrastRatio(1, luminances[0])
            console.log('cr:', cr)
            if (cr < 3) {
                track.artwork.palette.spanColorContrast = true
            }
        }
        updateTrack('PICT')
        updateTrack('PICTmeta')
        // 3) Background image
        if (currentAlbum !== prevAlbum || bgImg === undefined) {
            // supprime les fichiers temporaires
            glob('tmp_*', (err, files) => {
                if (err) console.log('glob:', err)
                files.forEach((f) => {
                    fs.unlink(f, (err) => {
                        if (err) throw err
                    })
                })
            })
            const f = 'tmp_' + myHash() + '.png'
            const thumbnail = await image.resize({
                    width: 100
                })
                .blur(1)
                .toFormat('png')
                .toFile(f)
            bgImg = await sharp(f).resize({
                    width: 1024,
                    kernel: sharp.kernel.cubic
                })
                .blur(32)
                .jpeg({
                    quality: 80
                })
                .toBuffer()
            updateTrack('bgImg')
        } else if (bgImg !== undefined) {
            updateTrack('bgImg')
        }
    } catch (err) {
        console.log('err:', err)
    }
}

/*
 *  Modifie la luminosité de myCol pour obtenir un contrast ratio >= 3 avec bgCol
 *  @param col   Obj         Objet color
 *  @param cr    Float       contrast ratio couleur/Bg
 * 
 *  Retourne un array [H, S, L]
 */
function tuneColor(col, cr) {
    const originalColor = copyObject(col) // crée un clone de l'objet
    const lumBg = track.artwork.palette.backgroundLuminance
    let direction = 'down' // par défaut on cherche une couleur plus sombre
    let increment = (3 - cr > 0.5) ? 10 : 1

    if (lumBg < 0.25) {
        // lumBg < 0.25 : la couleur de fond est sombre (0 = noir)
        let arr = getNewContrastRatio(col, direction, increment)
        let colorDown = Color.hsl(arr)
        // distance entre couleur d'origine et couleur trouvée : 
        let distanceDown = colorDistance(originalColor.color, colorDown.rgb().array())
        arr = getNewContrastRatio(col, 'up', increment)
        let colorUp = Color.hsl(arr)
        let distanceUp = colorDistance(originalColor.color, colorUp.rgb().array())
        if (distanceUp < distanceDown) {
            // on essaye d'éviter de mettre du noir (L = 0)
            if (colorUp.color[2] !== 0) {
                return colorUp.color
            } else {
                return colorDown.color
            }
        } else {
            if (colorDown.color[2] !== 0) {
                return colorDown.color
            } else {
                return colorUp.color
            }
        }
    } else {
        return getNewContrastRatio(col, direction, increment)
    }
}
/**
 * 
 * @param {*} col 
 * @param {*} direction 
 * @param {*} increment 
 * @param {*} overshoot 
 * 
 * Retourne un array [H, S, L]
 */
function getNewContrastRatio(col, direction, increment, overshoot = false) {
    let lumBg = track.artwork.palette.backgroundLuminance
    let oldCol = copyObject(col) // crée un clone de l'objet
    let colHSL = col.hsl().array()
    colHSL[2] = (direction === 'up') ? colHSL[2] + increment : colHSL[2] - increment
    let newCol = Color.hsl(colHSL)
    if (colHSL[2] <= 0) {
        // cas où L < 0 : on a du noir et si on va au-delà, ça provoque des erreurs
        // on arrête là (Color a déjà limité L à 0)
        return newCol.color
    }
    if (colHSL[2] > 100) {
        // cas où L > 100 : blanc
        return newCol.color
    }
    let newLumi = colorLuminance(newCol.rgb().array())
    let newCr = calcContrastRatio(lumBg, newLumi)
    if (newCr < 3 && !overshoot) {
        // la valeur n'est pas encore bonne, on continue
        increment = (3 - newCr > 0.5) ? 10 : 1
        return getNewContrastRatio(newCol, direction, increment)
    } else if (newCr < 3 && overshoot) {
        // la dernière valeur était la bonne
        return oldCol.color
    } else if (newCr >= 3 && overshoot) {
        return getNewContrastRatio(newCol, direction, increment, overshoot)
    } else {
        // newCr > 3 : on a dépassé l'objectif
        overshoot = true
        direction = (direction === 'up') ? 'down' : 'up'
        increment = 1
        return getNewContrastRatio(newCol, direction, increment, overshoot)
    }
}

/** 
 * distance euclidienne entre couleurs c1 et c2
 * @param c1    Array   [R, G, B]
 * @param c2    Array   [R, G, B]
 */
function colorDistance(c1, c2) {
    let r = (c1[0] + c2[0]) / 2
    return Math.sqrt((2 + r / 256) * (Math.pow(c2[0] - c1[0], 2)) + 4 * (Math.pow(c2[1] - c1[1], 2)) + (2 + (255 - r) / 256) * (Math.pow(c2[2] - c1[2], 2)))
}

/**
 * Calcul de la luminance selon la formule du W3CCalcul luminance d'une couleur
 * @param rgb   Array [R, G, B] 
 */
function colorLuminance(rgb) {
    let lumi = rgb.map(function (v) {
        v /= 255
        return (v < 0.03928) ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
    })
    return (lumi[0] * 0.2126) + (lumi[1] * 0.7152) + (lumi[2] * 0.0722)
}

function calcContrastRatio(lum1, lum2) {
    // lightest color over darkest
    return (Math.max(lum1, lum2) + 0.05) / (Math.min(lum1, lum2) + 0.05)
}

// Utils

function elapsed(progress) {
    // retourne le temps écoulé en millisecondes
    return Math.floor((progress.current - progress.start) / 44.1) //44.1 frame par milliseconde
}

function totalLength(progress) {
    // retourne le temps écoulé en millisecondes
    return Math.floor((progress.end - progress.start) / 44.1) //44.1 frame par milliseconde
}

function map(x, inMin, inMax, outMin, outMax) {
    return (x - inMin) * (outMax - outMin) / (inMax - inMin) + outMin
}

function copyObject(src) {
    return Object.assign({}, src)
}

function myHash() {
    return Math.random().toString(36).substring(2, 12)
}