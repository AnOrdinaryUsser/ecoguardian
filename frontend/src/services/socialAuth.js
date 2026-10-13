// Carga bajo demanda de los SDK de Google y Apple y devuelve la credencial que
// el backend verifica. Los ids de cliente llegan de /api/auth/providers.

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve()
    const el = document.createElement('script')
    el.src = src
    el.async = true
    el.onload = () => resolve()
    el.onerror = () => reject(new Error('No se pudo cargar el servicio de inicio de sesion.'))
    document.head.appendChild(el)
  })
}

// Devuelve un access token de Google (ventana emergente).
export async function googleCredential(clientId) {
  await loadScript('https://accounts.google.com/gsi/client')
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'openid email profile',
      callback: (response) => (response.access_token ? resolve(response.access_token) : reject(new Error(response.error || 'cancelled'))),
      error_callback: (error) => reject(new Error(error?.type || 'cancelled')),
    })
    client.requestAccessToken()
  })
}

// Devuelve el id_token de Apple (ventana emergente).
export async function appleCredential({ clientId, redirectUri }) {
  await loadScript('https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js')
  window.AppleID.auth.init({ clientId, scope: 'name email', redirectURI: redirectUri, usePopup: true })
  const result = await window.AppleID.auth.signIn()
  return result.authorization.id_token
}
