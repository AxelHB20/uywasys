// Proxy del servidor de desarrollo: /api va al backend.
// Corriendo en Windows apunta a localhost; dentro de Docker, docker-compose define API_URL=http://api:3000
export default {
  '/api': {
    target: process.env['API_URL'] ?? 'http://localhost:3000',
    secure: false,
  },
};
