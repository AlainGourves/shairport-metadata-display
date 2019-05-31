class Track {
  constructor() {
    this.title = {
      'title': '',
      'el': document.getElementById('title')
    }
    this.artist = {
      'artist': '',
      'el': document.getElementById('artist')
    }
    this.album = {
      'album': '',
      'el': document.getElementById('album')
    }
    this.yearAlbum = ''
    this.durationMs = 0
    this.volume = 0
    this.artwork = {
      isPresent: false,
      src: myConfig.defaultArtwork.src,
      el: document.querySelector('#artwork img'),
      dimensions: {
        height: myConfig.defaultArtwork.width,
        width: myConfig.defaultArtwork.height
      },
      palette: {
        backgroundColor: '',
        color: '',
        alternativeColor: '',
        spanColorContrast: false,
        default : {
          backgroundColor: myConfig.defaultPalette.backgroundColor,
          color: myConfig.defaultPalette.color,
          alternativeColor: myConfig.defaultPalette.alternativeColor
        }
      }
    }
    this.isRunning = false
    this.currPosition = 0
    this.runTimer = 0
    this.timeStart = 0
    this.timerEl = document.querySelector('#player #current')
    this.totalEl = document.querySelector('#player #total')
    this.timeLine = document.querySelector('#timeLine')
    this.caret = document.createElement('img')
    this.caret.src = 'img/caret.png'
  }

  updateTrackInfos() {
    this.artist.el.textContent = this.artist.artist
    this.title.el.textContent = this.title.title
    this.album.el.innerHTML = this.album.album
    if (this.yearAlbum !== '' && this.yearAlbum !== 0 && this.yearAlbum !== undefined) {
      this.album.el.innerHTML += ' <span>' + this.yearAlbum + '</span>'
    }
    if (this.title.title !== '') {
      document.querySelector('html').classList.add('playing')
    }
  }

  updateColors() {
    if (this.artwork.isPresent) {
      if (window.getComputedStyle(document.documentElement).getPropertyValue("--bg-artwork") !== this.artwork.palette.backgroundColor) {
        document.documentElement.style.setProperty('--bg-artwork', this.artwork.palette.backgroundColor)
        document.documentElement.style.setProperty('--title-col', this.artwork.palette.color)
        document.documentElement.style.setProperty('--artist-col', this.artwork.palette.alternativeColor)
        let span = this.album.el.querySelector('span')
        if (this.artwork.palette.spanColorContrast) {
          span.classList.add('contrasted')
        } else {
          if (span) {
            span.classList.remove('contrasted')
          }
        }
      }
    } else {
      document.documentElement.style.setProperty('--bg-artwork', this.artwork.palette.default.backgroundColor)
      document.documentElement.style.setProperty('--title-col', this.artwork.palette.default.color)
      document.documentElement.style.setProperty('--artist-col', this.artwork.palette.default.alternativeColor)     
    }
  }

  updatePICT() {
    this.artwork.el.src = this.artwork.src
  }

  raz() {
    this.timerPause()
    document.querySelector('#player').style.height = 0
    document.documentElement.classList.remove('playing')
    document.documentElement.style.setProperty('--bg-blur','')
    this.timeLine.querySelector('#elapsed').style.width = 0
    this.removeCaret()
    this.timerEl.textContent = ''
    this.totalEl.textContent = ''
    this.updateTrackInfos()
    this.updatePICT()
    this.updateColors()
  }

  removeCaret() {
    let i = this.timeLine.querySelector('img')
    if (this.timeLine.contains(i)) {
      this.timeLine.removeChild(i)
    }
  }

  timerStart() {
    if (!this.isRunning) {
      this.removeTimers()
      this.isRunning = true
      this.timeStart = Date.now() - this.currPosition
      let _this = this
      this.runTimer = setInterval(this.ticTac.bind(this), 500)
      timers.push(this.runTimer)
      document.querySelector('#player').style.height = '22px'
      this.totalEl.textContent = this.displayDuration(this.durationMs)
      this.removeCaret()
      this.timeLine.appendChild(this.caret)
    }
  }

  timerPause() {
    if (this.isRunning) {
      this.removeTimers()
      this.isRunning = false
    }
  }

  ticTac() {
    if (this.currPosition < this.durationMs) {
      this.currPosition = Date.now() - this.timeStart
      this.timerEl.textContent = this.displayDuration(this.currPosition)
    } else {
      this.timerPause()
    }
    if (this.timeLine.contains(this.caret)) {
      let w = parseInt(this.caret.width)
      let divWidth = parseFloat(window.getComputedStyle(this.timeLine).width)
      let posX = this.map(this.currPosition, 0, this.durationMs, 0, divWidth)
      this.caret.style.left = (posX - w / 2) + 'px'
      this.timeLine.querySelector('#elapsed').style.width = (posX - w / 2) + 'px'
    }
  }

  removeTimers() {
    while (timers.length > 0) {
      window.clearInterval(timers.pop())
    }
  }

  displayDuration(t) {
    // milliseconds to seconds
    t = Math.floor(t / 1000)
    let arr = []
    let str = ''
    // hours
    let a = Math.floor(t / 3600)
    if (a > 0) {
      arr.push(a)
      t = t % 3600
    }
    // minutes
    a = Math.floor(t / 60)
    if (a > 0) {
      arr.push(a)
      // seconds
      t = t % 60
    }
    arr.push(t)
    while (arr.length > 0) {
      if (str !== '') str = ':' + str
      str = arr.pop().toString().padStart(2, '0') + str
    }
    if (str.substr(0, 1) == 0 && str.length > 3) str = str.slice(1)
    if (str.length === 2) str = '0:' + str
    return str
  }

  map(x, inMin, inMax, outMin, outMax) {
    return (x - inMin) * (outMax - outMin) / (inMax - inMin) + outMin
  }
}
