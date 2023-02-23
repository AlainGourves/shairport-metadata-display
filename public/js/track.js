import { myConfig } from "./config.js";
export default class Track {
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
      'el': document.getElementById('album'),
      'id': ''
    }
    this.yearAlbum = ''
    this.durationMs = 0
    this.volume = 0
    this.artwork = {
      isPresent: false,
      is2x: true, // savoir s'il y a une image retina (true par défaut)
      src: myConfig.defaultArtwork.src,
      el: document.querySelector('#artwork').firstElementChild,
      dimensions: {
        height: myConfig.defaultArtwork.width,
        width: myConfig.defaultArtwork.height
      },
      palette: {
        backgroundColor: '',
        primaryColor: '',
        secondaryColor: '',
        spanColorContrast: false,
        default: {
          backgroundColor: myConfig.defaultPalette.backgroundColor,
          primaryColor: myConfig.defaultPalette.primaryColor,
          secondaryColor: myConfig.defaultPalette.secondaryColor
        }
      }
    }
    this.isRunning = false;
    this.timers = [];
    this.currPosition = 0;
    this.runTimer = 0;
    this.timeStart = 0;
    this.player = document.querySelector('#player');
    this.timerEl = player.querySelector('#current');
    this.totalEl = player.querySelector('#total');
    this.timeLine = player.querySelector('#timeLine');
    this.timeLine.querySelector('#elapsed').style.width = 0;
    this.caret = this.timeLine.querySelector('svg');
    this.caret.w = parseInt(window.getComputedStyle(this.caret).width);
  }

  updateTrackInfos() {
    this.artist.el.textContent = this.artist.artist;
    this.title.el.innerHTML = this.title.title;
    this.album.el.innerHTML = this.album.album;
    if (this.yearAlbum !== '' && this.yearAlbum !== 0 && this.yearAlbum !== undefined) {
      this.album.el.innerHTML += ` <span>${this.yearAlbum}</span>`;
    }
    if (this.title.title !== '') {
      document.body.classList.remove('idle');
      document.body.classList.add('playing');
      document.title = `${this.artist.artist}, "${this.title.title}"`;
      return;
    }
    document.title = myConfig.defaultPageTitle;
  }

  updateColors() {
    if (this.artwork.isPresent) {
      if (window.getComputedStyle(document.documentElement).getPropertyValue("--bg-artwork") !== this.artwork.palette.backgroundColor) {
        document.documentElement.style.setProperty('--bg-artwork', this.artwork.palette.backgroundColor);
        document.documentElement.style.setProperty('--title-col', this.artwork.palette.primaryColor);
        document.documentElement.style.setProperty('--artist-col', this.artwork.palette.secondaryColor);
        let span = this.album.el.querySelector('span');
        if (span && this.artwork.palette.spanColorContrast) {
          span.classList.add('contrasted');
        } else {
          if (span) {
            span.classList.remove('contrasted');
          }
        }
      }
      return;
    }
    // Default
    document.body.classList.remove('playing');
    document.body.classList.add('idle');
    document.documentElement.style.setProperty('--bg-artwork', this.artwork.palette.default.backgroundColor);
    document.documentElement.style.setProperty('--title-col', this.artwork.palette.default.primaryColor);
    document.documentElement.style.setProperty('--artist-col', this.artwork.palette.default.secondaryColor);
  };


  updatePICT() {
    if (this.artwork.el.classList.contains('fading')) {
      this.artwork.el.classList.remove('fading');
    }
    const retina = this.get2xUrl(this.artwork.src);
    if (this.artwork.is2x) {
      this.artwork.el.srcset = `${this.artwork.src}, ${retina} 2x`;
      this.artwork.el.src = retina;
    }else{
      this.artwork.el.srcset = this.artwork.src;
      this.artwork.el.src = this.artwork.src;
    }
    document.documentElement.style.setProperty('--bg-img', (this.artwork.is2x) ? `url(/${retina})` : `url(/${this.artwork.src})`);
    document.body.classList.remove('idle');
    document.body.classList.add('playing');
  }

  raz() {
    this.timerPause();
    this.player.style.transform = 'rotateX(90deg)';
    this.player.style.opacity = 0;
    document.body.classList.remove('playing');
    document.body.classList.add('idle');
    document.documentElement.style.setProperty('--bg-blured', '');
    this.timeLine.querySelector('#elapsed').style.width = 0;
    this.removeCaret();
    this.timerEl.textContent = '';
    this.totalEl.textContent = '';
    this.updateTrackInfos();
    this.updatePICT();
    this.updateColors();
  }

  removeCaret() {
    if (window.getComputedStyle(this.caret).display === 'block') {
      this.caret.style.display = 'none';
      this.caret.style.left = 0;
    }
  }

  timerStart() {
    if (!this.isRunning) {
      this.removeTimers();
      this.isRunning = true;
      this.timeStart = Date.now() - this.currPosition;
      this.runTimer = setInterval(this.ticTac.bind(this), 500);
      this.timers.push(this.runTimer);
      this.player.style.opacity = 1;
      this.player.style.transform = 'rotateX(0deg)';
      this.totalEl.textContent = this.displayDuration(this.durationMs);
      this.caret.style.display = 'block';
    }
  }

  timerPause() {
    if (this.isRunning) {
      this.removeTimers();
      this.isRunning = false;
    }
  }

  ticTac() {
    if (this.currPosition < this.durationMs) {
      this.currPosition = Date.now() - this.timeStart;
      this.timerEl.textContent = this.displayDuration(this.currPosition);
    } else {
      this.timerPause();
    }
    if (window.getComputedStyle(this.caret).display === 'block') {
      let divWidth = parseFloat(window.getComputedStyle(this.timeLine).width);
      let posX = this.scale(this.currPosition, 0, this.durationMs, 0, divWidth);
      const w = this.caret.w / 2;
      if (posX - w > 0) {
        this.caret.style.left = `${posX - w}px`;
        this.timeLine.querySelector('#elapsed').style.width = `${posX}px`;
      } else {
        this.caret.style.left = 0;
        this.timeLine.querySelector('#elapsed').style.width = 0;
      }
    }
  }

  removeTimers() {
    while (this.timers.length > 0) {
      window.clearInterval(this.timers.pop());
    }
  }

  displayDuration(t) {
    // milliseconds to seconds
    t = Math.floor(t / 1000);
    let arr = [];
    let str = '';
    // hours
    let a = Math.floor(t / 3600);
    if (a > 0) {
      arr.push(a);
      t = t % 3600;
    }
    // minutes
    a = Math.floor(t / 60);
    if (a > 0) {
      arr.push(a);
      // seconds
      t = t % 60;
    }
    arr.push(t);
    while (arr.length > 0) {
      if (str !== '') str = `:${str}`;
      str = arr.pop().toString().padStart(2, '0') + str;
    }
    if (str.substring(0, 1) === 0 && str.length > 3) str = str.slice(1);
    if (str.length === 2) str = `0:${str}`;
    return str;
  }

  scale(x, inMin, inMax, outMin, outMax) {
    return (x - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;
  }

  get2xUrl(url) {
    // Construit l'URL pour les images Retina
    const found = url.match(/^(.*?)\.([a-z]+)$/);
    if (!found) return;
    return `${found[1]}-2x.${found[2]}`;
  }
}