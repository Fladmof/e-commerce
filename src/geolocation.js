export function getCurrentCoordinates({
  geolocation = globalThis.navigator?.geolocation,
  isSecureContext = globalThis.isSecureContext
} = {}) {
  return new Promise((resolve, reject) => {
    if (isSecureContext === false) {
      reject(new Error('A localização só funciona num endereço HTTPS ou em localhost.'))
      return
    }
    if (!geolocation) {
      reject(new Error('Este navegador não disponibiliza localização. Abre a loja em HTTPS e verifica as permissões do navegador.'))
      return
    }

    geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude }),
      (error) => {
        const messages = {
          1: 'A permissão de localização foi recusada. Permite a localização nas definições do site e do dispositivo e tenta novamente.',
          2: 'O dispositivo não conseguiu determinar a localização. Ativa os serviços de localização e tenta novamente.',
          3: 'A localização demorou demasiado. Verifica a ligação e as permissões e tenta novamente.'
        }
        reject(new Error(messages[error.code] || 'Não foi possível obter a localização atual. Verifica as permissões e tenta novamente.'))
      },
      { enableHighAccuracy: false, timeout: 30000, maximumAge: 30000 }
    )
  })
}
