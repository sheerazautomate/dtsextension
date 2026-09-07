module.exports = {
  apps: [
    {
      name: 'dts-whatsapp-bot',
      script: 'server.js',
      cwd: __dirname,
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      min_uptime: 5000,
      restart_delay: 2000,
      kill_timeout: 8000,
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'dts-tunnel',
      script: 'tunnel.sh',
      cwd: __dirname,
      interpreter: 'bash',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      min_uptime: 5000,
      restart_delay: 2000,
      // cloudflared is a child of tunnel.sh; give the trap time to stop it
      // before pm2 SIGKILLs the process tree.
      kill_timeout: 10000
    }
  ]
};
