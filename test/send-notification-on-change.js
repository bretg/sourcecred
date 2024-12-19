const fs = require('fs');
const path = require('path');
const axios = require('axios');
const nodemailer = require('nodemailer');

async function getAccessToken(clientId, clientSecret, refreshToken) {
  try {
    const response = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });
    console.log("got access_token");
    return response.data.access_token;
  } catch (error) {
    console.error('Failed to fetch access token:', error.response?.data || error.message);
    process.exit(1);
  }
}

(async () => {
  const configFilePath = path.join(__dirname, 'codepath-notification');
  const repo = process.env.GITHUB_REPOSITORY;
  const prNumber = process.env.GITHUB_PR_NUMBER;
  const token = process.env.GITHUB_TOKEN;

  // Generate OAuth2 access token
  const CLIENT_ID = process.env.OAUTH2_CLIENT_ID;
  const CLIENT_SECRET = process.env.OAUTH2_CLIENT_SECRET;
  const REFRESH_TOKEN = process.env.OAUTH2_REFRESH_TOKEN;

  if (!repo || !prNumber || !token || !CLIENT_ID || !CLIENT_SECRET | !REFRESH_TOKEN) {
    console.error('Missing required environment variables.');
    process.exit(1);
  }

  try {
    // Read and process the configuration file
    const configFileContent = fs.readFileSync(configFilePath, 'utf-8');
    const configRules = configFileContent
      .split('\n')
      .filter(line => line.trim() !== '') // Filter out empty lines
      .map(line => {
        const [regex, email] = line.split(':').map(part => part.trim());
        return { regex: new RegExp(regex), email };
      });

    console.log('Loaded configuration rules:', configRules);

    // Fetch changed files
    const [owner, repoName] = repo.split('/');
    const apiUrl = `https://api.github.com/repos/${owner}/${repoName}/pulls/${prNumber}/files`;

    const response = await axios.get(apiUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    const changedFiles = response.data.map(file => file.filename);
    console.log('Changed files:', changedFiles);

    // Group matched files by email address
    const matchesByEmail = {};
    changedFiles.forEach(file => {
      configRules.forEach(rule => {
        if (rule.regex.test(file)) {
          if (!matchesByEmail[rule.email]) {
            matchesByEmail[rule.email] = [];
          }
          matchesByEmail[rule.email].push(file);
        }
      });
    });

    console.log('Grouped matches by email:', matchesByEmail);

    const accessToken = await getAccessToken(CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN);

    console.log("got accessToken: " + accessToken);

    // Configure Nodemailer with OAuth2
    const transporter = nodemailer.createTransport({
      service: 'Gmail',
      auth: {
        type: 'OAuth2',
        user: 'info@prebid.org',
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        accessToken: accessToken
      },
    });

    // Send one email per recipient
    for (const [email, files] of Object.entries(matchesByEmail)) {
      const emailBody = `
        <h1>Files Changed in PR #${prNumber}</h1>
        <ul>
          ${files.map(file => `<li>${file}</li>`).join('')}
        </ul>
      `;

console.log("trying to send email to " + email);

      try {
        await transporter.sendMail({
          from: `"GitHub Bot" <info@prebid.org>`,
          to: email,
          subject: `Files Changed in PR #${prNumber}`,
          html: emailBody,
        });

        console.log(`Email sent successfully to ${email}`);
        console.log(`${emailBody}`);
      } catch (error) {
        console.error(`Failed to send email to ${email}:`, error.message);
      }
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
})();

