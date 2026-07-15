const { once } = require('node:events');

module.exports = async function globalSetup() {
  process.env.NODE_ENV = 'test';
  process.env.PORT = '3000';
  const { io, server } = require('../server');
  if (!server.listening) await once(server, 'listening');

  return async () => {
    await new Promise((resolve) => io.close(resolve));
    if (server.listening) {
      await new Promise((resolve) => server.close(() => resolve()));
    }
  };
};
