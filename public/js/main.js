const url = 'ws://' + window.location.host;
let track = new Track();
let timers = [];
let isModal = false;

let socket, mainEl, modalEl, modalBtn;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function getTheTime(){
  let d = new Date();
  return  d.toLocaleTimeString() + ':' + d.getMilliseconds();
}


window.addEventListener('load', (event) => {
  mainEl = document.querySelector('main');
  modalEl = document.querySelector('.modal');
  modalBtn = modalEl.querySelector('.modal-header .btn');

  socket = newWebSocket();
});

document.addEventListener('keyup', (event) => {
  if (event.key === 'Escape' && isModal) {
    closeModal();
  }
}, false);

function newWebSocket(){
  console.log(getTheTime(), "tentative de connexion")
  let ws = new WebSocket(url);

  ws.onopen = function (event) {
    onOpen(event);
  }
  ws.onclose = function (event) {
    onClose(event);
  }
  ws.onerror = function (err) {
    onError(err);
  }
  ws.onmessage = function (msg) {
    onMessage(msg)
  }
  return ws;
}

function onOpen(event) {
  console.log(getTheTime(), 'Opening connection...');
};

function onClose(event) {
  if (event.wasClean) {
    console.log(getTheTime(), `Connection closed cleanly, code=${event.code} reason=${event.reason}`);
  } else {
    // e.g. server process killed or network down
    console.log(`getTheTime(), Connection died, code=${event.code}`);
    if (!navigator.onLine){
      console.log(getTheTime(), "You're offline !")
    }else{
      let timeout = 250; // tentatives de reconnexion de plus en plus espacées
      console.log('Timeout: ', timeout);
      setTimeout (newWebSocket, Math.min(10000,timeout+=timeout));
    }
  }
};

function onError(err) {
  console.error(getTheTime(), 'WebSocket error: ', err.message);
  // attend 1s avant d'essayer de se reconnecter
  // si ça ne marche pas, affiche dialogue
  wait(1000)
    .then(()=>newWebSocket())
    .catch(()=>{
      if (!isModal) {
        displayModal('connect_error');
      }
    });
};

function onMessage(msg) {
  msg = JSON.parse(msg.data);
  if (isModal) {
    closeModal();
    if (modalEl.classList.contains('modal-warning')) modalEl.classList.remove('modal-warning');
  }
  console.log(msg);
  switch (msg.type) {
    case 'welcome':
      console.log(getTheTime(), "Welcome new client.");
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
      break;
    case 'noPICT':
      noPICT();
      break;
    case 'bgImg':
      bgImg(msg.data);
      break;
    case 'trackInfos':
      trackInfos(msg.data);
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
      console.log("You're missing something => ", msg.type);
      break;
  }
};

const PICTmeta = function (data) {
  if (isModal) closeModal();
  track.artwork.dimensions.width = data.dimensions.width;
  track.artwork.dimensions.height = data.dimensions.height;
  if (data.palette.backgroundColor !== 'undefined') {
    track.artwork.palette.backgroundColor = data.palette.backgroundColor;
    track.artwork.palette.color = data.palette.color;
    track.artwork.palette.alternativeColor = data.palette.alternativeColor;
    if (data.palette.spanColorContrast) {
      track.artwork.palette.spanColorContrast = true;
    }
    track.updateColors();
  }
};

const PICT = function (data) {
  track.artwork.isPresent = true;
  track.artwork.src = data.src;
  track.updatePICT();
  track.updateColors();
};

const noPICT = function () {
  track.artwork.isPresent = false;
  track.artwork.src = myConfig.defaultArtwork.src;
  track.artwork.dimensions.width = myConfig.defaultArtwork.width;
  track.artwork.dimensions.height = myConfig.defaultArtwork.height;
  track.updatePICT();
  track.updateColors();
};

const bgImg = function (data) {
  document.documentElement.style.setProperty('--bg-blur', `url(${data.src})`);
};

const trackInfos = function (data) {
  if (isModal) closeModal();
  if (track !== undefined) {
    track.timerPause();
    track.removeCaret();
  }
  document.documentElement.style.setProperty('--bg-blur', '');
  track = new Track();
  track.title.title = data.title;
  track.artist.artist = data.artist;
  track.album.album = data.album;
  track.yearAlbum = data.yearAlbum;
  track.durationMs = data.duration;
  track.updateTrackInfos();
};

const position = function (data) {
  track.currPosition = data.currPosition;
  track.durationMs = data.duration;
  track.timerStart();
};

const handleModal = function(e){
  closeModal();
  e.preventDefault();
}

function displayModal(msg) {
  modalBtn.addEventListener('click', handleModal);
  let m = modalEl.querySelector('.modal-body');
  let h = modalEl.querySelector('.modal-header *:first-child');
  if (msg === 'noInfo') {
    h.innerHTML = myConfig.strings.modalMsgInfosTitle;
    m.innerHTML = myConfig.strings.modalMsgInfos;
  } else if (msg === 'connect_error') {
    h.innerHTML = myConfig.strings.modalMsgServerTitle;
    m.innerHTML = myConfig.strings.modalMsgServer;
    modalEl.classList.add('modal-warning');
  } else {
    m.innerHTML = msg;
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
