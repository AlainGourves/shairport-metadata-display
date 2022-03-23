const ShairportReader = require('shairport-sync-reader');
const compression = require('compression'); // to use gzip compression
const gm = require('gm').subClass({ imageMagick: true });
const imageColors = require('imagecolors');

const Color = require('color');
const express = require('express');
const WebSocket = require('ws');
require('dotenv').config();

// Server
const app = express();
const port = process.env.PORT;
app.use(compression());
app.use(express.static('public'));
app.disable('x-powered-by'); // masquer express dans les headers

const http = require('http');
const server = http.createServer(app);
// Initialize WebSocket server instance
const wss = new WebSocket.Server({
    server: server
});

const fs = require('fs');
const path = require('path');

const Track = require('./Track.js');
let track = new Track();
let prevTrack;
let currentAlbum, prevAlbum;
let buf;
let url;
let bgImg;
let bestCr;
let bestColor;

const debug = true;
// Nettoyage du cache des images de fond
cleanUp();

server.listen(port, () => {
    console.log(`listening on port: ${server.address().port}`);
})

// Routes ----------------------
app.get('/', function (req, res) {
    res.sendFile(__dirname + 'public/index.html');
})

// Route not found (404)
app.use(function (req, res, next) {
    return res.status(404).sendFile(__dirname + '/public/404.html');
})

// 500 - Any server error
app.use(function (err, req, res, next) {
    return res.status(500).send({ error: err });
})

wss.on('connection', function (ws) {
    console.log(new Date().toLocaleString(), ' >>> Client connected...');
    ws.send('{"type": "welcome"}');

    if (track.title !== '') {
        // pour n'envoyer les infos qu'au nouveau connecté
        updateTrack('trackInfos', ws);
        if (track.artwork.isPresent) {
            updateTrack('PICT', ws);
            updateTrack('PICTmeta', ws);
            updateTrack('bgImg', ws);
        } else {
            updateTrack('noPICT', ws);
        }
    } else {
        ws.send('{"type": "noInfo"}');
    }

    ws.on('message', function (msg) {
        console.log('Received: ', msg);
        if (msg === 'requestPICT') {
            if (track.artwork.isPresent) {
                updateTrack('PICT', ws);
                updateTrack('PICTmeta', ws);
                return;
            }
            ws.send('{"type": "noPICT"}');
        }
    })

    ws.on('close', function () {
        console.log(new Date().toLocaleString(), ' >>> Client gone.');
    })
})

// read from pipe
let pipeReader = new ShairportReader({
    path: process.env.FIFO
});

pipeReader
    .on('meta', function (meta) {
        if (debug) console.log('\n--------------------------\nev: meta');
        if (currentAlbum !== undefined) {
            if (debug) console.log('prevAlbum', currentAlbum);
            prevAlbum = currentAlbum;
        }
        currentAlbum = meta.asai; // `asai` : album ID (DAAP code)
        if (currentAlbum !== prevAlbum) bgImg = undefined
        if (debug) console.log('albumID:', currentAlbum);
        prevTrack = track;
        track = new Track();
        track.artist = meta.asar;
        track.title = meta.minm;
        track.album = meta.asal;
        track.yearAlbum = meta.asyr;
        track.duration = (meta.astm) ? meta.astm : undefined;
        updateTrack('trackInfos');
    })
    .on('pvol', function (pvol) {
        if (debug) console.log('ev: pvol');
        // volume entre 0 (muet) et 100 (à fond)
        track.volume = scale(pvol.volume, pvol.lowest, pvol.highest, 0, 100);
        updateTrack('volume');
    })
    .on('prgr', function (prgr) {
        if (debug) console.log('ev: prgr');
        if (track.duration === 0) {
            track.duration = totalLength(prgr);
        }
        track.currPosition = elapsed(prgr);
        updateTrack('position');
    })
    .on('pfls', function (pfls) {
        if (debug) console.log('ev: pfls');
        // Pause/Stop : envoie un  message pour vider l'affichage
        wss.clients.forEach(client => client.send('{"type": "pause"}'));
    })
    .on('pend', function () {
        if (debug) console.log('ev: pend');
        // fin du stream
        track = new Track();
        wss.clients.forEach(client => client.send('{"type": "stop"}'));
    })
    .on('PICT', function (PICT) {
        if (debug) console.log('ev: PICT');
        buf = Buffer.from(PICT, 'base64');
        track.artwork.isPresent = true;
        processPICT(buf);
    })

function updateTrack(what, socket) {
    let data, src;
    switch (what) {
        case 'trackInfos':
            data = {
                'artist': track.artist,
                'title': prepareTitle(track.title),
                'album': track.album,
                'yearAlbum': track.yearAlbum,
                'duration': track.duration
            }
            break
        case 'PICT':
            data = {
                'src': (buf) ? `data:image/${track.artwork.format};base64,${buf.toString('base64')}` : ''
            }
            break
        case 'bgImg':
            data = {
                'src': (bgImg) ? `data:image/jpeg;base64,${bgImg.toString('base64')}` : ''
            }
            break
        case 'PICTmeta':
            if (currentAlbum === prevAlbum) {
                track.artwork = prevTrack.artwork;
                if (!track.artwork.palette.backgroundColor && url) {
                    console.log("Recrée la palette à partir de:", url)
                    extractPalette(url)
                };
            }
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
        case 'noPICT':
            data = {
                'isPresent': track.artwork.isPresent
            }
            break
        default:
            // envoie l'obj track en entier
            data = track
            break
    }
    // Formater le message en objet JSON :
    // {'type': what, 'msg': data}
    let msg = {
        'type': what,
        'data': data
    }
    try {
        if (socket) {
            // envoie à un seul client
            socket.send(JSON.stringify(msg));
            return;
        }
        // Default : broadcast
        wss.clients.forEach(function each(client) {
            client.send(JSON.stringify(msg));
        });

    } catch (err) {
        if (debug) console.error(new Date().toLocaleString(), ' >>> JSON Error: ', err);
        if (debug) console.log(msg);
    }
}

function extractPalette(thePath) {
    let bgColor, primaryColor, secondaryColor;
    imageColors.extract(thePath, 5, (err, colors) => {
        if (err && debug) console.error('extractPalette', err)
        // Sélection des couleurs
        // Note: la fonction de calcul de luminance d'imageColors est moins complète,
        // donc on va recalculer les valeurs avec
        // https://www.w3.org/TR/2008/REC-WCAG20-20081211/#relativeluminancedef 

        // 1) background-color : couleur qui a le pourcentage le plus grand
        const byPercent = colors.sort((a, b) => b.percent - a.percent);
        bgColor = byPercent[0];
        bgColor.lumi = colorLuminance(Object.values(bgColor.rgb));

        if (bgColor.lumi > 0.75) {
            // la couleur de fond est très claire: l'année de l'album s'affiche dans la même couleur que le titre
            track.artwork.palette.spanColorContrast = true;
        }
        track.artwork.palette.backgroundLuminance = bgColor.lumi;
        track.artwork.palette.backgroundColor = toHslString(bgColor.hsl);

        // Couleurs restantes
        let remainingColors = colors.filter(c => c.hex !== bgColor.hex);
        // ajoute une propriété `contrast ratio` à chaque couleur (comparaison avec bgColor)
        remainingColors.forEach(c => c.lumi = colorLuminance(Object.values(c.rgb)));
        remainingColors.forEach(c => c.cr = calcContrastRatio(bgColor.lumi, c.lumi));
        remainingColors.sort((a, b) => b.cr - a.cr); // tri sur le contrast ratio

        // 2) titre
        primaryColor = remainingColors[0];
        // if (debug) console.log("primary:", primaryColor.hex, toHslString(primaryColor.hsl))
        if (primaryColor.cr < 3) {
            // réglage de la couleur
            // if (debug) console.log("couleur:", primaryColor, "background:", bgColor);
            newPrimaryColor = momo(primaryColor, bgColor);
            console.log("newPrimaryColor", newPrimaryColor)
            track.artwork.palette.color = newPrimaryColor;
        } else {
            track.artwork.palette.color = toHslString(primaryColor.hsl);
        }

        // 3) artiste/album
        secondaryColor = remainingColors[1];
        // if (debug) console.log("secondary:", secondaryColor.hex, toHslString(secondaryColor.hsl))
        if (secondaryColor.cr < 3) {
            // réglage de la couleur
            // if (debug) console.log("couleur:", secondaryColor, "background:", bgColor)
            newSecondaryColor = momo(secondaryColor, bgColor);
            console.log("newSecondaryColor", newSecondaryColor)
            track.artwork.palette.alternativeColor = newSecondaryColor;
        } else {
            track.artwork.palette.alternativeColor = toHslString(secondaryColor.hsl);
        }

        updateTrack('PICT')
        updateTrack('PICTmeta')
    })
}

function generateBackground(thePath) {

    // Cherche l'image de fond correspondante dans ./cache
    const cached = `${__dirname}/cache/bg_${currentAlbum}.${track.artwork.format}`;
    try {
        if (fs.existsSync(cached)) {
            if (debug) console.log("Utilise le cache pour l'image de fond");
            gm(cached).toBuffer((err, newBuffer) => {
                if (err && debug) console.error("erreur création buffer", err);
                bgImg = newBuffer;
                updateTrack('bgImg');
            })
            return;
        }
    } catch (err) {
        console.error(err);
    }

    //  Création Background image
    gm(thePath)
        // .resize(256)
        // .blur(8, 3) 
        .toBuffer('PNG', (err, tmpBuffer) => {
            if (err & debug) console.error("toBuffer", err);
            gm(tmpBuffer)
                .resize(1024)
                .blur(128, 4)// sur la valeur de sigma : https://stackoverflow.com/questions/23007064/effect-of-variance-sigma-at-gaussian-smoothing
                .modulate(125, 105) // % change in brightness & saturation
                .quality(75)
                .toBuffer((err, newBuffer) => {
                    if (err && debug) console.error("erreur création buffer", err);
                    bgImg = newBuffer;
                    updateTrack('bgImg')
                    if (debug) console.log('bgImg générée !');
                    // mise en cache de l'image de fond
                    gm(newBuffer).write(cached, (err) => {
                        if (err && debug) {
                            console.error("erreur cache bg image", err);
                            return;
                        }
                        if (debug) console.log("Bg image cached.")
                    })
                });
        });
}

async function processPICT(buf) {
    if (!bgImg || currentAlbum !== prevAlbum) {
        try {
            gm(buf).identify((err, data) => {
                if (err && debug) console.error("metadata size", err);
                const w = data.size.width;
                const h = data.size.height;
                const f = data.format.toLowerCase();
                if (debug) console.log('image:', w, 'x', h, `(${f})`);
                track.artwork.dimensions.width = w;
                track.artwork.dimensions.height = h;
                track.artwork.format = f;
                url = `${__dirname}/_tmp.${f}`;

                // Si width > 512px, on réduit l'image pour accélérer le processus
                if (w > 512) {
                    gm(buf).resize(512)
                        .resize(512)
                        .write(url, (err, data) => {
                            if (err && debug) console.error("erreur écriture", err)
                            extractPalette(url);
                            generateBackground(url);
                        })
                } else {
                    gm(buf)
                        .write(url, (err, data) => {
                            if (err && debug) console.error("erreur écriture", err)
                            extractPalette(url);
                            generateBackground(url);
                        })
                }
            });
        } catch (err) {
            if (debug) console.error('err processPICT:', err)
        }
    } else {
        updateTrack('bgImg');
        updateTrack('PICT');
        updateTrack('PICTmeta');
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
    let r = (c1[0] + c2[0]) / 2;
    return Math.sqrt((2 + r / 256) * (Math.pow(c2[0] - c1[0], 2)) + 4 * (Math.pow(c2[1] - c1[1], 2)) + (2 + (255 - r) / 256) * (Math.pow(c2[2] - c1[2], 2)));
}

/**
 * Calcul de la luminance selon la formule du W3CCalcul luminance d'une couleur
 * @param rgb   Array [R, G, B] 
 */
function colorLuminance(rgb) {
    let lumi = rgb.map(v => {
        v /= 255;
        return (v < 0.03928) ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    })
    return (lumi[0] * 0.2126) + (lumi[1] * 0.7152) + (lumi[2] * 0.0722);
}

function calcContrastRatio(lum1, lum2) {
    // lightest color over darkest
    return (Math.max(lum1, lum2) + 0.05) / (Math.min(lum1, lum2) + 0.05);
}

// Utils

function elapsed(progress) {
    // retourne le temps écoulé en millisecondes
    return Math.floor((progress.current - progress.start) / 44.1); //44.1 frame par milliseconde
}

function totalLength(progress) {
    // retourne le temps écoulé en millisecondes
    return Math.floor((progress.end - progress.start) / 44.1); //44.1 frame par milliseconde
}

// la fonction s'appelait map() avant, mais le nom est malheureux
function scale(x, inMin, inMax, outMin, outMax) {
    return (x - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;
}

function copyObject(src) {
    return Object.assign({}, src);
}

// function myHash() {
//     return Math.random().toString(36).substring(2, 12)
// }

function toHslString(hsl) {
    let h = Math.round(hsl.h), s = Math.round(hsl.s), l = Math.round(hsl.l);
    return `hsl(${h}, ${s}%, ${l}%)`;
}

function prepareTitle(str) {
    // pour permettre le passage à la ligne du texte entre parenthèses dans les titres
    const regex = /\((.*?)\)/;
    return str.replace(regex, `<span>($1)</span>`);
}

function momo(col, bgCol) {
    // console.log("couleur",col.score)
    console.log("background", bgCol.score, bgCol.lumi)
    console.log("foreground", col.score, col.lumi)
    // la luminance varie de 0 (noir) à 1 (blanc)
    // Si la couleur de fond est moins "sombre" que la couleur, on diminue la luminosité
    let direction = ((bgCol.lumi - col.lumi) > 0) ? -1 : 1;
    let increment = (3 - col.cr > 0.5) ? 10 : 1;

    console.log(direction, increment)

    // Fonctionne avec des objet Color
    let myCol = Color(col.hsl);
    bestCr = col.cr;
    bestColor = Color(col.hsl);
    const guess = genNewCol(myCol, direction, increment);
    if (!guess) {
        console.log("meilleure proposition:", bestColor.hsl().string())
        return bestColor.hsl().string();
    }
    return guess;
}

function genNewCol(col, direction, increment, overshoot = false) {
    console.log("col", col)
    const oldCol = Color(col); // crée une copie
    const lumBg = track.artwork.palette.backgroundLuminance;
    if (col.hsl().lightness() > 90) increment = 1;
    const newLightness = col.hsl().lightness() + (direction * increment);
    if (newLightness < 0 || newLightness > 100) {
        console.log("Dépassement")
        return;
    }
    const newCol = Color({
        h: col.hsl().hue(),
        s: col.hsl().saturationl(),
        l: newLightness
    });
    const newLumi = colorLuminance(newCol.rgb().array());
    const newCr = calcContrastRatio(lumBg, newLumi);
    // Mémorise le meilleur résultat trouvé
    if (newCr > bestCr) {
        bestCr = newCr;
        bestColor = oldCol;
    };
    console.log("newLumi:", newLumi)
    console.log("new cr:", newCr, "best:", bestCr)

    if (newCr < 3 && !overshoot) {
        // le contrast ratio n'est toujours pas bon, on continue
        increment = (3 - newCr > 0.5) ? 10 : 1;
        return genNewCol(newCol, direction, increment);
    }

    if (newCr < 3 && overshoot) {
        // le contrast ratio était bon à la dernière itération
        return oldCol.hsl().string();
    }

    if (newCr >= 3 && !overshoot) {
        // le contrast ratio est bon mais on va essayer d'affiner en inversant la direction
        overshoot = true;
        direction = (direction === 1) ? -1 : 1;
        increment = 1;
        return genNewCol(newCol, direction, increment, overshoot);
    }

    if (newCr >= 3 && overshoot) {
        // le contrast ratio est bon mais on continue d'essayer d'affiner
        return genNewCol(newCol, direction, increment, overshoot);
    }
}

function cleanUp() {
    const base = path.join(__dirname, 'cache');
    try {
        fs.promises.readdir(base)
            .then((files) => {
                let listing = [];
                files.forEach((f) => {
                    if (/\.(gif|jpg|jpeg|png)$/i.test(f)) {
                        const stats = fs.statSync(path.join(base, f))
                        // stocke le nom et la date de création du fichier (en ms)
                        listing = [...listing, { 'name': f, 'date': stats.birthtimeMs }]
                    }
                });
                // tri sur la date, plus ancien en premier
                let ordered = listing.sort((a, b) => a.date - b.date);
                // Supprime les plus anciens
                while (ordered.length > process.env.MAX_FILES_CACHED) {
                    fs.unlink(path.join(base, ordered[0].name), (err) => {
                        if (err) console.error(err);
                    });
                    ordered.shift();
                }
                if (debug) console.log('Cache cleaned.');
            })
    } catch (err) {
        console.error(err);
    }
}