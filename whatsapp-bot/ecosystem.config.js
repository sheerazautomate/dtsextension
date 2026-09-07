module.exports = {
  apps: [
    {
      name: 'dts-whatsapp-bot',
      script: 'server.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'dts-tunnel',
      script: 'tunnel.sh',
      cwd: __dirname,
      interpreter: 'bash'
    }
  ]
};
