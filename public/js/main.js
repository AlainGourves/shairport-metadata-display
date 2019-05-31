let socket = io()
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

socket.on('connexion', function (msg) {
  console.log('connexion', msg)
})

socket.on('message', function (msg) {
  console.log('message:', msg)
  if (isModal) closeModal()
  if (modalEl.classList.contains('modal-warning')) modalEl.classList.remove('modal-warning')
  if (msg === 'noInfo') {
    track = new Track()
    track.raz()
    displayModal(msg)
  }
})

socket.on('PICTmeta', function (data) {
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
})

socket.on('PICT', function (data) {
  track.artwork.isPresent = true
  track.artwork.src = data.src
  track.updatePICT()
  track.updateColors()
})

socket.on('noPICT', () => {
  track.artwork.src = myConfig.defaultArtwork.src
  track.updatePICT()
  track.updateColors()
})

socket.on('bgImg', function (data) {
  document.documentElement.style.setProperty('--bg-blur', 'url(' + data.src + ')')
})

socket.on('trackInfos', (data) => {
  if (isModal) closeModal()
  if (track !== undefined) {
    track.timerPause()
    track.removeCaret()
  }
  document.documentElement.style.setProperty('--bg-blur','')
  track = new Track()
  track.title.title = data.title
  track.artist.artist = data.artist
  track.album.album = data.album
  track.yearAlbum = data.yearAlbum
  track.durationMs = data.duration
  track.updateTrackInfos()
})

socket.on('position', (data) => {
  track.currPosition = data.currPosition
  track.durationMs = data.duration
  track.timerStart()
})

socket.on('volume', (data) => {
  track.volume = data.volume
})

socket.on('pause', () => {
  track.timerPause()
})

socket.on('stop', () => {
  track = null
  track = new Track()
  track.raz()
})

socket.on('connect_error', function (err) {
  if (!isModal) {
    displayModal('connect_error')
  }
})

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
