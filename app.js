const ShairportReader = require("shairport-sync-reader");
const compression = require("compression"); // to use gzip compression
const gm = require("gm").subClass({ imageMagick: true });
const imageColors = require("imagecolors");

const Color = require("color");
const express = require("express");
const WebSocket = require("ws");
require("dotenv").config();

// Server
const app = express();
const port = process.env.PORT;
app.use(compression());
app.use(express.static("public"));
app.disable("x-powered-by"); // masquer express dans les headers

// biome-ignore lint/style/useNodejsImportProtocol: <explanation>
const http = require("http");
const server = http.createServer(app);
// Initialize WebSocket server instance
const wss = new WebSocket.Server({
	server: server,
});

// biome-ignore lint/style/useNodejsImportProtocol: <explanation>
const fs = require("fs");
// biome-ignore lint/style/useNodejsImportProtocol: <explanation>
const path = require("path");

const Track = require("./Track.js");
let track = new Track();
let prevTrack;
let currentAlbum;
let prevAlbum;
let buf;
let imgPath;
let bestCr;
let bestColor;

const debug = true;

const defaultImageFormat = process.env.IMG_FORMAT; // defined in `/.env`' => webp' or 'original'
const cache = "/public/img";
// Verify the existence of the cache folder ans create it if needed
try {
	if (!fs.existsSync(path.join(__dirname, cache))) {
		fs.mkdirSync(path.join(__dirname, cache));
	}
} catch (err) {
	console.error(err);
}

// Nettoyage du cache des images de fond
cleanUp();

server.listen(port, () => {
	console.log(
		"◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇",
	);
	console.log(`listening on port: ${server.address().port}`);
});

// Routes ----------------------
app.get("/", (req, res) => {
	res.sendFile(`${__dirname}public/index.html`);
});

// Route not found (404)
app.use((req, res, next) => {
	return res.status(404).sendFile(`${__dirname}/public/404.html`);
});

// 500 - Any server error
app.use((err, req, res, next) => {
	return res.status(500).send({ error: err });
});

wss.on("connection", (ws) => {
	console.log(new Date().toLocaleString(), " >>> Client connected...");
	ws.send('{"type": "welcome"}');

	if (track.title !== "") {
		// pour n'envoyer les infos qu'au nouveau connecté
		updateTrack("trackInfos", ws);
		if (track.artwork.isPresent && track.artwork.isReady) {
			updateTrack("PICT", ws);
			updateTrack("PICTmeta", ws);
		} else {
			updateTrack("noPICT", ws);
		}
	} else {
		ws.send('{"type": "noInfo"}');
	}

	ws.on("message", (msg) => {
		console.log(`Received: "${decodeURIComponent(msg)}"`);
		if (decodeURIComponent(msg) === "requestPICT") {
			if (track.artwork.isPresent && track.artwork.isReady) {
				updateTrack("PICT", ws);
				updateTrack("PICTmeta", ws);
				return;
			}
			ws.send('{"type": "noPICT"}');
		}
		if (decodeURIComponent(msg) === "track") {
			updateTrack("track", ws);
		}
	});

	ws.on("close", () => {
		console.log(new Date().toLocaleString(), " >>> Client gone.");
	});
});

// read from pipe
const pipeReader = new ShairportReader({
	path: process.env.FIFO,
});

// NB: pour la significatioin des codes DAAP, voir https://github.com/bjoernricks/daap-protocol?tab=readme-ov-file#appendix-a---content-codes
/*
La version desktop de iTunes et Musique envoie en général toutes les informations 'meta' en un seul message, mais d'un autre côté l'app IOS Musique envoie plusieurs messages avec des informations en partie redondantes mais aussi des différences !
L'app IOS n'envoie pas non plus les informations dans le même ordre : un message 'PICT' peut arriver avant un 'meta' (=> pas encore d'ID pour l'album)
*/
pipeReader
	.on("meta", (meta) => {
		// if (debug) console.log("\n--------------------------\nev: meta", meta);
		if (debug) console.log("ev: meta");
		if (meta.caps) console.log("--->meta.caps", meta.caps);
		if (meta.caps && meta.caps === 2) {
			/*
            IOS Music envoie un code `caps` dans ses `meta`. `caps` est un code DACP (Digital Audio Control Protocol) pour le "playing status"
            2 = stopped
            On ignore ces messages envoyés quand un morceau est mis en pause sur l'app
            */
			if (debug)
				console.log("Play Status code: 2 (stopped) -> Message ignored");
			return;
		}

		if (track.trackId && meta.mper !== track.trackId) {
			// `mper`: DMAP persistent ID
			prevTrack = structuredClone(track); // deep copy
			if (debug) console.log(">>>> Creating new Track obj !");
			track = new Track();
		}
		track.trackId = meta.mper;
		if (debug) console.log("trackId:", track.trackId);

		if (meta.asai) {
			currentAlbum = meta.asai; // `asai` : album ID (DAAP code)
		} else {
			// pas de code 'asai' (typiquement IOS), on en génère un à partir de l'artiste + album
			currentAlbum = `0x${cyrb53(meta.asar + meta.asal)}`;
		}
		track.albumId = currentAlbum;
		if (debug) console.log("albumId:", currentAlbum);

		if (prevTrack && currentAlbum !== prevTrack.albumId) {
			prevAlbum = prevTrack.albumId;
			if (debug) console.log("prevAlbum", prevAlbum ? prevAlbum : "none");
		}
		track.artist = meta?.asar; // Song artist
		track.title = meta?.minm; // Song title
		track.album = meta?.asal; // Song album
		track.yearAlbum = meta?.asyr; // Song year
		track.duration = meta?.astm; // Song duration (in ms)
		if (currentAlbum === prevAlbum) {
			track.artwork = structuredClone(prevTrack.artwork);
		}
		updateTrack("trackInfos");
	})
	.on("pvol", (pvol) => {
		if (debug) console.log("ev: pvol");
		// volume entre 0 (muet) et 100 (à fond)
		track.volume = scale(pvol.volume, pvol.lowest, pvol.highest, 0, 100);
		updateTrack("volume");
	})
	.on("prgr", (prgr) => {
		if (!track.duration) {
			track.duration = totalLength(prgr);
		}
		track.currPosition = elapsed(prgr);
		if (debug)
			console.log(
				"ev: prgr",
				prgr,
				"-> durée:",
				displayDuration(track.duration),
				"curr:",
				displayDuration(track.currPosition),
			);
		updateTrack("position");
	})
	.on("pfls", (pfls) => {
		if (debug) console.log("ev: pfls");
		// Pause/Stop : envoie un  message pour vider l'affichage
		for (const client of wss.clients) {
			client.send('{"type": "pause"}');
		}
	})
	.on("pend", () => {
		if (debug) console.log("ev: pend");
		// fin du stream
		track = new Track();
		currentAlbum = null;
		for (const client of wss.clients) {
			client.send('{"type": "stop"}');
		}
	})
	.on("PICT", (PICT) => {
		if (debug) console.log("ev: PICT");
		if (track.artwork.isReady) {
			// ignore les messages redondants
			console.log(">> Discarded: Img already received");
			return;
		}
		buf = Buffer.from(PICT, "base64");
		track.artwork.isPresent = true;
		processPICT(buf);
	})
	.on("stal", (err) => console.warn("Message 'stal' error:", err));

function updateTrack(what, socket) {
	let data;
	let src;
	switch (what) {
		case "trackInfos":
			data = {
				artist: track.artist,
				title: prepareTitle(track.title),
				album: track.album,
				albumId: track.albumId,
				yearAlbum: track.yearAlbum,
				duration: track.duration,
			};
			break;
		case "PICT":
			// TODO: parfois 'PICT' est envoyé avant 'meta'
			if (track.albumId) {
				const url = `img/${track.albumId}.${track.artwork.format}`;
				data = {
					url: url,
					is2x: track.artwork.is2x,
				};
			}
			break;
		case "PICTmeta":
			if (currentAlbum === prevAlbum) {
				if (!track.artwork.palette.backgroundColor && imgPath) {
					if (debug)
						console.log("Recrée la palette à partir de:", `${imgPath}`);
					extractPalette(imgPath);
				}
			}
			data = {
				dimensions: {
					width: track.artwork.dimensions.width,
					height: track.artwork.dimensions.height,
				},
				palette: {
					backgroundColor: track.artwork.palette.backgroundColor,
					primaryColor: track.artwork.palette.primaryColor,
					secondaryColor: track.artwork.palette.secondaryColor,
					spanColorContrast: track.artwork.palette.spanColorContrast,
				},
			};
			break;
		case "position":
			data = {
				currPosition: track.currPosition,
				duration: track.duration,
			};
			break;
		case "volume":
			data = {
				volume: track.volume,
			};
			break;
		case "noPICT":
			data = {
				isPresent: track.artwork.isPresent,
			};
			break;
		default:
			// envoie l'obj track en entier
			data = track;
			break;
	}
	if (!data) return;
	// Formater le message en objet JSON :
	// {'type': what, 'msg': data}
	const msg = {
		type: what,
		data: data,
	};
	try {
		if (socket) {
			// envoie à un seul client
			socket.send(JSON.stringify(msg));
			return;
		}
		// Default : broadcast
		for (const client of wss.clients) {
			client.send(JSON.stringify(msg));
		}
	} catch (err) {
		if (debug)
			console.error(new Date().toLocaleString(), " >>> JSON Error: ", err);
		if (debug) console.log(msg);
	}
}

function extractPalette(thePath) {
	let bgColor;
	let primaryColor;
	let secondaryColor;
	imageColors.extract(thePath, 5, (err, colors) => {
		if (err && debug) console.error("extractPalette", err);
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
		const remainingColors = colors.filter((c) => c.hex !== bgColor.hex);
		// ajoute une propriété `contrast ratio` à chaque couleur (comparaison avec bgColor)
		for (const c of remainingColors) {
			c.lumi = colorLuminance(Object.values(c.rgb));
			c.cr = calcContrastRatio(bgColor.lumi, c.lumi);
		}
		remainingColors.sort((a, b) => b.cr - a.cr); // tri sur le contrast ratio

		// 2) titre
		primaryColor = remainingColors[0];
		if (primaryColor.cr && primaryColor.cr < 3) {
			// réglage de la couleur
			// if (debug) console.log("couleur:", primaryColor, "background:", bgColor, "cr:", primaryColor.cr);
			newPrimaryColor = tuneColor(primaryColor, bgColor);
			// if (debug) console.log("New primary color:", newPrimaryColor);
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
			// if (debug) console.log("New secondary color", newSecondaryColor);
			track.artwork.palette.secondaryColor = newSecondaryColor;
		} else {
			track.artwork.palette.secondaryColor = toHslString(secondaryColor.hsl);
		}

		updateTrack("PICT");
		updateTrack("PICTmeta");
	});
}
async function getImageSize(img) {
	return new Promise((resolve, reject) => {
		img.size((err, size) => (err ? reject(err) : resolve(size)));
	});
}

async function getImageFormat(img) {
	return new Promise((resolve, reject) => {
		img.format((err, format) => (err ? reject(err) : resolve(format)));
	});
}

async function generateImg(data, width, destUrl) {
	return new Promise((resolve, reject) => {
		try {
			data.resize(width).write(destUrl, async (err, success) => {
				console.log(`${width} version WEBP created`);
				const newSize = await getImageSize(gm(destUrl));
				resolve(newSize.height); // renvoie la hauteur de la nouvelle image
			});
		} catch (err) {
			reject(err);
		}
	});
}

async function processPICT(buf) {
	if (!prevAlbum || currentAlbum !== prevAlbum) {
		// TODO: vérifier la condition
		try {
			const img = gm(buf);
			const format = await getImageFormat(img);
			console.log(">>>> ProcessPICT new album, image format:", format);
			const { width, height } = await getImageSize(img);
			if (debug) console.log(`image: ${width} x ${height} (${format})`);
			track.artwork.dimensions.width = width;
			track.artwork.dimensions.height = height;
			track.artwork.format =
				defaultImageFormat === "webp" ? "webp" : format.toLowerCase();
			!currentAlbum &&
				console.log(
					"!!!!!!!! [ProcessPICT] currentAlbum pas encore renseigné !!!!!",
				);
			imgPath = `${__dirname}${cache}/${currentAlbum}.${track.artwork.format}`;
			console.log(">>>> ProcessPICT new album, path:", imgPath);

			// Vérifie si l'image existe en cache
			if (fs.existsSync(imgPath)) {
				if (debug) console.log("Utilise le cache pour la pochette.");
				if (width < 1024) track.artwork.is2x = false;
				// récupère les dimensions de l'image en cache
				const size = await getImageSize(gm(imgPath));
				track.artwork.dimensions.width = size.width;
				track.artwork.dimensions.height = size.height;
				track.artwork.isReady = true;
				extractPalette(imgPath);
				return;
			}

			// Si width >= 1024px, crée une version 2x (1024px) et 1x (512px)
			if (width >= 1024) {
				let newHeight = await generateImg(
					img,
					1024,
					`${__dirname}${cache}/${currentAlbum}-2x.${track.artwork.format}`,
				);
				if (debug) console.log("Image cached (2x).");
				// 1x version
				const img1x = gm(
					`${__dirname}${cache}/${currentAlbum}-2x.${track.artwork.format}`,
				);
				newHeight = await generateImg(img1x, 512, imgPath);
				track.artwork.dimensions.width = 512;
				track.artwork.dimensions.height = newHeight;
				track.artwork.isReady = true;
				if (debug) console.log("Image cached.");
				extractPalette(imgPath);
			} else {
				track.artwork.is2x = false;
				if (width > 512) {
					newHeight = await generateImg(img, 512, imgPath);
					track.artwork.dimensions.width = 512;
					track.artwork.dimensions.height = newHeight;
					if (debug) console.log("Image cached.");
					extractPalette(imgPath);
				} else {
					img.write(imgPath, (err, data) => {
						if (err && debug)
							console.error(`erreur écriture ${imgPath}, ${err}`);
						if (debug) console.log("Image cached.");
						extractPalette(imgPath);
					});
				}
				track.artwork.isReady = true;
			}
		} catch (err) {
			console.error("err processPICT:", err);
		}
	} else {
		// Vérifier que l'image existe
		imgPath = `${__dirname}${cache}/${currentAlbum}.${track.artwork.format}`;
		console.log(
			">>>> ProcessPICT same album, path:",
			imgPath,
			"format:",
			track.artwork.format,
		);
		if (fs.existsSync(imgPath)) {
			track.artwork.isReady = true;
			updateTrack("PICT");
			updateTrack("PICTmeta");
		} else {
			updateTrack("noPICT");
		}
	}
}

function tuneColor(col, bgCol) {
	if (debug) console.log("-------------------------");
	if (debug) console.log("background:", bgCol.hsl, "lumi:");
	if (debug)
		console.log("foreground:", col.hsl, "lumi:", "contrast ratio:", col.cr);

	// Dérivée de la courbe : on calcule la pente de la courbe du contrast ratio par rapport à la luminosité de la couleur de premier plan pour voir si elle est croissante ou décroissante et ainsi déterminer la direction
	const c1 = Color({ h: col.hsl.h, s: col.hsl.s, l: Number(col.hsl.l) + 1 });
	const c1CR = calcContrastRatio(bgCol.lumi, colorLuminance(c1.rgb().array()));
	const c2 = Color({ h: col.hsl.h, s: col.hsl.s, l: Number(col.hsl.l) - 1 });
	const c2CR = calcContrastRatio(bgCol.lumi, colorLuminance(c2.rgb().array()));
	const coeff = (c1CR - c2CR) / 2;
	const direction = coeff < 0 ? -1 : 1;
	const increment = 3 - col.cr > 0.5 ? 10 : 1;

	// Fonctionne avec des objet Color https://github.com/Qix-/color/
	const myCol = Color(col.hsl);
	bestCr = col.cr;
	bestColor = Color(col.hsl);
	let guess = genNewCol(myCol, direction, increment);
	if (!guess) {
		// la première direction n'a pas donné de CR satisfaisant, on part dans l'autre sens
		guess = genNewCol(myCol, direction === 1 ? -1 : 1, 10);
		if (!guess) {
			// pas de résultat probant, on renvoie le meilleur trouvé
			return bestColor.hsl().string();
		}
	}
	return guess;
}

function genNewCol(col, dir, incr, overshoot = false) {
	let direction = dir;
	let increment = incr;
	const oldCol = Color(col); // crée une copie
	const lumBg = track.artwork.palette.backgroundLuminance;
	if (col.hsl().lightness() >= 90) increment = 1;
	const newLightness = Math.round(
		col.hsl().lightness() + direction * increment,
	);
	if (newLightness < 0 || newLightness > 100) {
		return false;
	}
	const newCol = Color({
		h: col.hsl().hue(),
		s: col.hsl().saturationl(),
		l: newLightness,
	});
	const newLumi = colorLuminance(newCol.rgb().array());
	const newCr = calcContrastRatio(lumBg, newLumi);
	// Mémorise le meilleur résultat trouvé
	if (newCr > bestCr) {
		bestCr = newCr;
		bestColor = oldCol;
	}
	// if (debug) console.log("new col", newCol.hsl().string())
	// if (debug) console.log("new cr:", newCr, "best:", bestCr)

	if (newCr < 3 && !overshoot) {
		// le contrast ratio n'est toujours pas bon, on continue
		increment = 3 - newCr > 0.5 ? 10 : 1;
		return genNewCol(newCol, direction, increment);
	}

	if (newCr < 3 && overshoot) {
		// le contrast ratio était bon à la dernière itération
		return oldCol.hsl().string();
	}

	if (newCr >= 3 && !overshoot) {
		// le contrast ratio est bon mais on va essayer d'affiner en inversant la direction
		direction = direction === 1 ? -1 : 1;
		increment = 1;
		return genNewCol(newCol, direction, increment, true);
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
	const lumi = rgb.map((v) => {
		const val = v / 255;
		return val < 0.03928 ? val / 12.92 : ((val + 0.055) / 1.055) ** 2.4;
	});
	return lumi[0] * 0.2126 + lumi[1] * 0.7152 + lumi[2] * 0.0722;
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
	return ((x - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin;
}

function toHslString(hsl) {
	return `hsl(${Math.round(hsl.h)}, ${Math.round(hsl.s)}%, ${Math.round(hsl.l)}%)`;
}

function prepareTitle(str) {
	// pour permettre le passage à la ligne du texte entre parenthèses dans les titres
	const regex = /\((.*?)\)/;
	return str.replace(regex, "<span>($1)</span>");
}
function cleanUp() {
	// Nettoyage du cache images
	const base = path.join(__dirname, cache);
	try {
		fs.promises.readdir(base).then((files) => {
			let listing = [];
			for (const f of files) {
				if (/\.(gif|jpg|jpeg|png|webp)$/i.test(f)) {
					const stats = fs.statSync(path.join(base, f));
					// stocke le nom et la date de création du fichier (en ms)
					listing = [...listing, { name: f, date: stats.birthtimeMs }];
				}
			}
			// tri sur la date, plus ancien en premier
			const ordered = listing.sort((a, b) => a.date - b.date);
			let isCleaning = false;
			// Supprime les plus anciens
			while (ordered.length > process.env.MAX_FILES_CACHED) {
				fs.unlink(path.join(base, ordered[0].name), (err) => {
					if (err) console.error(err);
					isCleaning = true;
				});
				ordered.shift();
			}
			if (isCleaning && debug) console.log("Cache cleaned.");
		});
	} catch (err) {
		console.error(err);
	}
}

// Hash function : IOS n'envoie pas d'albumID ('asai') => on un génère un à partir du titre de l'abum + nom artiste
// cf. https://stackoverflow.com/a/52171480
function cyrb53(str, seed = 0) {
	let h1 = 0xdeadbeef ^ seed;
	let h2 = 0x41c6ce57 ^ seed;
	for (let i = 0, ch; i < str.length; i++) {
		ch = str.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
	h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
	h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);

	return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

// Utility fn to display readable timings !
function displayDuration(t) {
	// milliseconds to seconds
	let seconds = Math.floor(t / 1000);
	const arr = [];
	let str = "";
	// hours
	let a = Math.floor(seconds / 3600);
	if (a > 0) {
		arr.push(a);
		seconds = seconds % 3600;
	}
	// minutes
	a = Math.floor(seconds / 60);
	if (a > 0) {
		arr.push(a);
		// seconds
		seconds = seconds % 60;
	}
	arr.push(seconds);
	while (arr.length > 0) {
		if (str !== "") str = `:${str}`;
		str = arr.pop().toString().padStart(2, "0") + str;
	}
	if (str.substring(0, 1) === 0 && str.length > 3) str = str.slice(1);
	if (str.length === 2) str = `0:${str}`;
	return str;
}
