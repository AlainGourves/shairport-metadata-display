import { myConfig } from "./config.js";
import Track from "./track.js";

const server = 'ws://' + window.location.host;
let track = new Track();

let isModal = false;
let timerPict; // stocke l'ID du timer pour requestPICT

let socket, mainEl, modalEl, modalBtn;
let timeout = 250; // tentatives de reconnexion de plus en plus espacées

const debug = false;
// window.newWebSocket = newWebSocket;
// to send a messsage from the client : ws = new window.newWebSocket; ws.send('yo!');

window.addEventListener('load', (event) => {
  mainEl = document.querySelector('main');
  modalEl = document.querySelector('.modal');
  modalBtn = modalEl.querySelector('.modal-header .btn');

  socket = newWebSocket();
}, false);

document.addEventListener('keyup', (event) => {
  if (event.key === 'Escape' && isModal) {
    closeModal();
  }
}, false);

function newWebSocket() {
  if (debug) console.log(getTheTime(), "Trying to connect...")
  let ws = new WebSocket(server);

  ws.onopen = onOpen;
  ws.onclose = onClose;
  ws.onmessage = onMessage;
  ws.onerror = onError;
  return ws;
}

function onError(event) {
  if (debug) console.error(getTheTime(), 'WebSocket error: ', err.message);
  ws.close();
}

function onOpen(event) {
  if (debug) console.log(getTheTime(), 'Connection opened');
  timeout = 250;
};

function onClose(event) {
  if (event.wasClean) {
    if (debug) console.log(getTheTime(), `Connection closed cleanly, code=${event.code}`);
    return;
  }

  // e.g. server process killed or network down
  if (debug) console.log(getTheTime(), `Connection died, code=${event.code}`);

  if (!navigator.onLine) {
    if (debug) console.log(getTheTime(), "You're offline !")
    if (!isModal) {
      displayModal('offline');
    }
    return;
  }

  if (timeout > 3000) {
    displayModal('connect_error');
  }
  if (debug) console.log('Timeout: ', timeout);
  window.setTimeout(function () {
    socket = newWebSocket();
  }, Math.min(10000, timeout += timeout));
};

function onMessage(msg) {
  msg = JSON.parse(msg.data);
  if (isModal) {
    closeModal();
    if (modalEl.classList.contains('modal-warning')) modalEl.classList.remove('modal-warning');
  }
  if (debug) console.log(getTheTime(), msg);
  switch (msg.type) {
    case 'welcome':
      if (debug) console.log(getTheTime(), "Welcome new client.");
      break;
    case 'noInfo':
      track = new Track();
      track.raz();
      displayModal('noInfo');
      break;
    case 'PICTmeta':
      PICTmeta(msg.data);
      break;
    case 'PICT':
      PICT(msg.data);
      window.clearTimeout(timerPict);
      break;
    case 'noPICT':
      noPICT();
      break;
    case 'trackInfos':
      trackInfos(msg.data);
      // vérifie qu'il y a une pochette
      timerPict = window.setTimeout(() => {
        if (!track.artwork.isPresent) {
          socket.send('requestPICT');
          if (debug) console.log(getTheTime(), 'Sending Pict Request');
        }
      }, 10000);
      break;
    case 'position':
      position(msg.data);
      break;
    case 'volume':
      track.volume = msg.data.volume;
      break;
    case 'pause':
      track.timerPause();
      break;
    case 'stop':
      track = null;
      track = new Track();
      track.raz();
      break;
    default:
      if (debug) console.log("You're missing something => ", msg.type);
      break;
  }
};

const PICTmeta = function (data) {
  if (isModal) closeModal();
  track.artwork.dimensions.width = data.dimensions.width;
  track.artwork.dimensions.height = data.dimensions.height;
  if (data.palette.backgroundColor !== 'undefined') {
    track.artwork.palette.backgroundColor = data.palette.backgroundColor;
    track.artwork.palette.primaryColor = data.palette.primaryColor;
    track.artwork.palette.secondaryColor = data.palette.secondaryColor;
    if (data.palette.spanColorContrast) {
      track.artwork.palette.spanColorContrast = true;
    }
    track.updateColors();
  }
};

const PICT = function (data) {
  track.artwork.isPresent = true;
  track.artwork.src = data.url;
  track.artwork.is2x = data.is2x;
  track.updatePICT();
  track.updateColors();
};

const noPICT = function () {
  track.artwork.src = myConfig.defaultArtwork.src;
  track.artwork.is2x = true;
  track.artwork.dimensions.width = myConfig.defaultArtwork.width;
  track.artwork.dimensions.height = myConfig.defaultArtwork.height;
  track.updatePICT();
  track.updateColors();
};

const trackInfos = function (data) {
  if (isModal) closeModal();
  if (track.isRunning) {
    track.timerPause();
    track.removeCaret();
  }
  if (track.album.id !== data.albumId) {
    // fait disparaître la pochette précédente si l'album est différent
    track.artwork.el.classList.add('fading');
    document.documentElement.style.setProperty('--bg-img', '');
  }
  track = new Track();
  track.title.title = data.title;
  track.artist.artist = data.artist;
  track.album.album = data.album;
  track.album.id = data.albumId;
  track.yearAlbum = data.yearAlbum;
  track.durationMs = data.duration;
  track.updateTrackInfos();
};

const position = function (data) {
  track.currPosition = data.currPosition;
  track.durationMs = data.duration;
  track.timerStart();
};

const handleModal = function (e) {
  closeModal();
  e.preventDefault();
}

function displayModal(msg) {
  modalBtn.addEventListener('click', handleModal);
  let m = modalEl.querySelector('.modal-body');
  let h = modalEl.querySelector('.modal-header *:first-child');
  switch (msg) {
    case 'noInfo':
      h.innerHTML = myConfig.strings.modalMsgInfosTitle;
      m.innerHTML = myConfig.strings.modalMsgInfos;
      break;
    case 'connect_error':
      h.innerHTML = myConfig.strings.modalMsgServerTitle;
      m.innerHTML = myConfig.strings.modalMsgServer;
      modalEl.classList.add('modal-warning');
      break;
    case 'offline':
      h.innerHTML = myConfig.strings.modalMsgServerTitle;
      m.innerHTML = myConfig.strings.modalMsgOffline;
      modalEl.classList.add('modal-warning');
      break;
    default:
      m.innerHTML = msg;
      break;
  }
  mainEl.classList.add('showModal');
  modalEl.classList.add('showModal');
  isModal = true;
}

function closeModal() {
  modalBtn.removeEventListener('click', handleModal);
  mainEl.classList.remove('showModal');
  modalEl.classList.remove('showModal');
  if (modalEl.classList.contains('modal-warning')) modalEl.classList.remove('modal-warning');
  isModal = false;
}

function getTheTime() {
  let d = new Date();
  return d.toLocaleTimeString() + ':' + d.getMilliseconds();
}