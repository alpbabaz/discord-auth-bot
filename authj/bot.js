const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const config = require('./config.json');
const TOKEN = config.discord_token;
const ADMIN_IDS = config.admin_ids;

const db = new Database(path.join(__dirname, 'novex.db'));
db.pragma('journal_mode = WAL');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ]
});

function generateKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let key = 'NX-';
  for (let i = 0; i < 20; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return key;
}

function logSystem(level, message) {
  try {
    db.prepare('INSERT INTO system_logs (level, message) VALUES (?, ?)').run(level, message);
  } catch {}
}

// ==================== SLASH COMMANDS ====================
const commands = [
  new SlashCommandBuilder()
    .setName('key')
    .setDescription('Size 30 dakika gecerli bir auth keyi olusturur'),

  new SlashCommandBuilder()
    .setName('wlekle')
    .setDescription('Bir kullaniciyi whiteliste ekler (Admin only)')
    .addUserOption(o => o.setName('kullanici').setDescription('Whitelist eklenecek kullanici').setRequired(true))
    .addStringOption(o => o.setName('isim').setDescription('WL icin isim/lakap').setRequired(true)),

  new SlashCommandBuilder()
    .setName('wlsil')
    .setDescription('Bir kullaniciyi whitelistten kaldirir (Admin only)')
    .addUserOption(o => o.setName('kullanici').setDescription('Kaldirilacak kullanici').setRequired(true)),

  new SlashCommandBuilder()
    .setName('keylerim')
    .setDescription('Whitelistinize bagli tum keyleri listeler'),

  new SlashCommandBuilder()
    .setName('adminpanel')
    .setDescription('Admin paneli - sistem istatistikleri (Admin only)')
];

// ==================== REGISTER COMMANDS ====================
async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    console.log('[BOT] Slash komutlari kaydediliyor...');
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands.map(c => c.toJSON()) });
    console.log('[BOT] Slash komutlari basariyla kaydedildi');
  } catch (err) {
    console.error('[BOT] Komut kayit hatasi:', err.message);
  }
}

// ==================== BOT READY ====================
client.once('ready', async () => {
  console.log(`\n  ╔══════════════════════════════════════╗`);
  console.log(`  ║   NOVEX DISCORD BOT ONLINE          ║`);
  console.log(`  ║   ${client.user.tag}                  ║`);
  console.log(`  ╚══════════════════════════════════════╝\n`);
  await registerCommands();
  logSystem('info', 'Discord botu baslatildi');
});

// ==================== INTERACTION HANDLER ====================
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, user } = interaction;

  switch (commandName) {
    case 'key':
      await handleKeyCommand(interaction);
      break;
    case 'wlekle':
      await handleWlEkle(interaction);
      break;
    case 'wlsil':
      await handleWlSil(interaction);
      break;
    case 'keylerim':
      await handleKeylerim(interaction);
      break;
    case 'adminpanel':
      await handleAdminPanel(interaction);
      break;
  }
});

// ==================== /key ====================
async function handleKeyCommand(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const discordId = interaction.user.id;
  const wlEntry = db.prepare('SELECT * FROM whitelist WHERE discord_id = ?').get(discordId);

  if (!wlEntry) {
    return interaction.editReply({
      content: '> **Erisim Reddedildi**\n> Whitelistte degilsiniz. Once bir adminin sizi `/wlekle` ile eklemesi gerekiyor.',
    });
  }

  const key = generateKey();
  const expiresAt = new Date(Date.now() + 30 * 60000).toISOString();

  db.prepare('INSERT INTO auth_keys (key_value, wl_name, duration_minutes, expires_at) VALUES (?, ?, 30, ?)').run(key, wlEntry.name, expiresAt);
  db.prepare('INSERT INTO key_usage_log (key_value, wl_name, action) VALUES (?, ?, ?)').run(key, wlEntry.name, 'KEY_CREATED_DISCORD');
  logSystem('info', `Discord /key: ${wlEntry.name} icin key olusturuldu`);

  try {
    const dmEmbed = new EmbedBuilder()
      .setTitle('Novex Auth Key')
      .setColor(0xFFFFFF)
      .setDescription(`Merhaba **${wlEntry.name}**,\n\nAsagidaki key **30 dakika** gecerlidir.\nTek kullanimliktir, kimseyle paylasmayin.`)
      .addFields(
        { name: 'Key', value: `\`\`\`${key}\`\`\`` },
        { name: 'Sure', value: '30 Dakika', inline: true },
        { name: 'Site', value: '||Localhost||', inline: true }
      )
      .setFooter({ text: 'Novex Auth System v1.0' })
      .setTimestamp();

    const dm = await interaction.user.send({ embeds: [dmEmbed] });

    interaction.editReply({
      content: `> **Key Olusturuldu**\n> DM kutunuza gonderildi. Key 30 dakika gecerlidir.\n> DM 10 dakika sonra otomatik silinecek.`,
    });

    // 10 dakika sonra DM'i sil
    setTimeout(async () => {
      try {
        await dm.delete();
        logSystem('info', `${wlEntry.name} key DM'i otomatik silindi`);
      } catch {}
    }, 10 * 60 * 1000);
  } catch (dmError) {
    interaction.editReply({
      content: '> **HATA:** DM gondermeye calisirken hata olustu. Lutfen DM\'lerinizin acik oldugundan emin olun.',
    });
  }
}

// ==================== /wlekle ====================
async function handleWlEkle(interaction) {
  if (!ADMIN_IDS.includes(interaction.user.id) && interaction.user.id !== interaction.guild?.ownerId) {
    return interaction.reply({ content: '> **Yetkisiz Erisim**\n> Bu komutu kullanma yetkiniz yok.', ephemeral: true });
  }

  const targetUser = interaction.options.getUser('kullanici');
  const name = interaction.options.getString('isim');

  const existing = db.prepare('SELECT id FROM whitelist WHERE discord_id = ?').get(targetUser.id);
  if (existing) {
    return interaction.reply({
      content: `> **Zaten Kayitli**\n> <@${targetUser.id}> zaten whitelistte \`${existing.name || name}\` olarak kayitli.`,
      ephemeral: true
    });
  }

  db.prepare('INSERT OR REPLACE INTO whitelist (name, discord_id, added_by) VALUES (?, ?, ?)').run(name, targetUser.id, interaction.user.id);
  logSystem('info', `Discord /wlekle: ${name} (${targetUser.id}) WL eklendi, ekleyen: ${interaction.user.tag}`);

  return interaction.reply({
    content: `> **Whitelist Eklendi**\n> Kullanici: <@${targetUser.id}>\n> Isim: \`${name}\`\n> Ekleyen: <@${interaction.user.id}>\n\n> Artik \`/key\` komutunu kullanabilir.`,
  });
}

// ==================== /wlsil ====================
async function handleWlSil(interaction) {
  if (!ADMIN_IDS.includes(interaction.user.id) && interaction.user.id !== interaction.guild?.ownerId) {
    return interaction.reply({ content: '> **Yetkisiz Erisim**\n> Bu komutu kullanma yetkiniz yok.', ephemeral: true });
  }

  const targetUser = interaction.options.getUser('kullanici');
  const existing = db.prepare('SELECT * FROM whitelist WHERE discord_id = ?').get(targetUser.id);
  if (!existing) {
    return interaction.reply({ content: `> <@${targetUser.id}> whitelistte bulunamadi.`, ephemeral: true });
  }

  db.prepare('DELETE FROM whitelist WHERE discord_id = ?').run(targetUser.id);
  db.prepare('UPDATE auth_keys SET is_active = 0 WHERE wl_name = ?').run(existing.name);
  logSystem('warning', `Discord /wlsil: ${existing.name} (${targetUser.id}) WL silindi`);

  return interaction.reply({
    content: `> **Whitelist Kaldirildi**\n> Kullanici: <@${targetUser.id}>\n> Isim: \`${existing.name}\`\n> Tum keyleri deaktif edildi.`,
  });
}

// ==================== /keylerim ====================
async function handleKeylerim(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const discordId = interaction.user.id;
  const wlEntry = db.prepare('SELECT * FROM whitelist WHERE discord_id = ?').get(discordId);
  if (!wlEntry) {
    return interaction.editReply({ content: '> Whitelistte degilsiniz.' });
  }

  const keys = db.prepare('SELECT * FROM auth_keys WHERE wl_name = ? ORDER BY created_at DESC LIMIT 25').all(wlEntry.name);
  if (keys.length === 0) {
    return interaction.editReply({ content: '> Henuz hic key olusturmamissiniz. `/key` kullanin.' });
  }

  const embed = new EmbedBuilder()
    .setTitle(`Keylerin - ${wlEntry.name}`)
    .setColor(0x333333)
    .setDescription(keys.map(k => {
      const status = k.is_banned ? '🔴 Banli' : !k.is_active ? '⚫ Pasif' : new Date(k.expires_at) < new Date() ? '🟡 Suresi Doldu' : '🟢 Aktif';
      return `**#${k.id}** ${status}\n\`${k.key_value.substring(0, 14)}...\` | ${k.usage_count} kullanim`;
    }).join('\n\n'))
    .setFooter({ text: `Toplam ${keys.length} key | Novex Auth` });

  return interaction.editReply({ embeds: [embed] });
}

// ==================== /adminpanel ====================
async function handleAdminPanel(interaction) {
  if (!ADMIN_IDS.includes(interaction.user.id) && interaction.user.id !== interaction.guild?.ownerId) {
    return interaction.reply({ content: '> **Yetkisiz Erisim**', ephemeral: true });
  }

  const totalKeys = db.prepare('SELECT COUNT(*) as c FROM auth_keys').get().c;
  const activeKeys = db.prepare("SELECT COUNT(*) as c FROM auth_keys WHERE is_active = 1 AND is_banned = 0 AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))").get().c;
  const onlineNow = db.prepare('SELECT COUNT(*) as c FROM sessions WHERE is_online = 1').get().c;
  const todayLogins = db.prepare("SELECT COUNT(*) as c FROM key_usage_log WHERE action = 'LOGIN_SUCCESS' AND date(timestamp) = date('now')").get().c;
  const wlCount = db.prepare('SELECT COUNT(*) as c FROM whitelist').get().c;
  const bannedIps = db.prepare('SELECT COUNT(*) as c FROM banned_ips').get().c;

  const embed = new EmbedBuilder()
    .setTitle('Novex Admin Panel')
    .setColor(0xFFFFFF)
    .addFields(
      { name: 'Toplam Key', value: `${totalKeys}`, inline: true },
      { name: 'Aktif Key', value: `${activeKeys}`, inline: true },
      { name: 'Online', value: `${onlineNow}`, inline: true },
      { name: 'Bugunku Giris', value: `${todayLogins}`, inline: true },
      { name: 'WL Kullanicisi', value: `${wlCount}`, inline: true },
      { name: 'Banli IP', value: `${bannedIps}`, inline: true }
    )
    .setFooter({ text: 'Novex Auth System' })
    .setTimestamp();

  return interaction.reply({ embeds: [embed] });
}

// ==================== STARTUP ====================
client.login(TOKEN).catch(err => {
  console.error('[BOT] Giris hatasi:', err.message);
});
