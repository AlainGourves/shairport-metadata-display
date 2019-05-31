# Shairport-sync Metadata Display

## Installation

[Shairport Sync](https://github.com/mikebrady/shairport-sync), obviously, has to be installed and it must be compiled with the `--with-metadata` option. See Shairport Sync [README](https://github.com/mikebrady/shairport-sync) and [INSTALL](https://github.com/mikebrady/shairport-sync/blob/master/INSTALL.md) for the detailed procedure.

Edit the configuration file (usually `/etc/shairport-sync.conf` but the location could be modified by a build option) to enable metadata :

```json
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

Next, clone or download this repository.

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

## Configuration

