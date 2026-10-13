// Video de fondo a pantalla completa para las pantallas de acceso. Sin sonido,
// en bucle y con una capa oscura para que el contenido se lea bien.
export default function LoginBackdrop() {
  return (
    <div className="login-backdrop" aria-hidden="true">
      <video autoPlay muted loop playsInline preload="auto" poster="/login-bg-poster.jpg">
        <source src="/login-bg.mp4" type="video/mp4" />
      </video>
      <div className="login-backdrop-shade" />
    </div>
  )
}
