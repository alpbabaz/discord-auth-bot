# Novex Auth System v1.0

Siyah-beyaz modern temali, Discord bot entegrasyonlu auth key yonetim paneli.

## Ozellikler

- Discord bot ile `/key` komutu - 30dk gecerli key uretir, DM'e gonderir, 10dk sonra otomatik siler
- `/wlekle` komutu ile whitelist yonetimi (sadece adminler)
- Web panel uzerinden key girisli auth sistemi
- Dashboard - anlik istatistikler, durum raporu, lisans ozeti, grafikler
- Key yonetimi - tekli/toplu key uretme, banlama, sure uzatma, HWID sifirlama
- Aktif oturum takibi ve sonlandirma
- Operasyon konsolu (help, stats, keys, panic, banip, wlip)
- Sistem loglari ve akilli uyarilar
- IP banlama / IP whitelist
- Panic modu (tek tikla tum sistemi kapatma)
- Ozel 404 sayfasi (IP yakalama)

## Kurulum

### 1. Gereksinimler
- Node.js v18+
- Discord Bot Tokeni ([Discord Developer Portal](https://discord.com/developers/applications))

### 2. Dosyalari Indir
Tum dosyalari bir klasore cikar.

### 3. Bagimliliklari Yukle
```bash
npm install
```

### 4. config.json Duzenle
```json
{
  "discord_token": "BOT_TOKENINIZI_BURAYA_YAZIN",
  "admin_ids": ["ADMIN_DISCORD_IDNIZ"],
  "site_port": 3000,
  "site_name": "Novex Bypass"
}
```

- `discord_token`: Discord Developer Portal'dan alacaginiz bot tokeni
- `admin_ids`: `/wlekle` ve `/adminpanel` komutlarini kullanabilecek Discord ID'leri
- `site_port`: Web panelin calisacagi port

### 5. Discord Bot Ayarlari
- [Discord Developer Portal](https://discord.com/developers/applications) > Bot
- **Privileged Gateway Intents**: MESSAGE CONTENT INTENT acik olmali
- Botu sunucuya davet et: OAuth2 > URL Generator > bot + applications.commands

### 6. Baslat
```bash
# Site ve botu birlikte calistir
start-all.bat

# Veya ayri ayri
start-server.bat
start-bot.bat
```

Site: `http://localhost:3000`

## Kullanim

### Discord Bot Komutlari
| Komut | Aciklama |
|---|---|
| `/key` | Sana 30dk gecerli auth keyi DM'den gonderir (WL'de olman lazim) |
| `/wlekle @kisi isim` | Kullaniciyi whitelist'e ekler (Admin) |
| `/wlsil @kisi` | Kullaniciyi whitelist'ten kaldirir (Admin) |
| `/keylerim` | Kendi keylerini listeler |
| `/adminpanel` | Sistem istatistiklerini gosterir (Admin) |

### Web Panel
1. Discord'dan `/key` ile key al
2. Siteye `NX-...` formatindaki key ile giris yap
3. Dashboard uzerinden tum kontrolleri yonet

## VDS'ye Kurulum

```bash
# Projeyi VDS'ye at, klasore gir
npm install
# config.json duzenle
# site_port olarak 80 veya nginx proxy ile 3000
```

## Dosya Yapisi
```
authj/
  server.js        - Web sunucu (Express + Socket.IO)
  bot.js           - Discord botu
  config.json      - Bot tokeni ve ayarlar
  public/
    index.html     - Web panel
    css/style.css   - Tema
    js/app.js      - Frontend
    images/        - Logo
  start-all.bat    - Hepsini baslat
  start-server.bat - Sadece site
  start-bot.bat    - Sadece bot
```

## Guvenlik Notlari
- `config.json` dosyasini asla paylasma (token icerir)
- `.gitignore` zaten config.json ve veritabanini disliyor
- VDS'de calistirirken firewall'dan port acmayi unutma
- Panic modu saldiri aninda tum oturumlari kapatir
