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
let imgPath;
let bestCr;
let bestColor;

const debug = true;

const defaultImageFormat = process.env.IMG_FORMAT; // defined in `/.env`' => webp' or 'original'
const cache = '/public/img';

// Nettoyage du cache des images de fond
cleanUp();

server.listen(port, () => {
    console.log('◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇');
    console.log('◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆');
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
        } else {
            updateTrack('noPICT', ws);
        }
    } else {
        ws.send('{"type": "noInfo"}');
    }

    ws.on('message', function (msg) {
        console.log(`Received: "${decodeURIComponent(msg)}", msg`);
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
        if (debug) console.log('albumId:', currentAlbum);
        prevTrack = track;
        track = new Track();
        track.artist = meta.asar;
        track.title = meta.minm;
        track.album = meta.asal;
        track.albumId = meta.asai;
        track.yearAlbum = meta.asyr;
        track.duration = (meta.astm) ? meta.astm : undefined;
        if (currentAlbum === prevAlbum) {
            track.artwork = prevTrack.artwork;
        }
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
        currentAlbum = null;
        wss.clients.forEach(client => client.send('{"type": "stop"}'));
    })
    .on('PICT', function (PICT) {
        if (debug) console.log('ev: PICT');
        buf = Buffer.from(PICT, 'base64');
        track.artwork.isPresent = true;
        processPICT(buf);
    })
    .on('stal', (err) => console.warn("Message 'stal' reçu:", err))

function updateTrack(what, socket) {
    let data, src;
    switch (what) {
        case 'trackInfos':
            data = {
                'artist': track.artist,
                'title': prepareTitle(track.title),
                'album': track.album,
                'albumId': track.albumId,
                'yearAlbum': track.yearAlbum,
                'duration': track.duration
            }
            break
        case 'PICT':
            data = {
                'url': `img/${track.albumId}.${track.artwork.format}` || '',
                'is2x': track.artwork.is2x
            }
            break
        case 'PICTmeta':
            if (currentAlbum === prevAlbum) {
                if (!track.artwork.palette.backgroundColor && imgPath) {
                    if (debug) console.log("Recrée la palette à partir de:", `${imgPath}`)
                    extractPalette(imgPath)
                };
            }
            data = {
                'dimensions': {
                    'width': track.artwork.dimensions.width,
                    'height': track.artwork.dimensions.height
                },
                'palette': {
                    'backgroundColor': track.artwork.palette.backgroundColor,
                    'primaryColor': track.artwork.palette.primaryColor,
                    'secondaryColor': track.artwork.palette.secondaryColor,
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
        if (primaryColor.cr && primaryColor.cr < 3) {
            // réglage de la couleur
            // if (debug) console.log("couleur:", primaryColor, "background:", bgColor, "cr:", primaryColor.cr);
            newPrimaryColor = tuneColor(primaryColor, bgColor);
            if (debug) console.log("New primary color:", newPrimaryColor)
            track.artwork.palette.primaryColor = newPrimaryColor;
        } else {
            track.artwork.palette.primaryColor = toHslString(primaryColor.hsl);
        }

        // 3) artiste/album
        if (remainingColors[1]) {
            secondaryColor = remainingColors[1];
        } else {
            // Pas assez de couleurs, on utilise la même que pour le titre
            secondaryColor = remainingColors[0];
        }
        if (secondaryColor.cr && secondaryColor.cr < 3) {
            // réglage de la couleur
            // if (debug) console.log("couleur:", secondaryColor, "background:", bgColor, "cr:", secondaryColor.cr)
            newSecondaryColor = tuneColor(secondaryColor, bgColor);
            if (debug) console.log("New secondary color", newSecondaryColor)
            track.artwork.palette.secondaryColor = newSecondaryColor;
        } else {
            track.artwork.palette.secondaryColor = toHslString(secondaryColor.hsl);
        }

        updateTrack('PICT')
        updateTrack('PICTmeta')
    })
}

async function processPICT(buf) {
    if (currentAlbum !== prevAlbum) {
        try {
            gm(buf).identify((err, data) => {
                if (err && debug) console.error("metadata size", err);
                const w = data.size.width;
                const h = data.size.height;
                const f = data.format.toLowerCase();
                if (debug) console.log(`image: ${w} x ${h} (${f})`);
                track.artwork.dimensions.width = w;
                track.artwork.dimensions.height = h;
                track.artwork.format = (defaultImageFormat === 'webp') ? 'webp' : f;
                imgPath = `${__dirname}${cache}/${currentAlbum}.${track.artwork.format}`;

                // Vérifie si l'image existe en cache
                if (fs.existsSync(imgPath)) {
                    if (debug) console.log("Utilise le cache pour la pochette.");
                    if (w < 1024) track.artwork.is2x = false;
                    extractPalette(imgPath);
                    return;
                }

                // Si width > 1024px, crée une version 2x (1024px) et 1x (512px)
                if (w >= 1024) {
                    gm(buf)
                        .resize(1024)
                        .write(`${__dirname}${cache}/${currentAlbum}-2x.${track.artwork.format}`, (err, data) => {
                            if (err && debug) console.error(`erreur écriture ${__dirname}${cache}/${currentAlbum}-2x.${track.artwork.format}, ${err}`)
                            if (debug) console.log("Image cached (2x).")
                        })

                    gm(buf)
                        .resize(512)
                        .write(imgPath, (err, data) => {
                            if (err && debug) console.error(`erreur écriture ${imgPath}, ${err}`)
                            if (debug) console.log("Image cached.")
                            extractPalette(imgPath);
                        })
                } else {
                    track.artwork.is2x = false;
                    if (w > 512) {
                        gm(buf)
                            .resize(512)
                            .write(imgPath, (err, data) => {
                                if (err && debug) console.error(`erreur écriture ${imgPath}, ${err}`)
                                if (debug) console.log("Image cached.")
                                extractPalette(imgPath);
                            })
                    } else {
                        gm(buf)
                            .write(imgPath, (err, data) => {
                                if (err && debug) console.error(`erreur écriture ${imgPath}, ${err}`)
                                if (debug) console.log("Image cached.")
                                extractPalette(imgPath);
                            });
                    }
                }
            });
        } catch (err) {
            console.error('err processPICT:', err)
        }
    } else {
        updateTrack('PICT');
        updateTrack('PICTmeta');
    }
}

function tuneColor(col, bgCol) {
    if (debug) console.log("-------------------------")
    if (debug) console.log("background:", bgCol.hsl, "lumi:")
    if (debug) console.log("foreground:", col.hsl, "lumi:", "contrast ratio:", col.cr)

    // Dérivée de la courbe : on calcule la pente de la courbe du contrast ratio par rapport à la luminosité de la couleur de premier plan pour voir si elle est croissante ou décroissante et ainsi déterminer la direction
    const c1 = Color({ h: col.hsl.h, s: col.hsl.s, l: Number(col.hsl.l) + 1 });
    const c1CR = calcContrastRatio(bgCol.lumi, colorLuminance(c1.rgb().array()));
    const c2 = Color({ h: col.hsl.h, s: col.hsl.s, l: Number(col.hsl.l) - 1 });
    const c2CR = calcContrastRatio(bgCol.lumi, colorLuminance(c2.rgb().array()));
    const coeff = (c1CR - c2CR) / 2;
    let direction = (coeff < 0) ? -1 : 1;
    let increment = (3 - col.cr > 0.5) ? 10 : 1;

    // Fonctionne avec des objet Color https://github.com/Qix-/color/
    let myCol = Color(col.hsl);
    bestCr = col.cr;
    bestColor = Color(col.hsl);
    let guess = genNewCol(myCol, direction, increment);
    if (!guess) {
        // la première direction n'a pas donné de CR satisfaisant, on part dans l'autre sens
        guess = genNewCol(myCol, (direction === 1) ? -1 : 1, 10);
        if (!guess) {
            // pas de résultat probant, on renvoie le meilleur trouvé
            return bestColor.hsl().string();
        }
    }
    return guess;
}

function genNewCol(col, direction, increment, overshoot = false) {
    const oldCol = Color(col); // crée une copie
    const lumBg = track.artwork.palette.backgroundLuminance;
    if (col.hsl().lightness() >= 90) increment = 1;
    const newLightness = Math.round(col.hsl().lightness() + (direction * increment));
    if (newLightness < 0 || newLightness > 100) {
        return false;
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
    if (debug) console.log("new col", newCol.hsl().string())
    if (debug) console.log("new cr:", newCr, "best:", bestCr)

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

function toHslString(hsl) {
    let h = Math.round(hsl.h), s = Math.round(hsl.s), l = Math.round(hsl.l);
    return `hsl(${h}, ${s}%, ${l}%)`;
}

function prepareTitle(str) {
    // pour permettre le passage à la ligne du texte entre parenthèses dans les titres
    const regex = /\((.*?)\)/;
    return str.replace(regex, `<span>($1)</span>`);
}
function cleanUp() {
    // Nettoyage du cache images
    const base = path.join(__dirname, cache);
    try {
        fs.promises.readdir(base)
            .then((files) => {
                let listing = [];
                files.forEach((f) => {
                    if (/\.(gif|jpg|jpeg|png|webp)$/i.test(f)) {
                        const stats = fs.statSync(path.join(base, f))
                        // stocke le nom et la date de création du fichier (en ms)
                        listing = [...listing, { 'name': f, 'date': stats.birthtimeMs }]
                    }
                });
                // tri sur la date, plus ancien en premier
                let ordered = listing.sort((a, b) => a.date - b.date);
                let isCleaning = false;
                // Supprime les plus anciens
                while (ordered.length > process.env.MAX_FILES_CACHED) {
                    fs.unlink(path.join(base, ordered[0].name), (err) => {
                        if (err) console.error(err);
                        isCleaning = true;
                    });
                    ordered.shift();
                }
                if (isCleaning && debug) console.log('Cache cleaned.');
            })
    } catch (err) {
        console.error(err);
    }
}