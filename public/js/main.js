const socket = new WebSocket('ws://192.168.0.14:3600');
let track = new Track()
let timers = []
let isModal = false

let mainEl, modalEl, modalBtn

window.addEventListener("DOMContentLoaded", (event) => {
  mainEl = document.querySelector('main')
  modalEl = document.querySelector('#modalCenter')
  modalBtn = modalEl.querySelector('.modal-header button')
  modalBtn.onclick = () => {
    closeModal()
  }

  // Create an observer instance linked to the callback function
  let observer = new MutationObserver(observerCallback)
  // Start observing the target node for configured mutations
  observer.observe(observerTarget, observerConfig)
})

document.addEventListener('keyup', (event) => {
  if (event.key === 'Escape' && isModal) {
    closeModal()
  }
}, false);

socket.onopen = function (event) {
  console.log('Opening connection...');
}

socket.onclose = function (event) {
  if (event.wasClean) {
    console.log(`Connection closed cleanly, code=${event.code} reason=${event.reason}`);
  } else {
    // e.g. server process killed or network down
    console.log(`Connection died, code=${event.code}`);
  }
}

socket.onerror = function (err) {
  console.error('WebSocket error: ', err.message);
  if (!isModal) {
    displayModal('connect_error')
  }
}

socket.onmessage = function (msg) {
  msg = JSON.parse(msg.data);
  console.log(msg)
  if (isModal) closeModal()
  if (modalEl.classList.contains('modal-warning')) modalEl.classList.remove('modal-warning')
  switch (msg.type) {
    case 'noInfo':
      track = new Track()
      track.raz()
      displayModal('noInfo')
      break;

    case 'PICTmeta':
      PICTmeta(msg.data)
      break

    case 'PICT':
      PICT(msg.data)
      break

    case 'noPICT':
      noPICT()
      break

    case 'bgImg':
      bgImg(msg.data)
      break

    case 'trackInfos':
      trackInfos(msg.data)
      break

    case 'position':
      position(msg.data)
      break

    case 'volume':
      volume(msg.data)
      break

    case 'pause':
      track.timerPause()
      break

    case 'stop':
      track = null
      track = new Track()
      track.raz()
      break

    default:
      console.log("Manque un case => ", msg.type)
      break;
  }
}

const PICTmeta = function (data) {
  if (isModal) closeModal()
  track.artwork.dimensions.width = data.dimensions.width
  track.artwork.dimensions.height = data.dimensions.height
  if (data.palette.backgroundColor !== 'undefined') {
    track.artwork.palette.backgroundColor = data.palette.backgroundColor
    track.artwork.palette.color = data.palette.color
    track.artwork.palette.alternativeColor = data.palette.alternativeColor
    if (data.palette.spanColorContrast) {
      track.artwork.palette.spanColorContrast = true
    }
    track.updateColors()
  }
}

const PICT = function (data) {
  track.artwork.isPresent = true
  track.artwork.src = data.src
  track.updatePICT()
  track.updateColors()
}

const noPICT = function () {
  track.artwork.src = myConfig.defaultArtwork.src
  track.updatePICT()
  track.updateColors()
}

const bgImg = function (data) {
  document.documentElement.style.setProperty('--bg-blur', `url(${data.src})`)
}

const trackInfos = function (data) {
  if (isModal) closeModal()
  if (track !== undefined) {
    track.timerPause()
    track.removeCaret()
  }
  document.documentElement.style.setProperty('--bg-blur', '')
  track = new Track()
  track.title.title = data.title
  track.artist.artist = data.artist
  track.album.album = data.album
  track.yearAlbum = data.yearAlbum
  track.durationMs = data.duration
  track.updateTrackInfos()
}

const position = function (data) {
  track.currPosition = data.currPosition
  track.durationMs = data.duration
  track.timerStart()
}

const volume = function (data) {
  track.volume = data.volume
}

// Select the node that will be observed for mutations
let observerTarget = track.title.el

// Options for the observer (which mutations to observe)
let observerConfig = {
  childList: true
}

// Callback function to execute when mutations are observed
let observerCallback = function (mutationsList, observer) {
  for (let mutation of mutationsList) {
    if (mutation.type == 'childList') {
      // demande au serveur d'envoyer la pochette si elle existe
      let timeOutID = window.setTimeout(() => {
        if (track.title.title !== '' && !track.artwork.isPresent) {
          socket.emit('requestPICT')
        }
      }, 5000)
      window.clearTimeout(timeOutID)
    }
  }
};

function displayModal(msg) {
  let m = modalEl.querySelector('.modal-body')
  let h = modalEl.querySelector('.modal-header h5')
  if (msg === 'noInfo') {
    h.innerHTML = myConfig.strings.modalMsgInfosTitle
    m.innerHTML = myConfig.strings.modalMsgInfos
  } else if (msg === 'connect_error') {
    h.innerHTML = myConfig.strings.modalMsgServerTitle
    m.innerHTML = myConfig.strings.modalMsgServer
    modalEl.classList.add('modal-warning')
  } else {
    m.innerHTML = msg
  }
  mainEl.classList.add('showModal')
  modalEl.classList.add('showModal')
  isModal = true
}

function closeModal() {
  mainEl.classList.remove('showModal')
  modalEl.classList.remove('showModal')
  if (modalEl.classList.contains('modal-warning')) modalEl.classList.remove('modal-warning')
  isModal = false
}
