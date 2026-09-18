Discord Auth & Verification Bot 🚀
A robust, lightweight Discord bot designed to manage user authentication, verification, and license/key validation using Node.js, Discord.js, and an SQLite database.
---
🌟 Features
🔐 Secure Verification System: Easily verify members on your Discord server.
🔑 License & Key Management: Track and validate keys using unique identifier (UUID) generation.
🗄️ SQLite Integration: Embedded persistent storage (`novex.db`) for tracking user data and authorizations.
⚙️ Configurable Settings: Easily customize bot parameters via a centralized `config.json` file.
🛠️ Slash Commands: Built using modern `@discordjs/builders` for a seamless Discord UI experience.
---
📂 Repository Structure
```text
.
├── authj/
│   ├── bot.js         # Main Discord bot application logic
│   └── assets/        # Visual assets and images
├── config.json        # Bot configuration (Token, IDs, settings)
├── novex.db           # SQLite database for storing persistent data
├── package.json       # Project dependencies and scripts
└── .gitignore         # Ignores sensitive files (config, database, logs)
```
---
🚀 Getting Started
Prerequisites
Make sure you have the following installed on your machine:
Node.js (v16.x or higher recommended)
npm (comes with Node.js)
Installation
Clone the repository:
```bash
   git clone https://github.com/alpbabaz/your-repo-name.git
   cd your-repo-name
   ```
Install dependencies:
```bash
   npm install
   ```
Configure the bot:
Create or edit the `config.json` file in the root directory and add your credentials:
```json
   {
     "token": "YOUR_DISCORD_BOT_TOKEN",
     "clientId": "YOUR_CLIENT_ID",
     "guildId": "YOUR_GUILD_ID"
   }
   ```
Run the bot:
```bash
   node authj/bot.js
   ```
---
🛡️ Security & Privacy Notice
> ⚠️ **Important:** Never commit your `config.json` file containing sensitive bot tokens, or your `novex.db` database containing user records to a public GitHub repository. 
This repository includes a pre-configured `.gitignore` file to automatically ignore sensitive files:
`config.json`
`novex.db`
`node_modules/`
`*.log`
---
🤝 Contributing
Contributions, issues, and feature requests are welcome!  
Feel free to check out the issues page.
---
📜 License
This project is open-source and available under the MIT License.
