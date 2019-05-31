module.exports = class Track {
    constructor() {
        this.title = ''
        this.artist = ''
        this.album  = ''
        this.yearAlbum = ''
        this.duration = 0
        this.currPosition = 0
        this.volume = 0
        this.artwork  = {
            isPresent: false,
            format: '',
            dimensions: {
                height: 0,
                width: 0
            },
            palette: {
                backgroundColor: '',
                backgroundLuminance: 0,
                color: '',
                alternativeColor: '',
                spanColorContrast: false
            }
        }
    }

}