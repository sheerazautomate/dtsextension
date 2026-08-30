const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');

async function listGroups() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  const sock = makeWASocket({ auth: state });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    if (update.connection === 'open') {
      console.log('Connected. Fetching groups...\n');
      const groups = await sock.groupFetchAllParticipating();
      for (const id in groups) {
        console.log(`${groups[id].subject}  →  ${id}`);
      }
      process.exit(0);
    }
  });
}

listGroups();
