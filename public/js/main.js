import { myConfig } from "./config.js";
import Track from "./track.js";

const server = `ws://${window.location.host}`;
let track = new Track();

let isModal = false;
let timerPict; // stocke l'ID du timer pour requestPICT

let socket;
let mainEl;
let modalEl;
let modalBtn;
let totalEl;
let timeout = 250; // tentatives de reconnexion de plus en plus espacées

let timeData = null; // si un message position arrive avant que l'obj Track soit créé, les données seront stockées là (iOS peut envoyer `position` avant `trackInfos`)

const debug = true;
window.newWebSocket = newWebSocket;
// to send a messsage from the client : ws = new window.newWebSocket; ws.send('yo!');

window.addEventListener(
	"load",
	(event) => {
		mainEl = document.querySelector("main");
		modalEl = document.querySelector(".modal");
		modalBtn = modalEl.querySelector(".modal-header .btn");

		totalEl = mainEl.querySelector("#total");
		totalEl.addEventListener(
			"pointerenter",
			onHoverTotal,
			false,
		);
		totalEl.addEventListener(
			"pointerleave",
			onHoverTotal,
			false,
		);

		socket = newWebSocket();
	},
	false,
);

document.addEventListener(
	"keyup",
	(ev) => {
		if (ev.key === "Escape" && isModal) {
			closeModal();
		}
	},
	false,
);

function newWebSocket() {
	if (debug) console.log(getTheTime(), "Trying to connect...");
	const ws = new WebSocket(server);

	ws.onopen = onOpen;
	ws.onclose = onClose;
	ws.onmessage = onMessage;
	ws.onerror = onError;
	return ws;
}

function onError(err) {
	if (debug) console.error(getTheTime(), "WebSocket error: ", err.message);
	ws.close();
}

function onOpen(ev) {
	if (debug) console.log(getTheTime(), "Connection opened");
	timeout = 250;
}

function onClose(ev) {
	if (ev.wasClean) {
		if (debug)
			console.log(
				getTheTime(),
				`Connection closed cleanly, code=${ev.code}`,
			);
		return;
	}

	// e.g. server process killed or network down
	if (debug) console.log(getTheTime(), `Connection died, code=${ev.code}`);

	if (!navigator.onLine) {
		if (debug) console.log(getTheTime(), "You're offline !");
		if (!isModal) {
			displayModal("offline");
		}
		return;
	}

	if (timeout > 3000) {
		displayModal("connect_error");
	}
	if (debug) console.log("Timeout: ", timeout);
	// essaye de se reconnecter au serveur, à intervalles de plus en plus espacés (jusqu'à 15 secondes)
	const maxTimeout = 15000;
	window.setTimeout(
		() => {
			socket = newWebSocket();
			if (timeout <= maxTimeout) timeout += timeout;
		},
		Math.min(maxTimeout, timeout),
	);
}

function onMessage(msgIn) {
	const msg = JSON.parse(msgIn.data);
	if (isModal) closeModal();

	if (debug) console.log(getTheTime(), msg);
	switch (msg.type) {
		case "welcome":
			if (debug) console.log(getTheTime(), "Welcome new client.");
			break;
		case "noInfo":
			track = new Track();
			track.raz();
			displayModal("noInfo");
			break;
		case "PICTmeta":
			PICTmeta(msg.data);
			break;
		case "PICT":
			PICT(msg.data);
			if (timerPict) {
				clearInterval(timerPict);
				timerPict = null;
			}
			break;
		case "noPICT":
			noPICT();
			if (timerPict) {
				clearInterval(timerPict);
				timerPict = null;
			}
			break;
		case "trackInfos":
			trackInfos(msg.data);
			// vérifie qu'il y a une pochette
			if (!timerPict) {
				timerPict = setInterval(() => {
					if (track.title.title && !track.artwork.isPresent) {
						socket.send("requestPICT");
						if (debug) console.log(getTheTime(), "Sending Pict Request");
					}
				}, 6000);
			}
			break;
		case "position":
			position(msg.data);
			break;
		case "volume":
			track.volume = msg.data.volume;
			break;
		case "pause":
			track.timerPause();
			break;
		case "stop":
			if (track.raf) window.cancelAnimationFrame(track.raf);
			track = null;
			track = new Track();
			track.raz();
			clearInterval(timerPict);
			timerPict = null;
			break;
		default:
			if (debug) console.log("You're missing something => ", msg.type);
			break;
	}
}

const PICTmeta = (data) => {
	if (isModal) closeModal();
	track.artwork.dimensions.width = data.dimensions.width;
	track.artwork.dimensions.height = data.dimensions.height;
	if (data.palette.backgroundColor !== "undefined") {
		track.artwork.palette.backgroundColor = data.palette.backgroundColor;
		track.artwork.palette.primaryColor = data.palette.primaryColor;
		track.artwork.palette.secondaryColor = data.palette.secondaryColor;
		if (data.palette.spanColorContrast) {
			track.artwork.palette.spanColorContrast = true;
		}
		track.updateColors();
	}
};

const PICT = (data) => {
	track.artwork.isPresent = true;
	track.artwork.src = data.url;
	track.artwork.is2x = data.is2x;
	track.updatePICT();
	track.updateColors();
};

const noPICT = () => {
	track.artwork.src = myConfig.defaultArtwork.src;
	track.artwork.is2x = true;
	track.artwork.dimensions.width = myConfig.defaultArtwork.width;
	track.artwork.dimensions.height = myConfig.defaultArtwork.height;
	track.updatePICT();
	track.updateColors();
};

const trackInfos = (data) => {
	if (isModal) closeModal();
	if (track.isRunning) {
		track.timerPause();
	}
	if (track.album.id !== data.albumId) {
		// fait disparaître la pochette précédente si l'album est différent
		track.artwork.el.classList.add("fading");
		document.documentElement.style.setProperty("--bg-img", "");
	}
	// trackinfos can be sent twice (iOS)
	if (track.album.id=== data.albumId && track.title.title === data.title && track.artist.artist === data.artist) return;

	track = new Track();
	track.title.title = data.title;
	track.artist.artist = data.artist;
	track.album.album = data.album;
	track.album.id = data.albumId;
	track.yearAlbum = data.yearAlbum;
	track.durationMs = data.duration;
	track.updateTrackInfos();
	if (timeData) {
		track.timeStart = timeData.start;
		track.currPosition = timeData.currPosition;
		track.durationMs = timeData.duration;
		track.timerStart();
		timeData = null;
	}
};

const position = (data) => {
	if (!track.title.title) {
		timeData = {
			currPosition: data.currPosition,
			duration: data.duration,
			start: Date.now() - data.currPosition,
		};
	} else {
		track.timeStart = Date.now() - data.currPosition;
		track.currPosition = data.currPosition;
		track.durationMs = data.duration;
		!track.isRunning && track.timerStart(); // if (isRunning is false)  start timer
	}
};

const onHoverTotal = (ev) => {
	if (track) {
		if (ev.type === "pointerenter") {
			// Affichage du temps restant
			track.timerHoverId = setInterval(() => {
				track.totalEl.textContent = `-${track.displayDuration(track.durationMs - track.currPosition)}`;
			}, 250);
			return;
		}
		// pointerleave
		clearInterval(track.timerHoverId);
		track.timerHoverId = null;
		totalEl.textContent = track.displayDuration(track.durationMs);
	}
}

const handleModal = (ev) => {
	closeModal();
	ev.preventDefault();
};

function displayModal(msg) {
	modalBtn.addEventListener("click", handleModal);
	const m = modalEl.querySelector(".modal-body");
	const h = modalEl.querySelector(".modal-header *:first-child");
	switch (msg) {
		case "noInfo":
			h.innerHTML = myConfig.strings.modalMsgInfosTitle;
			m.innerHTML = myConfig.strings.modalMsgInfos;
			break;
		case "connect_error":
			h.innerHTML = myConfig.strings.modalMsgServerTitle;
			m.innerHTML = myConfig.strings.modalMsgServer;
			modalEl.classList.add("modal-warning");
			break;
		case "offline":
			h.innerHTML = myConfig.strings.modalMsgServerTitle;
			m.innerHTML = myConfig.strings.modalMsgOffline;
			modalEl.classList.add("modal-warning");
			break;
		default:
			m.innerHTML = msg;
			break;
	}
	mainEl.classList.add("showModal");
	modalEl.classList.add("showModal");
	isModal = true;
}

function closeModal() {
	modalBtn.removeEventListener("click", handleModal);
	mainEl.classList.remove("showModal");
	modalEl.classList.remove("showModal");
	if (modalEl.classList.contains("modal-warning"))
		modalEl.classList.remove("modal-warning");
	isModal = false;
}

function getTheTime() {
	const d = new Date();
	return `${d.toLocaleTimeString()}:${d.getMilliseconds()}`;
}
