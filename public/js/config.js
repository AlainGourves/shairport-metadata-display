export const myConfig = {
  server: {
    url: 'mypi.local',
    port: 3600
  },
  defaultArtwork: {
    src: 'assets/iTunes.png',
    width: 1024,
    height: 1024
  },
  defaultPalette : {
    backgroundColor: 'hsl(227, 23%, 85%)',
    primaryColor: 'hsl(216, 92%, 50%)',
    secondaryColor: 'hsl(330, 82%, 40%)'
  },
  strings: {
    modalMsgInfosTitle: "Info",
    modalMsgInfos: "La connexion est établie avec le serveur, en attente d'informations...<br>(Attendre le morceau suivant ou faire \"Pause\" puis \"Play\")",
    modalMsgServerTitle: "Alerte",
    modalMsgServer: "Pas de connexion avec le serveur.<br>Peut-être est-il dans les choux ?",
    modalMsgOffline: "Pas de connexion à internet ! Vérifiez cela, et rechargez la page ensuite."
  },
  defaultPageTitle: "Shairport-sync Metadata Display"
}
