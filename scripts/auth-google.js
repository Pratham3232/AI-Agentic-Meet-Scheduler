const { google } = require('googleapis');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: '.env.local' });

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'http://localhost:3000/oauth2callback'
);

const SCOPES = ['https://www.googleapis.com/auth/calendar'];

async function authenticate() {
  return new Promise((resolve, reject) => {
    const authorizeUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent',
    });

    const server = http.createServer(async (req, res) => {
      try {
        if (req.url.indexOf('/oauth2callback') > -1) {
          const qs = new url.URL(req.url, 'http://localhost:3000').searchParams;
          const code = qs.get('code');
          
          res.end('Authentication successful! You can close this window.');
          server.close();

          const { tokens } = await oauth2Client.getToken(code);
          
          console.log('\nRefresh Token:', tokens.refresh_token);
          console.log('\nAdd this to your .env.local file:');
          console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);

          const credentialsDir = path.join(__dirname, '..', '.credentials');
          if (!fs.existsSync(credentialsDir)) {
            fs.mkdirSync(credentialsDir);
          }

          fs.writeFileSync(
            path.join(credentialsDir, 'tokens.json'),
            JSON.stringify(tokens, null, 2)
          );

          resolve(tokens);
        }
      } catch (e) {
        reject(e);
      }
    });

    server.listen(3000, async () => {
      console.log('Opening browser for Google authentication...');
      console.log('\nIf the browser does not open, visit this URL manually:\n');
      console.log(authorizeUrl);
      console.log();
      const { default: open } = await import('open');
      open(authorizeUrl).catch(() => {});
    });
  });
}

authenticate().catch(console.error);
