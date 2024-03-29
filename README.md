# Shairport Sync Metadata Display

![Screen capture](https://raw.githubusercontent.com/AlainGourves/shairport-metadata-display/main/screen.jpg)

Displays available informations about the currently played track :

- Track's title,
- Artist's name,
- Album title (and year of release),
- Album's cover art,
- Elapsed and remaining time.

__*N.B.* The app only displays metadata, (for the time being) it doesn't control AirPlay source !__

## How does it work ?

### Principle

[Shairport Sync](https://github.com/mikebrady/shairport-sync) routes the metadata broadcasted by AirPlay and those that it manages iself (eg. cover art and progress) to an XML-style format pipe.

[Shairport-sync-reader](https://github.com/roblan/shairport-sync-reader) reads and decodes this pipe and emits events accordingly.

This web app listens to the relevant events, processes them if needed and sends data to listening clients through [WebSocket](https://github.com/websockets/ws). Client's side, the page catches messages to update itself.

### Cover Art

When present, the album's artwork is displayed. Server's side, the image is analyzed to extract a palette of dominant colors (thanks to [`gm`](https://github.com/aheckmann/gm) and [`imagecolors`](https://github.com/tobius/imagecolors)). If needed for better legibility, these colors are slightly altered to seek at least WCAG AA level contrast ratio against the chosen background color.

~~The album's artwork is also processed to generate the background image of the page (Note that depending on the size of the original image and the available horsepower, it may take several seconds to appear).~~

As the graphic processing of album covers can be quite intensive (especially on a  old Raspberry Pi), a cache system is set up: for each album, a copy with a maximum width of 512 pixels is saved (it is internally used to extract the color palette)~~, a second file stores the background image.~~

The number of cached images is fixed by the constant `MAX_FILES_CACHED` defined in `/.env`.

## Installation

### Shairport Sync

[Shairport Sync](https://github.com/mikebrady/shairport-sync), obviously, has to be installed and it must be compiled with the `--with-metadata` option. See Shairport Sync [README](https://github.com/mikebrady/shairport-sync) and [INSTALL](https://github.com/mikebrady/shairport-sync/blob/master/INSTALL.md) for the detailed procedure.

Edit the configuration file (usually `/etc/shairport-sync.conf` but the location could be modified by a build option) to enable metadata and include cover art. You just have to uncomment these lines :

```
metadata =
{
        enabled = "yes"; // set this to yes to get Shairport Sync to solicit metadata from the source and to pass it on via a pipe
        include_cover_art = "yes"; // set to "yes" to get Shairport Sync to solicit cover art from the source and pass it via the pipe. You must also set "enabled" to "yes".
        pipe_name = "/tmp/shairport-sync-metadata";
//      pipe_timeout = 5000; // wait for this number of milliseconds for a blocked pipe to unblock before giving up
//      socket_address = "226.0.0.1"; // if set to a host name or IP address, UDP packets containing metadata will be sent to this address. May be a multicast address. "socket-port" must be non-zero and "enabled" must be set to yes"
//      socket_port = 5555; // if socket_address is set, the port to send UDP packets to
//      socket_msglength = 65000; // the maximum packet size for any UDP metadata. This will be clipped to be between 500 or 65000. The default is 500.
};
```

Next, clone or download the current repository.

Install all the required packages with :

```bash
npm install
```

Finally, run

```bash
node app.js
```

or

```bash
npm start
```

### ImageMagick

Graphic processing relies on [`gm`](https://github.com/aheckmann/gm) and [`imagecolors`](https://github.com/tobius/imagecolors), but for them to work [`ImageMagick`](https://imagemagick.org/) must be previously installed. So :

```bash
sudo apt install imagemagick
```
__Note__ : [`gm`](https://github.com/aheckmann/gm) works with either [`ImageMagick`](https://imagemagick.org/) or [`GraphicsMagick`](http://www.graphicsmagick.org/), but [`imagecolors`](https://github.com/tobius/imagecolors) only depends on [`ImageMagick`](https://imagemagick.org/).

### `systemd` Service

With a `systemd` service, one can restart the server after a crash or a reboot.

Edit the `shairport-display.service` file to adapt the `WorkingDirectory` path to your situation. You should also have to modify the path to `npm` (it has to correspond to the value returned by the bash command `which npm`).

Then copy the file to the Raspberry Pi's service definitions directory :

```bash
sudo cp shairport-display.service /etc/systemd/system
```

Finally, enabling and starting the service :

```bash
sudo systemctl enable shairport-display.service
sudo systemctl start shairport-display.service
```

To stop the service :

```bash
sudo systemctl stop shairport-display.service
```

To check the logs :

```bash
journalctl -u shairport-display.service
```

## Configuration

### Server's side

There's an `.env` file with :

- `PORT`: port number for the web server,
- `FIFO`: location of the metadata pipe generated by Shairport Sync.

### Client's side

- `public/js/config.js`: here you can edit :
  - Server's port number,
  - Texts of the modal dialogs,
  - Default values : page title, image and colors used when idle or no available cover art.
- `public/css/main.css`: it's mainly there that the "magic" happens, sky is the limit for customization !
